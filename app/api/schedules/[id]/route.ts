import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { conflict, problem, withRole } from '@/lib/rbac';
import { updateScheduleInput } from '@/lib/schemas';
import { isDuplicateKey, parseBody, versionedUpdate } from '@/lib/mutate';
import { scheduleToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import type { ScheduleDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

function parseId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

async function studentName(studentId: ObjectId): Promise<string> {
  const students = await collections.students();
  const s = await students.findOne({ _id: studentId }, { projection: { name: 1 } });
  return s?.name ?? 'a student';
}

/** Moves a class to a different day or time. */
export const PATCH = withRole<Params>('editor', async (req, { user, params }) => {
  const id = parseId(params.id);
  if (!id) return problem(404, 'Not found', 'No class assignment with that id.');

  const body = await parseBody(req, updateScheduleInput);
  if (!body.ok) return body.response;

  const { version, ...changes } = body.data;

  const schedules = await collections.schedules();
  const before = await schedules.findOne({ _id: id });
  if (!before) return problem(404, 'Not found', 'No class assignment with that id.');

  const set: Partial<ScheduleDoc> = {};
  if (changes.day !== undefined) set.day = changes.day;
  if (changes.startTime !== undefined) set.startTime = changes.startTime;
  if (changes.endTime !== undefined) set.endTime = changes.endTime;

  let result;
  try {
    result = await versionedUpdate(schedules, id, version, set, new ObjectId(user.id));
  } catch (err) {
    if (isDuplicateKey(err)) {
      return problem(
        409,
        'Already booked',
        'That student already has a class at the new day and time.',
      );
    }
    throw err;
  }

  if (result.status === 'missing') return problem(404, 'Not found', 'No class assignment with that id.');
  if (result.status === 'conflict') return conflict(scheduleToWire(result.current));

  const name = await studentName(result.doc.studentId);
  await audit({
    userId: user.id,
    userName: user.name,
    action: 'schedule.update',
    target: 'schedule',
    targetId: params.id,
    summary:
      `moved ${name} from ${before.day} ${before.startTime}–${before.endTime} ` +
      `to ${result.doc.day} ${result.doc.startTime}–${result.doc.endTime}`,
    before: { day: before.day, startTime: before.startTime, endTime: before.endTime },
    after: changes as Record<string, unknown>,
  });

  return NextResponse.json({ schedule: scheduleToWire(result.doc) });
});

/**
 * CLEARS an assignment — it does not delete the student (§22).
 *
 * This is the operation the spec is most emphatic about not confusing. It
 * removes one row from `schedules`; the student stays on the roster, keeps
 * their course month, and keeps every other class. Deleting the person is
 * DELETE /api/students/:id, which is admin-only; this is editor-level because
 * clearing a slot is routine timetable work.
 */
export const DELETE = withRole<Params>('editor', async (_req, { user, params }) => {
  const id = parseId(params.id);
  if (!id) return problem(404, 'Not found', 'No class assignment with that id.');

  const schedules = await collections.schedules();
  const doc = await schedules.findOne({ _id: id });
  if (!doc) return problem(404, 'Not found', 'No class assignment with that id.');

  await schedules.deleteOne({ _id: id });

  const name = await studentName(doc.studentId);
  await audit({
    userId: user.id,
    userName: user.name,
    action: 'schedule.clear',
    target: 'schedule',
    targetId: params.id,
    summary: `cleared ${name} from ${doc.day} ${doc.startTime}–${doc.endTime}`,
    before: { day: doc.day, startTime: doc.startTime, endTime: doc.endTime },
  });

  return NextResponse.json({ ok: true });
});
