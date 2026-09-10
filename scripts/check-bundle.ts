/**
 * Build-output checks (§2, §30, §47).
 *
 * Two things that regress silently and are invisible in a running app:
 *
 * 1. Server-only code leaking into a client chunk. One `import { collections }`
 *    at the top of a client component is enough to pull the MongoDB driver into
 *    the browser bundle. §2 is emphatic that the browser must never reach Atlas
 *    directly, and grepping the built output is the only way to actually know.
 *
 * 2. Bundle creep. §47 asks for no huge client bundles; a budget turns that
 *    into something a build can fail on.
 *
 * Run after `npm run build`:
 *   npm run check:bundle
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const STATIC_DIR = join(process.cwd(), '.next', 'static');

/** Gzipped KB across everything the browser downloads. Generous, not lax. */
const BUDGET_KB = 320;

/**
 * Strings that must never appear in a client chunk. Each one is a symptom of a
 * specific mistake, not a general "looks like a secret" heuristic.
 */
const SERVER_ONLY = [
  'MongoClient',        // the driver itself
  'mongodb+srv',        // a connection string
  'MONGODB_URI',        // reading the connection string
  'AUTH_SECRET',        // the signing secret
  'passwordHash',       // the field name; its presence means a doc type crossed over
  'ensureIndexes',      // lib/db internals
  'compareSync',        // bcryptjs
];

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) pass++;
  else {
    fail++;
    failures.push(label + (detail ? '  — ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? '  — ' + detail : ''));
  }
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function main(): void {
  let files: string[];
  try {
    files = walk(STATIC_DIR);
  } catch {
    console.error('No .next/static — run `npm run build` first.');
    process.exit(1);
  }

  const assets = files.filter((f) => f.endsWith('.js') || f.endsWith('.css'));
  const rel = (f: string) => f.replace(process.cwd(), '').replace(/\\/g, '/');

  console.log('--- server-only code stays on the server (§2, §30) ---');
  for (const marker of SERVER_ONLY) {
    const hits = assets.filter((f) => readFileSync(f, 'utf8').includes(marker));
    ok('no "' + marker + '" in any client asset', hits.length === 0,
      hits.map(rel).slice(0, 2).join(', '));
  }

  console.log('--- bundle size (§47) ---');
  let raw = 0;
  let gz = 0;
  for (const f of assets) {
    const buf = readFileSync(f);
    raw += buf.length;
    gz += gzipSync(buf).length;
  }
  const gzKb = Math.round(gz / 1024);
  console.log('  ' + assets.length + ' assets, ' + Math.round(raw / 1024) + ' KB raw, ' + gzKb + ' KB gzipped');
  ok('within the ' + BUDGET_KB + ' KB gzipped budget', gzKb <= BUDGET_KB, gzKb + ' KB');

  console.log('--- dependency surface (§34) ---');
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  const deps = Object.keys(pkg.dependencies);
  console.log('  ' + deps.join(', '));
  // Not a hard rule, a tripwire: every addition should be a deliberate choice.
  ok('runtime dependencies stay in single figures', deps.length < 10, String(deps.length));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) {
    console.log('\nfailures:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(fail ? 1 : 0);
}

main();
