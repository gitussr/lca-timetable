/**
 * Security audit (§30), as a suite rather than a checklist.
 *
 * Everything here is an actual request. A checklist can be ticked while the
 * application is wrong — this phase found exactly that in the theme code — so
 * each item below tries the attack and asserts the response.
 *
 * Complements check-api.ts, which covers the RBAC matrix. This covers the
 * transport and injection surface: cookies, headers, CSRF, NoSQL operators,
 * XSS, secret leakage, enumeration and rate limiting.
 *
 * Needs a dev server and a freshly reset test database.
 *   npm run test:reset && npm run check:security
 */
const BASE =
  process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';

let pass = 0;
let fail = 0;
const failures: string[] = [];
const notes: string[] = [];

function ok(label: string, cond: boolean, detail = ''): void {
  if (cond) pass++;
  else {
    fail++;
    failures.push(label + (detail ? '  — ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? '  — ' + detail : ''));
  }
}

function note(text: string): void {
  notes.push(text);
}

interface Session {
  cookie: string;
  raw: string[];
}

async function signIn(email: string, password: string): Promise<Session> {
  const csrfRes = await fetch(BASE + '/api/auth/csrf');
  const jar = csrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const res = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    body: new URLSearchParams({ csrfToken, email, password, rememberMe: 'true' }),
    redirect: 'manual',
  });

  const raw = res.headers.getSetCookie();
  const merged = new Map<string, string>();
  for (const part of (jar + '; ' + raw.map((c) => c.split(';')[0]).join('; '))
    .split('; ')
    .filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq > 0) merged.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return { cookie: [...merged].map(([k, v]) => k + '=' + v).join('; '), raw };
}

async function main(): Promise<void> {
  const admin = await signIn('admin@lca.test', 'admin-passphrase-ok');

  /* ------------------------------------------------- session cookies */
  console.log('--- session cookie (§30) ---');
  const sessionCookie = admin.raw.find((c) => c.includes('session-token')) ?? '';
  ok('session cookie is HttpOnly', /HttpOnly/i.test(sessionCookie), sessionCookie.slice(0, 80));
  ok('session cookie is SameSite=Lax or Strict',
    /SameSite=(Lax|Strict)/i.test(sessionCookie),
    sessionCookie.slice(0, 80));
  if (BASE.startsWith('https://')) {
    ok('session cookie is Secure over https', /Secure/i.test(sessionCookie));
  } else {
    note('Secure flag not asserted: this run is over http. Auth.js adds Secure ' +
      'and the __Secure- prefix automatically when AUTH_URL is https.');
  }
  ok('a forged session token is rejected',
    (await fetch(BASE + '/api/bootstrap', { headers: { cookie: 'authjs.session-token=forged' } }))
      .status === 401);

  /* ------------------------------------------------ security headers */
  console.log('--- security headers (§30) ---');
  const headRes = await fetch(BASE + '/', { headers: { cookie: admin.cookie } });
  const h = (name: string) => headRes.headers.get(name) ?? '';
  ok('Content-Security-Policy set', h('content-security-policy').includes("default-src 'self'"));
  ok('CSP forbids framing', h('content-security-policy').includes("frame-ancestors 'none'"));
  ok('CSP restricts connect-src', h('content-security-policy').includes("connect-src 'self'"));
  ok('X-Content-Type-Options: nosniff', h('x-content-type-options') === 'nosniff');
  ok('X-Frame-Options: DENY', h('x-frame-options') === 'DENY');
  ok('Referrer-Policy set', h('referrer-policy').length > 0);
  ok('Permissions-Policy set', h('permissions-policy').includes('camera=()'));
  ok('Strict-Transport-Security set', h('strict-transport-security').includes('max-age='));
  ok('Cross-Origin-Opener-Policy set', h('cross-origin-opener-policy') === 'same-origin');
  ok('server framework not advertised', !headRes.headers.has('x-powered-by'));

  /* ------------------------------------------------------------ CSRF */
  console.log('--- CSRF (§30) ---');
  const foreign = await fetch(BASE + '/api/settings', {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: admin.cookie,
      origin: 'https://evil.example',
    },
    body: JSON.stringify({ slotCapacity: 9, version: 0 }),
  });
  ok('a cross-origin write is refused even with a valid cookie',
    foreign.status === 403, 'got ' + foreign.status);

  const sameOrigin = await fetch(BASE + '/api/me', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: admin.cookie, origin: BASE },
    body: JSON.stringify({ preferredTheme: null }),
  });
  ok('a same-origin write still works', sameOrigin.status === 200, 'got ' + sameOrigin.status);

  /* -------------------------------------------------- NoSQL operators */
  console.log('--- NoSQL injection (§30) ---');
  const courses = (await (await fetch(BASE + '/api/courses', { headers: { cookie: admin.cookie } })).json()) as
    { courses: { id: string }[] };
  const courseId = courses.courses[0]!.id;

  const injections: [string, unknown][] = [
    ['operator as a name', { name: { $ne: null }, courseId, courseMonth: 1 }],
    ['operator as a courseId', { name: 'X', courseId: { $gt: '' }, courseMonth: 1 }],
    ['operator as a number', { name: 'X', courseId, courseMonth: { $gt: 0 } }],
    ['$where payload', { name: { $where: '1==1' }, courseId, courseMonth: 1 }],
    ['array where a string belongs', { name: ['a', 'b'], courseId, courseMonth: 1 }],
  ];
  for (const [label, body] of injections) {
    const res = await fetch(BASE + '/api/students', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: admin.cookie },
      body: JSON.stringify(body),
    });
    ok('rejects ' + label + ' -> 400', res.status === 400, 'got ' + res.status);
  }

  // The same trick against the one query that runs before authentication.
  const loginCsrfRes = await fetch(BASE + '/api/auth/csrf');
  const loginJar = loginCsrfRes.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = (await loginCsrfRes.json()) as { csrfToken: string };
  const injLogin = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: loginJar },
    body: new URLSearchParams({ csrfToken, 'email[$ne]': 'null', 'password[$ne]': 'null' }),
    redirect: 'manual',
  });
  ok('operator injection at login does not authenticate',
    (injLogin.headers.get('location') ?? '').includes('error='),
    injLogin.headers.get('location') ?? '');

  /* ------------------------------------------------------------- XSS */
  console.log('--- stored XSS (§30) ---');
  const payload = '<img src=x onerror=alert(1)>Zed';
  const stored = await fetch(BASE + '/api/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: admin.cookie },
    body: JSON.stringify({ name: payload, courseId, courseMonth: 1 }),
  });
  ok('the payload is accepted as data', stored.status === 201, 'got ' + stored.status);
  const rendered = await (await fetch(BASE + '/', { headers: { cookie: admin.cookie } })).text();
  ok('it renders escaped, not as markup', rendered.includes('&lt;img src=x onerror=alert(1)&gt;'));
  ok('no live img tag reaches the document', !rendered.includes('<img src=x onerror=alert(1)>'));

  /* -------------------------------------------------- secret leakage */
  console.log('--- secrets never reach the client (§30) ---');
  const surfaces: [string, string][] = [
    ['/api/users', await (await fetch(BASE + '/api/users', { headers: { cookie: admin.cookie } })).text()],
    ['/api/bootstrap', await (await fetch(BASE + '/api/bootstrap', { headers: { cookie: admin.cookie } })).text()],
    ['/api/audit-logs', await (await fetch(BASE + '/api/audit-logs', { headers: { cookie: admin.cookie } })).text()],
    ['/api/auth/session', await (await fetch(BASE + '/api/auth/session', { headers: { cookie: admin.cookie } })).text()],
    ['the page HTML', rendered],
  ];
  for (const [where, text] of surfaces) {
    ok('no passwordHash in ' + where, !text.includes('passwordHash'));
    ok('no bcrypt hash in ' + where, !/\$2[aby]\$\d\d\$/.test(text));
    ok('no connection string in ' + where, !/mongodb(\+srv)?:\/\//.test(text));
    ok('no AUTH_SECRET in ' + where, !text.includes('AUTH_SECRET'));
  }

  /* ------------------------------------------------------ enumeration */
  console.log('--- account enumeration (§30) ---');
  const attempt = async (email: string) => {
    const r = await fetch(BASE + '/api/auth/csrf');
    const jar = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const { csrfToken: t } = (await r.json()) as { csrfToken: string };
    const started = Date.now();
    const res = await fetch(BASE + '/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
      body: new URLSearchParams({ csrfToken: t, email, password: 'definitely-wrong-password' }),
      redirect: 'manual',
    });
    return { location: res.headers.get('location') ?? '', ms: Date.now() - started };
  };
  const known = await attempt('editor@lca.test');
  const unknown = await attempt('nobody@lca.test');
  ok('a real and an unknown account give the same error',
    known.location.replace(/[?&]callbackUrl=[^&]*/, '') ===
      unknown.location.replace(/[?&]callbackUrl=[^&]*/, ''),
    known.location + ' vs ' + unknown.location);
  ok('the error names neither the email nor the field',
    !known.location.includes('editor%40') && !/email|password/i.test(known.location),
    known.location);
  note('login timing — known account ' + known.ms + 'ms, unknown ' + unknown.ms +
    'ms (a dummy bcrypt compare runs when no user matches, so the two paths cost the same)');

  /* ---------------------------------------------------- rate limiting */
  console.log('--- login rate limiting (§30) ---');
  let lockedAt = 0;
  for (let i = 1; i <= 11; i++) {
    const r = await attempt('viewer@lca.test');
    if (r.location.includes('too-many-attempts')) {
      lockedAt = i;
      break;
    }
  }
  ok('repeated failures lock the account out', lockedAt > 0, 'never locked out');
  ok('the lockout is not absurdly late', lockedAt > 0 && lockedAt <= 10, 'locked at attempt ' + lockedAt);

  /* ------------------------------------------------- malformed input */
  console.log('--- malformed requests (§43) ---');
  const notJson = await fetch(BASE + '/api/students', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: admin.cookie },
    body: 'this is not json',
  });
  ok('a non-JSON body -> 400, not 500', notJson.status === 400, 'got ' + notJson.status);
  const notJsonText = await notJson.text();
  ok('no stack trace in the error', !/\bat\s+\w+.*\(.*:\d+:\d+\)/.test(notJsonText));

  const badId = await fetch(BASE + '/api/students/' + '../../etc/passwd', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: admin.cookie },
    body: JSON.stringify({ name: 'X', version: 0 }),
  });
  ok('a path-traversal id is refused', badId.status === 404 || badId.status === 400,
    'got ' + badId.status);

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  if (notes.length) {
    console.log('\nnotes:');
    for (const n of notes) console.log('  - ' + n);
  }
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
