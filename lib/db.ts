import { MongoClient, type Db, type Collection, type Document } from 'mongodb';
import { ensureThrottleIndex } from './login-throttle';
import type {
  AuditLogDoc,
  CourseDoc,
  ScheduleDoc,
  SettingsDoc,
  StudentDoc,
  UserDoc,
} from './types';

/**
 * MongoDB connection (§32).
 *
 * Serverless invocations are frozen and thawed rather than torn down, so the
 * driver's pool survives between requests on a warm instance. One client per
 * instance, created lazily, reused forever — never a new connection per
 * request. The promise (not the resolved client) is cached so that concurrent
 * first-requests share a single connect() rather than racing.
 *
 * In development the cache hangs off globalThis so Turbopack's HMR does not
 * leak a new pool on every edit.
 *
 * This module is server-only. Nothing here may be imported from a client
 * component — the URI would end up in the browser bundle.
 */

const DEFAULT_DB_NAME = 'lca_timetable';

declare global {
  // eslint-disable-next-line no-var
  var __lcaMongoClientPromise: Promise<MongoClient> | undefined;
}

function readUri(): string {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error(
      'MONGODB_URI is not set. Copy .env.example to .env.local and fill it in. ' +
        'See docs/phase-1-assessment.md §0 before using any credential.',
    );
  }
  // Deliberately not echoed, not logged, not included in any thrown message (§30).
  return uri;
}

function createClient(): Promise<MongoClient> {
  const client = new MongoClient(readUri(), {
    // Fail fast rather than hanging a serverless invocation for 30s.
    serverSelectionTimeoutMS: 5_000,
    connectTimeoutMS: 10_000,
    // The default pool is 100; a small app on serverless wants far less, and
    // Atlas M0 caps total connections at 500 across all instances.
    maxPoolSize: 10,
    minPoolSize: 0,
    retryWrites: true,
  });
  return client.connect();
}

export function getClient(): Promise<MongoClient> {
  const dev = process.env.NODE_ENV === 'development';
  const existing = dev ? globalThis.__lcaMongoClientPromise : cachedClientPromise;
  if (existing) return existing;

  /*
   * Caching the promise rather than the client is what lets concurrent
   * first-requests share one connect(). But a REJECTED promise must never stay
   * cached: instances are frozen and thawed rather than torn down, so one that
   * happened to start while the database was unreachable would re-throw that
   * same rejection for the rest of its life — no retry, no new connection, and
   * no log line to show for it, because nothing tries again.
   *
   * That is not hypothetical. It is exactly what happened on 2026-09-11: the
   * first production deployment came up while the Atlas access list was still
   * closed, and kept failing after the list was opened.
   *
   * So: clear the slot on failure, and the next request connects afresh.
   */
  const promise = createClient().catch((err: unknown) => {
    if (dev) globalThis.__lcaMongoClientPromise = undefined;
    else cachedClientPromise = undefined;
    throw err;
  });

  if (dev) globalThis.__lcaMongoClientPromise = promise;
  else cachedClientPromise = promise;
  return promise;
}

let cachedClientPromise: Promise<MongoClient> | undefined;

export async function getDb(): Promise<Db> {
  const client = await getClient();
  return client.db(process.env.MONGODB_DB || DEFAULT_DB_NAME);
}

/** Typed collection accessors — the only way the rest of the app reaches Mongo. */
async function coll<T extends Document>(name: string): Promise<Collection<T>> {
  return (await getDb()).collection<T>(name);
}

export const collections = {
  users: () => coll<UserDoc>('users'),
  courses: () => coll<CourseDoc>('courses'),
  students: () => coll<StudentDoc>('students'),
  schedules: () => coll<ScheduleDoc>('schedules'),
  settings: () => coll<SettingsDoc>('settings'),
  auditLogs: () => coll<AuditLogDoc>('auditLogs'),
};

/** The single settings document's fixed _id (§9 — one row, not a collection of rows). */
export const SETTINGS_ID = 'app';

/**
 * Index definitions (§29). Deliberately few: created explicitly here rather
 * than scattered across call sites, so the read patterns they serve stay
 * legible. Applied by `npm run ensure-indexes`, which is idempotent —
 * createIndex on an existing identical index is a no-op.
 */
export async function ensureIndexes(): Promise<string[]> {
  const created: string[] = [];
  const users = await collections.users();
  const students = await collections.students();
  const schedules = await collections.schedules();
  const auditLogs = await collections.auditLogs();

  created.push(await users.createIndex({ email: 1 }, { unique: true, name: 'email_unique' }));

  // Footer roster + student pickers: active students of a course, name-ordered.
  created.push(
    await students.createIndex(
      { active: 1, courseId: 1, name: 1 },
      { name: 'active_course_name' },
    ),
  );

  /**
   * One active student per name (§20).
   *
   * Without this the 409 in POST /api/students was unreachable and duplicates
   * were created silently — while `seed.ts` upserts students BY NAME, so a
   * duplicate would make re-seeding match an arbitrary one of them.
   *
   * Partial, on `active`, so a soft-deleted student does not permanently
   * reserve their name. The trade is explicit: two *different* students with
   * the same name cannot both be active at once. For an academy of sixteen
   * that is the right way round — the grid shows only names, so two identical
   * ones would be indistinguishable to a human anyway.
   */
  created.push(
    await students.createIndex(
      { name: 1 },
      { unique: true, partialFilterExpression: { active: true }, name: 'name_unique_active' },
    ),
  );

  // Cascade on student delete, and "where does this student appear?".
  created.push(await schedules.createIndex({ studentId: 1 }, { name: 'studentId' }));

  // THE timetable query. Every grid render is one indexed scan of this.
  created.push(
    await schedules.createIndex(
      { day: 1, startTime: 1, endTime: 1 },
      { name: 'day_start_end' },
    ),
  );

  // One student cannot be booked twice into the same day+start (§20).
  created.push(
    await schedules.createIndex(
      { studentId: 1, day: 1, startTime: 1 },
      { unique: true, name: 'student_day_start_unique' },
    ),
  );

  created.push(await auditLogs.createIndex({ at: -1 }, { name: 'at_desc' }));

  // Login rate limiting (§30) — window expiry is the TTL.
  created.push(await ensureThrottleIndex());

  // Keeps the audit log "lightweight" literally (§26) — 180 days, then gone.
  created.push(
    await auditLogs.createIndex(
      { at: 1 },
      { name: 'at_ttl', expireAfterSeconds: 60 * 60 * 24 * 180 },
    ),
  );

  return created;
}
