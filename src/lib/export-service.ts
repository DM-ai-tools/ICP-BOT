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
import { buildXlsx } from './xlsx';
import { comparisonToMarkdown, type ComparisonRow } from './compare';
import { slugify, type SlotValues } from './slots';
import { slotsOf } from './run-service';
import { buildStructure, buildStructureSvg, buildStructureText } from './structure-map';

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

export async function exportSingleXlsx(
  run: ExportRun,
  doc: ExportDoc,
): Promise<{ buffer: Buffer; filename: string }> {
  const slots = slotsOf(run);
  const services = slots.services ?? [];

  const buffer = await buildXlsx({
    markdown: doc.markdown,
    slots,
    serviceName: doc.serviceName,
    service: services[doc.serviceIndex] ?? services[0],
    awarenessLabel: doc.awarenessLabel,
    masterPromptVersion: doc.masterPromptVersion,
    generatedAt: doc.completedAt ?? doc.updatedAt,
    badge: doc.badge,
  });

  return {
    buffer,
    filename: exportFilename(slots.company_name, awarenessShort(doc.scenario as AwarenessKey), 'xlsx'),
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

export type ExportFormat = 'pdf' | 'xlsx' | 'docx' | 'md';

/**
 * What the picker offers. PDF for reading and sending, Excel for working with
 * the content field-by-field.
 *
 * DOCX and Markdown are still reachable by direct URL — the awareness map is a
 * Word document and nothing about those exporters was removed — they are simply
 * no longer in the per-scenario bundle.
 */
export const SELECTABLE_FORMATS: ExportFormat[] = ['pdf', 'xlsx'];

/** Human names, for the structure map and anything else people read. */
export const FORMAT_LABEL: Record<ExportFormat, string> = {
  pdf: 'PDF',
  xlsx: 'Excel',
  docx: 'Word',
  md: 'Markdown',
};

/** documentId → which formats to include for that scenario. */
export type ZipSelection = Map<string, Set<ExportFormat>>;

const FORMAT_CODE: Record<string, ExportFormat> = {
  p: 'pdf',
  x: 'xlsx',
  d: 'docx',
  m: 'md',
};

/**
 * Parse the compact selection param: `docId:dpm,otherId:p`
 *
 * Compact because a full matrix of cuids and format names would push the query
 * string past what some proxies are happy to forward. Absent or unparseable
 * means "everything", which keeps old links working.
 */
export function parseZipSelection(param: string | null): ZipSelection | null {
  if (!param?.trim()) return null;

  const selection: ZipSelection = new Map();
  for (const entry of param.split(',')) {
    const [id, codes] = entry.split(':');
    if (!id || !codes) continue;

    const formats = new Set<ExportFormat>();
    for (const code of codes) {
      const format = FORMAT_CODE[code];
      if (format) formats.add(format);
    }
    if (formats.size) selection.set(id.trim(), formats);
  }

  return selection.size ? selection : null;
}

type Wants = (doc: ExportDoc, format: ExportFormat) => boolean;

/**
 * One service's worth of files, written into whichever folder it belongs to.
 *
 * Used for the root of a single-offer pack and for each sub-folder of a
 * multi-offer one, so the two layouts cannot drift apart — a strategist who
 * learns where the PDFs live in one pack knows where they live in the other.
 */
async function writeServiceFolder(
  folder: JSZip,
  run: ExportRun,
  serviceIndex: number,
  docs: ExportDoc[],
  wants: Wants,
): Promise<{ formats: ExportFormat[] }> {
  const slots = slotsOf(run);

  try {
    const map = await exportAwarenessMapDocx(run, serviceIndex);
    folder.file(map.filename, map.buffer);
  } catch {
    // A failed map must not cost the individual files.
  }

  const needs = (format: ExportFormat) => docs.some((doc) => wants(doc, format));
  const used: ExportFormat[] = [];

  const pdfFolder = needs('pdf') ? folder.folder('scenarios-pdf') : null;
  const excelFolder = needs('xlsx') ? folder.folder('scenarios-excel') : null;
  const docxFolder = needs('docx') ? folder.folder('scenarios-docx') : null;
  const mdFolder = needs('md') ? folder.folder('scenarios-markdown') : null;

  if (pdfFolder) used.push('pdf');
  if (excelFolder) used.push('xlsx');
  if (docxFolder) used.push('docx');
  if (mdFolder) used.push('md');

  for (const doc of docs) {
    if (wants(doc, 'pdf')) {
      const pdf = await exportSinglePdf(run, doc);
      pdfFolder?.file(pdf.filename, pdf.buffer);
    }
    if (wants(doc, 'xlsx')) {
      const excel = await exportSingleXlsx(run, doc);
      excelFolder?.file(excel.filename, excel.buffer);
    }
    if (wants(doc, 'docx')) {
      const single = await exportSingleDocx(run, doc);
      docxFolder?.file(single.filename, single.buffer);
    }
    if (wants(doc, 'md')) {
      const markdown = exportSingleMarkdown(run, doc);
      mdFolder?.file(markdown.filename, markdown.body);
    }
  }

  const comparison = run.comparisons.find((c) => c.serviceIndex === serviceIndex);
  if (comparison) {
    const rows = (comparison.rows as unknown as ComparisonRow[]) ?? [];
    folder.file(
      `${slugify(slots.company_name || 'icp')}-comparison-${dateStamp()}.md`,
      comparison.markdown || comparisonToMarkdown(rows, comparison.serviceName),
    );
  }

  return { formats: used };
}

/** Folder name for a service: numbered so the tree reads in build order. */
function serviceFolderName(doc: ExportDoc, position: number): string {
  const slug = doc.serviceSlug?.trim() || slugify(doc.serviceName || `service-${position}`);
  return `${String(position).padStart(2, '0')}-${slug}`;
}

export async function exportZip(
  run: ExportRun,
  serviceIndex?: number,
  selection?: ZipSelection | null,
): Promise<{ buffer: Buffer; filename: string }> {
  const slots = slotsOf(run);
  const all = exportableDocuments(run, serviceIndex);
  if (!all.length) throw new Error('There are no generated documents to export yet.');

  // A selection narrows both which scenarios appear and which formats each one
  // gets. No selection means everything, which is the default the UI ships with.
  const wants: Wants = (doc, format) =>
    !selection || (selection.get(doc.id)?.has(format) ?? false);

  const docs = selection ? all.filter((doc) => selection.has(doc.id)) : all;
  if (!docs.length) throw new Error('Nothing was selected to download.');

  const zip = new JSZip();
  const stamp = dateStamp();
  const company = slugify(slots.company_name || 'icp');

  // Group by service, preserving generate order: the whole-business profile
  // first, then each sub-service.
  const byService = new Map<number, ExportDoc[]>();
  for (const doc of docs) {
    if (!byService.has(doc.serviceIndex)) byService.set(doc.serviceIndex, []);
    byService.get(doc.serviceIndex)!.push(doc);
  }
  const groups = [...byService.entries()].sort((a, b) => a[0] - b[0]);

  // One offer stays flat. Nesting a four-file deliverable inside two folders
  // makes it harder to use, not more organised.
  const nested = groups.length > 1;

  if (!nested) {
    await writeServiceFolder(zip, run, groups[0][0], groups[0][1], wants);
  } else {
    for (const [position, [index, group]] of groups.entries()) {
      const first = group[0];
      const name =
        first.tier === 'focused'
          ? `${String(position + 1).padStart(2, '0')}-${first.serviceSlug?.trim() || slugify(first.serviceName)}`
          : serviceFolderName(first, position + 1);
      const folder = zip.folder(name);
      if (folder) await writeServiceFolder(folder, run, index, group, wants);
    }

    zip.file('ARCHITECTURE.md', architectureMap(run, slots, groups, wants));
  }

  // The map, drawn from the same data the folders were built from — as a
  // picture and as text, because half the people opening this will want one
  // and half the other. Identical to what the chat showed after the build.
  const structure = buildStructure({
    zipName: `${company}-icp-pack-${stamp}.zip`,
    companyName: slots.company_name ?? null,
    documents: docs.map((doc) => ({
      serviceIndex: doc.serviceIndex,
      serviceName: doc.serviceName,
      tier: doc.tier === 'focused' ? 'focused' : 'generic',
      serviceSlug: doc.serviceSlug ?? null,
      awarenessLabel: awarenessShort(doc.scenario as AwarenessKey),
    })),
    comparisonFor: run.comparisons.map((c) => c.serviceIndex),
    formats: SELECTABLE_FORMATS.filter((format) => docs.some((doc) => wants(doc, format))).map(
      (format) => FORMAT_LABEL[format],
    ),
  });

  zip.file('folder-structure.svg', buildStructureSvg(structure));
  zip.file('FILE-STRUCTURE.txt', buildStructureText(structure));

  zip.file(
    'README.txt',
    [
      `Ideal Customer Profiles — ${slots.company_name ?? 'Untitled'}`,
      `Generated ${new Date().toISOString().slice(0, 10)}`,
      `Master prompt version: ${run.masterPromptVersion}`,
      '',
      ...(nested
        ? [
            'This pack covers several offers. Each has its own folder, numbered in',
            'the order it was built. Open ARCHITECTURE.md first — it explains how',
            'the profiles relate to each other and how the pack was assembled.',
            '',
            'Folders',
            ...groups.map(([, group], position) => {
              const first = group[0];
              const name =
                first.tier === 'focused'
                  ? `${String(position + 1).padStart(2, '0')}-${first.serviceSlug?.trim() || slugify(first.serviceName)}`
                  : serviceFolderName(first, position + 1);
              const kind = first.tier === 'focused' ? 'sub-service' : 'whole business';
              return `  ${name}/`.padEnd(34) + `${first.serviceName} (${kind})`;
            }),
            '',
            'Inside each folder',
          ]
        : ['Contents']),
      '  awareness-map.docx      Cover, comparison table and every scenario as a chapter with a table of contents.',
      '  scenarios-pdf/          Each awareness stage as a PDF, for reading and sending.',
      '  scenarios-excel/        The same content as a spreadsheet: field name in column A, content in column B.',
      '  *-comparison-*.md       How the four stages differ, side by side.',
      '',
      'Documents included:',
      ...docs.map((doc) => {
        const formats = SELECTABLE_FORMATS.filter((f) => wants(doc, f));
        const prefix = nested ? `${doc.serviceName} — ` : '';
        return `  - ${prefix}${awarenessLabel(doc.scenario as AwarenessKey)} (${doc.badge ?? 'unknown'}) — ${formats.join(', ')}`;
      }),
      '',
      'Word headings use real Heading 1/2/3 styles, so you can apply your own',
      'template and the navigation pane and table of contents will follow.',
    ].join('\n'),
  );

  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    buffer,
    filename: `${company}-icp-pack-${stamp}.zip`,
  };
}

/**
 * The architecture map.
 *
 * A multi-offer pack is a structure, not a pile of files, and the structure
 * carries the argument: this is the business, these are its buyers, here is why
 * they were split this way. Someone opening the zip in six months — or a client
 * receiving it cold — needs that on one page before they open anything else.
 */
function architectureMap(
  run: ExportRun,
  slots: SlotValues,
  groups: [number, ExportDoc[]][],
  wants: Wants,
): string {
  const company = slots.company_name ?? 'This business';
  const generic = groups.filter(([, group]) => group[0].tier !== 'focused');
  const focused = groups.filter(([, group]) => group[0].tier === 'focused');

  const lines: string[] = [
    `# ${company} — how this pack is built`,
    '',
    `Generated ${new Date().toISOString().slice(0, 10)} · master prompt \`${run.masterPromptVersion}\``,
    '',
    '## What is here',
    '',
  ];

  if (generic.length && focused.length) {
    lines.push(
      `${company} sells several distinct things, so this pack has two levels. The whole-business profile is the`,
      'parent: it describes the buyer as the business presents itself to the market. Under it sits one profile',
      `set per sub-service, because those offers attract genuinely different people — and a single profile`,
      'averaging them would describe nobody.',
      '',
      'Read the whole-business set for positioning and brand-level messaging. Read a sub-service set when you are',
      'briefing a campaign, a landing page or a sales conversation for that specific offer.',
    );
  } else if (focused.length) {
    lines.push(
      `This pack covers ${focused.length} specific offer${focused.length === 1 ? '' : 's'} from ${company}, each with its own`,
      'buyer profile. There is no whole-business profile in this pack — it was not requested. Each set stands on',
      'its own and is briefed against that offer alone.',
    );
  } else {
    lines.push(`One profile set for ${company} as a whole.`);
  }

  lines.push('', '## The tree', '', '```');

  for (const [position, [, group]] of groups.entries()) {
    const first = group[0];
    const name =
      first.tier === 'focused'
        ? `${String(position + 1).padStart(2, '0')}-${first.serviceSlug?.trim() || slugify(first.serviceName)}`
        : serviceFolderName(first, position + 1);
    const kind = first.tier === 'focused' ? 'sub-service' : 'whole business';

    lines.push(`${name}/${' '.repeat(Math.max(1, 30 - name.length))}${first.serviceName} — ${kind}`);
    for (const doc of [...group].sort(
      (a, b) => scenarioRank(a.scenario as AwarenessKey) - scenarioRank(b.scenario as AwarenessKey),
    )) {
      const formats = SELECTABLE_FORMATS.filter((f) => wants(doc, f));
      lines.push(`  ├─ ${awarenessShort(doc.scenario as AwarenessKey).padEnd(16)}${formats.join(', ')}`);
    }
    lines.push('  └─ comparison — how those four stages differ');
  }

  lines.push('```', '', '## How each profile was produced', '');

  lines.push(
    '1. **Brief.** The conversation was resolved into a structured brief — industry, region, business model,',
    '   offers, pricing terms, company type and maturity — with each value marked as stated, inferred or',
    '   defaulted. Nothing was assumed silently.',
    '2. **Site read.** The website was fetched and used as verified context, so company facts are grounded',
    '   rather than invented. Its navigation and sitemap were followed to list the offers above.',
    '3. **Industry retrieval.** Domain intelligence for this vertical was retrieved from a persistent store and',
    '   added to the prompt before any document was written — vocabulary, roles, buying triggers, objections,',
    '   regulators. It carries no figures by design.',
    '4. **Generation.** Each document was written across sequential passes rather than one call, so every one of',
    '   the nineteen sections gets a full budget. The whole-business profile uses three passes; sub-service',
    '   profiles use two, against a brief already validated at the parent level.',
    '5. **Validation.** Every section was checked for presence, structure and depth. Anything failing was',
    '   repaired in a targeted second call and badged, so you can see which sections needed it.',
    '',
    '## Rules that were enforced',
    '',
    '- No price, rate or statistic appears anywhere unless it was supplied in the brief.',
    '- Each document is written at exactly one awareness stage and must read differently from its siblings.',
    '- A sub-service profile describes the buyer of that offer only, and may not blend in a neighbouring one.',
    '- The master prompt is immutable and versioned; the version above produced every file in this pack.',
  );

  if (slots.region) {
    lines.push(`- Spelling, vocabulary and regulator references are those of ${slots.region}.`);
  }

  lines.push('', '---', '', 'Reference material for briefing. Validate against your own client data before betting a budget on it.');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Response helper
// ---------------------------------------------------------------------------

const MIME: Record<string, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
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
