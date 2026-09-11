# Phase 1 — Technical Assessment

**LCA Timetable → database-driven collaborative application**
Assessment date: 2026-09-10
Source audited: `github.com/learncomputeracademy/time` @ `b46bb24` (HEAD, single commit on `main`)
Target repo: `github.com/gitussr/lca-timetable` — **exists, currently empty (no commits)**

No changes were made to the source repository. This document is analysis and proposal only.

---

## 0. Blocking issue — leaked database credential

`master-prompt.md` §1 instructs that the MongoDB connection string must never be committed or exposed, and then prints a live one containing a database username and its password.

That file currently sits in the project directory. Treat the credential as compromised:

1. Rotate the password in MongoDB Atlas (Database Access → Edit user → Edit Password).
2. Replace the block in `master-prompt.md` with `MONGODB_URI=` (placeholder only).
3. Put the new URI in `.env.local` (gitignored) and in Vercel Environment Variables.
4. Restrict the Atlas Network Access list rather than leaving `0.0.0.0/0` open.

**Phase 3 cannot safely begin until this is rotated.** Nothing in this assessment used or stored the credential.

---

## 1. Current architecture

A static, client-rendered site with no backend of any kind.

```
Browser
  └── index.html   ← all timetable + roster data lives here, as markup
      ├── styles.css
      └── script.js  ← clock, highlight, theme, "login"
```

Hosted on GitHub Pages (`CNAME` → `time.computercenter.in`). There is no server, no database, no API, and no build step.

The editing workflow today is *editing HTML by hand and committing*. The repository's only commit message — "Remove 'Rudra Pratap Biswas' from index.html" — is literally a roster change performed as a source-code edit. This is the workflow the migration replaces.

## 2. Existing files

| File | Size | Role |
|---|---|---|
| `index.html` | 11.6 KB | Login gate, theme panel, header, 6×4 timetable grid, footer roster. **All data.** |
| `styles.css` | 19.2 KB, 698 lines | Design tokens for 5 themes, login, header, grid, footer, 3 responsive breakpoints |
| `script.js` | 9.0 KB, 276 lines | Access-code gate, clock, empty-seat count, roster toggles, today/live highlight, theme switcher |
| `laptop.svg`, `mouse.svg` | 516 B, 395 B | Course icons, applied via CSS `background-image` |
| `plane.svg`, `plane-alt.svg` | 1.5 KB, 1.1 KB | **Unused.** `.plane` is styled in CSS but no element uses it — evidence of a third course that existed or was planned |
| `icon-{192,256,384,512}.png` | 12–45 KB | PWA icons |
| `manifest.webmanifest` | 930 B | **Never referenced** — `index.html` has no `<link rel="manifest">`, so the PWA is inert. Its `scope`/`start_url` also point at `learncomputeracademy.github.io`, not the `CNAME` domain |
| `CNAME` | 22 B | `time.computercenter.in` |

## 3. Existing dependencies

All external, all unpinned or third-party:

| Dependency | Source | Note |
|---|---|---|
| Google Fonts | `fonts.googleapis.com` | Space Grotesk 500–700, Inter 400–700, JetBrains Mono 400–700 |
| Bootstrap Icons 1.13.1 | `cdn.jsdelivr.net` | Version-pinned. Used for `bi-palette`, `bi-eye`, `bi-clock`, `bi-check`, `bi-arrow-right`, `bi-box-arrow-right` |
| **robotBlocker.js** | `cdn.jsdelivr.net/gh/amartadey/robotBlocker@main` | **Supply-chain risk.** Pinned to a branch, not a tag or commit — whoever controls that repo can change the code executing on this page at any time. Also placed after `</body>`, outside valid document structure |
| Favicon | `res.cloudinary.com/learncomputeracademy` | |
| Logo images | `google.com/s2/favicons?domain_url=learncomputer.in` | Google's favicon scraper used as an image CDN; brittle |

No package manager, no `package.json`, no build tooling.

## 4. Existing UI structure

```
body
├── #loginScreen .login-screen        ← access-code gate
│   └── .login-card → .login-mark, .login-title, #loginForm
│                     (#passwordInput, #togglePw, #rememberMe, .login-btn, #loginError)
└── #app.app-hidden
    ├── .theme-switcher → #themeToggle, #themePanel
    │     └── 5 × button[data-theme] + .theme-panel-divider + #logoutBtn
    ├── header → #today, .brand-link, #empty-seats, #time
    ├── section.timetable            ← CSS grid, 5 cols × 7 rows
    │     ├── .header-row × 5        ("Days" + 4 time ranges)
    │     └── per day: .day + .slot × 4
    │           └── .slot > ul > li × 5   (students, padded with empty <li>)
    └── footer → 3 × .toggle-section (Web Dev Old / New / Basic Computer)
```

**Layout mechanics worth preserving exactly:**

- `.timetable` is `grid-template-columns: 92px repeat(4, minmax(0,1fr))` and `grid-template-rows: auto repeat(6, minmax(0,1fr))` — the **4** and the **6** are hard-coded in CSS.
- Each `.slot ul` holds exactly 5 `<li>` with `flex: 1 1 0`, so rows self-distribute. Empty `<li>` are padding that reserves vertical space. **Exception: Tuesday's 10:30 cell has only 4** — an inconsistency that makes that one cell's rows taller than its neighbours.
- Icons are CSS classes on `<li>` (`.laptop` / `.mouse`), rendered as right-aligned background images, and suppressed entirely below 480px.
- Themes are `[data-theme="theme1..5"]` blocks setting 11 CSS custom properties each (`--bg --surface --surface-2 --border --primary --secondary --accent --text --text-dim --glass --glass-border`). Every other rule consumes those variables, so **the theme system survives the migration untouched if the class names survive.**
- Breakpoints at 720px, 480px, 350px, each shrinking the day column (92 → 56 → 44 → 36px) and font sizes.

## 5. Existing data structure

There is no data structure. There are two independent, hand-synchronised copies of the roster embedded in markup.

**Reconciliation result: 16 students, 41 weekly assignments, and the two copies currently agree exactly** — no student appears in the grid but not the footer, or vice versa. That is luck and diligence, not a guarantee.

### Roster (from `<footer>`)

| Student | Group | `studentClass` | `courseMonth` | Sessions/wk |
|---|---|---|---|---|
| Srijita Karmakar | Web Dev (Old) | — | 22 | **1** ⚠ |
| Soumik Dutta | Web Dev (Old) | — | 15 | 3 |
| Subhashish Raha | Web Dev (Old) | — | 11 | 3 |
| Somen Biswas | Web Dev (Old) | — | 09 | 3 |
| Anish Gharami | Web Dev (Old) | — | 07 | 3 |
| Anushka Das | Web Dev (New) | — | 03 | 3 |
| Surajit Paul | Web Dev (New) | — | 02 | 3 |
| Samrit Paul | Basic Computer | 8 | 29 | 2 |
| Diya Das | Basic Computer | 9 | 25 | 2 |
| Arnab Roy | Basic Computer | 8 | 25 | 2 |
| Rupanjana Roy | Basic Computer | 5 | 17 | 2 |
| Debagnik Dey | Basic Computer | 6 | 08 | 2 |
| Bihan Kundu | Basic Computer | 7 | 07 | 2 |
| Indrani Debnath | Basic Computer | — | 06 | 2 |
| Unnayan Deb | Basic Computer | 7 | 03 | 2 |
| Sabita Mondal | Basic Computer | — | 02 | **6** ⚠ |

Course-default conformance (§17) is good except Srijita Karmakar (1 session, not 3) and Sabita Mondal (6 sessions, not 2). Per §41 the student schedule is authoritative, so both migrate as-is — flagged only so nobody mistakes them for extraction errors.

Note `courseMonth` is stored zero-padded in the display (`09`, `07`, `02`). It is a **number**; padding is presentation and belongs in the render layer.

### "Web Dev (Old)" vs "Web Dev (New)"

These are footer *section headings*, not distinct courses — §11 defines exactly two courses (Web Development, Basic Computer). The Old/New split is a cohort/intake distinction that correlates with `courseMonth` (Old = 7–22 months, New = 2–3 months) but isn't derivable from it reliably. See Decision **D1**.

### Time columns

Headers read `10:30–12:30`, `12:30–02:30`, `04:00–06:00`, `06:00–08:00` in 12-hour form with no AM/PM. `script.js` decodes them unambiguously as:

```
10:30–12:30   12:30–14:30   16:00–18:00   18:00–20:00
```

Those decoded 24-hour values are authoritative for migration.

### Schedule encoded inside display strings

Seven assignments carry a time annotation in the student's name — these are students who sit in a column but don't actually start when the column does:

| Day | Column | Student | Annotation |
|---|---|---|---|
| Mon | 16:00–18:00 | Arnab Roy | 5:30pm |
| Mon | 16:00–18:00 | Debagnik Dey | 5pm |
| Mon | **18:00–20:00** | Bihan Kundu | **5pm** ⚠ contradicts column |
| Tue | 16:00–18:00 | Arnab Roy | 5pm |
| Wed | 16:00–18:00 | Rupanjana Roy | 5pm |
| Thu | 16:00–18:00 | Bihan Kundu | 5pm |
| Thu | 16:00–18:00 | Rupanjana Roy | 5pm |
| Fri | 16:00–18:00 | Debagnik Dey | 5pm |

Bihan Kundu's Monday row is internally contradictory — placed in the 18:00 column, labelled 5pm. See Decision **D2**.

### Icon assignment is inconsistent

Icons today are applied by hand, and 5 of 7 Web Development students are missing theirs:

| Has `.laptop` | Missing icon (should be laptop) |
|---|---|
| Anushka Das, Srijita Karmakar | Anish Gharami, Soumik Dutta, Surajit Paul, Somen Biswas, Subhashish Raha |

All 9 Basic Computer students correctly carry `.mouse`.

Making icons data-driven from `course.icon` (§42) therefore **changes the rendered page** — five students gain a laptop icon. This is a correction, but it is a visible one. See Decision **D3**.

### Empty-seat counter

`calculateEmptySeats()` counts empty `<li>` and divides by 3: `floor((119 − 41) / 3) = 26`, displayed as "Empty Seats: 26+". The `/3` is an unexplained fudge factor and the `119` depends on how many padding `<li>` happen to exist (including Tuesday's missing one). See Decision **D4**.

## 6. Problems with the current architecture

1. **Data lives in markup.** Every roster change is a source edit, a commit, and a deploy. No non-developer can make one.
2. **The roster is duplicated.** Timetable and footer are two hand-maintained copies. They agree today; the first missed edit desynchronises them silently.
3. **Structured data is trapped in display strings.** `Samrit Paul(std.8) (29)` and `Arnab Roy (5:30pm)` mix identity, school standard, course month, and start time into one string.
4. **The four columns are hard-coded in three places** — CSS `grid-template-columns`, the five `.header-row` divs, and `script.js`'s `timeSlots` array plus its `allSlots[dayIndex * 4 + i]` index arithmetic. Adding a fifth column requires edits in all three, and forgetting the third breaks the "today"/"live" highlight **silently and wrongly**, not visibly.
5. **Cell capacity is hard-coded at five** padding `<li>`, and already inconsistent (Tuesday: four). A sixth student in one cell requires editing the markup of that cell.
6. **There is no authentication.** `ACCESS_CODE = 'LCA1234'` is a literal in client JavaScript, in a public repository, on a public site. `localStorage.lca_authed = 'true'` is the entire session mechanism — anyone can set it from the console. A triple-tap on the login logo bypasses the code outright. The gate is decoration.
7. **No roles, no audit, no concurrency control** — nothing to migrate here, all net-new (§7, §24, §26).
8. **Third-party script pinned to a moving branch** (`robotBlocker@main`) executes on every page load.
9. **The PWA manifest is dead** and misconfigured for the live domain.
10. **The empty-seat figure is a heuristic over padding elements**, not a capacity calculation.

## 7. Proposed final architecture

> **Version note.** This assessment proposed Next.js 15; the build is on **16.3.4**
> — Next 15 carries a high-severity postcss advisory fixed in 16, and this is
> greenfield. Next 16 has real breaking changes (async `cookies()`/`params`,
> `middleware` → `proxy`, `next lint` removed). See `docs/next16-notes.md`.

```
Browser (Next.js client)
   │  initial payload: RSC / server-rendered
   │  mutations: fetch → route handlers
   │  updates:   EventSource ← /api/stream (SSE)
   ↓
Next.js 15 App Router on Vercel  ─ auth, RBAC, Zod validation, audit
   ↓
MongoDB Atlas  ─ data + change streams driving the SSE fan-out
```

**Stack, with the alternative considered for each (§56):**

| Choice | Why | Alternative rejected |
|---|---|---|
| **Next.js App Router + TypeScript** | Mandated shape by §34; one deployable unit for UI + API on Vercel | Static site + separate API — two deploy targets for a 16-student app |
| **`mongodb` native driver + Zod** | §32's cached-connection pattern is ~15 lines; Zod validates at the API edge where §28 wants it | Mongoose — a second schema layer duplicating Zod, for no gain at this size |
| **Auth.js v5, Credentials provider, JWT sessions** | Gets httpOnly + `SameSite` cookies, CSRF tokens, and session rotation right by default — §30 asks for all three | Hand-rolled `jose` + cookie: genuinely simpler (~120 lines) and understandable per §33, but re-implements CSRF and cookie hardening. See Decision **D5** |
| **`bcryptjs`** | Pure JS, no native build on Vercel | `bcrypt` (native, build friction), `argon2` (better, but a native dep for 3 users) |
| **SSE over change streams** | See §11 below | Pusher/Ably (extra vendor + secret + cost), polling (§23 forbids as primary) |
| **`styles.css` carried over near-verbatim** | The single strongest design-preservation lever — same class names, same tokens, same 5 themes, same breakpoints | Tailwind/CSS-modules rewrite — guaranteed visual drift, forbidden by §5 |

**Frontend shape** (§33): `index.html` is ported to React components one-to-one with **identical class names**, so `styles.css` needs near-zero edits. The grid becomes `<Timetable>` mapping over days × ranges; the footer becomes `<RosterFooter>` grouping the *same* student array. Editing is a mode toggle on the existing grid — click a cell or a student chip to open a small popover — not a separate admin screen (§21, §38, §39).

## 8. Database schema

Six collections (§9). All timestamps UTC; times stored as `"HH:mm"` 24-hour strings — sortable, comparable, timezone-free, and exactly what `<input type="time">` emits.

```js
users     { _id, name, email(lc, unique), passwordHash, role: 'admin'|'editor'|'viewer',
            preferredTheme: 'theme1'..'theme5'|null, active, createdAt, updatedAt }

courses   { _id, name, slug, defaultDuration /*min*/, sessionsPerWeek,
            icon: 'laptop'|'mouse'|'plane', active, createdAt, updatedAt }

students  { _id, name, courseId → courses, cohort: string|null, studentClass: string|null,
            courseMonth: number, active, createdAt, updatedAt, updatedBy, version }

schedules { _id, studentId → students, day: 'Mon'..'Sat', startTime: 'HH:mm', endTime: 'HH:mm',
            createdAt, updatedAt, updatedBy, version }

settings  { _id: 'app', days: ['Mon'..'Sat'],
            timeRanges: [{ id, startTime, endTime, order }],
            slotCapacity: 5, emptySeatDivisor: 3, updatedAt, updatedBy, version }

auditLogs { _id, at, userId, userName, action, target, targetId, summary, before?, after? }
```

**Why `timeRanges` lives in `settings` and there is still no `slots` collection (§16).**
§16 is right that a *populated* column is derivable from `day + startTime + endTime`. But §40 requires an admin to **add a time range before any student occupies it** — a purely derived column set cannot represent an empty column, so a newly added range would be invisible until someone was assigned to it, which is backwards. Storing the display columns as an ordered array inside the single `settings` document satisfies §40 without adding a collection, a second source of truth, or a join. Schedules still carry their own `startTime`/`endTime` and remain authoritative; `timeRanges` only controls **which columns render, and in what order**.

**Indexes** (§29):

```
users.email                          unique
students.courseId, students.active
students.{active, courseId, name}    compound — footer roster query
schedules.studentId
schedules.{day, startTime, endTime}  compound — the timetable's only read pattern
auditLogs.at                         descending
auditLogs.at                         TTL, expireAfterSeconds ≈ 180 days  ← keeps §26 "lightweight" literally true
```

`schedules.{day, startTime, endTime}` is the one that matters: the whole timetable is a single indexed scan of ~41 documents.

**Referential integrity** (§22): deleting a course with active students is refused (409). Deleting a student soft-deletes (`active: false`) and hard-deletes that student's `schedules`, in a transaction. Clearing an assignment deletes only the `schedules` document.

## 9. API structure

Route handlers under `app/api/`. Every mutating route: authenticate → authorise by role → Zod-validate → check `version` → write → append `auditLogs` → publish change.

| Route | GET | POST | PATCH | DELETE |
|---|---|---|---|---|
| `/api/auth/[...nextauth]` | Auth.js | | | |
| `/api/auth/me` | any | | | |
| `/api/bootstrap` | any — settings + courses + students + schedules in one response | | | |
| `/api/students` | any | editor | | |
| `/api/students/:id` | any | | editor | admin |
| `/api/schedules` | any | editor | | |
| `/api/schedules/:id` | | | editor | editor |
| `/api/courses` | any | admin | | |
| `/api/courses/:id` | any | | admin | admin |
| `/api/settings` | any | | editor (`timeRanges`) / admin (rest) | |
| `/api/users`, `/api/users/:id` | admin | admin | admin | admin |
| `/api/audit-logs` | admin | | | |
| `/api/stream` | SSE, any authenticated | | | |

`/api/bootstrap` exists to satisfy §47 — the timetable needs all four datasets on first paint, and one round trip beats four.

Validation (§28) via shared Zod schemas: `endTime > startTime`, `day ∈ settings.days`, `courseMonth` a non-negative integer, `ObjectId` well-formed before any query (§30's malformed-ID case), email normalised lowercase. Responses are built from explicit field projections so `passwordHash` cannot leak (§30) — never `delete user.passwordHash` after the fact.

## 10. Authentication / RBAC

Auth.js v5 Credentials provider, bcryptjs, JWT session strategy with `role` embedded in the token, httpOnly + `Secure` + `SameSite=Lax` cookies.

RBAC is enforced **server-side in every route handler** (§8), via a single wrapper:

```ts
export const POST = withRole('editor', async (req, { user }) => { … })
```

`withRole` runs before the handler body, so a route cannot accidentally ship unguarded. Client-side role checks exist only to hide controls that would fail anyway — never as the enforcement point. Phase 13 tests this by calling `DELETE /api/students/:id` directly with a viewer's cookie and asserting 403 (§48 "Security").

Role matrix per §7: **viewer** reads + theme; **editor** students, schedules, `timeRanges`; **admin** everything plus users, roles, courses, audit.

The `localStorage` "remember me" flag disappears — session lifetime becomes the JWT's `maxAge` (proposed: 30 days when "remember me" is checked, session-cookie otherwise). The triple-tap logo backdoor is removed. `preferredTheme` persists per user server-side, with `localStorage` retained as the pre-login/anonymous fallback so the theme still applies on the login screen (§6).

## 11. Realtime approach

**Proposal: Server-Sent Events fed by MongoDB change streams.**

```
editor writes → route handler → Atlas
                                  │ change stream (collection.watch)
                                  ↓
                        GET /api/stream (text/event-stream)
                                ↙        ↘
                          editor B      editor C
```

*Why.* It adds **no vendor, no account, no extra secret, and no dependency** — Atlas change streams and the browser's native `EventSource` are both already available. Updates are one-directional (server → client); writes go over ordinary `fetch`, so a bidirectional socket buys nothing here.

*Why not the alternatives.* Pusher/Ably would work in an afternoon but add a third-party service, another credential, and a bill, against §34 and §53. Raw WebSockets aren't supported by Vercel's serverless functions. Polling is what §23 explicitly rules out as the primary mechanism.

*Honest constraints, to verify against the account's plan in Phase 2:*
- A streaming function is a long-lived invocation with a `maxDuration` ceiling. The stream self-recycles before that ceiling; `EventSource` reconnects automatically, and `Last-Event-ID` carries the change-stream resume token so no event is dropped across the reconnect.
- One held-open invocation and one Atlas cursor per connected editor. Sized for **~5–20 concurrent editors**, which matches an institute with three roster sections. It would not suit thousands.
- Change streams require a replica set — every Atlas tier including M0 qualifies.
- **Fallback, not the design:** if SSE fails to connect twice, the client degrades to a conditional `GET /api/bootstrap` with `If-None-Match` every 15s and shows a "reconnecting" indicator. That is §43's realtime-failure path, not a substitute for §23.

**Concurrency** (§24): every mutable document carries `version`. Writes send the version they read; the server does `updateOne({ _id, version }, { $inc: { version: 1 }, … })` and returns **409 with the current server state** on a zero-match. The client shows "Someone else changed this — here's the current value" and lets the user re-apply. No silent overwrite, no merge algorithm.

**Optimistic UI** (§25): apply locally → send → on 409/error, roll back to the server's returned state and surface the message. The `updatedBy` field lets the toast name the other editor.

## 12. Migration strategy

A committed, re-runnable script — not retyping (§36).

1. Vendor the audited `index.html` to `scripts/legacy/index.html` at commit `b46bb24`, so the extraction has a frozen, reviewable input.
2. `scripts/extract-legacy.ts` parses it to `scripts/seed-data.json`: splits `Name(std.N) (MM)` into `name` / `studentClass` / `courseMonth`, strips `(5pm)`/`(5:30pm)` into `startTime`, maps the four column headers to their 24-hour ranges, and derives each student's `courseId` from the footer section.
3. **The JSON is reviewed and corrected by hand** — that's where decisions D1–D4 get applied — then committed as the authoritative seed.
4. `scripts/seed.ts` is idempotent: upserts courses and settings by slug/id, students by name, schedules by `{studentId, day, startTime}`. Safe to re-run; never duplicates (§20).
5. Verification asserts the round trip: 16 students, 41 schedules, and the rendered footer/grid match the legacy page section for section.
6. The initial admin user is created by a separate `scripts/create-admin.ts` prompting for a password — never seeded with a default (§50.6).

Extraction is already proven against the real file: 16/16 students reconciled, 41 assignments, no orphans in either direction.

## 13. Implementation phases

Following §52, with Phase 1 complete:

| Phase | Deliverable | Gate |
|---|---|---|
| ~~1. Audit~~ | ~~This document~~ | ✅ done |
| 2. Architecture | Next.js scaffold, TS config, decisions D1–D5 resolved | **needs credential rotated + D1–D5 answered** |
| 3. Database | Cached connection, collections, indexes, Zod schemas | |
| 4. Auth | Auth.js, bcrypt, `withRole`, admin bootstrap | |
| 5. API | CRUD routes, validation, versioning, audit writes | |
| 6. Timetable | `index.html` → components, `styles.css` carried over, DB-driven render | visual diff vs. legacy |
| 7. Editing | Edit mode, cell/student popovers, optimistic writes | |
| 8. Dynamic ranges | `settings.timeRanges`, N-column grid, range-aware highlight | 4-column limit gone |
| 9. Realtime | SSE + change streams, reconnect, 409 conflict UI | two browsers, live |
| 10. Footer | Same student array, grouped by course + cohort | |
| 11. Themes | 5 themes verified, `preferredTheme` per user | |
| 12. Security/perf | §30 checklist, headers, rate limiting, payload audit | |
| 13. Testing | §48 functional + edge + direct unauthorised API calls | |
| 14. Deploy | GitHub, Vercel, Atlas prod, README | §55 checklist |

Phases 6 and 8 are the two where design regression is most likely; both should be checked against a screenshot of the legacy page before moving on.

---

## Decisions

**Status as of 2026-09-10:** D1–D5 **resolved** — proposals accepted as written below,
D2's open sub-question settled in favour of the label (see below). The seed data carries
no entry awaiting review.
**D7** (the `data-d` attribute, `docs/phase-6-visual-deltas.md`) remains open; nothing depends on it.

**D1 — "Web Dev (Old)" vs "Web Dev (New)".** §11 defines two courses, but the footer shows three sections. Proposal: one `Web Development` course plus a `cohort` field on the student (`"old"` / `"new"`), with the footer grouping by course-then-cohort. Keeps §11's course model intact and the footer visually identical. Alternative: make them two real courses (simpler render, but contradicts §11 and duplicates the Web Dev defaults).

**D2 — the annotated 5pm/5:30pm students.** Once these become real `startTime` values, they no longer belong in the 16:00 column, and the grid gains a 17:00 column. Two sub-questions:
- What `endTime`? Proposal: annotated start + the course's 90-minute default → Arnab Mon `17:30–19:00`, the 5pm group `17:00–18:30`.
- **Bihan Kundu, Monday** is in the 18:00–20:00 column but labelled 5pm. Which is right? **Resolved 2026-09-10: the label wins — `17:00–18:30`**, matching his Thursday class and the 90-minute Basic Computer default. Recorded as a `RESOLUTIONS` entry in `scripts/extract-legacy.ts`, since `seed-data.json` is regenerated.
- Basic Computer students with *no* annotation (Samrit, Indrani, Unnayan, Sabita, Diya) — keep their column's existing 2-hour end time, or apply the 90-minute course default? Proposal: **keep as displayed**, since §41 makes the student's schedule authoritative over course defaults, and this preserves the current layout.

**D3 — icons.** Data-driven icons give all 7 Web Dev students a laptop, where only 2 have one today. Confirm this correction is wanted (§42 implies yes) — it's the one intentional visual change in the migration.

**D4 — empty seats.** Preserve `floor(emptySlots / 3)` exactly as-is (same number on screen, formula still unexplained), or redefine as real capacity `days × ranges × slotCapacity − assignments`? Proposal: preserve the formula, move the divisor into `settings.emptySeatDivisor` so it can be tuned without a deploy.

**D5 — Auth.js vs. hand-rolled sessions.** Auth.js v5 gives CSRF and cookie hardening for free but is a dependency with its own concepts; ~120 lines of `jose` + bcrypt is more transparent and better matches §33's "understandable to a developer maintaining a small educational institute application", at the cost of implementing CSRF correctly by hand. Proposal: **Auth.js v5**.

**Also recommended, outside the prompt's scope:** drop or pin `robotBlocker@main` to a commit SHA; wire up or delete `manifest.webmanifest`; self-host `laptop.svg`/`mouse.svg` (already local) and consider self-hosting the fonts and the two remote logo images to remove the runtime dependency on Google's favicon scraper.
