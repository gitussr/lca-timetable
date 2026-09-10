/**
 * Creates a user, defaulting to the first admin (§50.6).
 *
 * Never accepts the password as an argument — that lands in shell history and
 * the process table. There is deliberately no default admin account and no
 * seeded password: a known credential on a public deployment is the same
 * problem as the legacy `ACCESS_CODE = 'LCA1234'`.
 *
 *   interactive:  npm run create:admin  [-- --role=editor]
 *   piped:        printf 'Name\nemail\npass\npass\n' | npm run create:admin
 *
 * On a TTY the password is read with echo off. On a pipe (CI, a wrapper
 * script) all four values are read as lines. Either way, missing input is a
 * loud failure — an earlier version silently exited 0 having created nothing.
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { collections, ensureIndexes, getClient } from '../lib/db';
import { createUserInput } from '../lib/schemas';
import { HASH_ROUNDS } from '../auth';
import { ROLES, type Role } from '../lib/constants';

/** Control bytes by code, so no escape sequence can be mangled in transit. */
const CTRL = {
  ETX: String.fromCharCode(3), // Ctrl-C
  EOT: String.fromCharCode(4), // Ctrl-D
  BS: String.fromCharCode(8),
  LF: String.fromCharCode(10),
  CR: String.fromCharCode(13),
  DEL: String.fromCharCode(127),
} as const;

const isTty = Boolean(stdin.isTTY);

/** Reads one line from a TTY with echo suppressed. */
function askSecretTty(prompt: string): Promise<string> {
  stdout.write(prompt);
  const wasRaw = stdin.isRaw ?? false;
  stdin.setRawMode?.(true);
  stdin.resume();

  return new Promise((resolve) => {
    let value = '';
    const restore = () => {
      stdin.setRawMode?.(wasRaw);
      stdin.pause();
      stdin.off('data', onData);
      stdout.write(CTRL.LF);
    };
    const onData = (chunk: Buffer) => {
      const char = chunk.toString('utf8');
      if (char === CTRL.CR || char === CTRL.LF || char === CTRL.EOT) {
        restore();
        resolve(value);
        return;
      }
      if (char === CTRL.ETX) {
        restore();
        process.exit(130);
      }
      if (char === CTRL.DEL || char === CTRL.BS) {
        value = value.slice(0, -1);
        return;
      }
      if (char >= ' ') value += char;
    };
    stdin.on('data', onData);
  });
}

/** name, email, password, confirm — however they arrive. */
async function collectInput(): Promise<[string, string, string, string]> {
  if (!isTty) {
    let buffer = '';
    for await (const chunk of stdin) buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    const [name, email, password, confirm] = lines;
    if (!name || !email || !password) {
      throw new Error(
        'Piped input needs four lines: name, email, password, confirm. ' +
          'Got ' + lines.filter(Boolean).length + '.',
      );
    }
    // A single-line-omitted confirm is a typo risk, not a convenience.
    if (confirm === undefined) throw new Error('Piped input is missing the confirm line.');
    return [name.trim(), email.trim(), password, confirm];
  }

  const rl = createInterface({ input: stdin, output: stdout });
  const name = (await rl.question('Name:  ')).trim();
  const email = (await rl.question('Email: ')).trim();
  rl.close();

  const password = await askSecretTty('Password (min 12 chars, not echoed): ');
  const confirm = await askSecretTty('Confirm password: ');
  return [name, email, password, confirm];
}

async function main(): Promise<void> {
  const roleArg = process.argv.find((a) => a.startsWith('--role='))?.split('=')[1];
  const role: Role = (ROLES as readonly string[]).includes(roleArg ?? '')
    ? (roleArg as Role)
    : 'admin';

  const [name, email, password, confirm] = await collectInput();

  if (password !== confirm) {
    console.error('Passwords do not match.');
    process.exit(1);
  }

  // Same validation the API uses — one source of truth for the rules (§28).
  const parsed = createUserInput.safeParse({ name, email, password, role });
  if (!parsed.success) {
    console.error('Invalid input:');
    for (const issue of parsed.error.issues) {
      console.error('  ' + (issue.path.join('.') || '_') + ': ' + issue.message);
    }
    process.exit(1);
  }

  await ensureIndexes();

  const users = await collections.users();
  const existing = await users.findOne({ email: parsed.data.email }, { projection: { _id: 1 } });
  if (existing) {
    console.error('A user with that email already exists: ' + parsed.data.email);
    process.exit(1);
  }

  const now = new Date();
  const passwordHash = await bcrypt.hash(parsed.data.password, HASH_ROUNDS);

  await users.insertOne({
    _id: new ObjectId(),
    name: parsed.data.name,
    email: parsed.data.email,
    passwordHash,
    role: parsed.data.role,
    preferredTheme: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    updatedBy: null,
    version: 0,
  });

  // Echo the email and role, never the password or the hash.
  console.log('created ' + parsed.data.role + ': ' + parsed.data.email);
}

main()
  .then(async () => {
    await (await getClient()).close();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('failed: ' + message.replace(/mongodb\+srv:\/\/[^\s]*/g, '<redacted>'));
    try {
      await (await getClient()).close();
    } catch {
      /* already down */
    }
    process.exit(1);
  });
