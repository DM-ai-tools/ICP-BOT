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

/** The four cards of the 2x2, in grid order. All pre-checked by default. */
export const MODAL_CARDS: AwarenessKey[] = [
  'problem_aware',
  'solution_aware',
  'unaware',
  'product_aware',
];

/** The "ready to buy" sub-toggle on the "Both aware" card adds this scenario. */
export const READY_TO_BUY_SCENARIO: AwarenessKey = 'most_aware';

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

/** Sort scenario keys into the canonical unaware → most aware order. */
export function sortScenarios(keys: AwarenessKey[]): AwarenessKey[] {
  return [...keys].sort((a, b) => (AWARENESS[a]?.order ?? 99) - (AWARENESS[b]?.order ?? 99));
}

/**
 * Turn a modal selection into the scenario list to generate.
 * The sub-toggle adds Most Aware as a fifth document; it does not replace
 * Product/Service-Aware, so the default path stays exactly four.
 */
export function scenariosFromModal(selection: {
  cards: AwarenessKey[];
  readyToBuy: boolean;
}): AwarenessKey[] {
  const set = new Set<AwarenessKey>(selection.cards.filter((k) => MODAL_CARDS.includes(k)));
  if (selection.readyToBuy && set.has('product_aware')) {
    set.add(READY_TO_BUY_SCENARIO);
  }
  return sortScenarios([...set]);
}
