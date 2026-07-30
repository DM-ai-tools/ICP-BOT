/**
 * Server-sent events, shaped to survive the Railway proxy.
 *
 * Without `X-Accel-Buffering: no` the edge buffers the response and the user
 * watches a spinner for ninety seconds and then receives an entire document at
 * once — which looks exactly like a hang. The keep-alive comment ping stops
 * idle-connection reapers cutting a long generation mid-document.
 */
import 'server-only';

export const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform, no-store, must-revalidate',
  Connection: 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Content-Encoding': 'none',
};

export interface SseWriter<TEvent> {
  send: (event: TEvent) => void;
  comment: (text: string) => void;
  close: () => void;
  readonly closed: boolean;
}

export function sseStream<TEvent>(
  handler: (writer: SseWriter<TEvent>, signal: AbortSignal) => Promise<void>,
  options: { keepAliveMs?: number } = {},
): Response {
  const encoder = new TextEncoder();
  const controller = new AbortController();
  const keepAliveMs = options.keepAliveMs ?? 15_000;

  let closed = false;
  let keepAlive: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const writer: SseWriter<TEvent> = {
        get closed() {
          return closed;
        },
        send(event) {
          if (closed) return;
          try {
            streamController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          } catch {
            closed = true;
          }
        },
        comment(text) {
          if (closed) return;
          try {
            streamController.enqueue(encoder.encode(`: ${text}\n\n`));
          } catch {
            closed = true;
          }
        },
        close() {
          if (closed) return;
          closed = true;
          try {
            streamController.close();
          } catch {
            // already closed
          }
        },
      };

      // Flush immediately so the browser opens the stream before the first
      // model token arrives.
      writer.comment('open');

      keepAlive = setInterval(() => {
        if (closed) return;
        writer.comment('ping');
      }, keepAliveMs);

      try {
        await handler(writer, controller.signal);
      } catch (err) {
        if (!closed) {
          try {
            streamController.enqueue(
              encoder.encode(
                `data: ${JSON.stringify({
                  type: 'error',
                  text: (err as Error)?.message ?? 'Stream failed',
                })}\n\n`,
              ),
            );
          } catch {
            // connection already gone
          }
        }
      } finally {
        if (keepAlive) clearInterval(keepAlive);
        writer.close();
      }
    },

    cancel() {
      closed = true;
      if (keepAlive) clearInterval(keepAlive);
      controller.abort();
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
