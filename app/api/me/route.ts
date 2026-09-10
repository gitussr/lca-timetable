import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { withAuth } from '@/lib/rbac';
import { updateMyThemeInput } from '@/lib/schemas';
import { parseBody } from '@/lib/mutate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The current user, from the session — no database read needed. */
export const GET = withAuth(async (_req, { user }) =>
  NextResponse.json({ user }),
);

/**
 * Theme preference (§6). The one thing a viewer may write, and only about
 * themselves — the id comes from the session, never from the request, so this
 * cannot be pointed at another account (§30, IDOR).
 *
 * No version check: it is a per-user preference with a single writer, so there
 * is no concurrent edit to lose.
 */
export const PATCH = withAuth(async (req, { user }) => {
  const body = await parseBody(req, updateMyThemeInput);
  if (!body.ok) return body.response;

  const users = await collections.users();
  await users.updateOne(
    { _id: new ObjectId(user.id) },
    { $set: { preferredTheme: body.data.preferredTheme, updatedAt: new Date() } },
  );

  return NextResponse.json({ preferredTheme: body.data.preferredTheme });
});
