/**
 * The scope choice.
 *
 * Turns "whole business / these sub-services / both" into the run's actual
 * service list. This is the one place that decides what gets generated for a
 * multi-offer site, so it is also the place that enforces the ceiling — a
 * strategist who ticks every box on a twenty-offer site gets the first twelve
 * and is told so, rather than a run that quietly costs five times what they
 * expected.
 *
 * Writing the choice is idempotent: post it again with different ticks and the
 * service list is rebuilt. Documents already generated for services that
 * survive the rewrite keep their slug, so nothing is regenerated needlessly.
 */
import { prisma } from '@/lib/db';
import {
  MAX_FOCUSED_SERVICES,
  slugifyService,
  type DiscoveredService,
  type ScopeChoice,
} from '@/lib/discover-types';
import { discoveredServicesOf, loadRun, loadRunState, slotsOf } from '@/lib/run-service';
import { normaliseServices, type ServiceSlot } from '@/lib/slots';
import { errorResponse, jsonResponse } from '@/lib/sse';
import { guard } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ScopeBody {
  choice: ScopeChoice;
  /** Slugs from the discovered catalogue. Ignored when choice is 'generic'. */
  slugs?: string[];
  /** Dismissing the picker: proceed as a single whole-business run. */
  dismiss?: boolean;
}

const VALID: ScopeChoice[] = ['generic', 'focused', 'both'];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await guard();
  if (gate.response) return gate.response;

  const { id: runId } = await params;

  let body: ScopeBody;
  try {
    body = (await request.json()) as ScopeBody;
  } catch {
    return errorResponse('Malformed request body');
  }

  const run = await loadRun(runId);
  if (!run) return errorResponse('Run not found', 404);

  // Dismissing is a legitimate answer. Record it so the picker does not come
  // back on the next turn, and leave the brief exactly as the conversation
  // resolved it.
  if (body.dismiss) {
    await prisma.run.update({
      where: { id: runId },
      data: { scopeResolved: true, scopeChoice: 'generic' },
    });
    return jsonResponse({ state: await loadRunState(runId) });
  }

  if (!VALID.includes(body.choice)) {
    return errorResponse('Choose one of: generic, focused, both');
  }

  const catalogue = discoveredServicesOf(run);
  const wanted = new Set(body.slugs ?? []);

  const picked: DiscoveredService[] =
    body.choice === 'generic' ? [] : catalogue.filter((service) => wanted.has(service.slug));

  if (body.choice !== 'generic' && picked.length === 0) {
    return errorResponse('Tick at least one sub-service, or choose the whole-business profile');
  }

  const slots = slotsOf(run);
  const existing = slots.services ?? [];

  // The whole-business entry keeps whatever the conversation established —
  // its name and, importantly, its price terms. Rebuilding it from scratch
  // would throw away a price the client actually gave us.
  const genericName =
    existing.find((s) => s.tier !== 'focused')?.name ??
    existing[0]?.name ??
    slots.offer_type?.trim() ??
    'Whole business';

  const generic: ServiceSlot = {
    name: genericName,
    price_terms: existing.find((s) => s.tier !== 'focused')?.price_terms ?? existing[0]?.price_terms ?? null,
    tier: 'generic',
    slug: 'whole-business',
  };

  const capped = picked.slice(0, MAX_FOCUSED_SERVICES);
  const dropped = picked.length - capped.length;

  const focused: ServiceSlot[] = capped.map((service) => ({
    name: service.name,
    // A sub-service inherits no price. The brief's price belongs to whatever
    // the client quoted, and attaching it here would state a figure about an
    // offer nobody priced.
    price_terms: existing.find((s) => s.slug === service.slug)?.price_terms ?? null,
    tier: 'focused',
    slug: service.slug || slugifyService(service.name),
  }));

  const services =
    body.choice === 'generic'
      ? [generic]
      : body.choice === 'both'
        ? [generic, ...focused]
        : focused;

  await prisma.run.update({
    where: { id: runId },
    data: {
      slots: { ...slots, services: normaliseServices(services) } as object,
      scopeChoice: body.choice,
      scopeResolved: true,
    },
  });

  return jsonResponse({
    state: await loadRunState(runId),
    dropped,
    generating: services.length,
  });
}
