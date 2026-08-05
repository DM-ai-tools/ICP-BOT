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
 * Words that mark a page as something other than an offer.
 *
 * Matched as WHOLE TOKENS, split on slashes and hyphens — never as substrings.
 * A substring rule looks equivalent and is not: "media" inside the stoplist
 * silently deleted /social-media-marketing, /b2b-social-media-marketing and
 * /organic-social-media-management from a digital agency's catalogue. Three of
 * its actual services, invisible, with no error anywhere. The strategist simply
 * never saw them in the picker.
 */
/** Never an offer, whatever else the path says. A blog post about SEO is a blog post. */
const HARD_STOP = new Set([
  'about', 'contact', 'blog', 'news', 'article', 'articles', 'category', 'categories',
  'author', 'privacy', 'terms', 'disclaimer', 'sitemap', 'cart', 'checkout', 'account',
  'login', 'register', 'search', 'faq', 'faqs', 'career', 'careers', 'job', 'jobs',
  'team', 'testimonial', 'testimonials', 'thanks', 'thank', '404', 'multilingual',
  'calculator', 'calculators', 'glossary', 'webinar', 'webinars', 'case', 'study',
  'studies', 'cookie', 'cookies', 'unsubscribe', 'author',
]);

/** Usually a page type — but rescued when a service word sits beside it. */
const SOFT_STOP = new Set([
  'media', 'press', 'tool', 'tools', 'resource', 'resources', 'guide', 'guides',
  'event', 'events', 'award', 'awards', 'panel', 'check', 'refer', 'referral',
  'review', 'reviews', 'gallery', 'portfolio', 'partner', 'partners', 'location',
  'locations', 'areas',
]);

/**
 * Words that mark a page as an offer after all.
 *
 * A SOFT stop word sitting next to one of these is part of a service name, not
 * a page type: "social MEDIA MARKETING" is a service, "press and MEDIA" is not.
 * The asymmetry is deliberate — a page wrongly kept costs one line in a prompt
 * the model then rejects, while a page wrongly dropped is a service the
 * strategist never learns exists.
 */
const SERVICE_TOKENS = new Set([
  'service', 'services', 'marketing', 'seo', 'sem', 'ppc', 'ads', 'adwords', 'advertising',
  'design', 'development', 'management', 'consulting', 'strategy', 'loan', 'loans',
  'finance', 'financing', 'lending', 'mortgage', 'insurance', 'treatment', 'treatments',
  'repair', 'repairs', 'installation', 'cleaning', 'training', 'coaching', 'copywriting',
  'branding', 'hosting', 'support', 'maintenance', 'solutions', 'automation', 'audit',
]);

export function isNotAService(path: string): boolean {
  const tokens = path.toLowerCase().split(/[/\-_.]+/).filter(Boolean);
  if (tokens.some((t) => HARD_STOP.has(t))) return true;
  if (!tokens.some((t) => SOFT_STOP.has(t))) return false;
  return !tokens.some((t) => SERVICE_TOKENS.has(t));
}

/**
 * Extra offer markers, on top of SERVICE_TOKENS. Used to rank, never to
 * exclude — plenty of sites name a service page with no marker at all.
 */
const LOOKS_LIKE_SERVICE =
  /(solutions?|products?|offerings?|what-we-do|practice-areas?|areas?-of-(?:practice|law)|specialti?es|expertise|capabilities|agency)/i;

/**
 * Does this text name a service?
 *
 * Reuses the same vocabulary the exclusion rescue uses, which matters: the old
 * ranking regex listed lending and healthcare words but not one marketing word
 * — no "marketing", no "seo", no "ads", no "design" — so on a digital agency's
 * site it matched almost nothing and every real offer ranked on path depth
 * alone. The two rules must draw on the same list or they disagree about what
 * a service even is.
 */
/**
 * Place names, for spotting location variants of one offer.
 *
 * Australian first because that is who this serves, plus the generic markers
 * that travel: "near me", "in <somewhere>".
 */
const PLACE_NAME =
  /\b(melbourne|sydney|brisbane|perth|adelaide|canberra|hobart|darwin|geelong|newcastle|wollongong|ballarat|bendigo|townsville|cairns|toowoomba|gold\s?coast|sunshine\s?coast|richmond|nsw|vic|qld|wa|sa|tas|nt|act|australia|auckland|wellington|near\s?me)\b/i;

function hasServiceToken(text: string): boolean {
  return text
    .toLowerCase()
    .split(/[/\-_.\s]+/)
    .some((token) => SERVICE_TOKENS.has(token));
}

const normalise = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

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

    const navLinks = extractLinks(home.html, home.url);
    const mapLinks = await sitemapLinks(home.url);
    const candidates = rankCandidates([...navLinks, ...mapLinks], home.url);

    // Logged because these three numbers are the entire diagnosis when a site
    // behaves differently in production. A homepage that yields no links is
    // being served as a JavaScript shell; a sitemap that yields none as well
    // means there is genuinely nothing to read.
    console.info(
      `[discover] ${home.url} — nav=${navLinks.length} sitemap=${mapLinks.length} ranked=${candidates.length}`,
    );

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

  // robots.txt names the real sitemap on sites that put it somewhere unusual,
  // and costs one request to check. Tried first because it is authoritative.
  const paths = ['/sitemap.xml', '/sitemap_index.xml', '/wp-sitemap.xml', '/page-sitemap.xml'];
  const robots = await fetchPage(`${origin}/robots.txt`, {
    timeoutMs: PAGE_TIMEOUT_MS,
    accept: 'text/plain',
  });
  if (robots.ok && robots.html) {
    for (const match of robots.html.matchAll(/^\s*sitemap:\s*(\S+)/gim)) {
      try {
        paths.unshift(new URL(match[1]).pathname);
      } catch {
        /* a malformed Sitemap: line is not worth failing over */
      }
    }
  }

  for (const path of [...new Set(paths)]) {
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
    if (isNotAService(path)) continue;

    const depth = path.split('/').filter(Boolean).length;
    // Very deep paths are almost always articles or archives.
    if (depth > 4) continue;

    let score = 0;
    if (hasServiceToken(path)) score += 6;
    if (LOOKS_LIKE_SERVICE.test(path)) score += 4;
    if (depth === 2) score += 3; // /services/first-home-loans — the classic shape
    if (depth === 1) score += 3; // /first-home-buyer — just as common
    // The anchor text is the strongest signal on the page. A site that sells
    // twenty things labels twenty links with what they are, and a short
    // title-cased label is a navigation item rather than body copy.
    if (link.text) {
      score += 2;
      if (link.text.length <= 40) score += 3;
      if (hasServiceToken(link.text)) score += 4;
      if (LOOKS_LIKE_SERVICE.test(link.text)) score += 2;
      if (isNotAService(link.text)) score -= 8;
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
  - A DEDICATED PAGE IS A DISTINCT OFFER. If the site gave something its own page and its own name, the company
    sells it as its own thing and it belongs in the list under that name. This rule wins over the merge rules
    below. Do not fold a named page into a broader category you invented.
  - MERGE only things that are literally the same offer worded differently. "Home loans" and "Residential
    lending" pointing at the same page is ONE entry.
  - SPLIT things that plainly serve different buyers. First home buyer loans and commercial property finance are
    NOT the same offer, even though both are lending.
  - SPLIT BY CHANNEL AND BY PLATFORM where the site does. "Meta Ads", "Google Ads", "LinkedIn Ads" and "PPC" are
    four different offers bought by four different people for four different reasons — never collapse them into
    one "paid advertising" entry. The same goes for "Shopify SEO" versus "Magento SEO", and for organic social
    versus paid social.
  - GROUP EVERY ENTRY. Use the site's own menu headings when it has them — "Home loans", "Business & commercial",
    "SEO", "Paid advertising" — and invent a sensible heading when it does not. Thirty ungrouped rows is a wall of
    text nobody can pick from; the same thirty under six headings is a menu. Only use null if the site sells so
    few things that grouping would be silly.
  - Name each offer as a strategist would say it out loud, in the site's own vocabulary. Title case, no marketing
    adjectives, no trailing "services" unless the site always says it.
  - summary: one short line naming WHO buys this, in plain words — "people buying their first property",
    "owner-drivers financing a truck". Do NOT copy the page's marketing headline: "Get the Home Loan you
    Deserve" tells a strategist nothing about who is on the other end of it. No figures, no prices, no
    invented claims. If the page does not say who it is for, describe the offer plainly instead.
  - Order by how prominent the offer is on the site.
  - COMPLETENESS MATTERS MORE THAN BREVITY. The strategist picks from this list and cannot pick something you
    left out — a dropped offer is invisible to them, not merely unranked. Do not stop early because the list is
    getting long, and do not omit an offer because it resembles one you already listed. Return every distinct
    offer you can see, up to 50. A site with forty service pages sells forty things; say so.
  - If the site genuinely sells one thing, set is_single_service true and return that one entry.

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
    maxTokens: 4500,
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
    if (services.length >= 50) break;
  }

  return backfillFromNavigation(services, candidates);
}

/**
 * Put back anything the navigation named and the model did not return.
 *
 * The model is not a reliable enumerator. Two identical runs against the same
 * agency site returned 37 offers and 33, and "Social Media Marketing" was in
 * one and not the other — so which services a strategist could even see came
 * down to a coin flip. That is worse than a short list, because nothing about
 * the result says anything is missing.
 *
 * So the navigation decides what exists and the model decides what to call it.
 * Any candidate the site labelled with its own link text, and that nothing in
 * the returned catalogue covers, is appended under that label. Slightly
 * redundant entries are an acceptable price; a service the strategist never
 * learns about is not.
 */
function backfillFromNavigation(
  services: DiscoveredService[],
  candidates: Candidate[],
): DiscoveredService[] {
  const names = services.map((s) => normalise(s.name)).filter(Boolean);
  const urls = new Set(services.map((s) => (s.url ?? '').replace(/\/$/, '')).filter(Boolean));
  const slugs = new Set(services.map((s) => s.slug));

  const covers = (label: string) => {
    const key = normalise(label);
    if (!key) return true;
    // One name containing the other is the same offer worded longer:
    // "Local SEO" and "Local SEO Services". Two that merely overlap are not:
    // "Social Media Marketing" and "Organic Social Media Management".
    return names.some((name) => name === key || name.includes(key) || key.includes(name));
  };

  for (const candidate of candidates) {
    if (services.length >= 50) break;

    const label = candidate.anchorText.trim();
    if (label.length < 3 || label.length > 60) continue;
    // A sentence is body copy, not a menu item.
    if (label.split(/\s+/).length > 7) continue;
    if (isNotAService(label)) continue;
    // Only put back things that plainly name a service. Backfill exists to
    // recover offers the model dropped, not to pad the list with every link on
    // the page — and a padded list crowds out the recovery it was added for.
    if (!hasServiceToken(label) && !hasServiceToken(candidate.url)) continue;
    // "SEO Melbourne" and "SEO Perth" are one offer sold in two cities, not two
    // offers. The model collapses these correctly in its own output; without
    // this the backfill puts all eight of them straight back and they crowd out
    // the real offers this list is capped at.
    if (PLACE_NAME.test(label)) continue;
    // A bare nav parent — the "SERVICES" menu heading itself.
    if (SERVICE_TOKENS.has(normalise(label).replace(/\s+/g, ''))) continue;
    if (urls.has(candidate.url.replace(/\/$/, ''))) continue;
    if (covers(label)) continue;

    const slug = slugifyService(label);
    if (slugs.has(slug)) continue;

    slugs.add(slug);
    names.push(normalise(label));
    services.push({
      name: label,
      slug,
      group: null,
      summary: '',
      url: candidate.url,
    });
  }

  return services;
}
