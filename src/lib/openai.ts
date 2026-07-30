/**
 * The single OpenAI entry point.
 *
 * Everything that talks to OpenAI goes through here so that timeouts, retry
 * with exponential backoff on 429/5xx, and per-run token/cost logging are
 * impossible to forget. The API key is read lazily from env and never leaves
 * the server.
 */
import 'server-only';
import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import { env } from './env';
import { prisma } from './db';

let client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: env.openaiApiKey,
      timeout: env.timeoutMs,
      // Retries are handled here, not by the SDK, so backoff and logging stay
      // in one place and streaming gets the same treatment as JSON calls.
      maxRetries: 0,
    });
  }
  return client;
}

export type CallKind =
  | 'resolve'
  | 'converse'
  | 'generate_a'
  | 'generate_b'
  | 'generate_c'
  | 'repair'
  | 'compare'
  | 'title';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
}

const ZERO_USAGE: Usage = { promptTokens: 0, completionTokens: 0, costUsd: 0 };

export function estimateCost(model: string, promptTokens: number, completionTokens: number): number {
  const p = env.pricing;
  const isFast = model === env.modelFast || /mini|nano|haiku|small/i.test(model);
  const inRate = isFast ? p.fastIn : p.in;
  const outRate = isFast ? p.fastOut : p.out;
  return (promptTokens / 1_000_000) * inRate + (completionTokens / 1_000_000) * outRate;
}

// ---------------------------------------------------------------------------
// Retry
// ---------------------------------------------------------------------------

function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429) return true;
  if (typeof status === 'number' && status >= 500) return true;

  const code = (err as { code?: string })?.code;
  if (code && ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  const name = (err as { name?: string })?.name;
  if (name === 'APIConnectionError' || name === 'APIConnectionTimeoutError') return true;
  return false;
}

function backoffMs(attempt: number, err: unknown): number {
  // Honour Retry-After when the API sends one.
  const headers = (err as { headers?: Record<string, string> })?.headers;
  const retryAfter = headers?.['retry-after'];
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30_000);
  }
  const base = Math.min(1000 * 2 ** attempt, 20_000);
  return base + Math.random() * 400; // jitter
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: { maxRetries?: number; signal?: AbortSignal } = {},
): Promise<{ value: T; attempts: number }> {
  const max = opts.maxRetries ?? env.maxRetries;
  let lastError: unknown;

  for (let attempt = 0; attempt <= max; attempt++) {
    if (opts.signal?.aborted) throw new Error('aborted');
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt + 1 };
    } catch (err) {
      lastError = err;
      if (attempt === max || !isRetryable(err)) break;
      await sleep(backoffMs(attempt, err));
    }
  }
  throw lastError;
}

// ---------------------------------------------------------------------------
// Usage logging
// ---------------------------------------------------------------------------

async function logUsage(params: {
  runId?: string | null;
  kind: CallKind;
  model: string;
  usage: Usage;
  durationMs: number;
  attempts: number;
  ok: boolean;
  detail?: string;
}): Promise<void> {
  // Cost logging must never take down a generation.
  try {
    await prisma.usageLog.create({
      data: {
        runId: params.runId ?? null,
        kind: params.kind,
        model: params.model,
        promptTokens: params.usage.promptTokens,
        completionTokens: params.usage.completionTokens,
        costUsd: params.usage.costUsd,
        durationMs: params.durationMs,
        attempts: params.attempts,
        ok: params.ok,
        detail: params.detail?.slice(0, 500),
      },
    });

    if (params.runId && (params.usage.promptTokens || params.usage.completionTokens)) {
      await prisma.run.update({
        where: { id: params.runId },
        data: {
          promptTokens: { increment: params.usage.promptTokens },
          completionTokens: { increment: params.usage.completionTokens },
          costUsd: { increment: params.usage.costUsd },
        },
      });
    }
  } catch (err) {
    console.warn('[usage] failed to log:', (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Non-streaming completion
// ---------------------------------------------------------------------------

export interface CompleteParams {
  kind: CallKind;
  runId?: string | null;
  model: string;
  messages: ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
  signal?: AbortSignal;
}

export interface CompleteResult {
  text: string;
  usage: Usage;
  attempts: number;
}

export async function complete(params: CompleteParams): Promise<CompleteResult> {
  const started = Date.now();
  const body: ChatCompletionCreateParamsNonStreaming = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? env.temperature,
    max_tokens: params.maxTokens ?? env.maxTokens,
    ...(params.jsonMode ? { response_format: { type: 'json_object' as const } } : {}),
  };

  try {
    const { value, attempts } = await withRetry(
      () => openai().chat.completions.create(body, { signal: params.signal }),
      { signal: params.signal },
    );

    const usage: Usage = {
      promptTokens: value.usage?.prompt_tokens ?? 0,
      completionTokens: value.usage?.completion_tokens ?? 0,
      costUsd: estimateCost(
        params.model,
        value.usage?.prompt_tokens ?? 0,
        value.usage?.completion_tokens ?? 0,
      ),
    };

    await logUsage({
      runId: params.runId,
      kind: params.kind,
      model: params.model,
      usage,
      durationMs: Date.now() - started,
      attempts,
      ok: true,
    });

    return { text: value.choices[0]?.message?.content ?? '', usage, attempts };
  } catch (err) {
    await logUsage({
      runId: params.runId,
      kind: params.kind,
      model: params.model,
      usage: ZERO_USAGE,
      durationMs: Date.now() - started,
      attempts: 1,
      ok: false,
      detail: describeError(err),
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Streaming completion
// ---------------------------------------------------------------------------

export interface StreamParams extends Omit<CompleteParams, 'jsonMode'> {
  onDelta: (chunk: string) => void | Promise<void>;
}

export async function streamComplete(params: StreamParams): Promise<CompleteResult> {
  const started = Date.now();
  const body: ChatCompletionCreateParamsStreaming = {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature ?? env.temperature,
    max_tokens: params.maxTokens ?? env.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };

  let text = '';
  let usage: Usage = { ...ZERO_USAGE };

  try {
    // Retry only covers establishing the stream. Once bytes are flowing a
    // mid-stream failure surfaces to the caller, which keeps partial output
    // rather than silently restarting and duplicating text.
    const { value: stream, attempts } = await withRetry(
      async () => {
        if (text.length > 0) throw new Error('stream already started');
        return openai().chat.completions.create(body, { signal: params.signal });
      },
      { signal: params.signal },
    );

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) {
        text += delta;
        await params.onDelta(delta);
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
          costUsd: estimateCost(
            params.model,
            chunk.usage.prompt_tokens ?? 0,
            chunk.usage.completion_tokens ?? 0,
          ),
        };
      }
    }

    if (!usage.promptTokens && !usage.completionTokens) {
      // Some proxies drop the usage chunk; approximate so cost logging is not
      // silently zero.
      const approxOut = Math.ceil(text.length / 4);
      usage = {
        promptTokens: 0,
        completionTokens: approxOut,
        costUsd: estimateCost(params.model, 0, approxOut),
      };
    }

    await logUsage({
      runId: params.runId,
      kind: params.kind,
      model: params.model,
      usage,
      durationMs: Date.now() - started,
      attempts,
      ok: true,
    });

    return { text, usage, attempts };
  } catch (err) {
    await logUsage({
      runId: params.runId,
      kind: params.kind,
      model: params.model,
      usage,
      durationMs: Date.now() - started,
      attempts: 1,
      ok: false,
      detail: describeError(err),
    });
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function describeError(err: unknown): string {
  if (!err) return 'Unknown error';
  const status = (err as { status?: number })?.status;
  const message = (err as { message?: string })?.message ?? String(err);
  return status ? `${status}: ${message}` : message;
}

/** Short, human, non-alarming text for the chat thread when a call fails. */
export function friendlyError(err: unknown): string {
  const status = (err as { status?: number })?.status;
  if (status === 401) {
    return "I can't reach the model — the API key looks wrong. Your brief is saved; fix the key and send anything to retry.";
  }
  if (status === 429) {
    return "Rate limited by the model provider. Your brief is saved — give it a few seconds and send that again.";
  }
  if (status === 400) {
    return "The model rejected that request. Your brief is intact — try rephrasing, or edit the brief on the right.";
  }
  if (typeof status === 'number' && status >= 500) {
    return "The model provider is having a moment. Nothing is lost — send that again in a few seconds.";
  }
  const message = (err as { message?: string })?.message ?? '';
  if (/timeout|timed out|aborted/i.test(message)) {
    return "That took too long and I cut it off. Your brief is saved — try again.";
  }
  return "Something went wrong reaching the model. Your brief is saved and nothing was lost — try that again.";
}

/**
 * Parse JSON from a model response, tolerating stray prose or code fences even
 * though JSON mode should prevent both.
 */
export function parseJsonLoose<T = unknown>(raw: string): T {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(fenced[1]) as T;
    } catch {
      // fall through
    }
  }
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  }
  throw new Error('Model did not return parseable JSON');
}
