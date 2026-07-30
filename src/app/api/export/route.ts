/**
 * Every download, built on demand from stored markdown.
 *
 *   /api/export?runId=…&format=map-docx                → awareness map DOCX
 *   /api/export?runId=…&format=zip                     → everything, zipped
 *   /api/export?runId=…&documentId=…&format=docx|pdf|md → one scenario
 *
 * `serviceIndex` narrows the map and the zip when a brief has more than one
 * service.
 */
import {
  exportAwarenessMapDocx,
  exportSingleDocx,
  exportSingleMarkdown,
  exportSinglePdf,
  exportSingleXlsx,
  exportZip,
  fileResponse,
  loadRunForExport,
  parseZipSelection,
} from '@/lib/export-service';
import { errorResponse } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get('runId');
  const documentId = url.searchParams.get('documentId');
  const format = (url.searchParams.get('format') ?? 'docx').toLowerCase();
  const serviceIndexRaw = url.searchParams.get('serviceIndex');
  const serviceIndex = serviceIndexRaw !== null ? Number(serviceIndexRaw) : undefined;

  if (!runId) return errorResponse('runId is required');

  const run = await loadRunForExport(runId);
  if (!run) return errorResponse('Run not found', 404);

  try {
    if (format === 'map-docx') {
      const { buffer, filename } = await exportAwarenessMapDocx(
        run,
        Number.isFinite(serviceIndex) ? serviceIndex : undefined,
      );
      return fileResponse(buffer, filename, 'docx');
    }

    if (format === 'zip') {
      // `include=<docId>:<dpm>,…` narrows the bundle to exactly the
      // scenario/format cells the user left selected. Absent means everything.
      const { buffer, filename } = await exportZip(
        run,
        Number.isFinite(serviceIndex) ? serviceIndex : undefined,
        parseZipSelection(url.searchParams.get('include')),
      );
      return fileResponse(buffer, filename, 'zip');
    }

    if (!documentId) return errorResponse('documentId is required for single-document exports');

    const doc = run.documents.find((d) => d.id === documentId);
    if (!doc) return errorResponse('Document not found', 404);
    if (!doc.markdown.trim()) return errorResponse('That document has no content yet', 409);

    if (format === 'md' || format === 'markdown') {
      const { body, filename } = exportSingleMarkdown(run, doc);
      return fileResponse(body, filename, 'md');
    }
    if (format === 'xlsx' || format === 'excel') {
      const { buffer, filename } = await exportSingleXlsx(run, doc);
      return fileResponse(buffer, filename, 'xlsx');
    }
    if (format === 'pdf') {
      const { buffer, filename } = await exportSinglePdf(run, doc);
      return fileResponse(buffer, filename, 'pdf');
    }

    const { buffer, filename } = await exportSingleDocx(run, doc);
    return fileResponse(buffer, filename, 'docx');
  } catch (err) {
    return errorResponse((err as Error).message || 'Export failed', 500);
  }
}
