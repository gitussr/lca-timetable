# Phase 7 — editing

Editing is a **mode on the existing timetable**, not a separate screen (§21,
§38, §39). The grid stays the primary view, the same cells are the targets, and
the two controls sit beside the theme switcher — a spot the design already uses
for floating chrome, so the grid layout is untouched.

Nothing is `contenteditable`. Every change goes through a controlled form, and
each form action maps to exactly one API call.

## How it works

**Enter edit mode** — pencil button, bottom right. Only rendered for editors and
admins; the server refuses regardless of what the browser renders (§8).

**Click a student** → move to another day/time, edit their details, clear the
class, or (admin only) remove the student.

**Click an empty slot** → add an existing student, or create a new one and drop
them straight into that slot.

**Click a roster name in the footer** → edit that student's details.

Popovers are anchored to what you clicked, so the row being edited stays visible
behind them. They are proper modals for assistive tech: `role="dialog"`,
labelled, focus moved in and restored on close, Escape closes, Tab is trapped.

## Optimistic, with real rollback

`lib/use-timetable.ts` applies every change locally first, then asks the server.
On refusal it restores the exact prior snapshot and shows why (§25). On a 409 it
additionally re-reads everything, so the UI ends up showing the change that
actually won rather than either the rejected edit or the stale original (§24).

Verified end to end against a live database:

| Check | Result |
|---|---|
| Move a class | persisted, `version` 0 → 1, audit: "moved Arnab Roy from Mon 17:30–19:00 to Sat 16:00–18:00" |
| Concurrent edit | second writer's value survived; stale write refused with 409 |
| After the 409 | UI refreshed to the winning value (77), not the rejected one (42) nor the original (9) |
| Clear a class | schedule gone, student still active, other class kept, audited `schedule.clear` |
| Viewer UI | 0 edit buttons, 0 clickable cells |
| Viewer API | direct `POST /api/schedules` → **403** |

## Save status

One line, bottom centre: `Saving…` → `Saved`, or the failure with a dismiss
(§44). Deliberately not a spinner over the grid — the optimistic update already
put the change on screen, so the only thing worth reporting is whether it stuck.

## Destructive actions

Both confirmations name the thing and state the consequence before it happens
(§45), and the wording carries §22's distinction:

> Clear **Unnayan Deb** from Wed 16:00–18:00? They stay on the roster and keep
> their other classes.

> Remove **Arnab Roy** from the academy? This also removes their 2 class
> assignment(s).

## Styling

All editing styles live in `app/edit.css`, separate from `globals.css` — which
remains the legacy stylesheet carried over. Nothing in it restyles an existing
element; every rule is scoped under `.editing` or to a new class, so **view mode
renders identically to phase 6**. Colours come from the same `[data-theme]`
custom properties, so all five themes apply without a second palette.

## Not in this phase

- **Adding and removing time ranges** is phase 8, alongside the settings UI.
- **Course and user management** (§21's "modify course information") is admin
  configuration rather than timetable work; the APIs exist and are tested, the
  UI lands with phase 8's settings panel.
