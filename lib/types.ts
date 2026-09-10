import type { ObjectId } from 'mongodb';
import type { Cohort, CourseIcon, Day, Role, Theme } from './constants';

/**
 * Shapes as stored in MongoDB. These are the *documents*; the Zod schemas in
 * ./schemas.ts describe what the API accepts from a client, which is a
 * deliberately narrower thing (no _id, no version bumping, no timestamps).
 */

/** Every mutable record carries this (§24). `version` drives optimistic concurrency. */
export interface Versioned {
  createdAt: Date;
  updatedAt: Date;
  updatedBy: ObjectId | null;
  version: number;
}

export interface UserDoc extends Versioned {
  _id: ObjectId;
  name: string;
  /** Stored lowercase; unique index. */
  email: string;
  /** bcrypt hash. NEVER projected into an API response (§30). */
  passwordHash: string;
  role: Role;
  preferredTheme: Theme | null;
  active: boolean;
}

export interface CourseDoc extends Versioned {
  _id: ObjectId;
  name: string;
  /**
   * Short label for the footer roster. The legacy footer reads "Web Dev (Old)"
   * while the course is "Web Development" — without this the headings would
   * silently change wording, which §5 rules out. Null falls back to `name`.
   */
  shortName: string | null;
  /**
   * Display order for the footer sections (§19). Without it the roster falls
   * back to alphabetical, which puts Basic Computer above Web Dev and silently
   * reorders the legacy footer.
   */
  order: number;
  slug: string;
  /** Minutes. A default for new schedules, not a constraint on them (§41). */
  defaultDuration: number;
  /** Guidance only — the student's actual schedule is authoritative (§41). */
  sessionsPerWeek: number;
  /** A key, never markup (§11, §42). */
  icon: CourseIcon;
  active: boolean;
}

export interface StudentDoc extends Versioned {
  _id: ObjectId;
  name: string;
  courseId: ObjectId;
  /** Resolves D1 — the footer's "Web Dev (Old/New)" split. Null for Basic Computer. */
  cohort: Cohort | null;
  /** School standard, split out of the display name (§13). Null when not applicable. */
  studentClass: string | null;
  /** Running course month. A DURATION, not an ID (§12). */
  courseMonth: number;
  active: boolean;
}

export interface ScheduleDoc extends Versioned {
  _id: ObjectId;
  studentId: ObjectId;
  day: Day;
  /** `HH:mm`, 24-hour. */
  startTime: string;
  endTime: string;
}

/** A displayed timetable column. Lives inside settings, not its own collection (§16). */
export interface TimeRange {
  id: string;
  startTime: string;
  endTime: string;
  order: number;
}

export interface SettingsDoc extends Versioned {
  _id: string;
  days: Day[];
  timeRanges: TimeRange[];
  /** Rows rendered per cell — the legacy grid hard-coded five <li> (§4). */
  slotCapacity: number;
  /** Resolves D4 — preserved legacy fudge factor, now tunable. */
  emptySeatDivisor: number;
}

export const AUDIT_ACTIONS = [
  'student.create', 'student.update', 'student.delete',
  'schedule.create', 'schedule.update', 'schedule.clear',
  'course.create', 'course.update', 'course.delete',
  'user.create', 'user.update', 'user.role', 'user.delete',
  'settings.update', 'timeRange.add', 'timeRange.remove',
  'auth.login', 'auth.logout',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** Lightweight by design (§26) — enough to answer "who changed what", no more. */
export interface AuditLogDoc {
  _id: ObjectId;
  at: Date;
  userId: ObjectId | null;
  /** Denormalised so the log survives the user being deleted. */
  userName: string;
  action: AuditAction;
  target: string;
  targetId: string | null;
  /** Human-readable, already rendered: "moved Arnab Roy to Tue 17:00". */
  summary: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * Wire shapes — what actually crosses to the browser. ObjectIds become strings
 * and passwordHash does not exist. Handlers build these by explicit projection,
 * never by deleting fields off a document (§30).
 */
export type Wire<T> = Omit<T, '_id' | 'updatedBy' | 'createdAt' | 'updatedAt'> & {
  id: string;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type UserWire = Omit<Wire<UserDoc>, 'passwordHash'>;
export type CourseWire = Wire<CourseDoc>;
export type ScheduleWire = Omit<Wire<ScheduleDoc>, 'studentId'> & { studentId: string };
export type StudentWire = Omit<Wire<StudentDoc>, 'courseId'> & { courseId: string };
