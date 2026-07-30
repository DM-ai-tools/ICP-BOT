import { getAudienceMode, isAudienceMode, setAudienceMode } from '@/lib/settings';
import { errorResponse, jsonResponse } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return jsonResponse({ audienceMode: await getAudienceMode() });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}

export async function PUT(request: Request) {
  let body: { audienceMode?: unknown };
  try {
    body = (await request.json()) as { audienceMode?: unknown };
  } catch {
    return errorResponse('Invalid JSON body');
  }

  if (!isAudienceMode(body.audienceMode)) {
    return errorResponse('audienceMode must be "strategist" or "client"');
  }

  try {
    await setAudienceMode(body.audienceMode);
    return jsonResponse({ audienceMode: body.audienceMode });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}
