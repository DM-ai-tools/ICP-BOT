/**
 * The ICP master prompt.
 *
 * IMMUTABLE. Loaded from disk at runtime, verbatim, and used as the system
 * message for every generation call. It is never paraphrased, never summarised,
 * never inlined into source. If you find yourself editing a copy of its text in
 * a .ts file, stop — edit prompts/master_icp.md instead.
 *
 * MASTER_PROMPT_VERSION is derived from the file's own content hash, so any
 * edit to the prompt automatically produces a new version, and every generated
 * ICP records which version produced it.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const PROMPT_RELATIVE_PATH = path.join('prompts', 'master_icp.md');

/** Semantic tag; bump by hand only for a deliberate contract change. */
const SCHEMA_TAG = 'v1';

type LoadedPrompt = {
  text: string;
  version: string;
  sha256: string;
  bytes: number;
  loadedFrom: string;
};

let cached: LoadedPrompt | null = null;

function candidatePaths(): string[] {
  const cwd = process.cwd();
  return [
    path.join(cwd, PROMPT_RELATIVE_PATH),
    // Next standalone output runs from .next/standalone; traced files land
    // beside the server bundle.
    path.join(cwd, '..', '..', PROMPT_RELATIVE_PATH),
    path.join(cwd, '.next', 'standalone', PROMPT_RELATIVE_PATH),
    // Last resort: the original drop location, so a local run works even
    // before the file is copied into the repo.
    path.join(cwd, 'Master Prompt.txt'),
  ];
}

function load(): LoadedPrompt {
  if (cached) return cached;

  const tried: string[] = [];
  for (const candidate of candidatePaths()) {
    tried.push(candidate);
    try {
      const raw = readFileSync(candidate, 'utf8');
      if (!raw.trim()) continue;

      // Strip a UTF-8 BOM if the file was saved from Windows Notepad; leave
      // every other byte exactly as authored.
      const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      const sha256 = createHash('sha256').update(text, 'utf8').digest('hex');

      cached = {
        text,
        sha256,
        bytes: Buffer.byteLength(text, 'utf8'),
        version: `${SCHEMA_TAG}+${sha256.slice(0, 12)}`,
        loadedFrom: candidate,
      };
      return cached;
    } catch {
      // try the next candidate
    }
  }

  throw new Error(
    `[ICP Builder] Could not load the ICP master prompt.\n` +
      `Expected it at ${PROMPT_RELATIVE_PATH} relative to ${process.cwd()}.\n` +
      `Tried:\n${tried.map((t) => `  - ${t}`).join('\n')}`,
  );
}

/** The master prompt, verbatim. Use this as the system message. */
export function masterPrompt(): string {
  return load().text;
}

/** Content-derived version string, stored with every generated ICP. */
export function masterPromptVersion(): string {
  return load().version;
}

export function masterPromptInfo(): Omit<LoadedPrompt, 'text'> {
  const { text: _text, ...rest } = load();
  return rest;
}

// ---------------------------------------------------------------------------
// Mandatory output structure
//
// Re-exported from ./sections so server code can keep importing the prompt and
// its structure from one place, while client components import ./sections
// directly and never pull the disk loader into the browser bundle.
// ---------------------------------------------------------------------------

export * from './sections';
