import { cache } from 'react';
import { ObjectId } from 'mongodb';
import { auth } from '@/auth';
import { collections } from './db';
import type { Role, Theme } from './constants';

export interface Viewer {
  id: string;
  name: string;
  role: Role;
  preferredTheme: Theme | null;
}

/**
 * The account behind a session token, or null if it may no longer act.
 *
 * The token proves WHO you are; the database decides WHAT you may do. Reading
 * role and `active` per request rather than trusting the token closes two gaps
 * that a JWT alone cannot:
 *
 *   - deactivating someone took up to 30 days to bite. They could not sign in
 *     again, but the token they already held kept working — so "remove user"
 *     did not actually remove their access.
 *   - demoting an admin left them holding admin rights until their next
 *     sign-in, which §7 plainly does not intend.
 *
 * The cost is one indexed findOne on a three-field projection per authenticated
 * request. §47 warns against unnecessary queries; this one is necessary, and at
 * this scale it is a rounding error next to the work the request already does.
 */
export const getAccount = cache(
  async (
    userId: string,
  ): Promise<{ role: Role; preferredTheme: Theme | null; active: boolean } | null> => {
    if (!ObjectId.isValid(userId)) return null;
    const users = await collections.users();
    const doc = await users.findOne(
      { _id: new ObjectId(userId) },
      { projection: { role: 1, preferredTheme: 1, active: 1 } },
    );
    if (!doc || !doc.active) return null;
    return { role: doc.role, preferredTheme: doc.preferredTheme, active: doc.active };
  },
);

/**
 * The signed-in user, for server renders.
 *
 * Identity comes from the session token; role, `active` and the theme all come
 * from the database via getAccount. Wrapped in React's `cache` so the layout
 * and the page share one read per request rather than issuing two.
 */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const session = await auth();
  if (!session?.user?.id) return null;

  // Deactivated between sign-in and now: no viewer, so the page redirects.
  const account = await getAccount(session.user.id);
  if (!account) return null;

  return {
    id: session.user.id,
    name: session.user.name ?? 'Unknown',
    role: account.role,
    preferredTheme: account.preferredTheme,
  };
});
