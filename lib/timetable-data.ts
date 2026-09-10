import { collections, SETTINGS_ID } from './db';
import {
  courseToWire, scheduleToWire, settingsToWire, studentToWire,
  type CourseWire, type ScheduleWire, type SettingsWire, type StudentWire,
} from './serialize';
import { DAYS, DEFAULT_EMPTY_SEAT_DIVISOR, DEFAULT_SLOT_CAPACITY } from './constants';
import type { SettingsDoc } from './types';

export interface TimetableData {
  settings: SettingsWire;
  courses: CourseWire[];
  students: StudentWire[];
  schedules: ScheduleWire[];
  seeded: boolean;
}

/**
 * The whole working set for the timetable, in one place.
 *
 * Used by BOTH the page's server render and GET /api/bootstrap, so the initial
 * paint and every later refresh see identical data. If these were two queries
 * they would drift, and the drift would show up as the grid changing shape a
 * moment after load.
 *
 * The page calls this directly rather than fetching its own HTTP endpoint: a
 * server component is already the server, so a self-fetch would add a round
 * trip and a cookie-forwarding problem to reach code in the same process. The
 * browser still never touches MongoDB, which is what §2 actually requires.
 */
export async function loadTimetableData(): Promise<TimetableData> {
  const [studentsCol, schedulesCol, coursesCol, settingsCol] = await Promise.all([
    collections.students(),
    collections.schedules(),
    collections.courses(),
    collections.settings(),
  ]);

  const [students, schedules, courses, settings] = await Promise.all([
    studentsCol.find({ active: true }).sort({ name: 1 }).toArray(),
    schedulesCol.find({}).sort({ day: 1, startTime: 1 }).toArray(),
    coursesCol.find({ active: true }).sort({ name: 1 }).toArray(),
    settingsCol.findOne({ _id: SETTINGS_ID }),
  ]);

  // An indexed-but-unseeded database renders an empty timetable, not a 500 (§43).
  const effective: SettingsDoc = settings ?? {
    _id: SETTINGS_ID,
    days: [...DAYS],
    timeRanges: [],
    slotCapacity: DEFAULT_SLOT_CAPACITY,
    emptySeatDivisor: DEFAULT_EMPTY_SEAT_DIVISOR,
    createdAt: new Date(),
    updatedAt: new Date(),
    updatedBy: null,
    version: 0,
  };

  return {
    settings: settingsToWire(effective),
    courses: courses.map(courseToWire),
    students: students.map(studentToWire),
    schedules: schedules.map(scheduleToWire),
    seeded: settings !== null,
  };
}
