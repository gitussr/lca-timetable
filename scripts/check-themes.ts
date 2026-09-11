/**
 * Theme checks (§6, phase 11).
 *
 * The five legacy themes must still exist and still be reachable, and a user's
 * choice must live on their ACCOUNT rather than in one browser's localStorage —
 * that is the part the legacy app could not do.
 *
 * Every request here uses a fresh cookie jar, which is the point: a second jar
 * is a second browser. If the theme survives into it, it came from the server.
 *
 * Needs a dev server and a seeded test database.
 *   npm run check:themes
 */
const BASE =
  process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';

const THEMES = ['theme1', 'theme2', 'theme3', 'theme4', 'theme5'] as const;
const LABELS = ['Midnight Pro', 'Violet Glass', 'Deep Ocean', 'Cyber Lime', 'Graphite Ember'];

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

/** A fresh jar is a fresh browser. */
async function signIn(email: string, password: string): Promise<string> {
  const csrfRes = await fetch(BASE + '/api/auth/csrf');
  const jar = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const res = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    body: new URLSearchParams({ csrfToken, email, password, rememberMe: 'true' }),
    redirect: 'manual',
  });
  const merged = new Map<string, string>();
  for (const part of (jar + '; ' + res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '))
    .split('; ')
    .filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq > 0) merged.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return [...merged].map(([k, v]) => k + '=' + v).join('; ');
}

async function main(): Promise<void> {
  const cookie = await signIn('viewer@lca.test', 'viewer-passphrase-ok');

  console.log('--- the five legacy themes survive (§6) ---');
  const page = await (await fetch(BASE + '/', { headers: { cookie } })).text();
  for (let i = 0; i < THEMES.length; i++) {
    ok('theme option ' + THEMES[i], page.includes('data-theme="' + THEMES[i] + '"'));
    ok('label "' + LABELS[i] + '" unchanged', page.includes(LABELS[i]!));
  }

  // The tokens themselves live in the carried-over stylesheet.
  const cssHref = /\/_next\/static\/[^"']+\.css/.exec(page)?.[0];
  ok('stylesheet is linked', Boolean(cssHref), String(cssHref));
  if (cssHref) {
    const css = await (await fetch(BASE + cssHref)).text();
    for (const t of THEMES) {
      ok('CSS defines ' + t, css.includes('[data-theme="' + t + '"]'));
    }
    for (const token of ['--bg', '--surface', '--primary', '--accent', '--text-dim', '--glass']) {
      ok('token ' + token + ' present', css.includes(token + ':'));
    }
  }

  console.log('--- a viewer may set their own theme (§7) ---');
  const set = await fetch(BASE + '/api/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ preferredTheme: 'theme4' }),
  });
  ok('PATCH /api/me -> 200', set.status === 200, 'got ' + set.status);

  console.log('--- the choice follows the ACCOUNT, not the browser (§6) ---');
  // A brand new sign-in: no localStorage, no shared cookie jar.
  const secondBrowser = await signIn('viewer@lca.test', 'viewer-passphrase-ok');
  const meRes = await fetch(BASE + '/api/me', { headers: { cookie: secondBrowser } });
  const me = (await meRes.json()) as { user?: { preferredTheme?: string | null } };
  ok('session carries the saved theme', me.user?.preferredTheme === 'theme4',
    String(me.user?.preferredTheme));

  const freshPage = await (await fetch(BASE + '/', { headers: { cookie: secondBrowser } })).text();
  // Server-rendered, so the page paints in the right theme with no flash.
  ok('<html> is themed by the server', /<html[^>]+data-theme="theme4"/.test(freshPage),
    /<html[^>]*>/.exec(freshPage)?.[0] ?? '(no html tag found)');

  console.log('--- a change applies to the SAME session, without re-login ---');
  {
    // The bug this guards: preferredTheme was read from the JWT, which is a
    // snapshot taken at sign-in. Saving a new theme wrote the database but not
    // the token, so reloading in the same session silently reverted, and only
    // corrected itself after signing in again. Every check above used a fresh
    // sign-in, which is exactly why they all passed while the app was wrong.
    await fetch(BASE + '/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ preferredTheme: 'theme2' }),
    });
    const sameSession = await (await fetch(BASE + '/', { headers: { cookie } })).text();
    ok('same session reload shows the new theme',
      /<html[^>]+data-theme="theme2"/.test(sameSession),
      /<html[^>]*>/.exec(sameSession)?.[0] ?? '');

    await fetch(BASE + '/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ preferredTheme: 'theme4' }),
    });
    const again = await (await fetch(BASE + '/', { headers: { cookie } })).text();
    ok('and again, after a second change',
      /<html[^>]+data-theme="theme4"/.test(again),
      /<html[^>]*>/.exec(again)?.[0] ?? '');
  }

  console.log('--- an unknown theme is refused (§28) ---');
  const bad = await fetch(BASE + '/api/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ preferredTheme: 'theme9' }),
  });
  ok('bogus theme -> 400', bad.status === 400, 'got ' + bad.status);

  console.log('--- clearing it falls back to the browser (§6) ---');
  const cleared = await fetch(BASE + '/api/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ preferredTheme: null }),
  });
  ok('null theme -> 200', cleared.status === 200, 'got ' + cleared.status);
  const unthemed = await (await fetch(BASE + '/', { headers: { cookie: await signIn('viewer@lca.test', 'viewer-passphrase-ok') } })).text();
  ok('<html> carries no data-theme once cleared',
    !/<html[^>]+data-theme=/.test(unthemed),
    /<html[^>]*>/.exec(unthemed)?.[0] ?? '');
  ok('the localStorage fallback script is still shipped',
    unthemed.includes("localStorage.getItem('selectedTheme')"));
  ok('fallback defers to a server-set attribute',
    unthemed.includes("hasAttribute('data-theme')"));

  /*
   * The login screen's fields must all be styled, not merely the one the legacy
   * page happened to have.
   *
   * The legacy screen had a single input - the LCA1234 "Access code" - so every
   * rule was written as `#passwordInput`. Adding the email field left it with
   * the browser's default chrome: a white box on a dark card, reported twice
   * before it was fixed (2026-09-11). Nothing failed; it just looked broken.
   *
   * So: every input inside `.input-wrap` must be covered by a shared rule, not
   * by a rule keyed to one element's id.
   */
  console.log('--- login fields are all styled ---');
  const loginHtml = await (await fetch(BASE + '/login')).text();
  const wrapped = [...loginHtml.matchAll(/<div class="input-wrap">\s*<input[^>]*\bid="([^"]+)"/g)]
    .map((m) => m[1]!);
  ok('login has more than one styled field', wrapped.length >= 2, wrapped.join(', '));

  const loginCss = /href="([^"]*\.css)"/.exec(loginHtml)?.[1];
  ok('found the stylesheet', Boolean(loginCss), String(loginCss));
  if (loginCss) {
    const css = await (await fetch(BASE + loginCss)).text();
    const shared = /\.input-wrap input\s*\{[^}]*background:/.test(css);
    ok('a shared rule gives every wrapped input its background', shared);
    for (const id of wrapped) {
      ok('#' + id + ' is styled without needing its own id rule', shared);
    }
  }


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

// No imports, so mark this a module — otherwise its top-level consts are
// globals and collide with the other check scripts during typecheck.
export {};
