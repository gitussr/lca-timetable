import type { CourseWire, ScheduleWire, SettingsWire, StudentWire } from './serialize';
import type { TimetableData } from './timetable-data';
import type { StreamEvent } from './realtime';

/**
 * How local state absorbs a document (§23).
 *
 * Two paths deliver the same new document to the browser that made an edit: the
 * HTTP response, and that edit's own echo on the realtime stream. They must
 * agree on what merging means, or the document lands twice. Keeping both
 * definitions in one file is the point of this module — when they lived in
 * use-timetable.ts and use-realtime.ts they drifted, and inserts duplicated for
 * their author (2026-09-11).
 *
 * Neither function may import React or touch the DOM: scripts/check-merge.ts
 * runs them directly in node.
 */

/**
 * Folds a server-confirmed insert into a list.
 *
 * The optimistic row, if there was one, is dropped and the real document
 * upserted by id — never mapped temp -> real in place. The realtime echo can
 * arrive BEFORE the HTTP response that created the document, in which case the
 * echo has already appended it; mapping would then leave it in the list twice,
 * under the same id.
 */
export function commitInsert<T extends { id: string }>(list: T[], doc: T, tempId?: string): T[] {
  const rest = tempId ? list.filter((x) => x.id !== tempId) : list;
  return rest.some((x) => x.id === doc.id)
    ? rest.map((x) => (x.id === doc.id ? doc : x))
    : [...rest, doc];
}

/**
 * Folds one change event into the dataset.
 *
 * Upserts go through commitInsert with no temp id, so an edit made in this
 * browser and echoed back is a no-op rather than a duplicate — the same rule
 * the commit path uses. Optimistic rows carry a `temp-` id that no server
 * document can collide with, so a pending insert and its own echo coexist for a
 * moment; the commit resolves the pair.
 */
export function applyChange(
  d: TimetableData,
  event: Extract<StreamEvent, { kind: 'change' }>,
): TimetableData {
  switch (event.coll) {
    case 'students': {
      if (event.op === 'delete') {
        return {
          ...d,
          students: d.students.filter((s) => s.id !== event.id),
          // A removed student's classes go with them (§22).
          schedules: d.schedules.filter((s) => s.studentId !== event.id),
        };
      }
      return { ...d, students: commitInsert(d.students, event.doc as StudentWire) };
    }

    case 'schedules': {
      if (event.op === 'delete') {
        return { ...d, schedules: d.schedules.filter((s) => s.id !== event.id) };
      }
      return { ...d, schedules: commitInsert(d.schedules, event.doc as ScheduleWire) };
    }

    case 'courses': {
      if (event.op === 'delete') {
        return { ...d, courses: d.courses.filter((c) => c.id !== event.id) };
      }
      return { ...d, courses: commitInsert(d.courses, event.doc as CourseWire) };
    }

    case 'settings': {
      if (event.op === 'delete') return d;
      return { ...d, settings: event.doc as SettingsWire, seeded: true };
    }

    default:
      return d;
  }
}
