# Phase 13 — testing

The suites grew alongside the phases rather than being written at the end, so
this phase was consolidation plus the §48 cases nothing had reached yet.

**326 assertions across 7 suites**, one command:

```bash
npm run check:all        # needs a dev server on the test database
```

| Suite | Asserts | What it covers |
|---|---|---|
| `schemas` | 42 | Validation rules as pure functions — no server, no database |
| `render` | 55 | Structural diff against the frozen legacy page (§5, §19) |
| `themes` | 32 | Five themes, per-account persistence (§6) |
| `api` | 80 | RBAC matrix, concurrency, referential integrity (§7, §8, §22, §24) |
| `security` | 51 | CSRF, injection, XSS, headers, enumeration, rate limiting (§30) |
| `edge` | 57 | The §48 edge-case list |
| `bundle` | 9 | Server code must not reach the browser; size budget (§2, §47) |

`check:all` resets the database before each destructive suite, because several
of them empty the timetable or delete accounts, and running two against the same
data makes the second fail for the wrong reason.

## §48's list, and where each item is covered

**Functional** — login, logout, Remember Me, role permissions, student CRUD,
course CRUD, schedule CRUD, clearing assignments, dynamic time ranges, footer
rendering, themes, realtime sync. All covered; realtime is now asserted by a
program that opens an SSE stream, makes a change from another account, and reads
the event off the wire — previously I had only watched it happen in a browser.

**Edge cases** — two users editing the same student, and the same *schedule*;
invalid time ranges; duplicate student data; missing course; deleted student
with schedules; deleted course with students; empty timetable; unusual names;
long names. Unusual names are tested with Bengali script, accents, an
apostrophe, an emoji and a double-barrelled name, and asserted to survive
storage and reach the HTML unmangled.

Mobile widths remain a manual check (`docs/phase-6-visual-deltas.md`); the
browser automation available here cannot size a window below ~500px.

**Security** — covered by `check:security`, which calls the endpoints directly
as an under-privileged user rather than checking whether a button is hidden.

## Three bugs this phase found

**1. Duplicate students were created silently.** `POST /api/students` had a 409
handler for duplicate names, but no unique index backed it, so the branch was
unreachable. §20 says a student should exist once, and `seed.ts` upserts *by
name* — so a duplicate would make re-seeding match an arbitrary one. Added a
partial unique index on `name` for active students, and the same guard on
rename. Partial on `active`, so removing someone frees their name; the trade is
that two different students cannot both be active under one name, which for
sixteen students is the right way round.

**2. Deactivating an account did nothing for up to 30 days.** The user could not
sign in again, but the token they already held kept working — so "remove user"
did not remove their access.

**3. A role change did not take effect until the next sign-in.** A demoted admin
kept admin rights while their token lasted.

Both 2 and 3 had the same cause: `withRole` trusted the JWT's `role`. A token is
a bearer credential minted at sign-in; it proves *who* you are, and it cannot
know what you are still allowed to do. Authorization now reads `role` and
`active` from the database per request — one indexed `findOne` on a three-field
projection, cached per request via React's `cache`. §47 warns against
unnecessary queries; this one is necessary.

## What is deliberately NOT asserted

**That replaying a signed-out cookie stops working.** Under the JWT strategy the
token stays cryptographically valid until it expires. Signing out clears it from
the browser, which is what a person doing it means, but it is not server-side
revocation. The suite says so in a comment rather than quietly asserting
something weaker and looking complete.

What *is* asserted is the case that actually matters, and now works: an admin
deactivating an account cuts off access immediately, token or no token.

## A trap worth knowing

`next build` and `next dev` share `.next` and corrupt each other's generated
route manifest if run at once. The symptom is every API route returning 404 with
an HTML body while `/login` still works — it looks exactly like broken code.
`rm -rf .next` and restart. `check:all` skips the build-dependent suite rather
than tempting anyone into running a build alongside the server.
