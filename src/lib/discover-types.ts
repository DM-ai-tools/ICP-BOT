/**
 * Sub-service discovery: shapes shared by the server and the picker UI.
 *
 * Kept apart from `discover.ts` because that module reaches the network and is
 * `server-only`; the scope picker is a client component and needs these types.
 */
import { z } from 'zod';

/** One offer found on a client's website. */
export interface DiscoveredService {
  /** Display name, as a strategist would say it: "First home buyer loans". */
  name: string;
  /** Stable key. Survives re-ordering, so a re-run lands on the same file. */
  slug: string;
  /** Site's own grouping, when it has one: "Home loans", "Business & commercial". */
  group: string | null;
  /** One line on who it is for — shown under the tick box. */
  summary: string;
  /** Page it came from, for the strategist to check. */
  url: string | null;
}

export type DiscoveryStatus =
  | 'idle'
  | 'pending'
  | 'ok' // several distinct sub-services found
  | 'single' // a real site, but one offer — behave exactly as before
  | 'failed'; // could not read the site; never blocks anything

/**
 * What the client asked for.
 *
 *   generic  — one ICP set for the business as a whole
 *   focused  — ICP sets for named sub-services only
 *   both     — the whole-business set plus the named sub-services
 */
export type ScopeChoice = 'generic' | 'focused' | 'both';

export const SCOPE_CHOICES: { value: ScopeChoice; label: string; blurb: string }[] = [
  {
    value: 'generic',
    label: 'One ICP for the whole business',
    blurb:
      'A single profile set covering the business as it presents itself. Fastest, cheapest, and right when the sub-services all sell to the same person.',
  },
  {
    value: 'focused',
    label: 'Only specific sub-services',
    blurb:
      'A profile set per sub-service you tick. Right when the services attract genuinely different buyers and you only need some of them.',
  },
  {
    value: 'both',
    label: 'Whole business and sub-services',
    blurb:
      'The whole-business set as the parent, plus a set per ticked sub-service, packaged together with a map of how they relate. The complete picture.',
  },
];

/** Below this, a site is not worth interrupting the strategist over. */
export const MIN_SERVICES_TO_ASK = 3;
/** Hard ceiling on how many sub-services one run will generate for. */
export const MAX_FOCUSED_SERVICES = 12;

export const discoveredServiceSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  group: z.union([z.string(), z.null()]).optional().default(null),
  summary: z.string().default(''),
  url: z.union([z.string(), z.null()]).optional().default(null),
});

export function slugifyService(input: string): string {
  return (
    input
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'service'
  );
}

/** Discovered services grouped for display, preserving first-seen group order. */
export function groupServices(
  services: DiscoveredService[],
): { group: string | null; services: DiscoveredService[] }[] {
  const order: (string | null)[] = [];
  const byGroup = new Map<string | null, DiscoveredService[]>();

  for (const service of services) {
    const key = service.group?.trim() || null;
    if (!byGroup.has(key)) {
      byGroup.set(key, []);
      order.push(key);
    }
    byGroup.get(key)!.push(service);
  }

  return order.map((group) => ({ group, services: byGroup.get(group)! }));
}
