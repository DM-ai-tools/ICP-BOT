/**
 * PDF export via pdf-lib.
 *
 * Deliberately NOT Puppeteer. Railway's default Nixpacks image ships no
 * Chromium, so a Puppeteer-based renderer builds fine, deploys fine, and then
 * dies at first request with an opaque "Failed to launch the browser process".
 * pdf-lib is pure JavaScript with zero system dependencies — it renders
 * identically on a laptop and in a container.
 *
 * DOCX is the primary format; this is the "send it to someone who won't edit
 * it" option.
 */
import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { parseSections, stripInlineMarkup } from './markdown';
import type { CoverInfo } from './docx';

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const ACCENT = rgb(0.12, 0.23, 0.37);
const INK = rgb(0.1, 0.11, 0.13);
const MUTED = rgb(0.42, 0.46, 0.51);
const RULE = rgb(0.85, 0.87, 0.9);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

class Layout {
  private page: PDFPage;
  private y: number;

  constructor(
    private doc: PDFDocument,
    private fonts: Fonts,
    private footerText: string,
  ) {
    this.page = doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    this.stampFooter();
  }

  private stampFooter(): void {
    this.page.drawText(this.footerText, {
      x: MARGIN,
      y: MARGIN / 2,
      size: 7.5,
      font: this.fonts.regular,
      color: MUTED,
    });
  }

  newPage(): void {
    this.page = this.doc.addPage(A4);
    this.y = A4[1] - MARGIN;
    this.stampFooter();
  }

  private ensure(height: number): void {
    if (this.y - height < MARGIN + 18) this.newPage();
  }

  space(amount: number): void {
    this.y -= amount;
    if (this.y < MARGIN + 18) this.newPage();
  }

  rule(): void {
    this.ensure(12);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: A4[0] - MARGIN, y: this.y },
      thickness: 0.6,
      color: RULE,
    });
    this.y -= 12;
  }

  text(
    value: string,
    opts: {
      size?: number;
      font?: keyof Fonts;
      color?: ReturnType<typeof rgb>;
      indent?: number;
      lineGap?: number;
      after?: number;
      maxWidth?: number;
    } = {},
  ): void {
    const size = opts.size ?? 10;
    const font = this.fonts[opts.font ?? 'regular'];
    const color = opts.color ?? INK;
    const indent = opts.indent ?? 0;
    const lineHeight = size * (opts.lineGap ?? 1.42);
    const width = (opts.maxWidth ?? A4[0] - MARGIN * 2) - indent;

    for (const line of wrap(value, font, size, width)) {
      this.ensure(lineHeight);
      this.page.drawText(line, {
        x: MARGIN + indent,
        y: this.y - size,
        size,
        font,
        color,
      });
      this.y -= lineHeight;
    }
    if (opts.after) this.y -= opts.after;
  }

  heading(value: string, level: number): void {
    const size = level <= 1 ? 17 : level === 2 ? 13 : 11;
    this.space(level <= 1 ? 14 : 10);
    this.ensure(size * 2);
    this.text(value, { size, font: 'bold', color: ACCENT, after: 3 });
    if (level <= 2) this.rule();
  }
}

/** pdf-lib's standard fonts are WinAnsi-only; typographic glyphs must fold. */
function sanitise(input: string): string {
  return input
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–]/g, '-')
    .replace(/[—]/g, '--')
    .replace(/[…]/g, '...')
    .replace(/[•]/g, '-')
    .replace(/[   ]/g, ' ')
    .replace(/[→]/g, '->')
    .replace(/[^\x00-\xFF]/g, '');
}

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const clean = sanitise(text).replace(/\s+/g, ' ').trim();
  if (!clean) return [''];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    let width: number;
    try {
      width = font.widthOfTextAtSize(candidate, size);
    } catch {
      width = candidate.length * size * 0.5;
    }
    if (width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export interface PdfInput {
  markdown: string;
  cover: CoverInfo;
}

export async function buildPdf(input: PdfInput): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${input.cover.documentTitle} — ${input.cover.scenario}`);
  doc.setSubject('Ideal Customer Profile');
  doc.setCreator('ICP Builder');
  doc.setProducer(`ICP Builder (master prompt ${input.cover.masterPromptVersion})`);

  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  const layout = new Layout(doc, fonts, `${input.cover.company} — ${input.cover.scenario}`);

  // ---- cover -------------------------------------------------------------
  layout.space(150);
  layout.text('IDEAL CUSTOMER PROFILE', { size: 8, font: 'bold', color: ACCENT, after: 8 });
  layout.text(input.cover.documentTitle, { size: 26, font: 'bold', color: ACCENT, after: 6 });
  if (input.cover.subtitle) {
    layout.text(input.cover.subtitle, { size: 12, color: MUTED, after: 8 });
  }
  layout.rule();
  layout.space(10);

  const fields: [string, string][] = [
    ['Company', input.cover.company],
    ['Offer', input.cover.offer],
    ['Region', input.cover.region],
    ['Business model', input.cover.businessModel],
    ['Company type', input.cover.companyType],
    ['Audience type', input.cover.audienceType],
    ['Maturity tier', input.cover.maturityTier],
    ['Scenario', input.cover.scenario],
    ['Generated', input.cover.date],
  ];

  for (const [label, value] of fields) {
    layout.text(label.toUpperCase(), { size: 7, font: 'bold', color: MUTED, after: 0 });
    layout.text(value, { size: 10.5, after: 5 });
  }

  layout.space(14);
  layout.text(`Master prompt version ${input.cover.masterPromptVersion}`, {
    size: 7.5,
    font: 'italic',
    color: MUTED,
  });

  // ---- body --------------------------------------------------------------
  layout.newPage();

  const sections = parseSections(input.markdown);
  const blocks = sections.length
    ? sections.flatMap((section) => [
        { type: 'heading' as const, text: section.heading, level: section.level },
        ...bodyLines(section.body),
      ])
    : bodyLines(input.markdown);

  for (const block of blocks) {
    if (block.type === 'heading') {
      layout.heading(block.text, block.level);
    } else if (block.type === 'bullet') {
      layout.text(`- ${block.text}`, { indent: 12, after: 2 });
    } else if (block.type === 'numbered') {
      layout.text(`${block.marker} ${block.text}`, { indent: 12, after: 2 });
    } else {
      layout.text(block.text, { after: 5 });
    }
  }

  return Buffer.from(await doc.save());
}

type Block =
  | { type: 'heading'; text: string; level: number }
  | { type: 'paragraph'; text: string }
  | { type: 'bullet'; text: string }
  | { type: 'numbered'; marker: string; text: string };

function bodyLines(body: string): Block[] {
  const blocks: Block[] = [];

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^\|/.test(line) && /\|/.test(line.slice(1))) {
      const cells = line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => stripInlineMarkup(c.trim()))
        .filter(Boolean);
      if (cells.length && !cells.every((c) => /^[-: ]+$/.test(c))) {
        blocks.push({ type: 'paragraph', text: cells.join('  ·  ') });
      }
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      blocks.push({
        type: 'heading',
        text: stripInlineMarkup(heading[2]),
        level: Math.min(4, heading[1].length + 1),
      });
      continue;
    }

    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      blocks.push({
        type: 'numbered',
        marker: `${numbered[1]}.`,
        text: stripInlineMarkup(numbered[2]),
      });
      continue;
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      blocks.push({ type: 'bullet', text: stripInlineMarkup(bullet[1]) });
      continue;
    }

    blocks.push({ type: 'paragraph', text: stripInlineMarkup(line) });
  }

  return blocks;
}
