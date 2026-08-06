/**
 * Accounts, passwords and sessions — the server half.
 *
 * Six accounts are seeded on first boot. The seed is idempotent and never
 * touches an account that already exists, so a redeploy cannot reset a password
 * the admin has changed.
 *
 * Passwords are scrypt with a per-user salt, from node:crypto — no dependency,
 * and deliberately slow. Comparison is constant-time; a fast string compare on
 * a password hash is a timing oracle.
 */
import 'server-only';
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { cookies } from 'next/headers';
import { prisma } from './db';
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  signSession,
  verifySession,
  type Role,
  type SessionPayload,
} from './auth-shared';

export {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  isAdminPath,
  isPublicPath,
  isRole,
  signSession,
  verifySession,
} from './auth-shared';
export type { Role, SessionPayload } from './auth-shared';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

/**
 * The signing secret.
 *
 * Falls back to a value derived from DATABASE_URL when AUTH_SECRET is unset, so
 * a deploy that forgets the variable still has stable, non-guessable sessions
 * rather than either crashing or signing everything with "secret". Setting
 * AUTH_SECRET explicitly is still correct — the fallback changes if the
 * database URL ever does, which signs everyone out.
 */
/**
 * The off switch.
 *
 * Set AUTH_DISABLED=true and the app behaves exactly as it did before accounts
 * existed: no login screen, everyone gets the full workspace. Nothing is
 * deleted — the accounts, the hashes and the guards all stay where they are, so
 * turning it back on is one variable and a redeploy rather than a rebuild.
 *
 * Every guard in this file honours it, so there is one place to reason about
 * rather than a scattering of half-disabled checks.
 */
export function authDisabled(): boolean {
  const value = process.env.AUTH_DISABLED?.trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
}

/** Who everyone is while auth is switched off: an administrator. */
const OPEN_ACCESS_USER: CurrentUser = {
  id: 'open-access',
  username: 'open-access',
  displayName: '',
  role: 'admin',
};

export function authSecret(): string {
  const explicit = process.env.AUTH_SECRET?.trim();
  if (explicit && explicit.length >= 16) return explicit;
  const derived = process.env.DATABASE_URL?.trim();
  if (derived) return `prism-derived:${derived}`;
  return 'prism-insecure-development-secret';
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt:${salt.toString('hex')}:${derived.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split(':');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  try {
    const derived = await scrypt(password, Buffer.from(saltHex, 'hex'), KEY_LENGTH);
    const expected = Buffer.from(hashHex, 'hex');
    if (expected.length !== derived.length) return false;
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Seeding
// ---------------------------------------------------------------------------

export interface SeedAccount {
  username: string;
  displayName: string;
  role: Role;
  password: string;
}

/**
 * The six accounts.
 *
 * Passwords come from environment variables when set and fall back to these
 * defaults otherwise — an instance nobody has configured still has to be
 * usable, and an admin who cannot sign in cannot change anything. They are
 * printed once at boot so they are never a mystery.
 */
export function seedAccounts(): SeedAccount[] {
  const adminPassword = process.env.ADMIN_PASSWORD?.trim() || 'Prism-Admin-2026!';
  const userPassword = process.env.USER_PASSWORD?.trim() || 'Prism-Team-2026!';

  return [
    { username: 'admin', displayName: 'Administrator', role: 'admin', password: adminPassword },
    { username: 'user1', displayName: 'Team member 1', role: 'user', password: userPassword },
    { username: 'user2', displayName: 'Team member 2', role: 'user', password: userPassword },
    { username: 'user3', displayName: 'Team member 3', role: 'user', password: userPassword },
    { username: 'user4', displayName: 'Team member 4', role: 'user', password: userPassword },
    { username: 'user5', displayName: 'Team member 5', role: 'user', password: userPassword },
  ];
}

/**
 * Create any account that does not exist yet. Never modifies one that does.
 *
 * That distinction is the whole design: this runs on every boot, and an admin
 * who has changed a password must not find it reset by the next deploy.
 */
export async function ensureSeedUsers(): Promise<{ created: string[] }> {
  const created: string[] = [];

  for (const account of seedAccounts()) {
    const existing = await prisma.user.findUnique({ where: { username: account.username } });
    if (existing) continue;

    await prisma.user.create({
      data: {
        username: account.username,
        displayName: account.displayName,
        role: account.role,
        passwordHash: await hashPassword(account.password),
      },
    });
    created.push(account.username);
  }

  return { created };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export async function issueSession(user: {
  id: string;
  role: string;
  displayName: string;
  tokenVersion: number;
}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    sub: user.id,
    role: user.role === 'admin' ? 'admin' : 'user',
    name: user.displayName,
    v: user.tokenVersion,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
  };
  return signSession(payload, authSecret());
}

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string;
  role: Role;
}

/**
 * The signed-in user, or null.
 *
 * Verifies the cookie signature first, then re-checks the account against the
 * database: a cookie is a claim, and an account that has since been switched
 * off or had its password changed must stop working immediately rather than at
 * the end of a fourteen-day window.
 */
export async function currentUser(): Promise<CurrentUser | null> {
  if (authDisabled()) return OPEN_ACCESS_USER;

  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token, authSecret());
  if (!payload) return null;

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || !user.active || user.tokenVersion !== payload.v) return null;
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role === 'admin' ? 'admin' : 'user',
    };
  } catch {
    // A database blip must not log the whole team out mid-sentence; the cookie
    // was cryptographically valid, so trust it for this request.
    return { id: payload.sub, username: '', displayName: payload.name, role: payload.role };
  }
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in');
  return user;
}

export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (user.role !== 'admin') throw new Error('Administrator access required');
  return user;
}

/**
 * The wall.
 *
 * Every API route calls this first. Returns the signed-in user, or a Response
 * to return immediately — so a route reads:
 *
 *     const gate = await guard();
 *     if (gate.response) return gate.response;
 *
 * This runs in Node, where the signature check demonstrably works, and it
 * re-reads the account so a disabled user or a changed password takes effect on
 * the very next request rather than whenever their cookie happens to expire.
 */
export async function guard(
  options: { admin?: boolean } = {},
): Promise<{ user: CurrentUser; response: null } | { user: null; response: Response }> {
  if (authDisabled()) return { user: OPEN_ACCESS_USER, response: null };

  const user = await currentUser();

  if (!user) {
    return {
      user: null,
      response: new Response(JSON.stringify({ error: 'Not signed in' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    };
  }

  if (options.admin && user.role !== 'admin') {
    return {
      user: null,
      response: new Response(JSON.stringify({ error: 'Administrator access required' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    };
  }

  return { user, response: null };
}
