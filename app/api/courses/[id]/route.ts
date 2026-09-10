import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { conflict, problem, withRole } from '@/lib/rbac';
import { updateCourseInput } from '@/lib/schemas';
import { parseBody, versionedUpdate } from '@/lib/mutate';
import { courseToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import type { CourseDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

function parseId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export const PATCH = withRole<Params>('admin', async (req, { user, params }) => {
  const id = parseId(params.id);
  if (!id) return problem(404, 'Not found', 'No course with that id.');

  const body = await parseBody(req, updateCourseInput);
  if (!body.ok) return body.response;

  const { version, ...changes } = body.data;
  const courses = await collections.courses();

  const set: Partial<CourseDoc> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.shortName !== undefined) set.shortName = changes.shortName;
  if (changes.order !== undefined) set.order = changes.order;
  if (changes.defaultDuration !== undefined) set.defaultDuration = changes.defaultDuration;
  if (changes.sessionsPerWeek !== undefined) set.sessionsPerWeek = changes.sessionsPerWeek;
  if (changes.icon !== undefined) set.icon = changes.icon;
  if (changes.active !== undefined) set.active = changes.active;

  const result = await versionedUpdate(courses, id, version, set, new ObjectId(user.id));

  if (result.status === 'missing') return problem(404, 'Not found', 'No course with that id.');
  if (result.status === 'conflict') return conflict(courseToWire(result.current));

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'course.update',
    target: 'course',
    targetId: params.id,
    summary: `updated course ${result.doc.name}`,
    after: changes as Record<string, unknown>,
  });

  return NextResponse.json({ course: courseToWire(result.doc) });
});

/**
 * Refuses while any active student still references the course (§22).
 *
 * Deleting it anyway would leave students pointing at a course that no longer
 * exists, which is exactly the orphaned reference the spec asks to prevent. The
 * response names the count so the admin knows what to do about it, rather than
 * just being told no.
 */
export const DELETE = withRole<Params>('admin', async (_req, { user, params }) => {
  const id = parseId(params.id);
  if (!id) return problem(404, 'Not found', 'No course with that id.');

  const courses = await collections.courses();
  const students = await collections.students();

  const course = await courses.findOne({ _id: id });
  if (!course) return problem(404, 'Not found', 'No course with that id.');

  const dependents = await students.countDocuments({ courseId: id, active: true });
  if (dependents > 0) {
    return problem(
      409,
      'Course is in use',
      `${dependents} student${dependents === 1 ? '' : 's'} still ${dependents === 1 ? 'takes' : 'take'} ` +
        `${course.name}. Move them to another course first.`,
      { dependents },
    );
  }

  // Soft delete, consistent with students: audit rows keep a name to resolve.
  await courses.updateOne(
    { _id: id },
    { $set: { active: false, updatedAt: new Date(), updatedBy: new ObjectId(user.id) }, $inc: { version: 1 } },
  );

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'course.delete',
    target: 'course',
    targetId: params.id,
    summary: `deleted course ${course.name}`,
    before: { name: course.name },
  });

  return NextResponse.json({ ok: true });
});
