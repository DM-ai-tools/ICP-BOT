/**
 * Export assembly.
 *
 * Everything is built on demand from stored markdown — no artefact is cached to
 * disk, because Railway's filesystem is ephemeral and a download link that
 * works until the next redeploy is worse than no link at all. It also means
 * every download stays reachable from the saved-runs list forever.
 */
import 'server-only';
import JSZip from 'jszip';
import { prisma } from './db';
import { awarenessLabel, awarenessShort, scenarioRank, type AwarenessKey } from './awareness';
import {
  buildAwarenessMapDocx,
  buildSingleDocx,
  coverInfoFrom,
  dateStamp,
  exportFilename,
} from './docx';
import { buildPdf } from './pdf';
import { comparisonToMarkdown, type ComparisonRow } from './compare';
import { slugify, type SlotValues } from './slots';
import { slotsOf } from './run-service';

export interface ExportTarget {
  runId: string;
  documentId?: string;
  serviceIndex?: number;
}

export async function loadRunForExport(runId: string) {
  return prisma.run.findUnique({
    where: { id: runId },
    include: {
      documents: { orderBy: [{ serviceIndex: 'asc' }, { createdAt: 'asc' }] },
      comparisons: true,
    },
  });
}

type ExportRun = NonNullable<Awaited<ReturnType<typeof loadRunForExport>>>;
type ExportDoc = ExportRun['documents'][number];

/** Only documents that still match the current brief are exportable. */
export function exportableDocuments(run: ExportRun, serviceIndex?: number): ExportDoc[] {
  const usable = run.documents.filter(
    (doc) =>
      ['complete', 'repaired', 'failed'].includes(doc.status) &&
      doc.markdown.trim().length > 0 &&
      (serviceIndex === undefined || doc.serviceIndex === serviceIndex),
  );

  return usable.sort((a, b) => {
    if (a.serviceIndex !== b.serviceIndex) return a.serviceIndex - b.serviceIndex;
    return scenarioRank(a.scenario as AwarenessKey) - scenarioRank(b.scenario as AwarenessKey);
  });
}

function titleFor(slots: SlotValues): string {
  return slots.company_name?.trim() || slots.industry?.trim() || 'Ideal Customer Profile';
}

function subtitleFor(slots: SlotValues, serviceName: string): string {
  const bits = [serviceName];
  if (slots.industry) bits.push(slots.industry);
  if (slots.region) bits.push(slots.region);
  return bits.join(' · ');
}

// ---------------------------------------------------------------------------
// Single scenario
// ---------------------------------------------------------------------------

export async function exportSingleDocx(
  run: ExportRun,
  doc: ExportDoc,
): Promise<{ buffer: Buffer; filename: string }> {
  const slots = slotsOf(run);
  const cover = coverInfoFrom(slots, {
    serviceName: doc.serviceName,
    scenarioLabel: doc.awarenessLabel,
    masterPromptVersion: doc.masterPromptVersion,
    title: titleFor(slots),
    subtitle: subtitleFor(slots, doc.serviceName),
  });

  const buffer = await buildSingleDocx({ markdown: doc.markdown, cover });
  return {
    buffer,
    filename: exportFilename(slots.company_name, awarenessShort(doc.scenario as AwarenessKey), 'docx'),
  };
}

export async function exportSinglePdf(
  run: ExportRun,
  doc: ExportDoc,
): Promise<{ buffer: Buffer; filename: string }> {
  const slots = slotsOf(run);
  const cover = coverInfoFrom(slots, {
    serviceName: doc.serviceName,
    scenarioLabel: doc.awarenessLabel,
    masterPromptVersion: doc.masterPromptVersion,
    title: titleFor(slots),
    subtitle: subtitleFor(slots, doc.serviceName),
  });

  const buffer = await buildPdf({ markdown: doc.markdown, cover });
  return {
    buffer,
    filename: exportFilename(slots.company_name, awarenessShort(doc.scenario as AwarenessKey), 'pdf'),
  };
}

export function exportSingleMarkdown(
  run: ExportRun,
  doc: ExportDoc,
): { body: string; filename: string } {
  const slots = slotsOf(run);
  const frontMatter = [
    '---',
    `company: ${slots.company_name ?? 'Not specified'}`,
    `offer: ${doc.serviceName}`,
    `region: ${slots.region ?? 'Not specified'}`,
    `business_model: ${slots.business_model ?? 'Not specified'}`,
    `audience_type: ${slots.audience_type ?? 'direct_buyer'}`,
    `maturity_tier: ${slots.maturity_tier ?? 'Not specified'}`,
    `awareness_level: ${doc.awarenessLabel}`,
    `generated: ${doc.completedAt?.toISOString() ?? doc.updatedAt.toISOString()}`,
    `master_prompt_version: ${doc.masterPromptVersion}`,
    `quality: ${doc.badge ?? 'unknown'}`,
    '---',
    '',
  ].join('\n');

  return {
    body: frontMatter + doc.markdown,
    filename: exportFilename(slots.company_name, awarenessShort(doc.scenario as AwarenessKey), 'md'),
  };
}

// ---------------------------------------------------------------------------
// Awareness map
// ---------------------------------------------------------------------------

export async function exportAwarenessMapDocx(
  run: ExportRun,
  serviceIndex?: number,
): Promise<{ buffer: Buffer; filename: string }> {
  const slots = slotsOf(run);
  const docs = exportableDocuments(run, serviceIndex);

  if (!docs.length) throw new Error('There are no generated documents to export yet.');

  const targetService = serviceIndex ?? docs[0].serviceIndex;
  const chapterDocs = docs.filter((d) => d.serviceIndex === targetService);
  const serviceName = chapterDocs[0]?.serviceName ?? docs[0].serviceName;

  const comparison = run.comparisons.find((c) => c.serviceIndex === targetService);

  const cover = coverInfoFrom(slots, {
    serviceName,
    scenarioLabel: `${chapterDocs.length} awareness stages`,
    masterPromptVersion: run.masterPromptVersion,
    title: titleFor(slots),
    subtitle: subtitleFor(slots, serviceName),
  });

  const buffer = await buildAwarenessMapDocx({
    cover,
    comparison: comparison
      ? { rows: (comparison.rows as unknown as ComparisonRow[]) ?? [], serviceName }
      : null,
    chapters: chapterDocs.map((doc) => ({
      scenario: doc.scenario as AwarenessKey,
      markdown: doc.markdown,
      badge: doc.badge,
    })),
  });

  return {
    buffer,
    filename: `${slugify(slots.company_name || 'icp')}-awareness-map-${dateStamp()}.docx`,
  };
}

// ---------------------------------------------------------------------------
// Zip
// ---------------------------------------------------------------------------

export async function exportZip(
  run: ExportRun,
  serviceIndex?: number,
): Promise<{ buffer: Buffer; filename: string }> {
  const slots = slotsOf(run);
  const docs = exportableDocuments(run, serviceIndex);
  if (!docs.length) throw new Error('There are no generated documents to export yet.');

  const zip = new JSZip();

  // The map goes at the root — it is the file people open first.
  try {
    const map = await exportAwarenessMapDocx(run, serviceIndex ?? docs[0].serviceIndex);
    zip.file(map.filename, map.buffer);
  } catch {
    // A failed map must not cost the individual files.
  }

  const docxFolder = zip.folder('scenarios-docx');
  const mdFolder = zip.folder('scenarios-markdown');

  for (const doc of docs) {
    const single = await exportSingleDocx(run, doc);
    docxFolder?.file(single.filename, single.buffer);

    const markdown = exportSingleMarkdown(run, doc);
    mdFolder?.file(markdown.filename, markdown.body);
  }

  const comparison = run.comparisons.find(
    (c) => c.serviceIndex === (serviceIndex ?? docs[0].serviceIndex),
  );
  if (comparison) {
    const rows = (comparison.rows as unknown as ComparisonRow[]) ?? [];
    zip.file(
      `${slugify(slots.company_name || 'icp')}-comparison-${dateStamp()}.md`,
      comparison.markdown || comparisonToMarkdown(rows, comparison.serviceName),
    );
  }

  zip.file(
    'README.txt',
    [
      `Ideal Customer Profiles — ${slots.company_name ?? 'Untitled'}`,
      `Generated ${new Date().toISOString().slice(0, 10)}`,
      `Master prompt version: ${run.masterPromptVersion}`,
      '',
      'Contents',
      '  awareness-map.docx      Cover, comparison table and every scenario as a chapter with a table of contents.',
      '  scenarios-docx/         Each awareness stage as a standalone Word file.',
      '  scenarios-markdown/     The same content as raw markdown.',
      '',
      'Scenarios included:',
      ...docs.map(
        (doc) =>
          `  - ${awarenessLabel(doc.scenario as AwarenessKey)} (${doc.badge ?? 'unknown'})`,
      ),
      '',
      'Word headings use real Heading 1/2/3 styles, so you can apply your own',
      'template and the navigation pane and table of contents will follow.',
    ].join('\n'),
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    buffer,
    filename: `${slugify(slots.company_name || 'icp')}-icp-pack-${dateStamp()}.zip`,
  };
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  md: 'text/markdown; charset=utf-8',
  zip: 'application/zip',
};

export function fileResponse(
  buffer: Buffer | string,
  filename: string,
  extension: keyof typeof MIME,
): Response {
  const body = typeof buffer === 'string' ? Buffer.from(buffer, 'utf8') : buffer;
  return new Response(new Uint8Array(body), {
    headers: {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store',
    },
  });
}
