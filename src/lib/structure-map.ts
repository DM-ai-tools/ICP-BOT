/**
 * The folder map.
 *
 * A pack of twenty documents across six folders is obvious to whoever built it
 * and opaque to whoever receives it. This draws the tree once — as a picture
 * for the chat and the zip, and as plain text for anyone who would rather read
 * it — so nobody has to open the archive to understand what is in it.
 *
 * Colour carries the one distinction that matters: the whole-business profile
 * is the parent, and the sub-service profiles hang off it. Everything else is
 * grey on purpose.
 *
 * Client-safe: the chat renders this in the browser and the export writes it
 * into the zip, from this one implementation. Two copies would drift, and a map
 * that disagrees with the archive is worse than no map.
 */

export type StructureTier = 'generic' | 'focused';

export interface StructureFolder {
  tier: StructureTier;
  /** Folder name in the zip, or null when the pack is flat. */
  folder: string | null;
  /** What this profile set is for. */
  serviceName: string;
  /** Awareness stages present, in order. */
  scenarios: string[];
  /** Formats each stage was exported in, e.g. ['PDF', 'Excel']. */
  formats: string[];
  /** Whether a comparison table was built for it. */
  comparison: boolean;
}

export interface StructureInput {
  zipName: string;
  companyName: string | null;
  folders: StructureFolder[];
  /** Extra files at the root of the zip. */
  rootFiles: { name: string; note: string }[];
}

// ---------------------------------------------------------------------------
// Turning a run into a tree
//
// One implementation, used by the chat and by the export. The folder names it
// produces must match the ones the zip actually writes — a map that disagrees
// with the archive is worse than no map — so the naming rule lives here and
// export-service calls it rather than repeating it.
// ---------------------------------------------------------------------------

export interface StructureDoc {
  serviceIndex: number;
  serviceName: string;
  tier: StructureTier;
  serviceSlug: string | null;
  awarenessLabel: string;
}

function slugFor(value: string): string {
  return (
    value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'service'
  );
}

/** The folder a service's files land in. Flat packs return null. */
export function folderNameFor(
  doc: { tier: StructureTier; serviceSlug: string | null; serviceName: string },
  position: number,
  nested: boolean,
): string | null {
  if (!nested) return null;
  const slug = doc.serviceSlug?.trim() || slugFor(doc.serviceName);
  return `${String(position).padStart(2, '0')}-${slug}`;
}

export function buildStructure(opts: {
  zipName: string;
  companyName: string | null;
  documents: StructureDoc[];
  /** Service indexes that have a comparison table. */
  comparisonFor: number[];
  /** Display names of the formats included, e.g. ['PDF', 'Excel']. */
  formats: string[];
}): StructureInput {
  const byService = new Map<number, StructureDoc[]>();
  for (const doc of opts.documents) {
    if (!byService.has(doc.serviceIndex)) byService.set(doc.serviceIndex, []);
    byService.get(doc.serviceIndex)!.push(doc);
  }

  const groups = [...byService.entries()].sort((a, b) => a[0] - b[0]);
  const nested = groups.length > 1;
  const comparisons = new Set(opts.comparisonFor);

  const folders: StructureFolder[] = groups.map(([index, docs], position) => ({
    tier: docs[0].tier,
    folder: folderNameFor(docs[0], position + 1, nested),
    serviceName: docs[0].serviceName,
    scenarios: docs.map((d) => d.awarenessLabel),
    formats: opts.formats,
    comparison: comparisons.has(index),
  }));

  const rootFiles: { name: string; note: string }[] = [];
  if (nested) {
    rootFiles.push({ name: 'ARCHITECTURE.md', note: 'how these profiles relate, and how each was built' });
  }
  rootFiles.push(
    { name: 'FILE-STRUCTURE.txt', note: 'this map, in plain text' },
    { name: 'folder-structure.svg', note: 'this map, as a picture' },
    { name: 'README.txt', note: 'contents and quality badges' },
  );

  return { zipName: opts.zipName, companyName: opts.companyName, folders, rootFiles };
}

// ---------------------------------------------------------------------------
// Palette
//
// Baked into the SVG rather than inherited from the page, because the same
// image has to look identical in the chat, in the zip and in whatever the
// recipient opens it with.
// ---------------------------------------------------------------------------

const C = {
  ink: '#0f172a',
  muted: '#64748b',
  faint: '#94a3b8',
  line: '#cbd5e1',
  page: '#ffffff',
  root: '#1e293b',
  rootText: '#f8fafc',
  generic: '#0d9488',
  genericBg: '#ecfdf5',
  focused: '#7c3aed',
  focusedBg: '#f5f3ff',
  file: '#64748b',
  fileBg: '#f8fafc',
} as const;

const W = 900;
const PAD = 26;
const ROOT_H = 46;
const FOLDER_H = 52;
const FILE_H = 26;
const GAP = 10;

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Rows inside one folder: the map, each format directory, the comparison. */
function childRows(folder: StructureFolder): { name: string; note: string }[] {
  const rows: { name: string; note: string }[] = [
    { name: 'awareness-map.docx', note: 'all stages in one Word file, with a contents page' },
  ];
  if (folder.formats.includes('PDF')) {
    rows.push({ name: 'scenarios-pdf/', note: `${folder.scenarios.length} PDFs — one per stage` });
  }
  if (folder.formats.includes('Excel')) {
    rows.push({ name: 'scenarios-excel/', note: `${folder.scenarios.length} spreadsheets — one per stage` });
  }
  if (folder.formats.includes('Word')) {
    rows.push({ name: 'scenarios-docx/', note: `${folder.scenarios.length} Word files — one per stage` });
  }
  if (folder.formats.includes('Markdown')) {
    rows.push({ name: 'scenarios-markdown/', note: `${folder.scenarios.length} markdown files` });
  }
  if (folder.comparison) {
    rows.push({ name: 'comparison.md', note: 'how the stages differ, side by side' });
  }
  return rows;
}

export function buildStructureSvg(input: StructureInput): string {
  const parts: string[] = [];
  let y = PAD;

  // ---- root ---------------------------------------------------------------
  parts.push(
    `<rect x="${PAD}" y="${y}" width="${W - PAD * 2}" height="${ROOT_H}" rx="10" fill="${C.root}"/>`,
    `<text x="${PAD + 18}" y="${y + 29}" font-size="15" font-weight="600" fill="${C.rootText}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${esc(truncate(input.zipName, 64))}</text>`,
  );
  const spineTop = y + ROOT_H;
  y = spineTop + GAP + 6;

  const spineX = PAD + 26;
  const rows: string[] = [];
  let lastConnectorY = y;

  // ---- root-level files ---------------------------------------------------
  for (const file of input.rootFiles) {
    const rowY = y;
    rows.push(
      `<path d="M ${spineX} ${rowY + FILE_H / 2} H ${spineX + 16}" stroke="${C.line}" stroke-width="1.5" fill="none"/>`,
      `<rect x="${spineX + 16}" y="${rowY}" width="${W - spineX - 16 - PAD}" height="${FILE_H}" rx="5" fill="${C.fileBg}" stroke="${C.line}" stroke-width="1"/>`,
      `<rect x="${spineX + 16}" y="${rowY}" width="3" height="${FILE_H}" rx="1.5" fill="${C.file}"/>`,
      `<text x="${spineX + 30}" y="${rowY + 17}" font-size="12" font-weight="600" fill="${C.ink}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${esc(file.name)}</text>`,
      `<text x="${spineX + 30 + Math.min(file.name.length * 7.1 + 16, 260)}" y="${rowY + 17}" font-size="11.5" fill="${C.muted}" font-family="-apple-system, Segoe UI, sans-serif">${esc(file.note)}</text>`,
    );
    lastConnectorY = rowY + FILE_H / 2;
    y += FILE_H + 6;
  }

  if (input.rootFiles.length) y += 8;

  // ---- folders ------------------------------------------------------------
  for (const folder of input.folders) {
    const accent = folder.tier === 'generic' ? C.generic : C.focused;
    const background = folder.tier === 'generic' ? C.genericBg : C.focusedBg;
    const children = childRows(folder);
    const innerX = spineX + 40;
    const blockH = FOLDER_H + children.length * (FILE_H + 4) + 12;
    const rowY = y;

    rows.push(
      `<path d="M ${spineX} ${rowY + FOLDER_H / 2} H ${spineX + 16}" stroke="${C.line}" stroke-width="1.5" fill="none"/>`,
      `<rect x="${spineX + 16}" y="${rowY}" width="${W - spineX - 16 - PAD}" height="${blockH}" rx="9" fill="${background}" stroke="${accent}" stroke-opacity="0.32" stroke-width="1"/>`,
      `<rect x="${spineX + 16}" y="${rowY}" width="4" height="${blockH}" rx="2" fill="${accent}"/>`,
      `<text x="${spineX + 34}" y="${rowY + 24}" font-size="14" font-weight="700" fill="${accent}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${esc(truncate(folder.folder ?? '(pack root)', 46))}</text>`,
      `<text x="${spineX + 34}" y="${rowY + 42}" font-size="12" fill="${C.muted}" font-family="-apple-system, Segoe UI, sans-serif">${esc(truncate(folder.serviceName, 52))} · ${folder.scenarios.length} awareness stages${folder.tier === 'focused' ? ' · sub-service' : ''}</text>`,
    );

    let childY = rowY + FOLDER_H;
    for (const child of children) {
      rows.push(
        `<path d="M ${innerX - 12} ${childY + FILE_H / 2} H ${innerX}" stroke="${accent}" stroke-opacity="0.35" stroke-width="1.5" fill="none"/>`,
        `<text x="${innerX + 4}" y="${childY + 17}" font-size="12" font-weight="600" fill="${C.ink}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace">${esc(child.name)}</text>`,
        `<text x="${innerX + 4 + Math.min(child.name.length * 7.1 + 18, 250)}" y="${childY + 17}" font-size="11.5" fill="${C.faint}" font-family="-apple-system, Segoe UI, sans-serif">${esc(child.note)}</text>`,
      );
      childY += FILE_H + 4;
    }

    lastConnectorY = rowY + FOLDER_H / 2;
    y += blockH + GAP;
  }

  // ---- legend -------------------------------------------------------------
  const legendY = y + 4;
  const legend: [string, string][] = [];
  const genericCount = input.folders.filter((f) => f.tier === 'generic').length;
  if (genericCount > 0) {
    // "The parent" only means something when there are children under it. Three
    // services named in conversation are three peers, and calling each of them
    // the whole business reads as a mistake.
    legend.push([
      C.generic,
      genericCount > 1 || !input.folders.some((f) => f.tier === 'focused')
        ? 'Profile set — one per offer'
        : 'Whole-business profile — the parent',
    ]);
  }
  if (input.folders.some((f) => f.tier === 'focused')) {
    legend.push([C.focused, 'Sub-service profile — one offer each']);
  }
  legend.push([C.file, 'Reference files']);

  let legendX = PAD + 2;
  for (const [colour, label] of legend) {
    rows.push(
      `<rect x="${legendX}" y="${legendY + 2}" width="10" height="10" rx="3" fill="${colour}"/>`,
      `<text x="${legendX + 16}" y="${legendY + 11}" font-size="11.5" fill="${C.muted}" font-family="-apple-system, Segoe UI, sans-serif">${esc(label)}</text>`,
    );
    legendX += label.length * 6.3 + 46;
  }

  const height = legendY + 26;

  // The spine is drawn after the rows so its length is known, and behind them
  // so a row's fill covers where it would otherwise poke through.
  const spine = `<path d="M ${spineX} ${spineTop} V ${lastConnectorY}" stroke="${C.line}" stroke-width="1.5" fill="none"/>`;

  parts.splice(2, 0, spine);
  parts.push(...rows);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" role="img" aria-label="Folder structure of the downloaded ICP pack">`,
    `<rect width="${W}" height="${height}" rx="12" fill="${C.page}"/>`,
    ...parts,
    '</svg>',
  ].join('');
}

// ---------------------------------------------------------------------------
// The same tree, as text
// ---------------------------------------------------------------------------

export function buildStructureText(input: StructureInput): string {
  const lines: string[] = [];
  const company = input.companyName ?? 'this business';

  lines.push(
    `WHAT IS IN THIS DOWNLOAD — ${company}`,
    '='.repeat(72),
    '',
    'Every file below was generated from one brief. The whole-business profile',
    'describes the buyer as the business presents itself to the market. Each',
    'sub-service profile describes the buyer of one specific offer, because',
    'those are usually different people — averaging them describes nobody.',
    '',
    input.zipName,
  );

  for (const file of input.rootFiles) {
    lines.push(`  ${file.name.padEnd(28)}${file.note}`);
  }

  if (input.rootFiles.length) lines.push('');

  for (const folder of input.folders) {
    const kind = folder.tier === 'generic' ? 'WHOLE BUSINESS' : 'SUB-SERVICE';
    lines.push(
      `  ${(folder.folder ?? '(pack root)') + '/'}`,
      `      ${kind} — ${folder.serviceName}`,
      `      ${folder.scenarios.length} awareness stages: ${folder.scenarios.join(', ')}`,
      '',
    );
    for (const child of childRows(folder)) {
      lines.push(`      ${child.name.padEnd(24)}${child.note}`);
    }
    lines.push('');
  }

  lines.push(
    '-'.repeat(72),
    '',
    'AWARENESS STAGES',
    '',
    '  Each profile set covers the same buyer at four different points of',
    '  understanding — from not knowing they have a problem, through to',
    '  comparing you against a named alternative. What persuades someone at one',
    '  stage often puts them off at another, which is what the comparison file',
    '  is for.',
    '',
    'A NOTE ON THE NUMBERS',
    '',
    '  No price, rate or statistic appears anywhere unless it was supplied in',
    '  the brief. Where a figure was not given, the documents say so rather',
    '  than estimating one.',
    '',
  );

  return lines.join('\n');
}
