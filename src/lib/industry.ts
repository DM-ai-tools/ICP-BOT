/**
 * Industry context resolution.
 *
 * Order of preference, cheapest first:
 *   1. an exact cache hit on the canonical key
 *   2. a hand-written curated pack for a vertical we actually sell into
 *   3. an alias hit on a previously generated pack
 *   4. one generation call, stored for everyone after
 *
 * The whole thing is best-effort by design. A pack makes an ICP sharper; its
 * absence must never stop one being produced. Every failure path here returns
 * null and lets generation proceed exactly as it did before this existed.
 */
import 'server-only';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { prisma } from './db';
import { env } from './env';
import { complete, describeError, parseJsonLoose } from './openai';
import { matchCurated } from './industry-curated';
import {
  industryPackContentSchema,
  scrubPack,
  type IndustryPackContent,
  type IndustryPackSummary,
} from './industry-types';
import {
  AUDIENCE_TYPE_LABEL,
  BUSINESS_MODEL_LABEL,
  type SlotValues,
} from './slots';

// ---------------------------------------------------------------------------
// Canonicalisation
// ---------------------------------------------------------------------------

/** Words that carry no discriminating signal and only fragment the cache. */
const FILLER =
  /\b(the|a|an|and|or|for|of|in|to|my|our|their|business(?:es)?|compan(?:y|ies)|industr(?:y|ies)|sector|market|services?|providers?|firms?|practices?|clinics?|studios?|agenc(?:y|ies)|shops?|stores?|owners?|clients?|customers?|professionals?|specialists?|experts?)\b/g;

/**
 * Reduce free text to a stable lookup key.
 *
 * "Dental practices", "dental clinics" and "Dentists " all collapse to "dental",
 * so they share one cached pack instead of paying for three near-identical ones.
 * Crude singularisation is deliberate — a real stemmer would be heavier than the
 * problem deserves and would mangle terms like "logistics".
 */
export function normaliseIndustry(raw: string): string {
  const base = (raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s&/-]/g, ' ')
    .replace(/[/&-]/g, ' ')
    .replace(FILLER, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = base
    .split(' ')
    .filter(Boolean)
    .map((word) => {
      if (word.length <= 4) return word;
      if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
      if (word.endsWith('sses')) return word.slice(0, -2);
      if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us')) return word.slice(0, -1);
      return word;
    });

  // Sorted so word order cannot fragment the cache: "dental cosmetic" and
  // "cosmetic dental" are the same vertical.
  return [...new Set(words)].sort().join(' ') || 'general';
}

/** Region only needs to be stable, not pretty. */
function normaliseRegion(raw: string | null | undefined): string {
  return (raw ?? 'unspecified')
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function packKey(input: {
  canonicalIndustry: string;
  region: string;
  businessModel: string;
  audienceType: string;
}): string {
  return [
    input.canonicalIndustry,
    normaliseRegion(input.region),
    input.businessModel,
    input.audienceType,
  ].join('|');
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const PACK_SYSTEM = `
You are a domain researcher briefing an ICP strategist on an industry they are about to write a customer
profile for. You produce reference material, not prose and not the profile itself.

Everything you return must be true of practitioners in this industry, in this region, for this kind of buyer.
Specific beats comprehensive: "chair time" and "case acceptance" are worth more than "efficiency" and
"growth". If a field genuinely has nothing distinctive in it, return the fewest items allowed rather than
padding it with generic business language.

ABSOLUTE RULE — NO NUMBERS THAT COULD BE MISTAKEN FOR FACTS.
No prices, no percentages, no market sizes, no growth rates, no averages, no benchmarks, no salary figures.
Name the metrics this buyer is judged on; never state their values. This material feeds a client-facing
document and a single invented figure is worse than an entire empty field. Ordinary domain language that
happens to contain a number — "24/7", "two-chair practice", "Section 40" — is fine.

REGION MATTERS. Use the regulator, the schemes, the seasons and the vocabulary of the region given. Australian
dental advertising is governed differently from American; a British trade uses different terms from a
Canadian one; seasons invert between hemispheres.

Return ONLY JSON with these keys:
{
  "canonicalIndustry": "short lowercase label, e.g. \\"dental\\" or \\"commercial plumbing\\"",
  "aliases": ["other phrasings a user might type for this same industry"],
  "summary": "one or two sentences on how this industry actually operates commercially",
  "jargon": [{ "term": "...", "meaning": "one clause" }],
  "roles": ["real job titles of the people in this ICP"],
  "buyingTriggers": ["concrete events that create urgency"],
  "seasonality": ["the predictable annual rhythm"],
  "dealShapes": ["how deals are typically structured — shapes and terms, never amounts"],
  "researchChannels": ["where these buyers genuinely look"],
  "competitorArchetypes": ["kinds of competitor, as archetypes"],
  "commonObjections": ["objections that recur specifically in this vertical"],
  "metricsThatMatter": ["what this buyer is personally judged on, named only"],
  "regulatoryNotes": ["compliance and advertising constraints that limit what may be claimed"],
  "cautions": ["what reads as ignorant or damaging to this audience"]
}
`.trim();

export interface ResolveIndustryInput {
  runId: string;
  slots: SlotValues;
  signal?: AbortSignal;
}

export interface ResolvedPack {
  id: string;
  summary: IndustryPackSummary;
  /** True when this run paid for the pack rather than reusing a cached one. */
  built: boolean;
}

/**
 * Get the industry pack for a brief, building it if nobody has yet.
 *
 * Returns null rather than throwing. Callers treat a missing pack as "generate
 * exactly as before".
 */
export async function resolveIndustryPack(
  input: ResolveIndustryInput,
): Promise<ResolvedPack | null> {
  const industryRaw = input.slots.industry?.trim();
  if (!industryRaw) return null;

  const businessModel = input.slots.business_model ?? 'b2b';
  const audienceType = input.slots.audience_type ?? 'direct_buyer';
  const region = input.slots.region?.trim() || 'Unspecified';
  const normalised = normaliseIndustry(industryRaw);

  try {
    // --- 1. curated, which also fixes the canonical label ------------------
    const curated = matchCurated(`${normalised} ${industryRaw.toLowerCase()}`, businessModel);
    const canonical = curated ? curated.id : normalised;
    const key = packKey({ canonicalIndustry: canonical, region, businessModel, audienceType });

    // --- 2. exact cache hit -------------------------------------------------
    const cached = await prisma.industryPack.findUnique({ where: { key } });
    if (cached) {
      // Return the UPDATED row. Summarising the pre-increment read left the
      // panel reporting a reuse count one behind reality.
      const bumped = await prisma.industryPack.update({
        where: { id: cached.id },
        data: { useCount: { increment: 1 } },
      });
      return { id: bumped.id, summary: toSummary(bumped), built: false };
    }

    // --- 3. store the curated pack on first use ----------------------------
    if (curated) {
      const created = await prisma.industryPack.create({
        data: {
          key,
          canonicalIndustry: curated.id,
          industryRaw,
          aliases: [normalised] as object,
          region,
          businessModel,
          audienceType,
          source: 'curated',
          curatedId: curated.id,
          content: curated.content as object,
          useCount: 1,
        },
      });
      return { id: created.id, summary: toSummary(created), built: true };
    }

    // --- 4. an earlier generated pack under a different phrasing ------------
    const siblings = await prisma.industryPack.findMany({
      where: { region, businessModel, audienceType, source: 'generated' },
      take: 200,
    });
    const aliasHit = siblings.find((pack) => {
      const aliases = (pack.aliases as string[]) ?? [];
      return aliases.includes(normalised) || pack.canonicalIndustry === normalised;
    });
    if (aliasHit) {
      const bumped = await prisma.industryPack.update({
        where: { id: aliasHit.id },
        data: { useCount: { increment: 1 } },
      });
      return { id: bumped.id, summary: toSummary(bumped), built: false };
    }

    // --- 5. build it --------------------------------------------------------
    const built = await generatePack({
      runId: input.runId,
      industryRaw,
      region,
      businessModel,
      audienceType,
      signal: input.signal,
    });
    if (!built) return null;

    const created = await prisma.industryPack.upsert({
      where: { key: packKey({ canonicalIndustry: built.canonicalIndustry, region, businessModel, audienceType }) },
      create: {
        key: packKey({ canonicalIndustry: built.canonicalIndustry, region, businessModel, audienceType }),
        canonicalIndustry: built.canonicalIndustry,
        industryRaw,
        aliases: [...new Set([normalised, ...built.aliases])] as object,
        region,
        businessModel,
        audienceType,
        source: 'generated',
        content: built.content as object,
        useCount: 1,
        promptTokens: built.promptTokens,
        completionTokens: built.completionTokens,
        costUsd: built.costUsd,
      },
      update: { useCount: { increment: 1 } },
    });

    return { id: created.id, summary: toSummary(created), built: true };
  } catch (err) {
    // A pack is an enhancement. Losing one costs sharpness, not the document.
    console.warn('[industry] pack resolution failed:', describeError(err));
    return null;
  }
}

interface BuiltPack {
  canonicalIndustry: string;
  aliases: string[];
  content: IndustryPackContent;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

async function generatePack(input: {
  runId: string;
  industryRaw: string;
  region: string;
  businessModel: string;
  audienceType: string;
  signal?: AbortSignal;
}): Promise<BuiltPack | null> {
  const userMessage = [
    `INDUSTRY: ${input.industryRaw}`,
    `REGION: ${input.region}`,
    `BUSINESS MODEL: ${BUSINESS_MODEL_LABEL[input.businessModel as 'b2b' | 'b2c'] ?? input.businessModel}`,
    `AUDIENCE TYPE: ${AUDIENCE_TYPE_LABEL[input.audienceType as 'direct_buyer'] ?? input.audienceType}`,
    '',
    'Produce the reference pack. JSON only.',
  ].join('\n');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: PACK_SYSTEM },
    { role: 'user', content: userMessage },
  ];

  const { text, usage } = await complete({
    kind: 'industry_pack',
    runId: input.runId,
    model: env.model,
    messages,
    // Low: this is reference material, and variance here would make two runs in
    // the same vertical disagree about what the vertical is.
    temperature: 0.25,
    maxTokens: 2600,
    jsonMode: true,
    signal: input.signal,
  });

  const raw = parseJsonLoose<Record<string, unknown>>(text);
  if (!raw || typeof raw !== 'object') return null;

  const parsed = industryPackContentSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('[industry] generated pack failed validation:', parsed.error.message.slice(0, 300));
    return null;
  }

  // Enforce the no-numbers rule in code. The instruction is emphatic, but a
  // fabricated figure reaching a client document is not a risk worth trusting a
  // prompt with.
  const { content, removed } = scrubPack(parsed.data);
  if (removed.length) {
    console.warn(`[industry] scrubbed ${removed.length} item(s) carrying figures`);
  }

  const canonicalIndustry =
    typeof raw.canonicalIndustry === 'string' && raw.canonicalIndustry.trim()
      ? normaliseIndustry(raw.canonicalIndustry)
      : normaliseIndustry(input.industryRaw);

  const aliases = Array.isArray(raw.aliases)
    ? raw.aliases
        .filter((a): a is string => typeof a === 'string')
        .map(normaliseIndustry)
        .filter(Boolean)
        .slice(0, 12)
    : [];

  return {
    canonicalIndustry,
    aliases,
    content,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costUsd: usage.costUsd,
  };
}

// ---------------------------------------------------------------------------
// Payload
// ---------------------------------------------------------------------------

/**
 * Render a pack for the generation payload.
 *
 * Framed as domain reference rather than company fact, because the master
 * prompt forbids inventing claims about the user's business and a pack must not
 * become a loophole around that.
 */
export function industryContextBlock(pack: IndustryPackContent, industryLabel: string): string {
  const section = (label: string, items: string[]) =>
    items.length ? `${label}:\n${items.map((item) => `  - ${item}`).join('\n')}` : null;

  return [
    `INDUSTRY CONTEXT — ${industryLabel}`,
    '',
    'Reference material about how this industry works, so the profile uses its real language, roles and',
    'pressures rather than generic business vocabulary. This is domain knowledge, NOT facts about the user\'s',
    'company — never attribute any of it to them, and never present it as something they told you. It contains',
    'no figures by design: do not infer or invent any.',
    '',
    pack.summary,
    '',
    section(
      'Language to use naturally where it fits',
      pack.jargon.map((j) => `${j.term} — ${j.meaning}`),
    ),
    section('Real roles in this industry', pack.roles),
    section('What creates urgency', pack.buyingTriggers),
    section('What this buyer is judged on (named only, never quantified)', pack.metricsThatMatter),
    section('Objections that recur in this vertical', pack.commonObjections),
    section('Where they genuinely research', pack.researchChannels),
    section('Competitor archetypes', pack.competitorArchetypes),
    section('How deals are structured here', pack.dealShapes),
    section('Annual rhythm', pack.seasonality),
    section('Compliance constraints on what may be claimed', pack.regulatoryNotes),
    section('What reads as ignorant to this audience', pack.cautions),
    '',
    'Use this to sharpen specificity. Do not list it back, do not name it as a source, and do not let it',
    'override anything the user actually said about their own business.',
  ]
    .filter(Boolean)
    .join('\n');
}

// ---------------------------------------------------------------------------

type PackRow = {
  id: string;
  canonicalIndustry: string;
  industryRaw: string;
  region: string;
  businessModel: string;
  audienceType: string;
  source: string;
  curatedId: string | null;
  useCount: number;
  content: unknown;
  createdAt: Date;
};

export function toSummary(pack: PackRow): IndustryPackSummary {
  return {
    id: pack.id,
    canonicalIndustry: pack.canonicalIndustry,
    industryRaw: pack.industryRaw,
    region: pack.region,
    businessModel: pack.businessModel,
    audienceType: pack.audienceType,
    source: pack.source === 'curated' ? 'curated' : 'generated',
    curatedId: pack.curatedId,
    useCount: pack.useCount,
    content: pack.content as IndustryPackContent,
    createdAt: pack.createdAt.toISOString(),
  };
}
