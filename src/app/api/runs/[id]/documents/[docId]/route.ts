import { prisma } from '@/lib/db';
import { serialiseDocumentDetail } from '@/lib/run-service';
import { errorResponse, jsonResponse } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id, docId } = await params;

  const doc = await prisma.document.findFirst({ where: { id: docId, runId: id } });
  if (!doc) return errorResponse('Document not found', 404);

  return jsonResponse({ document: serialiseDocumentDetail(doc) });
}
