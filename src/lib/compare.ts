/**
 * Cross-scenario comparison.
 *
 * Four ICPs in four files is homework. One table showing how the belief, the
 * message that lands, the message that backfires, the channel and the primary
 * objection shift across awareness stages is a deliverable — it is the thing a
 * strategist actually presents. It renders as the first tab and as the cover
 * section of the combined export.
 */
import 'server-only';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { env } from './env';
import { complete, parseJsonLoose } from './openai';
import { awarenessLabel, scenarioRank, type AwarenessKey } from './awareness';
import { parseSections } from './markdown';
import { comparisonToMarkdown, type ComparisonRow } from './comparison';
import { AUDIENCE_TYPE_LABEL, BUSINESS_MODEL_SHORT, type SlotValues } from './slots';

export { COMPARISON_COLUMNS, comparisonToMarkdown } from './comparison';
export type { ComparisonRow } from './comparison';

const rowSchema = z.object({
  scenario: z.string(),
  dominantBelief: z.string(),
  messageThatLands: z.string(),
  messageThatBackfires: z.string(),
  bestChannel: z.string(),
  primaryObjection: z.string(),
});

const comparisonSchema = z.object({
  rows: z.array(rowSchema),
});

const COMPARE_SYSTEM = `
You are an ICP strategist building the comparison view that sits at the front of an awareness-map deliverable.

You are given several ICP documents for the SAME company and offer, each written at a different awareness
stage. Produce one row per document. The value of this table is entirely in the CONTRAST: if two rows could be
swapped without anyone noticing, the table is worthless.

For each awareness stage give:
  dominantBelief        What this buyer currently believes about their situation. Their frame, in their words.
  messageThatLands      The angle that actually moves them at this stage. Concrete — a line you could run.
  messageThatBackfires  The message that reads as wrong, presumptuous or salesy TO THEM SPECIFICALLY. This is
                        usually the message that lands beautifully at a different stage.
  bestChannel           Where to reach them and in what format, given their stage, industry and region.
  primaryObjection      The single objection that blocks the sale at this stage, in their voice.

RULES
  - EVERY COLUMN MUST VARY DOWN THE PAGE. bestChannel especially: naming the same channel for two stages
    wastes the column and tells the reader nothing. Someone who does not know they have a problem is not
    reachable the same way as someone comparing two vendors — differ on the format, the moment and the
    intent, not just the platform name. If two stages genuinely share a platform, distinguish what is done
    there ("industry conference keynote" versus "conference booth demo with a shortlist in hand").
  - Draw only from the documents given. Do not introduce new claims about the company.
  - Never invent a price or a statistic. If a figure is not in the source documents, do not use one.
  - Each cell is one tight sentence or clause. This is a table, not prose.
  - Use the region's spelling and the industry's jargon as they appear in the documents.
  - "scenario" must be copied exactly from the SCENARIO KEY given for each document.

Return JSON: { "rows": [ { "scenario", "dominantBelief", "messageThatLands", "messageThatBackfires",
"bestChannel", "primaryObjection" } ] }
`.trim();

/** Feed the comparison the shape of each document, not 4000 words of each. */
function digestDocument(markdown: string): string {
  const sections = parseSections(markdown);
  const wanted = new Set([
    'title_line',
    'avatar_name',
    'current_reality',
    'say_out_loud',
    'under_the_hood',
    'barriers',
    'triggers',
    'decision_criteria',
    'how_they_research',
    'objections',
  ]);

  return sections
    .filter((s) => s.key && wanted.has(s.key))
    .map((s) => `## ${s.heading}\n${s.body.slice(0, 1200)}`)
    .join('\n\n')
    .slice(0, 9000);
}

export interface CompareInput {
  runId: string;
  slots: SlotValues;
  serviceName: string;
  documents: { scenario: AwarenessKey; markdown: string }[];
  signal?: AbortSignal;
}

export async function buildComparison(
  input: CompareInput,
): Promise<{ rows: ComparisonRow[]; markdown: string }> {
  const ordered = [...input.documents].sort(
    (a, b) => scenarioRank(a.scenario) - scenarioRank(b.scenario),
  );

  const blocks = ordered.map((doc) =>
    [
      `SCENARIO KEY: ${doc.scenario}`,
      `AWARENESS STAGE: ${awarenessLabel(doc.scenario)}`,
      digestDocument(doc.markdown),
    ].join('\n'),
  );

  const userMessage = [
    `COMPANY: ${input.slots.company_name ?? 'Not specified'}`,
    `OFFER: ${input.serviceName}`,
    `REGION: ${input.slots.region ?? 'Not specified'}`,
    `INDUSTRY: ${input.slots.industry ?? 'Not specified'}`,
    `BUSINESS MODEL: ${input.slots.business_model ? BUSINESS_MODEL_SHORT[input.slots.business_model] : 'Not specified'}`,
    `AUDIENCE TYPE: ${AUDIENCE_TYPE_LABEL[input.slots.audience_type ?? 'direct_buyer']}`,
    '',
    'DOCUMENTS',
    '',
    blocks.join('\n\n---\n\n'),
    '',
    `Build the comparison table now. One row per scenario key, in this order: ${ordered
      .map((d) => d.scenario)
      .join(', ')}. JSON only.`,
  ].join('\n');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: COMPARE_SYSTEM },
    { role: 'user', content: userMessage },
  ];

  const { text } = await complete({
    kind: 'compare',
    runId: input.runId,
    model: env.model,
    messages,
    temperature: 0.5,
    maxTokens: 2500,
    jsonMode: true,
    signal: input.signal,
  });

  const parsed = comparisonSchema.safeParse(parseJsonLoose(text));
  if (!parsed.success) {
    throw new Error(`Comparison returned an unusable shape: ${parsed.error.message}`);
  }

  const validKeys = new Set(ordered.map((d) => d.scenario));
  const rows: ComparisonRow[] = parsed.data.rows
    .filter((row) => validKeys.has(row.scenario as AwarenessKey))
    .map((row) => ({
      scenario: row.scenario as AwarenessKey,
      awarenessLabel: awarenessLabel(row.scenario as AwarenessKey),
      dominantBelief: row.dominantBelief.trim(),
      messageThatLands: row.messageThatLands.trim(),
      messageThatBackfires: row.messageThatBackfires.trim(),
      bestChannel: row.bestChannel.trim(),
      primaryObjection: row.primaryObjection.trim(),
    }));

  rows.sort((a, b) => scenarioRank(a.scenario) - scenarioRank(b.scenario));

  return { rows, markdown: comparisonToMarkdown(rows, input.serviceName) };
}
