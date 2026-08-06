/**
 * Account management, for the admin only.
 *
 * Middleware already blocks non-admins from /api/admin, but the guard is
 * repeated here on purpose: a route that is only safe because of a matcher
 * pattern is one refactor away from being unsafe.
 */
import { prisma } from '@/lib/db';
import { ensureSeedUsers, hashPassword, requireAdmin } from '@/lib/auth';
import { errorResponse, jsonResponse } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_PASSWORD = 8;

export async function GET() {
  try {
    await requireAdmin();
    await ensureSeedUsers();

    const users = await prisma.user.findMany({
      orderBy: [{ role: 'asc' }, { username: 'asc' }],
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        active: true,
        lastLoginAt: true,
      },
    });

    return jsonResponse({
      users: users.map((user) => ({
        ...user,
        lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      })),
    });
  } catch (err) {
    const message = (err as Error).message;
    return errorResponse(message, /access required|signed in/i.test(message) ? 403 : 500);
  }
}

interface PatchBody {
  id?: string;
  displayName?: string;
  password?: string;
  active?: boolean;
}

export async function PATCH(request: Request) {
  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return errorResponse('Invalid request');
  }

  try {
    const admin = await requireAdmin();
    if (!body.id) return errorResponse('Which account?');

    const target = await prisma.user.findUnique({ where: { id: body.id } });
    if (!target) return errorResponse('No such account', 404);

    const data: Record<string, unknown> = {};

    if (typeof body.displayName === 'string' && body.displayName.trim()) {
      data.displayName = body.displayName.trim().slice(0, 60);
    }

    if (typeof body.password === 'string' && body.password.length) {
      if (body.password.length < MIN_PASSWORD) {
        return errorResponse(`A password needs at least ${MIN_PASSWORD} characters`);
      }
      data.passwordHash = await hashPassword(body.password);
      // Every cookie already issued to this account stops working. A reset that
      // leaves existing sessions signed in has not reset anything.
      data.tokenVersion = target.tokenVersion + 1;
    }

    if (typeof body.active === 'boolean') {
      // Locking the last admin out of their own instance is not a state worth
      // supporting; there is no second way back in.
      if (!body.active && target.role === 'admin' && target.id === admin.id) {
        return errorResponse('You cannot switch off the account you are signed in with');
      }
      data.active = body.active;
    }

    if (Object.keys(data).length === 0) return errorResponse('Nothing to change');

    await prisma.user.update({ where: { id: target.id }, data });
    return jsonResponse({ ok: true, signedOut: Boolean(data.passwordHash) });
  } catch (err) {
    const message = (err as Error).message;
    return errorResponse(message, /access required|signed in/i.test(message) ? 403 : 500);
  }
}
