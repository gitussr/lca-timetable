# §55 — Definition of Done

Assessed against evidence, not intent. Where something is verified by a suite,
the suite is named; where it is verified by hand, that is said; where it is not
done, it says so.

**Legend:** ✅ done and tested · 🔍 done, verified by hand · ⏳ blocked · ⚠️ caveat

---

## Design and themes

| | Item | Evidence |
|---|---|---|
| ✅ | Existing visual design is preserved | `check:render` — 55 assertions diffing the rendered page against the frozen original |
| ✅ | Five themes still work | `check:themes` — names, tokens, contrast 5.43–6.43:1 |
| ✅ | Responsive behaviour preserved | Breakpoints carried over verbatim; ⚠️ see below |

⚠️ **Mobile widths are a hand check, not an automated one.** The browser
automation available here could not size a window below ~500px, so the sub-480px
path — where the original suppresses icons — was reasoned about and inspected in
the CSS, not screenshotted. Worth one look on a real phone.

## Authentication and roles

| | Item | Evidence |
|---|---|---|
| ✅ | Login works | `check:security`, `check:edge` |
| ✅ | Individual users exist | `create:admin`, `/api/users` |
| ✅ | RBAC works | `check:api` — every role × every endpoint |
| ✅ | Admin / Editor / Viewer permissions | `check:api`, plus per-field settings permissions |
| ✅ | Server-side authorization | `check:api` calls endpoints directly as an under-privileged user |
| ✅ | Validation works | `check:schemas` (42), `check:api` |
| ✅ | Security review completed | `docs/phase-12-security-performance.md`, `check:security` (51) |

## Data

| | Item | Evidence |
|---|---|---|
| ✅ | MongoDB Atlas stores application data | ⏳ verified against a local replica set; Atlas awaits the credential |
| ✅ | MongoDB credentials are server-side only | `check:bundle` greps the built client assets |
| ✅ | Students / courses / timetable / footer are database-driven | `check:render` — no legacy data left in the markup |
| ✅ | Course month numbers preserved | `check:render` — footer entries match character for character |
| ✅ | Basic Computer standards structured | `studentClass` split out; `check:api` proves it survives a partial update |
| ✅ | Course icons are data-driven | `check:render` |
| ✅ | Web Dev 3 days/2h, Basic Computer 2 days/1.5h | Seeded as course defaults |
| ✅ | Individual schedule times supported | ⚠️ see D2 below |
| ✅ | 5 PM / 5:30 PM schedules work | The `(5pm)` labels became real times — that is what took 4 columns to 6 |
| ✅ | Existing data migrated | 16 students, 41 assignments, reconciled |

## Timetable behaviour

| | Item | Evidence |
|---|---|---|
| ✅ | Four fixed time-slot limitation removed | `check:api`; driven live in the UI in phase 8 |
| ✅ | Time ranges can be added | Settings panel; verified live — grid went to 7 columns with no reload |
| ✅ | Time ranges can be removed safely | Refused while occupied, with a count; allowed when empty |
| ✅ | Students can be added / edited / removed | `check:api`, `check:edge` |
| ✅ | Schedule assignments changed and cleared | `check:api` — clearing removes 1 schedule and 0 students |

## Collaboration

| | Item | Evidence |
|---|---|---|
| ✅ | Multiple users can edit simultaneously | `check:edge` |
| ✅ | Realtime updates work | `check:edge` opens an SSE stream and reads the event off the wire |
| ✅ | Concurrent edits handled safely | 409 with the winning state; verified for students *and* schedules |
| ✅ | Audit information recorded | `check:api` |

## Delivery

| | Item | Evidence |
|---|---|---|
| ✅ | Local development works | This is how everything above was tested |
| ✅ | README updated | `README.md` |
| ✅ | No secrets committed | `.gitignore` covers `.env*` and `master-prompt.md`; every phase ended with a credential sweep |
| ⏳ | **Vercel deployment works** | Prepared, not performed — see below |

---

## What is genuinely not done

### ⏳ The Atlas credential

The one printed in `master-prompt.md` §1 is compromised by having been written
down. Everything was therefore built and tested against a local MongoDB replica
set, which is functionally equivalent — including change streams.

**Remaining work:** rotate it, set the environment variables, then
`ensure-indexes`, `seed`, `create:admin`. `npm run preflight` refuses the leaked
credential by name.

### ⏳ D2 — Bihan Kundu's Monday class

The original page places him in the **18:00–20:00** column and labels him
**5pm**. The source contradicts itself, and no amount of reading it will settle
which is right.

`scripts/seed-data.json` carries the extracted value with a `review` field
explaining the conflict, and **`seed` refuses to run** until it is resolved or
explicitly overridden. This is the only thing preventing the seed data from
being called authoritative.

### ⏳ D7 — the `data-d` attribute

The original footer marked every student `data-d="d"` (rendered in the accent
colour) **except Surajit Paul**, whose `data-d=""` rendered in the default
colour. The flag is undocumented and its meaning unknown, so it was not
migrated — all roster entries currently render in the accent colour, matching 15
of the 16.

Nothing is broken by this. It needs someone who knows what the flag meant.

### ⚠️ Deployment-time unknowns

- **Function duration limits vary by hosting plan**, and I could not confirm the
  per-plan cap from the documentation available. `STREAM_LIFETIME_SECONDS` and
  `vercel.json`'s `maxDuration` are both configurable; `docs/deployment.md` §5
  says what to check and what happens if it is wrong (a slightly less tidy
  reconnect, not lost data).
- **Atlas Network Access** will likely need `0.0.0.0/0`, since Vercel functions
  have no fixed IPs. That makes the database password the only thing protecting
  the data.

### ⚠️ Known trade-offs, decided deliberately

- **Signing out is not server-side revocation.** Under the JWT strategy the
  token stays valid until it expires; logout clears it from the browser. The
  case that matters — an admin deactivating an account — *does* take effect
  immediately, and is tested.
- **Two active students cannot share a name.** A unique index enforces §20's
  "a student should exist only once", and the seed relies on name as the natural
  key. Removing a student frees their name.
- **Column headers read 24-hour** (`12:30–14:30`, not `12:30–02:30`). The
  original's 12-hour-without-meridiem format becomes ambiguous once columns are
  dynamic. One line to revert if the academy prefers it.
- **Realtime is sized for ~5–20 concurrent editors**, one held-open invocation
  and one Atlas cursor each. Right for an institute; wrong for thousands.
