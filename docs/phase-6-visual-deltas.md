# Phase 6 — what changed on screen, and why

§5 asks for the design to be preserved almost exactly. It is, and
`npm run check:render` asserts that against the frozen legacy page (41 checks:
same students on the same days, same footer wording, same grid scaffolding,
same theme markup).

Everything below is a deliberate, named difference. Anything NOT on this list
that differs is a bug.

## Data-driven consequences

**Four timetable columns became six.** The `(5pm)` / `(5:30pm)` labels became
real `startTime` values (decision D2), so `17:00–18:30` and `17:30–19:00` are
now columns of their own instead of students mislabelled inside the 16:00
column. This is the §15 requirement being met, not a layout change.

**Column headers read 24-hour.** The legacy headers were 12-hour with no
meridiem — `12:30–02:30` meant 12:30–14:30. That was survivable with four known
columns; with dynamic ranges it is genuinely ambiguous, since a new `09:00`
column and a `21:00` one would render identically. The digits, font, separator
and layout are unchanged. **This is the one judgement call worth revisiting** —
it is a one-line change in `TimetableGrid` if the academy prefers the old look.

**"Empty Seats" went from 26+ to 46+.** The formula is preserved exactly
(D4: `floor((capacity − assigned) / 3)`, divisor now in settings). Capacity is
`days × ranges × slotCapacity`, and ranges went 4 → 6, so capacity rose from
120 to 180 while assignments stayed at 41.

**Five students gained a laptop icon.** Icons are now driven by `course.icon`
(decision D3, §42). The legacy page assigned them by hand and missed Anish
Gharami, Soumik Dutta, Surajit Paul, Somen Biswas and Subhashish Raha.

## Deliberate improvements

**The login screen is a real login.** Individual accounts replace the shared
`LCA1234` literal. The triple-tap-the-logo backdoor and the forgeable
`localStorage.lca_authed` flag are gone. "Lock screen" is now "Sign out" because
it now ends a session rather than hiding a div.

**The logo is self-hosted.** The legacy page pulled it from Google's favicon
scraper, which 302s to `t2.gstatic.com`; behind the CSP added in §30 the
redirect target was blocked and the mark failed to load. It now uses LCA's own
`icon-192x192.png`, which also removes a runtime dependency on a third party.

**Footer sections are keyboard-operable.** The legacy `<summary>` had a click
handler only, so the roster could not be opened without a mouse (§46). They are
now buttons with `aria-expanded`.

**Long names truncate before their icon.** `.slot li.laptop` and friends reserve
the icon's width, so a name ellipsises rather than running underneath the glyph.
The legacy page had the same collision at ~500px ("Sabita Mondal" over its mouse
icon); six columns simply hit it more often than four. Written with `.slot li`
in the selector on purpose — the breakpoints re-declare `.slot li { padding }`,
whose specificity silently beats a bare `.laptop`.

## Known tightness

At around 500px with six columns each cell is ~57px wide, so every name
ellipsises. Verified: zero text/icon collisions and no horizontal page scroll.
Each entry carries a `title`, so the full name is available on hover or
long-press. Below 480px the legacy CSS suppresses icons entirely and the names
get that space back.

## Still open

The legacy footer marked every student `data-d="d"` (which renders in the accent
colour) **except Surajit Paul**, whose `data-d=""` renders in the default
colour. The flag is undocumented and its meaning is unknown, so it was not
migrated — all roster entries currently render in the accent colour, which
matches 15 of the 16. **Decision D7: what did `data-d` mean?** If it matters, it
needs a name and a field; if it was a typo, nothing is lost.
