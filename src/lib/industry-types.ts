/**
 * The industry context pack.
 *
 * Domain knowledge about one vertical, assembled once and reused by every run
 * that targets it. The master prompt ships jargon examples for four verticals;
 * this is what gives the other several hundred the same treatment.
 *
 * What it deliberately does NOT contain: prices, percentages, market sizes,
 * growth rates, or any figure presentable as a statistic. The product has a
 * hard rule against inventing numbers, and a pack is exactly the kind of
 * confident-sounding context that would smuggle one into a client deliverable.
 * `scrubPack` enforces that in code rather than trusting the instruction.
 *
 * Client-safe: the industry panel renders this in the browser.
 */

import { z } from 'zod';

export interface JargonTerm {
  /** The term as practitioners actually say it. */
  term: string;
  /** One clause on what it means, so it gets used correctly rather than sprinkled. */
  meaning: string;
}

export interface IndustryPackContent {
  /** One or two sentences on how this industry actually operates commercially. */
  summary: string;
  /** Vocabulary that signals someone knows the trade. */
  jargon: JargonTerm[];
  /** Real job titles of the people in the ICP. */
  roles: string[];
  /** Concrete events that create urgency in this vertical. */
  buyingTriggers: string[];
  /** Predictable annual rhythm — busy periods, dead periods, budget cycles. */
  seasonality: string[];
  /** How deals are typically structured. Shapes and terms only, never amounts. */
  dealShapes: string[];
  /** Where these buyers genuinely look for information and vendors. */
  researchChannels: string[];
  /** The kinds of competitor that exist here, as archetypes. */
  competitorArchetypes: string[];
  /** Objections that recur specifically in this vertical. */
  commonObjections: string[];
  /** The numbers this buyer is personally judged on. Named, never quantified. */
  metricsThatMatter: string[];
  /** Compliance and advertising constraints that shape what may be claimed. */
  regulatoryNotes: string[];
  /** Things that read as ignorant or damaging to this audience. */
  cautions: string[];
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const list = (min: number, max: number) => z.array(z.string().min(2)).min(min).max(max);

export const industryPackContentSchema = z.object({
  summary: z.string().min(20).max(600),
  jargon: z
    .array(z.object({ term: z.string().min(2), meaning: z.string().min(3) }))
    .min(4)
    .max(20),
  roles: list(2, 12),
  buyingTriggers: list(3, 12),
  seasonality: list(1, 8),
  dealShapes: list(2, 8),
  researchChannels: list(3, 12),
  competitorArchetypes: list(2, 8),
  commonObjections: list(3, 12),
  metricsThatMatter: list(3, 12),
  regulatoryNotes: z.array(z.string().min(3)).max(10).default([]),
  cautions: z.array(z.string().min(3)).max(10).default([]),
});

export type ValidatedPackContent = z.infer<typeof industryPackContentSchema>;

// ---------------------------------------------------------------------------
// Guardrail
// ---------------------------------------------------------------------------

/**
 * Any currency amount, or a percentage/multiple presented as a fact.
 *
 * Deliberately narrow. "$2,500/month" and "grew 40%" must go; "24/7", "9-5",
 * "two to four chairs" and "Section 40" must survive, because stripping ordinary
 * domain language would make packs worse, not safer.
 */
const NUMERIC_CLAIM =
  /(?:[$£€]\s?\d[\d,.]*)|(?:\b\d[\d,.]*\s?(?:%|per\s?cent|percent))|(?:\b\d[\d,.]*\s?(?:x|×)\s?(?:ROI|return|revenue|growth))|(?:\b(?:AUD|USD|GBP|NZD|EUR)\s?\d)/i;

export function containsNumericClaim(text: string): boolean {
  return NUMERIC_CLAIM.test(text);
}

/**
 * Remove any line carrying an invented figure.
 *
 * Dropping the offending item beats rewriting it: a pack with one fewer trigger
 * is still useful, whereas a pack that launders a fabricated number into a
 * client-facing profile is a liability. Returns what was removed so the panel
 * and the logs can be honest about it.
 */
export function scrubPack(content: IndustryPackContent): {
  content: IndustryPackContent;
  removed: string[];
} {
  const removed: string[] = [];

  const keep = (values: string[]): string[] =>
    values.filter((value) => {
      if (containsNumericClaim(value)) {
        removed.push(value);
        return false;
      }
      return true;
    });

  const jargon = content.jargon.filter((entry) => {
    if (containsNumericClaim(entry.term) || containsNumericClaim(entry.meaning)) {
      removed.push(`${entry.term}: ${entry.meaning}`);
      return false;
    }
    return true;
  });

  const summary = containsNumericClaim(content.summary)
    ? content.summary.replace(NUMERIC_CLAIM, 'an unstated amount')
    : content.summary;
  if (summary !== content.summary) removed.push('(figure removed from summary)');

  return {
    removed,
    content: {
      summary,
      jargon,
      roles: keep(content.roles),
      buyingTriggers: keep(content.buyingTriggers),
      seasonality: keep(content.seasonality),
      dealShapes: keep(content.dealShapes),
      researchChannels: keep(content.researchChannels),
      competitorArchetypes: keep(content.competitorArchetypes),
      commonObjections: keep(content.commonObjections),
      metricsThatMatter: keep(content.metricsThatMatter),
      regulatoryNotes: keep(content.regulatoryNotes),
      cautions: keep(content.cautions),
    },
  };
}

// ---------------------------------------------------------------------------
// Wire shape
// ---------------------------------------------------------------------------

export interface IndustryPackSummary {
  id: string;
  canonicalIndustry: string;
  industryRaw: string;
  region: string;
  businessModel: string;
  audienceType: string;
  source: 'curated' | 'generated';
  curatedId: string | null;
  useCount: number;
  content: IndustryPackContent;
  createdAt: string;
}

/** Section labels for the panel, in the order they are worth reading. */
export const PACK_SECTIONS: {
  key: keyof IndustryPackContent;
  label: string;
  hint: string;
}[] = [
  { key: 'jargon', label: 'Language', hint: 'Terms the profile should use naturally' },
  { key: 'roles', label: 'Who they are', hint: 'Real titles in this vertical' },
  { key: 'buyingTriggers', label: 'What creates urgency', hint: 'Events that start a buying cycle' },
  { key: 'metricsThatMatter', label: 'What they are judged on', hint: 'Named, never quantified' },
  { key: 'commonObjections', label: 'Objections that recur', hint: 'Specific to this industry' },
  { key: 'researchChannels', label: 'Where they look', hint: 'Genuine research behaviour' },
  { key: 'competitorArchetypes', label: 'Who else is in the room', hint: 'Competitor archetypes' },
  { key: 'dealShapes', label: 'How deals are structured', hint: 'Shapes and terms, never amounts' },
  { key: 'seasonality', label: 'Annual rhythm', hint: 'Busy periods and budget cycles' },
  { key: 'regulatoryNotes', label: 'Compliance constraints', hint: 'What may not be claimed' },
  { key: 'cautions', label: 'What not to say', hint: 'Reads as ignorant to this audience' },
];
