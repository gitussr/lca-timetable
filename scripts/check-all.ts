/**
 * Runs every suite in order, resetting the database between the ones that
 * mutate it (§48).
 *
 * The suites are deliberately separate files — each is readable on its own and
 * can be run alone while working on that area — but they have to be run in a
 * particular way: several are destructive, and running two against the same
 * data makes the second fail for the wrong reason. This encodes that.
 *
 *   npm run dev            # in another terminal, pointed at the test database
 *   npm run check:all
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface Suite {
  name: string;
  script: string;
  /** Whether the database must be reset before it runs. */
  reset: boolean;
  /** Whether it needs a running dev server. */
  server: boolean;
  /** Whether it needs production build output in .next/static. */
  build?: boolean;
}

const SUITES: Suite[] = [
  // Pure functions — no server, no database.
  { name: 'schemas', script: 'scripts/check-schemas.ts', reset: false, server: false },
  { name: 'merge', script: 'scripts/check-merge.ts', reset: false, server: false },
  // Build output — needs `npm run build` to have run.
  { name: 'bundle', script: 'scripts/check-bundle.ts', reset: false, server: false, build: true },
  // Read-mostly, but asserts exact seed counts, so start clean.
  { name: 'render', script: 'scripts/check-render.ts', reset: true, server: true },
  { name: 'themes', script: 'scripts/check-themes.ts', reset: true, server: true },
  // Destructive.
  { name: 'api', script: 'scripts/check-api.ts', reset: true, server: true },
  { name: 'security', script: 'scripts/check-security.ts', reset: true, server: true },
  { name: 'edge', script: 'scripts/check-edge.ts', reset: true, server: true },
];

const BASE =
  process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';

function run(script: string, args: string[] = []): { code: number; out: string } {
  const res = spawnSync(
    process.execPath,
    [require.resolve('tsx/cli'), script, ...args],
    { encoding: 'utf8', env: process.env, stdio: 'pipe' },
  );
  return { code: res.status ?? 1, out: (res.stdout ?? '') + (res.stderr ?? '') };
}

async function main(): Promise<void> {
  const needsServer = SUITES.some((s) => s.server);
  if (needsServer) {
    try {
      const res = await fetch(BASE + '/api/auth/csrf');
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      console.error(
        'No dev server at ' + BASE + '.\n' +
          'Start one pointed at the TEST database first — see docs/local-testing.md.',
      );
      process.exit(1);
    }
  }

  let totalPass = 0;
  let totalFail = 0;
  const failed: string[] = [];

  const hasBuild = existsSync(join(process.cwd(), '.next', 'static'));
  let skipped = 0;

  for (const suite of SUITES) {
    /*
     * `next build` and `next dev` share .next and will corrupt each other's
     * generated route manifest if run at the same time — the symptom is every
     * API route suddenly 404ing. So the bundle check is skipped rather than
     * run here, and gets its own pass against a production build.
     */
    if (suite.build && !hasBuild) {
      console.log('  skip  ' + suite.name.padEnd(10) +
        'needs production build output — run `npm run build` with the dev server stopped');
      skipped++;
      continue;
    }

    if (suite.reset) {
      const reset = run('scripts/reset-test-db.ts');
      if (reset.code !== 0) {
        console.error('reset failed before ' + suite.name + ':\n' + reset.out);
        process.exit(1);
      }
    }

    const { code, out } = run(suite.script, suite.server ? ['--base=' + BASE] : []);
    const tally = /(\d+) passed, (\d+) failed/.exec(out);
    const passed = Number(tally?.[1] ?? 0);
    const failedCount = Number(tally?.[2] ?? (code === 0 ? 0 : 1));

    totalPass += passed;
    totalFail += failedCount;

    const mark = code === 0 ? 'ok  ' : 'FAIL';
    console.log('  ' + mark + '  ' + suite.name.padEnd(10) + passed + ' passed' +
      (failedCount ? ', ' + failedCount + ' failed' : ''));

    if (code !== 0) {
      failed.push(suite.name);
      // Print only the failure lines, not the whole run.
      for (const line of out.split('\n')) {
        if (line.trim().startsWith('- ') || line.includes('FAIL')) {
          console.log('        ' + line.trim());
        }
      }
    }
  }

  console.log('\n' + totalPass + ' passed, ' + totalFail + ' failed across ' +
    SUITES.length + ' suites');
  if (failed.length) console.log('failing suites: ' + failed.join(', '));
  process.exit(failed.length ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
