/**
 * Offline self-test — no OpenAI key, no database.
 *
 * Covers the parts that must be right before a single token is spent: the
 * master prompt loads verbatim, the validator actually rejects thin sections,
 * the merge rules never downgrade a stated slot, the pricing guardrail holds,
 * and both exporters produce real files.
 *
 *   npm run selftest
 */
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

import { masterPrompt, masterPromptInfo, masterPromptVersion } from '../src/lib/master-prompt';
import { SECTIONS } from '../src/lib/sections';
import { countObjections, parseSections, spliceSection } from '../src/lib/markdown';
import { inspectDocument, reportFor } from '../src/lib/validate';
import { buildInputBlock, buildWhyFraming, type GenerationContext } from '../src/lib/generate';
import { buildAwarenessMapDocx, buildSingleDocx, coverInfoFrom, exportFilename } from '../src/lib/docx';
import { buildPdf } from '../src/lib/pdf';
import { comparisonToMarkdown, type ComparisonRow } from '../src/lib/comparison';
import {
  ALL_AWARENESS_KEYS,
  AWARENESS,
  DEFAULT_SCENARIOS,
  sortScenarios,
} from '../src/lib/awareness';
import { buildResolverUserMessage } from '../src/lib/resolve';
import { buildXlsx, flattenMarkdown, heightFor } from '../src/lib/xlsx';
import { SELECTABLE_FORMATS } from '../src/lib/export-service';
import { AUDIENCE_MODES, DEFAULT_AUDIENCE_MODE, isAudienceMode } from '../src/lib/settings-shared';
import {
  ASKABLE_SLOTS,
  PRICE_NOT_SPECIFIED,
  applyDocumentedDefaults,
  applyFallbacks,
  computeReadiness,
  MAX_ASKS_PER_SLOT,
  trackAsk,
  detectRegulated,
  mergeResolution,
  normaliseServices,
  priceLine,
  type SlotMeta,
  type SlotValues,
} from '../src/lib/slots';

/** A .docx is a zip; word/document.xml is the body. */
async function readDocxXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const parts = await Promise.all(
    ['word/document.xml', 'word/styles.xml'].map((name) => zip.file(name)?.async('string') ?? ''),
  );
  return parts.join('\n');
}

/** docx escapes text nodes; match what actually lands in the XML. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  \x1b[31m✗\x1b[0m ${name}${detail ? `\n      ${detail}` : ''}`);
  }
}

function section(title: string) {
  console.log(`\n\x1b[1m${title}\x1b[0m`);
}

// ---------------------------------------------------------------------------

section('Master prompt');

const prompt = masterPrompt();
const info = masterPromptInfo();

check('loads from disk', prompt.length > 10_000, `got ${prompt.length} chars`);
check('is the real master prompt', prompt.includes('buyer-psychology analyst'));
check('carries the pricing rule verbatim', prompt.includes('Do NOT invent pricing.'));
check('carries the non-mixing rule', prompt.includes('Non-mixing rule'));
check('carries the awareness calibration rules', prompt.includes('Awareness-level calibration rules'));
check('version is content-derived', /^v1\+[0-9a-f]{12}$/.test(masterPromptVersion()), masterPromptVersion());
check('reports where it loaded from', info.loadedFrom.includes('master_icp.md'), info.loadedFrom);

// The version must depend on the prompt's CONTENT, not on which operating
// system checked it out. A CRLF working copy on Windows and an LF checkout in
// the Linux container have to produce the same version for the same prompt,
// or every document stamped on Railway disagrees with every document stamped
// locally and the version tells you nothing.
check('loaded prompt carries no CR characters', !prompt.includes('\r'));
const hashOf = (s: string) =>
  createHash('sha256').update(s, 'utf8').digest('hex').slice(0, 12);
const asCrlf = prompt.replace(/\n/g, '\r\n');
check(
  'a CRLF checkout would hash identically',
  hashOf(asCrlf.replace(/\r\n/g, '\n')) === hashOf(prompt),
);
check(
  'the stored version matches the normalised content hash',
  masterPromptVersion() === `v1+${hashOf(prompt)}`,
  `${masterPromptVersion()} vs v1+${hashOf(prompt)}`,
);

// Every mandatory heading in the registry must exist in the prompt itself —
// this is what stops the section index silently drifting from the prompt.
const normalise = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');
const flatPrompt = normalise(prompt);
const missingHeadings = SECTIONS.filter((s) => {
  if (s.key === 'title_line') return false;
  const stem = normalise(s.heading).split(' (')[0];
  return !flatPrompt.includes(stem);
});
check(
  'every registry heading appears in the prompt',
  missingHeadings.length === 0,
  missingHeadings.map((s) => s.heading).join(', '),
);
check('registry has all 19 mandatory sections', SECTIONS.length === 19, `got ${SECTIONS.length}`);

// ---------------------------------------------------------------------------

section('Slot resolution rules');

const stated: SlotValues = { region: 'Melbourne, Australia', business_model: 'b2b' };
const statedMeta: SlotMeta = {
  region: { source: 'stated', confidence: 0.95 },
  business_model: { source: 'stated', confidence: 0.93 },
};

// An inference must never overwrite something the user actually said.
const downgrade = mergeResolution(
  stated,
  statedMeta,
  { region: 'Australia', business_model: 'b2c' },
  {
    region: { source: 'inferred', confidence: 0.5 },
    business_model: { source: 'inferred', confidence: 0.4 },
  },
);
check('inference cannot overwrite a stated slot', downgrade.slots.region === 'Melbourne, Australia');
check('inference cannot flip a stated business model', downgrade.slots.business_model === 'b2b');
check('no spurious change events', downgrade.changed.length === 0, downgrade.changed.join(','));

// A fresh explicit statement is a pivot and must land.
const pivot = mergeResolution(
  stated,
  statedMeta,
  { business_model: 'b2c', audience_type: 'clients_customer' },
  {
    business_model: { source: 'stated', confidence: 0.96 },
    audience_type: { source: 'stated', confidence: 0.96 },
  },
);
check('a stated pivot overrides a stated slot', pivot.slots.business_model === 'b2c');
check('pivot reports what changed', pivot.changed.includes('business_model'));

// A user edit outranks the next inference.
const edited = mergeResolution(
  { industry: 'Dental practices' },
  { industry: { source: 'stated', confidence: 1, editedByUser: true } },
  { industry: 'Healthcare' },
  { industry: { source: 'inferred', confidence: 0.9 } },
);
check('a user edit survives the next resolve', edited.slots.industry === 'Dental practices');

// Empty values never clobber real ones.
const blanked = mergeResolution(
  { company_name: 'Radius' },
  { company_name: { source: 'stated', confidence: 1 } },
  { company_name: null, region: '' },
  {},
);
check('nulls do not wipe resolved slots', blanked.slots.company_name === 'Radius');

check('services are capped at three', normaliseServices([
  { name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' },
]).length === 3);
check('duplicate services collapse', normaliseServices([
  { name: 'SEO' }, { name: 'seo' },
]).length === 1);

const defaulted = applyDocumentedDefaults({}, {});
check('audience type defaults to direct buyer', defaulted.slots.audience_type === 'direct_buyer');
check('the default is flagged as a default', defaulted.meta.audience_type?.source === 'default');

// ---------------------------------------------------------------------------

section('Readiness and the awareness gate');

const nearlyDone: SlotValues = {
  company_name: 'Radius',
  company_type: 'agency',
  audience_type: 'direct_buyer',
  maturity_tier: 'intermediate',
  industry: 'Dental practices',
  services: [{ name: 'Dental SEO', price_terms: '$2,500/month retainer' }],
  region: 'Melbourne, Australia',
  business_model: 'b2b',
};

const readiness = computeReadiness(nearlyDone, {});
check('brief with every required slot is complete', readiness.briefComplete, readiness.missingRequired.join(','));
check('awareness alone blocks generation via the modal', readiness.needsAwarenessModal);
check('website is not required to generate', !readiness.missingRequired.includes('website_url'));
check('audience type is never asked in prose', readiness.nextAsk !== 'audience_type');
check('awareness is never asked in prose', readiness.nextAsk !== 'awareness_level');

const settled = computeReadiness({ ...nearlyDone, awareness_level: 'product_aware' }, {});
check('awareness settled in chat skips the modal', !settled.needsAwarenessModal);

// A deflected slot is never queued again.
const deflected = computeReadiness({ ...nearlyDone, maturity_tier: null }, {}, {
  askedAndDeflected: ['maturity_tier'],
});
check('a deflected question is never re-asked', deflected.nextAsk !== 'maturity_tier');

// Maturity is asked once before anything is assumed — a required choose-one
// with no documented default must not be silently filled in.
const noMaturity = { ...nearlyDone, maturity_tier: null };
check(
  'maturity is asked, not silently defaulted',
  applyDocumentedDefaults(noMaturity, {}).slots.maturity_tier == null,
);
check(
  'maturity is queued as a question',
  computeReadiness(applyDocumentedDefaults(noMaturity, {}).slots, {}).nextAsk === 'maturity_tier',
);
check(
  'a deflection lands maturity on intermediate',
  applyFallbacks(noMaturity, {}, ['maturity_tier']).slots.maturity_tier === 'intermediate',
);
check(
  'the assumption is recorded as one',
  applyFallbacks(noMaturity, {}, ['maturity_tier']).meta.maturity_tier?.source === 'default',
);
check(
  'fallbacks never overwrite a real answer',
  applyFallbacks(nearlyDone, {}, ['maturity_tier']).slots.maturity_tier === 'intermediate' &&
    applyFallbacks({ ...nearlyDone, maturity_tier: 'advanced' }, {}, ['maturity_tier']).slots
      .maturity_tier === 'advanced',
);

// ---------------------------------------------------------------------------
// The repeated-question bug.
//
// Observed in the wild: the bot asked "are these established homeowners who've
// dealt with plumbing issues before?" three times in a row, including twice
// AFTER the user answered it directly. The deflection regex never fired because
// the user was not deflecting — they were answering, and the resolver simply
// failed to map their words onto maturity_tier. Nothing counted the asks, so it
// looped. These checks make that impossible by construction.
// ---------------------------------------------------------------------------

const noMaturityBrief: SlotValues = { ...nearlyDone, maturity_tier: null };

// Turn 1: asked, not answered. One retry is allowed.
const strike1 = trackAsk({ lastAskedSlot: 'maturity_tier', lastAskedCount: 0 }, noMaturityBrief);
check('an unanswered question earns one retry', strike1.freeze.length === 0 && strike1.strikes === 1);
check('the retry is flagged so it is asked differently', strike1.isRetry);

// Turn 2: asked again, still not resolved. Now it is frozen for good.
const strike2 = trackAsk({ lastAskedSlot: 'maturity_tier', lastAskedCount: 1 }, noMaturityBrief);
check('a second failure freezes the slot permanently', strike2.freeze.includes('maturity_tier'));
check('a frozen slot is not also flagged as a retry', !strike2.isRetry);
check(
  'the frozen slot can never be queued again',
  computeReadiness(noMaturityBrief, {}, { askedAndDeflected: strike2.freeze }).nextAsk !==
    'maturity_tier',
);
check(
  'and it lands on a flagged assumption instead of blocking',
  applyFallbacks(noMaturityBrief, {}, strike2.freeze).slots.maturity_tier === 'intermediate',
);

// The counter must reset the moment an answer lands, or unrelated later
// questions inherit strikes they did not earn.
const landed = trackAsk({ lastAskedSlot: 'maturity_tier', lastAskedCount: 1 }, nearlyDone);
check('a landed answer clears the counter', landed.strikes === 0 && landed.freeze.length === 0);

// An explicit "I don't know" skips the retry and freezes immediately.
const dodged = trackAsk({ lastAskedSlot: 'maturity_tier', lastAskedCount: 0 }, noMaturityBrief, {
  deflected: true,
});
check('an explicit deflection freezes on the first strike', dodged.freeze.includes('maturity_tier'));

check('no slot is ever asked more than twice', MAX_ASKS_PER_SLOT === 2);
check(
  'nothing to track when no question was asked',
  trackAsk({ lastAskedSlot: null, lastAskedCount: 0 }, {}).freeze.length === 0,
);

// The resolver must be told which slot the last question targeted — without it,
// "established homeowners who've dealt with this before" is ambiguous prose.
const withHint = buildResolverUserMessage({
  runId: 't', history: [{ role: 'user', content: 'established homeowners' }],
  currentSlots: {}, lastAskedSlot: 'maturity_tier',
});
const withoutHint = buildResolverUserMessage({
  runId: 't', history: [{ role: 'user', content: 'established homeowners' }], currentSlots: {},
});
check('the resolver is told which slot the reply answers', withHint.includes('maturity_tier'));
check('and told not to leave a directly-answered slot null', withHint.includes('asked again'));
check('no hint is injected when nothing was asked', !withoutHint.includes('LAST QUESTION WAS AIMED AT'));

// The website is requested in the opening turn and never chased after that.
const bareBrief = computeReadiness(
  { industry: 'Dental practices', business_model: 'b2b', region: 'Melbourne', services: [{ name: 'SEO' }] },
  {},
);
check('website is never chased in prose', bareBrief.nextAsk !== 'website_url', String(bareBrief.nextAsk));
check(
  'no optional slot is ever queued as a question',
  !ASKABLE_SLOTS.some((k) => ['offer_type', 'size_band', 'notes', 'website_url', 'awareness_level', 'audience_type'].includes(k)),
  ASKABLE_SLOTS.join(','),
);

// Worst case: a bare "help me build an ICP" reaches a complete brief within the
// turn budget, with website skipped rather than blocking.
let simSlots: SlotValues = {};
let turns = 0;
const answers: Record<string, unknown> = {
  industry: 'Dental practices',
  business_model: 'b2b',
  region: 'Melbourne, Australia',
  services: [{ name: 'Dental SEO', price_terms: null }],
  company_type: 'agency',
  company_name: 'Radius',
  maturity_tier: 'intermediate',
};
const simDeflected: string[] = [];
while (turns < 12) {
  const applied = applyDocumentedDefaults(simSlots, {});
  simSlots = applied.slots;
  const r = computeReadiness(simSlots, {}, { askedAndDeflected: simDeflected as never });
  if (r.briefComplete) break;
  if (!r.nextAsk) break;
  turns++;
  const answer = answers[r.nextAsk];
  if (answer === null || answer === undefined) simDeflected.push(r.nextAsk);
  else (simSlots as Record<string, unknown>)[r.nextAsk] = answer;
}
check(
  'a bare start reaches a complete brief in under 8 questions',
  turns < 8 && computeReadiness(simSlots, {}).briefComplete,
  `${turns} questions, complete=${computeReadiness(simSlots, {}).briefComplete}`,
);

// ---------------------------------------------------------------------------

section('Awareness scenarios');

// There is no stage picker any more — every run builds the same four. The
// answer to "which stages?" was always "all of them", and the value of the
// deliverable is the contrast between them.
check('every run builds exactly four stages', DEFAULT_SCENARIOS.length === 4, DEFAULT_SCENARIOS.join(','));
check(
  'they are in canonical order, unaware first',
  DEFAULT_SCENARIOS[0] === 'unaware' && DEFAULT_SCENARIOS[3] === 'product_aware',
  DEFAULT_SCENARIOS.join(','),
);
check(
  'the set is sorted by canonical rank',
  JSON.stringify(sortScenarios(DEFAULT_SCENARIOS)) === JSON.stringify(DEFAULT_SCENARIOS),
);
check(
  'Most Aware is deliberately excluded',
  !DEFAULT_SCENARIOS.includes('most_aware') && ALL_AWARENESS_KEYS.includes('most_aware'),
);
check('no duplicates', new Set(DEFAULT_SCENARIOS).size === DEFAULT_SCENARIOS.length);

check(
  'labels match the master prompt wording exactly',
  AWARENESS.problem_aware.label === 'Only Problem-Aware' &&
    AWARENESS.solution_aware.label === 'Only Solution-Aware' &&
    AWARENESS.product_aware.label === 'Product/Service-Aware' &&
    AWARENESS.most_aware.label === 'Most Aware' &&
    AWARENESS.unaware.label === 'Unaware',
);
check(
  'every awareness label appears verbatim in the prompt',
  Object.values(AWARENESS).every((a) => prompt.includes(a.label)),
);

// ---------------------------------------------------------------------------

section('Pricing guardrail');

check(
  'a blank price becomes the mandated sentence',
  priceLine({ name: 'SEO', price_terms: null }) === PRICE_NOT_SPECIFIED,
);
check(
  'the mandated sentence is the prompt’s own wording',
  prompt.includes('Price/terms: not specified (quote/assessment required)'),
);
check(
  'a stated price passes through verbatim',
  priceLine({ name: 'SEO', price_terms: '$2,500/month' }) === 'Price/terms: $2,500/month',
);

const ctxNoPrice: GenerationContext = {
  runId: 'test',
  slots: { ...nearlyDone, services: [{ name: 'Dental SEO', price_terms: null }] },
  service: { name: 'Dental SEO', price_terms: null },
  scenario: 'problem_aware',
  whyFraming: 'test',
};

const blockNoPrice = buildInputBlock(ctxNoPrice);
check('payload never contains a blank price field', !/Price\/terms:\s*$/m.test(blockNoPrice));
check('payload carries the not-specified sentence', blockNoPrice.includes(PRICE_NOT_SPECIFIED));
check(
  'payload has no currency figure when none was given',
  !/[$£€]\s?\d/.test(blockNoPrice),
  blockNoPrice.match(/[$£€]\s?\d[^\n]*/)?.[0],
);

// ---------------------------------------------------------------------------

section('Generation payload');

const ctx: GenerationContext = {
  runId: 'test',
  slots: nearlyDone,
  service: { name: 'Dental SEO', price_terms: '$2,500/month retainer' },
  scenario: 'problem_aware',
  whyFraming: 'test',
};
const block = buildInputBlock(ctx);

check('uses the prompt’s own input names', block.includes('Audience Type (ICP Orientation):'));
check('maps company type to prompt wording', block.includes('Marketing agency / Service provider'));
check('maps audience type to prompt wording', block.includes('Direct Buyer of the Offer (Default)'));
check('maps business model to prompt wording', block.includes('B2B (Business Buyer/Partner)'));
check('maps maturity to prompt wording', block.includes('Intermediate (growing, some systems'));
check('sends the exact awareness wording', block.includes('Awareness level to generate: Only Problem-Aware'));

const audienceCount = (block.match(/^Audience Type \(ICP Orientation\):/gm) ?? []).length;
check('exactly one audience type per call', audienceCount === 1, `found ${audienceCount}`);

check(
  'why-framing quotes the user',
  buildWhyFraming(nearlyDone, 'I run a dental SEO agency in Melbourne').includes('In their own words'),
);

const regulated = detectRegulated(nearlyDone);
check('dental is detected as regulated', regulated.regulated && regulated.reason === 'dental');
check(
  'plain retail is not flagged',
  !detectRegulated({ industry: 'Mattress retail', services: [{ name: 'Mattresses' }] }).regulated,
);
check(
  'finance is detected as regulated',
  detectRegulated({ industry: 'Mortgage broking' }).regulated,
);

// ---------------------------------------------------------------------------

section('Validator');

/**
 * Narrative sections are enumerated points now, so the fixture must be too —
 * a prose fixture would be testing a shape the product no longer produces.
 */
function makeSection(heading: string, words: number, level = 2): string {
  const points = 5;
  const per = Math.ceil(words / points);
  const body = Array.from(
    { length: points },
    (p, index) =>
      `${index + 1}. ` +
      Array.from({ length: per }, (_, i) => `w${index}x${i}`).join(' '),
  ).join('\n');
  return `${'#'.repeat(level)} ${heading}\n\n${body}\n`;
}

/** The same section as an undifferentiated block of prose. */
function makeProseSection(heading: string, words: number, level = 2): string {
  const body = Array.from({ length: words }, (_, i) => `word${i}`).join(' ');
  return `${'#'.repeat(level)} ${heading}\n\n${body}\n`;
}

const objections = Array.from(
  { length: 8 },
  (_, i) => `${i + 1}. "Objection number ${i + 1} here in their own voice."\n   What it really means: the hidden meaning behind objection ${i + 1}, spelled out at length.`,
).join('\n');

const checklist = Array.from({ length: 10 }, (_, i) => `${i + 1}. Qualifier number ${i + 1}?`).join('\n');

const stories = ['alpha', 'beta', 'gamma']
  .map((n) => `**${n} practice** — ${Array.from({ length: 60 }, (_, i) => `s${i}`).join(' ')}`)
  .join('\n\n');

const goodDoc = [
  '# ICP (Only Problem-Aware) — Radius | Dental SEO | $2,500/month | B2B | Melbourne | Agency | Direct Buyer | Intermediate',
  '',
  '## Avatar Name\n\nSarah Whitfield — "The Stretched Principal"',
  '## Local language & jargon applied\n\nMelbourne, Australia + Dental practices',
  makeSection('Identity Snapshot', 150),
  makeSection("Current Reality (What's happening right now)", 150),
  makeSection('What They Say Out Loud', 150),
  makeSection("What's Actually True Under the Hood", 150),
  makeSection('Goals and Desired Outcomes', 150),
  makeSection('Pains, Fears, and Risks', 150),
  makeSection('Marketing Problems They Face', 180),
  makeSection("Barriers and Uncertainties (Why they're stuck)", 150),
  makeSection('Triggers That Move Them to the Next Level', 150),
  makeSection('Decision Criteria (How they choose)', 150),
  makeSection('How They Research (Channels + behavior)', 150),
  `## Objections (Top 8) + What It Really Means\n\n${objections}`,
  makeSection('Market Opportunities and Positioning', 150),
  `## Success Stories\n\n${stories}`,
  makeSection('Average Deal Value of the Service', 100),
  `## Qualification Checklist (Fast filters)\n\n${checklist}`,
].join('\n\n');

const goodReport = inspectDocument(goodDoc);
const goodFailures = goodReport.filter((r) => r.status !== 'ok');
check(
  'a complete document passes every section',
  goodFailures.length === 0,
  goodFailures.map((r) => `${r.heading}=${r.status}(${r.words}w${r.count !== undefined ? `,n=${r.count}` : ''})`).join(' | '),
);
check('reportFor agrees', reportFor(goodDoc).badge === 'complete');

// Thin narrative must be caught.
const thinDoc = goodDoc.replace(
  makeSection('Market Opportunities and Positioning', 150),
  makeSection('Market Opportunities and Positioning', 20),
);
const thinReport = inspectDocument(thinDoc);
check(
  'a thin section is caught',
  thinReport.find((r) => r.key === 'market_opportunities')?.status === 'thin',
);

// Seven objections must be caught. "Exactly 8" has to mean 8.
const sevenObjections = Array.from(
  { length: 7 },
  (_, i) => `${i + 1}. "Objection ${i + 1}."\n   What it really means: hidden meaning ${i + 1} explained fully here.`,
).join('\n');
const wrongCountDoc = goodDoc.replace(objections, sevenObjections);
const wrongCountReport = inspectDocument(wrongCountDoc);
const objReport = wrongCountReport.find((r) => r.key === 'objections');
check('seven objections is a failure', objReport?.status === 'wrong_count', `count=${objReport?.count}`);
check('objection counting is exact', countObjections(objections) === 8, String(countObjections(objections)));

// A missing section must be caught.
const missingDoc = goodDoc.replace(/## Success Stories[\s\S]*?(?=## Average Deal Value)/, '');
check(
  'a missing section is caught',
  inspectDocument(missingDoc).find((r) => r.key === 'success_stories')?.status === 'missing',
);

// ---------------------------------------------------------------------------
// Enumerated sections.
//
// Every section that used to be a wall of prose is now numbered points. The
// risk this guards is content loss: a model told to "use points" can treat
// that as permission to compress. Shape is therefore checked, but is never
// allowed to fail a document on its own.
// ---------------------------------------------------------------------------

check(
  'fourteen sections are enumerated',
  SECTIONS.filter((s) => s.numbered).length === 14,
  String(SECTIONS.filter((s) => s.numbered).length),
);
check(
  'the five fixed-structure sections are left alone',
  SECTIONS.filter((s) => !s.numbered).map((s) => s.key).sort().join(',') ===
    'avatar_name,jargon_line,objections,qualification_checklist,title_line',
  SECTIONS.filter((s) => !s.numbered).map((s) => s.key).sort().join(','),
);

// A long section written as prose is the wrong shape, not a bad section.
const proseDoc = goodDoc.replace(
  makeSection('Market Opportunities and Positioning', 150),
  makeProseSection('Market Opportunities and Positioning', 150),
);
const proseReport = inspectDocument(proseDoc);
check(
  'prose in an enumerated section is flagged',
  proseReport.find((r) => r.key === 'market_opportunities')?.status === 'unformatted',
  proseReport.find((r) => r.key === 'market_opportunities')?.status,
);
check(
  'but shape alone never fails the document',
  reportFor(proseDoc).badge === 'complete',
  reportFor(proseDoc).badge,
);
check(
  'and it is never reported to the user',
  reportFor(proseDoc).failedKeys.length === 0,
);

// Substance still outranks shape: a short section is thin, not merely unformatted.
const shortProse = goodDoc.replace(
  makeSection('Triggers That Move Them to the Next Level', 150),
  makeProseSection('Triggers That Move Them to the Next Level', 20),
);
check(
  'too-short still reports as thin, not unformatted',
  inspectDocument(shortProse).find((r) => r.key === 'triggers')?.status === 'thin',
);

// Enumerated sections report how many points they carry.
const pointCount = inspectDocument(goodDoc).find((r) => r.key === 'goals')?.count;
check('enumerated sections report their point count', pointCount === 5, String(pointCount));

// The fixed-structure sections must not have been disturbed.
check(
  'objections still require exactly eight',
  inspectDocument(goodDoc).find((r) => r.key === 'objections')?.count === 8,
);
check(
  'the checklist still requires 8-12',
  inspectDocument(goodDoc).find((r) => r.key === 'qualification_checklist')?.count === 10,
);
// ---------------------------------------------------------------------------
// Severity. A cosmetic shortfall must never reach the user.
//
// Reported from a live session: a document showed "These sections are still
// below standard after one repair pass: title_line". The document was fine —
// the title merely formatted differently — and the message was internal jargon
// pointed at a strategist who could do nothing with it.
// ---------------------------------------------------------------------------

check(
  'exactly the three furniture sections are cosmetic',
  SECTIONS.filter((s) => s.severity === 'cosmetic')
    .map((s) => s.key)
    .sort()
    .join(',') === 'avatar_name,jargon_line,title_line',
);
check(
  'every section carrying substance is critical',
  SECTIONS.filter((s) => s.severity === 'critical').length === 16,
  String(SECTIONS.filter((s) => s.severity === 'critical').length),
);

// The exact shape that produced the complaint: a "Title Line" heading with the
// pipe-separated detail in the body rather than in the heading itself.
const titleInBody = goodDoc.replace(
  '# ICP (Only Problem-Aware) — Radius | Dental SEO | $2,500/month | B2B | Melbourne | Agency | Direct Buyer | Intermediate',
  '# Title Line\n\nICP (Only Problem-Aware) — Radius | Dental SEO | $2,500/month | B2B | Melbourne',
);
check(
  'a title line in the body is not a failure',
  inspectDocument(titleInBody).find((r) => r.key === 'title_line')?.status === 'ok',
  inspectDocument(titleInBody).find((r) => r.key === 'title_line')?.status,
);
check('and the document still reads as complete', reportFor(titleInBody).badge === 'complete');

// Too many checklist items must be caught.
const longChecklist = Array.from({ length: 15 }, (_, i) => `${i + 1}. Qualifier ${i + 1}?`).join('\n');
check(
  'fifteen qualifiers is a failure',
  inspectDocument(goodDoc.replace(checklist, longChecklist)).find(
    (r) => r.key === 'qualification_checklist',
  )?.status === 'wrong_count',
);

// ---------------------------------------------------------------------------

section('Markdown parsing and splicing');

const parsed = parseSections(goodDoc);
check('every section is recognised', parsed.filter((s) => s.key).length === 19, `${parsed.filter((s) => s.key).length}/19`);
check('the title line parses as level 1', parsed[0].level === 1 && parsed[0].key === 'title_line');
check('anchors are unique', new Set(parsed.map((s) => s.anchor)).size === parsed.length);

const target = parsed.find((s) => s.key === 'market_opportunities')!;
const spliced = spliceSection(goodDoc, target, 'Replacement body text for this section.');
check('splice inserts the new body', spliced.includes('Replacement body text for this section.'));
check('splice keeps the heading', spliced.includes('## Market Opportunities and Positioning'));
check('splice preserves neighbouring sections', spliced.includes('## Success Stories'));
check(
  'splice keeps the document parseable',
  parseSections(spliced).filter((s) => s.key).length === 19,
);
check(
  'splice does not duplicate the section',
  (spliced.match(/## Market Opportunities and Positioning/g) ?? []).length === 1,
);

// Curly quotes and heading drift must still match.
const curly = parseSections(
  "## Barriers and Uncertainties (Why they’re stuck)\n\nbody\n\n## What’s Actually True Under the Hood\n\nbody",
);
check('curly apostrophes still match headings', curly.every((s) => s.key !== null));

// ---------------------------------------------------------------------------

section('Exports');

const cover = coverInfoFrom(nearlyDone, {
  serviceName: 'Dental SEO',
  scenarioLabel: 'Only Problem-Aware',
  masterPromptVersion: masterPromptVersion(),
  title: 'Radius',
  subtitle: 'Dental SEO · Melbourne, Australia',
});

const docxBuffer = await buildSingleDocx({ markdown: goodDoc, cover });
check('DOCX builds', docxBuffer.length > 8000, `${docxBuffer.length} bytes`);
check('DOCX is a real zip container', docxBuffer.subarray(0, 2).toString('binary') === 'PK');

const rows: ComparisonRow[] = (['unaware', 'problem_aware', 'solution_aware', 'product_aware'] as const).map(
  (scenario) => ({
    scenario,
    awarenessLabel: AWARENESS[scenario].label,
    dominantBelief: `belief for ${scenario}`,
    messageThatLands: `lands for ${scenario}`,
    messageThatBackfires: `backfires for ${scenario}`,
    bestChannel: `channel for ${scenario}`,
    primaryObjection: `objection for ${scenario}`,
  }),
);

const mapBuffer = await buildAwarenessMapDocx({
  cover,
  comparison: { rows, serviceName: 'Dental SEO' },
  chapters: (['unaware', 'problem_aware', 'solution_aware', 'product_aware'] as const).map((scenario) => ({
    scenario,
    markdown: goodDoc,
    badge: 'complete',
  })),
});
check('awareness map DOCX builds', mapBuffer.subarray(0, 2).toString('binary') === 'PK');
check('awareness map is larger than a single scenario', mapBuffer.length > docxBuffer.length);

// Look inside the container rather than trusting a byte count — DOCX is a zip,
// and four near-identical chapters compress away to almost nothing.
const mapXml = await readDocxXml(mapBuffer);
check(
  'map contains a chapter per awareness stage',
  (['Unaware', 'Only Problem-Aware', 'Only Solution-Aware', 'Product/Service-Aware'] as const).every(
    (label) => mapXml.includes(escapeXml(label)),
  ),
);
check('map contains the comparison table', mapXml.includes('<w:tbl>'));
check('map contains every comparison row', rows.every((r) => mapXml.includes(escapeXml(r.dominantBelief))));
check('map has a table-of-contents field', mapXml.includes('TOC'));
check('map uses real Word heading styles', mapXml.includes('Heading1') && mapXml.includes('Heading2'));
check('map stamps the master prompt version', mapXml.includes(escapeXml(masterPromptVersion())));

const singleXml = await readDocxXml(docxBuffer);
check('single scenario uses real Word heading styles', singleXml.includes('Heading1'));
check(
  'single scenario cover carries every required field',
  ['COMPANY', 'OFFER', 'REGION', 'AUDIENCE TYPE', 'MATURITY TIER', 'SCENARIO', 'GENERATED'].every((f) =>
    singleXml.includes(f),
  ),
);
check(
  'single scenario carries every mandatory heading',
  SECTIONS.slice(1).every((s) => singleXml.includes(escapeXml(s.heading))),
  SECTIONS.slice(1).filter((s) => !singleXml.includes(escapeXml(s.heading))).map((s) => s.heading).join(', '),
);

const pdfBuffer = await buildPdf({ markdown: goodDoc, cover });
check('PDF builds without Chromium', pdfBuffer.length > 3000, `${pdfBuffer.length} bytes`);
check('PDF has a valid header', pdfBuffer.subarray(0, 5).toString('binary') === '%PDF-');

check(
  'filename follows the required pattern',
  /^radius-problem-aware-\d{8}\.docx$/.test(exportFilename('Radius', 'Problem-Aware', 'docx')),
  exportFilename('Radius', 'Problem-Aware', 'docx'),
);
check(
  'filenames survive awkward company names',
  /^dot-mappers-co-unaware-\d{8}\.docx$/.test(exportFilename(')(DOT MAPPERS & Co.', 'Unaware', 'docx')),
  exportFilename(')(DOT MAPPERS & Co.', 'Unaware', 'docx'),
);

const comparisonMd = comparisonToMarkdown(rows, 'Dental SEO');
check('comparison markdown has a header row', comparisonMd.includes('| Awareness stage |'));
check('comparison markdown has one row per scenario', comparisonMd.split('\n').filter((l) => l.startsWith('| ')).length === 6);

// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------

section('Audience mode');

check('two modes, strategist and client', AUDIENCE_MODES.map((m) => m.key).join(',') === 'strategist,client');
check('strategist is the default', DEFAULT_AUDIENCE_MODE === 'strategist');
check('every mode carries a label and a blurb', AUDIENCE_MODES.every((m) => m.label && m.blurb.length > 20));
check('the guard rejects anything else', !isAudienceMode('inhouse') && !isAudienceMode('') && !isAudienceMode(null));
check('and accepts both real modes', isAudienceMode('strategist') && isAudienceMode('client'));

// ---------------------------------------------------------------------------

section('Excel export');

check('the picker offers PDF and Excel only', SELECTABLE_FORMATS.join(',') === 'pdf,xlsx');

// Row height is the whole difficulty: Excel will not auto-fit a wrapped cell
// written programmatically, so a long section renders as an empty-looking sliver
// unless every row is measured and given an explicit height.
const shortHeight = heightFor('Melbourne, Australia');
const longHeight = heightFor('word '.repeat(400));
check('a one-line value gets a compact row', shortHeight <= 26, String(shortHeight));
const wrapHeight = heightFor('word '.repeat(40));
check('a value that wraps gets extra room', wrapHeight > shortHeight * 1.5, String(wrapHeight));
check('a long section gets a much taller row', longHeight > shortHeight * 4, `${shortHeight} vs ${longHeight}`);
check('no row exceeds Excel’s 409pt ceiling', heightFor('x '.repeat(50_000)) <= 409);
check('an empty value still gets a usable height', heightFor('') >= 20);
check(
  'height scales with content, not just presence',
  heightFor('word '.repeat(60)) > heightFor('word '.repeat(20)),
);
check(
  'explicit newlines each claim a line',
  heightFor('a\nb\nc\nd\ne\nf') > heightFor('a'),
);

check('markdown is flattened for cells', !flattenMarkdown('## Heading\n\n**bold** and *ital*').includes('#'));
check('bullets survive as readable markers', flattenMarkdown('- one\n- two').includes('•'));

const xlsxBuffer = await buildXlsx({
  markdown: goodDoc,
  slots: nearlyDone,
  serviceName: 'Dental SEO',
  service: { name: 'Dental SEO', price_terms: '$2,500/month retainer' },
  awarenessLabel: 'Only Problem-Aware',
  masterPromptVersion: masterPromptVersion(),
  generatedAt: new Date(1767225600000),
  badge: 'complete',
});
check('XLSX builds', xlsxBuffer.length > 5000, `${xlsxBuffer.length} bytes`);
check('XLSX is a real zip container', xlsxBuffer.subarray(0, 2).toString('binary') === 'PK');

// Look inside rather than trusting a byte count.
const xlsxZip = await JSZip.loadAsync(xlsxBuffer);
const sheetXml = (await xlsxZip.file('xl/worksheets/sheet1.xml')?.async('string')) ?? '';
const sharedStrings = (await xlsxZip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
const allText = sheetXml + sharedStrings;

check('sheet carries the brief labels', ['Company name', 'Industry', 'Region', 'Price / terms'].every((l) => allText.includes(l)));
check('sheet carries every mandatory section heading', SECTIONS.slice(1).every((s) => allText.includes(escapeXml(s.heading))),
  SECTIONS.slice(1).filter((s) => !allText.includes(escapeXml(s.heading))).map((s) => s.heading).join(', '));
check('sheet carries the stated price verbatim', allText.includes('$2,500/month retainer'));
check('sheet records the master prompt version', allText.includes(masterPromptVersion()));
check('rows carry explicit heights', /customHeight="1"/.test(sheetXml) || /ht="/.test(sheetXml));
check('value cells wrap', /wrapText="1"/.test((await xlsxZip.file('xl/styles.xml')?.async('string')) ?? ''));

// The pricing guardrail must hold in Excel too.
const xlsxNoPrice = await buildXlsx({
  markdown: goodDoc,
  slots: { ...nearlyDone, services: [{ name: 'Dental SEO', price_terms: null }] },
  serviceName: 'Dental SEO',
  service: { name: 'Dental SEO', price_terms: null },
  awarenessLabel: 'Unaware',
  masterPromptVersion: masterPromptVersion(),
  generatedAt: new Date(1767225600000),
  badge: 'complete',
});
const noPriceZip = await JSZip.loadAsync(xlsxNoPrice);
const noPriceText =
  ((await noPriceZip.file('xl/worksheets/sheet1.xml')?.async('string')) ?? '') +
  ((await noPriceZip.file('xl/sharedStrings.xml')?.async('string')) ?? '');
check('a blank price says so rather than inventing one', noPriceText.includes('quote/assessment required'));

// ---------------------------------------------------------------------------
// Tally last, so a failure in ANY section above actually fails the run.

console.log(
  `\n\x1b[1m${failed === 0 ? '\x1b[32mAll checks passed' : '\x1b[31mFailures'}\x1b[0m  ${passed} passed, ${failed} failed\n`,
);
if (failed > 0) {
  console.log('Failed:\n' + failures.map((f) => `  - ${f}`).join('\n') + '\n');
  process.exit(1);
}
