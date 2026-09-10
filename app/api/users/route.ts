import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { problem, withRole } from '@/lib/rbac';
import { createUserInput } from '@/lib/schemas';
import { isDuplicateKey, newDocStamp, parseBody } from '@/lib/mutate';
import { userToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import { HASH_ROUNDS } from '@/auth';
import type { UserDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Admin-only in both directions — user management is not editor work (§7). */
export const GET = withRole('admin', async () => {
  const users = await collections.users();
  const docs = await users.find({}).sort({ name: 1 }).toArray();
  // userToWire never copies passwordHash (§30).
  return NextResponse.json({ users: docs.map(userToWire) });
});

export const POST = withRole('admin', async (req, { user }) => {
  const body = await parseBody(req, createUserInput);
  if (!body.ok) return body.response;

  const { name, email, password, role } = body.data;

  const users = await collections.users();
  const doc: UserDoc = {
    _id: new ObjectId(),
    name,
    email,
    passwordHash: await bcrypt.hash(password, HASH_ROUNDS),
    role,
    preferredTheme: null,
    active: true,
    ...newDocStamp(new ObjectId(user.id)),
  };

  try {
    await users.insertOne(doc);
  } catch (err) {
    if (isDuplicateKey(err)) {
      return problem(409, 'Already exists', 'An account with that email already exists.');
    }
    throw err;
  }

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'user.create',
    target: 'user',
    targetId: doc._id.toHexString(),
    summary: `created ${role} account for ${email}`,
    // audit() redacts `password`, but it is not passed in the first place.
    after: { email, role },
  });

  return NextResponse.json({ user: userToWire(doc) }, { status: 201 });
});
