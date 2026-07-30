import { prisma } from '@/lib/db';
import { loadRun, serialiseRun } from '@/lib/run-service';
import { errorResponse, jsonResponse } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const run = await loadRun(id);
    if (!run) return errorResponse('Run not found', 404);

    return jsonResponse({
      state: serialiseRun(run),
      messages: run.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  } catch (err) {
    return errorResponse((err as Error).message, 500);
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await prisma.run.delete({ where: { id } });
    return jsonResponse({ ok: true });
  } catch {
    return errorResponse('Run not found', 404);
  }
}
