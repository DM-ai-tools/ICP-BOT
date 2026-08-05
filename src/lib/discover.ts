/**
 * Sub-service discovery.
 *
 * A mortgage broker does not sell "mortgage broking". They sell first home
 * buyer loans to a 28-year-old renter, refinancing to a 45-year-old with credit
 * card debt, and truck finance to a business owner — three different people who
 * happen to share a website. Generating one ICP for that business averages them
 * into someone who does not exist.
 *
 * So before generation, read the site properly: follow its navigation and its
 * sitemap, read the pages that look like offers, and put a catalogue in front
 * of the strategist. If the site turns out to sell one thing, say so and get out
 * of the way — the existing single-offer path is correct for that case and this
 * module must never make it slower.
 *
 * Everything here is best-effort. A dead site, a JavaScript-rendered site, a
 * slow site, a model hiccup: all return a status the caller can ignore. No
 * failure in this file may ever block a brief.
 */
import 'server-only';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { z } from 'zod';
import { env } from './env';
import { complete, describeError, parseJsonLoose } from './openai';
import { extractLinks, fetchPage, pageSummary } from './scrape';
import {
  slugifyService,
  type DiscoveredService,
  type DiscoveryStatus,
} from './discover-types';

export interface DiscoveryResult {
  status: DiscoveryStatus;
  services: DiscoveredService[];
  pagesRead: number;
  reason?: string;
}

/**
 * Pages fetched beyond the homepage.
 *
 * Reading is for detail, not for coverage. Coverage comes from the navigation:
 * a site that sells twenty things links to twenty things, with the offer name
 * as the anchor text. So every ranked candidate reaches the model as a URL and
 * a label whether or not it was read, and the reads add a summary to the most
 * promising ones. That is why this number can stay small while the catalogue
 * stays complete.
 */
const MAX_PAGES = 16;
/** Candidates handed to the model as URL + label, read or not. */
const MAX_CANDIDATES = 70;
/** Parallel page reads. Polite to the client's server. */
const READ_CONCURRENCY = 6;
/** Per-page timeout — a slow page must not hold up the brief. */
const PAGE_TIMEOUT_MS = 7_000;

/**
 * Paths that are never an offer.
 *
 * Substring matching, not segment matching. A real site names a page
 * `/calculators-and-financial-tools`, and a segment-anchored rule lets that
 * through — where it then outranks `/first-home-buyer`, because it happens to
 * contain "financial". Observed on argfinance.com.au: calculators and language
 * pages crowded out every actual loan product.
 */
const NOT_A_SERVICE =
  /(about|contact|blog|news|article|category|author|privacy|terms|disclaimer|sitemap|cart|checkout|my-account|login|register|search|faq|career|job|our-team|meet-the-team|testimonial|review|gallery|calculator|thank-you|404|areas-we-serve|locations?|lender-panel|partners?|multilingual|health-check|tools|glossary|resources?|guides?|case-stud|webinar|event|award|press|media|refer|sitemap)/i;

/**
 * Substrings that usually mark an offer. Used to rank, never to exclude —
 * plenty of sites name a service page with no marker at all.
 */
const LOOKS_LIKE_SERVICE =
  /(services?|solutions?|products?|offerings?|what-we-do|loans?|finance|financing|lending|mortgage|insurance|treatments?|practice-areas?|areas?-of-(?:practice|law)|specialti?es|expertise|capabilities)/i;

interface Candidate {
  url: string;
  anchorText: string;
  score: number;
}

export async function discoverServices(
  rootUrl: string,
  opts: { runId?: string } = {},
): Promise<DiscoveryResult> {
  try {
    const home = await fetchPage(rootUrl);
    if (!home.ok || !home.html) {
      return { status: 'failed', services: [], pagesRead: 0, reason: home.reason };
    }

    const candidates = rankCandidates([
      ...extractLinks(home.html, home.url),
      ...(await sitemapLinks(home.url)),
    ], home.url);

    if (candidates.length === 0) {
      return { status: 'single', services: [], pagesRead: 1 };
    }

    const pages = await readPages(candidates.slice(0, MAX_PAGES));
    const catalogue = await buildCatalogue(
      home.url,
      pageSummary(home.html),
      pages,
      candidates,
      opts.runId,
    );

    if (catalogue.length < 2) {
      return { status: 'single', services: catalogue, pagesRead: pages.length + 1 };
    }
    return { status: 'ok', services: catalogue, pagesRead: pages.length + 1 };
  } catch (err) {
    return { status: 'failed', services: [], pagesRead: 0, reason: describeError(err) };
  }
}

// ---------------------------------------------------------------------------
// Candidate selection
// ---------------------------------------------------------------------------

async function sitemapLinks(rootUrl: string): Promise<{ url: string; text: string }[]> {
  let origin: string;
  try {
    origin = new URL(rootUrl).origin;
  } catch {
    return [];
  }

  const found: { url: string; text: string }[] = [];

  for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
    const res = await fetchPage(`${origin}${path}`, {
      timeoutMs: PAGE_TIMEOUT_MS,
      accept: 'application/xml,text/xml',
    });
    if (!res.ok || !res.html) continue;

    // A sitemap index points at more sitemaps. Follow one level, no further:
    // a site with fifty sitemaps is a publisher, and its long tail is articles.
    const isIndex = /<sitemapindex/i.test(res.html);
    const locs = [...res.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);

    if (isIndex) {
      const child = locs.find((loc) => /(service|solution|product|page|post)/i.test(loc)) ?? locs[0];
      if (child) {
        const nested = await fetchPage(child, {
          timeoutMs: PAGE_TIMEOUT_MS,
          accept: 'application/xml,text/xml',
        });
        if (nested.ok && nested.html) {
          for (const loc of [...nested.html.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)]) {
            found.push({ url: loc[1], text: '' });
          }
        }
      }
    } else {
      for (const loc of locs) found.push({ url: loc, text: '' });
    }

    if (found.length) break;
  }

  return found.slice(0, 300);
}

function rankCandidates(links: { url: string; text: string }[], rootUrl: string): Candidate[] {
  let rootHost: string;
  try {
    rootHost = new URL(rootUrl).hostname.replace(/^www\./, '');
  } catch {
    return [];
  }

  const byUrl = new Map<string, Candidate>();

  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      continue;
    }
    if (url.hostname.replace(/^www\./, '') !== rootHost) continue;

    const path = url.pathname.replace(/\/$/, '');
    if (!path || path === '/') continue;
    if (NOT_A_SERVICE.test(path)) continue;

    const depth = path.split('/').filter(Boolean).length;
    // Very deep paths are almost always articles or archives.
    if (depth > 4) continue;

    let score = 0;
    if (LOOKS_LIKE_SERVICE.test(path)) score += 5;
    if (depth === 2) score += 3; // /services/first-home-loans — the classic shape
    if (depth === 1) score += 3; // /first-home-buyer — just as common
    // The anchor text is the strongest signal on the page. A site that sells
    // twenty things labels twenty links with what they are, and a short
    // title-cased label is a navigation item rather than body copy.
    if (link.text) {
      score += 2;
      if (link.text.length <= 40) score += 3;
      if (LOOKS_LIKE_SERVICE.test(link.text)) score += 3;
      if (NOT_A_SERVICE.test(link.text)) score -= 8;
    }
    // Digits in the last segment usually mean pagination or an ID.
    if (/\d{3,}/.test(path.split('/').pop() ?? '')) score -= 4;

    const key = url.toString().replace(/\/$/, '');
    const prior = byUrl.get(key);
    if (!prior || score > prior.score) {
      byUrl.set(key, { url: key, anchorText: link.text, score });
    }
  }

  return [...byUrl.values()]
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.url.length - b.url.length)
    .slice(0, MAX_CANDIDATES);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

interface ReadPage {
  url: string;
  anchorText: string;
  title: string | null;
  heading: string | null;
  description: string | null;
}

async function readPages(candidates: Candidate[]): Promise<ReadPage[]> {
  const out: ReadPage[] = [];
  const queue = [...candidates];

  const worker = async () => {
    for (;;) {
      const next = queue.shift();
      if (!next) return;
      const page = await fetchPage(next.url, { timeoutMs: PAGE_TIMEOUT_MS });
      if (!page.ok || !page.html) continue;
      const summary = pageSummary(page.html);
      // A page with no headline material tells us nothing worth a prompt slot.
      if (!summary.title && !summary.heading) continue;
      out.push({ url: next.url, anchorText: next.anchorText, ...summary });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(READ_CONCURRENCY, queue.length) }, () => worker()),
  );

  // Restore the ranked order the workers scrambled.
  const rank = new Map(candidates.map((c, i) => [c.url, i]));
  return out.sort((a, b) => (rank.get(a.url) ?? 0) - (rank.get(b.url) ?? 0));
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

const catalogueSchema = z.object({
  is_single_service: z.boolean().default(false),
  services: z
    .array(
      z.object({
        name: z.string().min(1),
        group: z.union([z.string(), z.null()]).optional(),
        summary: z.string().default(''),
        source_url: z.union([z.string(), z.null()]).optional(),
      }),
    )
    .default([]),
});

const CATALOGUE_SYSTEM = `
You are reading a company's website to list the distinct OFFERS it sells, so a strategist can choose which ones
to build customer profiles for.

You are given the homepage summary and the title, heading and description of pages found through the site's own
navigation and sitemap.

WHAT COUNTS AS AN OFFER
  Something a customer buys or engages the company for. "First home buyer loans", "Refinancing", "Truck finance",
  "Teeth whitening", "Commercial leasing advice".

WHAT DOES NOT
  About, contact, team, careers, blog posts, news, case studies, testimonials, calculators, tools, locations,
  FAQs, privacy and terms. Locations are NOT offers: "Mortgage broker Werribee" and "Mortgage broker Point Cook"
  are one offer sold in two suburbs, not two offers. Collapse them.

RULES
  - MERGE things that are the same offer worded differently. "Home loans" and "Residential lending" is ONE entry.
  - MERGE things a customer would buy in a single transaction from a single conversation.
  - SPLIT things that plainly serve different buyers. First home buyer loans and commercial property finance are
    NOT the same offer, even though both are lending.
  - Use the site's own grouping when it has one — "Home loans", "Business & commercial" — as the group field.
    Use null when the site has no grouping.
  - Name each offer as a strategist would say it out loud, in the site's own vocabulary. Title case, no marketing
    adjectives, no trailing "services" unless the site always says it.
  - summary: one short line naming WHO buys this, in plain words — "people buying their first property",
    "owner-drivers financing a truck". Do NOT copy the page's marketing headline: "Get the Home Loan you
    Deserve" tells a strategist nothing about who is on the other end of it. No figures, no prices, no
    invented claims. If the page does not say who it is for, describe the offer plainly instead.
  - Order by how prominent the offer is on the site.
  - Return AT MOST 20. If the site genuinely sells one thing, set is_single_service true and return that one entry.

Return JSON: { "is_single_service": boolean, "services": [ { "name", "group", "summary", "source_url" } ] }
`.trim();

async function buildCatalogue(
  rootUrl: string,
  home: { title: string | null; heading: string | null; description: string | null },
  pages: ReadPage[],
  candidates: Candidate[],
  runId?: string,
): Promise<DiscoveredService[]> {
  if (pages.length === 0 && candidates.length === 0) return [];

  const lines = pages.map((page) =>
    [
      `URL: ${page.url}`,
      page.anchorText ? `LINK TEXT: ${page.anchorText}` : null,
      page.title ? `TITLE: ${page.title}` : null,
      page.heading ? `HEADING: ${page.heading}` : null,
      page.description ? `DESCRIPTION: ${page.description}` : null,
    ]
      .filter(Boolean)
      .join('\n'),
  );

  // Everything else the navigation pointed at, as URL + label. Cheap, and it
  // is what makes the catalogue complete rather than merely deep — the reads
  // above cover the top of the list, this covers the rest of it.
  const read = new Set(pages.map((p) => p.url));
  const linkOnly = candidates
    .filter((c) => !read.has(c.url))
    .slice(0, MAX_CANDIDATES)
    .map((c) => `${c.url}${c.anchorText ? `  —  "${c.anchorText}"` : ''}`);

  const userMessage = [
    `SITE: ${rootUrl}`,
    home.title ? `HOMEPAGE TITLE: ${home.title}` : null,
    home.heading ? `HOMEPAGE HEADING: ${home.heading}` : null,
    home.description ? `HOMEPAGE DESCRIPTION: ${home.description}` : null,
    '',
    `PAGES READ IN FULL (${pages.length})`,
    '',
    lines.join('\n\n'),
    ...(linkOnly.length
      ? [
          '',
          `OTHER LINKS FOUND IN THE SITE'S NAVIGATION (${linkOnly.length}) — url followed by its link text.`,
          'Treat these as equally real. A page is not less of an offer for not having been read in full.',
          '',
          linkOnly.join('\n'),
        ]
      : []),
    '',
    'List the distinct offers. JSON only.',
  ]
    .filter((part) => part !== null)
    .join('\n');

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: CATALOGUE_SYSTEM },
    { role: 'user', content: userMessage },
  ];

  const { text } = await complete({
    kind: 'discover',
    runId,
    model: env.modelFast,
    messages,
    temperature: 0.1,
    maxTokens: 2200,
    jsonMode: true,
  });

  const parsed = catalogueSchema.safeParse(parseJsonLoose(text));
  if (!parsed.success) return [];

  if (parsed.data.is_single_service) return [];

  const seen = new Set<string>();
  const services: DiscoveredService[] = [];

  for (const raw of parsed.data.services) {
    const name = raw.name.trim();
    if (!name) continue;
    const slug = slugifyService(name);
    if (seen.has(slug)) continue;
    seen.add(slug);
    services.push({
      name,
      slug,
      group: raw.group?.trim() || null,
      summary: raw.summary.trim(),
      url: raw.source_url?.trim() || null,
    });
    if (services.length >= 20) break;
  }

  return services;
}
