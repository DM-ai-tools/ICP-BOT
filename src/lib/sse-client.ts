'use client';

/**
 * Client-side SSE reader.
 *
 * fetch + ReadableStream rather than EventSource, because these endpoints are
 * POSTs with JSON bodies and EventSource only does GET.
 */

export async function readSse<TEvent>(
  url: string,
  body: unknown,
  onEvent: (event: TEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload.error) message = payload.error;
    } catch {
      // keep the status-code message
    }
    throw new Error(message);
  }

  if (!response.body) throw new Error('No response stream');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Events are separated by a blank line; a partial tail stays buffered.
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf('\n\n');

      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue; // ignore keep-alive comments
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload) as TEvent);
        } catch {
          // A malformed frame is not worth killing the stream over.
        }
      }
    }
  }
}
