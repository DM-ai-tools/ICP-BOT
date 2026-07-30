/**
 * Instance settings.
 *
 * Currently just one: who is on the other side of the conversation. The whole
 * app is the chatbot, so who it thinks it is talking to changes more than tone —
 * it changes how much it explains, how much it assumes, and how much it is
 * willing to ask for at once.
 *
 * The shapes live in ./settings-shared so the admin toggle can render them in
 * the browser; this half owns persistence.
 */
import 'server-only';
import { prisma } from './db';
import {
  DEFAULT_AUDIENCE_MODE,
  isAudienceMode,
  type AudienceMode,
} from './settings-shared';

export {
  AUDIENCE_MODES,
  DEFAULT_AUDIENCE_MODE,
  isAudienceMode,
} from './settings-shared';
export type { AudienceMode } from './settings-shared';

const AUDIENCE_MODE_KEY = 'audience_mode';

/**
 * Never throws. A settings lookup sits in front of every chat turn, and a
 * missing table or a cold database must degrade to the default rather than
 * taking the conversation down.
 */
export async function getAudienceMode(): Promise<AudienceMode> {
  try {
    const row = await prisma.setting.findUnique({ where: { key: AUDIENCE_MODE_KEY } });
    const value = row?.value as unknown;
    return isAudienceMode(value) ? value : DEFAULT_AUDIENCE_MODE;
  } catch {
    return DEFAULT_AUDIENCE_MODE;
  }
}

export async function setAudienceMode(mode: AudienceMode): Promise<void> {
  await prisma.setting.upsert({
    where: { key: AUDIENCE_MODE_KEY },
    create: { key: AUDIENCE_MODE_KEY, value: mode },
    update: { value: mode },
  });
}
