import type { DefaultSession } from 'next-auth';
import type { Role, Theme } from '@/lib/constants';

/**
 * Auth.js ships a deliberately minimal Session/User. RBAC needs the role on
 * every request without a database round trip, so it is carried in the JWT and
 * surfaced here. Augmenting the types means a handler that forgets to check
 * `role` is a compile error rather than a silent authorization hole.
 */
declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      role: Role;
      preferredTheme: Theme | null;
    } & DefaultSession['user'];
  }

  interface User {
    role: Role;
    preferredTheme: Theme | null;
  }
}

/**
 * Augment `@auth/core/jwt`, NOT `next-auth/jwt`. The latter is `export * from
 * "@auth/core/jwt"` — a pure re-export, so declaring into it adds members to a
 * module that owns no interface, and `token.uid` stays `unknown` (JWT extends
 * Record<string, unknown>, so the mistake compiles silently at the use site).
 */
declare module '@auth/core/jwt' {
  interface JWT {
    uid: string;
    role: Role;
    preferredTheme: Theme | null;
    /** Drives the per-sign-in token lifetime in auth.ts's jwt.encode. */
    rememberMe: boolean;
  }
}

export {};
