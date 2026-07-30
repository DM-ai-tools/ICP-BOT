/**
 * Setting shapes that both sides need.
 *
 * Client-safe: the admin toggle renders these labels in the browser, and
 * settings.ts is `server-only` because it talks to the database.
 */

export type AudienceMode = 'strategist' | 'client';

export const AUDIENCE_MODES: {
  key: AudienceMode;
  label: string;
  blurb: string;
}[] = [
  {
    key: 'strategist',
    label: 'Strategist',
    blurb:
      'For your own team. Assumes the person knows what an ICP is, skips the explanations, and goes straight for the inputs.',
  },
  {
    key: 'client',
    label: 'Client',
    blurb:
      'For someone outside marketing. Warm, explains each thing as it comes up, and asks for one piece of information at a time.',
  },
];

export const DEFAULT_AUDIENCE_MODE: AudienceMode = 'strategist';

export function isAudienceMode(value: unknown): value is AudienceMode {
  return value === 'strategist' || value === 'client';
}
