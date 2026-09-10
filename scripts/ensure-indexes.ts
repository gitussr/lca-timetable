/** Applies the index definitions in lib/db.ts. Idempotent. */
import { ensureIndexes, getClient } from '../lib/db';

ensureIndexes()
  .then(async (names) => {
    console.log('indexes ensured:');
    for (const n of names) console.log('  ' + n);
    await (await getClient()).close();
  })
  .catch(async (err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error('failed: ' + message.replace(/mongodb\+srv:\/\/[^\s]*/g, '<redacted>'));
    process.exitCode = 1;
    try { await (await getClient()).close(); } catch { /* already down */ }
  });
