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
| ✅ | MongoDB Atlas stores application data | Live on Atlas — replica set `atlas-xgye96-shard-0`, 9 indexes, seeded 16/41/2. ⚠️ the suites still run against a local mongod — see below |
| ✅ | MongoDB credentials are server-side only | `check:bundle` greps the built client assets |
| ✅ | Students / courses / timetable / footer are database-driven | `check:render` — no legacy data left in the markup |
| ✅ | Course month numbers preserved | `check:render` — footer entries match character for character |
| ✅ | Basic Computer standards structured | `studentClass` split out; `check:api` proves it survives a partial update |
| ✅ | Course icons are data-driven | `check:render` |
| ✅ | Web Dev 3 days/2h, Basic Computer 2 days/1.5h | Seeded as course defaults |
| ✅ | Individual schedule times supported | `check:api`; the `(5pm)` annotations became real times — D2, resolved |
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
| ✅ | **Vercel deployment works** | Live 2026-09-11 at `lca-timetable-web-devs-projects-d28f23dd.vercel.app` — builds in ~31s, connects to Atlas, seeded, admin created, sign-in reaches the database |

---

## Settled since the last pass

### ✅ D2 — Bihan Kundu's Monday class (2026-09-10)

The original page placed him in the **18:00–20:00** column and labelled him
**5pm**. Settled in favour of the label — **17:00–18:30** — matching his
Thursday class and the 90-minute Basic Computer default.

The decision lives in `RESOLUTIONS` in `scripts/extract-legacy.ts`, not in
`seed-data.json`, because that file is regenerated and a hand-edit to the output
would be silently undone. No entry awaits review, `seed` no longer refuses to
run, and **the seed data is authoritative**.

### ✅ Atlas Network Access (resolved 2026-09-11)

Every database call used to fail, from Vercel and from a developer machine
alike, with the same error:

```
MongoServerSelectionError: ... tlsv1 alert internal error ... SSL alert number 80
```

Atlas accepts the TCP connection and then aborts the TLS handshake **without
returning a certificate**. That is its signature for a client IP that is not on
the access list — it is not DNS (the SRV record resolves to three nodes of
replica set `atlas-xgye96-shard-0`), not the credential (authentication happens
after TLS), and not a corporate proxy (one would present its own certificate).

Fixed by allowing `0.0.0.0/0` — Vercel functions have no fixed IPs. It takes
about a minute to go Active; the first connection attempt after saving still
failed, the next one succeeded.

**This makes the database password the only thing protecting the data**, which
is why the item below matters more than it did before.

A second failure hid behind this one and outlived it: `lib/db.ts` cached the
connection *promise*, rejected ones included, so the instance that started while
the access list was closed kept re-throwing that first failure and never
retried. Opening the list changed nothing until that was fixed. See the commit
"Never cache a rejected connection promise".

## What is genuinely not done

### ⚠️ The suites cannot be run against Atlas, by design

`reset-test-db` drops a database, so it carries two guards: the name must
contain `test`, **and** the host must not be Atlas ("Refusing to run against an
Atlas cluster. Use a local mongod."). Attempted on 2026-09-11 with
`MONGODB_DB=lca_test` and refused at the second guard — correctly.

So `api`, `edge`, `render`, `security` and `themes` remain verified against a
local replica set, not against Atlas. `schemas` (42) and `bundle` (9) need no
database and were re-run green after the connection fix. Production document
counts were recorded before and after the attempt and are identical; no
`lca_test` database was created.

What this left unverified on Atlas was **realtime**, and it has since been
verified at the database layer directly: a `db.watch()` against the production
cluster — the same call `/api/stream` makes — delivered an insert event in
**422ms** with a resume token, and the probe collection was dropped afterwards.
So the cluster delivers change events to this credential, and `check:edge`
proves the app's SSE wiring consumes them.

What is still untested is only the two composed in production: two browsers open
on the deployed site, an edit in one appearing in the other. Worth one look. The
connection badge must not read "Live updates unavailable".

### ⏳ The leaked credential is still in use

`MONGODB_URI` still names `ranjitkarmakar1678_db_user` — the username printed in
`master-prompt.md` §1, and therefore public. The password has been changed; the
username has not. **Deferred deliberately by the academy on 2026-09-11** to get
the site live first.

Closing it means creating a *new* database user in Atlas, deleting the published
one, and updating `MONGODB_URI` in both `.env.local` and the Vercel project
(Production and Preview). `npm run preflight` fails until this is done, and says
so in those terms.

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
  the `maxDuration` export in `app/api/stream/route.ts` are both configurable;
  `docs/deployment.md` §5 says what to check and what happens if it is wrong (a
  slightly less tidy reconnect, not lost data).
- **Vercel Authentication was on**, putting the whole site behind Vercel SSO —
  every route 302'd to `vercel.com/sso-api`. Disabled on 2026-09-11 so the
  academy can reach it. Safe: the app requires its own login, there is no signup
  route, and accounts are created only by `create:admin`.

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
