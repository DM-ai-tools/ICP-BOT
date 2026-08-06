/**
 * The first gate.
 *
 * Deliberately does NO cryptography. It checks that a session cookie is present
 * and sends anyone without one to the login form — that is a routing decision,
 * not a security decision.
 *
 * It used to verify the signature here. It does not any more, because the same
 * token verified in Node and failed on the Edge runtime with an identical
 * secret, and an auth check that behaves differently in two runtimes is worse
 * than no auth check: it fails in exactly the way that looks like a bug in
 * something else. Verification now happens once, in Node, in `currentUser()` —
 * and every route that matters calls `guard()` before doing anything.
 *
 * So this file is a convenience, and the routes are the wall.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE, isPublicPath } from '@/lib/auth-shared';

/** Mirrors authDisabled() in lib/auth — kept inline so the Edge bundle stays thin. */
function authOff(): boolean {
  const value = process.env.AUTH_DISABLED?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Switched off: behave exactly as the app did before accounts existed.
  if (authOff()) return NextResponse.next();

  if (isPublicPath(pathname)) return NextResponse.next();

  if (request.cookies.get(SESSION_COOKIE)?.value) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = '/login';
  url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png).*)'],
};
