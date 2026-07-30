/**
 * Excel export.
 *
 * Two columns: what it is, and what it says. Column A carries the field or
 * section name, column B carries the content.
 *
 * The whole difficulty is row height. Excel does not auto-fit a wrapped cell
 * that was written programmatically — it keeps the default single-line height
 * and hides everything below it, so a 200-word section renders as an almost
 * empty row until someone drags it open. Every row here is measured and given
 * an explicit height, generously, so nothing is stuffed into a sliver.
 */
import 'server-only';
import ExcelJS from 'exceljs';
import { parseSections } from './markdown';
import {
  AUDIENCE_TYPE_LABEL,
  BUSINESS_MODEL_LABEL,
  COMPANY_TYPE_LABEL,
  MATURITY_LABEL,
  PRICE_NOT_SPECIFIED,
  type ServiceSlot,
  type SlotValues,
} from './slots';

const LABEL_WIDTH = 32;
const VALUE_WIDTH = 115;

const ACCENT = 'FF1F3A5F';
const RULE = 'FFD8DDE4';
const BAND = 'FFEEF2F7';
const MUTED = 'FF5A6472';

/**
 * Roughly how many characters fit on one wrapped line of column B at 11pt.
 * Column width in Excel is measured in characters of the default font, so this
 * is close to 1:1 — trimmed a little because the real font is proportional and
 * the cell carries an indent.
 */
const CHARS_PER_LINE = Math.floor(VALUE_WIDTH * 0.95);
const LINE_HEIGHT = 14.5;
const MIN_ROW_HEIGHT = 24;
const MAX_ROW_HEIGHT = 409; // Excel's own ceiling

/**
 * Estimate the wrapped height of a cell.
 *
 * Deliberately generous. A row slightly too tall is invisible; a row slightly
 * too short clips the content and makes the export look broken.
 */
export function heightFor(text: string): number {
  if (!text.trim()) return MIN_ROW_HEIGHT;

  let lines = 0;
  for (const paragraph of text.split('\n')) {
    lines += Math.max(1, Math.ceil(paragraph.length / CHARS_PER_LINE));
  }

  // A value that fits on one line — most of the brief block — gets a tidy row.
  // Adding a spare line to every one of those would make the brief look
  // strangely airy for no benefit.
  if (lines === 1) return MIN_ROW_HEIGHT;

  // Anything that wraps gets a spare line plus padding, because the estimate is
  // approximate and clipping a long section looks broken while a slightly tall
  // row is invisible.
  return Math.min(MAX_ROW_HEIGHT, Math.max(MIN_ROW_HEIGHT, (lines + 1) * LINE_HEIGHT + 6));
}

/** Markdown to readable plain text, keeping paragraph and list structure. */
export function flattenMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+(.*)$/gm, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\W)\*(?!\s)(.+?)(?<!\s)\*(?=\W|$)/g, '$1$2')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '• ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function priceOf(service: ServiceSlot | undefined): string {
  const price = service?.price_terms?.trim();
  return price || 'Not specified (quote/assessment required)';
}

export interface XlsxInput {
  markdown: string;
  slots: SlotValues;
  serviceName: string;
  service?: ServiceSlot;
  awarenessLabel: string;
  masterPromptVersion: string;
  generatedAt: Date;
  badge: string | null;
}

export async function buildXlsx(input: XlsxInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Prism by Traffic Radius';
  workbook.created = input.generatedAt;

  const sheet = workbook.addWorksheet('Ideal Customer Profile', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });

  sheet.columns = [
    { key: 'label', width: LABEL_WIDTH },
    { key: 'value', width: VALUE_WIDTH },
  ];

  // ---- header -------------------------------------------------------------
  const company = input.slots.company_name?.trim() || 'Ideal Customer Profile';
  const header = sheet.addRow([company, input.awarenessLabel]);
  header.height = 32;
  header.eachCell((cell, column) => {
    cell.font = { bold: true, size: column === 1 ? 13 : 11, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ACCENT } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
  });

  // ---- the brief ----------------------------------------------------------
  const s = input.slots;
  addSectionBreak(sheet, 'The brief');

  const briefRows: [string, string][] = [
    ['Company name', s.company_name?.trim() || 'Not specified'],
    ['Website', s.website_url?.trim() || 'Not specified'],
    ['Company type', s.company_type ? COMPANY_TYPE_LABEL[s.company_type] : 'Not specified'],
    ['Industry', s.industry?.trim() || 'Not specified'],
    ['Business model', s.business_model ? BUSINESS_MODEL_LABEL[s.business_model] : 'Not specified'],
    ['Audience type', AUDIENCE_TYPE_LABEL[s.audience_type ?? 'direct_buyer']],
    ['Region', s.region?.trim() || 'Not specified'],
    ['Maturity tier', s.maturity_tier ? MATURITY_LABEL[s.maturity_tier] : 'Not specified'],
    ['Service / product', input.serviceName],
    ['Price / terms', priceOf(input.service)],
    ['Offer type', s.offer_type?.trim() || input.serviceName],
    ['Size / revenue band', s.size_band?.trim() || 'Not specified'],
    ['Notes / constraints', s.notes?.trim() || 'None'],
    ['Awareness stage', input.awarenessLabel],
  ];

  for (const [label, value] of briefRows) addPair(sheet, label, value);

  // ---- the profile --------------------------------------------------------
  addSectionBreak(sheet, 'The profile');

  const sections = parseSections(input.markdown);
  if (sections.length) {
    for (const section of sections) {
      const body = flattenMarkdown(section.body);
      // The title line carries its content in the heading itself, so fall back
      // to the heading rather than emitting an empty row.
      addPair(sheet, section.heading, body || flattenMarkdown(section.heading));
    }
  } else {
    addPair(sheet, 'Profile', flattenMarkdown(input.markdown));
  }

  // ---- provenance ---------------------------------------------------------
  addSectionBreak(sheet, 'About this document');
  addPair(sheet, 'Generated', input.generatedAt.toLocaleString('en-AU'));
  addPair(sheet, 'Master prompt version', input.masterPromptVersion);
  addPair(sheet, 'Quality check', input.badge ?? 'unknown');

  const out = await workbook.xlsx.writeBuffer();
  return Buffer.from(out);
}

// ---------------------------------------------------------------------------

function addSectionBreak(sheet: ExcelJS.Worksheet, title: string) {
  sheet.addRow([]).height = 8;

  const row = sheet.addRow([title, '']);
  row.height = 26;
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true, size: 11, color: { argb: ACCENT } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } };
    cell.alignment = { vertical: 'middle', indent: 1 };
    cell.border = { bottom: { style: 'thin', color: { argb: RULE } } };
  });
}

function addPair(sheet: ExcelJS.Worksheet, label: string, value: string) {
  const row = sheet.addRow([label, value]);

  // Explicit height. Excel will not compute one for a wrapped cell written this
  // way, and would otherwise clip a long section to a single visible line.
  row.height = heightFor(value);

  const labelCell = row.getCell(1);
  labelCell.font = { bold: true, size: 10, color: { argb: MUTED } };
  labelCell.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  labelCell.border = { bottom: { style: 'hair', color: { argb: RULE } } };

  const valueCell = row.getCell(2);
  valueCell.font = { size: 11 };
  valueCell.alignment = { vertical: 'top', wrapText: true, indent: 1 };
  valueCell.border = { bottom: { style: 'hair', color: { argb: RULE } } };
}
