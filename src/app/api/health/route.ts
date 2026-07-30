/**
 * Railway healthcheck target.
 *
 * Always returns 200 as long as the process can serve, and reports *why* it is
 * degraded. That distinction matters: a healthcheck that 5xx's because one
 * environment variable is unset tells you nothing except "it's broken", and you
 * spend the retry window guessing. This one names the fault.
 *
 * Nothing in here may throw. Every dependency is probed defensively.
 */
import { NextResponse } from 'next/server';
import { envProblems } from '@/lib/env';
import { masterPromptInfo } from '@/lib/master-prompt';
import { probeDatabase } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const problems: string[] = [];

  try {
    problems.push(...envProblems());
  } catch (err) {
    problems.push(`environment unreadable: ${(err as Error).message}`);
  }

  let database: 'ok' | 'unreachable' = 'unreachable';
  let databaseDetail: string | null = null;
  try {
    const probe = await probeDatabase();
    database = probe.ok ? 'ok' : 'unreachable';
    databaseDetail = probe.detail;
    if (!probe.ok) problems.push(`database: ${probe.detail ?? 'unreachable'}`);
  } catch (err) {
    databaseDetail = (err as Error).message;
    problems.push(`database: ${databaseDetail}`);
  }

  let prompt: { version: string; sha256: string; bytes: number } | null = null;
  try {
    const info = masterPromptInfo();
    prompt = { version: info.version, sha256: info.sha256.slice(0, 16), bytes: info.bytes };
  } catch (err) {
    problems.push(`master prompt not loadable: ${(err as Error).message}`);
  }

  return NextResponse.json(
    {
      status: problems.length === 0 ? 'ok' : 'degraded',
      service: 'icp-builder',
      database,
      databaseDetail,
      masterPrompt: prompt,
      problems,
      node: process.version,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    // Deliberately 200 even when degraded: the container is up and serving, and
    // a readable diagnosis beats a healthcheck loop that reveals nothing.
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
