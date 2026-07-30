/**
 * Streaming diagnostic.
 *
 * Emits five ticks a second apart. Curl it against the deployed URL:
 *
 *   curl -N https://<app>.up.railway.app/api/health/stream
 *
 * If the ticks arrive one per second, streaming is unbuffered and the chat and
 * generation endpoints will behave. If all five land at once after five
 * seconds, something in front of the app is buffering — which shows up in the
 * product as a chat that hangs and then dumps a whole reply at once.
 *
 * Needs no database and no OpenAI key, so it works on a half-configured deploy.
 */
import { sseStream } from '@/lib/sse';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Tick = { type: 'tick'; n: number; at: string } | { type: 'done' };

export async function GET() {
  return sseStream<Tick>(
    async (writer, signal) => {
      for (let n = 1; n <= 5; n++) {
        if (signal.aborted || writer.closed) return;
        writer.send({ type: 'tick', n, at: new Date().toISOString() });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      writer.send({ type: 'done' });
    },
    { keepAliveMs: 500 },
  );
}
