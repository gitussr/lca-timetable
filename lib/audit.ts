import { ObjectId } from 'mongodb';
import { collections } from './db';
import type { AuditAction } from './types';

/**
 * Audit log (§26). Deliberately small: who, what, which record, when, and a
 * sentence a human can read. Not an enterprise audit system — the point is
 * being able to answer "who cleared Wednesday?" when three people share the
 * timetable.
 *
 * Rows expire after 180 days via the TTL index in db.ts.
 *
 * Never throws into the caller: a failed audit write must not roll back a
 * successful edit. It is logged and swallowed.
 */
export async function audit(entry: {
  userId: string | null;
  userName: string;
  action: AuditAction;
  target: string;
  targetId?: string | null;
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}): Promise<void> {
  try {
    const logs = await collections.auditLogs();
    await logs.insertOne({
      _id: new ObjectId(),
      at: new Date(),
      userId: entry.userId && ObjectId.isValid(entry.userId) ? new ObjectId(entry.userId) : null,
      // Denormalised so the entry survives the user being deleted.
      userName: entry.userName,
      action: entry.action,
      target: entry.target,
      targetId: entry.targetId ?? null,
      summary: entry.summary,
      ...(entry.before ? { before: redact(entry.before) } : {}),
      ...(entry.after ? { after: redact(entry.after) } : {}),
    });
  } catch (err) {
    console.error('[audit] write failed:', err instanceof Error ? err.message : String(err));
  }
}

/** A password must never reach the audit log, even in a before/after diff (§30). */
const SECRET_KEYS = new Set(['password', 'passwordHash', 'newPassword', 'token']);

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = SECRET_KEYS.has(k) ? '<redacted>' : v;
  }
  return out;
}
