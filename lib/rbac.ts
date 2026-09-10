import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { getAccount } from './viewer';
import { roleAtLeast, type Role } from './constants';
import type { SessionUser } from '@/auth';

/**
 * Server-side authorization (§8).
 *
 * The spec is explicit that hiding a button is not authorization: a viewer who
 * sends `DELETE /api/students/123` by hand must be refused by the server. This
 * wrapper is the single place that happens, so a handler cannot ship without a
 * check — there is no code path into the body that skips it.
 *
 *     export const DELETE = withRole('admin', async (req, { user, params }) => { ... })
 *
 * Client-side role checks still exist, but only to hide controls that would
 * fail anyway. They are cosmetic.
 */

export interface RouteContext<P = Record<string, string>> {
  user: SessionUser;
  /** Next 16: route params are async. Already awaited by the time you see them. */
  params: P;
}

type Handler<P> = (req: Request, ctx: RouteContext<P>) => Promise<Response> | Response;

/** What Next 16 actually hands a route handler as its second argument. */
interface NextRouteArgs<P> {
  params: Promise<P>;
}

/** Methods that change something, and therefore need CSRF consideration (§30). */
const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Rejects a state-changing request whose Origin is not us.
 *
 * The primary CSRF defence is the session cookie's `SameSite=Lax`, which stops
 * a cross-site POST carrying credentials at all. This is defence in depth: it
 * costs nothing, and it still holds if that cookie attribute is ever weakened
 * or a browser fails to enforce it.
 *
 * A missing Origin is allowed through. Browsers always send it on cross-origin
 * requests — which is the case that matters — while server-to-server callers
 * and curl send none, and refusing those would break the check scripts without
 * closing any hole.
 */
function originIsForeign(req: Request): boolean {
  if (!MUTATING.has(req.method)) return false;

  const origin = req.headers.get('origin');
  if (!origin) return false;

  const host = req.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    // An unparseable Origin is not a same-origin request.
    return true;
  }
}

export function withRole<P = Record<string, string>>(
  required: Role,
  handler: Handler<P>,
): (req: Request, args: NextRouteArgs<P>) => Promise<Response> {
  return async (req, args) => {
    if (originIsForeign(req)) {
      return problem(403, 'Blocked', 'That request did not come from this site.');
    }

    const session = await auth();

    if (!session?.user) {
      return problem(401, 'Not signed in', 'Sign in to continue.');
    }

    /**
     * Authorization comes from the DATABASE, not the token (see getAccount).
     * A token is a bearer credential minted at sign-in; trusting its `role`
     * meant a demotion or a deactivation did not take effect until the holder
     * chose to sign in again.
     */
    const account = await getAccount(session.user.id);
    if (!account) {
      return problem(401, 'Signed out', 'This account is no longer active. Sign in again.');
    }
    if (!roleAtLeast(account.role, required)) {
      // 403, not 404: the caller is authenticated, they simply may not do this.
      return problem(
        403,
        'Not allowed',
        `This action needs the ${required} role. You have ${account.role}.`,
      );
    }

    const params = args?.params ? await args.params : ({} as P);

    try {
      return await handler(req, {
        user: {
          id: session.user.id,
          name: session.user.name ?? 'Unknown',
          role: account.role,
          preferredTheme: account.preferredTheme,
        },
        params,
      });
    } catch (err) {
      return handleUnexpected(err);
    }
  };
}

/** Authenticated but no minimum role — any signed-in user, including viewers. */
export function withAuth<P = Record<string, string>>(handler: Handler<P>) {
  return withRole<P>('viewer', handler);
}

/**
 * Consistent error envelope. Never leaks a stack trace or a driver message to
 * a normal user (§43); the detail goes to the server log instead.
 */
export function problem(status: number, title: string, detail?: string, extra?: object): Response {
  return NextResponse.json({ error: title, detail, ...extra }, { status });
}

export function handleUnexpected(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err);
  // Redact before logging: driver errors can embed the connection string (§30).
  console.error('[api]', message.replace(/mongodb\+srv:\/\/[^\s]*/g, '<redacted>'));
  return problem(500, 'Something went wrong', 'The change was not saved. Try again.');
}

/** 409 for optimistic-concurrency conflicts (§24), carrying the current state. */
export function conflict(current: unknown): Response {
  return NextResponse.json(
    {
      error: 'Changed by someone else',
      detail: 'This was updated while you were editing. Here is the current version.',
      current,
    },
    { status: 409 },
  );
}

/** 400 with per-field messages from a Zod failure (§28, §43). */
export function invalid(issues: { path: PropertyKey[]; message: string }[]): Response {
  const fields: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.map(String).join('.') || '_';
    fields[key] ??= i.message;
  }
  return NextResponse.json(
    { error: 'Check the highlighted fields', fields },
    { status: 400 },
  );
}
