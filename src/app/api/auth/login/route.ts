/**
 * Sign in.
 *
 * Deliberately vague on failure: "that username and password do not match" for
 * a wrong password, an unknown user and a disabled account alike. Naming which
 * one it was tells an attacker which usernames exist.
 */
import { prisma } from '@/lib/db';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  ensureSeedUsers,
  issueSession,
  verifyPassword,
} from '@/lib/auth';
import { errorResponse, jsonResponse } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const GENERIC = 'That username and password do not match.';

export async function POST(request: Request) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return errorResponse('Invalid request');
  }

  const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';

  if (!username || !password) return errorResponse('Enter a username and password');

  try {
    // First sign-in on a fresh database creates the six accounts. Doing it here
    // rather than in a migration means the app is usable the moment it boots,
    // without anyone running a seed script.
    await ensureSeedUsers();

    const user = await prisma.user.findUnique({ where: { username } });
    if (!user || !user.active) return errorResponse(GENERIC, 401);

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return errorResponse(GENERIC, 401);

    const token = await issueSession(user);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

    const response = jsonResponse({
      user: { displayName: user.displayName, role: user.role },
    });
    response.headers.append(
      'Set-Cookie',
      [
        `${SESSION_COOKIE}=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
        process.env.NODE_ENV === 'production' ? 'Secure' : '',
      ]
        .filter(Boolean)
        .join('; '),
    );
    return response;
  } catch (err) {
    console.error('[auth] login failed:', (err as Error).message);
    return errorResponse('Could not sign in right now. Try again in a moment.', 503);
  }
}
