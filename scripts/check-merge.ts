/**
 * Exercises lib/merge.ts — how local state absorbs an edit (§23). No database,
 * no server, no DOM.
 *
 * The case that matters is a race. When you create something, two paths deliver
 * the same document to your browser: the HTTP response, and your own edit
 * echoed back on the realtime stream. Either can arrive first. On 2026-09-11 the
 * echo-first ordering left the document in the list twice — visible only to the
 * author of the edit, and only sometimes, because the other ordering was fine.
 *
 * So every insert is asserted under BOTH orderings. A merge that passes one and
 * fails the other is the exact bug this file exists to prevent.
 */
import { applyChange, commitInsert } from '../lib/merge';
import type { TimetableData } from '../lib/timetable-data';
import type { ChangeEvent } from '../lib/realtime';
import type { CourseWire, ScheduleWire, SettingsWire, StudentWire } from '../lib/serialize';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean) => {
  if (cond) { pass++; } else { fail++; console.log('  FAIL  ' + label); }
};

/** Ids present more than once — the failure this suite is named for. */
const dupes = (rows: { id: string }[]) => {
  const ids = rows.map((r) => r.id);
  return ids.filter((v, i) => ids.indexOf(v) !== i);
};
const noDupes = (label: string, rows: { id: string }[], expected: number) => {
  ok(label + ' — ' + expected + ' row(s), none duplicated',
    dupes(rows).length === 0 && rows.length === expected);
};

const student = (id: string, name: string): StudentWire => ({
  id, name, courseId: 'c1', cohort: null, studentClass: null, courseMonth: 1,
  active: true, updatedAt: '2026-09-11T00:00:00.000Z', updatedBy: null, version: 0,
} as StudentWire);
const schedule = (id: string, studentId: string): ScheduleWire => ({
  id, studentId, day: 'Sat', startTime: '16:00', endTime: '18:00',
  updatedAt: '2026-09-11T00:00:00.000Z', updatedBy: null, version: 0,
} as ScheduleWire);
const course = (id: string): CourseWire => ({
  id, name: 'Web Development', shortName: 'Web Dev', slug: 'web-development',
  defaultDuration: 120, sessionsPerWeek: 3, icon: 'laptop', order: 0,
  updatedAt: '2026-09-11T00:00:00.000Z', updatedBy: null, version: 0,
} as unknown as CourseWire);

const base = (): TimetableData => ({
  settings: { days: ['Mon'], timeRanges: [], slotCapacity: 5, emptySeatDivisor: 3, version: 0 },
  courses: [course('c1')],
  students: [student('existing', 'Sabita Mondal')],
  schedules: [schedule('sch-existing', 'existing')],
  seeded: true,
});

const upsert = (coll: ChangeEvent['coll'], doc: { id: string }): ChangeEvent =>
  ({ kind: 'change', coll, op: 'upsert', id: doc.id, doc: doc as StudentWire });
const remove = (coll: ChangeEvent['coll'], id: string): ChangeEvent =>
  ({ kind: 'change', coll, op: 'delete', id });
/** Settings is a singleton — its wire form carries no id. */
const upsertSettings = (doc: SettingsWire): ChangeEvent =>
  ({ kind: 'change', coll: 'settings', op: 'upsert', id: 'settings', doc });

/* ---------------------------------------------- the race, in both orderings */

console.log('insert races (the 2026-09-11 duplicate)');

{
  const temp = student('temp-abc', 'another std');
  const real = student('real-1', 'another std');
  const withTemp = { ...base(), students: [...base().students, temp] };

  const responseFirst = applyChange(
    { ...withTemp, students: commitInsert(withTemp.students, real, 'temp-abc') },
    upsert('students', real),
  );
  noDupes('student — response then echo', responseFirst.students, 2);

  const echoed = applyChange(withTemp, upsert('students', real));
  const echoFirst = { ...echoed, students: commitInsert(echoed.students, real, 'temp-abc') };
  noDupes('student — echo then response', echoFirst.students, 2);

  ok('student — no temp row survives either ordering',
    !responseFirst.students.some((s) => s.id.startsWith('temp-')) &&
    !echoFirst.students.some((s) => s.id.startsWith('temp-')));
}

{
  // This is the one that actually rendered twice in the grid.
  const temp = schedule('temp-xyz', 'real-1');
  const real = schedule('sch-new', 'real-1');
  const withTemp = { ...base(), schedules: [...base().schedules, temp] };

  const responseFirst = applyChange(
    { ...withTemp, schedules: commitInsert(withTemp.schedules, real, 'temp-xyz') },
    upsert('schedules', real),
  );
  noDupes('schedule — response then echo', responseFirst.schedules, 2);

  const echoed = applyChange(withTemp, upsert('schedules', real));
  const echoFirst = { ...echoed, schedules: commitInsert(echoed.schedules, real, 'temp-xyz') };
  noDupes('schedule — echo then response', echoFirst.schedules, 2);
}

{
  // No optimistic row at all, so the commit is a bare insert.
  const real = course('c2');
  const responseFirst = applyChange(
    { ...base(), courses: commitInsert(base().courses, real) },
    upsert('courses', real),
  );
  noDupes('course — response then echo', responseFirst.courses, 2);

  const echoed = applyChange(base(), upsert('courses', real));
  const echoFirst = { ...echoed, courses: commitInsert(echoed.courses, real) };
  noDupes('course — echo then response', echoFirst.courses, 2);
}

/* ------------------------------------------------------ commitInsert itself */

console.log('commitInsert');
ok('appends when absent', commitInsert([student('a', 'A')], student('b', 'B')).length === 2);
ok('replaces when present',
  commitInsert([student('a', 'A')], student('a', 'A2'))[0]?.name === 'A2');
ok('drops the temp row',
  !commitInsert([student('temp-1', 'X')], student('real', 'X'), 'temp-1')
    .some((s) => s.id === 'temp-1'));
ok('is idempotent',
  commitInsert(commitInsert([], student('a', 'A')), student('a', 'A')).length === 1);
ok('does not mutate its input', (() => {
  const original = [student('a', 'A')];
  commitInsert(original, student('b', 'B'));
  return original.length === 1;
})());

/* ------------------------------------------------------------- applyChange */

console.log('applyChange');
ok('echo of an unchanged doc is a no-op',
  applyChange(base(), upsert('students', student('existing', 'Sabita Mondal'))).students.length === 1);
ok('upsert replaces in place, preserving order', (() => {
  const d = { ...base(), students: [student('a', 'A'), student('b', 'B'), student('c', 'C')] };
  const out = applyChange(d, upsert('students', student('b', 'B2')));
  return out.students.map((s) => s.id).join(',') === 'a,b,c' && out.students[1]?.name === 'B2';
})());
ok('deleting a student takes their classes (§22)', (() => {
  const out = applyChange(base(), remove('students', 'existing'));
  return out.students.length === 0 && out.schedules.length === 0;
})());
ok('deleting a schedule leaves the student', (() => {
  const out = applyChange(base(), remove('schedules', 'sch-existing'));
  return out.schedules.length === 0 && out.students.length === 1;
})());
ok('settings upsert marks the dataset seeded', (() => {
  const d = { ...base(), seeded: false };
  const next: SettingsWire = { days: ['Mon'], timeRanges: [], slotCapacity: 5, emptySeatDivisor: 3, version: 1 };
  return applyChange(d, upsertSettings(next)).seeded;
})());
ok('settings delete leaves the current settings alone',
  applyChange(base(), remove('settings', 's1')).settings.version === 0);
ok('an unknown collection is ignored', applyChange(base(), {
  kind: 'change', coll: 'nope' as ChangeEvent['coll'], op: 'upsert', id: 'x', doc: student('x', 'X'),
}).students.length === 1);
ok('applyChange does not mutate its input', (() => {
  const d = base();
  applyChange(d, upsert('students', student('new', 'New')));
  return d.students.length === 1;
})());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
