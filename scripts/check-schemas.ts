/** Exercises lib/schemas.ts against the §28 validation rules. No database. */
import {
  createScheduleInput, createStudentInput, createUserInput, loginInput,
  objectId, updateScheduleInput, updateSettingsInput, timeOfDay,
  updateStudentInput, updateCourseInput,
} from '../lib/schemas';
import { roleAtLeast, toMinutes } from '../lib/constants';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean) => {
  if (cond) { pass++; } else { fail++; console.log(`  FAIL  ${label}`); }
};
const accepts = (label: string, s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  ok(`accepts ${label}`, s.safeParse(v).success);
const rejects = (label: string, s: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  ok(`rejects ${label}`, !s.safeParse(v).success);

const OID = '507f1f77bcf86cd799439011';

console.log('objectId / time');
accepts('24-hex id', objectId, OID);
rejects('short id', objectId, 'abc');
rejects('non-hex id', objectId, 'zzzf1f77bcf86cd799439011');
accepts('17:30', timeOfDay, '17:30');
rejects('24:00', timeOfDay, '24:00');
rejects('7:30 (unpadded)', timeOfDay, '7:30');
rejects('5pm', timeOfDay, '5pm');

console.log('schedule — endTime > startTime (§28)');
accepts('17:00-18:30', createScheduleInput, { studentId: OID, day: 'Mon', startTime: '17:00', endTime: '18:30' });
rejects('end before start', createScheduleInput, { studentId: OID, day: 'Mon', startTime: '18:30', endTime: '17:00' });
rejects('end equals start', createScheduleInput, { studentId: OID, day: 'Mon', startTime: '17:00', endTime: '17:00' });
rejects('Sunday (§18)', createScheduleInput, { studentId: OID, day: 'Sun', startTime: '10:30', endTime: '12:30' });
rejects('lone startTime change', updateScheduleInput, { startTime: '17:00', version: 1 });
accepts('paired time change', updateScheduleInput, { startTime: '17:00', endTime: '18:30', version: 1 });

console.log('student');
accepts('Samrit Paul, std 8, month 29', createStudentInput,
  { name: 'Samrit Paul', courseId: OID, studentClass: '8', courseMonth: 29, cohort: null });
accepts('cohort old (D1)', createStudentInput,
  { name: 'Srijita Karmakar', courseId: OID, courseMonth: 22, cohort: 'old' });
rejects('blank name', createStudentInput, { name: '   ', courseId: OID, courseMonth: 1 });
rejects('missing course', createStudentInput, { name: 'X', courseMonth: 1 });
rejects('negative month', createStudentInput, { name: 'X', courseId: OID, courseMonth: -1 });
rejects('month that looks like an ID (§12)', createStudentInput, { name: 'X', courseId: OID, courseMonth: 10001 });
ok('name is trimmed', createStudentInput.safeParse(
  { name: '  Arnab Roy  ', courseId: OID, courseMonth: 25 },
).success && createStudentInput.parse({ name: '  Arnab Roy  ', courseId: OID, courseMonth: 25 }).name === 'Arnab Roy');

console.log('partial updates must not resurrect defaults');
// Regression: `createStudentInput.partial()` kept its .default(null)s, so a
// PATCH of one field silently nulled studentClass and cohort.
{
  const parsed = updateStudentInput.parse({ courseMonth: 31, version: 0 });
  ok('student PATCH carries only what was sent',
    JSON.stringify(Object.keys(parsed).sort()) === JSON.stringify(['courseMonth', 'version']));
  ok('student PATCH does not inject studentClass', !('studentClass' in parsed));
  ok('student PATCH does not inject cohort', !('cohort' in parsed));

  const c = updateCourseInput.parse({ defaultDuration: 100, version: 0 });
  ok('course PATCH carries only what was sent',
    JSON.stringify(Object.keys(c).sort()) === JSON.stringify(['defaultDuration', 'version']));
  ok('course PATCH does not inject shortName', !('shortName' in c));
  ok('course PATCH does not inject order', !('order' in c));
}
accepts('explicit null studentClass', updateStudentInput, { studentClass: null, version: 0 });

console.log('user / login');
accepts('valid user', createUserInput, { name: 'A', email: 'A@Example.COM', password: 'correct-horse-battery', role: 'admin' });
ok('email lowercased', createUserInput.parse(
  { name: 'A', email: 'A@Example.COM', password: 'correct-horse-battery', role: 'admin' },
).email === 'a@example.com');
rejects('bad email', createUserInput, { name: 'A', email: 'nope', password: 'correct-horse-battery', role: 'admin' });
rejects('short password', createUserInput, { name: 'A', email: 'a@b.co', password: 'short', role: 'admin' });
rejects('unknown role', createUserInput, { name: 'A', email: 'a@b.co', password: 'correct-horse-battery', role: 'root' });
ok('rememberMe defaults false', loginInput.parse({ email: 'a@b.co', password: 'x' }).rememberMe === false);

console.log('settings — dynamic time ranges (§40)');
accepts('seven ranges', updateSettingsInput, {
  version: 0,
  timeRanges: [
    { id: 'r1', startTime: '10:30', endTime: '12:30', order: 0 },
    { id: 'r2', startTime: '12:30', endTime: '14:30', order: 1 },
    { id: 'r3', startTime: '16:00', endTime: '18:00', order: 2 },
    { id: 'r4', startTime: '17:00', endTime: '18:30', order: 3 },
    { id: 'r5', startTime: '18:00', endTime: '20:00', order: 4 },
    { id: 'r6', startTime: '20:00', endTime: '21:30', order: 5 },
    { id: 'r7', startTime: '15:00', endTime: '16:30', order: 6 },
  ],
});
rejects('duplicate range', updateSettingsInput, {
  version: 0,
  timeRanges: [
    { id: 'r1', startTime: '10:30', endTime: '12:30', order: 0 },
    { id: 'r2', startTime: '10:30', endTime: '12:30', order: 1 },
  ],
});
rejects('duplicate range id', updateSettingsInput, {
  version: 0,
  timeRanges: [
    { id: 'same', startTime: '10:30', endTime: '12:30', order: 0 },
    { id: 'same', startTime: '16:00', endTime: '18:00', order: 1 },
  ],
});
rejects('missing version (§24)', updateSettingsInput, { slotCapacity: 6 });

console.log('role ordering (§8)');
ok('admin >= editor', roleAtLeast('admin', 'editor'));
ok('editor >= editor', roleAtLeast('editor', 'editor'));
ok('viewer NOT >= editor', !roleAtLeast('viewer', 'editor'));
ok('editor NOT >= admin', !roleAtLeast('editor', 'admin'));
ok('toMinutes 17:30', toMinutes('17:30') === 1050);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
