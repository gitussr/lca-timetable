/**
 * Edge cases (§48).
 *
 * The other suites cover the happy paths and the RBAC matrix. This one covers
 * the list §48 asks for by name and the rest do not reach: logout, two people
 * editing the same schedule, an empty timetable, duplicate students, unusual
 * and long names, capacity overflow, course CRUD, and realtime delivery
 * asserted by a program rather than by me watching a browser.
 *
 * Destructive — it empties the timetable near the end. Reset before running.
 *   npm run test:reset && npm run check:edge
 */
const BASE =
  process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';

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

async function signIn(email: string, password: string): Promise<string> {
  const r = await fetch(BASE + '/api/auth/csrf');
  const jar = r.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const { csrfToken } = (await r.json()) as { csrfToken: string };
  const res = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    body: new URLSearchParams({ csrfToken, email, password, rememberMe: 'true' }),
    redirect: 'manual',
  });
  const merged = new Map<string, string>();
  for (const part of (jar + '; ' + res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; '))
    .split('; ').filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq > 0) merged.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return [...merged].map(([k, v]) => k + '=' + v).join('; ');
}

interface Reply { status: number; body: Record<string, unknown>; raw: string }

async function call(cookie: string, method: string, path: string, body?: unknown): Promise<Reply> {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(raw) as Record<string, unknown>; } catch { /* not JSON */ }
  return { status: res.status, body: parsed, raw };
}

/** Reads SSE frames off a live stream until `predicate` matches or time runs out. */
async function awaitStreamEvent(
  cookie: string,
  predicate: (event: Record<string, unknown>) => boolean,
  trigger: () => Promise<void>,
  timeoutMs = 8000,
): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const res = await fetch(BASE + '/api/stream', {
    headers: { cookie, accept: 'text/event-stream' },
    signal: controller.signal,
  });
  if (!res.body) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let found: Record<string, unknown> | null = null;

  // Let the change stream open before making the change it should observe.
  const triggered = (async () => {
    await new Promise((r) => setTimeout(r, 1200));
    await trigger();
  })();

  const deadline = Date.now() + timeoutMs;
  try {
    while (Date.now() < deadline && !found) {
      const chunk = await Promise.race([
        reader.read(),
        new Promise<{ done: true; value: undefined }>((r) =>
          setTimeout(() => r({ done: true, value: undefined }), deadline - Date.now()),
        ),
      ]);
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6)) as Record<string, unknown>;
            if (predicate(event)) found = event;
          } catch { /* heartbeat or partial */ }
        }
      }
    }
  } finally {
    controller.abort();
    await triggered.catch(() => undefined);
  }
  return found;
}

async function main(): Promise<void> {
  const admin = await signIn('admin@lca.test', 'admin-passphrase-ok');
  const editor = await signIn('editor@lca.test', 'editor-passphrase-ok');

  const boot = await call(admin, 'GET', '/api/bootstrap');
  const students = boot.body.students as { id: string; name: string; version: number }[];
  const courses = boot.body.courses as { id: string; name: string; version: number }[];
  const schedules = boot.body.schedules as
    { id: string; studentId: string; day: string; startTime: string; endTime: string; version: number }[];
  const settings = boot.body.settings as
    { version: number; slotCapacity: number; timeRanges: { id: string; startTime: string; endTime: string }[] };
  const courseId = courses[0]!.id;

  /* ------------------------------------------------------------- logout */
  console.log('--- logout ends the session (§48) ---');
  {
    const throwaway = await signIn('viewer@lca.test', 'viewer-passphrase-ok');
    ok('signed in before logout',
      (await call(throwaway, 'GET', '/api/bootstrap')).status === 200);

    const { csrfToken } = (await (await fetch(BASE + '/api/auth/csrf', {
      headers: { cookie: throwaway },
    })).json()) as { csrfToken: string };
    const out = await fetch(BASE + '/api/auth/signout', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: throwaway },
      body: new URLSearchParams({ csrfToken }),
      redirect: 'manual',
    });
    const cleared = out.headers.getSetCookie().some(
      (c) => c.includes('session-token=;') || /session-token=;?\s*(Path|Expires|Max-Age)/i.test(c),
    );
    ok('logout clears the session cookie', cleared,
      out.headers.getSetCookie().join(' | ').slice(0, 120));

    /*
     * NOT asserted: that replaying the old cookie value stops working. Under
     * the JWT strategy the token stays cryptographically valid until it
     * expires — signing out clears it from the browser, which is what a person
     * doing it means, but it is not server-side revocation. What IS asserted
     * below is the case that actually matters: an admin deactivating an
     * account cuts off access immediately, token or no token.
     */
  }

  /* ------------------------------------------ deactivation is immediate */
  console.log('--- deactivating an account revokes it at once (§7, §30) ---');
  {
    const doomed = await signIn('viewer@lca.test', 'viewer-passphrase-ok');
    ok('the account works to start with',
      (await call(doomed, 'GET', '/api/bootstrap')).status === 200);

    const users = (await call(admin, 'GET', '/api/users')).body.users as
      { id: string; email: string; version: number }[];
    const viewerId = users.find((u) => u.email === 'viewer@lca.test')!.id;
    ok('admin deactivates them',
      (await call(admin, 'DELETE', '/api/users/' + viewerId)).status === 200);

    // The token they already hold must stop working straight away, not in 30 days.
    ok('their existing token is refused on read',
      (await call(doomed, 'GET', '/api/bootstrap')).status === 401,
      'got ' + (await call(doomed, 'GET', '/api/bootstrap')).status);
    ok('their existing token is refused on /api/me',
      (await call(doomed, 'GET', '/api/me')).status === 401);
    ok('and they cannot sign in again',
      !(await signIn('viewer@lca.test', 'viewer-passphrase-ok')).includes('session-token='));
  }

  /* -------------------------------------------- a role change is immediate */
  console.log('--- a role change takes effect at once (§7) ---');
  {
    const users = (await call(admin, 'GET', '/api/users')).body.users as
      { id: string; email: string; role: string; version: number }[];
    const ed = users.find((u) => u.email === 'editor@lca.test')!;

    ok('the editor may add students now',
      (await call(editor, 'POST', '/api/students',
        { name: 'Before Demotion', courseId, courseMonth: 1 })).status === 201);

    const demoted = await call(admin, 'PATCH', '/api/users/' + ed.id,
      { role: 'viewer', version: ed.version });
    ok('admin demotes them to viewer', demoted.status === 200, 'got ' + demoted.status);

    // Same cookie, no re-login: the demotion must already apply.
    const blocked = await call(editor, 'POST', '/api/students',
      { name: 'After Demotion', courseId, courseMonth: 1 });
    ok('their existing token now gets 403', blocked.status === 403, 'got ' + blocked.status);
    ok('the message names the role they actually have',
      String(blocked.body.detail ?? '').includes('viewer'), String(blocked.body.detail));

    // Put it back so the rest of the run behaves.
    const again = (await call(admin, 'GET', '/api/users')).body.users as
      { id: string; email: string; version: number }[];
    const now = again.find((u) => u.email === 'editor@lca.test')!;
    await call(admin, 'PATCH', '/api/users/' + now.id, { role: 'editor', version: now.version });
    ok('promoting them back also takes effect at once',
      (await call(editor, 'POST', '/api/students',
        { name: 'After Restore', courseId, courseMonth: 1 })).status === 201);
  }

  /* ------------------------------- two users edit the SAME schedule */
  console.log('--- two users edit the same schedule (§48) ---');
  {
    const target = schedules[0]!;
    const range = settings.timeRanges.find((r) => r.startTime !== target.startTime)!;

    const first = await call(admin, 'PATCH', '/api/schedules/' + target.id, {
      day: target.day, startTime: range.startTime, endTime: range.endTime, version: target.version,
    });
    ok('first writer wins', first.status === 200, 'got ' + first.status);

    const second = await call(editor, 'PATCH', '/api/schedules/' + target.id, {
      day: 'Sat', startTime: range.startTime, endTime: range.endTime, version: target.version,
    });
    ok('second writer gets 409', second.status === 409, 'got ' + second.status);
    ok('409 carries the winning schedule', Boolean(second.body.current));
    const current = (second.body.current ?? {}) as { startTime?: string; version?: number };
    ok('current shows the first write', current.startTime === range.startTime, String(current.startTime));
    ok('version advanced exactly once', current.version === target.version + 1, String(current.version));
  }

  /* --------------------------------------------------- duplicate students */
  console.log('--- duplicate student data (§20, §48) ---');
  {
    const existing = students[0]!.name;
    const dup = await call(editor, 'POST', '/api/students', {
      name: existing, courseId, courseMonth: 1,
    });
    ok('adding an existing name -> 409', dup.status === 409, 'got ' + dup.status);

    const other = students[1]!;
    const rename = await call(editor, 'PATCH', '/api/students/' + other.id, {
      name: existing, version: other.version,
    });
    ok('renaming onto an existing name -> 409', rename.status === 409, 'got ' + rename.status);

    // A removed student must not hold their name hostage.
    const temp = await call(editor, 'POST', '/api/students', {
      name: 'Temporary Person', courseId, courseMonth: 1,
    });
    ok('created a temp student', temp.status === 201, 'got ' + temp.status);
    const tempId = (temp.body.student as { id: string }).id;
    ok('removed them', (await call(admin, 'DELETE', '/api/students/' + tempId)).status === 200);
    const reuse = await call(editor, 'POST', '/api/students', {
      name: 'Temporary Person', courseId, courseMonth: 1,
    });
    ok('the freed name can be reused', reuse.status === 201, 'got ' + reuse.status);
    await call(admin, 'DELETE', '/api/students/' + (reuse.body.student as { id: string }).id);
  }

  /* ------------------------------------------------ unusual + long names */
  console.log('--- unusual and long names (§48) ---');
  {
    const names = [
      ['Bengali script', 'শ্রীজিতা কর্মকার'],
      ['accents', 'José Ángel Múñoz-Peña'],
      ['apostrophe', "O'Brien D'Souza"],
      ['emoji', 'Rahul 🎓 Sharma'],
      ['double-barrelled', 'Anne-Marie van der Berg'],
      ['single character', 'X'],
    ];
    const created: string[] = [];
    for (const [label, name] of names) {
      const res = await call(editor, 'POST', '/api/students', { name, courseId, courseMonth: 1 });
      ok('accepts ' + label, res.status === 201, 'got ' + res.status);
      if (res.status === 201) {
        const s = res.body.student as { id: string; name: string };
        ok('stores ' + label + ' unmangled', s.name === name, s.name);
        created.push(s.id);
      }
    }

    ok('80 characters is accepted',
      (await call(editor, 'POST', '/api/students',
        { name: 'A'.repeat(80), courseId, courseMonth: 1 })).status === 201);
    ok('81 characters is refused',
      (await call(editor, 'POST', '/api/students',
        { name: 'B'.repeat(81), courseId, courseMonth: 1 })).status === 400);
    ok('whitespace-only is refused',
      (await call(editor, 'POST', '/api/students',
        { name: '   ', courseId, courseMonth: 1 })).status === 400);

    // A long name must not break the page render.
    const page = await (await fetch(BASE + '/', { headers: { cookie: admin } })).text();
    ok('the page still renders with odd names', page.includes('class="timetable"'));
    ok('unicode survives to the HTML', page.includes('শ্রীজিতা'));

    for (const id of created) await call(admin, 'DELETE', '/api/students/' + id);
  }

  /* ----------------------------------------------------- capacity overflow */
  console.log('--- more students in a cell than slotCapacity (§48) ---');
  {
    const range = settings.timeRanges[0]!;
    const day = 'Sat';
    const spare = students.slice(0, settings.slotCapacity + 2);
    let placed = 0;
    for (const s of spare) {
      const res = await call(editor, 'POST', '/api/schedules', {
        studentId: s.id, day, startTime: range.startTime, endTime: range.endTime,
      });
      if (res.status === 201) placed++;
    }
    ok('the server does not cap a cell at slotCapacity',
      placed > settings.slotCapacity, placed + ' placed, capacity ' + settings.slotCapacity);
    const page = await (await fetch(BASE + '/', { headers: { cookie: admin } })).text();
    ok('an over-full cell still renders', page.includes('class="timetable"'));
  }

  /* ------------------------------------------------------------ course CRUD */
  console.log('--- course CRUD (§48) ---');
  {
    const made = await call(admin, 'POST', '/api/courses', {
      name: 'Spoken English', shortName: 'English', order: 5,
      defaultDuration: 60, sessionsPerWeek: 2, icon: 'plane',
    });
    ok('admin creates a course', made.status === 201, 'got ' + made.status);
    const course = made.body.course as { id: string; version: number; icon: string; slug: string };
    ok('slug derived from the name', course.slug === 'spoken-english', course.slug);
    ok('icon stored as a key, not markup', course.icon === 'plane', course.icon);

    const upd = await call(admin, 'PATCH', '/api/courses/' + course.id, {
      sessionsPerWeek: 3, version: course.version,
    });
    ok('admin updates it', upd.status === 200, 'got ' + upd.status);
    ok('unrelated fields survive',
      (upd.body.course as { shortName: string }).shortName === 'English',
      String((upd.body.course as { shortName: string }).shortName));

    ok('an unused course can be deleted',
      (await call(admin, 'DELETE', '/api/courses/' + course.id)).status === 200);
  }

  /* -------------------------------------------------------------- realtime */
  console.log('--- realtime delivery, asserted by program (§23, §48) ---');
  {
    const victim = students[3]!;
    const event = await awaitStreamEvent(
      editor,
      (e) => e.kind === 'change' && e.coll === 'students' &&
        (e.doc as { name?: string } | undefined)?.name === victim.name,
      async () => {
        const fresh = (await call(admin, 'GET', '/api/students')).body.students as
          { id: string; version: number }[];
        const v = fresh.find((s) => s.id === victim.id)!;
        await call(admin, 'PATCH', '/api/students/' + victim.id,
          { courseMonth: 44, version: v.version });
      },
    );
    ok('the edit arrived on another user\'s stream', event !== null,
      event ? '' : 'no event within 8s');
    if (event) {
      const doc = event.doc as { courseMonth: number };
      ok('it carries the new value', doc.courseMonth === 44, String(doc.courseMonth));
      const by = event.by as { name?: string } | null;
      ok('it names the editor', by?.name === 'Test admin', String(by?.name));
    }
  }

  /* -------------------------------------------------------- empty timetable */
  console.log('--- an empty timetable renders (§48) ---');
  {
    const all = (await call(admin, 'GET', '/api/bootstrap')).body.schedules as { id: string }[];
    for (const s of all) await call(editor, 'DELETE', '/api/schedules/' + s.id);

    const after = await call(admin, 'GET', '/api/bootstrap');
    ok('no schedules remain', (after.body.schedules as unknown[]).length === 0,
      String((after.body.schedules as unknown[]).length));
    ok('students remain on the roster', (after.body.students as unknown[]).length > 0);

    const page = await (await fetch(BASE + '/', { headers: { cookie: admin } })).text();
    ok('the page renders', page.includes('class="timetable"'));
    ok('the grid scaffolding is intact', page.includes('class="header-row"'));
    ok('the footer still lists students', page.includes('Web Dev (Old)'));
    // React separates interpolated text nodes with <!-- -->, so the number is
    // not adjacent to the label in the HTML.
    const seats = /Empty Seats:\s*(?:<!-- -->)?\s*(\d+)/.exec(page)?.[1];
    ok('empty seats is computed, not blank or NaN', Boolean(seats), String(seats));
    ok('empty seats equals days x columns x rows / divisor',
      seats === '60', String(seats) + ' (expected 60)');
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
