/**
 * PASS 1 — RESOLVE.
 *
 * One call to the fast model, JSON mode, with the full conversation history,
 * the slot schema, and any scraped site context. It reasons about implications
 * before emitting: industry implies a jargon set, company type plus offer
 * implies the likely audience, region implies spelling conventions, price shape
 * implies the business model.
 *
 * There is deliberately no regex parsing anywhere in this file. Extracting
 * "Melbourne" with a city list would resolve one brief and fail the next
 * thousand; the model reads meaning, and provenance is tracked so a guess is
 * never mistaken for a fact.
 */
import 'server-only';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { complete, parseJsonLoose } from './openai';
import { env } from './env';
import {
  normaliseServices,
  resolverOutputSchema,
  SERVICE_CAP,
  type ResolverOutput,
  type SlotMeta,
  type SlotValues,
} from './slots';

export interface ResolveInput {
  runId: string;
  history: { role: 'user' | 'assistant'; content: string }[];
  /** Currently stored brief, so the resolver can carry values forward. */
  currentSlots: SlotValues;
  siteContext?: string | null;
  /**
   * The slot the consultant's most recent question was aiming at. Without this
   * the resolver reads the reply cold: "established homeowners who've dealt
   * with plumbing before" is ambiguous in isolation but unmistakable as an
   * answer to a maturity question. Missing this context is what produces
   * repeated questions.
   */
  lastAskedSlot?: string | null;
  signal?: AbortSignal;
}

const SLOT_SCHEMA_DOC = `
SLOT SCHEMA — emit exactly these keys inside "slots".

company_name        string | null   The user's own company (the one selling), not the target.
website_url         string | null   Their site. Normalise to include https://. null if they have none or decline.
company_type        "agency" | "direct" | "other" | null
                                    agency  = marketing agency or service provider selling services to businesses
                                    direct  = business selling its own product/service to its own end customers
                                    other   = anything else (non-profit, marketplace, internal team, association)
audience_type       "direct_buyer" | "clients_customer" | "channel_partner" | null
                                    direct_buyer     = the ICP is whoever pays the user (DEFAULT)
                                    clients_customer = the ICP is the user's client's customer
                                    channel_partner  = the ICP is a referrer, reseller or alliance partner
maturity_tier       "newbie" | "intermediate" | "advanced" | null
                                    Maturity of the TARGET ICP, not the user's own company.
                                    The framework words these in business terms, but the slot applies to BOTH models.
                                    For b2b — read team size, process maturity, volume, specialisation:
                                      newbie       early-stage, lean, owner does everything, low volume
                                      intermediate growing, some systems, roles emerging, consistent demand
                                      advanced     established, strong ops, specialised roles, complex decisions
                                    For b2c — read life stage, tenure and experience, NOT company traits:
                                      newbie       first-timers, young, renting, no prior experience of this purchase
                                      intermediate established, owns/commits, has bought this category before
                                      advanced     affluent or highly experienced, repeat or complex needs, high standards
                                    THIS SLOT IS ALMOST ALWAYS INFERABLE. "Homeowners, forty-plus, own their place" is
                                    intermediate. "Practices with 2-4 chairs and a practice manager" is intermediate.
                                    "First home buyers" is newbie. Do NOT return null just because the user did not use
                                    the words newbie/intermediate/advanced — infer it and mark the source "inferred".
industry            string | null   The industry of the ICP being targeted. Short noun phrase, e.g. "Dental practices".
offer_type          string | null   What is being sold to the ICP, e.g. "Monthly SEO retainer".
services            array | null    1..${SERVICE_CAP} objects: { "name": string, "price_terms": string | null }
                                    price_terms is verbatim from the user, e.g. "$2,500/month retainer".
                                    NEVER invent a price. If unstated, price_terms is null.
region              string | null   Market/region/country, e.g. "Melbourne, Australia" or "United Kingdom".
                                    PRESERVE EVERY LOCATION THE USER NAMES. "the multinationals around Cork
                                    and Dublin" is "Cork and Dublin, Ireland" — NOT "Dublin, Ireland".
                                    Dropping one half of a two-city territory silently removes a chunk of
                                    someone's market, and it is often the larger half. If several cities,
                                    states or countries are named, list them all and append the country.
business_model      "b2c" | "b2b" | null
                                    Is the ICP a consumer/patient (b2c) or a business buyer/partner (b2b)?
awareness_level     "unaware" | "problem_aware" | "solution_aware" | "product_aware" | "most_aware" | null
                                    ONLY set this when the conversation genuinely settles it — e.g. the user says
                                    the audience already knows they need the service and is comparing providers
                                    (product_aware), or has never heard of the category (unaware).
                                    If the user has not addressed awareness at all, leave it null.
target_role         string | null   The SPECIFIC role the ICP should be built for, when the user names one.
                                    Critical when they mention several and then choose: "clients are HR
                                    directors and hiring managers ... build me the ICP for the hiring manager"
                                    resolves to "Hiring manager", NOT "HR director". The chosen role wins over
                                    the first role mentioned, always. Null if no single role was singled out.
size_band           string | null   Company size / revenue band (B2B) or household/earning reality (B2C). Optional.
notes               string | null   Constraints, exclusions, tone requests. Optional.
`.trim();

const FEW_SHOTS = `
WORKED EXAMPLES — messy real briefs, correct resolutions.

--- Example 1 ---
User: "I run a dental SEO agency in Melbourne, need an ICP for the practices we pitch, $2.5k/mo retainer"
Reasoning: "dental SEO agency" gives company_type=agency and industry=dental practices. "the practices we
pitch" makes the ICP the payer, so audience_type=direct_buyer and business_model=b2b (a practice is a
business). Melbourne gives region and AU spelling. "$2.5k/mo retainer" is a recurring B2B retainer shape,
which corroborates b2b, and is the service price verbatim.
{
  "slots": {
    "company_name": null,
    "website_url": null,
    "company_type": "agency",
    "audience_type": "direct_buyer",
    "maturity_tier": null,
    "industry": "Dental practices",
    "offer_type": "Monthly SEO retainer",
    "services": [{ "name": "Dental SEO", "price_terms": "$2,500/month retainer" }],
    "region": "Melbourne, Australia",
    "business_model": "b2b",
    "awareness_level": null,
    "size_band": null,
    "notes": null
  },
  "meta": {
    "company_type": { "source": "stated", "confidence": 0.95, "justification": "Described themselves as an agency." },
    "audience_type": { "source": "stated", "confidence": 0.92, "justification": "\\"the practices we pitch\\" names the payer as the ICP." },
    "industry": { "source": "stated", "confidence": 0.95, "justification": "Dental named directly." },
    "offer_type": { "source": "inferred", "confidence": 0.85, "justification": "SEO sold on a monthly retainer." },
    "services": { "source": "stated", "confidence": 0.9, "justification": "SEO service with the stated retainer." },
    "region": { "source": "stated", "confidence": 0.95, "justification": "Melbourne named." },
    "business_model": { "source": "inferred", "confidence": 0.93, "justification": "The buyer is a practice, i.e. a business." }
  },
  "missing": ["company_name", "maturity_tier"],
  "ambiguities": []
}

--- Example 2 ---
User: "we make orthopaedic mattresses, sell straight to customers through our own site, UK, from £899"
Reasoning: manufacturer selling on its own site is company_type=direct and the ICP is a consumer, so
business_model=b2c. "£899" is a one-off consumer price point, corroborating b2c. UK gives region and
British spelling. No agency layer, so audience_type stays the default direct_buyer.
{
  "slots": {
    "company_name": null, "website_url": null, "company_type": "direct",
    "audience_type": "direct_buyer", "maturity_tier": null,
    "industry": "Retail — mattresses and sleep products",
    "offer_type": "Direct-to-consumer mattress purchase",
    "services": [{ "name": "Orthopaedic mattresses", "price_terms": "from £899" }],
    "region": "United Kingdom", "business_model": "b2c",
    "awareness_level": null, "size_band": null, "notes": null
  },
  "meta": {
    "company_type": { "source": "stated", "confidence": 0.94, "justification": "Sells through its own site." },
    "business_model": { "source": "inferred", "confidence": 0.95, "justification": "One-off consumer price to individual buyers." },
    "region": { "source": "stated", "confidence": 0.95, "justification": "UK named." },
    "services": { "source": "stated", "confidence": 0.93, "justification": "Product and starting price given verbatim." }
  },
  "missing": ["company_name", "maturity_tier"],
  "ambiguities": []
}

--- Example 3 (wall of text, mid-conversation pivot) ---
Earlier the user described a B2B agency ICP. Now: "actually scrap that, I want the ICP for the patients
themselves — the people booking Invisalign, not the clinics. Sydney, treatment runs about 6 grand."
Reasoning: an explicit pivot. The ICP becomes the end patient, so audience_type flips to clients_customer
and business_model flips to b2c. Region narrows to Sydney. "about 6 grand" is a stated price — record it
verbatim rather than converting it. Company type is unchanged: the user is still an agency; only who the
ICP is has changed.
{
  "slots": {
    "company_type": "agency", "audience_type": "clients_customer", "maturity_tier": null,
    "industry": "Dental — orthodontics / clear aligners",
    "offer_type": "Invisalign clear aligner treatment",
    "services": [{ "name": "Invisalign treatment", "price_terms": "about $6,000" }],
    "region": "Sydney, Australia", "business_model": "b2c",
    "awareness_level": null, "size_band": null, "notes": "Pivoted from the practice-owner ICP to the patient ICP."
  },
  "meta": {
    "audience_type": { "source": "stated", "confidence": 0.96, "justification": "\\"the patients themselves, not the clinics\\"." },
    "business_model": { "source": "stated", "confidence": 0.96, "justification": "Patients are consumers." },
    "region": { "source": "stated", "confidence": 0.94, "justification": "Sydney named." },
    "services": { "source": "stated", "confidence": 0.9, "justification": "Invisalign at the stated price." }
  },
  "missing": ["company_name", "maturity_tier"],
  "ambiguities": []
}

--- Example 4 (several locations, several roles, one chosen) ---
User: "We're a recruitment agency in Dublin. Clients are HR directors and hiring managers at the
multinationals around Cork and Dublin. Build me the ICP for the hiring manager."
Reasoning: two cities are named for the MARKET, so both are kept — truncating to Dublin would delete Cork,
which is the larger cluster. Two roles are named but one is explicitly chosen, so target_role is the hiring
manager and not the HR director that happened to be said first.
{
  "slots": {
    "company_type": "agency", "audience_type": "direct_buyer",
    "industry": "Recruitment", "region": "Cork and Dublin, Ireland",
    "business_model": "b2b", "target_role": "Hiring manager"
  },
  "meta": {
    "region": { "source": "stated", "confidence": 0.95, "justification": "Both cities named as the market." },
    "target_role": { "source": "stated", "confidence": 0.96, "justification": "They asked for the hiring manager specifically." }
  },
  "missing": ["company_name", "services", "maturity_tier"],
  "ambiguities": []
}

--- Example 5 (vague, low confidence) ---
User: "help me build an ICP" then "we do B2B stuff, mostly software I guess, all over really"
Reasoning: almost nothing is firm. "B2B stuff" is stated. "mostly software I guess" is hedged, so industry
is inferred at low confidence and must be confirmed rather than assumed. "all over really" is too vague for
region — leave region null and flag the ambiguity; do not guess a country.
{
  "slots": {
    "company_name": null, "website_url": null, "company_type": null,
    "audience_type": "direct_buyer", "maturity_tier": null,
    "industry": "Software / SaaS", "offer_type": null, "services": null,
    "region": null, "business_model": "b2b", "awareness_level": null,
    "size_band": null, "notes": null
  },
  "meta": {
    "business_model": { "source": "stated", "confidence": 0.9, "justification": "Said B2B outright." },
    "industry": { "source": "inferred", "confidence": 0.45, "justification": "\\"mostly software I guess\\" is hedged." },
    "audience_type": { "source": "default", "confidence": 0.8, "justification": "Master prompt default when unspecified." }
  },
  "missing": ["company_name", "region", "services", "company_type", "maturity_tier"],
  "ambiguities": ["\\"all over really\\" does not pin a market — region is unresolved."]
}
`.trim();

const RESOLVER_SYSTEM = `
You are the slot resolver for an ICP (Ideal Customer Profile) builder. You read a conversation between a
strategist and an ICP consultant and return the current state of the brief as JSON. You never write prose
to the user and you never ask questions — a separate component handles conversation.

${SLOT_SCHEMA_DOC}

REASON ABOUT IMPLICATIONS BEFORE YOU EMIT. Slots corroborate each other:
  - industry           → the jargon set and role language that must appear later.
  - company_type + offer → the likely audience_type. An agency describing "the businesses we pitch" means
                         direct_buyer. An agency describing "our client's customers" means clients_customer.
  - region             → spelling and terminology conventions (AU/UK "enquiries", US "zip code").
  - price shape        → the business model. A monthly retainer or per-seat licence points to b2b; a one-off
                         consumer price point or a treatment fee points to b2c.
  - who signs the cheque → business_model. If the payer is an organisation it is b2b, even in a consumer-facing
                         industry like dentistry.

PROVENANCE — the "meta" object carries one entry per NON-NULL slot:
  { "source": "stated" | "inferred" | "default", "confidence": 0..1, "justification": "one clause" }
  - "stated"   the user said it, or it follows unambiguously from their words. High confidence.
  - "inferred" you worked it out from context. Justify in one clause.
  - "default"  a documented default from the ICP framework, currently only audience_type = direct_buyer.
  - justification is ONE clause. Not a sentence of reasoning, not a paragraph.
  - Confidence below 0.6 means the conversation should confirm it rather than assume it.

HARD RULES
1. NEVER downgrade a stated slot. If the user stated something earlier and has not contradicted it, it stays
   "stated" with its original value. Only a new explicit statement may change it.
2. NEVER invent a price. price_terms is verbatim from the user or null. No ranges, no "typically", no market
   averages. This rule has no exceptions.
3. NEVER guess region, industry or business_model from thin air. If it is genuinely unresolved, leave null and
   list it in "missing".
4. Carry forward every value from CURRENT BRIEF unless the latest messages contradict it. Re-emit it, do not
   drop it. Dropping a resolved slot re-opens a question the user already answered.
5. Cap services at ${SERVICE_CAP}. If more are mentioned, keep the ${SERVICE_CAP} most central to the brief.
6. audience_type defaults to "direct_buyer" with source "default" whenever the conversation does not settle it.
7. Set awareness_level ONLY when the conversation truly settles it. Do not infer it from industry or maturity.
8. "missing" lists slot keys that are still null AND worth asking about. Never list: audience_type,
   awareness_level, offer_type, size_band, notes, target_role.
9. If the user answers a question with "I don't know", "not sure" or similar, do NOT list that slot in
   "missing" again — either infer a sensible value at moderate confidence with source "inferred", or leave it
   null and record the deflection in "ambiguities". Never let the same gap be asked twice.
10. Handle meta questions gracefully: if the user asked "what's an ICP?" or similar, the brief is unchanged —
    just re-emit the current state.

${FEW_SHOTS}

Return ONLY a JSON object with keys: slots, meta, missing, ambiguities.
`.trim();

/** Exported so the self-test can assert the target-slot hint is present. */
export function buildResolverUserMessage(input: ResolveInput): string {
  const parts: string[] = [];

  parts.push('CURRENT BRIEF (carry these forward unless contradicted):');
  parts.push(JSON.stringify(input.currentSlots ?? {}, null, 2));

  if (input.siteContext?.trim()) {
    parts.push('');
    parts.push(
      'VERIFIED CONTEXT — use only these company facts, do not infer beyond them.\n' +
        'Extracted from the company website. Use it to fill company_name, industry and services. ' +
        'Do not use it to invent prices or claims.',
    );
    parts.push(input.siteContext.trim().slice(0, 6000));
  }

  parts.push('');
  parts.push('CONVERSATION (oldest first):');
  for (const message of input.history) {
    const who = message.role === 'user' ? 'STRATEGIST' : 'CONSULTANT';
    parts.push(`${who}: ${message.content}`);
  }

  if (input.lastAskedSlot) {
    parts.push('');
    parts.push(
      `THE CONSULTANT'S LAST QUESTION WAS AIMED AT: ${input.lastAskedSlot}\n` +
        `The strategist's final message is most likely answering THAT slot. Read it as an answer to that question ` +
        `first, and only then as general context. If the reply plausibly settles ${input.lastAskedSlot} — even loosely, ` +
        `even in their own words rather than the schema's — resolve it and mark the source "stated". ` +
        `Leaving it null after the user has directly answered it makes the same question get asked again, which is ` +
        `the single worst failure this system can produce.`,
    );
  }

  parts.push('');
  parts.push('Resolve the brief now. JSON only.');
  return parts.join('\n');
}

export interface ResolveResult {
  slots: SlotValues;
  meta: SlotMeta;
  missing: string[];
  ambiguities: string[];
}

export async function resolveSlots(input: ResolveInput): Promise<ResolveResult> {
  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: RESOLVER_SYSTEM },
    { role: 'user', content: buildResolverUserMessage(input) },
  ];

  const { text } = await complete({
    kind: 'resolve',
    runId: input.runId,
    model: env.modelFast,
    messages,
    // Resolution is an extraction task; sampling variance here shows up as a
    // slot flickering between turns, which reads as the bot forgetting things.
    temperature: 0.1,
    maxTokens: 2000,
    jsonMode: true,
    signal: input.signal,
  });

  const parsed = parseJsonLoose<unknown>(text);
  const validated = resolverOutputSchema.safeParse(parsed);

  if (!validated.success) {
    // A malformed resolution must never wipe the brief. Keep what we had.
    console.warn('[resolve] schema mismatch:', validated.error.message);
    return { slots: {}, meta: {}, missing: [], ambiguities: [] };
  }

  return normaliseResolverOutput(validated.data);
}

export function normaliseResolverOutput(data: ResolverOutput): ResolveResult {
  const slots: SlotValues = { ...data.slots };

  if (slots.services !== undefined && slots.services !== null) {
    slots.services = normaliseServices(slots.services);
  }
  if (slots.website_url) {
    slots.website_url = normaliseUrl(slots.website_url);
  }

  const meta: SlotMeta = {};
  for (const [key, value] of Object.entries(data.meta ?? {})) {
    meta[key as keyof SlotMeta] = {
      source: value.source,
      confidence: value.confidence,
      justification: value.justification,
    };
  }

  return {
    slots,
    meta,
    missing: data.missing ?? [],
    ambiguities: data.ambiguities ?? [],
  };
}

export function normaliseUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^(none|n\/a|no site|no website|skip)$/i.test(trimmed)) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!url.hostname.includes('.')) return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
