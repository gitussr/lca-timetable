# Phase 8 — dynamic time ranges

§15 and §40 ask for the four fixed columns to stop being a limitation: an
administrator or editor must be able to introduce a new time range **without
modifying source code**.

## What the limit used to be

The legacy page hard-coded the number four in three places:

1. `styles.css` — `grid-template-columns: 92px repeat(4, …)`, in the base rule
   and in all three breakpoints;
2. `index.html` — five `.header-row` divs;
3. `script.js` — a four-entry `timeSlots` array, plus
   `allSlots[dayIndex * 4 + i]` index arithmetic.

Adding a fifth column meant editing all three, and forgetting the third broke
the today/live highlight **silently and wrongly** rather than visibly.

## What replaced it

Columns come from `settings.timeRanges`. The grid renders whatever that array
holds, the count reaches the CSS through `--slot-cols`, and the highlight
resolves against the ranges themselves rather than by index arithmetic. The
settings panel (edit mode → sliders button) edits that array.

**Verified live**, driving the real UI against a real database:

| Step | Result |
|---|---|
| Add `20:00–21:30` in the panel | grid went to 7 columns, 42 cells, `--slot-cols: 7`, no reload |
| Empty-seat header | 46+ → 56+ as capacity grew |
| Remove `17:30–19:00` (1 class in it) | **refused**: "1 class still sits in 17:30–19:00. Move or clear them first." — optimistic removal rolled back |
| Remove `20:00–21:30` (empty) | removed, `order` reindexed 0–5 |
| Persistence | `settings` version 0 → 2, both changes in the audit log |

## Why an empty column can exist

This is the reason `timeRanges` lives in `settings` rather than being derived
purely from schedules (§16). A derived-only column set cannot represent a range
**nobody occupies yet** — a newly added column would be invisible until someone
was assigned to it, which is backwards. Storing the display columns as an
ordered array in the single settings document solves that without a second
collection, a second source of truth, or a join. Schedules still carry their own
times and remain authoritative.

## Who may change what

Per-field, enforced server-side (§7, §8):

| Section | Editor | Admin |
|---|---|---|
| Columns (time ranges) | ✅ | ✅ |
| Days the academy runs | ❌ | ✅ |
| Rows per cell, empty-seat divisor | ❌ | ✅ |
| Courses | ❌ | ✅ |

Adding a column is ordinary timetable work, so editors do it. Everything else is
application configuration. Confirmed at both layers: the editor's panel renders
only the Columns section, and a direct `PATCH /api/settings` with `days` returns
**403 — "Changing days needs the admin role. You have editor."**

## Courses

The panel edits `defaultDuration`, `sessionsPerWeek` and `icon` per course
(§21's "modify course information", §42's data-driven icons). These are
**defaults for new classes, not constraints on existing ones** — the panel says
so, because §41 makes a student's own schedule authoritative. Sabita Mondal
attends six days against a two-day default and that is legitimate data.

Deleting a course names how many students still take it and lets the server
refuse, rather than orphaning references (§22).

## Still open

Reordering columns by hand is not possible — the list sorts by start time, which
is what a timetable wants. If a range ever needs to sit out of chronological
order, `order` already exists in the schema to support it.

---

## Bug found afterwards, in phase 9

The course editor here writes single fields — change the duration, leave
everything else. That path was broken: `updateCourseInput` was
`createCourseInput.partial()`, and **`.partial()` does not remove `.default()`**,
so a PATCH of `{ defaultDuration }` parsed into
`{ defaultDuration, shortName: null, order: 0 }` and silently wiped the footer
label and section order this phase depends on.

The same trap hit `updateStudentInput`, where it erased `studentClass` (the
school standard, §13) and `cohort` (D1) on every unrelated student edit.

Both schemas are now written longhand with `.optional()`, and there are
regression checks at two levels: `check:schemas` asserts a partial parse yields
only the keys that were sent, and `check:api` asserts `studentClass` and
`shortName` actually survive a real round trip.
