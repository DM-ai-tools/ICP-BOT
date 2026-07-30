/**
 * Click-to-edit from the brief panel.
 *
 * A user edit is authoritative: it is stored as `stated` with editedByUser set,
 * so the next resolve cannot quietly overwrite it with an inference. Editing
 * anything that changes what a document says marks those documents stale.
 */
import { prisma } from '@/lib/db';
import {
  invalidateDocuments,
  invalidateScenario,
  loadRun,
  metaOf,
  persistBrief,
  serialiseRun,
  slotsOf,
} from '@/lib/run-service';
import {
  isEmptySlot,
  normaliseServices,
  SLOT_SPEC_BY_KEY,
  type SlotKey,
  type SlotMeta,
  type SlotValues,
} from '@/lib/slots';
import { isAwarenessKey } from '@/lib/awareness';
import { normaliseUrl } from '@/lib/resolve';
import { errorResponse, jsonResponse } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PatchBody {
  key: SlotKey;
  value: unknown;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  if (!body.key || !SLOT_SPEC_BY_KEY[body.key]) {
    return errorResponse(`Unknown slot: ${String(body.key)}`);
  }

  const run = await loadRun(id);
  if (!run) return errorResponse('Run not found', 404);

  const slots: SlotValues = { ...slotsOf(run) };
  const meta: SlotMeta = { ...metaOf(run) };
  const previous = (slots as Record<string, unknown>)[body.key];

  const normalised = normaliseIncoming(body.key, body.value);
  if (normalised.error) return errorResponse(normalised.error);

  const cleared = normalised.value === null || isEmptySlot(body.key, normalised.value);

  if (cleared) {
    (slots as Record<string, unknown>)[body.key] = null;
    delete meta[body.key];
  } else {
    (slots as Record<string, unknown>)[body.key] = normalised.value;
    meta[body.key] = {
      source: 'stated',
      confidence: 1,
      justification: 'Set directly by the user.',
      editedByUser: true,
      updatedAt: new Date().toISOString(),
    };
  }

  const changed = JSON.stringify(previous ?? null) !== JSON.stringify(normalised.value ?? null);

  await persistBrief(id, slots, meta);

  let invalidated = 0;
  if (changed) {
    // An awareness edit only contradicts that one scenario; anything else
    // contradicts the whole set.
    if (body.key === 'awareness_level' && typeof previous === 'string' && isAwarenessKey(previous)) {
      invalidated = (await invalidateScenario(id, previous)).invalidated;
    } else {
      invalidated = (await invalidateDocuments(id, [body.key])).invalidated;
    }

    if (body.key === 'awareness_level') {
      await prisma.run.update({
        where: { id },
        data: { awarenessResolvedInChat: !cleared, awarenessModalAnswered: !cleared },
      });
    }
    if (body.key === 'website_url') {
      // Let the next turn re-fetch the new site.
      await prisma.run.update({
        where: { id },
        data: { siteFetchedUrl: null, siteFetchStatus: null, siteContext: null },
      });
    }
  }

  const updated = await loadRun(id);
  return jsonResponse({
    state: updated ? serialiseRun(updated) : null,
    invalidated,
    changed,
  });
}

function normaliseIncoming(key: SlotKey, value: unknown): { value: unknown; error?: string } {
  if (value === null || value === undefined) return { value: null };

  switch (key) {
    case 'services': {
      const services = normaliseServices(value);
      return services.length ? { value: services } : { value: null };
    }
    case 'website_url':
      return { value: typeof value === 'string' ? normaliseUrl(value) : null };
    case 'company_type':
      return enumOr(value, ['agency', 'direct', 'other']);
    case 'audience_type':
      return enumOr(value, ['direct_buyer', 'clients_customer', 'channel_partner']);
    case 'maturity_tier':
      return enumOr(value, ['newbie', 'intermediate', 'advanced']);
    case 'business_model':
      return enumOr(value, ['b2c', 'b2b']);
    case 'awareness_level':
      return enumOr(value, [
        'unaware',
        'problem_aware',
        'solution_aware',
        'product_aware',
        'most_aware',
      ]);
    default: {
      if (typeof value !== 'string') return { value: null, error: `${key} must be text` };
      const trimmed = value.trim();
      return { value: trimmed ? trimmed.slice(0, 2000) : null };
    }
  }
}

function enumOr(value: unknown, allowed: string[]): { value: unknown; error?: string } {
  if (typeof value !== 'string') return { value: null };
  return allowed.includes(value)
    ? { value }
    : { value: null, error: `Value must be one of: ${allowed.join(', ')}` };
}
