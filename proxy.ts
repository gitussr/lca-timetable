import { NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * Next 16 renamed `middleware` to `proxy` (docs/next16-notes.md). Node runtime
 * only — the edge runtime is not supported here.
 *
 * This is a convenience redirect, NOT the authorization boundary. Every API
 * route enforces its own role through withRole() (§8); nothing security-
 * relevant may depend on this file running. It exists so a signed-out visitor
 * lands on /login instead of an empty timetable.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const signedIn = Boolean(req.auth?.user);

  if (!signedIn && pathname === '/') {
    const url = new URL('/login', req.nextUrl);
    return NextResponse.redirect(url);
  }
  if (signedIn && pathname === '/login') {
    return NextResponse.redirect(new URL('/', req.nextUrl));
  }
  return NextResponse.next();
});

export const config = {
  // Skip static assets and the auth endpoints themselves.
  matcher: ['/((?!api/auth|_next/static|_next/image|favicon.ico|.*\.(?:svg|png|webmanifest)$).*)'],
};
