/**
 * The brief: slot schema, provenance rules, ask-priority, and the mapping from
 * internal slot values to the master prompt's exact input wording.
 *
 * Shared by server and client — no `server-only` here, and nothing secret.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CompanyType = 'agency' | 'direct' | 'other';
export type AudienceType = 'direct_buyer' | 'clients_customer' | 'channel_partner';
export type MaturityTier = 'newbie' | 'intermediate' | 'advanced';
export type BusinessModel = 'b2c' | 'b2b';
export type AwarenessKey =
  | 'unaware'
  | 'problem_aware'
  | 'solution_aware'
  | 'product_aware'
  | 'most_aware';

export type SlotSource = 'stated' | 'inferred' | 'default';

export interface ServiceSlot {
  name: string;
  price_terms?: string | null;
}

export interface SlotValues {
  company_name?: string | null;
  website_url?: string | null;
  company_type?: CompanyType | null;
  audience_type?: AudienceType | null;
  maturity_tier?: MaturityTier | null;
  industry?: string | null;
  offer_type?: string | null;
  services?: ServiceSlot[] | null;
  region?: string | null;
  business_model?: BusinessModel | null;
  awareness_level?: AwarenessKey | null;
  size_band?: string | null;
  notes?: string | null;
}

export type SlotKey = keyof SlotValues;

export interface SlotMetaEntry {
  source: SlotSource;
  confidence: number;
  justification?: string;
  /** Set when the user edits the value directly in the brief panel. */
  editedByUser?: boolean;
  updatedAt?: string;
}

export type SlotMeta = Partial<Record<SlotKey, SlotMetaEntry>>;

// ---------------------------------------------------------------------------
// Zod schema — used to validate the resolver's JSON output
// ---------------------------------------------------------------------------

export const SERVICE_CAP = 3;

const nullableString = z.union([z.string(), z.null()]).optional();

export const serviceSchema = z.object({
  name: z.string().min(1),
  price_terms: nullableString,
});

export const slotValuesSchema = z.object({
  company_name: nullableString,
  website_url: nullableString,
  company_type: z.union([z.enum(['agency', 'direct', 'other']), z.null()]).optional(),
  audience_type: z
    .union([z.enum(['direct_buyer', 'clients_customer', 'channel_partner']), z.null()])
    .optional(),
  maturity_tier: z
    .union([z.enum(['newbie', 'intermediate', 'advanced']), z.null()])
    .optional(),
  industry: nullableString,
  offer_type: nullableString,
  services: z.union([z.array(serviceSchema), z.null()]).optional(),
  region: nullableString,
  business_model: z.union([z.enum(['b2c', 'b2b']), z.null()]).optional(),
  awareness_level: z
    .union([
      z.enum(['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware']),
      z.null(),
    ])
    .optional(),
  size_band: nullableString,
  notes: nullableString,
});

export const slotMetaEntrySchema = z.object({
  source: z.enum(['stated', 'inferred', 'default']),
  confidence: z.number().min(0).max(1),
  justification: z.string().optional(),
});

export const resolverOutputSchema = z.object({
  slots: slotValuesSchema,
  meta: z.record(z.string(), slotMetaEntrySchema).default({}),
  missing: z.array(z.string()).default([]),
  ambiguities: z.array(z.string()).default([]),
});

export type ResolverOutput = z.infer<typeof resolverOutputSchema>;

// ---------------------------------------------------------------------------
// Slot registry
// ---------------------------------------------------------------------------

export interface SlotSpec {
  key: SlotKey;
  /** Human wording for the brief panel. Never shown to the model as a question. */
  label: string;
  /** Required before generation can start. */
  required: boolean;
  /**
   * Ask priority — lower asks first. `null` means NEVER ask in prose:
   * either it has a documented default, it is optional, or it has its own UI.
   */
  askPriority: number | null;
  /**
   * A default the MASTER PROMPT itself documents. Applied silently and never
   * asked about — the hard invariant is that a slot with a documented default
   * is never a question.
   */
  documentedDefault?: unknown;
  /**
   * Not a documented default: a sensible landing spot used only after the user
   * has been asked once and declined to pin it down, or told us to get on with
   * it. Asked first, assumed second — and flagged as an assumption either way.
   */
  fallback?: unknown;
  /** Optional slots are never chased. */
  optional: boolean;
}

export const SLOT_SPECS: SlotSpec[] = [
  // Highest-signal first: these shape every other inference.
  { key: 'industry', label: 'Industry', required: true, askPriority: 10, optional: false },
  {
    key: 'business_model',
    label: 'Business model',
    required: true,
    askPriority: 20,
    optional: false,
  },
  { key: 'region', label: 'Region', required: true, askPriority: 30, optional: false },
  { key: 'services', label: 'Service being sold', required: true, askPriority: 40, optional: false },
  {
    key: 'website_url',
    label: 'Website',
    // Requested in the opening turn — "tell me about your business, paste your
    // site if you have one" is still one question — and never chased after
    // that. Spending a whole turn on it later would push the worst-case brief
    // to eight questions for something that is optional and, once the company
    // and industry are known, no longer worth a turn.
    required: false,
    askPriority: null,
    optional: false,
  },
  {
    key: 'company_type',
    label: 'Company type',
    required: true,
    askPriority: 50,
    optional: false,
  },
  { key: 'company_name', label: 'Company name', required: true, askPriority: 60, optional: false },
  {
    key: 'maturity_tier',
    label: 'Maturity tier',
    required: true,
    askPriority: 70,
    // The master prompt lists maturity as a required choose-one with no
    // default, so it earns one question carrying a proposed answer. Only a
    // deflection lands on intermediate.
    fallback: 'intermediate',
    optional: false,
  },

  // Never asked in prose.
  {
    key: 'audience_type',
    label: 'Audience type',
    required: true,
    askPriority: null, // master prompt documents the default: Direct Buyer
    documentedDefault: 'direct_buyer',
    optional: false,
  },
  {
    key: 'awareness_level',
    label: 'Awareness level',
    required: true,
    askPriority: null, // has its own blocking modal
    optional: false,
  },
  { key: 'offer_type', label: 'Offer type', required: false, askPriority: null, optional: true },
  { key: 'size_band', label: 'Size / revenue band', required: false, askPriority: null, optional: true },
  { key: 'notes', label: 'Notes', required: false, askPriority: null, optional: true },
];

export const SLOT_SPEC_BY_KEY: Record<SlotKey, SlotSpec> = Object.fromEntries(
  SLOT_SPECS.map((s) => [s.key, s]),
) as Record<SlotKey, SlotSpec>;

/** Slots that must hold a value before generation is allowed. */
export const REQUIRED_SLOTS: SlotKey[] = SLOT_SPECS.filter((s) => s.required).map((s) => s.key);

/** Everything the conversation is allowed to ask about, in priority order. */
export const ASKABLE_SLOTS: SlotKey[] = SLOT_SPECS.filter((s) => s.askPriority !== null)
  .sort((a, b) => (a.askPriority ?? 0) - (b.askPriority ?? 0))
  .map((s) => s.key);

// ---------------------------------------------------------------------------
// Emptiness, merging and provenance
// ---------------------------------------------------------------------------

export function isEmptySlot(key: SlotKey, value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (key === 'services') {
    return !Array.isArray(value) || value.filter((s) => s?.name?.trim()).length === 0;
  }
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    return v === '' || v === 'unknown' || v === 'n/a' || v === 'null' || v === 'not specified';
  }
  return false;
}

export function normaliseServices(input: unknown): ServiceSlot[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ServiceSlot[] = [];
  for (const raw of input) {
    const name = typeof raw?.name === 'string' ? raw.name.trim() : '';
    if (!name) continue;
    const dedupeKey = name.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const price =
      typeof raw?.price_terms === 'string' && raw.price_terms.trim() ? raw.price_terms.trim() : null;
    out.push({ name, price_terms: price });
    // Hard cap: the master prompt's structure assumes a focused offer set.
    if (out.length >= SERVICE_CAP) break;
  }
  return out;
}

const SOURCE_RANK: Record<SlotSource, number> = { default: 0, inferred: 1, stated: 2 };

export interface MergeResult {
  slots: SlotValues;
  meta: SlotMeta;
  /** Slots whose value actually changed — drives document invalidation. */
  changed: SlotKey[];
}

/**
 * Merge a fresh resolution into the stored brief.
 *
 * Rules, in order:
 *  - A user edit is authoritative until the user says something new (a fresh
 *    `stated` value can override it — that is a mid-conversation pivot).
 *  - A `stated` slot is never downgraded to a guess. An `inferred` or `default`
 *    resolution can never overwrite a `stated` value, only fill an empty one.
 *  - Equal-rank sources: the newer value wins, so pivots land.
 */
export function mergeResolution(
  current: SlotValues,
  currentMeta: SlotMeta,
  incoming: SlotValues,
  incomingMeta: SlotMeta,
): MergeResult {
  const slots: SlotValues = { ...current };
  const meta: SlotMeta = { ...currentMeta };
  const changed: SlotKey[] = [];

  for (const spec of SLOT_SPECS) {
    const key = spec.key;
    const nextRaw = (incoming as Record<string, unknown>)[key];
    if (nextRaw === undefined) continue;

    const next = key === 'services' ? normaliseServices(nextRaw) : nextRaw;
    if (isEmptySlot(key, next)) continue;

    const nextMeta: SlotMetaEntry = incomingMeta[key] ?? { source: 'inferred', confidence: 0.5 };
    const prevMeta = meta[key];
    const prevValue = (slots as Record<string, unknown>)[key];
    const prevEmpty = isEmptySlot(key, prevValue);

    if (!prevEmpty && prevMeta) {
      const prevRank = SOURCE_RANK[prevMeta.source];
      const nextRank = SOURCE_RANK[nextMeta.source];
      // Never downgrade a stated slot to a guess.
      if (nextRank < prevRank) continue;
      // A user edit only yields to a fresh explicit statement.
      if (prevMeta.editedByUser && nextMeta.source !== 'stated') continue;
    }

    if (!sameValue(prevValue, next)) changed.push(key);

    (slots as Record<string, unknown>)[key] = next;
    meta[key] = {
      source: nextMeta.source,
      confidence: nextMeta.confidence,
      justification: nextMeta.justification,
      editedByUser: false,
      updatedAt: new Date().toISOString(),
    };
  }

  return { slots, meta, changed };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  } catch {
    return false;
  }
}

/** Apply documented defaults to still-empty slots. Returns what it filled. */
export function applyDocumentedDefaults(
  slots: SlotValues,
  meta: SlotMeta,
): { slots: SlotValues; meta: SlotMeta; applied: SlotKey[] } {
  const out: SlotValues = { ...slots };
  const outMeta: SlotMeta = { ...meta };
  const applied: SlotKey[] = [];

  for (const spec of SLOT_SPECS) {
    if (spec.documentedDefault === undefined) continue;
    if (!isEmptySlot(spec.key, (out as Record<string, unknown>)[spec.key])) continue;
    (out as Record<string, unknown>)[spec.key] = spec.documentedDefault;
    outMeta[spec.key] = {
      source: 'default',
      confidence: 0.8,
      justification: 'Documented default from the master prompt.',
      updatedAt: new Date().toISOString(),
    };
    applied.push(spec.key);
  }

  return { slots: out, meta: outMeta, applied };
}

/**
 * Land the fallback for slots the user was asked about and did not pin down.
 *
 * This is what stops the bot looping. It is called only for slots already in
 * the deflected set — never pre-emptively — so a question still gets asked once
 * before anything is assumed, and the assumption is recorded as one.
 */
export function applyFallbacks(
  slots: SlotValues,
  meta: SlotMeta,
  keys: SlotKey[],
): { slots: SlotValues; meta: SlotMeta; applied: SlotKey[] } {
  const out: SlotValues = { ...slots };
  const outMeta: SlotMeta = { ...meta };
  const applied: SlotKey[] = [];

  for (const key of keys) {
    const spec = SLOT_SPEC_BY_KEY[key];
    if (!spec || spec.fallback === undefined) continue;
    if (!isEmptySlot(key, (out as Record<string, unknown>)[key])) continue;

    (out as Record<string, unknown>)[key] = spec.fallback;
    outMeta[key] = {
      source: 'default',
      confidence: 0.55,
      justification: 'Assumed after the question went unanswered.',
      updatedAt: new Date().toISOString(),
    };
    applied.push(key);
  }

  return { slots: out, meta: outMeta, applied };
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export interface Readiness {
  /** Required slots still empty, excluding awareness (its own modal). */
  missingRequired: SlotKey[];
  /** The single slot the bot should ask about next, or null. */
  nextAsk: SlotKey | null;
  /** Inferred slots below the confirm threshold. */
  lowConfidence: SlotKey[];
  /** Everything except awareness is filled. */
  briefComplete: boolean;
  /** Awareness settled — either in conversation or via the modal. */
  awarenessResolved: boolean;
  /** Brief complete and awareness still open → the modal must block. */
  needsAwarenessModal: boolean;
  /** Ready to generate right now. */
  readyToGenerate: boolean;
}

export const CONFIDENCE_CONFIRM_THRESHOLD = 0.6;

export function computeReadiness(
  slots: SlotValues,
  meta: SlotMeta,
  opts: { askedAndDeflected?: SlotKey[] } = {},
): Readiness {
  const deflected = new Set(opts.askedAndDeflected ?? []);

  const missingRequired = REQUIRED_SLOTS.filter(
    (key) => key !== 'awareness_level' && isEmptySlot(key, (slots as Record<string, unknown>)[key]),
  );

  const nextAsk =
    ASKABLE_SLOTS.find(
      (key) => !deflected.has(key) && isEmptySlot(key, (slots as Record<string, unknown>)[key]),
    ) ?? null;

  const lowConfidence = (Object.keys(meta) as SlotKey[]).filter((key) => {
    const entry = meta[key];
    if (!entry) return false;
    if (entry.source !== 'inferred') return false;
    if (isEmptySlot(key, (slots as Record<string, unknown>)[key])) return false;
    return entry.confidence < CONFIDENCE_CONFIRM_THRESHOLD;
  });

  const briefComplete = missingRequired.length === 0;
  const awarenessResolved = !isEmptySlot('awareness_level', slots.awareness_level);

  return {
    missingRequired,
    nextAsk,
    lowConfidence,
    briefComplete,
    awarenessResolved,
    needsAwarenessModal: briefComplete && !awarenessResolved,
    readyToGenerate: briefComplete,
  };
}

// ---------------------------------------------------------------------------
// Ask tracking — the loop-breaker
//
// A slot can fail to resolve even when the user answered it perfectly well:
// the resolver may not map their words onto the schema. If the only guard is
// "did they say I don't know", the slot stays empty, stays top of the queue,
// and the identical question comes back forever.
//
// So repetition is prevented by counting, not by understanding.
// ---------------------------------------------------------------------------

/** Total times a single slot may be put to the user before it is assumed. */
export const MAX_ASKS_PER_SLOT = 2;

export interface AskTracking {
  lastAskedSlot: SlotKey | null;
  lastAskedCount: number;
}

export interface AskDecision {
  /** Slots to freeze permanently — never raise these again. */
  freeze: SlotKey[];
  /** Strike count to persist for the next turn. */
  strikes: number;
  /** The next question is a second attempt at the same gap. */
  isRetry: boolean;
}

export function trackAsk(
  tracking: AskTracking,
  slots: SlotValues,
  opts: { deflected?: boolean } = {},
): AskDecision {
  const { lastAskedSlot } = tracking;
  if (!lastAskedSlot) return { freeze: [], strikes: 0, isRetry: false };

  const landed = !isEmptySlot(lastAskedSlot, (slots as Record<string, unknown>)[lastAskedSlot]);
  if (landed) return { freeze: [], strikes: 0, isRetry: false };

  const strikes = (tracking.lastAskedCount ?? 0) + 1;

  // Out of attempts, or the user explicitly declined to pin it down.
  if (strikes >= MAX_ASKS_PER_SLOT || opts.deflected) {
    return { freeze: [lastAskedSlot], strikes: 0, isRetry: false };
  }

  return { freeze: [], strikes, isRetry: true };
}

// ---------------------------------------------------------------------------
// Master-prompt wording
//
// The master prompt names its inputs precisely. Anything we send must use its
// wording, not our internal enum keys.
// ---------------------------------------------------------------------------

export const COMPANY_TYPE_LABEL: Record<CompanyType, string> = {
  agency: 'Marketing agency / Service provider',
  direct: 'Business selling direct to customers',
  other: 'Other',
};

export const AUDIENCE_TYPE_LABEL: Record<AudienceType, string> = {
  direct_buyer: 'Direct Buyer of the Offer (Default)',
  clients_customer: "Client's Target Customer (End Customer of the Buyer)",
  channel_partner: 'Channel / Partner Buyer',
};

export const MATURITY_LABEL: Record<MaturityTier, string> = {
  newbie: 'Newbie (smaller, early-stage, lean team, lower volume/less process)',
  intermediate: 'Intermediate (growing, some systems, consistent demand, team roles emerging)',
  advanced: 'Advanced (established, strong ops, higher volume, specialised roles, complex decisions)',
};

export const BUSINESS_MODEL_LABEL: Record<BusinessModel, string> = {
  b2c: 'B2C (Consumer/Patient)',
  b2b: 'B2B (Business Buyer/Partner)',
};

/** Short forms for UI chips and filenames. */
export const COMPANY_TYPE_SHORT: Record<CompanyType, string> = {
  agency: 'Agency / service provider',
  direct: 'Sells direct',
  other: 'Other',
};

export const AUDIENCE_TYPE_SHORT: Record<AudienceType, string> = {
  direct_buyer: 'Direct buyer',
  clients_customer: "Client's customer",
  channel_partner: 'Channel / partner',
};

export const MATURITY_SHORT: Record<MaturityTier, string> = {
  newbie: 'Newbie',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const BUSINESS_MODEL_SHORT: Record<BusinessModel, string> = {
  b2c: 'B2C',
  b2b: 'B2B',
};

/** Options for the click-to-edit brief panel. */
export const SLOT_ENUM_OPTIONS: Partial<Record<SlotKey, { value: string; label: string }[]>> = {
  company_type: (Object.keys(COMPANY_TYPE_SHORT) as CompanyType[]).map((v) => ({
    value: v,
    label: COMPANY_TYPE_SHORT[v],
  })),
  audience_type: (Object.keys(AUDIENCE_TYPE_SHORT) as AudienceType[]).map((v) => ({
    value: v,
    label: AUDIENCE_TYPE_SHORT[v],
  })),
  maturity_tier: (Object.keys(MATURITY_SHORT) as MaturityTier[]).map((v) => ({
    value: v,
    label: MATURITY_SHORT[v],
  })),
  business_model: (Object.keys(BUSINESS_MODEL_SHORT) as BusinessModel[]).map((v) => ({
    value: v,
    label: BUSINESS_MODEL_SHORT[v],
  })),
};

// ---------------------------------------------------------------------------
// Pricing guardrail
// ---------------------------------------------------------------------------

/** The master prompt's mandated wording when price is absent. */
export const PRICE_NOT_SPECIFIED = 'Price/terms: not specified (quote/assessment required)';

/**
 * Never let a blank price reach the model as a blank. It gets the mandated
 * sentence instead, so there is nothing for the model to invent around.
 */
export function priceLine(service: ServiceSlot): string {
  const price = service.price_terms?.trim();
  return price ? `Price/terms: ${price}` : PRICE_NOT_SPECIFIED;
}

export function hasPrice(service: ServiceSlot | undefined | null): boolean {
  return Boolean(service?.price_terms?.trim());
}

// ---------------------------------------------------------------------------
// Regulated industries
// ---------------------------------------------------------------------------

const REGULATED_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /\b(health|healthcare|clinic|clinical|hospital|patient|wellness)\b/i, label: 'health' },
  { pattern: /\b(dental|dentist|dentistry|orthodont\w*|endodont\w*)\b/i, label: 'dental' },
  { pattern: /\b(medical|medicine|doctor|gp|physio\w*|surgeon|surgery|pharma\w*|cosmetic)\b/i, label: 'medical' },
  {
    pattern: /\b(financ\w*|bank\w*|mortgage|loan|lending|insurance|invest\w*|superannuation|accounting|tax)\b/i,
    label: 'finance',
  },
  { pattern: /\b(legal|law|lawyer|solicitor|barrister|conveyanc\w*|attorney)\b/i, label: 'legal' },
];

export function detectRegulated(slots: SlotValues): { regulated: boolean; reason: string | null } {
  const haystack = [
    slots.industry,
    slots.offer_type,
    ...(slots.services ?? []).map((s) => s.name),
    slots.notes,
  ]
    .filter(Boolean)
    .join(' ');

  for (const { pattern, label } of REGULATED_PATTERNS) {
    if (pattern.test(haystack)) {
      return { regulated: true, reason: label };
    }
  }
  return { regulated: false, reason: null };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

export function slotDisplayValue(key: SlotKey, slots: SlotValues): string | null {
  const value = (slots as Record<string, unknown>)[key];
  if (isEmptySlot(key, value)) return null;

  switch (key) {
    case 'company_type':
      return COMPANY_TYPE_SHORT[value as CompanyType];
    case 'audience_type':
      return AUDIENCE_TYPE_SHORT[value as AudienceType];
    case 'maturity_tier':
      return MATURITY_SHORT[value as MaturityTier];
    case 'business_model':
      return BUSINESS_MODEL_SHORT[value as BusinessModel];
    case 'awareness_level':
      return value as string;
    case 'services': {
      const services = value as ServiceSlot[];
      return services
        .map((s) => (s.price_terms ? `${s.name} — ${s.price_terms}` : s.name))
        .join(' · ');
    }
    default:
      return String(value);
  }
}

export function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'icp'
  );
}
