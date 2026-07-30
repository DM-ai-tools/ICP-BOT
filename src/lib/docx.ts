/**
 * DOCX export.
 *
 * Built with real Word heading styles (Heading1/Heading2/Heading3) rather than
 * bold paragraphs, so an agency can drop the file into their own template,
 * restyle it in one click, and have the navigation pane and any generated TOC
 * work properly. That is the whole point of DOCX over PDF here.
 *
 * Exports are built on demand from stored markdown, so every download stays
 * reachable from the saved-runs list long after the result screen is gone.
 */
import 'server-only';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
  convertInchesToTwip,
} from 'docx';
import { parseSections, stripInlineMarkup } from './markdown';
import { COMPARISON_COLUMNS, type ComparisonRow } from './compare';
import {
  AUDIENCE_TYPE_SHORT,
  BUSINESS_MODEL_SHORT,
  COMPANY_TYPE_SHORT,
  MATURITY_SHORT,
  slugify,
  type SlotValues,
} from './slots';
import { awarenessLabel, awarenessShort, type AwarenessKey } from './awareness';

const ACCENT = '1F3A5F';
const MUTED = '5A6472';
const RULE = 'D8DDE4';

// ---------------------------------------------------------------------------
// Inline markdown → runs
// ---------------------------------------------------------------------------

/** Bold, italic and inline code survive into Word; everything else flattens. */
function inlineRuns(text: string, base: { size?: number; color?: string } = {}): TextRun[] {
  const runs: TextRun[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  const push = (value: string, opts: { bold?: boolean; italics?: boolean; code?: boolean } = {}) => {
    if (!value) return;
    runs.push(
      new TextRun({
        text: value,
        bold: opts.bold,
        italics: opts.italics,
        font: opts.code ? 'Consolas' : undefined,
        size: base.size,
        color: base.color,
      }),
    );
  };

  while ((match = pattern.exec(text)) !== null) {
    push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**') || token.startsWith('__')) {
      push(token.slice(2, -2), { bold: true });
    } else if (token.startsWith('`')) {
      push(token.slice(1, -1), { code: true });
    } else {
      push(token.slice(1, -1), { italics: true });
    }
    cursor = match.index + token.length;
  }
  push(text.slice(cursor));

  return runs.length ? runs : [new TextRun({ text: '', size: base.size, color: base.color })];
}

// ---------------------------------------------------------------------------
// Markdown body → paragraphs
// ---------------------------------------------------------------------------

function bodyParagraphs(body: string, headingOffset = 0): Paragraph[] {
  const out: Paragraph[] = [];
  const lines = body.split(/\r?\n/);

  let tableBuffer: string[] = [];

  const flushTable = () => {
    if (tableBuffer.length >= 2) {
      out.push(...markdownTableAsParagraphs(tableBuffer));
    } else if (tableBuffer.length === 1) {
      out.push(new Paragraph({ children: inlineRuns(tableBuffer[0]) }));
    }
    tableBuffer = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (/^\s*\|/.test(line)) {
      tableBuffer.push(line);
      continue;
    }
    if (tableBuffer.length) flushTable();

    if (!line.trim()) continue;

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = Math.min(6, heading[1].length + headingOffset);
      out.push(
        new Paragraph({
          heading: headingLevel(level),
          spacing: { before: 240, after: 120 },
          children: inlineRuns(stripInlineMarkup(heading[2])),
        }),
      );
      continue;
    }

    const numbered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      out.push(
        new Paragraph({
          numbering: { reference: 'icp-numbered', level: 0 },
          spacing: { after: 80 },
          children: inlineRuns(numbered[2]),
        }),
      );
      continue;
    }

    const bulleted = line.match(/^\s*[-*•]\s+(.*)$/);
    if (bulleted) {
      out.push(
        new Paragraph({
          bullet: { level: leadingIndent(rawLine) },
          spacing: { after: 80 },
          children: inlineRuns(bulleted[1]),
        }),
      );
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      out.push(
        new Paragraph({
          indent: { left: convertInchesToTwip(0.3) },
          spacing: { after: 120 },
          border: { left: { style: BorderStyle.SINGLE, size: 12, color: RULE, space: 8 } },
          children: inlineRuns(line.replace(/^\s*>\s?/, ''), { color: MUTED }),
        }),
      );
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      out.push(
        new Paragraph({
          spacing: { before: 120, after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 4 } },
          children: [new TextRun('')],
        }),
      );
      continue;
    }

    out.push(new Paragraph({ spacing: { after: 140 }, children: inlineRuns(line) }));
  }

  if (tableBuffer.length) flushTable();
  return out;
}

function leadingIndent(line: string): number {
  const spaces = line.match(/^(\s*)/)?.[1].length ?? 0;
  return Math.min(2, Math.floor(spaces / 2));
}

function headingLevel(level: number) {
  switch (level) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

/** A markdown table inside a section body, rendered as indented lines. */
function markdownTableAsParagraphs(lines: string[]): Paragraph[] {
  const rows = lines
    .filter((line) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(line) || /[a-z0-9]/i.test(line))
    .map((line) =>
      line
        .replace(/^\s*\|/, '')
        .replace(/\|\s*$/, '')
        .split('|')
        .map((cell) => cell.trim()),
    );

  if (!rows.length) return [];
  const [header, ...body] = rows;

  return body.map(
    (row) =>
      new Paragraph({
        spacing: { after: 100 },
        children: row.flatMap((cell, index) => [
          new TextRun({ text: `${header[index] ?? ''}: `, bold: true, size: 20 }),
          ...inlineRuns(cell, { size: 20 }),
          new TextRun({ text: '   ', size: 20 }),
        ]),
      }),
  );
}

// ---------------------------------------------------------------------------
// Cover page
// ---------------------------------------------------------------------------

export interface CoverInfo {
  company: string;
  offer: string;
  region: string;
  audienceType: string;
  maturityTier: string;
  businessModel: string;
  companyType: string;
  scenario: string;
  date: string;
  masterPromptVersion: string;
  documentTitle: string;
  subtitle?: string;
}

export function coverInfoFrom(
  slots: SlotValues,
  opts: { serviceName: string; scenarioLabel: string; masterPromptVersion: string; title: string; subtitle?: string },
): CoverInfo {
  return {
    company: slots.company_name?.trim() || 'Not specified',
    offer: opts.serviceName,
    region: slots.region?.trim() || 'Not specified',
    audienceType: AUDIENCE_TYPE_SHORT[slots.audience_type ?? 'direct_buyer'],
    maturityTier: MATURITY_SHORT[slots.maturity_tier ?? 'intermediate'],
    businessModel: BUSINESS_MODEL_SHORT[slots.business_model ?? 'b2b'],
    companyType: COMPANY_TYPE_SHORT[slots.company_type ?? 'other'],
    scenario: opts.scenarioLabel,
    date: formatDate(new Date()),
    masterPromptVersion: opts.masterPromptVersion,
    documentTitle: opts.title,
    subtitle: opts.subtitle,
  };
}

function coverParagraphs(cover: CoverInfo): Paragraph[] {
  const field = (label: string, value: string) =>
    new Paragraph({
      spacing: { after: 90 },
      children: [
        new TextRun({ text: `${label.toUpperCase()}  `, bold: true, size: 16, color: MUTED }),
        new TextRun({ text: value, size: 22 }),
      ],
    });

  return [
    new Paragraph({ spacing: { before: 1400 }, children: [new TextRun('')] }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        new TextRun({
          text: 'IDEAL CUSTOMER PROFILE',
          bold: true,
          size: 18,
          color: ACCENT,
          characterSpacing: 60,
        }),
      ],
    }),
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: cover.documentTitle, bold: true, size: 44, color: ACCENT })],
    }),
    ...(cover.subtitle
      ? [
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: cover.subtitle, size: 24, color: MUTED })],
          }),
        ]
      : []),
    new Paragraph({
      spacing: { before: 120, after: 320 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: ACCENT, space: 6 } },
      children: [new TextRun('')],
    }),
    field('Company', cover.company),
    field('Offer', cover.offer),
    field('Region', cover.region),
    field('Business model', cover.businessModel),
    field('Company type', cover.companyType),
    field('Audience type', cover.audienceType),
    field('Maturity tier', cover.maturityTier),
    field('Scenario', cover.scenario),
    field('Generated', cover.date),
    new Paragraph({
      spacing: { before: 400 },
      children: [
        new TextRun({
          text: `Master prompt version ${cover.masterPromptVersion}`,
          size: 16,
          color: MUTED,
          italics: true,
        }),
      ],
    }),
  ];
}

// ---------------------------------------------------------------------------
// Comparison table
// ---------------------------------------------------------------------------

function comparisonTable(rows: ComparisonRow[]): Table {
  const headerCells = COMPARISON_COLUMNS.map(
    (column) =>
      new TableCell({
        shading: { type: ShadingType.CLEAR, fill: ACCENT },
        margins: { top: 90, bottom: 90, left: 110, right: 110 },
        children: [
          new Paragraph({
            children: [new TextRun({ text: column.label, bold: true, color: 'FFFFFF', size: 18 })],
          }),
        ],
      }),
  );

  const bodyRows = rows.map(
    (row, index) =>
      new TableRow({
        children: COMPARISON_COLUMNS.map(
          (column) =>
            new TableCell({
              shading:
                index % 2 === 1
                  ? { type: ShadingType.CLEAR, fill: 'F5F7FA' }
                  : undefined,
              margins: { top: 90, bottom: 90, left: 110, right: 110 },
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: String(row[column.key] ?? ''),
                      size: 18,
                      bold: column.key === 'awarenessLabel',
                    }),
                  ],
                }),
              ],
            }),
        ),
      }),
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: [new TableRow({ tableHeader: true, children: headerCells }), ...bodyRows],
  });
}

// ---------------------------------------------------------------------------
// Document assembly
// ---------------------------------------------------------------------------

const NUMBERING_CONFIG = {
  config: [
    {
      reference: 'icp-numbered',
      levels: [
        {
          level: 0,
          format: LevelFormat.DECIMAL,
          text: '%1.',
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: convertInchesToTwip(0.35), hanging: convertInchesToTwip(0.22) } } },
        },
      ],
    },
  ],
};

/** Real Word styles — the reason DOCX is the primary format. */
const STYLES = {
  default: {
    document: {
      run: { font: 'Calibri', size: 22, color: '1A1D21' },
      paragraph: { spacing: { line: 288, after: 140 } },
    },
    heading1: {
      run: { font: 'Calibri Light', size: 34, bold: true, color: ACCENT },
      paragraph: { spacing: { before: 360, after: 160 }, keepNext: true },
    },
    heading2: {
      run: { font: 'Calibri Light', size: 27, bold: true, color: ACCENT },
      paragraph: {
        spacing: { before: 300, after: 130 },
        keepNext: true,
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 5 } },
      },
    },
    heading3: {
      run: { font: 'Calibri', size: 23, bold: true, color: '2C3A4B' },
      paragraph: { spacing: { before: 220, after: 100 }, keepNext: true },
    },
    heading4: {
      run: { font: 'Calibri', size: 22, bold: true, italics: true, color: MUTED },
      paragraph: { spacing: { before: 180, after: 90 }, keepNext: true },
    },
  },
};

const PAGE_SETUP = {
  page: {
    margin: {
      top: convertInchesToTwip(0.9),
      bottom: convertInchesToTwip(0.9),
      left: convertInchesToTwip(1),
      right: convertInchesToTwip(1),
    },
  },
};

function footerFor(label: string): Footer {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: label, size: 15, color: MUTED })],
      }),
    ],
  });
}

export interface SingleDocxInput {
  markdown: string;
  cover: CoverInfo;
}

/** One scenario as a standalone Word file. */
export async function buildSingleDocx(input: SingleDocxInput): Promise<Buffer> {
  const sections = parseSections(input.markdown);
  const children: Paragraph[] = [];

  if (!sections.length) {
    children.push(...bodyParagraphs(input.markdown));
  } else {
    for (const section of sections) {
      children.push(
        new Paragraph({
          heading: headingLevel(Math.max(1, section.level)),
          spacing: { before: 300, after: 130 },
          children: inlineRuns(section.heading),
        }),
      );
      children.push(...bodyParagraphs(section.body, 2));
    }
  }

  const doc = new Document({
    styles: STYLES,
    numbering: NUMBERING_CONFIG,
    sections: [
      {
        properties: PAGE_SETUP,
        footers: { default: footerFor(`${input.cover.company} — ${input.cover.scenario}`) },
        children: [
          ...coverParagraphs(input.cover),
          new Paragraph({ children: [new PageBreak()] }),
          ...children,
        ],
      },
    ],
  });

  return Packer.toBuffer(doc);
}

export interface AwarenessMapInput {
  cover: CoverInfo;
  comparison: { rows: ComparisonRow[]; serviceName: string } | null;
  chapters: { scenario: AwarenessKey; markdown: string; badge: string | null }[];
}

/**
 * The awareness map: cover, comparison table, TOC, then one chapter per
 * scenario. This is the file that actually gets presented.
 */
export async function buildAwarenessMapDocx(input: AwarenessMapInput): Promise<Buffer> {
  const children: (Paragraph | Table | TableOfContents)[] = [...coverParagraphs(input.cover)];

  children.push(new Paragraph({ children: [new PageBreak()] }));

  if (input.comparison && input.comparison.rows.length) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { after: 100 },
        children: [new TextRun({ text: 'Awareness map at a glance' })],
      }),
      new Paragraph({
        spacing: { after: 220 },
        children: [
          new TextRun({
            text: `How the same buyer changes across awareness stages for ${input.comparison.serviceName}. Each stage needs a different opening message — the message that wins one stage is usually the message that loses another.`,
            color: MUTED,
          }),
        ],
      }),
      comparisonTable(input.comparison.rows),
      new Paragraph({ children: [new PageBreak()] }),
    );
  }

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 140 },
      children: [new TextRun({ text: 'Contents' })],
    }),
    new TableOfContents('Contents', {
      hyperlink: true,
      headingStyleRange: '1-2',
    }),
    new Paragraph({ children: [new PageBreak()] }),
  );

  input.chapters.forEach((chapter, index) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 120, after: 60 },
        children: [new TextRun({ text: awarenessLabel(chapter.scenario) })],
      }),
    );

    if (chapter.badge && chapter.badge !== 'complete') {
      children.push(
        new Paragraph({
          spacing: { after: 160 },
          children: [
            new TextRun({
              text:
                chapter.badge === 'repaired'
                  ? 'Note: one or more sections were expanded during quality checks.'
                  : 'Note: this scenario did not fully pass quality checks — review before sending to a client.',
              italics: true,
              size: 17,
              color: MUTED,
            }),
          ],
        }),
      );
    }

    const sections = parseSections(chapter.markdown);
    if (!sections.length) {
      children.push(...bodyParagraphs(chapter.markdown, 1));
    } else {
      for (const section of sections) {
        children.push(
          new Paragraph({
            // Chapter is H1, so section headings sit at H2 and the TOC reads
            // cleanly at two levels.
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 280, after: 120 },
            children: inlineRuns(section.heading),
          }),
        );
        children.push(...bodyParagraphs(section.body, 2));
      }
    }

    if (index < input.chapters.length - 1) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
  });

  const doc = new Document({
    styles: STYLES,
    numbering: NUMBERING_CONFIG,
    features: { updateFields: true },
    sections: [
      {
        properties: PAGE_SETUP,
        footers: { default: footerFor(`${input.cover.company} — awareness map`) },
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}

// ---------------------------------------------------------------------------
// Filenames
// ---------------------------------------------------------------------------

export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function dateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

/** {company-slug}-{scenario}-{YYYYMMDD}.{ext} */
export function exportFilename(
  companyName: string | null | undefined,
  scenario: string,
  extension: string,
): string {
  return `${slugify(companyName || 'icp')}-${slugify(scenario)}-${dateStamp()}.${extension}`;
}

export function scenarioSlug(scenario: AwarenessKey): string {
  return slugify(awarenessShort(scenario));
}
