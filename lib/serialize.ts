import type {
  AuditLogDoc, CourseDoc, ScheduleDoc, SettingsDoc, StudentDoc, TimeRange, UserDoc,
} from './types';

/**
 * Document → wire conversion (§30).
 *
 * Every field that crosses to the browser is named here explicitly. That is the
 * point: `passwordHash` cannot leak because nothing copies it, rather than
 * because something deleted it afterwards. A `delete user.passwordHash` style
 * of redaction fails open the moment a new secret field is added — this fails
 * closed, because a new field is invisible until someone adds it here.
 */

export interface UserWire {
  id: string;
  name: string;
  email: string;
  role: string;
  preferredTheme: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export function userToWire(d: UserDoc): UserWire {
  return {
    id: d._id.toHexString(),
    name: d.name,
    email: d.email,
    role: d.role,
    preferredTheme: d.preferredTheme,
    active: d.active,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    version: d.version,
    // passwordHash is deliberately absent and must stay that way.
  };
}

export interface CourseWire {
  id: string;
  name: string;
  shortName: string | null;
  order: number;
  slug: string;
  defaultDuration: number;
  sessionsPerWeek: number;
  icon: string;
  active: boolean;
  version: number;
}

export function courseToWire(d: CourseDoc): CourseWire {
  return {
    id: d._id.toHexString(),
    name: d.name,
    shortName: d.shortName ?? null,
    order: d.order ?? 0,
    slug: d.slug,
    defaultDuration: d.defaultDuration,
    sessionsPerWeek: d.sessionsPerWeek,
    icon: d.icon,
    active: d.active,
    version: d.version,
  };
}

export interface StudentWire {
  id: string;
  name: string;
  courseId: string;
  cohort: string | null;
  studentClass: string | null;
  courseMonth: number;
  active: boolean;
  updatedAt: string;
  updatedBy: string | null;
  version: number;
}

export function studentToWire(d: StudentDoc): StudentWire {
  return {
    id: d._id.toHexString(),
    name: d.name,
    courseId: d.courseId.toHexString(),
    cohort: d.cohort,
    studentClass: d.studentClass,
    courseMonth: d.courseMonth,
    active: d.active,
    updatedAt: d.updatedAt.toISOString(),
    updatedBy: d.updatedBy ? d.updatedBy.toHexString() : null,
    version: d.version,
  };
}

export interface ScheduleWire {
  id: string;
  studentId: string;
  day: string;
  startTime: string;
  endTime: string;
  updatedAt: string;
  updatedBy: string | null;
  version: number;
}

export function scheduleToWire(d: ScheduleDoc): ScheduleWire {
  return {
    id: d._id.toHexString(),
    studentId: d.studentId.toHexString(),
    day: d.day,
    startTime: d.startTime,
    endTime: d.endTime,
    updatedAt: d.updatedAt.toISOString(),
    updatedBy: d.updatedBy ? d.updatedBy.toHexString() : null,
    version: d.version,
  };
}

export interface SettingsWire {
  days: string[];
  timeRanges: TimeRange[];
  slotCapacity: number;
  emptySeatDivisor: number;
  version: number;
}

export function settingsToWire(d: SettingsDoc): SettingsWire {
  return {
    days: d.days,
    timeRanges: [...d.timeRanges].sort((a, b) => a.order - b.order),
    slotCapacity: d.slotCapacity,
    emptySeatDivisor: d.emptySeatDivisor,
    version: d.version,
  };
}

export interface AuditWire {
  id: string;
  at: string;
  userName: string;
  action: string;
  target: string;
  targetId: string | null;
  summary: string;
}

/** before/after are intentionally not exposed — the summary is what people read. */
export function auditToWire(d: AuditLogDoc): AuditWire {
  return {
    id: d._id.toHexString(),
    at: d.at.toISOString(),
    userName: d.userName,
    action: d.action,
    target: d.target,
    targetId: d.targetId,
    summary: d.summary,
  };
}
