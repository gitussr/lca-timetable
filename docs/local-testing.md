# Local testing without Atlas

Phases 3–4 were verified against a throwaway local MongoDB rather than Atlas,
because the Atlas credential in the brief is compromised and awaiting rotation
(`docs/phase-1-assessment.md` §0). The same setup works for later phases, and
Phase 9 needs it anyway: **change streams require a replica set**, so a plain
standalone `mongod` will not do.

MongoDB 8.2 is already installed on this machine at
`C:\Program Files\MongoDB\Server\8.2\bin`. `mongosh` is not, so the replica set
is initiated with the Node driver instead.

## Start

```bash
MONGO_BIN="/c/Program Files/MongoDB/Server/8.2/bin"
DATA="$TMPDIR/mongo-data"   # anywhere outside the repo

mkdir -p "$DATA"
"$MONGO_BIN/mongod.exe" --dbpath "$DATA" --port 27018 \
  --replSet rs0 --bind_ip 127.0.0.1 --logpath "$DATA/../mongod.log" &
```

`--fork` is not supported on Windows; background it with `&`.

Then initiate the single-node replica set once:

```js
// node this once, from the repo root
import { MongoClient } from 'mongodb';
const c = new MongoClient('mongodb://127.0.0.1:27018/?directConnection=true');
await c.connect();
await c.db('admin').command({
  replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: '127.0.0.1:27018' }] },
});
await c.close();
```

Wait for `hello.isWritablePrimary` before using it — election takes a second or two.

## Point the app at it

Never put these in `.env.local` if that file also holds real values. Use a
separate env file and pass it explicitly:

```
MONGODB_URI=mongodb://127.0.0.1:27018/?replicaSet=rs0
MONGODB_DB=lca_test
AUTH_SECRET=test-only-secret-not-for-production-use-abcdefgh
AUTH_URL=http://localhost:3000
```

```bash
npx tsx --env-file=test.env scripts/ensure-indexes.ts
npx tsx --env-file=test.env scripts/seed.ts --allow-unreviewed
printf 'Test Admin\nadmin@lca.test\ncorrect-horse-battery\ncorrect-horse-battery\n' \
  | npx tsx --env-file=test.env scripts/create-admin.ts
```

For `next dev`, set the variables in the environment rather than in a file —
Next does not override values already present in `process.env`:

```bash
MONGODB_URI="mongodb://127.0.0.1:27018/?replicaSet=rs0" MONGODB_DB=lca_test \
AUTH_SECRET="test-only-secret-not-for-production-use-abcdefgh" npm run dev
```

## Exercising auth over HTTP

Auth.js requires a CSRF token on the credentials callback, so a login is two
requests sharing a cookie jar:

```bash
CSRF=$(curl -s -c jar.txt http://localhost:3000/api/auth/csrf \
  | node -pe "JSON.parse(require('fs').readFileSync(0,'utf8')).csrfToken")

curl -s -b jar.txt -c jar.txt -X POST \
  http://localhost:3000/api/auth/callback/credentials \
  -d "csrfToken=$CSRF&email=admin@lca.test&password=correct-horse-battery&rememberMe=true"

curl -s -b jar.txt http://localhost:3000/api/auth/session
```

A failed sign-in redirects to `/login?error=CredentialsSignin&code=...`, where
`code` is the generic value from `auth.ts` (`invalid-credentials` or
`too-many-attempts`) — never anything that reveals whether the email exists.

This is also how Phase 13 should test RBAC: sign in as the viewer, then call a
mutating endpoint directly and assert 403. Testing that a button is hidden
proves nothing (§8, §48).

## Stop and discard

```bash
# stop mongod, then
rm -rf "$DATA"
```

The data directory is disposable — `seed.ts` is idempotent and `create-admin`
recreates users in seconds.

## Running the API checks

`scripts/check-api.ts` is the §48 security suite: it signs in as admin, editor
and viewer, then calls every endpoint directly and asserts the status code. It
does not look at the UI at all — hidden buttons prove nothing.

The checks mutate data (they delete a student, clear an assignment, add a time
range), so reset first:

```bash
npm run test:reset      # drops + reseeds + creates admin/editor/viewer accounts
npm run check:api       # needs `npm run dev` already running
```

`test:reset` refuses to run unless `MONGODB_DB` contains "test", and refuses
outright against an Atlas host. It drops a database — that guard is the reason
it is safe to keep in `package.json`.

Current coverage: 69 assertions across bootstrap, unauthenticated access,
viewer/editor/admin boundaries, per-field settings permissions, optimistic
concurrency, input validation, malformed ids, referential integrity, the
clear-vs-delete distinction, cascade deletes, last-admin protection, audit
writes, and `passwordHash` never appearing in a response.

## Comparing against the legacy page

`npm run check:render` diffs the rendered timetable against
`scripts/legacy/index.html` — same students on the same days, same footer
wording, same grid scaffolding, same theme markup. Intentional differences are
asserted as intentional (see `docs/phase-6-visual-deltas.md`), so anything else
that moves is a failure.

To eyeball them side by side, serve the legacy clone:

```bash
git clone --depth 1 https://github.com/learncomputeracademy/time.git /tmp/legacy
(cd /tmp/legacy && python -m http.server 8099)
# unlock it with the access code LCA1234
```

## Running everything

```bash
# terminal 1 — dev server pointed at the TEST database
MONGODB_URI="mongodb://127.0.0.1:27018/?replicaSet=rs0" MONGODB_DB=lca_test \
AUTH_SECRET="test-only-secret-not-for-production-use-abcdefgh" npm run dev

# terminal 2
npm run check:all
```

`check:all` resets the database before each suite that mutates it, so the
suites cannot poison each other. Individual suites still run alone:
`check:schemas`, `check:render`, `check:themes`, `check:api`, `check:security`,
`check:edge`, `check:bundle`.

### The bundle check runs separately

`check:bundle` inspects production build output, and **`next build` must not run
while `next dev` is running** — they share `.next` and corrupt each other's
generated route manifest. The symptom is every API route suddenly returning
404 with an HTML body while `/login` still works.

If that happens: stop both, `rm -rf .next`, start again.

```bash
# with the dev server stopped
npm run build && npm run check:bundle
```
