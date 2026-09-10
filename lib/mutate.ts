import type { Collection, Document, Filter, ObjectId, MatchKeysAndValues } from 'mongodb';
import type { ZodType } from 'zod';
import { invalid } from './rbac';

/**
 * Shared mutation mechanics, so every route enforces §24 the same way instead
 * of each one hand-rolling a version check and getting it subtly wrong.
 */

/** Parses a request body against a schema. Returns a 400 Response on failure. */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: invalid([{ path: ['_'], message: 'Expected a JSON body' }]),
    };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, response: invalid(parsed.error.issues) };
  }
  return { ok: true, data: parsed.data };
}

export type UpdateOutcome<T> =
  | { status: 'ok'; doc: T }
  | { status: 'conflict'; current: T }
  | { status: 'missing' };

/**
 * Optimistic concurrency (§24).
 *
 * The update matches on `_id` AND the version the client read. A zero-match
 * means either the record is gone or somebody else wrote first; the two are
 * distinguished by a follow-up read so the caller can answer 404 vs 409, and
 * so a 409 can carry the current state back for the UI to re-apply against.
 *
 * `version` is incremented in the same atomic update as the fields, so two
 * concurrent writers cannot both succeed.
 */
export async function versionedUpdate<T extends Document>(
  collection: Collection<T>,
  id: ObjectId | string,
  expectedVersion: number,
  set: MatchKeysAndValues<T>,
  actor: ObjectId | null,
): Promise<UpdateOutcome<T>> {
  const idFilter = { _id: id } as unknown as Filter<T>;
  const filter = { _id: id, version: expectedVersion } as unknown as Filter<T>;

  const updated = await collection.findOneAndUpdate(
    filter,
    {
      $set: { ...set, updatedAt: new Date(), updatedBy: actor } as MatchKeysAndValues<T>,
      $inc: { version: 1 } as never,
    },
    { returnDocument: 'after' },
  );

  if (updated) return { status: 'ok', doc: updated as T };

  const current = await collection.findOne(idFilter);
  if (!current) return { status: 'missing' };
  return { status: 'conflict', current: current as T };
}

/** Fields stamped onto every newly inserted mutable document. */
export function newDocStamp(actor: ObjectId | null) {
  const now = new Date();
  return { createdAt: now, updatedAt: now, updatedBy: actor, version: 0 };
}

/**
 * MongoDB duplicate-key error. Used to turn a unique-index violation into a
 * friendly 409 rather than a 500 (§43) — the index is the real guard, this is
 * just how the message reaches the user.
 */
export function isDuplicateKey(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: unknown }).code === 11000
  );
}
