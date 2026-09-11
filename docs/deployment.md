# Deployment

GitHub → Vercel → MongoDB Atlas. The seven items §50 asks to document, in the
order you actually do them.

> **Done, 2026-09-11:** the MongoDB user printed in `master-prompt.md` §1 was
> compromised by having been written down. It has been deleted in Atlas and
> replaced. `npm run preflight` still refuses that specific user by name, so
> this stays as a guard against anyone pasting the old string back in.

---

## 1. MongoDB Atlas

1. **Create a cluster.** Any tier works. M0 (free) is enough for sixteen
   students, and — importantly — is still a replica set, which the realtime
   feature requires.
2. **Database Access → Add New Database User.** Give it a *strong generated*
   password and the **Read and write to any database** role, or scope it to the
   one database. Do not reuse the leaked user; create a new one or rotate.
3. **Network Access.** Vercel functions do not have fixed IPs, so
   `0.0.0.0/0` is the usual answer. That makes the password the only thing
   protecting the data, so it must be long and unique. If your plan supports it,
   prefer a private endpoint or Atlas's Vercel integration over an open list.
4. **Connect → Drivers** for the connection string. Keep the database name in
   `MONGODB_DB` rather than embedding it, so the same URI can serve preview and
   production databases.

Use a **separate database for preview deployments**. `MONGODB_DB=lca_preview`
on the Preview environment is enough; preview branches must never write to the
academy's real timetable.

## 2. Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**:

| Variable | Environments | Notes |
|---|---|---|
| `MONGODB_URI` | Production, Preview | The rotated credential. Never `NEXT_PUBLIC_`. |
| `MONGODB_DB` | Production, Preview | Different value per environment. |
| `AUTH_SECRET` | Production, Preview | `openssl rand -base64 32`. Different per environment. |
| `AUTH_URL` | Production only | The full `https://` origin — currently `https://lca-timetable.vercel.app`. Leave it **unset on Preview**: preview URLs change per deployment, and `auth.ts` sets `trustHost: true`, so Auth.js infers the origin there. |
| `STREAM_LIFETIME_SECONDS` | optional | See §5 below. |

Then verify locally against the same values:

```bash
npm run preflight
```

It checks shape and safety without connecting, and prints the database host but
never the credentials.

## 3. GitHub

```bash
git init && git branch -M main
git remote add origin https://github.com/gitussr/lca-timetable.git
git add -A && git commit -m "LCA timetable: database-driven rewrite"
git push -u origin main
```

`.gitignore` already excludes `.env*`, `node_modules`, `.next` — **and
`master-prompt.md`**, because it contains the leaked credential. Once that
credential is rotated *and* redacted from the file, remove that line if you want
the brief in the repository.

Confirm before pushing:

```bash
git grep --cached -iE "mongodb\+srv://[a-z]+:[^@]*@"   # must print nothing
```

## 4. Vercel

Import the repository. Next.js is detected automatically; the defaults are
correct, and the project needs **no `vercel.json`** — the one thing it used to
carry (the streaming route's duration) belongs in the route itself.

> **If the build fails instantly with "The pattern ... doesn't match any
> Serverless Functions inside the `api` directory":** something has reintroduced
> a `functions` glob in `vercel.json`. App Router routes set their own
> `maxDuration` by exporting it; a `functions` pattern aimed at
> `app/api/**/route.ts` does not match and fails the build before it starts.
> This cost two deployments on 2026-09-10.

Deploy, then immediately:

```bash
npm run preflight        # against the production values
```

## 5. Function duration and the realtime stream

`/api/stream` holds a connection open and recycles it deliberately, so the
platform never kills it mid-flight. Two numbers must agree:

- `maxDuration` exported from `app/api/stream/route.ts` — currently **300** seconds
- `STREAM_LIFETIME_SECONDS` — defaults to **240**, and must be lower

**Check your plan's function duration limit before relying on those defaults.**
If your plan caps functions below 300s, lower both — for example a 60s cap wants
`export const maxDuration = 55` and `STREAM_LIFETIME_SECONDS=45`. `npm run
preflight` reads the export and fails if the two numbers disagree.

Getting it wrong is not catastrophic: the connection dies at the platform limit
instead of recycling cleanly, and the client reconnects with its resume token, so
no update is lost. It is just untidy, and it shows up as a brief "Reconnecting…"
badge more often than it should.

## 6. Production database setup

Once the environment variables are live, from your own machine with the
production values in `.env.local`:

```bash
npm run ensure-indexes
npm run seed
```

`seed` refuses to run while `scripts/seed-data.json` contains an unresolved data
conflict. **There are none** — the one that existed (D2, Bihan Kundu's Monday
class) was resolved on 2026-09-10; see
[`phase-1-assessment.md`](phase-1-assessment.md). If a future extraction raises a
new conflict, resolve it in `RESOLUTIONS` in `scripts/extract-legacy.ts` — not in
the JSON, which is regenerated — or pass `-- --allow-unreviewed` to accept the
extracted value as-is.

Both commands are idempotent and safe to re-run.

## 7. The first admin

```bash
npm run create:admin
```

Prompts for name, email and password with the password not echoed. There is
**no default admin account and no seeded password** — a known credential on a
public deployment is the same problem as the `LCA1234` access code this
migration removed.

Further accounts can be made the same way (`-- --role=editor`), or — from
2026-09-11 — in the app itself: sign in as an admin and click **Accounts** in
the header. That panel is the only way to create an account without shell
access to the production credentials.

**There is deliberately no sign-up page.** Accounts exist because an admin made
one. A public form on a timetable would let anyone who finds the URL read the
schedule and the students' names — the exposure the `LCA1234` access code used
to create, and the reason this migration removed it.

---

## After deploying

- [ ] Sign in as the admin.
- [ ] The timetable renders with the seeded data.
- [ ] Open a second browser, edit in one, and watch the other update.
- [ ] Check the connection badge does **not** say "Live updates unavailable" —
      if it does, the change stream is not working, usually because the URI
      points at something that is not a replica set.
- [ ] Create an editor and a viewer, and confirm the viewer sees no edit button.
- [ ] Confirm `https://` and a valid certificate, so cookies get `Secure`.

## Rolling back

Vercel keeps previous deployments; promote an earlier one from the dashboard.
The database is **not** rolled back with it — schema changes are additive so far,
but a data mistake needs Atlas's own point-in-time restore (paid tiers) or a
re-seed.
