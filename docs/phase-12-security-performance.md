# Phase 12 — security and performance audit

§30 is a checklist, and this project has already shown that a checklist can be
ticked while the application is wrong — every theme check passed while the theme
was broken, because each one signed in fresh. So this phase turns the checklist
into **269 assertions that actually try the thing**.

Run: `npm run check:security` (51), `npm run check:bundle` (9), alongside
`check:api` (80), `check:render` (55), `check:themes` (32), `check:schemas` (42).

## Security — what was probed, and what happened

| Attack | Result |
|---|---|
| Forged session cookie | 401 |
| Cross-origin `PATCH` with a **valid** cookie | 403 |
| NoSQL operator as a name / id / number | 400 |
| `$where` payload | 400 |
| Array where a string belongs | 400 |
| Operator injection at login (`email[$ne]=null`) | no session, generic error |
| Stored XSS (`<img src=x onerror=…>`) | stored as data, rendered escaped |
| `passwordHash` / bcrypt hash / connection string / `AUTH_SECRET` in any response | absent from all five surfaces checked |
| Account enumeration | identical error for known and unknown emails |
| Repeated failed logins | locked out |
| Non-JSON body | 400, no stack trace |
| Path-traversal id (`../../etc/passwd`) | 404 |

**Enumeration, measured rather than assumed.** A wrong password on a real
account took **440ms**; on an account that does not exist, **419ms**. The dummy
bcrypt compare in `auth.ts` is doing its job — there is no timing channel to
distinguish the two.

**CSRF.** The primary defence is the session cookie's `SameSite=Lax`, verified
present along with `HttpOnly`. Added this phase: an Origin check on every
mutating request in `withRole`, so a cross-site write is refused even if that
cookie attribute is ever weakened. A missing Origin is allowed through —
browsers always send it cross-origin, which is the case that matters, and
refusing it would break server-to-server callers without closing a hole.

## Gaps found and closed

- **`Strict-Transport-Security` was missing.** Added, with `includeSubDomains`
  and `preload`. Inert over local http; live on the HTTPS deployment.
- **`Cross-Origin-Opener-Policy` was missing.** Added `same-origin`.
- **No origin check on writes.** Added, as described above.

Not a gap: the `Secure` cookie flag is absent locally because this runs over
http. Auth.js adds `Secure` and the `__Secure-` prefix automatically once
`AUTH_URL` is https, so it arrives with the deployment.

## Performance

**Every query uses an index.** Verified with `explain('executionStats')` —
`totalDocsExamined` equals `nReturned` in every case, so nothing is scanned and
discarded:

| Query | Index | Examined / returned |
|---|---|---|
| The grid (`day + startTime + endTime`) | `day_start_end` | 3 / 3 |
| Footer roster (`active + courseId + name`) | `active_course_name` | 17 / 17 |
| Login (`email`) | `email_unique` | 1 / 1 |
| Cascade delete (`studentId`) | `studentId` | 1 / 1 |
| Audit log, newest first | `_id_` | 1 / 1 |

**Zero API calls on first paint.** The page is server-rendered with its data
inlined; there is no `/api/bootstrap` round trip on load, and no duplicate calls
of any endpoint. Realtime is one long-lived connection, not a poll.

**No third-party image hosts.** Every non-script resource is local — the logo,
the manifest, and the two icon SVGs.

**Bundle: 189 KB gzipped** (621 KB raw, 14 assets) against a 320 KB budget, on
**7 runtime dependencies**. Most of that is the React 19 + Next 16 baseline.

### The check worth keeping

`check:bundle` greps the built client assets for server-only markers —
`MongoClient`, `mongodb+srv`, `MONGODB_URI`, `AUTH_SECRET`, `passwordHash`,
`compareSync`. All absent.

This is the only way to actually know that §2 holds. One
`import { collections }` at the top of a client component would pull the MongoDB
driver into the browser bundle, and the app would keep working perfectly while
doing it — nothing visible would change. A running application cannot tell you
this; the build output can.
