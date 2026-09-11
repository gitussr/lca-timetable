import { toMinutes } from './constants';
import type { CourseWire, ScheduleWire, SettingsWire, StudentWire } from './serialize';

/**
 * The presentation logic ported out of the legacy script.js, with the
 * hard-coded assumptions removed. Pure functions with no DOM and no database,
 * so the rules are testable on their own (§33, §54).
 */

export interface Cell {
  day: string;
  rangeId: string;
  entries: { schedule: ScheduleWire; student: StudentWire; icon: string }[];
}

/** `HH:mm` → the display used in the column headers. */
export function formatTime(time: string): string {
  return time;
}

/**
 * Groups schedules into grid cells by `day + startTime + endTime` — exactly the
 * derivation §16 describes, which is why no `slots` collection exists.
 *
 * A schedule whose times match no configured range is dropped from the grid
 * rather than forced into a neighbouring column; `orphans` reports those so the
 * UI can say so instead of silently losing a class.
 */
export function buildGrid(
  settings: SettingsWire,
  students: StudentWire[],
  schedules: ScheduleWire[],
  courses: CourseWire[],
): { cells: Map<string, Cell>; orphans: ScheduleWire[] } {
  const studentById = new Map(students.map((s) => [s.id, s]));
  const iconByCourse = new Map(courses.map((c) => [c.id, c.icon]));

  const rangeKey = new Map<string, string>();
  for (const r of settings.timeRanges) {
    rangeKey.set(r.startTime + '|' + r.endTime, r.id);
  }

  const cells = new Map<string, Cell>();
  for (const day of settings.days) {
    for (const r of settings.timeRanges) {
      cells.set(day + '|' + r.id, { day, rangeId: r.id, entries: [] });
    }
  }

  const orphans: ScheduleWire[] = [];
  for (const schedule of schedules) {
    const id = rangeKey.get(schedule.startTime + '|' + schedule.endTime);
    const student = studentById.get(schedule.studentId);
    // A schedule for a soft-deleted student is not an orphan column, it is
    // simply gone from the roster; skip it silently.
    if (!student) continue;
    if (!id) {
      orphans.push(schedule);
      continue;
    }
    const cell = cells.get(schedule.day + '|' + id);
    if (!cell) {
      orphans.push(schedule);
      continue;
    }
    cell.entries.push({
      schedule,
      student,
      icon: iconByCourse.get(student.courseId) ?? '',
    });
  }

  // Stable order inside a cell, so the grid does not reshuffle between renders.
  for (const cell of cells.values()) {
    cell.entries.sort((a, b) => a.student.name.localeCompare(b.student.name));
  }

  return { cells, orphans };
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * Which day column is today, and which cells are "live" (§4's is-today /
 * is-live).
 *
 * The legacy version indexed with `allSlots[dayIndex * 4 + i]` against a
 * hard-coded four-entry timeSlots array, so a fifth column silently mis-marked
 * the live cell rather than failing visibly. This resolves against the ranges
 * themselves, so it stays correct for any number of columns.
 *
 * **Live is plural.** The legacy grid had four columns that did not overlap, so
 * exactly one could be current. Resolving D2 turned the `(5pm)` labels into real
 * ranges, and those overlap: at 17:45 on a Saturday, `16:00-18:00`,
 * `17:00-18:30` and `17:30-19:00` are all genuinely in progress. Returning the
 * first match left the later columns unmarked while a class was running in them
 * (2026-09-11).
 *
 * The fallback — nothing running, so point at what is next — is plural for the
 * same reason: two ranges can share a start time.
 */
export function findNow(
  settings: SettingsWire,
  now: Date,
): { today: string | null; liveRangeIds: string[] } {
  const today = DAY_NAMES[now.getDay()] ?? null;
  if (!today || !settings.days.includes(today)) {
    return { today: null, liveRangeIds: [] };
  }

  const minutes = now.getHours() * 60 + now.getMinutes();
  const ranges = [...settings.timeRanges].sort(
    (a, b) => toMinutes(a.startTime) - toMinutes(b.startTime),
  );

  // Every class happening right now, not merely the first one found.
  const running = ranges.filter(
    (r) => minutes >= toMinutes(r.startTime) && minutes < toMinutes(r.endTime),
  );
  if (running.length) return { today, liveRangeIds: running.map((r) => r.id) };

  // Otherwise point at what is due next, as the legacy behaviour did — and at
  // all of them, if several start together.
  const upcoming = ranges.filter((r) => minutes < toMinutes(r.startTime));
  const soonest = upcoming[0];
  if (!soonest) return { today, liveRangeIds: [] };
  const at = toMinutes(soonest.startTime);
  return { today, liveRangeIds: upcoming.filter((r) => toMinutes(r.startTime) === at).map((r) => r.id) };
}

/**
 * The empty-seat readout (§4, decision D4).
 *
 * The legacy figure was `floor(count(empty <li>) / 3)` — a count of padding
 * elements over an unexplained divisor. Preserved exactly in shape, but
 * computed from data instead of from the DOM, with the divisor now a setting.
 *
 * The NUMBER changes from the legacy page, because capacity is
 * days × ranges × slotCapacity and the ranges went from 4 to 6 when the
 * "(5pm)" labels became real times (D2). That is a consequence of the data, not
 * a change to the formula.
 */
export function emptySeats(
  settings: SettingsWire,
  scheduledCount: number,
): number {
  const capacity =
    settings.days.length * settings.timeRanges.length * settings.slotCapacity;
  const divisor = settings.emptySeatDivisor || 1;
  return Math.max(0, Math.floor((capacity - scheduledCount) / divisor));
}

export interface RosterSection {
  key: string;
  label: string;
  students: StudentWire[];
}

/**
 * The footer roster (§19), grouped from the SAME student array the grid uses —
 * never a second copy (§20). This is the fix for the legacy page's two
 * hand-synchronised lists.
 *
 * Sections are derived: one per course, split by cohort where a course has them
 * (decision D1). Nothing here is hard-coded to "Web Dev (Old)".
 */
export function buildRoster(
  students: StudentWire[],
  courses: CourseWire[],
): RosterSection[] {
  const cohortLabel: Record<string, string> = { old: 'Old', new: 'New' };
  const sections: RosterSection[] = [];

  // Explicit order, then name as a tiebreak — never bare alphabetical, which
  // would reorder the legacy footer (§19).
  const ordered = [...courses].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.name.localeCompare(b.name),
  );

  for (const course of ordered) {
    const mine = students.filter((s) => s.courseId === course.id);
    if (mine.length === 0) continue;

    const cohorts = [...new Set(mine.map((s) => s.cohort))];
    // Deterministic: old before new, un-cohorted last.
    cohorts.sort((a, b) => {
      const rank = (c: string | null) => (c === 'old' ? 0 : c === 'new' ? 1 : 2);
      return rank(a) - rank(b);
    });

    for (const cohort of cohorts) {
      const inCohort = mine.filter((s) => s.cohort === cohort);
      if (inCohort.length === 0) continue;
      sections.push({
        key: course.id + ':' + (cohort ?? '-'),
        label:
          course.shortName || course.name,
        students: [...inCohort].sort((a, b) => b.courseMonth - a.courseMonth),
      });
      if (cohort) {
        sections[sections.length - 1]!.label += ' (' + (cohortLabel[cohort] ?? cohort) + ')';
      }
    }
  }

  return sections;
}
