/**
 * Auth shapes and the cookie format.
 *
 * Client-safe and edge-safe on purpose: the middleware verifies the session on
 * the Edge runtime, the route handlers verify it in Node, and the browser needs
 * the role to decide which interface to render. One implementation, three
 * places — a second copy of "is this cookie valid" is how a hole gets opened.
 */

export type Role = 'admin' | 'user';

export const SESSION_COOKIE = 'prism_session';
/** Fourteen days. Long enough not to nag, short enough to matter. */
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;

export interface SessionPayload {
  /** User id. */
  sub: string;
  role: Role;
  /** Display name, so the header does not need a database hit. */
  name: string;
  /** Matches User.tokenVersion; a password change invalidates old cookies. */
  v: number;
  /** Issued-at, seconds. */
  iat: number;
  /** Expiry, seconds. */
  exp: number;
}

export function isRole(value: unknown): value is Role {
  return value === 'admin' || value === 'user';
}

// ---------------------------------------------------------------------------
// Signing
//
// HMAC-SHA256 over base64url(JSON), using Web Crypto so the identical code runs
// on the Edge runtime and in Node. Not JWT: no algorithm field to confuse, no
// library, and nothing here needs to be read by anything but this app.
// ---------------------------------------------------------------------------

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signSession(payload: SessionPayload, secret: string): Promise<string> {
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    new TextEncoder().encode(body),
  );
  return `${body}.${toBase64Url(new Uint8Array(signature))}`;
}

/** Returns null for anything that is not a currently-valid session. */
export async function verifySession(
  token: string | undefined | null,
  secret: string,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;

  let ok = false;
  try {
    ok = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      fromBase64Url(signature),
      new TextEncoder().encode(body),
    );
  } catch {
    return null;
  }
  if (!ok) return null;

  try {
    const payload = JSON.parse(
      new TextDecoder().decode(new Uint8Array(fromBase64Url(body))),
    ) as SessionPayload;
    if (!payload?.sub || !isRole(payload.role)) return null;
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// What each role may reach
// ---------------------------------------------------------------------------

/** Reachable without signing in. */
export const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/health'];

/** Admin-only. Everything else is available to any signed-in user. */
export const ADMIN_PATHS = ['/admin', '/api/admin'];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

export function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
