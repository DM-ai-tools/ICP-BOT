import { createRun, listRuns } from '@/lib/run-service';
import { errorResponse, jsonResponse } from '@/lib/sse';
import { guard } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await guard();
  if (gate.response) return gate.response;

  try {
    return jsonResponse({ runs: await listRuns() });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}

export async function POST() {
  const gate = await guard();
  if (gate.response) return gate.response;

  try {
    const id = await createRun();
    return jsonResponse({ id }, 201);
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}
