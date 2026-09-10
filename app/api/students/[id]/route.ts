import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections, getClient } from '@/lib/db';
import { conflict, problem, withRole } from '@/lib/rbac';
import { updateStudentInput } from '@/lib/schemas';
import { isDuplicateKey, parseBody, versionedUpdate } from '@/lib/mutate';
import { studentToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import type { StudentDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

/** Rejects a malformed id before it reaches the driver (§30). */
function parseId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export const PATCH = withRole<Params>('editor', async (req, { user, params }) => {
  const id = parseId(params.id);
  if (!id) return problem(404, 'Not found', 'No student with that id.');

  const body = await parseBody(req, updateStudentInput);
  if (!body.ok) return body.response;

  const { version, ...changes } = body.data;

  const students = await collections.students();
  const before = await students.findOne({ _id: id });
  if (!before) return problem(404, 'Not found', 'No student with that id.');

  const set: Partial<StudentDoc> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.cohort !== undefined) set.cohort = changes.cohort;
  if (changes.studentClass !== undefined) set.studentClass = changes.studentClass;
  if (changes.courseMonth !== undefined) set.courseMonth = changes.courseMonth;
  if (changes.active !== undefined) set.active = changes.active;

  if (changes.courseId !== undefined) {
    const courses = await collections.courses();
    const course = await courses.findOne(
      { _id: new ObjectId(changes.courseId), active: true },
      { projection: { _id: 1 } },
    );
    if (!course) {
      return problem(400, 'Unknown course', 'That course does not exist or is no longer active.');
    }
    set.courseId = course._id;
  }

  let result;
  try {
    result = await versionedUpdate(students, id, version, set, new ObjectId(user.id));
  } catch (err) {
    // Renaming onto a name another active student already has (§20).
    if (isDuplicateKey(err)) {
      return problem(409, 'Already exists', 'Another student on the roster already has that name.');
    }
    throw err;
  }

  if (result.status === 'missing') return problem(404, 'Not found', 'No student with that id.');
  if (result.status === 'conflict') return conflict(studentToWire(result.current));

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'student.update',
    target: 'student',
    targetId: params.id,
    summary: `edited ${result.doc.name}`,
    before: { name: before.name, courseMonth: before.courseMonth, studentClass: before.studentClass },
    after: changes as Record<string, unknown>,
  });

  return NextResponse.json({ student: studentToWire(result.doc) });
});

/**
 * Soft-deletes the student and removes their schedule assignments (§22).
 *
 * "Delete student" and "clear assignment" are deliberately different
 * operations: clearing removes one schedule row, this removes the person. The
 * student record is retained (`active: false`) so audit entries and any future
 * history keep a name to point at, while the schedules are removed outright so
 * no orphan rows remain in the grid.
 *
 * Both happen in one transaction — a half-applied delete would leave the
 * timetable showing a student who no longer exists.
 */
export const DELETE = withRole<Params>('admin', async (_req, { user, params }) => {
  const id = parseId(params.id);
  if (!id) return problem(404, 'Not found', 'No student with that id.');

  const students = await collections.students();
  const schedules = await collections.schedules();

  const student = await students.findOne({ _id: id });
  if (!student) return problem(404, 'Not found', 'No student with that id.');

  const client = await getClient();
  const session = client.startSession();
  let removedSchedules = 0;

  try {
    await session.withTransaction(async () => {
      const res = await schedules.deleteMany({ studentId: id }, { session });
      removedSchedules = res.deletedCount;
      await students.updateOne(
        { _id: id },
        {
          $set: {
            active: false,
            updatedAt: new Date(),
            updatedBy: new ObjectId(user.id),
          },
          $inc: { version: 1 },
        },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'student.delete',
    target: 'student',
    targetId: params.id,
    summary: `removed ${student.name} and ${removedSchedules} class assignment(s)`,
    before: { name: student.name, courseMonth: student.courseMonth },
  });

  return NextResponse.json({ ok: true, removedSchedules });
});
