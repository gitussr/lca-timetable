import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { problem, withAuth, withRole } from '@/lib/rbac';
import { createCourseInput } from '@/lib/schemas';
import { isDuplicateKey, newDocStamp, parseBody } from '@/lib/mutate';
import { courseToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import type { CourseDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Slug is derived, not user-supplied — it is an internal key, not a label. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

export const GET = withAuth(async () => {
  const courses = await collections.courses();
  const docs = await courses.find({ active: true }).sort({ name: 1 }).toArray();
  return NextResponse.json({ courses: docs.map(courseToWire) });
});

export const POST = withRole('admin', async (req, { user }) => {
  const body = await parseBody(req, createCourseInput);
  if (!body.ok) return body.response;

  const { name, shortName, order, defaultDuration, sessionsPerWeek, icon } = body.data;
  const slug = slugify(name);
  if (!slug) return problem(400, 'Invalid name', 'The course name needs at least one letter or digit.');

  const courses = await collections.courses();
  const doc: CourseDoc = {
    _id: new ObjectId(),
    name,
    shortName,
    order,
    slug,
    defaultDuration,
    sessionsPerWeek,
    icon,
    active: true,
    ...newDocStamp(new ObjectId(user.id)),
  };

  try {
    await courses.insertOne(doc);
  } catch (err) {
    if (isDuplicateKey(err)) {
      return problem(409, 'Already exists', 'A course with that name already exists.');
    }
    throw err;
  }

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'course.create',
    target: 'course',
    targetId: doc._id.toHexString(),
    summary: `created course ${name}`,
    after: { name, defaultDuration, sessionsPerWeek, icon },
  });

  return NextResponse.json({ course: courseToWire(doc) }, { status: 201 });
});
