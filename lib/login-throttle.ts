import { getDb } from './db';

/**
 * Login rate limiting (§30).
 *
 * Backed by MongoDB rather than an in-process Map: serverless invocations do
 * not share memory, so an in-memory counter would reset on every cold start and
 * be trivially defeated by concurrency. This is a small collection with a TTL
 * index, which is the cheapest thing that actually works across instances.
 *
 * Keyed on email, not IP — the threat is password guessing against a known
 * account, and there are three accounts. IP keying would punish an academy
 * behind one NAT.
 */

const WINDOW_SECONDS = 15 * 60;
const MAX_ATTEMPTS = 8;
const COLLECTION = 'loginAttempts';

interface AttemptDoc {
  _id: string;
  count: number;
  firstAt: Date;
}

async function attempts() {
  return (await getDb()).collection<AttemptDoc>(COLLECTION);
}

/**
 * False when the account is locked out. TTL deletion only runs about once a
 * minute, so the window is also checked explicitly here rather than trusted to
 * the index — otherwise a lockout could outlive its window by up to 60s.
 */
export async function throttleCheck(email: string): Promise<boolean> {
  const doc = await (await attempts()).findOne({ _id: email });
  if (!doc) return true;

  const age = (Date.now() - doc.firstAt.getTime()) / 1000;
  if (age > WINDOW_SECONDS) {
    await clearFailures(email);
    return true;
  }
  return doc.count < MAX_ATTEMPTS;
}

export async function recordFailure(email: string): Promise<void> {
  const now = new Date();
  await (await attempts()).updateOne(
    { _id: email },
    { $inc: { count: 1 }, $setOnInsert: { firstAt: now } },
    { upsert: true },
  );
}

export async function clearFailures(email: string): Promise<void> {
  await (await attempts()).deleteOne({ _id: email });
}

/** Called from ensureIndexes(). Expiry is the throttle window itself. */
export async function ensureThrottleIndex(): Promise<string> {
  return (await attempts()).createIndex(
    { firstAt: 1 },
    { name: 'firstAt_ttl', expireAfterSeconds: WINDOW_SECONDS },
  );
}

export const THROTTLE_LIMITS = { WINDOW_SECONDS, MAX_ATTEMPTS } as const;
