/**
 * Shared vocabulary. Everything the legacy app hard-coded in markup, CSS and
 * three places in script.js lives here as one named value — so §54's
 * "no magic strings" holds and there is exactly one thing to change.
 */

/** Days the academy runs. Sunday is absent by design (§18). */
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export type Day = (typeof DAYS)[number];

/** Roles, ordered least → most privileged. Order is load-bearing: see rankOf(). */
export const ROLES = ['viewer', 'editor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

const ROLE_RANK = new Map<Role, number>(ROLES.map((r, i) => [r, i]));

/** True when `role` is at least as privileged as `required`. Used by withRole(). */
export function roleAtLeast(role: Role, required: Role): boolean {
  return (ROLE_RANK.get(role) ?? -1) >= (ROLE_RANK.get(required) ?? Infinity);
}

/**
 * Course icons. Stored as these keys, never as markup (§11, §42).
 * `plane` is carried over because plane.svg and a styled `.plane` rule exist in
 * the legacy CSS with no element using them — keeping the key costs nothing and
 * preserves the option.
 */
export const COURSE_ICONS = ['laptop', 'mouse', 'plane'] as const;
export type CourseIcon = (typeof COURSE_ICONS)[number];

/** The five legacy themes (§6). Values match the CSS [data-theme] selectors. */
export const THEMES = ['theme1', 'theme2', 'theme3', 'theme4', 'theme5'] as const;
export type Theme = (typeof THEMES)[number];

/**
 * Cohort — resolves D1. The footer's "Web Dev (Old)" / "Web Dev (New)" split is
 * a cohort of one course, not two courses. Basic Computer students have none.
 */
export const COHORTS = ['old', 'new'] as const;
export type Cohort = (typeof COHORTS)[number];

/** Fallbacks used only when the settings document is missing a field. */
export const DEFAULT_SLOT_CAPACITY = 5;

/**
 * Resolves D4. The legacy empty-seat readout was
 * `floor(count(empty <li>) / 3)`; the divisor was never explained. Preserved
 * exactly, but lifted into settings so it is tunable without a deploy.
 */
export const DEFAULT_EMPTY_SEAT_DIVISOR = 3;

/** `HH:mm`, 24-hour. Matches what <input type="time"> emits. */
export const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Minutes since midnight, for comparing and sorting `HH:mm` values. */
export function toMinutes(time: string): number {
  const m = TIME_RE.exec(time);
  if (!m) throw new Error(`Invalid time: ${time}`);
  return Number(m[1]) * 60 + Number(m[2]);
}
