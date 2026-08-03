/**
 * Run orchestration: loading, serialising and invalidating.
 *
 * Conversation state is persisted per run on every turn, so a refresh mid-brief
 * or a redeploy mid-generation loses nothing.
 */
import 'server-only';
import { prisma } from './db';
import { masterPromptVersion } from './master-prompt';
import { markdownToPlainText } from './markdown';
import { toSummary } from './industry';
import { awarenessLabel, type AwarenessKey } from './awareness';
import {
  computeReadiness,
  detectRegulated,
  isEmptySlot,
  slotDisplayValue,
  type SlotKey,
  type SlotMeta,
  type SlotValues,
} from './slots';
import type {
  ComparisonSummary,
  DocumentDetail,
  DocumentStatus,
  DocumentSummary,
  RunListItem,
  RunState,
} from './types';
import type { ComparisonRow } from './compare';
import type { SectionReport } from './sections';

type RunRecord = Awaited<ReturnType<typeof prisma.run.findUnique>>;

export async function createRun(): Promise<string> {
  const run = await prisma.run.create({
    data: { masterPromptVersion: masterPromptVersion() },
  });
  return run.id;
}

export async function loadRun(runId: string) {
  return prisma.run.findUnique({
    where: { id: runId },
    include: {
      industryPack: true,
      messages: { orderBy: { seq: 'asc' } },
      documents: { orderBy: [{ serviceIndex: 'asc' }, { createdAt: 'asc' }] },
      comparisons: { orderBy: { serviceIndex: 'asc' } },
    },
  });
}

export type LoadedRun = NonNullable<Awaited<ReturnType<typeof loadRun>>>;

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

export function slotsOf(run: { slots: unknown }): SlotValues {
  return (run.slots as SlotValues) ?? {};
}

export function metaOf(run: { slotMeta: unknown }): SlotMeta {
  return (run.slotMeta as SlotMeta) ?? {};
}

/**
 * Slots the conversation asked about and did not pin down. Derived from the
 * stored ambiguities so the bot never re-asks a question the user dodged, even
 * across a page refresh.
 */
export function deflectedSlots(run: { ambiguities: unknown }): SlotKey[] {
  const list = (run.ambiguities as string[]) ?? [];
  const keys: SlotKey[] = [];
  for (const entry of list) {
    const match = entry.match(/^deflected:([a-z_]+)$/);
    if (match) keys.push(match[1] as SlotKey);
  }
  return keys;
}

export function visibleAmbiguities(run: { ambiguities: unknown }): string[] {
  const list = (run.ambiguities as string[]) ?? [];
  return list.filter((entry) => !entry.startsWith('deflected:'));
}

export function serialiseDocument(doc: LoadedRun['documents'][number]): DocumentSummary {
  return {
    id: doc.id,
    serviceIndex: doc.serviceIndex,
    serviceName: doc.serviceName,
    scenario: doc.scenario as AwarenessKey,
    awarenessLabel: doc.awarenessLabel,
    status: doc.status as DocumentStatus,
    badge: (doc.badge as DocumentSummary['badge']) ?? null,
    wordCount: doc.markdown ? markdownToPlainText(doc.markdown).split(/\s+/).filter(Boolean).length : 0,
    errorMessage: doc.errorMessage,
    masterPromptVersion: doc.masterPromptVersion,
    updatedAt: doc.updatedAt.toISOString(),
  };
}

export function serialiseDocumentDetail(doc: LoadedRun['documents'][number]): DocumentDetail {
  return {
    ...serialiseDocument(doc),
    markdown: doc.markdown,
    validation: (doc.validation as { sections: SectionReport[] } | null) ?? null,
  };
}

export function serialiseComparison(row: LoadedRun['comparisons'][number]): ComparisonSummary {
  return {
    serviceIndex: row.serviceIndex,
    serviceName: row.serviceName,
    rows: (row.rows as unknown as ComparisonRow[]) ?? [],
    markdown: row.markdown,
  };
}

export function serialiseRun(run: LoadedRun): RunState {
  const slots = slotsOf(run);
  const meta = metaOf(run);
  const readiness = computeReadiness(slots, meta, { askedAndDeflected: deflectedSlots(run) });

  return {
    id: run.id,
    title: run.title,
    slots,
    slotMeta: meta,
    missing: ((run.missing as string[]) ?? []) as SlotKey[],
    ambiguities: visibleAmbiguities(run),
    readiness: {
      briefComplete: readiness.briefComplete,
      awarenessResolved: readiness.awarenessResolved,
      needsAwarenessModal: readiness.needsAwarenessModal && !run.awarenessModalAnswered,
      readyToGenerate: readiness.readyToGenerate,
      missingRequired: readiness.missingRequired,
      lowConfidence: readiness.lowConfidence,
    },
    regulated: run.regulated,
    regulatedReason: run.regulatedReason,
    industryPack: run.industryPack ? toSummary(run.industryPack) : null,
    siteFetchStatus: run.siteFetchStatus,
    siteFetchedUrl: run.siteFetchedUrl,
    masterPromptVersion: run.masterPromptVersion,
    awarenessModalAnswered: run.awarenessModalAnswered,
    awarenessResolvedInChat: run.awarenessResolvedInChat,
    documents: run.documents.map(serialiseDocument),
    comparisons: run.comparisons.map(serialiseComparison),
    usage: {
      promptTokens: run.promptTokens,
      completionTokens: run.completionTokens,
      costUsd: run.costUsd,
    },
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export async function loadRunState(runId: string): Promise<RunState | null> {
  const run = await loadRun(runId);
  return run ? serialiseRun(run) : null;
}

export async function listRuns(limit = 60): Promise<RunListItem[]> {
  const runs = await prisma.run.findMany({
    orderBy: { updatedAt: 'desc' },
    take: limit,
    include: {
      documents: { select: { status: true } },
      industryPack: { select: { canonicalIndustry: true, source: true } },
    },
  });

  return runs.map((run) => {
    const slots = slotsOf(run);
    return {
      id: run.id,
      title: run.title,
      companyName: slots.company_name ?? null,
      industry: slots.industry ?? null,
      region: slots.region ?? null,
      documentCount: run.documents.length,
      completeCount: run.documents.filter((d) => d.status === 'complete' || d.status === 'repaired')
        .length,
      tailoredTo: run.industryPack?.canonicalIndustry ?? null,
      tailoredSource:
        run.industryPack?.source === 'curated'
          ? 'curated'
          : run.industryPack
            ? 'generated'
            : null,
      updatedAt: run.updatedAt.toISOString(),
      createdAt: run.createdAt.toISOString(),
    };
  });
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export async function appendMessage(
  runId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<{ id: string; seq: number }> {
  const last = await prisma.message.findFirst({
    where: { runId },
    orderBy: { seq: 'desc' },
    select: { seq: true },
  });
  const seq = (last?.seq ?? -1) + 1;

  const message = await prisma.message.create({
    data: { runId, role, content, seq },
  });
  return { id: message.id, seq };
}

export async function historyFor(runId: string): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const messages = await prisma.message.findMany({
    where: { runId, role: { in: ['user', 'assistant'] } },
    orderBy: { seq: 'asc' },
  });
  return messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}

// ---------------------------------------------------------------------------
// Invalidation
//
// Editing the brief has to invalidate the documents it contradicts. Silently
// leaving a document that says "B2B practice owners" attached to a brief that
// now says "B2C patients" is the worst possible outcome — it looks correct.
// ---------------------------------------------------------------------------

/** Slots that do not change what a document says. */
const NON_INVALIDATING: SlotKey[] = ['website_url', 'notes'];

export function invalidatesDocuments(changed: SlotKey[]): boolean {
  return changed.some((key) => !NON_INVALIDATING.includes(key));
}

export interface InvalidationResult {
  invalidated: number;
  documentIds: string[];
}

/**
 * Mark affected documents stale. They are kept, not deleted — a strategist who
 * tweaks one word should not lose four documents, and the stale badge makes the
 * mismatch explicit so nothing misleading can be exported by accident.
 */
export async function invalidateDocuments(
  runId: string,
  changed: SlotKey[],
): Promise<InvalidationResult> {
  if (!invalidatesDocuments(changed)) return { invalidated: 0, documentIds: [] };

  // A service edit only touches that service's documents; anything else is
  // global to the run.
  const serviceOnly =
    changed.length === 1 && changed[0] === 'services' ? undefined : undefined;
  void serviceOnly;

  const affected = await prisma.document.findMany({
    where: { runId, status: { in: ['complete', 'repaired', 'failed'] } },
    select: { id: true },
  });

  if (!affected.length) return { invalidated: 0, documentIds: [] };

  await prisma.document.updateMany({
    where: { id: { in: affected.map((d) => d.id) } },
    data: { status: 'stale' },
  });

  // A stale document set makes the comparison table wrong too.
  await prisma.comparison.deleteMany({ where: { runId } });

  return { invalidated: affected.length, documentIds: affected.map((d) => d.id) };
}

/** Awareness edits only invalidate that one scenario. */
export async function invalidateScenario(
  runId: string,
  scenario: AwarenessKey,
): Promise<InvalidationResult> {
  const affected = await prisma.document.findMany({
    where: { runId, scenario, status: { in: ['complete', 'repaired', 'failed'] } },
    select: { id: true },
  });
  if (!affected.length) return { invalidated: 0, documentIds: [] };

  await prisma.document.updateMany({
    where: { id: { in: affected.map((d) => d.id) } },
    data: { status: 'stale' },
  });
  await prisma.comparison.deleteMany({ where: { runId } });

  return { invalidated: affected.length, documentIds: affected.map((d) => d.id) };
}

// ---------------------------------------------------------------------------
// Persisting the brief
// ---------------------------------------------------------------------------

export async function persistBrief(
  runId: string,
  slots: SlotValues,
  meta: SlotMeta,
  extra: {
    missing?: string[];
    ambiguities?: string[];
    awarenessResolvedInChat?: boolean;
  } = {},
): Promise<void> {
  const { regulated, reason } = detectRegulated(slots);

  await prisma.run.update({
    where: { id: runId },
    data: {
      slots: slots as object,
      slotMeta: meta as object,
      title: deriveTitle(slots),
      regulated,
      regulatedReason: reason,
      ...(extra.missing ? { missing: extra.missing } : {}),
      ...(extra.ambiguities ? { ambiguities: extra.ambiguities } : {}),
      ...(extra.awarenessResolvedInChat !== undefined
        ? { awarenessResolvedInChat: extra.awarenessResolvedInChat }
        : {}),
    },
  });
}

export function deriveTitle(slots: SlotValues): string {
  const company = slots.company_name?.trim();
  const industry = slots.industry?.trim();
  const region = slots.region?.trim();

  const parts = [company, industry].filter(Boolean);
  if (!parts.length) return 'Untitled ICP';

  const base = parts.join(' — ');
  return region ? `${base} (${region})` : base;
}

// ---------------------------------------------------------------------------
// Generation helpers
// ---------------------------------------------------------------------------

export function servicesOf(slots: SlotValues): { name: string; price_terms?: string | null }[] {
  const services = slots.services ?? [];
  if (services.length) return services;
  // A brief can be complete enough to generate with only an offer type named.
  if (slots.offer_type?.trim()) return [{ name: slots.offer_type.trim(), price_terms: null }];
  return [{ name: 'Core offer', price_terms: null }];
}

export function documentLabel(serviceName: string, scenario: AwarenessKey): string {
  return `${serviceName} — ${awarenessLabel(scenario)}`;
}

export function missingSlotSummary(slots: SlotValues, keys: SlotKey[]): string {
  return keys
    .filter((key) => isEmptySlot(key, (slots as Record<string, unknown>)[key]))
    .map((key) => slotDisplayValue(key, slots) ?? key)
    .join(', ');
}

export function runRecordExists(run: RunRecord): run is NonNullable<RunRecord> {
  return run !== null;
}
