/**
 * Checks the environment is configured sanely before deploying (§31, §50).
 *
 * Runs WITHOUT connecting to the database, so it is safe in CI and safe before
 * a credential exists. It inspects shape and safety, never contents — nothing
 * here prints a secret, and the connection string is only ever reported by its
 * host, never in full.
 *
 *   npm run preflight
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let errors = 0;
let warnings = 0;

const fail = (msg: string, fix?: string): void => {
  errors++;
  console.log('  FAIL  ' + msg + (fix ? '\n        → ' + fix : ''));
};
const warn = (msg: string, fix?: string): void => {
  warnings++;
  console.log('  warn  ' + msg + (fix ? '\n        → ' + fix : ''));
};
const good = (msg: string): void => console.log('  ok    ' + msg);

/**
 * Recognises the credential published in master-prompt.md §1 WITHOUT storing
 * any part of it.
 *
 * An earlier version listed the username, cluster and password as string
 * literals — which committed the leaked password to the repository in order to
 * detect the leaked password. These are truncated SHA-256 digests of the
 * username and the cluster host instead: enough to recognise that credential,
 * useless to anyone reading them.
 *
 * The password is not checked at all. If the username and cluster match, the
 * credential is the compromised one whatever the password has been changed to
 * — and if it HAS been rotated, the digests still match and the warning is a
 * prompt to double-check, not a false alarm worth removing.
 */
const LEAKED_USER_DIGEST = '6e3e6171ce0ad974';
const LEAKED_HOST_DIGEST = 'ca522dba1850ff0c';

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

/** Splits a connection string into the parts worth checking. Never returns the password. */
function identify(uri: string): { user: string; host: string } {
  const match = /^mongodb(?:\+srv)?:\/\/(?:([^:@/]+)(?::[^@]*)?@)?([^/?]+)/.exec(uri);
  return { user: match?.[1] ?? '', host: match?.[2] ?? '' };
}

function checkMongo(): void {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    fail('MONGODB_URI is not set.', 'Copy .env.example to .env.local, or add it in Vercel.');
    return;
  }
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    fail('MONGODB_URI does not look like a connection string.');
    return;
  }
  const { user, host } = identify(uri);
  if (digest(user) === LEAKED_USER_DIGEST || digest(host) === LEAKED_HOST_DIGEST) {
    fail(
      'MONGODB_URI points at the account published in master-prompt.md.',
      'Rotate it in Atlas and use the new credential. See docs/phase-1-assessment.md §0.',
    );
    return;
  }

  // Report the host only — never the credentials in front of it.
  good('MONGODB_URI set, host ' + (host || '(unparsed)'));

  if (/^mongodb:\/\/(localhost|127\.0\.0\.1)/.test(uri) && process.env.VERCEL_ENV === 'production') {
    fail('Production is pointed at a local MongoDB.');
  }
  if (uri.startsWith('mongodb://') && !uri.includes('replicaSet')) {
    warn(
      'The URI names no replica set. Realtime needs change streams, which need one.',
      'Atlas always provides a replica set; a standalone local mongod does not.',
    );
  }
  if (!process.env.MONGODB_DB) {
    warn('MONGODB_DB is not set; the app will default to "lca_timetable".');
  } else if (/test/i.test(process.env.MONGODB_DB) && process.env.VERCEL_ENV === 'production') {
    fail('Production is pointed at a database named "' + process.env.MONGODB_DB + '".');
  } else {
    good('MONGODB_DB = ' + process.env.MONGODB_DB);
  }
}

function checkAuth(): void {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    fail('AUTH_SECRET is not set.', 'Generate one: openssl rand -base64 32');
  } else if (secret.length < 32) {
    fail('AUTH_SECRET is only ' + secret.length + ' characters.', 'Use at least 32.');
  } else if (secret.includes('test-only')) {
    fail('AUTH_SECRET is the value from the test fixtures.', 'Generate a real one.');
  } else {
    good('AUTH_SECRET set (' + secret.length + ' characters)');
  }

  const url = process.env.AUTH_URL;
  if (!url) {
    warn('AUTH_URL is not set. Auth.js will infer the origin, which is usually fine on Vercel.');
  } else if (process.env.VERCEL_ENV === 'production' && !url.startsWith('https://')) {
    fail(
      'AUTH_URL is not https in production: ' + url,
      'Session cookies only get the Secure flag over https.',
    );
  } else {
    good('AUTH_URL = ' + url);
  }
}

function checkStream(): void {
  const raw = process.env.STREAM_LIFETIME_SECONDS;
  if (!raw) {
    good('STREAM_LIFETIME_SECONDS unset — defaults to 240s');
    warn(
      'Confirm your hosting plan allows a 300s function before relying on that default.',
      'If it caps lower, set STREAM_LIFETIME_SECONDS below the cap and lower the ' +
        'maxDuration export in app/api/stream/route.ts.',
    );
    return;
  }
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds < 15) {
    fail('STREAM_LIFETIME_SECONDS is not a sensible number: ' + raw);
    return;
  }

  // maxDuration is declared by the route itself, the way the App Router expects.
  // A vercel.json `functions` glob is the wrong tool here and fails the build.
  const route = join(process.cwd(), 'app', 'api', 'stream', 'route.ts');
  if (existsSync(route)) {
    const declared = /^export const maxDuration = (\d+)/m.exec(readFileSync(route, 'utf8'));
    const max = declared ? Number(declared[1]) : undefined;
    if (max && seconds >= max) {
      fail(
        'STREAM_LIFETIME_SECONDS (' + seconds + ') is not below maxDuration (' + max + ').',
        'The platform would kill the stream before it recycles itself.',
      );
      return;
    }
  }
  good('STREAM_LIFETIME_SECONDS = ' + seconds);
}

function checkRepo(): void {
  const gitignore = join(process.cwd(), '.gitignore');
  if (!existsSync(gitignore)) {
    fail('.gitignore is missing.');
    return;
  }
  const text = readFileSync(gitignore, 'utf8');
  for (const entry of ['.env.local', '.env', 'master-prompt.md']) {
    if (text.includes(entry)) good('.gitignore covers ' + entry);
    else fail('.gitignore does not cover ' + entry);
  }

  const example = join(process.cwd(), '.env.example');
  if (!existsSync(example)) {
    fail('.env.example is missing (§49 asks for it).');
  } else {
    const text2 = readFileSync(example, 'utf8');
    const hasValue = text2
      .split('\n')
      .some((l) => /^(MONGODB_URI|AUTH_SECRET)=.+/.test(l.trim()));
    if (hasValue) fail('.env.example contains a real-looking value; it must hold placeholders only.');
    else good('.env.example holds placeholders only');
  }
}

console.log('--- database ---');
checkMongo();
console.log('--- authentication ---');
checkAuth();
console.log('--- realtime ---');
checkStream();
console.log('--- repository hygiene ---');
checkRepo();

console.log(
  '\n' + (errors ? errors + ' problem(s)' : 'no problems') +
    (warnings ? ', ' + warnings + ' warning(s)' : ''),
);
process.exit(errors ? 1 : 0);
