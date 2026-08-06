import { getAudienceMode, isAudienceMode, setAudienceMode } from '@/lib/settings';
import { errorResponse, jsonResponse } from '@/lib/sse';
import { guard } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const gate = await guard({ admin: true });
  if (gate.response) return gate.response;

  try {
    return jsonResponse({ audienceMode: await getAudienceMode() });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}

export async function PUT(request: Request) {
  const gate = await guard({ admin: true });
  if (gate.response) return gate.response;

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
