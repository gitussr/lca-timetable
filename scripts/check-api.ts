/**
 * API integration checks — RBAC, validation, concurrency, referential integrity.
 *
 * §48 is explicit that security testing means calling the endpoints directly as
 * an under-privileged user, not checking whether a button is hidden. Every
 * "denied" case below is a real HTTP request carrying a real viewer or editor
 * session cookie.
 *
 * Needs a running dev server and a seeded database — see docs/local-testing.md.
 *   npm run check:api  [-- --base=http://localhost:3000]
 */
const BASE =
  process.argv.find((a) => a.startsWith('--base='))?.split('=')[1] ?? 'http://localhost:3000';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    pass++;
  } else {
    fail++;
    failures.push(label + (detail ? '  — ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? '  — ' + detail : ''));
  }
}

/* ------------------------------------------------------------ session */

interface Session {
  role: string;
  cookie: string;
}

/** Auth.js requires a CSRF token plus its cookie on the credentials callback. */
async function login(email: string, password: string): Promise<Session> {
  const csrfRes = await fetch(BASE + '/api/auth/csrf');
  const jar = collectCookies(csrfRes);
  const { csrfToken } = (await csrfRes.json()) as { csrfToken: string };

  const res = await fetch(BASE + '/api/auth/callback/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: jar },
    body: new URLSearchParams({ csrfToken, email, password, rememberMe: 'false' }),
    redirect: 'manual',
  });

  const cookie = mergeCookies(jar, collectCookies(res));
  const session = (await (await fetch(BASE + '/api/auth/session', { headers: { cookie } })).json()) as {
    user?: { role: string };
  };
  if (!session.user) throw new Error('login failed for ' + email);
  return { role: session.user.role, cookie };
}

function collectCookies(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
}

function mergeCookies(a: string, b: string): string {
  const map = new Map<string, string>();
  for (const part of (a + '; ' + b).split('; ').filter(Boolean)) {
    const eq = part.indexOf('=');
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  return [...map].map(([k, v]) => k + '=' + v).join('; ');
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
  raw: string;
}

async function call(
  session: Session | null,
  method: string,
  path: string,
  body?: unknown,
): Promise<Reply> {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(session ? { cookie: session.cookie } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const raw = await res.text();
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* non-JSON (a redirect body, say) */
  }
  return { status: res.status, body: parsed, raw };
}

/* --------------------------------------------------------------- main */

async function main(): Promise<void> {
  const anon = null;
  const admin = await login('admin@lca.test', 'admin-passphrase-ok');
  const editor = await login('editor@lca.test', 'editor-passphrase-ok');
  const viewer = await login('viewer@lca.test', 'viewer-passphrase-ok');
  console.log('signed in: admin / editor / viewer\n');

  const boot = await call(admin, 'GET', '/api/bootstrap');
  const students = boot.body.students as { id: string; name: string; version: number }[];
  const courses = boot.body.courses as { id: string; name: string; version: number }[];
  const schedules = boot.body.schedules as { id: string; version: number; day: string }[];
  const settings = boot.body.settings as { version: number; timeRanges: unknown[] };

  console.log('--- bootstrap ---');
  ok('bootstrap returns 200', boot.status === 200);
  ok('16 students', students?.length === 16, 'got ' + students?.length);
  ok('41 schedules', schedules?.length === 41, 'got ' + schedules?.length);
  ok('2 courses', courses?.length === 2);
  ok('6 time ranges', settings?.timeRanges?.length === 6);

  console.log('--- unauthenticated is refused everywhere (§8) ---');
  for (const [method, path] of [
    ['GET', '/api/bootstrap'],
    ['GET', '/api/students'],
    ['POST', '/api/students'],
    ['GET', '/api/users'],
    ['GET', '/api/audit-logs'],
    ['GET', '/api/settings'],
  ] as const) {
    const r = await call(anon, method, path, method === 'POST' ? {} : undefined);
    ok('anon ' + method + ' ' + path + ' -> 401', r.status === 401, 'got ' + r.status);
  }

  console.log('--- viewer may read, may not write (§7) ---');
  ok('viewer GET bootstrap -> 200', (await call(viewer, 'GET', '/api/bootstrap')).status === 200);
  ok('viewer GET students -> 200', (await call(viewer, 'GET', '/api/students')).status === 200);

  const viewerWrites: [string, string, unknown][] = [
    ['POST', '/api/students', { name: 'Hacker', courseId: courses[0]!.id, courseMonth: 1 }],
    ['PATCH', '/api/students/' + students[0]!.id, { name: 'Renamed', version: students[0]!.version }],
    ['DELETE', '/api/students/' + students[0]!.id, undefined],
    ['POST', '/api/schedules', { studentId: students[0]!.id, day: 'Mon', startTime: '09:00', endTime: '10:00' }],
    ['DELETE', '/api/schedules/' + schedules[0]!.id, undefined],
    ['PATCH', '/api/schedules/' + schedules[0]!.id, { day: 'Tue', startTime: '09:00', endTime: '10:00', version: schedules[0]!.version }],
    ['POST', '/api/courses', { name: 'X', defaultDuration: 60, sessionsPerWeek: 1, icon: 'laptop' }],
    ['PATCH', '/api/settings', { slotCapacity: 9, version: settings.version }],
    ['GET', '/api/users', undefined],
    ['POST', '/api/users', { name: 'X', email: 'x@y.co', password: 'a-long-passphrase', role: 'admin' }],
    ['GET', '/api/audit-logs', undefined],
  ];
  for (const [method, path, payload] of viewerWrites) {
    const r = await call(viewer, method, path, payload);
    ok('viewer ' + method + ' ' + path.replace(/[0-9a-f]{24}/, ':id') + ' -> 403',
      r.status === 403, 'got ' + r.status);
  }

  console.log('--- editor may edit the timetable, not users or courses (§7) ---');
  const editorAllowed = await call(editor, 'POST', '/api/students', {
    name: 'Editor Added Student',
    courseId: courses[0]!.id,
    courseMonth: 4,
  });
  ok('editor POST /api/students -> 201', editorAllowed.status === 201, 'got ' + editorAllowed.status);
  const newStudent = (editorAllowed.body.student ?? {}) as { id: string; version: number };

  for (const [method, path, payload] of [
    ['GET', '/api/users', undefined],
    ['POST', '/api/users', { name: 'X', email: 'z@y.co', password: 'a-long-passphrase', role: 'admin' }],
    ['POST', '/api/courses', { name: 'Sneaky', defaultDuration: 60, sessionsPerWeek: 1, icon: 'laptop' }],
    ['PATCH', '/api/courses/' + courses[0]!.id, { name: 'Renamed', version: courses[0]!.version }],
    ['DELETE', '/api/courses/' + courses[0]!.id, undefined],
    ['GET', '/api/audit-logs', undefined],
    ['DELETE', '/api/students/' + newStudent.id, undefined],
  ] as [string, string, unknown][]) {
    const r = await call(editor, method, path, payload);
    ok('editor ' + method + ' ' + path.replace(/[0-9a-f]{24}/, ':id') + ' -> 403',
      r.status === 403, 'got ' + r.status);
  }

  console.log('--- editor may add a time range, not change days (§7, §40) ---');
  const ranges = [...(settings.timeRanges as { id: string; startTime: string; endTime: string; order: number }[])];
  const addRange = await call(editor, 'PATCH', '/api/settings', {
    version: settings.version,
    timeRanges: [...ranges, { id: 'r-2000-2130', startTime: '20:00', endTime: '21:30', order: 99 }],
  });
  ok('editor adds a time range -> 200', addRange.status === 200, 'got ' + addRange.status);
  const settingsV2 = (addRange.body.settings ?? {}) as { version: number; timeRanges: unknown[] };
  ok('7 ranges now', settingsV2.timeRanges?.length === 7, 'got ' + settingsV2.timeRanges?.length);

  const editorDays = await call(editor, 'PATCH', '/api/settings', {
    version: settingsV2.version,
    days: ['Mon', 'Tue'],
  });
  ok('editor changing days -> 403', editorDays.status === 403, 'got ' + editorDays.status);

  // Removing a range that still holds classes must be refused, or those
  // schedules become invisible rows with no column to render in (§40).
  const occupied = ranges.find((r) => r.startTime === '10:30');
  const dropOccupied = await call(editor, 'PATCH', '/api/settings', {
    version: settingsV2.version,
    timeRanges: (settingsV2.timeRanges as typeof ranges).filter((r) => r.id !== occupied!.id),
  });
  ok('removing an occupied time range -> 409', dropOccupied.status === 409, 'got ' + dropOccupied.status);
  ok('409 names how many classes block it', typeof dropOccupied.body.occupied === 'number',
    JSON.stringify(dropOccupied.body).slice(0, 110));

  // Removing an empty one is fine.
  const dropEmpty = await call(editor, 'PATCH', '/api/settings', {
    version: settingsV2.version,
    timeRanges: (settingsV2.timeRanges as typeof ranges).filter((r) => r.id !== 'r-2000-2130'),
  });
  ok('removing an empty time range -> 200', dropEmpty.status === 200, 'got ' + dropEmpty.status);
  ok('back to 6 ranges',
    ((dropEmpty.body.settings ?? {}) as { timeRanges?: unknown[] }).timeRanges?.length === 6,
    String(((dropEmpty.body.settings ?? {}) as { timeRanges?: unknown[] }).timeRanges?.length));

  console.log('--- optimistic concurrency (§24) ---');
  const target = students[0]!;
  const first = await call(admin, 'PATCH', '/api/students/' + target.id, {
    courseMonth: 99,
    version: target.version,
  });
  ok('first write with correct version -> 200', first.status === 200, 'got ' + first.status);

  const stale = await call(admin, 'PATCH', '/api/students/' + target.id, {
    courseMonth: 50,
    version: target.version, // deliberately the version already consumed
  });
  ok('stale write -> 409', stale.status === 409, 'got ' + stale.status);
  ok('409 carries current state', Boolean(stale.body.current), JSON.stringify(stale.body).slice(0, 90));
  ok('409 current shows the winning value',
    ((stale.body.current ?? {}) as { courseMonth?: number }).courseMonth === 99);

  console.log('--- a partial update must not erase untouched fields ---');
  {
    // Samrit Paul carries studentClass "8" and courseMonth 29 from the legacy
    // page. Editing only the month must leave the school standard alone (§13).
    const before = students.find((s) => s.name === 'Samrit Paul')!;
    const full = (await call(admin, 'GET', '/api/students')).body.students as
      { id: string; name: string; studentClass: string | null; cohort: string | null; version: number }[];
    const samrit = full.find((s) => s.name === 'Samrit Paul')!;
    ok('Samrit Paul starts with std. 8', samrit.studentClass === '8', String(samrit.studentClass));

    const patched = await call(admin, 'PATCH', '/api/students/' + before.id, {
      courseMonth: 30,
      version: samrit.version,
    });
    ok('patching only courseMonth -> 200', patched.status === 200, 'got ' + patched.status);
    const after = (patched.body.student ?? {}) as { studentClass: string | null; courseMonth: number };
    ok('studentClass survived the patch', after.studentClass === '8', String(after.studentClass));
    ok('courseMonth actually changed', after.courseMonth === 30, String(after.courseMonth));

    // Same trap on courses: shortName drives the footer headings (§19).
    const wd = courses.find((c) => c.name === 'Web Development')!;
    const cFull = (await call(admin, 'GET', '/api/courses')).body.courses as
      { id: string; name: string; shortName: string | null; order: number; version: number }[];
    const wdFull = cFull.find((c) => c.name === 'Web Development')!;
    const cPatched = await call(admin, 'PATCH', '/api/courses/' + wd.id, {
      defaultDuration: 125,
      version: wdFull.version,
    });
    ok('patching only defaultDuration -> 200', cPatched.status === 200, 'got ' + cPatched.status);
    const cAfter = (cPatched.body.course ?? {}) as { shortName: string | null; order: number };
    ok('shortName survived the patch', cAfter.shortName === 'Web Dev', String(cAfter.shortName));
    ok('order survived the patch', cAfter.order === 0, String(cAfter.order));
  }

  console.log('--- validation (§28) ---');
  const bad: [string, unknown, string][] = [
    ['/api/schedules', { studentId: target.id, day: 'Mon', startTime: '18:00', endTime: '17:00' }, 'end before start'],
    ['/api/schedules', { studentId: target.id, day: 'Sun', startTime: '10:00', endTime: '11:00' }, 'Sunday'],
    ['/api/schedules', { studentId: target.id, day: 'Mon', startTime: '5pm', endTime: '18:30' }, '5pm not HH:mm'],
    ['/api/students', { name: '', courseId: courses[0]!.id, courseMonth: 1 }, 'blank name'],
    ['/api/students', { name: 'X', courseId: 'not-an-id', courseMonth: 1 }, 'malformed courseId'],
    ['/api/students', { name: 'X', courseId: courses[0]!.id, courseMonth: -5 }, 'negative month'],
  ];
  for (const [path, payload, label] of bad) {
    const r = await call(admin, 'POST', path, payload);
    ok('rejects ' + label + ' -> 400', r.status === 400, 'got ' + r.status);
  }

  console.log('--- malformed / unknown ids (§30) ---');
  ok('malformed student id -> 404',
    (await call(admin, 'PATCH', '/api/students/zzz', { name: 'X', version: 0 })).status === 404);
  ok('well-formed but absent id -> 404',
    (await call(admin, 'PATCH', '/api/students/507f1f77bcf86cd799439011', { name: 'X', version: 0 })).status === 404);

  console.log('--- referential integrity (§22) ---');
  const delCourse = await call(admin, 'DELETE', '/api/courses/' + courses[0]!.id);
  ok('deleting a course in use -> 409', delCourse.status === 409, 'got ' + delCourse.status);
  ok('409 names the dependent count', typeof delCourse.body.dependents === 'number',
    JSON.stringify(delCourse.body).slice(0, 100));

  console.log('--- clear vs delete are different operations (§22) ---');
  const sched = schedules.find((s) => s.id)!;
  const beforeClear = await call(admin, 'GET', '/api/bootstrap');
  const clearRes = await call(editor, 'DELETE', '/api/schedules/' + sched.id);
  ok('editor clears an assignment -> 200', clearRes.status === 200, 'got ' + clearRes.status);
  const afterClear = await call(admin, 'GET', '/api/bootstrap');
  const beforeCounts = {
    students: (beforeClear.body.students as unknown[]).length,
    schedules: (beforeClear.body.schedules as unknown[]).length,
  };
  const afterCounts = {
    students: (afterClear.body.students as unknown[]).length,
    schedules: (afterClear.body.schedules as unknown[]).length,
  };
  ok('clearing removed one schedule', afterCounts.schedules === beforeCounts.schedules - 1,
    beforeCounts.schedules + ' -> ' + afterCounts.schedules);
  ok('clearing removed NO student', afterCounts.students === beforeCounts.students,
    beforeCounts.students + ' -> ' + afterCounts.students);

  console.log('--- deleting a student cascades its schedules (§22) ---');
  const victim = students.find((s) => s.name === 'Sabita Mondal')!;
  const del = await call(admin, 'DELETE', '/api/students/' + victim.id);
  ok('admin deletes a student -> 200', del.status === 200, 'got ' + del.status);
  ok('cascade removed her 6 classes', del.body.removedSchedules === 6, 'got ' + del.body.removedSchedules);
  const afterDelete = await call(admin, 'GET', '/api/bootstrap');
  ok('student gone from roster',
    !(afterDelete.body.students as { id: string }[]).some((s) => s.id === victim.id));
  ok('no orphan schedules left',
    !(afterDelete.body.schedules as { studentId: string }[]).some((s) => s.studentId === victim.id));

  console.log('--- account safety (§30) ---');
  const usersRes = await call(admin, 'GET', '/api/users');
  const users = usersRes.body.users as { id: string; email: string; role: string; version: number }[];
  const me = users.find((u) => u.email === 'admin@lca.test')!;

  ok('no passwordHash in /api/users', !usersRes.raw.includes('passwordHash'));
  ok('no bcrypt hash in /api/users', !/\$2[aby]\$/.test(usersRes.raw));

  const selfDemote = await call(admin, 'PATCH', '/api/users/' + me.id, {
    role: 'viewer',
    version: me.version,
  });
  ok('admin cannot demote self -> 409', selfDemote.status === 409, 'got ' + selfDemote.status);
  ok('admin cannot delete self -> 409',
    (await call(admin, 'DELETE', '/api/users/' + me.id)).status === 409);

  console.log('--- audit trail was written (§26) ---');
  const logs = await call(admin, 'GET', '/api/audit-logs?limit=100');
  const entries = logs.body.entries as { action: string; summary: string; userName: string }[];
  ok('audit-logs -> 200', logs.status === 200);
  ok('recorded the student delete', entries.some((e) => e.action === 'student.delete'));
  ok('recorded the schedule clear', entries.some((e) => e.action === 'schedule.clear'));
  ok('recorded the time range change', entries.some((e) => e.action === 'timeRange.add'));
  ok('entries name the actor', entries.every((e) => Boolean(e.userName)));
  ok('summaries are human-readable',
    entries.some((e) => /cleared|removed|assigned|edited/.test(e.summary)));
  ok('audit never carries a password', !logs.raw.includes('passwordHash') && !/\$2[aby]\$/.test(logs.raw));

  console.log('--- theme preference is self-scoped (§6, IDOR) ---');
  const theme = await call(viewer, 'PATCH', '/api/me', { preferredTheme: 'theme3' });
  ok('viewer may set own theme -> 200', theme.status === 200, 'got ' + theme.status);
  ok('viewer rejects a bogus theme -> 400',
    (await call(viewer, 'PATCH', '/api/me', { preferredTheme: 'theme9' })).status === 400);

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
