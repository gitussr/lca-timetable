import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { withRole } from '@/lib/rbac';
import { listQuery } from '@/lib/schemas';
import { auditToWire } from '@/lib/serialize';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Audit history (§26). Admin-only — it names who did what, which is not
 * something an editor or viewer needs.
 *
 * Cursor pagination on _id rather than skip/limit: _id is monotonic, so this
 * stays correct while new entries are being written underneath it.
 */
export const GET = withRole('admin', async (req) => {
  const url = new URL(req.url);
  const parsed = listQuery.safeParse({
    limit: url.searchParams.get('limit') ?? undefined,
    cursor: url.searchParams.get('cursor') ?? undefined,
  });
  const { limit, cursor } = parsed.success ? parsed.data : { limit: 50, cursor: undefined };

  const logs = await collections.auditLogs();
  const filter = cursor ? { _id: { $lt: new ObjectId(cursor) } } : {};

  // One extra row tells us whether another page exists, without a count().
  const docs = await logs.find(filter).sort({ _id: -1 }).limit(limit + 1).toArray();
  const hasMore = docs.length > limit;
  const page = hasMore ? docs.slice(0, limit) : docs;

  return NextResponse.json({
    entries: page.map(auditToWire),
    nextCursor: hasMore ? page[page.length - 1]!._id.toHexString() : null,
  });
});
