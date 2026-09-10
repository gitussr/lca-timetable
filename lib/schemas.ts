import { z } from 'zod';
import {
  COHORTS, COURSE_ICONS, DAYS, ROLES, THEMES, TIME_RE, toMinutes,
} from './constants';

/**
 * Server-side validation (§28). Every mutating route parses its body through
 * one of these before touching the database — client-side checks are a
 * convenience, never the boundary.
 *
 * These describe API *input*, not stored documents (see ./types.ts). Nothing
 * here accepts _id, version bumps, or timestamps: the server owns those.
 */

/** Rejects malformed ids before they reach Mongo (§30). */
export const objectId = z
  .string()
  .regex(/^[0-9a-f]{24}$/i, 'Not a valid id');

export const timeOfDay = z
  .string()
  .regex(TIME_RE, 'Time must be HH:mm on a 24-hour clock');

const trimmedName = z
  .string()
  .trim()
  .min(1, 'Name is required')
  .max(80, 'Name must be 80 characters or fewer');

/**
 * `endTime` must be after `startTime` (§28). Shared by schedules and time ranges.
 *
 * The guard matters: Zod 4 still runs object-level refinements after a field
 * check has already failed, so this receives values like `"5pm"` that never
 * passed `timeOfDay`. `toMinutes` throws on those, which surfaced as a 500
 * instead of a 400. The field-level error is already reported, so bail quietly.
 */
function endAfterStart<T extends { startTime: string; endTime: string }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if (!TIME_RE.test(value.startTime) || !TIME_RE.test(value.endTime)) return;

  if (toMinutes(value.endTime) <= toMinutes(value.startTime)) {
    ctx.addIssue({
      code: 'custom',
      path: ['endTime'],
      message: 'End time must be after start time',
    });
  }
}

/* ------------------------------------------------------------------ auth */

export const loginInput = z.object({
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password: z.string().min(1, 'Password is required'),
  rememberMe: z.boolean().default(false),
});

/**
 * Length over composition rules — long passphrases beat short scrambles, and
 * character-class requirements mostly produce Password1!.
 */
const password = z
  .string()
  .min(12, 'Password must be at least 12 characters')
  .max(200, 'Password must be 200 characters or fewer');

/* ----------------------------------------------------------------- users */

export const createUserInput = z.object({
  name: trimmedName,
  email: z.email('Enter a valid email address').trim().toLowerCase(),
  password,
  role: z.enum(ROLES),
});

export const updateUserInput = z
  .object({
    name: trimmedName.optional(),
    email: z.email('Enter a valid email address').trim().toLowerCase().optional(),
    password: password.optional(),
    role: z.enum(ROLES).optional(),
    active: z.boolean().optional(),
    version: z.number().int().nonnegative(),
  })
  .refine(
    (v) => Object.keys(v).some((k) => k !== 'version'),
    'No changes supplied',
  );

/** A viewer may change their own theme and nothing else. */
export const updateMyThemeInput = z.object({
  preferredTheme: z.enum(THEMES).nullable(),
});

/* --------------------------------------------------------------- courses */

export const createCourseInput = z.object({
  name: trimmedName,
  /** Footer label; falls back to `name` when absent. */
  shortName: z.string().trim().min(1).max(40).nullable().default(null),
  /** Footer section order; lower first. */
  order: z.number().int().min(0).max(100).default(0),
  /** Minutes. 15 minutes to a 12-hour day. */
  defaultDuration: z.number().int().min(15).max(720),
  sessionsPerWeek: z.number().int().min(1).max(DAYS.length),
  icon: z.enum(COURSE_ICONS),
});

/** Longhand for the same reason as updateStudentInput — see the note there. */
export const updateCourseInput = z.object({
  name: trimmedName.optional(),
  shortName: z.string().trim().min(1).max(40).nullable().optional(),
  order: z.number().int().min(0).max(100).optional(),
  defaultDuration: z.number().int().min(15).max(720).optional(),
  sessionsPerWeek: z.number().int().min(1).max(DAYS.length).optional(),
  icon: z.enum(COURSE_ICONS).optional(),
  active: z.boolean().optional(),
  version: z.number().int().nonnegative(),
});

/* -------------------------------------------------------------- students */

export const createStudentInput = z.object({
  name: trimmedName,
  courseId: objectId,
  cohort: z.enum(COHORTS).nullable().default(null),
  /** School standard as shown, e.g. "8" (§13). Free text — some are "KG". */
  studentClass: z.string().trim().min(1).max(20).nullable().default(null),
  /**
   * Running course month — a DURATION, not an ID (§12). Never auto-incremented.
   * 600 is fifty years; the cap exists to catch a mistyped ID, not to model reality.
   */
  courseMonth: z.number().int().min(0).max(600),
});

/**
 * Written out longhand rather than as `createStudentInput.partial()`.
 *
 * `.partial()` makes fields optional but does NOT remove `.default()`, so a
 * PATCH body of `{ courseMonth, version }` parsed through the partial create
 * schema comes out as `{ courseMonth, version, cohort: null,
 * studentClass: null }` — and the handler then writes those nulls, silently
 * erasing the school standard (§13) and the cohort (D1) on every unrelated
 * edit. Absent must mean "leave alone", which only `.optional()` gives.
 */
export const updateStudentInput = z.object({
  name: trimmedName.optional(),
  courseId: objectId.optional(),
  cohort: z.enum(COHORTS).nullable().optional(),
  studentClass: z.string().trim().min(1).max(20).nullable().optional(),
  courseMonth: z.number().int().min(0).max(600).optional(),
  active: z.boolean().optional(),
  version: z.number().int().nonnegative(),
});

/* ------------------------------------------------------------- schedules */

export const createScheduleInput = z
  .object({
    studentId: objectId,
    day: z.enum(DAYS),
    startTime: timeOfDay,
    endTime: timeOfDay,
  })
  .superRefine(endAfterStart);

export const updateScheduleInput = z
  .object({
    day: z.enum(DAYS).optional(),
    startTime: timeOfDay.optional(),
    endTime: timeOfDay.optional(),
    version: z.number().int().nonnegative(),
  })
  .superRefine((v, ctx) => {
    // Only comparable when both ends are being set together.
    if (v.startTime && v.endTime) endAfterStart({ startTime: v.startTime, endTime: v.endTime }, ctx);
    if ((v.startTime === undefined) !== (v.endTime === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['startTime'],
        message: 'Change start and end together, so the pair can be validated',
      });
    }
  });

/* -------------------------------------------------------------- settings */

export const timeRangeInput = z
  .object({
    id: z.string().trim().min(1).max(40),
    startTime: timeOfDay,
    endTime: timeOfDay,
    order: z.number().int().min(0).max(100),
  })
  .superRefine(endAfterStart);

export const updateSettingsInput = z
  .object({
    days: z.array(z.enum(DAYS)).min(1).optional(),
    timeRanges: z.array(timeRangeInput).max(24).optional(),
    slotCapacity: z.number().int().min(1).max(20).optional(),
    emptySeatDivisor: z.number().int().min(1).max(10).optional(),
    version: z.number().int().nonnegative(),
  })
  .superRefine((v, ctx) => {
    if (!v.timeRanges) return;
    const seen = new Set<string>();
    v.timeRanges.forEach((r, i) => {
      const key = `${r.startTime}-${r.endTime}`;
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['timeRanges', i],
          message: `Duplicate time range ${r.startTime}–${r.endTime}`,
        });
      }
      seen.add(key);
    });
    if (new Set(v.timeRanges.map((r) => r.id)).size !== v.timeRanges.length) {
      ctx.addIssue({ code: 'custom', path: ['timeRanges'], message: 'Time range ids must be unique' });
    }
  });

/* ------------------------------------------------------------------ misc */

export const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: objectId.optional(),
});

export type LoginInput = z.infer<typeof loginInput>;
export type CreateUserInput = z.infer<typeof createUserInput>;
export type UpdateUserInput = z.infer<typeof updateUserInput>;
export type CreateCourseInput = z.infer<typeof createCourseInput>;
export type UpdateCourseInput = z.infer<typeof updateCourseInput>;
export type CreateStudentInput = z.infer<typeof createStudentInput>;
export type UpdateStudentInput = z.infer<typeof updateStudentInput>;
export type CreateScheduleInput = z.infer<typeof createScheduleInput>;
export type UpdateScheduleInput = z.infer<typeof updateScheduleInput>;
export type TimeRangeInput = z.infer<typeof timeRangeInput>;
export type UpdateSettingsInput = z.infer<typeof updateSettingsInput>;
