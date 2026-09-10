import NextAuth, { CredentialsSignin } from 'next-auth';
import { encode as defaultEncode } from 'next-auth/jwt';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { ObjectId } from 'mongodb';
import { collections } from '@/lib/db';
import { loginInput } from '@/lib/schemas';
import { recordFailure, throttleCheck, clearFailures } from '@/lib/login-throttle';
import type { Role, Theme } from '@/lib/constants';

/**
 * Authentication (§7). Replaces the legacy shared access code, which was a
 * literal in client JavaScript guarding a localStorage boolean (§6.6).
 *
 * Credentials + JWT sessions. JWT rather than a database session strategy so
 * that reading the current user's role costs nothing per request — with three
 * users and a role that changes roughly never, a DB lookup per request would be
 * pure overhead. The trade is that a role change takes effect on the user's
 * next sign-in; REMEMBER_MAX_AGE bounds how long that can be.
 */

/**
 * The legacy app had "Remember me on this device", backed by a forgeable
 * localStorage flag (§6.6). Kept as a real behaviour.
 *
 * Setting `token.exp` inside the jwt callback does NOT work: Auth.js's encode
 * derives `exp` from `maxAge` and overwrites whatever the callback set — the
 * session silently stays 30 days either way. The lifetime has to be varied at
 * encode time instead, which is what the custom `jwt.encode` below does.
 */
const REMEMBER_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const SESSION_MAX_AGE = 60 * 60 * 12; //  12 hours

/**
 * Compared against when no user matches, so a wrong email and a wrong password
 * take the same time. Without it, response latency enumerates valid accounts.
 * Cost must match HASH_ROUNDS or the timing signal comes back.
 */
export const HASH_ROUNDS = 12;
const DUMMY_HASH = bcrypt.hashSync('timing-equalisation-placeholder', HASH_ROUNDS);

/** Auth.js surfaces `code` to the client; keep it generic (§30, §43). */
class InvalidCredentials extends CredentialsSignin {
  override code = 'invalid-credentials';
}

class TooManyAttempts extends CredentialsSignin {
  override code = 'too-many-attempts';
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: 'jwt', maxAge: REMEMBER_MAX_AGE },
  jwt: {
    // Per-sign-in lifetime. `maxAge` here wins over the session-level value.
    encode(params) {
      const remember = params.token?.rememberMe === true;
      return defaultEncode({ ...params, maxAge: remember ? REMEMBER_MAX_AGE : SESSION_MAX_AGE });
    },
  },
  pages: { signIn: '/login', error: '/login' },
  providers: [
    Credentials({
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
        rememberMe: { label: 'Remember me', type: 'checkbox' },
      },
      async authorize(raw) {
        const parsed = loginInput.safeParse({
          email: raw?.email,
          password: raw?.password,
          rememberMe: raw?.rememberMe === 'true' || raw?.rememberMe === true,
        });
        // Never say *which* field was wrong (§30).
        if (!parsed.success) throw new InvalidCredentials();

        const { email, password } = parsed.data;

        if (!(await throttleCheck(email))) throw new TooManyAttempts();

        const users = await collections.users();
        const user = await users.findOne(
          { email },
          {
            projection: {
              _id: 1, name: 1, email: 1, passwordHash: 1,
              role: 1, preferredTheme: 1, active: 1,
            },
          },
        );

        // Always run a compare, even with no user, so both paths cost the same.
        const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

        if (!user || !matches || !user.active) {
          await recordFailure(email);
          throw new InvalidCredentials();
        }

        await clearFailures(email);

        return {
          id: user._id.toHexString(),
          name: user.name,
          email: user.email,
          role: user.role,
          preferredTheme: user.preferredTheme,
          rememberMe: parsed.data.rememberMe,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user, trigger, session }) {
      // Only present on the sign-in pass.
      if (user) {
        token.uid = user.id!;
        token.role = user.role;
        token.preferredTheme = user.preferredTheme;
        token.rememberMe = (user as { rememberMe?: boolean }).rememberMe === true;
      }
      // Theme changes should apply without forcing a re-login (§6).
      if (trigger === 'update' && session && typeof session === 'object') {
        const next = (session as { preferredTheme?: Theme | null }).preferredTheme;
        if (next !== undefined) token.preferredTheme = next;
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = token.uid;
      session.user.role = token.role;
      session.user.preferredTheme = token.preferredTheme;
      // Report the token's real expiry, not session.maxAge, or the client is
      // told 30 days while the token dies in 12 hours.
      if (typeof token.exp === 'number') {
        // Auth.js types `expires` as the odd intersection `Date & string`,
        // which no honest value satisfies; write through a narrowed view.
        (session as { expires: unknown }).expires = new Date(token.exp * 1000).toISOString();
      }
      return session;
    },
  },
});

/** Narrow helper so route handlers never hand-roll the ObjectId conversion. */
export function toObjectId(id: string): ObjectId | null {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

export type SessionUser = { id: string; name: string; role: Role; preferredTheme: Theme | null };
