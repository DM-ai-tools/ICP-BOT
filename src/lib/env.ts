/**
 * Environment loading with fail-fast boot behaviour.
 *
 * OPENAI_API_KEY is server-side only. This module must never be imported from
 * a client component — the `server-only` guard below turns that mistake into a
 * build error rather than a leaked key.
 */
import 'server-only';

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(
      `[ICP Builder] Missing required environment variable: ${name}\n` +
        `Set it locally in .env (see .env.example) or in the Railway service variables.`,
    );
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : fallback;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Throws with a clear message if anything required is missing. */
export function assertEnv(): void {
  required('OPENAI_API_KEY');
  required('DATABASE_URL');
}

/**
 * Non-throwing check, for /api/health and the boot banner — health should be
 * able to report *why* the service is unhealthy rather than 500 opaquely.
 */
export function envProblems(): string[] {
  const problems: string[] = [];
  if (!process.env.OPENAI_API_KEY?.trim()) problems.push('OPENAI_API_KEY is not set');
  if (!process.env.DATABASE_URL?.trim()) problems.push('DATABASE_URL is not set');
  if (process.env.NEXT_PUBLIC_OPENAI_API_KEY) {
    problems.push(
      'NEXT_PUBLIC_OPENAI_API_KEY is set — remove it. The OpenAI key must never be exposed to the browser.',
    );
  }
  return problems;
}

export const env = {
  get openaiApiKey() {
    return required('OPENAI_API_KEY');
  },
  get databaseUrl() {
    return required('DATABASE_URL');
  },

  /** Generation model — gpt-4o class. */
  get model() {
    return optional('OPENAI_MODEL', 'gpt-4o');
  },
  /** Fast model — resolution and conversation. */
  get modelFast() {
    return optional('OPENAI_MODEL_FAST', 'gpt-4o-mini');
  },

  get timeoutMs() {
    return num('OPENAI_TIMEOUT_MS', 120_000);
  },
  get maxRetries() {
    return num('OPENAI_MAX_RETRIES', 4);
  },
  get concurrency() {
    return Math.max(1, Math.min(8, num('GENERATION_CONCURRENCY', 4)));
  },
  get temperature() {
    return num('OPENAI_TEMPERATURE', 0.7);
  },
  get maxTokens() {
    return num('OPENAI_MAX_TOKENS', 4000);
  },
  get scrapeTimeoutMs() {
    return num('SCRAPE_TIMEOUT_MS', 12_000);
  },

  /** USD per 1M tokens — cost logging only. */
  get pricing() {
    return {
      in: num('OPENAI_PRICE_IN', 2.5),
      out: num('OPENAI_PRICE_OUT', 10),
      fastIn: num('OPENAI_FAST_PRICE_IN', 0.15),
      fastOut: num('OPENAI_FAST_PRICE_OUT', 0.6),
    };
  },

  get isProduction() {
    return process.env.NODE_ENV === 'production';
  },
};
