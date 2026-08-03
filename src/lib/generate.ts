/**
 * PASS 3 — GENERATE.
 *
 * Three sequential calls per document, never one monolithic call. A single call
 * asked to produce all nineteen sections reliably starves everything after
 * Objections: the model front-loads effort, and Market Opportunities, Success
 * Stories, Deal Value and the Qualification Checklist arrive as three-line
 * stubs. Splitting the work gives each third of the document a full budget.
 *
 * The system message is the master prompt, verbatim, every single time — no
 * summary, no excerpt, no "as described above".
 */
import 'server-only';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { env } from './env';
import { streamComplete } from './openai';
import { masterPrompt, SECTIONS_BY_PASS, type SectionSpec } from './master-prompt';
import { awarenessLabel } from './awareness';
import {
  AUDIENCE_TYPE_LABEL,
  BUSINESS_MODEL_LABEL,
  COMPANY_TYPE_LABEL,
  MATURITY_LABEL,
  PRICE_NOT_SPECIFIED,
  detectRegulated,
  priceLine,
  type AwarenessKey,
  type ServiceSlot,
  type SlotValues,
} from './slots';

export type PassId = 'A' | 'B' | 'C';

export interface GenerationContext {
  runId: string;
  slots: SlotValues;
  service: ServiceSlot;
  scenario: AwarenessKey;
  /** Grounded website text, already wrapped by verifiedContextBlock(). */
  verifiedContext?: string | null;
  /** Industry reference block from resolveIndustryPack(), if one resolved. */
  industryContext?: string | null;
  /** One line assembled from the conversation. */
  whyFraming: string;
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// The labelled input block
// ---------------------------------------------------------------------------

/**
 * Renders the resolved brief using the master prompt's own input names.
 *
 * Two guardrails live here rather than in the prompt, because a prompt can be
 * ignored and code cannot:
 *   - a blank price becomes the mandated "not specified" sentence, so there is
 *     no empty field for the model to helpfully fill with a number;
 *   - exactly one audience_type is ever emitted, so the master prompt's
 *     non-mixing rule has nothing to trip over.
 */
export function buildInputBlock(ctx: GenerationContext): string {
  const s = ctx.slots;
  const service = ctx.service;

  const audience = s.audience_type ?? 'direct_buyer';
  const companyType = s.company_type ?? 'other';
  const maturity = s.maturity_tier ?? 'intermediate';
  const model = s.business_model ?? 'b2b';

  const serviceLine =
    model === 'b2c'
      ? `${service.name} — ${priceLine(service)}`
      : `${service.name} — ${priceLine(service)}`;

  const lines = [
    `Your Company Name: ${s.company_name?.trim() || 'Not specified'}`,
    `Website URL: ${s.website_url?.trim() || 'Not specified'}`,
    `Your Company Type: ${COMPANY_TYPE_LABEL[companyType]}`,
    `Audience Type (ICP Orientation): ${AUDIENCE_TYPE_LABEL[audience]}`,
    `Maturity Tier: ${MATURITY_LABEL[maturity]}`,
    `Industry (of the ICP you are targeting): ${s.industry?.trim() || 'Not specified'}`,
    `Offer type (what is being sold to the ICP): ${s.offer_type?.trim() || service.name}`,
    `Service/Product being sold: ${serviceLine}`,
    `Market/Region/Country: ${s.region?.trim() || 'Not specified'}`,
    `Business Model Selector: ${BUSINESS_MODEL_LABEL[model]}`,
    `Awareness level to generate: ${awarenessLabel(ctx.scenario)}`,
    ...(s.target_role?.trim() ? [`Specific role to profile: ${s.target_role.trim()}`] : []),
    `Company size / revenue band of the ICP${model === 'b2c' ? ' (household/earning reality)' : ''}: ${
      s.size_band?.trim() || 'Not specified'
    }`,
    `Any notes/constraints: ${s.notes?.trim() || 'None'}`,
  ];

  return lines.join('\n');
}

function pricingGuardrail(service: ServiceSlot): string {
  if (service.price_terms?.trim()) {
    return `PRICING: The price/terms above are exactly what the user provided. Reflect them as given. Do not extrapolate them into other figures, ranges, projections, ROI numbers or lifetime values that the user did not state.`;
  }
  return `PRICING: No price was provided. Where price/terms appear in the output, use exactly: "${PRICE_NOT_SPECIFIED}". Under "Average Deal Value of the Service", state "Average deal value: unknown (price not provided)" and give a Low/Mid/High band structure by scope and inclusions. Do NOT invent any currency figure anywhere in this document, including in Success Stories.`;
}

function complianceGuardrail(slots: SlotValues): string | null {
  const { regulated, reason } = detectRegulated(slots);
  if (!regulated) return null;
  return [
    `COMPLIANCE — this is a regulated industry (${reason}).`,
    'Avoid guarantees and absolute outcome claims throughout. Use compliance-aware language: "may", "varies",',
    '"subject to suitability", "general information only". Do not imply clinical, financial or legal outcomes.',
    'Success Stories must read as plausible and hedged, never as promises, and must contain no invented figures.',
  ].join(' ');
}

/**
 * When a brief names several roles and then picks one, the pick wins.
 *
 * Observed failure: a brief said "clients are HR directors and hiring
 * managers ... build me the ICP for the hiring manager", and the profile came
 * back about an HR Director — the first role mentioned rather than the one
 * actually asked for. A line in the inputs block was not enough by itself.
 */
function roleGuardrail(slots: SlotValues): string | null {
  const role = slots.target_role?.trim();
  if (!role) return null;

  return [
    `ROLE — the avatar in this document holds exactly one job title: ${role}.`,
    "Not an adjacent role, not a more senior one, and not whoever else was mentioned in passing.",
    `Their seniority, daily reality, pressures, language and objections must all be those of a ${role}.`,
    "Other roles may appear only as members of the buying committee around them.",
  ].join(' ');
}

function audienceGuardrail(slots: SlotValues): string {
  const audience = slots.audience_type ?? 'direct_buyer';
  const label = AUDIENCE_TYPE_LABEL[audience];
  const nonMixing =
    audience === 'clients_customer'
      ? 'Every objection must be a customer-level buying objection. No vendor procurement, no agency selection, no B2B contract dynamics anywhere in this document.'
      : audience === 'channel_partner'
        ? 'Frame throughout as a partnership decision: commercials, deal registration, margin, co-marketing, conflict with existing partners.'
        : 'Procurement and vendor-fit dynamics are in scope, but keep the buyer rational and non-caricatured, and keep every objection aligned to the awareness level.';

  return `AUDIENCE ORIENTATION — this document is built for exactly one audience type: ${label}. ${nonMixing} Do not blend orientations at any point.`;
}

// ---------------------------------------------------------------------------
// Per-pass task instructions
// ---------------------------------------------------------------------------

function sectionInstruction(section: SectionSpec, index: number): string {
  const marker = section.level === 1 ? '#' : '##';
  const target =
    section.kind === 'narrative'
      ? ` As numbered points. Minimum ${section.minWords} words of substance across the section.`
      : section.kind === 'objections'
        ? ' EXACTLY 8, numbered 1 to 8. Each: the objection in the buyer\'s own words, then "What it really means:" and the hidden meaning.'
        : section.kind === 'checklist'
          ? ' Between 8 and 12 yes/no qualifiers, as a numbered list.'
          : section.kind === 'stories'
            ? ' Between 2 and 4 mini-narratives as numbered points, each opening with a bolded lead-in. No invented hard numbers.'
            : '';

  return `${index}. ${marker} ${section.heading}${target}`;
}

/**
 * How enumerated sections must be written.
 *
 * The framework's own rule is "no shallow bullets", and that is preserved
 * exactly: these are numbered points each carrying a full, developed passage.
 * Only the shape changes. The failure mode this guards hardest against is a
 * model treating "points" as permission to compress — a profile that loses half
 * its substance to formatting is worse than a wall of prose.
 */
const ENUMERATION_RULES = `
FORMAT — HOW EVERY SECTION IS WRITTEN

Every section marked "As numbered points" is written as a numbered list: 1., 2., 3., and so on, each point
starting on its own line.

  - A point is NOT a bullet fragment. Each one is a developed passage of two to five full sentences carrying a
    single idea all the way through, with the same specificity, jargon and regional voice the section would
    have had as prose. If a point could be a heading on a slide with nothing underneath it, it is too thin.
  - NOTHING IS DROPPED. This is a change of shape, not of substance. Every observation, motivation, phrase,
    pressure and detail that would have appeared in the paragraph version must still appear inside one of the
    points. Losing content to make the list tidy is the single worst outcome here.
  - Use as many points as the material genuinely contains — typically four to eight. Do not pad to reach a
    number, and do not compress two distinct ideas into one point to keep the list short.
  - One short orienting sentence may precede the list where it genuinely helps. It is optional, never more
    than a sentence, and never a summary of the points that follow.
  - Do not nest sub-lists. One flat numbered sequence per section.
  - Where the section calls for the buyer's own words, keep them in quotes inside the relevant point.

Sections with their own fixed structure — the title line, avatar name, jargon line, the eight objections and
the qualification checklist — keep exactly the structure the framework specifies.
`.trim();

function passTask(pass: PassId, ctx: GenerationContext): string {
  const sections = SECTIONS_BY_PASS[pass];
  const list = sections.map((s, i) => sectionInstruction(s, i + 1)).join('\n');

  const passName = { A: 'PART 1 OF 3', B: 'PART 2 OF 3', C: 'PART 3 OF 3' }[pass];

  const header = [
    `TASK — ${passName}`,
    '',
    'This ICP is being written in three parts so every section gets full depth. Produce ONLY the sections',
    'listed below, in this exact order, using these exact headings and markdown levels. Do not add a preamble,',
    'do not add a closing summary, do not restate sections from another part, and do not announce which part',
    'this is. Begin directly with the first heading.',
    '',
    list,
  ];

  if (pass === 'A') {
    header.push(
      '',
      'The Title Line is a level-1 heading containing the full pipe-separated line from the master prompt format.',
      'Avatar Name and the jargon line are one line each, under their own level-2 headings.',
      'The avatar you name here is the person for the entire document — later parts will build on it.',
    );
  }
  if (pass === 'B') {
    header.push(
      '',
      'Stay in the same avatar, voice, region and jargon set established in Part 1. Do not re-introduce the',
      'avatar or restate their identity — go straight into their goals.',
    );
  }
  if (pass === 'C') {
    header.push(
      '',
      'Stay in the same avatar, voice, region and jargon set. This part closes the document — Objections must',
      'be exactly 8, and the Qualification Checklist must be the final section.',
    );
  }

  header.push('', ENUMERATION_RULES);

  header.push(
    '',
    `AWARENESS DISCIPLINE — this document is ${awarenessLabel(ctx.scenario)} and nothing else. Every section must`,
    'read as that stage. This document will sit beside versions written at other awareness stages, and it must be',
    'visibly, unmistakably different from them in what the buyer believes, what language they use, what they are',
    'weighing up and what would move them. Do not drift into later-stage certainty or earlier-stage ignorance.',
  );

  return header.join('\n');
}

// ---------------------------------------------------------------------------
// Message assembly
// ---------------------------------------------------------------------------

export function buildUserMessage(
  pass: PassId,
  ctx: GenerationContext,
  previous: { a?: string; b?: string } = {},
): string {
  const blocks: string[] = [];

  blocks.push(`WHY THIS ICP IS BEING BUILT\n${ctx.whyFraming}`);

  if (ctx.verifiedContext?.trim()) {
    blocks.push(ctx.verifiedContext.trim());
  }

  // Sits before the inputs so the model reads the vocabulary of the industry
  // before it reads the specifics of the business.
  if (ctx.industryContext?.trim()) {
    blocks.push(ctx.industryContext.trim());
  }

  blocks.push(`INPUTS\n${buildInputBlock(ctx)}`);
  blocks.push(pricingGuardrail(ctx.service));
  blocks.push(audienceGuardrail(ctx.slots));

  const roleRule = roleGuardrail(ctx.slots);
  if (roleRule) blocks.push(roleRule);

  const compliance = complianceGuardrail(ctx.slots);
  if (compliance) blocks.push(compliance);

  // Parts A and B are carried into C verbatim so the avatar name, voice, region
  // and jargon stay identical across the seams of the document.
  if (pass === 'B' && previous.a) {
    blocks.push(
      `ALREADY WRITTEN — PART 1 (for continuity only; do not repeat any of it)\n---\n${previous.a}\n---`,
    );
  }
  if (pass === 'C') {
    const carried = [previous.a, previous.b].filter(Boolean).join('\n\n');
    if (carried) {
      blocks.push(
        `ALREADY WRITTEN — PARTS 1 AND 2 (for continuity only; do not repeat any of it)\n---\n${carried}\n---`,
      );
    }
  }

  blocks.push(passTask(pass, ctx));

  return blocks.join('\n\n');
}

export interface GeneratePassResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

export async function generatePass(
  pass: PassId,
  ctx: GenerationContext,
  previous: { a?: string; b?: string },
  onDelta: (chunk: string) => void | Promise<void>,
): Promise<GeneratePassResult> {
  const messages: ChatCompletionMessageParam[] = [
    // Verbatim. Every time. Never paraphrased.
    { role: 'system', content: masterPrompt() },
    { role: 'user', content: buildUserMessage(pass, ctx, previous) },
  ];

  const { text, usage } = await streamComplete({
    kind: pass === 'A' ? 'generate_a' : pass === 'B' ? 'generate_b' : 'generate_c',
    runId: ctx.runId,
    model: env.model,
    messages,
    temperature: env.temperature,
    maxTokens: env.maxTokens,
    onDelta,
    signal: ctx.signal,
  });

  return {
    text: text.trim(),
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: usage.costUsd,
  };
}

/**
 * Runs all three passes and returns the assembled markdown.
 * Deltas are forwarded as they arrive so the UI streams a document being
 * written, not three documents appearing.
 */
export async function generateDocument(
  ctx: GenerationContext,
  onDelta: (chunk: string, pass: PassId) => void | Promise<void>,
): Promise<{ markdown: string; promptTokens: number; completionTokens: number; costUsd: number }> {
  const a = await generatePass('A', ctx, {}, (chunk) => onDelta(chunk, 'A'));

  const separatorAfterA = '\n\n';
  await onDelta(separatorAfterA, 'A');

  const b = await generatePass('B', ctx, { a: a.text }, (chunk) => onDelta(chunk, 'B'));
  await onDelta(separatorAfterA, 'B');

  const c = await generatePass('C', ctx, { a: a.text, b: b.text }, (chunk) => onDelta(chunk, 'C'));

  return {
    markdown: [a.text, b.text, c.text].join('\n\n'),
    promptTokens: a.promptTokens + b.promptTokens + c.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens + c.completionTokens,
    costUsd: a.costUsd + b.costUsd + c.costUsd,
  };
}

/**
 * The one-line "why this ICP is being built", assembled from the conversation
 * rather than templated from slots alone — it gives the model the intent behind
 * the brief, which is what stops the output reading like a filled-in form.
 */
export function buildWhyFraming(slots: SlotValues, firstUserMessage: string | null): string {
  const bits: string[] = [];
  const who = slots.company_name?.trim();
  const audience = slots.audience_type ?? 'direct_buyer';

  const target =
    audience === 'clients_customer'
      ? `the end customers their clients want to reach in ${slots.industry ?? 'their market'}`
      : audience === 'channel_partner'
        ? `referral and channel partners in ${slots.industry ?? 'their market'}`
        : `the ${slots.industry ?? 'businesses'} that would buy from them`;

  bits.push(
    `${who ? `${who} is` : 'The user is'} building this profile to sharpen how they reach ${target}` +
      `${slots.region ? ` in ${slots.region}` : ''}.`,
  );

  if (firstUserMessage?.trim()) {
    const brief = firstUserMessage.trim().replace(/\s+/g, ' ').slice(0, 400);
    bits.push(`In their own words: "${brief}"`);
  }

  return bits.join(' ');
}
