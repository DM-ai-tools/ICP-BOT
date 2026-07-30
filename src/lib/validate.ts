/**
 * PASS 4 — VALIDATE and REPAIR.
 *
 * Every mandatory heading must be present AND substantive. A heading followed
 * by two sentences is worse than a missing one: it looks complete and ships.
 *
 * Failing sections get ONE targeted expand call each — that section only, with
 * the full brief for context — and the result is spliced back into the
 * document. Nothing is ever silently shipped partial; a document that still
 * fails after repair is badged `failed` and says so in the UI.
 */
import 'server-only';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { env } from './env';
import { complete } from './openai';
import { masterPrompt, SECTIONS, sectionByKey, type SectionKey } from './master-prompt';
import {
  CHECKLIST_MAX,
  CHECKLIST_MIN,
  OBJECTION_COUNT,
  STORIES_MAX,
  STORIES_MIN,
  type SectionReport,
  type SectionStatus,
  type ValidationReport,
} from './sections';

export {
  CHECKLIST_MAX,
  CHECKLIST_MIN,
  OBJECTION_COUNT,
  STORIES_MAX,
  STORIES_MIN,
} from './sections';
export type { SectionReport, SectionStatus, ValidationReport } from './sections';
import {
  countListItems,
  countObjections,
  countStories,
  countWords,
  parseSections,
  spliceSection,
  stripLeadingHeading,
  type ParsedSection,
} from './markdown';
import { awarenessLabel } from './awareness';
import type { GenerationContext } from './generate';
import { buildInputBlock } from './generate';


// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

export function inspectDocument(markdown: string): SectionReport[] {
  const parsed = parseSections(markdown);
  const byKey = new Map<SectionKey, ParsedSection>();
  for (const section of parsed) {
    if (section.key && !byKey.has(section.key)) byKey.set(section.key, section);
  }

  return SECTIONS.map((spec) => {
    const found = byKey.get(spec.key);

    if (!found) {
      return {
        key: spec.key,
        heading: spec.heading,
        status: 'missing' as SectionStatus,
        words: 0,
        expected: describeExpectation(spec.key),
      };
    }

    // The title line carries its content in the heading itself.
    const measured = spec.kind === 'title' ? `${found.heading} ${found.body}` : found.body;
    const words = countWords(measured);

    switch (spec.kind) {
      case 'title': {
        const looksLikeTitle = /icp\s*\(/i.test(found.heading) || found.heading.includes('|');
        return {
          key: spec.key,
          heading: spec.heading,
          status: looksLikeTitle ? 'ok' : 'thin',
          words,
          expected: describeExpectation(spec.key),
        };
      }

      case 'oneline':
        return {
          key: spec.key,
          heading: spec.heading,
          status: words >= 2 ? 'ok' : 'thin',
          words,
          expected: describeExpectation(spec.key),
        };

      case 'objections': {
        const count = countObjections(found.body);
        const status: SectionStatus =
          count !== OBJECTION_COUNT ? 'wrong_count' : words < spec.minWords ? 'thin' : 'ok';
        return {
          key: spec.key,
          heading: spec.heading,
          status,
          words,
          count,
          expected: describeExpectation(spec.key),
        };
      }

      case 'checklist': {
        const count = countListItems(found.body);
        const status: SectionStatus =
          count < CHECKLIST_MIN || count > CHECKLIST_MAX ? 'wrong_count' : 'ok';
        return {
          key: spec.key,
          heading: spec.heading,
          status,
          words,
          count,
          expected: describeExpectation(spec.key),
        };
      }

      case 'stories': {
        const count = countStories(found.body);
        const status: SectionStatus =
          count < STORIES_MIN || count > STORIES_MAX
            ? 'wrong_count'
            : words < spec.minWords
              ? 'thin'
              : 'ok';
        return {
          key: spec.key,
          heading: spec.heading,
          status,
          words,
          count,
          expected: describeExpectation(spec.key),
        };
      }

      case 'narrative':
      default:
        return {
          key: spec.key,
          heading: spec.heading,
          status: words < spec.minWords ? 'thin' : 'ok',
          words,
          expected: describeExpectation(spec.key),
        };
    }
  });
}

function describeExpectation(key: SectionKey): string {
  const spec = sectionByKey(key);
  switch (spec.kind) {
    case 'objections':
      return `exactly ${OBJECTION_COUNT} objections, ${spec.minWords}+ words`;
    case 'checklist':
      return `${CHECKLIST_MIN}–${CHECKLIST_MAX} qualifiers`;
    case 'stories':
      return `${STORIES_MIN}–${STORIES_MAX} stories, ${spec.minWords}+ words`;
    case 'narrative':
      return `${spec.minWords}+ words`;
    case 'oneline':
      return 'one line';
    case 'title':
      return 'full pipe-separated title line';
    default:
      return 'present';
  }
}

// ---------------------------------------------------------------------------
// Repair
// ---------------------------------------------------------------------------

function repairInstruction(report: SectionReport): string {
  const spec = sectionByKey(report.key);

  const problem =
    report.status === 'missing'
      ? 'It is missing from the document entirely.'
      : report.status === 'wrong_count'
        ? `It has ${report.count} items; it must have ${describeExpectation(report.key)}.`
        : `It is too thin — ${report.words} words against a floor of ${spec.minWords}.`;

  return [
    `The section "${spec.heading}" needs rewriting. ${problem}`,
    '',
    `WHAT IT MUST CONTAIN: ${spec.repairHint}`,
    '',
    'Write the replacement body for that section only.',
    'Do not repeat the heading. Do not write any other section.',
    'Do not add a preamble, an apology, or a note about what you changed.',
    'Match the avatar, voice, region, jargon and awareness stage already established in the document.',
    'Full sentences and real specifics — this is a client-facing deliverable, not notes.',
  ].join('\n');
}

async function repairSection(
  markdown: string,
  report: SectionReport,
  ctx: GenerationContext,
): Promise<{ markdown: string; ok: boolean }> {
  const spec = sectionByKey(report.key);

  const contextBlock = [
    `INPUTS\n${buildInputBlock(ctx)}`,
    `AWARENESS STAGE: ${awarenessLabel(ctx.scenario)} — every word of this section must read as that stage.`,
    '',
    'THE DOCUMENT SO FAR (for voice, avatar and continuity — do not repeat it):',
    '---',
    markdown.slice(0, 12_000),
    '---',
    '',
    repairInstruction(report),
  ].join('\n');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: masterPrompt() },
    { role: 'user', content: contextBlock },
  ];

  const { text } = await complete({
    kind: 'repair',
    runId: ctx.runId,
    model: env.model,
    messages,
    temperature: env.temperature,
    maxTokens: 2000,
    signal: ctx.signal,
  });

  const body = stripLeadingHeading(text, spec.heading);
  if (!body.trim()) return { markdown, ok: false };

  const parsed = parseSections(markdown);
  const existing = parsed.find((s) => s.key === report.key);

  if (existing) {
    return { markdown: spliceSection(markdown, existing, body), ok: true };
  }

  // The section was missing. Insert it in master-prompt order rather than
  // appending, so the document still reads top to bottom.
  return { markdown: insertSectionInOrder(markdown, report.key, body), ok: true };
}

function insertSectionInOrder(markdown: string, key: SectionKey, body: string): string {
  const spec = sectionByKey(key);
  const order = SECTIONS.map((s) => s.key);
  const targetIndex = order.indexOf(key);
  const parsed = parseSections(markdown);

  const block = `${'#'.repeat(spec.level)} ${spec.heading}\n\n${body.trim()}\n\n`;

  // Insert before the first recognised section that comes later in the canon.
  for (const section of parsed) {
    if (!section.key) continue;
    if (order.indexOf(section.key) > targetIndex) {
      return `${markdown.slice(0, section.start)}${block}${markdown.slice(section.start)}`;
    }
  }
  return `${markdown.trimEnd()}\n\n${block}`;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface ValidateAndRepairResult extends ValidationReport {
  markdown: string;
}

/**
 * Validate, repair what fails, re-validate, and report honestly.
 * One repair attempt per section — a second pass on a model that has already
 * refused twice buys nothing but latency and tokens.
 */
export async function validateAndRepair(
  markdown: string,
  ctx: GenerationContext,
  onProgress?: (message: string) => void | Promise<void>,
): Promise<ValidateAndRepairResult> {
  let working = markdown;
  const initial = inspectDocument(working);
  const failing = initial.filter((r) => r.status !== 'ok');

  const repairedKeys: SectionKey[] = [];

  for (const report of failing) {
    await onProgress?.(`Expanding “${report.heading}”`);
    try {
      const result = await repairSection(working, report, ctx);
      if (result.ok) {
        working = result.markdown;
        repairedKeys.push(report.key);
      }
    } catch (err) {
      // A failed repair leaves the original section in place — the badge will
      // reflect it. Losing the whole document over one thin section would be
      // strictly worse than shipping it flagged.
      console.warn(`[validate] repair failed for ${report.key}:`, (err as Error).message);
    }
  }

  const finalSections = inspectDocument(working).map((report) => ({
    ...report,
    repaired: repairedKeys.includes(report.key),
  }));

  const failedKeys = finalSections.filter((r) => r.status !== 'ok').map((r) => r.key);
  const ok = failedKeys.length === 0;

  return {
    markdown: working,
    sections: finalSections,
    ok,
    badge: ok ? (repairedKeys.length ? 'repaired' : 'complete') : 'failed',
    repairedKeys,
    failedKeys,
  };
}

/** Re-inspect stored markdown without calling the model. */
export function reportFor(markdown: string): ValidationReport {
  const sections = inspectDocument(markdown);
  const failedKeys = sections.filter((s) => s.status !== 'ok').map((s) => s.key);
  return {
    sections,
    ok: failedKeys.length === 0,
    badge: failedKeys.length === 0 ? 'complete' : 'failed',
    repairedKeys: [],
    failedKeys,
  };
}
