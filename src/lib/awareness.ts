/**
 * Awareness scenarios.
 *
 * The master prompt names five awareness levels with exact wording. Anything
 * sent to the model must use that wording — the calibration rules key off it.
 * The modal speaks in plain English ("problem aware, solution unaware") and
 * maps to those strings here, in one place.
 */

import type { AwarenessKey } from './slots';

// Re-exported so callers can pull the scenario type from the module that owns
// awareness behaviour rather than reaching into the slot schema.
export type { AwarenessKey };

export interface AwarenessScenario {
  key: AwarenessKey;
  /** The master prompt's exact wording. Never edit these strings. */
  label: string;
  /** Plain-English card title used in the modal. */
  cardTitle: string;
  /** One line under the card title. */
  cardSubtitle: string;
  /** Short name for tabs and filenames. */
  short: string;
  /** The master prompt's own calibration note, for UI hints only. */
  calibration: string;
  /** Display order across tabs and the comparison table. */
  order: number;
}

export const AWARENESS: Record<AwarenessKey, AwarenessScenario> = {
  unaware: {
    key: 'unaware',
    label: 'Unaware',
    cardTitle: 'Both unaware',
    cardSubtitle: "Doesn't name the problem or know solutions exist",
    short: 'Unaware',
    calibration: "They don't label the problem; lead with symptoms and “aha” patterns.",
    order: 1,
  },
  problem_aware: {
    key: 'problem_aware',
    label: 'Only Problem-Aware',
    cardTitle: 'Problem aware, solution unaware',
    cardSubtitle: 'Feels the pain, has no idea what fixes it',
    short: 'Problem-Aware',
    calibration: 'They admit symptoms; unsure of solutions.',
    order: 2,
  },
  solution_aware: {
    key: 'solution_aware',
    label: 'Only Solution-Aware',
    cardTitle: 'Problem unaware, solution aware',
    cardSubtitle: "Knows the category exists, hasn't connected it to their own situation",
    short: 'Solution-Aware',
    calibration: 'They know solution categories; not sure which product or provider.',
    order: 3,
  },
  product_aware: {
    key: 'product_aware',
    label: 'Product/Service-Aware',
    cardTitle: 'Both aware',
    cardSubtitle: 'Knows the problem and the fix — now comparing providers',
    short: 'Product-Aware',
    calibration: 'They know this offer; comparing providers.',
    order: 4,
  },
  most_aware: {
    key: 'most_aware',
    label: 'Most Aware',
    cardTitle: 'Ready to buy',
    cardSubtitle: 'Decision made, clearing final uncertainty',
    short: 'Most-Aware',
    calibration: 'Ready to buy; remove last uncertainty — risk, timeline, inclusions, aftercare, terms.',
    order: 5,
  },
};

/**
 * The four scenarios every run produces, in canonical order.
 *
 * Not a choice. Asking which awareness stages to build was a question about the
 * framework rather than about the business, and the answer was always "all of
 * them" — the whole value of the deliverable is the contrast between them, and
 * a single stage in isolation says very little. So the brief completing is the
 * only trigger needed.
 *
 * Most Aware is deliberately excluded: it is a closing-stage profile that
 * overlaps heavily with Product/Service-Aware, and four documents is already a
 * substantial read.
 */
export const DEFAULT_SCENARIOS: AwarenessKey[] = [
  'unaware',
  'problem_aware',
  'solution_aware',
  'product_aware',
];

export const ALL_AWARENESS_KEYS: AwarenessKey[] = [
  'unaware',
  'problem_aware',
  'solution_aware',
  'product_aware',
  'most_aware',
];

export function awarenessLabel(key: AwarenessKey): string {
  return AWARENESS[key]?.label ?? key;
}

export function awarenessShort(key: AwarenessKey): string {
  return AWARENESS[key]?.short ?? key;
}

export function isAwarenessKey(value: unknown): value is AwarenessKey {
  return typeof value === 'string' && value in AWARENESS;
}

/**
 * Canonical position of a scenario, unaware (1) → most aware (5).
 *
 * Use this to order anything — tabs, chapters, comparison rows. Deriving order
 * by `indexOf` into a list of scenarios breaks the moment that list contains
 * the same scenario twice, which it does as soon as a brief has two services.
 */
export function scenarioRank(key: AwarenessKey): number {
  return AWARENESS[key]?.order ?? 99;
}

/** Sort scenario keys into the canonical unaware → most aware order. */
export function sortScenarios(keys: AwarenessKey[]): AwarenessKey[] {
  return [...keys].sort((a, b) => scenarioRank(a) - scenarioRank(b));
}

