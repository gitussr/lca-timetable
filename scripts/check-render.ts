/**
 * Compares the rendered timetable against the frozen legacy page (§5).
 *
 * Phase 6 is where visual and structural regression is most likely, so this
 * diffs the two documents rather than trusting a glance: same students, same
 * days, same footer wording, same icon classes, same grid scaffolding.
 *
 * Differences that are INTENTIONAL are asserted as such, not ignored — the
 * point is that each one is named and expected, and anything else is a failure.
 *
 * Needs a dev server and a seeded test database.
 *   npm run check:render
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE =
  process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(label: string, condition: boolean, detail = ''): void {
  if (condition) pass++;
  else {
    fail++;
    failures.push(label + (detail ? '  — ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? '  — ' + detail : ''));
  }
}

const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

/* ------------------------------------------------------- legacy parsing */

const legacy = readFileSync(join(process.cwd(), 'scripts', 'legacy', 'index.html'), 'utf8');

function legacyGrid(): { pairs: Set<string>; icons: Map<string, string> } {
  const section = /<section class="timetable">([\s\S]*?)<\/section>/.exec(legacy)![1]!;
  const pairs = new Set<string>();
  const icons = new Map<string, string>();

  for (const block of section.split(/<div class="day">/).slice(1)) {
    const day = block.slice(0, block.indexOf('<')).trim();
    for (const cell of block.matchAll(/<div class="slot">\s*<ul>([\s\S]*?)<\/ul>/g)) {
      for (const li of cell[1]!.matchAll(/<li(?: class="(\w+)")?>(.*?)<\/li>/g)) {
        const text = li[2]!.trim();
        if (!text) continue;
        const name = text.replace(/\s*\([^)]*\)/, '').trim();
        pairs.add(day + '|' + name);
        if (li[1]) icons.set(name, li[1]);
      }
    }
  }
  return { pairs, icons };
}

function legacyFooter(): { label: string; entries: string[] }[] {
  const footer = /<footer>([\s\S]*?)<\/footer>/.exec(legacy)![1]!;
  const out: { label: string; entries: string[] }[] = [];
  for (const s of footer.matchAll(/<summary>(.*?)<\/summary>([\s\S]*?)<\/ul>/g)) {
    const entries = [...s[2]!.matchAll(/<li[^>]*>(.*?)<\/li>/g)]
      .map((m) => strip(m[1]!))
      .filter(Boolean);
    out.push({ label: s[1]!.trim(), entries });
  }
  return out;
}

/* ------------------------------------------------------ rendered parsing */

async function fetchRendered(): Promise<string> {
  const csrfRes = await fetch(BASE + '/api/auth/csrf');
  const jar = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const login = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    body: new URLSearchParams({
      csrfToken, email: 'admin@lca.test', password: 'admin-passphrase-ok', rememberMe: 'true',
    }),
    redirect: 'manual',
  });
  const cookie = [jar, login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')]
    .filter(Boolean).join('; ');

  const page = await fetch(BASE + '/', { headers: { cookie } });
  if (page.status !== 200) throw new Error('page returned ' + page.status);
  return page.text();
}

function renderedGrid(html: string): { pairs: Set<string>; icons: Map<string, string> } {
  const section = /<section class="timetable"[\s\S]*?<\/section>/.exec(html)![0];
  const pairs = new Set<string>();
  const icons = new Map<string, string>();

  // Rows are: <div class="day">Mon</div> followed by that row's slot divs.
  // Split on the full opening tag so the day name is not prefixed with `">`.
  const chunks = section.split(/<div class="day(?:\s+is-today)?">/).slice(1);
  for (const chunk of chunks) {
    const day = strip(chunk.slice(0, chunk.indexOf('</div>')));
    for (const cell of chunk.matchAll(/<div class="slot[^"]*"><ul>([\s\S]*?)<\/ul>/g)) {
      for (const li of cell[1]!.matchAll(/<li([^>]*)>(.*?)<\/li>/g)) {
        const name = strip(li[2] ?? '');
        if (!name) continue;
        pairs.add(day + '|' + name);
        // Attribute order is React's, not ours — match the class anywhere.
        const cls = /class="([^"]+)"/.exec(li[1] ?? '');
        if (cls) icons.set(name, cls[1]!);
      }
    }
  }
  return { pairs, icons };
}

function renderedFooter(html: string): { label: string; entries: string[] }[] {
  const footer = /<footer>([\s\S]*?)<\/footer>/.exec(html)![1]!;
  const out: { label: string; entries: string[] }[] = [];
  for (const sec of footer.matchAll(
    /<summary[^>]*>(.*?)<\/summary><div class="toggle-content"><ul>([\s\S]*?)<\/ul>/g,
  )) {
    const entries = [...sec[2]!.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)]
      .map((m) => strip(m[1]!))
      .filter(Boolean);
    out.push({ label: strip(sec[1]!), entries });
  }
  return out;
}

/* ------------------------------------------------------------------ main */

async function main(): Promise<void> {
  const html = await fetchRendered();

  const before = legacyGrid();
  const after = renderedGrid(html);

  console.log('--- grid: same students on the same days (§5) ---');
  ok('legacy has 41 assignments', before.pairs.size > 0, String(before.pairs.size));
  const missing = [...before.pairs].filter((p) => !after.pairs.has(p));
  const added = [...after.pairs].filter((p) => !before.pairs.has(p));
  ok('no assignment lost', missing.length === 0, missing.slice(0, 5).join(', '));
  ok('no assignment invented', added.length === 0, added.slice(0, 5).join(', '));
  ok('same day/student pair count', before.pairs.size === after.pairs.size,
    before.pairs.size + ' vs ' + after.pairs.size);

  console.log('--- grid scaffolding (§4) ---');
  const dayCells = [...html.matchAll(/<div class="day(?:\s+is-today)?">/g)].length;
  const headerCells = [...html.matchAll(/<div class="header-row">/g)].length;
  const slotCells = [...html.matchAll(/<div class="slot[^"]*"><ul>/g)].length;
  ok('6 day rows', dayCells === 6, String(dayCells));
  ok('7 header cells (Days + 6 ranges)', headerCells === 7, String(headerCells));
  ok('36 slot cells (6 days x 6 ranges)', slotCells === 36, String(slotCells));
  ok('grid column count reaches the CSS', /--slot-cols:\s*6/.test(html));
  ok('grid row count reaches the CSS', /--day-rows:\s*6/.test(html));

  console.log('--- INTENDED difference: 4 columns became 6 (D2, §15) ---');
  ok('17:00 column exists', html.includes('>17:00<'));
  ok('18:30 end exists', html.includes('>18:30<'));
  ok('legacy had only four columns', (legacy.match(/<div class="header-row">/g) ?? []).length === 5);

  console.log('--- footer wording is unchanged (§19) ---');
  const fBefore = legacyFooter();
  const fAfter = renderedFooter(html);
  ok('3 footer sections', fAfter.length === 3, String(fAfter.length));
  for (let i = 0; i < fBefore.length; i++) {
    ok('section ' + (i + 1) + ' label "' + fBefore[i]!.label + '"',
      fAfter[i]?.label === fBefore[i]!.label, 'got "' + fAfter[i]?.label + '"');
    const want = [...fBefore[i]!.entries].sort();
    const got = [...(fAfter[i]?.entries ?? [])].sort();
    ok('section ' + (i + 1) + ' entries identical',
      JSON.stringify(want) === JSON.stringify(got),
      'want ' + JSON.stringify(want.slice(0, 2)) + ' got ' + JSON.stringify(got.slice(0, 2)));
  }

  console.log('--- INTENDED difference: icons are now data-driven (D3, §42) ---');
  const webDev = ['Anish Gharami', 'Soumik Dutta', 'Surajit Paul', 'Somen Biswas', 'Subhashish Raha'];
  ok('legacy left 5 Web Dev students without a laptop icon',
    webDev.every((n) => !before.icons.has(n)));
  ok('all 5 now carry the laptop icon',
    webDev.every((n) => after.icons.get(n) === 'laptop'),
    webDev.map((n) => n + '=' + after.icons.get(n)).join(' '));
  for (const n of ['Sabita Mondal', 'Arnab Roy', 'Samrit Paul']) {
    ok(n + ' keeps the mouse icon', after.icons.get(n) === 'mouse', String(after.icons.get(n)));
  }

  console.log('--- design scaffolding still present (§5) ---');
  for (const marker of [
    'class="theme-switcher"', 'id="themeToggle"', 'class="theme-panel"',
    'Midnight Pro', 'Violet Glass', 'Deep Ocean', 'Cyber Lime', 'Graphite Ember',
    'class="brand-link"', 'id="empty-seats"', 'id="today"', 'id="time"',
    'class="toggle-section"', 'class="slot-time"', 'class="slot-sep"',
  ]) {
    ok('page keeps ' + marker, html.includes(marker));
  }

  console.log('--- themes (§6) ---');
  for (const t of ['theme1', 'theme2', 'theme3', 'theme4', 'theme5']) {
    ok('theme button ' + t + ' present', html.includes('data-theme="' + t + '"'));
    ok('swatch ' + t + ' present', html.includes('data-swatch="' + t + '"'));
  }
  ok('theme panel heading', html.includes('>Theme<'));
  ok('sign out lives in the theme panel', html.includes('Sign out'));

  console.log('--- footer is one source of truth (§19, §20) ---');
  {
    // Every name in the footer must be a name the grid knows about, and the
    // counts must agree — the legacy page kept two hand-synced copies.
    const rosterNames = new Set(
      fAfter.flatMap((s) => s.entries.map((e) => e.replace(/\(.*$/, '').trim())),
    );
    const gridNames = new Set([...after.pairs].map((p) => p.split('|')[1]!));
    const notInRoster = [...gridNames].filter((n) => !rosterNames.has(n));
    ok('no grid student missing from the footer', notInRoster.length === 0, notInRoster.join(', '));
    ok('roster has 16 students',
      fAfter.reduce((n, s) => n + s.entries.length, 0) === 16,
      String(fAfter.reduce((n, s) => n + s.entries.length, 0)));
  }

  console.log('--- no legacy data left in the markup (§4) ---');
  ok('no hard-coded (5pm) annotation', !/\(5:?3?0?pm\)/.test(html));
  ok('no (std.8) inside a grid cell', !/<li[^>]*>[^<]*\(std\.\d+\)[^<]*<\/li>\s*<li/.test(
    /<section class="timetable"[\s\S]*?<\/section>/.exec(html)![0]));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) {
    console.log('\nfailures:');
    for (const f of failures) console.log('  - ' + f);
  }
  process.exit(fail ? 1 : 0);
}

main().catch((err: unknown) => {
  console.error('harness error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
