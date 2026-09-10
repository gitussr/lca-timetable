import type { ChangeStream, ChangeStreamDocument, Document, ResumeToken } from 'mongodb';
import { ObjectId } from 'mongodb';
import { collections, getDb, SETTINGS_ID } from '@/lib/db';
import { withAuth } from '@/lib/rbac';
import {
  courseToWire, scheduleToWire, settingsToWire, studentToWire,
} from '@/lib/serialize';
import {
  HEARTBEAT_MS, STREAM_LIFETIME_MS, WATCHED_COLLECTIONS,
  type ChangeEvent, type StreamEvent, type WatchedCollection,
} from '@/lib/realtime';
import type { CourseDoc, ScheduleDoc, SettingsDoc, StudentDoc } from '@/lib/types';

/** Change streams need the driver and a real socket — never the edge runtime. */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Must exceed STREAM_LIFETIME_MS, or the platform kills the stream before it
 * recycles itself. Also capped by the hosting plan's own function limit — see
 * docs/deployment.md before changing either number.
 */
export const maxDuration = 300;

/**
 * Realtime updates over Server-Sent Events, driven by MongoDB change streams
 * (§23).
 *
 * Chosen over a hosted socket service because it adds no vendor, no account, no
 * extra secret and no dependency: Atlas change streams and the browser's native
 * EventSource are both already here. Updates only ever flow server → client —
 * writes go over ordinary fetch — so a bidirectional socket would buy nothing.
 * Raw WebSockets are not supported by Vercel's serverless functions anyway.
 *
 * ONE change stream per connection, watching the database rather than four
 * collections separately, so a connected editor costs one cursor and not four.
 *
 * Honest limits: one held-open invocation per connected editor, sized for the
 * ~5-20 concurrent editors an institute with three roster sections has. The
 * connection recycles itself before the platform's maxDuration and the client
 * resumes from its token, so no event is lost across the reconnect.
 */

/** Resolves actor ids to names, so the notice can say who. Per-connection. */
class ActorNames {
  private cache = new Map<string, string>();

  async resolve(id: ObjectId | null | undefined): Promise<{ id: string | null; name: string } | null> {
    if (!id) return null;
    const key = id.toHexString();
    const hit = this.cache.get(key);
    if (hit) return { id: key, name: hit };

    const users = await collections.users();
    const user = await users.findOne({ _id: id }, { projection: { name: 1 } });
    const name = user?.name ?? 'Someone';
    this.cache.set(key, name);
    return { id: key, name };
  }
}

/** Turns a raw change-stream document into the event the browser consumes. */
async function toEvent(
  change: ChangeStreamDocument<Document>,
  actors: ActorNames,
): Promise<ChangeEvent | null> {
  // Some change types (dropDatabase) carry a namespace with no collection.
  if (!('ns' in change) || !change.ns || !('coll' in change.ns)) return null;
  const coll = change.ns.coll as WatchedCollection;
  if (!WATCHED_COLLECTIONS.includes(coll)) return null;

  // Deletes carry no document, only the key.
  if (change.operationType === 'delete') {
    const id = change.documentKey?._id;
    if (id === undefined) return null;
    return { kind: 'change', coll, op: 'delete', id: String(id) };
  }

  if (
    change.operationType !== 'insert' &&
    change.operationType !== 'update' &&
    change.operationType !== 'replace'
  ) {
    return null;
  }

  const full = change.fullDocument;
  if (!full) return null;

  switch (coll) {
    case 'students': {
      const doc = full as unknown as StudentDoc;
      // A soft delete arrives as an update; the grid must drop the row.
      if (!doc.active) {
        return { kind: 'change', coll, op: 'delete', id: doc._id.toHexString() };
      }
      return {
        kind: 'change', coll, op: 'upsert',
        id: doc._id.toHexString(),
        doc: studentToWire(doc),
        by: await actors.resolve(doc.updatedBy),
      };
    }
    case 'schedules': {
      const doc = full as unknown as ScheduleDoc;
      return {
        kind: 'change', coll, op: 'upsert',
        id: doc._id.toHexString(),
        doc: scheduleToWire(doc),
        by: await actors.resolve(doc.updatedBy),
      };
    }
    case 'courses': {
      const doc = full as unknown as CourseDoc;
      if (!doc.active) {
        return { kind: 'change', coll, op: 'delete', id: doc._id.toHexString() };
      }
      return {
        kind: 'change', coll, op: 'upsert',
        id: doc._id.toHexString(),
        doc: courseToWire(doc),
        by: await actors.resolve(doc.updatedBy),
      };
    }
    case 'settings': {
      const doc = full as unknown as SettingsDoc;
      return {
        kind: 'change', coll, op: 'upsert',
        id: SETTINGS_ID,
        doc: settingsToWire(doc),
        by: await actors.resolve(doc.updatedBy),
      };
    }
    default:
      return null;
  }
}

/**
 * An empty `id:` field resets the client's Last-Event-ID per the SSE spec, so
 * its next reconnect will not replay a resume token the oplog has dropped.
 * Paired with a harmless `hello`, because a lone id line is not a dispatchable
 * event and the browser would never process it.
 */
const RESET_LAST_EVENT_ID = 'id: \ndata: {"kind":"hello"}\n\n';

export const GET = withAuth(async (req) => {
  const encoder = new TextEncoder();
  // EventSource replays its last id on reconnect; that is the resume token.
  const lastEventId = req.headers.get('last-event-id');

  let changeStream: ChangeStream<Document> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let lifetime: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const actors = new ActorNames();

      const send = (event: StreamEvent, id?: ResumeToken) => {
        if (closed) return;
        try {
          const lines =
            (id ? 'id: ' + encodeURIComponent(JSON.stringify(id)) + '\n' : '') +
            'data: ' + JSON.stringify(event) + '\n\n';
          controller.enqueue(encoder.encode(lines));
        } catch {
          /* the consumer went away between the check and the write */
        }
      };

      const shutdown = () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (lifetime) clearTimeout(lifetime);
        void changeStream?.close().catch(() => undefined);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // The browser navigated away or the tab closed.
      req.signal.addEventListener('abort', shutdown);

      // Tell EventSource how quickly to come back after an unexpected drop.
      controller.enqueue(encoder.encode('retry: 2000\n\n'));
      send({ kind: 'hello' });

      const db = await getDb();
      const pipeline = [
        { $match: { 'ns.coll': { $in: [...WATCHED_COLLECTIONS] } } },
      ];

      let resumeAfter: ResumeToken | undefined;
      if (lastEventId) {
        try {
          resumeAfter = JSON.parse(decodeURIComponent(lastEventId)) as ResumeToken;
        } catch {
          // A malformed token must not wedge the connection — start fresh.
          resumeAfter = undefined;
        }
      }

      /**
       * Opens the change stream, optionally resuming.
       *
       * A resume token only fails when the stream is USED, not when it is
       * constructed, so the recovery has to live in the error handler. The
       * realistic case is a laptop closed over a weekend: by the time it comes
       * back the token has fallen off the oplog. Without the reset below, the
       * server would error, the client would reconnect replaying the same dead
       * Last-Event-ID, and the two would loop forever.
       */
      const open = (token: ResumeToken | undefined, isRetry: boolean) => {
        changeStream = db.watch(pipeline, {
          fullDocument: 'updateLookup',
          ...(token ? { startAfter: token } : {}),
        });

        changeStream.on('change', (change) => {
          void (async () => {
            try {
              const event = await toEvent(change, actors);
              if (event) send(event, change._id);
            } catch {
              /* one bad change must not kill the stream */
            }
          })();
        });

        changeStream.on('error', () => {
          void changeStream?.close().catch(() => undefined);

          if (token && !isRetry) {
            // An empty `id:` field resets the client's Last-Event-ID per the
            // SSE spec, so its next reconnect will not replay the dead token.
            if (!closed) {
              try {
                controller.enqueue(encoder.encode(RESET_LAST_EVENT_ID));
              } catch {
                /* consumer gone */
              }
            }
            try {
              open(undefined, true);
              return;
            } catch {
              /* fall through to the cycle below */
            }
          }

          send({ kind: 'cycle', reason: 'stream error' });
          shutdown();
        });
      };

      try {
        open(resumeAfter, false);
      } catch {
        open(undefined, true);
      }

      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          // A comment line: ignored by EventSource, keeps proxies from idling out.
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          shutdown();
        }
      }, HEARTBEAT_MS);

      lifetime = setTimeout(() => {
        send({ kind: 'cycle', reason: 'scheduled recycle' });
        shutdown();
      }, STREAM_LIFETIME_MS);
    },

    cancel() {
      closed = true;
      if (heartbeat) clearInterval(heartbeat);
      if (lifetime) clearTimeout(lifetime);
      void changeStream?.close().catch(() => undefined);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // Nginx and friends buffer by default, which defeats streaming entirely.
      'X-Accel-Buffering': 'no',
    },
  });
});
