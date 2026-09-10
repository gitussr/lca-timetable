# LCA Timetable

The class timetable for **Learn Computer Academy**, rebuilt from a static page
into a collaborative application that several people can edit at once.

The original ([learncomputeracademy/time](https://github.com/learncomputeracademy/time))
kept every student in the HTML — twice, once in the grid and once in the footer
roster — so changing a class meant editing source, committing, and deploying.
This keeps the same screen and moves the data into a database.

---

## What it does

- One timetable, edited live by several people, with changes appearing in every
  open browser without a reload.
- Individual accounts with three roles: **admin**, **editor**, **viewer**.
- Any number of weekly time columns, added and removed from the UI.
- The five original themes, now remembered per account rather than per browser.

The design is deliberately unchanged. `app/globals.css` is the original
stylesheet carried over; the differences are listed in
[`docs/phase-6-visual-deltas.md`](docs/phase-6-visual-deltas.md) and asserted by
a test that diffs the rendered page against the frozen original.

---

## Architecture

```
Browser
  │  first paint: server-rendered, data inlined — no API round trip
  │  edits:       fetch → route handlers
  │  updates:     EventSource ← /api/stream  (SSE)
  ↓
Next.js 16 App Router          auth · RBAC · validation · audit
  ↓
MongoDB Atlas                  data + change streams
```

The browser never talks to MongoDB. That is enforced structurally, not by
convention: `npm run check:bundle` greps the built client assets for the driver,
the connection string and the signing secret, and fails if any appear.

**Realtime** is Server-Sent Events driven by MongoDB change streams — no third
party, no extra credential. Reasoning and limits:
[`docs/phase-9-realtime.md`](docs/phase-9-realtime.md).

---

## Requirements

- **Node 20.9+** (Next 16 dropped Node 18)
- **MongoDB with a replica set.** Any Atlas tier qualifies. A standalone local
  `mongod` does **not** — change streams need one, so realtime will not work.

---

## Local setup

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run preflight              # checks the config without connecting
npm run ensure-indexes
npm run seed
npm run create:admin           # prompts; never takes a password as an argument
npm run dev
```

For a throwaway local database instead of Atlas, see
[`docs/local-testing.md`](docs/local-testing.md).

### Environment variables

| Variable | Required | Notes |
|---|---|---|
| `MONGODB_URI` | yes | Server-side only. Never prefix with `NEXT_PUBLIC_`. |
| `MONGODB_DB` | no | Defaults to `lca_timetable`. |
| `AUTH_SECRET` | yes | `openssl rand -base64 32` |
| `AUTH_URL` | prod | Must be `https://` in production, or session cookies lose `Secure`. |
| `STREAM_LIFETIME_SECONDS` | no | Defaults to 240. Must stay below your plan's function duration limit. |

`.env.local` is gitignored. `.env.example` holds placeholders only, and
`preflight` fails if a real-looking value ever appears in it.

---

## Data model

Six collections. Times are `HH:mm` 24-hour strings — sortable, comparable, and
exactly what `<input type="time">` emits.

```js
users     { name, email(unique), passwordHash, role, preferredTheme, active, … }
courses   { name, shortName, slug, order, defaultDuration, sessionsPerWeek, icon, active, … }
students  { name, courseId, cohort, studentClass, courseMonth, active, …, version }
schedules { studentId, day, startTime, endTime, …, version }
settings  { _id:'app', days, timeRanges[], slotCapacity, emptySeatDivisor, version }
auditLogs { at, userId, userName, action, target, targetId, summary }
```

Three details carried deliberately from the original page:

- **`courseMonth` is a duration, not an ID.** It is the number of months a
  student has been running, shown beside their name. It is never
  auto-incremented.
- **`studentClass` is split out** of the display name. The original wrote
  `Samrit Paul(std.8) (29)` as one string.
- **`icon` is a key** (`laptop`, `mouse`, `plane`), never markup. The UI decides
  how to draw it.

There is no `slots` collection. A populated column is derivable from
`day + startTime + endTime`, but an admin must be able to add a column
*before* anyone occupies it — so the display columns live as an ordered array in
the single `settings` document. Schedules still carry their own times and remain
authoritative.

### Roles

| | Viewer | Editor | Admin |
|---|---|---|---|
| View the timetable, change own theme | ✅ | ✅ | ✅ |
| Add/edit students, assign, move, clear classes | | ✅ | ✅ |
| Add/remove time columns | | ✅ | ✅ |
| Days, layout, courses | | | ✅ |
| Users, roles, audit log | | | ✅ |
| Delete a student | | | ✅ |

Enforced **server-side on every route**, and sourced from the database rather
than the session token — so deactivating an account or demoting someone takes
effect on their very next request, not at their next sign-in.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `start` | Production build and serve |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run preflight` | Validates configuration without connecting |
| `npm run ensure-indexes` | Creates indexes. Idempotent. |
| `npm run extract:legacy` | Re-parses the frozen original into `scripts/seed-data.json` |
| `npm run seed` | Seeds from that JSON. Idempotent. |
| `npm run create:admin` | Creates a user. `-- --role=editor` for other roles. |
| `npm run check:all` | Every test suite |
| `npm run test:reset` | **Drops** and rebuilds the test database |

### Migration from the original page

`scripts/legacy/index.html` is the original frozen at commit `b46bb24`.
`extract:legacy` parses it — names, course months, school standards, days and
times are read out of the markup rather than retyped — and writes
`scripts/seed-data.json`, which is reviewed by hand and committed.

`seed.ts` is idempotent, upserting by natural key, and **refuses to run** while
the JSON still contains an unresolved data conflict. See
[`docs/phase-1-assessment.md`](docs/phase-1-assessment.md).

---

## Testing

**326 assertions across 7 suites**, one command:

```bash
npm run dev          # terminal 1, pointed at a TEST database
npm run check:all    # terminal 2
```

Security testing calls the endpoints directly as an under-privileged user —
checking that a button is hidden proves nothing. Details:
[`docs/phase-13-testing.md`](docs/phase-13-testing.md).

---

## Deployment

See [`docs/deployment.md`](docs/deployment.md).

---

## Security notes

- Passwords are bcrypt-hashed at cost 12. Plaintext is never stored, logged, or
  echoed. A dummy compare runs when no user matches, so a wrong email and a
  wrong password take the same time.
- Login is rate-limited per account, backed by MongoDB so it works across
  serverless instances.
- Responses are built from explicit field projections, so `passwordHash` cannot
  leak by being forgotten.
- CSP, HSTS, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy` and COOP
  are set. Cookies are `HttpOnly` + `SameSite=Lax`, with an Origin check on
  mutating requests as defence in depth.
- Driver errors are redacted before logging — a MongoDB error can otherwise
  contain the connection string.

**Never commit `.env.local`, or any file containing a credential.** If one is
exposed, rotate it immediately; `preflight` refuses the specific credential that
was published in this project's brief.
