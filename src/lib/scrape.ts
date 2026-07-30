/**
 * Server-side website fetch.
 *
 * The extracted text is passed to the model labelled "VERIFIED CONTEXT" so it
 * can ground company facts instead of inventing them. Failure is non-fatal and
 * is mentioned exactly once in chat — a dead site must never block a brief.
 */
import 'server-only';
import { env } from './env';

export interface ScrapeResult {
  ok: boolean;
  url: string;
  text: string | null;
  title: string | null;
  reason?: string;
}

const MAX_BYTES = 900_000;
const MAX_TEXT_CHARS = 8_000;

export async function scrapeSite(rawUrl: string): Promise<ScrapeResult> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { ok: false, url: rawUrl, text: null, title: null, reason: 'not a valid URL' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, url: rawUrl, text: null, title: null, reason: 'unsupported protocol' };
  }
  // Don't let a user-supplied URL become an internal network probe.
  if (isPrivateHost(url.hostname)) {
    return { ok: false, url: url.toString(), text: null, title: null, reason: 'blocked host' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.scrapeTimeoutMs);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; ICPBuilder/1.0; +https://github.com/) AppleWebKit/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en',
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        url: url.toString(),
        text: null,
        title: null,
        reason: `site returned ${response.status}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return {
        ok: false,
        url: url.toString(),
        text: null,
        title: null,
        reason: 'not an HTML page',
      };
    }

    const buffer = await response.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buffer.slice(0, MAX_BYTES));
    const { text, title } = extractText(html);

    if (!text || text.length < 120) {
      return {
        ok: false,
        url: url.toString(),
        text: null,
        title,
        reason: 'page had almost no readable text (likely JavaScript-rendered)',
      };
    }

    return { ok: true, url: url.toString(), text: text.slice(0, MAX_TEXT_CHARS), title };
  } catch (err) {
    const message = (err as Error)?.name === 'AbortError' ? 'timed out' : 'could not be reached';
    return { ok: false, url: url.toString(), text: null, title: null, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return true;
  if (/^(0|127|10)\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (host === '::1' || host.startsWith('[')) return true;
  return false;
}

/** Minimal, dependency-free HTML → text. Good enough to ground company facts. */
function extractText(html: string): { text: string; title: string | null } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? decodeEntities(titleMatch[1]).trim().slice(0, 200) : null;

  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    '';

  const body = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // Keep block boundaries so headings don't fuse into sentences.
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  const text = decodeEntities(body)
    .replace(/[ \t ]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 1)
    .join('\n')
    .trim();

  const parts = [
    title ? `PAGE TITLE: ${title}` : null,
    description ? `META DESCRIPTION: ${decodeEntities(description).trim()}` : null,
    text,
  ].filter(Boolean);

  return { text: parts.join('\n\n'), title };
}

function decodeEntities(input: string): string {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** The exact label the master-prompt payload uses for grounded facts. */
export function verifiedContextBlock(text: string, url: string): string {
  return [
    'VERIFIED CONTEXT — use only these company facts, do not infer beyond them.',
    `Source: ${url}`,
    '',
    text.trim(),
    '',
    'End of verified context. Anything not stated above is unknown — do not invent it.',
  ].join('\n');
}
