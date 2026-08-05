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

/** What we are. Short and truthful — no browser cosplay. */
const HONEST_AGENT = 'ICPBuilder/1.0 (+https://github.com/DM-ai-tools/ICP-BOT)';
/** Fallback for sites that reject anything that is not a browser. */
const BROWSER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface FetchedPage {
  ok: boolean;
  url: string;
  html: string | null;
  reason?: string;
}

/**
 * One guarded GET.
 *
 * Every outbound fetch in the app goes through here, so the SSRF guard, the
 * timeout, the byte cap and the content-type check are written once. Discovery
 * reads many pages; it must not get its own, laxer copy of these rules.
 */
export async function fetchPage(
  rawUrl: string,
  opts: { timeoutMs?: number; accept?: string } = {},
): Promise<FetchedPage> {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  } catch {
    return { ok: false, url: rawUrl, html: null, reason: 'not a valid URL' };
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    return { ok: false, url: rawUrl, html: null, reason: 'unsupported protocol' };
  }
  // Don't let a user-supplied URL become an internal network probe.
  if (isPrivateHost(url.hostname)) {
    return { ok: false, url: url.toString(), html: null, reason: 'blocked host' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? env.scrapeTimeoutMs);

  try {
    let response: Response | null = null;

    // Two attempts with different identities, because the two families of WAF
    // in front of small-business sites block opposite things.
    //
    // argfinance.com.au — a WordPress site behind Cloudflare — returns 403 to
    // anything containing "Mozilla/5.0 ... AppleWebKit", and 200 to a short,
    // honest agent. Its rule is "reject clients pretending to be browsers".
    // Plenty of other sites do exactly the reverse and reject anything that is
    // not a browser. One fixed string cannot satisfy both.
    //
    // The honest agent goes first: it is what we actually are, and it happens
    // to be what the stricter family accepts.
    for (const agent of [HONEST_AGENT, BROWSER_AGENT]) {
      response = await fetch(url.toString(), {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': agent,
          Accept: opts.accept ?? 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-AU,en;q=0.9',
        },
      });

      // Only an access verdict is worth a second identity. A 404 is a 404.
      if (![403, 406, 418, 429].includes(response.status)) break;
    }

    if (!response || !response.ok) {
      return {
        ok: false,
        url: url.toString(),
        html: null,
        reason: `site returned ${response?.status ?? 'no response'}`,
      };
    }

    const contentType = response.headers.get('content-type') ?? '';
    const wantsXml = /xml/i.test(opts.accept ?? '');
    const typeOk = wantsXml
      ? /xml|text\/plain/i.test(contentType)
      : /text\/html|application\/xhtml/i.test(contentType);
    if (!typeOk) {
      return { ok: false, url: url.toString(), html: null, reason: 'unexpected content type' };
    }

    const buffer = await response.arrayBuffer();
    const html = new TextDecoder('utf-8').decode(buffer.slice(0, MAX_BYTES));
    return { ok: true, url: response.url || url.toString(), html };
  } catch (err) {
    const message = (err as Error)?.name === 'AbortError' ? 'timed out' : 'could not be reached';
    return { ok: false, url: url.toString(), html: null, reason: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function scrapeSite(rawUrl: string): Promise<ScrapeResult> {
  const page = await fetchPage(rawUrl);
  if (!page.ok || !page.html) {
    return { ok: false, url: page.url, text: null, title: null, reason: page.reason };
  }

  const { text, title } = extractText(page.html);

  if (!text || text.length < 120) {
    return {
      ok: false,
      url: page.url,
      text: null,
      title,
      reason: 'page had almost no readable text (likely JavaScript-rendered)',
    };
  }

  return { ok: true, url: page.url, text: text.slice(0, MAX_TEXT_CHARS), title };
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

/**
 * Links out of a page, same host only, deduped and normalised.
 *
 * Anchor text matters as much as the href: "Truck Loans" pointing at
 * /commercial/asset-finance-2 tells you what the page is when the path does
 * not. Both are returned so the caller can judge on either.
 */
export function extractLinks(
  html: string,
  baseUrl: string,
): { url: string; text: string }[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }

  const seen = new Map<string, { url: string; text: string }>();
  const anchor = /<a\b[^>]*?href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const [, href, inner] = match;
    if (/^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;

    let target: URL;
    try {
      target = new URL(href, base);
    } catch {
      continue;
    }
    if (target.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) continue;
    if (!/^https?:$/.test(target.protocol)) continue;
    if (/\.(pdf|jpe?g|png|gif|svg|webp|zip|mp4|docx?|xlsx?)$/i.test(target.pathname)) continue;

    target.hash = '';
    target.search = '';
    const url = target.toString().replace(/\/$/, '');
    if (url === base.toString().replace(/\/$/, '')) continue;

    const text = decodeEntities(inner.replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    // First sighting wins, but a later one with real anchor text beats an
    // earlier icon-only link to the same page.
    const prior = seen.get(url);
    if (!prior || (!prior.text && text)) seen.set(url, { url, text });
  }

  return [...seen.values()];
}

/** Page headline material, for judging what a candidate page actually is. */
export function pageSummary(html: string): { title: string | null; heading: string | null; description: string | null } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const heading = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
    null;

  const clean = (value: string | null | undefined, cap: number) =>
    value ? decodeEntities(value.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, cap) || null : null;

  return { title: clean(title, 180), heading: clean(heading, 180), description: clean(description, 300) };
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
