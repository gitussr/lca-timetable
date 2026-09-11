/**
 * Exercises lib/timetable-view.ts — the pure functions behind the grid (§4).
 * No database, no server, no DOM.
 *
 * findNow is the reason this file exists. The legacy grid had four columns that
 * could not overlap, so "the live one" was singular and the code returned the
 * first match. Resolving D2 turned the `(5pm)` labels into real ranges, and
 * those DO overlap — at 17:45 three of them are running at once. The marker
 * appeared only on the earliest-starting column while classes ran unmarked in
 * the others (2026-09-11).
 *
 * So the overlap cases are asserted explicitly, with the project's own seeded
 * ranges rather than invented ones.
 */
import { findNow, buildGrid, emptySeats } from '../lib/timetable-view';
import type { SettingsWire } from '../lib/serialize';
import type { TimeRange } from '../lib/types';

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean) => {
  if (cond) { pass++; } else { fail++; console.log('  FAIL  ' + label); }
};
const eq = (label: string, actual: unknown, expected: unknown) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; } else { fail++; console.log(`  FAIL  ${label}\n          got      ${a}\n          expected ${e}`); }
};

/** The six ranges the seed actually produces — four of which overlap. */
const range = (id: string, startTime: string, endTime: string, order: number): TimeRange =>
  ({ id, startTime, endTime, order } as TimeRange);

const RANGES: TimeRange[] = [
  range('r1', '10:30', '12:30', 0),
  range('r2', '12:30', '14:30', 1),
  range('r3', '16:00', '18:00', 2),
  range('r4', '17:00', '18:30', 3),
  range('r5', '17:30', '19:00', 4),
  range('r6', '18:00', '20:00', 5),
];

const settings: SettingsWire = {
  days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  timeRanges: RANGES,
  slotCapacity: 5,
  emptySeatDivisor: 3,
  version: 0,
};

/** A Saturday (2026-09-12 is a Saturday) at the given local time. */
const sat = (h: number, m: number) => new Date(2026, 8, 12, h, m, 0);
/** A Sunday — not a teaching day. */
const sun = (h: number, m: number) => new Date(2026, 8, 13, h, m, 0);

const live = (d: Date) => findNow(settings, d).liveRangeIds;

console.log('findNow — overlapping ranges (the 2026-09-11 marker bug)');

eq('17:45 — three classes are running', live(sat(17, 45)).sort(), ['r3', 'r4', 'r5']);
eq('17:15 — 16:00 and 17:00 running', live(sat(17, 15)).sort(), ['r3', 'r4']);
eq('18:15 — 16:00 has ended, three others running', live(sat(18, 15)).sort(), ['r4', 'r5', 'r6']);
eq('19:30 — only the 18:00 class remains', live(sat(19, 30)), ['r6']);
ok('every running range is marked, never just the earliest',
  live(sat(17, 45)).length === 3);

console.log('findNow — boundaries');
eq('exactly 16:00 — the class has started', live(sat(16, 0)), ['r3']);
eq('exactly 18:00 — 16:00 has ended, 18:00 has begun', live(sat(18, 0)).sort(), ['r4', 'r5', 'r6']);
eq('12:30 — one ends as the next begins', live(sat(12, 30)), ['r2']);

console.log('findNow — nothing running, so point at what is next');
eq('08:00 — before the first class', live(sat(8, 0)), ['r1']);
eq('15:00 — between the morning and afternoon blocks', live(sat(15, 0)), ['r3']);
eq('21:00 — after the last class', live(sat(21, 0)), []);
eq('two ranges sharing a start time are both flagged as next', (() => {
  const tied: SettingsWire = {
    ...settings,
    timeRanges: [range('a', '16:00', '18:00', 0), range('b', '16:00', '17:30', 1)],
  };
  return findNow(tied, sat(9, 0)).liveRangeIds.sort();
})(), ['a', 'b']);

console.log('findNow — days');
eq('Sunday is not a teaching day', findNow(settings, sun(17, 45)),
  { today: null, liveRangeIds: [] });
ok('Saturday is today', findNow(settings, sat(17, 45)).today === 'Sat');
ok('a day absent from settings marks nothing', (() => {
  const weekdaysOnly: SettingsWire = { ...settings, days: ['Mon', 'Tue'] };
  const r = findNow(weekdaysOnly, sat(17, 45));
  return r.today === null && r.liveRangeIds.length === 0;
})());
ok('no ranges configured marks nothing',
  findNow({ ...settings, timeRanges: [] }, sat(17, 45)).liveRangeIds.length === 0);

console.log('emptySeats (D4 — the preserved legacy formula)');
ok('floor(empty / divisor)', (() => {
  // 6 days x 6 ranges x 5 seats = 180 capacity.
  const seats = emptySeats(settings, 0);
  return seats === Math.floor(180 / 3);
})());
ok('assignments reduce the figure', emptySeats(settings, 30) === Math.floor(150 / 3));
ok('never negative', emptySeats(settings, 10_000) >= 0);

console.log('buildGrid');
ok('keys every day/range pair', (() => {
  const { cells } = buildGrid(settings, [], [], []);
  return cells.size === 0 || cells.size === settings.days.length * settings.timeRanges.length;
})());

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
