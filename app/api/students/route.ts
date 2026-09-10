import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { withAuth, withRole, problem } from '@/lib/rbac';
import { createStudentInput } from '@/lib/schemas';
import { isDuplicateKey, newDocStamp, parseBody } from '@/lib/mutate';
import { studentToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import type { StudentDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Any signed-in user may read the roster; only editors and up may add (§7). */
export const GET = withAuth(async () => {
  const students = await collections.students();
  const docs = await students.find({ active: true }).sort({ name: 1 }).toArray();
  return NextResponse.json({ students: docs.map(studentToWire) });
});

export const POST = withRole('editor', async (req, { user }) => {
  const body = await parseBody(req, createStudentInput);
  if (!body.ok) return body.response;

  const { name, courseId, cohort, studentClass, courseMonth } = body.data;

  // The course must exist and be active, or we create an orphan (§20, §22).
  const courses = await collections.courses();
  const course = await courses.findOne(
    { _id: new ObjectId(courseId), active: true },
    { projection: { _id: 1, name: 1 } },
  );
  if (!course) {
    return problem(400, 'Unknown course', 'That course does not exist or is no longer active.');
  }

  const students = await collections.students();
  const actor = new ObjectId(user.id);

  const doc: StudentDoc = {
    _id: new ObjectId(),
    name,
    courseId: course._id,
    cohort,
    studentClass,
    courseMonth,
    active: true,
    ...newDocStamp(actor),
  };

  try {
    await students.insertOne(doc);
  } catch (err) {
    if (isDuplicateKey(err)) {
      return problem(409, 'Already exists', 'A student with that name is already on the roster.');
    }
    throw err;
  }

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'student.create',
    target: 'student',
    targetId: doc._id.toHexString(),
    summary: `added ${name} to ${course.name}`,
    after: { name, courseMonth, studentClass, cohort },
  });

  return NextResponse.json({ student: studentToWire(doc) }, { status: 201 });
});
