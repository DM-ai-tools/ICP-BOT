/**
 * Railway healthcheck target.
 *
 * Returns 200 as soon as the process can serve, and reports *why* it is
 * unhealthy rather than failing opaquely. The database is probed but a slow or
 * still-starting Postgres does not fail the check — the app boots, serves, and
 * reports degraded, which is far easier to debug than a deploy that never
 * goes live.
 */
import { NextResponse } from 'next/server';
import { envProblems } from '@/lib/env';
import { masterPromptInfo } from '@/lib/master-prompt';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const problems = envProblems();

  let database: 'ok' | 'unreachable' = 'unreachable';
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = 'ok';
  } catch {
    problems.push('database unreachable');
  }

  let prompt: { version: string; sha256: string; bytes: number; loadedFrom: string } | null = null;
  try {
    prompt = masterPromptInfo();
  } catch (err) {
    problems.push(`master prompt not loadable: ${(err as Error).message}`);
  }

  return NextResponse.json(
    {
      status: problems.length === 0 ? 'ok' : 'degraded',
      service: 'icp-builder',
      database,
      masterPrompt: prompt
        ? {
            version: prompt.version,
            sha256: prompt.sha256.slice(0, 16),
            bytes: prompt.bytes,
          }
        : null,
      problems,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
