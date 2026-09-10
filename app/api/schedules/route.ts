import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { problem, withRole } from '@/lib/rbac';
import { createScheduleInput } from '@/lib/schemas';
import { isDuplicateKey, newDocStamp, parseBody } from '@/lib/mutate';
import { scheduleToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import type { ScheduleDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Assigns a student to a day and time.
 *
 * Note what is NOT validated: whether the time matches the course's
 * `defaultDuration`, or whether the student already has `sessionsPerWeek`
 * classes. Those are course defaults, not constraints — the student's actual
 * schedule is authoritative (§17, §41). Sabita Mondal attends six days a week
 * against a two-day default, and that is legitimate data, not an error.
 */
export const POST = withRole('editor', async (req, { user }) => {
  const body = await parseBody(req, createScheduleInput);
  if (!body.ok) return body.response;

  const { studentId, day, startTime, endTime } = body.data;

  const students = await collections.students();
  const student = await students.findOne(
    { _id: new ObjectId(studentId), active: true },
    { projection: { _id: 1, name: 1 } },
  );
  if (!student) {
    return problem(400, 'Unknown student', 'That student does not exist or has been removed.');
  }

  const settings = await collections.settings();
  const config = await settings.findOne({ _id: 'app' }, { projection: { days: 1 } });
  if (config && !config.days.includes(day)) {
    return problem(400, 'Day not in use', `The timetable does not currently run on ${day}.`);
  }

  const schedules = await collections.schedules();
  const doc: ScheduleDoc = {
    _id: new ObjectId(),
    studentId: student._id,
    day,
    startTime,
    endTime,
    ...newDocStamp(new ObjectId(user.id)),
  };

  try {
    await schedules.insertOne(doc);
  } catch (err) {
    // The student_day_start_unique index is the real guard against §20's
    // duplicate-record problem; this turns it into a readable message.
    if (isDuplicateKey(err)) {
      return problem(
        409,
        'Already booked',
        `${student.name} already has a class at ${startTime} on ${day}.`,
      );
    }
    throw err;
  }

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'schedule.create',
    target: 'schedule',
    targetId: doc._id.toHexString(),
    summary: `assigned ${student.name} to ${day} ${startTime}–${endTime}`,
  });

  return NextResponse.json({ schedule: scheduleToWire(doc) }, { status: 201 });
});
