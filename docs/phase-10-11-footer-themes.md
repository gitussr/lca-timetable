# Phases 10 & 11 — footer and themes

Phase 10 (footer) was already satisfied by phase 6, so this folds its audit into
phase 11 rather than repeating the work.

## Phase 10 — the footer is one source of truth (§19, §20)

The legacy page kept **two hand-synchronised copies** of every student: one in
the grid, one in the footer. Nothing but diligence kept them in step, and the
first missed edit would have desynchronised them silently.

`RosterFooter` renders from the same `students` array the grid uses.
`buildRoster` groups it by course, then cohort (decision D1), so a new cohort
appears without a code change. Nothing about the footer is hard-coded to
"Web Dev (Old)".

Asserted by `npm run check:render`:

- every footer section label matches the legacy page **verbatim**, in the legacy
  order (`Web Dev (Old)`, `Web Dev (New)`, `Basic Computer`);
- every entry matches character for character, including `Samrit Paul(std.8) (29)`;
- no student in the grid is missing from the roster;
- the roster totals 16.

Verified live in phase 9 too: an edit made from another session changed the
footer to "Indrani Debnath (12)" with no reload — one array, two views.

## Phase 11 — the five themes (§6)

All five survive with their exact names: Midnight Pro, Violet Glass, Deep Ocean,
Cyber Lime, Graphite Ember. The token blocks in `globals.css` are untouched from
the legacy stylesheet, and every rule added since — the editing affordances, the
popover, the settings panel, the connection badge — consumes those same
`[data-theme]` custom properties. There is no second palette to keep in step.

Measured across all five, on the most-read text on the page (a student name on
its chip):

| Theme | `--primary` | Contrast |
|---|---|---|
| Midnight Pro | `#5b6eff` | 5.43:1 |
| Violet Glass | `#a855f7` | 6.10:1 |
| Deep Ocean | `#0ea5e9` | 6.04:1 |
| Cyber Lime | `#a3e635` | 6.43:1 |
| Graphite Ember | `#f97316` | 6.28:1 |

All above the 4.5:1 WCAG AA threshold for normal text (§46).

### What is new: the choice follows the account

The legacy app stored the theme in `localStorage`, so it lived in one browser.
It now saves to the user record, and `check:themes` proves it travels: set a
theme, sign in from a **fresh cookie jar with no localStorage**, and the page
comes back themed.

The theme is stamped onto `<html>` during the **server** render, so the page
paints correctly with no flash. The `localStorage` script is still shipped, but
only as a fallback for the login screen — which has no session to read — and it
defers to an attribute already present, so it can never override the account.

### The bug this phase found

`preferredTheme` was being read from the **session token**, which is a snapshot
taken at sign-in. Saving a new theme wrote the database but not the token, so
reloading in the same session silently reverted, and the choice only took effect
after signing in again.

Every check in the suite passed while this was broken, because each one signed
in fresh — which is exactly what rebuilds the token. It was only visible by
changing the theme in a real browser and pressing reload.

`lib/viewer.ts` now reads `preferredTheme` from the database, wrapped in React's
`cache` so the layout and the page share a single indexed lookup per request.
Role still comes from the token, which is the point of putting it there: it
changes essentially never, and a lookup per request would be pure overhead
(§47). There is now a regression check that changes the theme and reloads
**without re-authenticating**.
