import type { CourseWire, ScheduleWire, SettingsWire, StudentWire } from './serialize';

/**
 * The wire contract for realtime updates (§23), shared by the SSE route and the
 * browser hook so the two cannot drift.
 *
 * Deltas rather than "something changed, refetch everything": the payload for
 * one edit is a few hundred bytes, where a refetch is the whole working set on
 * every keystroke somebody else makes (§47). The client applies the document it
 * is given, so it converges on server truth rather than on its own arithmetic.
 */

export const WATCHED_COLLECTIONS = ['students', 'schedules', 'courses', 'settings'] as const;
export type WatchedCollection = (typeof WATCHED_COLLECTIONS)[number];

export type ChangeOp = 'upsert' | 'delete';

export interface ChangeEvent {
  kind: 'change';
  coll: WatchedCollection;
  op: ChangeOp;
  id: string;
  /** Present for `upsert`, absent for `delete`. Already in wire form. */
  doc?: StudentWire | ScheduleWire | CourseWire | SettingsWire;
  /** Who caused it, for the "someone else edited this" notice. */
  by?: { id: string | null; name: string } | null;
}

/** Sent once on connect so the client knows the stream is live. */
export interface HelloEvent {
  kind: 'hello';
}

/**
 * Sent just before the server closes a long-lived connection on purpose. The
 * client reconnects immediately rather than waiting out EventSource's backoff.
 */
export interface CycleEvent {
  kind: 'cycle';
  reason: string;
}

export type StreamEvent = ChangeEvent | HelloEvent | CycleEvent;

/**
 * How long a single SSE connection is held before being recycled.
 *
 * Serverless functions have a maximum duration, and a stream that runs into it
 * is killed mid-flight. Closing deliberately a little early means the client
 * reconnects with its resume token in hand and no events are missed.
 *
 * MUST stay below the platform's function duration limit, which varies by
 * hosting plan. Configurable so lowering it is an environment variable rather
 * than a code change:
 *
 *     STREAM_LIFETIME_SECONDS=50   # for a plan capped at 60s
 *
 * If it is set too high the symptom is subtle — the connection dies at the
 * platform limit instead of recycling cleanly, and the client reconnects a
 * beat later than it should. Nothing is lost either way, because the resume
 * token still covers the gap; it is just less tidy.
 */
const DEFAULT_STREAM_LIFETIME_SECONDS = 240;

export const STREAM_LIFETIME_MS =
  Math.max(
    15,
    Number(process.env.STREAM_LIFETIME_SECONDS) || DEFAULT_STREAM_LIFETIME_SECONDS,
  ) * 1000;

/** Keeps proxies from dropping an idle connection. */
export const HEARTBEAT_MS = 25 * 1000;
