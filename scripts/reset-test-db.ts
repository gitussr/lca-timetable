/**
 * Drops and rebuilds the TEST database, so scripts/check-api.ts starts from a
 * known state. The API checks mutate data — they delete a student, clear an
 * assignment, add a time range — so running them twice against the same
 * database fails on the second pass for the wrong reasons.
 *
 * Run: npm run test:reset
 */
import { spawnSync } from 'node:child_process';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { collections, ensureIndexes, getClient, getDb } from '../lib/db';
import { HASH_ROUNDS } from '../auth';
import { ROLES } from '../lib/constants';

/**
 * THIS SCRIPT DROPS A DATABASE. The guard is the whole reason it is safe to
 * put in package.json: without it, one wrong MONGODB_DB in a shell wipes real
 * data. A name must opt in by containing "test".
 */
function assertTestDatabase(name: string): void {
  if (!/test/i.test(name)) {
    console.error(
      'Refusing to drop "' + name + '": this script only runs against a database ' +
        'whose name contains "test". Set MONGODB_DB=lca_test.',
    );
    process.exit(1);
  }
  if (/mongodb\.net/i.test(process.env.MONGODB_URI ?? '')) {
    console.error('Refusing to run against an Atlas cluster. Use a local mongod.');
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const dbName = process.env.MONGODB_DB ?? '';
  assertTestDatabase(dbName);

  const db = await getDb();
  await db.dropDatabase();
  console.log('dropped ' + dbName);

  await ensureIndexes();

  // Reuse the real seed script rather than duplicating its logic, so the tests
  // exercise the same migration path that production will.
  const seed = spawnSync(
    process.execPath,
    [require.resolve('tsx/cli'), 'scripts/seed.ts', '--allow-unreviewed'],
    { stdio: 'pipe', encoding: 'utf8', env: process.env },
  );
  if (seed.status !== 0) {
    console.error(seed.stdout + seed.stderr);
    throw new Error('seed failed');
  }
  console.log('seeded');

  const users = await collections.users();
  const now = new Date();
  for (const role of ROLES) {
    await users.insertOne({
      _id: new ObjectId(),
      name: 'Test ' + role,
      email: role + '@lca.test',
      passwordHash: await bcrypt.hash(role + '-passphrase-ok', HASH_ROUNDS),
      role,
      preferredTheme: null,
      active: true,
      createdAt: now,
      updatedAt: now,
      updatedBy: null,
      version: 0,
    });
  }
  console.log('created ' + ROLES.length + ' test accounts');
}

main()
  .then(async () => {
    await (await getClient()).close();
    process.exit(0);
  })
  .catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('reset failed: ' + message.replace(/mongodb\+srv:\/\/[^\s]*/g, '<redacted>'));
    try {
      await (await getClient()).close();
    } catch {
      /* already down */
    }
    process.exit(1);
  });
