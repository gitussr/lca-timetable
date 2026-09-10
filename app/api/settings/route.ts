import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections, SETTINGS_ID } from '@/lib/db';
import { conflict, problem, withAuth, withRole } from '@/lib/rbac';
import { updateSettingsInput } from '@/lib/schemas';
import { parseBody } from '@/lib/mutate';
import { settingsToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import { roleAtLeast } from '@/lib/constants';
import type { SettingsDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withAuth(async () => {
  const settings = await collections.settings();
  const doc = await settings.findOne({ _id: SETTINGS_ID });
  if (!doc) return problem(404, 'Not set up', 'The timetable has not been seeded yet.');
  return NextResponse.json({ settings: settingsToWire(doc) });
});

/**
 * Split permissions (§7).
 *
 * Editors manage time ranges, because adding a 17:00 column is ordinary
 * timetable work and §40 requires it without a developer. Everything else here
 * — which days the academy runs, how many rows a cell holds — is application
 * configuration and stays admin-only. Enforced server-side, per field.
 */
export const PATCH = withRole('editor', async (req, { user }) => {
  const body = await parseBody(req, updateSettingsInput);
  if (!body.ok) return body.response;

  const { version, ...changes } = body.data;

  const adminOnly = (['days', 'slotCapacity', 'emptySeatDivisor'] as const).filter(
    (k) => changes[k] !== undefined,
  );
  if (adminOnly.length > 0 && !roleAtLeast(user.role, 'admin')) {
    return problem(
      403,
      'Not allowed',
      `Changing ${adminOnly.join(', ')} needs the admin role. You have ${user.role}.`,
    );
  }

  const settings = await collections.settings();
  const before = await settings.findOne({ _id: SETTINGS_ID });
  if (!before) return problem(404, 'Not set up', 'The timetable has not been seeded yet.');

  const set: Partial<SettingsDoc> = {};
  if (changes.days !== undefined) set.days = changes.days;
  if (changes.slotCapacity !== undefined) set.slotCapacity = changes.slotCapacity;
  if (changes.emptySeatDivisor !== undefined) set.emptySeatDivisor = changes.emptySeatDivisor;

  // Removing a range must not silently orphan the classes inside it (§40).
  if (changes.timeRanges !== undefined) {
    const keptKeys = new Set(changes.timeRanges.map((r) => `${r.startTime}|${r.endTime}`));
    const removed = before.timeRanges.filter(
      (r) => !keptKeys.has(`${r.startTime}|${r.endTime}`),
    );

    if (removed.length > 0) {
      const schedules = await collections.schedules();
      const occupied = await schedules.countDocuments({
        $or: removed.map((r) => ({ startTime: r.startTime, endTime: r.endTime })),
      });
      if (occupied > 0) {
        return problem(
          409,
          'Time range still in use',
          `${occupied} class${occupied === 1 ? '' : 'es'} still sit${occupied === 1 ? 's' : ''} in ` +
            removed.map((r) => `${r.startTime}–${r.endTime}`).join(', ') +
            '. Move or clear them first.',
          { occupied },
        );
      }
    }
    set.timeRanges = changes.timeRanges;
  }

  const updated = await settings.findOneAndUpdate(
    { _id: SETTINGS_ID, version },
    {
      $set: { ...set, updatedAt: new Date(), updatedBy: new ObjectId(user.id) },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' },
  );

  if (!updated) {
    const current = await settings.findOne({ _id: SETTINGS_ID });
    if (!current) return problem(404, 'Not set up', 'The timetable has not been seeded yet.');
    return conflict(settingsToWire(current));
  }

  await audit({
    userId: user.id,
    userName: user.name,
    action: changes.timeRanges !== undefined ? 'timeRange.add' : 'settings.update',
    target: 'settings',
    targetId: SETTINGS_ID,
    summary:
      changes.timeRanges !== undefined
        ? `changed timetable columns to ${updated.timeRanges.length} range(s)`
        : `updated ${Object.keys(changes).join(', ')}`,
    before: { timeRanges: before.timeRanges.length, days: before.days },
    after: changes as Record<string, unknown>,
  });

  return NextResponse.json({ settings: settingsToWire(updated) });
});
