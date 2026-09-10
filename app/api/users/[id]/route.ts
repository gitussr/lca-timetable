import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import bcrypt from 'bcryptjs';
import { collections } from '@/lib/db';
import { conflict, problem, withRole } from '@/lib/rbac';
import { updateUserInput } from '@/lib/schemas';
import { isDuplicateKey, parseBody, versionedUpdate } from '@/lib/mutate';
import { userToWire } from '@/lib/serialize';
import { audit } from '@/lib/audit';
import { HASH_ROUNDS } from '@/auth';
import type { UserDoc } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { id: string };

function parseId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

/** Would this change leave the application with nobody who can administer it? */
async function wouldOrphanAdmins(targetId: ObjectId): Promise<boolean> {
  const users = await collections.users();
  const otherAdmins = await users.countDocuments({
    _id: { $ne: targetId },
    role: 'admin',
    active: true,
  });
  return otherAdmins === 0;
}

export const PATCH = withRole<Params>('admin', async (req, { user, params }) => {
  const id = parseId(params.id);
  if (!id) return problem(404, 'Not found', 'No account with that id.');

  const body = await parseBody(req, updateUserInput);
  if (!body.ok) return body.response;

  const { version, password, ...changes } = body.data;

  const users = await collections.users();
  const target = await users.findOne({ _id: id });
  if (!target) return problem(404, 'Not found', 'No account with that id.');

  const isSelf = target._id.toHexString() === user.id;
  const losingAdmin =
    (changes.role !== undefined && changes.role !== 'admin' && target.role === 'admin') ||
    (changes.active === false && target.role === 'admin');

  // Locking yourself out of your own admin account is almost never intended,
  // and there is no recovery path short of running create-admin on a shell.
  if (isSelf && losingAdmin) {
    return problem(
      409,
      'Cannot demote yourself',
      'Ask another admin to change your role, so you are not locked out.',
    );
  }

  // Guards against the last admin being removed by anyone, self or not (§30).
  if (losingAdmin && (await wouldOrphanAdmins(id))) {
    return problem(
      409,
      'Last admin',
      'This is the only active admin. Promote someone else first.',
    );
  }

  const set: Partial<UserDoc> = {};
  if (changes.name !== undefined) set.name = changes.name;
  if (changes.email !== undefined) set.email = changes.email;
  if (changes.role !== undefined) set.role = changes.role;
  if (changes.active !== undefined) set.active = changes.active;
  if (password !== undefined) set.passwordHash = await bcrypt.hash(password, HASH_ROUNDS);

  let result;
  try {
    result = await versionedUpdate(users, id, version, set, new ObjectId(user.id));
  } catch (err) {
    if (isDuplicateKey(err)) {
      return problem(409, 'Already exists', 'Another account already uses that email.');
    }
    throw err;
  }

  if (result.status === 'missing') return problem(404, 'Not found', 'No account with that id.');
  if (result.status === 'conflict') return conflict(userToWire(result.current));

  await audit({
    userId: user.id,
    userName: user.name,
    action: changes.role !== undefined ? 'user.role' : 'user.update',
    target: 'user',
    targetId: params.id,
    summary:
      changes.role !== undefined
        ? `changed ${result.doc.email} from ${target.role} to ${changes.role}`
        : `updated account ${result.doc.email}` + (password !== undefined ? ' (password reset)' : ''),
    before: { role: target.role, active: target.active },
    // `password` is destructured out above and never reaches here.
    after: changes as Record<string, unknown>,
  });

  return NextResponse.json({ user: userToWire(result.doc) });
});

export const DELETE = withRole<Params>('admin', async (_req, { user, params }) => {
  const id = parseId(params.id);
  if (!id) return problem(404, 'Not found', 'No account with that id.');

  const users = await collections.users();
  const target = await users.findOne({ _id: id });
  if (!target) return problem(404, 'Not found', 'No account with that id.');

  if (target._id.toHexString() === user.id) {
    return problem(409, 'Cannot delete yourself', 'Ask another admin to remove your account.');
  }
  if (target.role === 'admin' && (await wouldOrphanAdmins(id))) {
    return problem(409, 'Last admin', 'This is the only active admin. Promote someone else first.');
  }

  // Deactivate rather than remove: audit entries reference this account, and
  // authorize() already refuses inactive users at sign-in.
  await users.updateOne(
    { _id: id },
    {
      $set: { active: false, updatedAt: new Date(), updatedBy: new ObjectId(user.id) },
      $inc: { version: 1 },
    },
  );

  await audit({
    userId: user.id,
    userName: user.name,
    action: 'user.delete',
    target: 'user',
    targetId: params.id,
    summary: `deactivated account ${target.email}`,
    before: { email: target.email, role: target.role },
  });

  return NextResponse.json({ ok: true });
});
