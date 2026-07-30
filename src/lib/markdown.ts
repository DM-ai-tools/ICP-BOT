/**
 * Markdown section parsing.
 *
 * The validator, the in-document nav, copy-section and every exporter all need
 * the same view of a document: an ordered list of headings with their bodies.
 * That logic lives here once.
 *
 * Client-safe — no `server-only`, no secrets, no Node APIs.
 */

import { SECTIONS, type SectionKey, type SectionSpec } from './sections';

export interface ParsedSection {
  /** Recognised master-prompt section, or null for anything the model added. */
  key: SectionKey | null;
  /** Heading exactly as written in the document. */
  heading: string;
  level: number;
  /** Body text below the heading, excluding the heading itself. */
  body: string;
  /** Character offsets into the source, so a repaired section can be spliced. */
  start: number;
  end: number;
  /** Stable anchor id for the sticky in-document nav. */
  anchor: string;
}

/** Normalise for tolerant heading matching: curly quotes, casing, punctuation. */
export function normaliseHeading(input: string): string {
  return input
    .toLowerCase()
    .replace(/[’‘‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const SECTION_MATCHERS: { spec: SectionSpec; needles: string[] }[] = SECTIONS.map((spec) => ({
  spec,
  needles: [spec.heading, ...(spec.aliases ?? [])].map(normaliseHeading),
}));

function matchSectionKey(heading: string): SectionKey | null {
  const normalised = normaliseHeading(heading);
  if (!normalised) return null;

  // The title line is the one heading whose text is its content, so it never
  // matches by name. The master prompt's format makes it recognisable instead:
  // it opens with "ICP (<awareness level>)" and pipe-separates the rest.
  if (normalised === 'icp' || normalised.startsWith('icp ') || /^ICP\s*\(/i.test(heading.trim())) {
    return 'title_line';
  }

  // Exact first, so "Objections (Top 8) + What It Really Means" never gets
  // claimed by a looser alias belonging to a different section.
  for (const { spec, needles } of SECTION_MATCHERS) {
    if (needles.includes(normalised)) return spec.key;
  }
  for (const { spec, needles } of SECTION_MATCHERS) {
    if (needles.some((needle) => needle.length > 6 && normalised.startsWith(needle))) return spec.key;
  }
  for (const { spec, needles } of SECTION_MATCHERS) {
    if (needles.some((needle) => needle.length > 8 && normalised.includes(needle))) return spec.key;
  }
  return null;
}

export function anchorFor(heading: string, index: number): string {
  const slug = normaliseHeading(heading).replace(/\s+/g, '-').slice(0, 50);
  return slug ? `s-${index}-${slug}` : `s-${index}`;
}

/** Split a document into sections at ATX headings, ignoring fenced code. */
export function parseSections(markdown: string): ParsedSection[] {
  const lines = markdown.split(/\r?\n/);
  const sections: ParsedSection[] = [];

  let offset = 0;
  let inFence = false;
  const headingPositions: { line: number; offset: number; level: number; text: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;

    if (!inFence) {
      const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
      if (match) {
        headingPositions.push({
          line: i,
          offset,
          level: match[1].length,
          text: stripInlineMarkup(match[2]),
        });
      }
    }
    offset += line.length + 1;
  }

  for (let i = 0; i < headingPositions.length; i++) {
    const current = headingPositions[i];
    const next = headingPositions[i + 1];
    const bodyStartLine = current.line + 1;
    const bodyEndLine = next ? next.line : lines.length;
    const body = lines.slice(bodyStartLine, bodyEndLine).join('\n').trim();

    sections.push({
      key: matchSectionKey(current.text),
      heading: current.text,
      level: current.level,
      body,
      start: current.offset,
      end: next ? next.offset : markdown.length,
      anchor: anchorFor(current.text, i),
    });
  }

  return sections;
}

export function stripInlineMarkup(input: string): string {
  return input
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\W)\*(?!\s)(.+?)(?<!\s)\*(?=\W|$)/g, '$1$2')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((.*?)\)/g, '$1')
    .trim();
}

export function countWords(input: string): number {
  const plain = input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#*_>`|-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return 0;
  return plain.split(' ').filter(Boolean).length;
}

/**
 * Count list items in a body, treating numbered, bulleted and bolded-lead-in
 * paragraphs as items — models legitimately use all three shapes.
 */
export function countListItems(body: string): number {
  const lines = body.split(/\r?\n/);
  let numbered = 0;
  let bulleted = 0;
  let boldLeads = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+[.)]\s+\S/.test(trimmed)) numbered++;
    else if (/^[-*•]\s+\S/.test(trimmed)) bulleted++;
    else if (/^\*\*[^*]{3,}\*\*/.test(trimmed)) boldLeads++;
  }

  return Math.max(numbered, bulleted, boldLeads);
}

/** Objections are counted on numbering alone — "exactly 8" must mean 8. */
export function countObjections(body: string): number {
  const numbered = body
    .split(/\r?\n/)
    .filter((line) => /^\s*(\d+)[.)]\s+\S/.test(line)).length;
  if (numbered > 0) return numbered;

  const bolded = body.split(/\r?\n/).filter((line) => /^\s*\*\*.{3,}\*\*/.test(line.trim())).length;
  if (bolded > 0) return bolded;

  return (body.match(/what it really means/gi) ?? []).length;
}

export function countStories(body: string): number {
  const headings = body.split(/\r?\n/).filter((line) => /^#{3,6}\s+\S/.test(line)).length;
  if (headings > 0) return headings;
  const items = countListItems(body);
  if (items > 0) return items;
  return body.split(/\n\s*\n/).filter((p) => countWords(p) > 25).length;
}

/**
 * Replace one section's body in place, preserving everything around it.
 * Used to splice a repaired section back into the document.
 */
export function spliceSection(
  markdown: string,
  section: ParsedSection,
  replacementBody: string,
): string {
  const before = markdown.slice(0, section.start);
  const after = markdown.slice(section.end);
  const hashes = '#'.repeat(section.level);
  const rebuilt = `${hashes} ${section.heading}\n\n${replacementBody.trim()}\n\n`;
  return `${before}${rebuilt}${after}`;
}

/** Strip a repair response back to bare body text if it echoed the heading. */
export function stripLeadingHeading(text: string, heading: string): string {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return text.trim();

  const first = lines[0].replace(/^#{1,6}\s*/, '').trim();
  if (normaliseHeading(first) === normaliseHeading(heading)) {
    return lines.slice(1).join('\n').trim();
  }
  return text.trim();
}

/** Plain text for previews and the saved-runs list. */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\(.*?\)/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}
