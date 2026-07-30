import { createRun, listRuns } from '@/lib/run-service';
import { errorResponse, jsonResponse } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse({ runs: await listRuns() });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}

export async function POST() {
  try {
    const id = await createRun();
    return jsonResponse({ id }, 201);
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}
