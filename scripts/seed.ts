/**
 * Seeds MongoDB from scripts/seed-data.json (§36).
 *
 * Idempotent by natural key, so re-running never duplicates (§20):
 *   courses    by slug
 *   students   by name
 *   schedules  by studentId + day + startTime
 *   settings   by the fixed _id 'app'
 *
 * Refuses to run while seed-data.json still contains unresolved D2 conflicts,
 * unless --allow-unreviewed is passed. Seeding a contradiction silently is
 * exactly the failure mode this migration exists to remove.
 *
 * Run: npm run seed
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ObjectId } from 'mongodb';
import { collections, ensureIndexes, getClient, SETTINGS_ID } from '../lib/db';
import type { Cohort, CourseIcon, Day } from '../lib/constants';

interface SeedFile {
  meta: { commit: string; counts: Record<string, number> };
  courses: { slug: string; name: string; shortName?: string | null; order?: number; defaultDuration: number; sessionsPerWeek: number; icon: string }[];
  students: { name: string; courseSlug: string; cohort: string | null; studentClass: string | null; courseMonth: number }[];
  schedules: { studentName: string; day: string; startTime: string; endTime: string; review?: string }[];
  settings: {
    days: string[];
    timeRanges: { id: string; startTime: string; endTime: string; order: number }[];
    slotCapacity: number;
    emptySeatDivisor: number;
  };
}

const allowUnreviewed = process.argv.includes('--allow-unreviewed');
const data = JSON.parse(
  readFileSync(join(process.cwd(), 'scripts', 'seed-data.json'), 'utf8'),
) as SeedFile;

const conflicts = data.schedules.filter((s) => s.review?.startsWith('D2 CONFLICT'));
if (conflicts.length && !allowUnreviewed) {
  console.error('\nRefusing to seed: ' + conflicts.length + ' unresolved D2 conflict(s).\n');
  for (const c of conflicts) {
    console.error('  ' + c.day + ' ' + c.startTime + '-' + c.endTime + '  ' + c.studentName);
    console.error('    ' + c.review);
  }
  console.error(
    '\nResolve them in scripts/seed-data.json (correct the times and delete the\n' +
      '`review` field), or re-run with --allow-unreviewed to seed anyway.\n',
  );
  process.exit(1);
}

/** Seed writes are attributed to no user; audit rows start once people log in. */
const SYSTEM = null;

async function main(): Promise<void> {
  const now = new Date();
  const stamp = { createdAt: now, updatedAt: now, updatedBy: SYSTEM, version: 0 };

  console.log('ensuring indexes...');
  const indexes = await ensureIndexes();
  console.log('  ' + indexes.join(', ') + '\n');

  /* ------------------------------------------------------------- courses */
  const courses = await collections.courses();
  const courseIdBySlug = new Map<string, ObjectId>();

  for (const c of data.courses) {
    // $setOnInsert for the stamp so re-running never resets version/createdAt.
    await courses.updateOne(
      { slug: c.slug },
      {
        $set: {
          name: c.name,
          shortName: c.shortName ?? null,
          order: c.order ?? 0,
          defaultDuration: c.defaultDuration,
          sessionsPerWeek: c.sessionsPerWeek,
          icon: c.icon as CourseIcon,
          active: true,
          updatedAt: now,
        },
        $setOnInsert: { slug: c.slug, createdAt: now, updatedBy: SYSTEM, version: 0 },
      },
      { upsert: true },
    );
    const doc = await courses.findOne({ slug: c.slug }, { projection: { _id: 1 } });
    courseIdBySlug.set(c.slug, doc!._id);
  }
  console.log('courses    ' + courseIdBySlug.size);

  /* ------------------------------------------------------------ students */
  const students = await collections.students();
  const studentIdByName = new Map<string, ObjectId>();

  for (const s of data.students) {
    const courseId = courseIdBySlug.get(s.courseSlug);
    if (!courseId) throw new Error('Unknown course slug: ' + s.courseSlug);

    await students.updateOne(
      { name: s.name },
      {
        $set: {
          courseId,
          cohort: s.cohort as Cohort | null,
          studentClass: s.studentClass,
          courseMonth: s.courseMonth,
          active: true,
          updatedAt: now,
        },
        $setOnInsert: { name: s.name, createdAt: now, updatedBy: SYSTEM, version: 0 },
      },
      { upsert: true },
    );
    const doc = await students.findOne({ name: s.name }, { projection: { _id: 1 } });
    studentIdByName.set(s.name, doc!._id);
  }
  console.log('students   ' + studentIdByName.size);

  /* ----------------------------------------------------------- schedules */
  const schedules = await collections.schedules();
  let scheduleCount = 0;

  for (const s of data.schedules) {
    const studentId = studentIdByName.get(s.studentName);
    if (!studentId) throw new Error('Unknown student: ' + s.studentName);

    // Natural key matches the unique index student_day_start_unique.
    await schedules.updateOne(
      { studentId, day: s.day as Day, startTime: s.startTime },
      {
        $set: { endTime: s.endTime, updatedAt: now },
        $setOnInsert: {
          studentId,
          day: s.day as Day,
          startTime: s.startTime,
          createdAt: now,
          updatedBy: SYSTEM,
          version: 0,
        },
      },
      { upsert: true },
    );
    scheduleCount++;
  }
  console.log('schedules  ' + scheduleCount);

  /* ------------------------------------------------------------ settings */
  const settings = await collections.settings();
  await settings.updateOne(
    { _id: SETTINGS_ID },
    {
      $set: {
        days: data.settings.days as Day[],
        timeRanges: data.settings.timeRanges,
        slotCapacity: data.settings.slotCapacity,
        emptySeatDivisor: data.settings.emptySeatDivisor,
        updatedAt: now,
      },
      $setOnInsert: { createdAt: now, updatedBy: SYSTEM, version: 0 },
    },
    { upsert: true },
  );
  console.log('settings   ' + data.settings.timeRanges.length + ' time ranges, ' +
    data.settings.days.length + ' days');

  /* ---------------------------------------------------------- verify §36 */
  const [nStudents, nSchedules, nCourses] = await Promise.all([
    students.countDocuments({ active: true }),
    schedules.countDocuments({}),
    courses.countDocuments({ active: true }),
  ]);

  console.log('\nverification');
  const expect = (label: string, actual: number, wanted: number) => {
    const good = actual === wanted;
    console.log('  ' + (good ? 'ok  ' : 'BAD ') + label + ' ' + actual + ' (expected ' + wanted + ')');
    return good;
  };

  const allGood =
    expect('students ', nStudents, data.students.length) &&
    expect('schedules', nSchedules, data.schedules.length) &&
    expect('courses  ', nCourses, data.courses.length);

  if (!allGood) {
    throw new Error('Seed verification failed - counts do not match seed-data.json');
  }
  console.log('\nseeded from legacy commit ' + data.meta.commit);
  if (conflicts.length) {
    console.log('WARNING: seeded with ' + conflicts.length + ' unresolved D2 conflict(s).');
  }
}

main()
  .then(async () => {
    await (await getClient()).close();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    // Never let a driver error print the connection string (§30).
    const message = err instanceof Error ? err.message : String(err);
    console.error('\nseed failed: ' + message.replace(/mongodb\+srv:\/\/[^\s]*/g, '<redacted>'));
    try {
      await (await getClient()).close();
    } catch {
      /* already down */
    }
    process.exit(1);
  });
