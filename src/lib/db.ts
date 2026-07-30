import 'server-only';
import { PrismaClient } from '@prisma/client';

/**
 * Lazily-constructed Prisma client.
 *
 * `new PrismaClient()` throws at construction when DATABASE_URL is missing or
 * malformed. If that ran at module scope, importing this file would throw —
 * which takes down every route that imports it, including /api/health. The
 * healthcheck would then fail with an opaque 5xx for its whole retry window
 * and tell you nothing, when the actual fault is one unset variable.
 *
 * Constructing on first use instead means the process always boots and always
 * serves, and /api/health can report the real reason.
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

let client: PrismaClient | null = globalForPrisma.prisma ?? null;
let initError: Error | null = null;

function getClient(): PrismaClient {
  if (client) return client;
  if (initError) throw initError;

  try {
    client = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
    // Next's dev server hot-reloads modules; without the global cache each
    // reload opens a new pool and Postgres runs out of connections.
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = client;
    return client;
  } catch (err) {
    initError = err as Error;
    throw initError;
  }
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    // Never let an `await prisma` or a promise-resolution check trigger
    // construction — it would surface a config error as a bizarre stack trace.
    if (prop === 'then' || prop === 'catch' || prop === 'finally') return undefined;

    const value = Reflect.get(getClient() as object, prop, receiver);
    return typeof value === 'function' ? value.bind(getClient()) : value;
  },
});

/**
 * Prisma errors lead with a generic "Invalid `prisma.x()` invocation:" line and
 * put the actual cause several blank lines down. Keep the informative part.
 */
function usefulPart(message: string): string {
  const lines = message
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !/^Invalid `prisma\..*` invocation:?$/.test(l))
    .filter((l) => !/^at\s/.test(l));

  return (lines.join(' ') || message.trim()).slice(0, 400);
}

/**
 * Why the client could not be built, if it could not. Used by /api/health to
 * turn a dead deploy into a readable sentence.
 */
export function databaseInitError(): string | null {
  if (!process.env.DATABASE_URL?.trim()) {
    return (
      'DATABASE_URL is not set on this service. On Railway, add it to the APP service as ' +
      'DATABASE_URL = ${{Postgres.DATABASE_URL}} — the variable shown on the Postgres plugin is not shared automatically.'
    );
  }
  if (initError) return usefulPart(initError.message);
  return null;
}

/** Non-throwing connectivity probe. */
export async function probeDatabase(): Promise<{ ok: boolean; detail: string | null }> {
  if (!process.env.DATABASE_URL?.trim()) {
    return { ok: false, detail: databaseInitError() };
  }
  try {
    await getClient().$queryRaw`SELECT 1`;
    return { ok: true, detail: null };
  } catch (err) {
    return { ok: false, detail: usefulPart((err as Error)?.message ?? String(err)) };
  }
}
