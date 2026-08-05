/**
 * The chat turn.
 *
 * Per user message:
 *   1. persist the message (so a refresh mid-turn loses nothing)
 *   2. RESOLVE the whole brief from the full history
 *   3. fetch the website if one just appeared, then re-resolve with that context
 *   4. merge with provenance rules, persist, invalidate contradicted documents
 *   5. pick the turn mode and stream one reply
 *   6. emit the new run state
 *
 * An OpenAI failure at any point streams a human line into the thread and
 * leaves the brief and every completed document untouched.
 */
import { prisma } from '@/lib/db';
import { converse, detectIntent, type TurnContext, type TurnMode } from '@/lib/converse';
import { friendlyError } from '@/lib/openai';
import { resolveSlots } from '@/lib/resolve';
import { scrapeSite, verifiedContextBlock } from '@/lib/scrape';
import { discoverServices } from '@/lib/discover';
import { MIN_SERVICES_TO_ASK } from '@/lib/discover-types';
import {
  appendMessage,
  deflectedSlots,
  historyFor,
  invalidateDocuments,
  loadRun,
  metaOf,
  persistBrief,
  serialiseRun,
  slotsOf,
  visibleAmbiguities,
} from '@/lib/run-service';
import {
  ASKABLE_SLOTS,
  applyDocumentedDefaults,
  applyFallbacks,
  computeReadiness,
  isEmptySlot,
  mergeResolution,
  trackAsk,
  type SlotKey,
  type SlotValues,
} from '@/lib/slots';
import { getAudienceMode } from '@/lib/settings';
import { errorResponse, sseStream } from '@/lib/sse';
import type { ChatEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

interface ChatRequest {
  runId: string;
  message?: string;
  /** First load with no history — produce the opening line. */
  greeting?: boolean;
}

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  if (!body.runId) return errorResponse('runId is required');

  // A database that is down must produce a readable error, not a bare 500 —
  // the client turns this message into the line the user actually reads.
  try {
    const existing = await prisma.run.findUnique({
      where: { id: body.runId },
      select: { id: true },
    });
    if (!existing) return errorResponse('Run not found', 404);
  } catch (err) {
    console.error('[chat] database unreachable:', (err as Error).message);
    return errorResponse(
      'Can’t reach the database right now. Nothing was lost — try that again in a moment.',
      503,
    );
  }

  const userMessage = body.message?.trim();
  if (!userMessage && !body.greeting) return errorResponse('message is required');

  return sseStream<ChatEvent>(async (writer, signal) => {
    const runId = body.runId;

    // ---- 1. persist the user's message -----------------------------------
    if (userMessage) {
      await appendMessage(runId, 'user', userMessage);
    }

    let turnMode: TurnMode = 'greeting';
    let changedSlots: SlotKey[] = [];
    let invalidatedCount = 0;
    let siteNotice: string | null = null;
    /** Consecutive asks of the current target slot that have not landed. */
    let askStrikes = 0;
    let isRetry = false;

    const run = await loadRun(runId);
    if (!run) {
      writer.send({ type: 'error', text: 'Run not found' });
      return;
    }

    let slots: SlotValues = slotsOf(run);
    let meta = metaOf(run);
    let ambiguities = visibleAmbiguities(run);
    const deflected = new Set<SlotKey>(deflectedSlots(run));
    let missing: string[] = (run.missing as string[]) ?? [];

    const audienceMode = await getAudienceMode();
    const history = await historyFor(runId);
    const intent = userMessage
      ? detectIntent(userMessage)
      : { wantsToSkipAhead: false, isDeflection: false, isMetaQuestion: false };

    // ---- 2/3. resolve, scrape, re-resolve --------------------------------
    if (userMessage) {
      try {
        const resolved = await resolveSlots({
          runId,
          history,
          currentSlots: slots,
          siteContext: run.siteContext,
          lastAskedSlot: run.lastAskedSlot,
          signal,
        });

        const merged = mergeResolution(slots, meta, resolved.slots, resolved.meta);
        slots = merged.slots;
        meta = merged.meta;
        changedSlots = merged.changed;
        missing = resolved.missing;
        ambiguities = resolved.ambiguities;

        // A website that has just arrived gets fetched once, then the brief is
        // re-resolved so the grounded facts can fill company name and industry.
        const url = slots.website_url;
        if (url && run.siteFetchedUrl !== url && run.siteFetchStatus !== 'pending') {
          await prisma.run.update({
            where: { id: runId },
            data: { siteFetchStatus: 'pending', siteFetchedUrl: url },
          });

          const scraped = await scrapeSite(url);

          if (scraped.ok && scraped.text) {
            const context = verifiedContextBlock(scraped.text, scraped.url);
            await prisma.run.update({
              where: { id: runId },
              data: { siteContext: context, siteFetchStatus: 'ok' },
            });

            const reresolved = await resolveSlots({
              runId,
              history,
              currentSlots: slots,
              siteContext: context,
              signal,
            });
            const remerged = mergeResolution(slots, meta, reresolved.slots, reresolved.meta);
            slots = remerged.slots;
            meta = remerged.meta;
            changedSlots = [...new Set([...changedSlots, ...remerged.changed])];
            missing = reresolved.missing;

            // Read the rest of the site while we are here. A broker with
            // seventeen loan products and a dentist with one are the same shape
            // of brief until someone looks; this is that look. Everything about
            // it is best-effort — a failure leaves the run exactly as it was.
            await prisma.run.update({
              where: { id: runId },
              data: { discoveryStatus: 'pending' },
            });

            const discovered = await discoverServices(url, { runId });

            await prisma.run.update({
              where: { id: runId },
              data: {
                discoveryStatus: discovered.status,
                discoveredServices: discovered.services as unknown as object,
                discoveryPagesRead: discovered.pagesRead,
              },
            });

            if (discovered.status === 'ok' && discovered.services.length >= MIN_SERVICES_TO_ASK) {
              writer.send({
                type: 'discovery',
                status: discovered.status,
                services: discovered.services,
                pagesRead: discovered.pagesRead,
              });
            }
          } else {
            // Logged, not just recorded. A fetch that works from a laptop and
            // fails from the deployed container is the hardest kind of failure
            // to reason about from the outside, and the reason is the whole
            // diagnosis — 403 means a firewall, ENOTFOUND means DNS, a timeout
            // means the page is too slow or too large from this region.
            console.error(
              `[chat] site fetch failed for ${url}: ${scraped.reason ?? 'unknown'}`,
            );
            // An unreadable site now costs two things, not one: no grounded
            // company facts, and no sub-service check. Record the second
            // explicitly — a strategist who is never offered the scope choice
            // must be able to find out why, rather than assume the site sells
            // one thing.
            await prisma.run.update({
              where: { id: runId },
              data: { siteFetchStatus: 'failed', discoveryStatus: 'failed' },
            });
            // Mentioned exactly once, then never again.
            if (!run.siteNoticeShown) {
              siteNotice =
                `their website ${scraped.reason ?? 'could not be read'}, so nothing was pulled from it and I could not ` +
                `check whether they sell several distinct services — I am working from what they told me. ` +
                `Everything else is unaffected`;
              await prisma.run.update({
                where: { id: runId },
                data: { siteNoticeShown: true },
              });
            }
          }
        }
      } catch (err) {
        // Resolution failed. The brief survives exactly as it was.
        writer.send({ type: 'notice', text: friendlyError(err) });
      }

      // ---- the loop-breaker ---------------------------------------------
      //
      // The deflection regex alone is not enough. It catches "I don't know",
      // but not the far worse case: the user answers properly, the resolver
      // fails to map the answer onto the slot, the slot stays empty, and the
      // exact same question comes back. That has to be impossible regardless
      // of what the model does, so it is enforced by counting, not by
      // understanding.
      //
      // One retry is allowed — a question can legitimately be misread once, and
      // rephrasing often lands it. A slot still empty after two asks is
      // assumed or skipped, and never raised again.
      const decision = trackAsk(
        {
          lastAskedSlot: (run.lastAskedSlot as SlotKey | null) ?? null,
          lastAskedCount: run.lastAskedCount,
        },
        slots,
        { deflected: intent.isDeflection },
      );
      for (const key of decision.freeze) deflected.add(key);
      askStrikes = decision.strikes;
      isRetry = decision.isRetry;

      // An explicit deflection freezes whatever is currently on the table too.
      if (intent.isDeflection) {
        const readinessNow = computeReadiness(slots, meta, {
          askedAndDeflected: [...deflected],
        });
        if (readinessNow.nextAsk) deflected.add(readinessNow.nextAsk);
      }

      // Documents that contradict the new brief are marked stale.
      if (changedSlots.length) {
        const result = await invalidateDocuments(runId, changedSlots);
        invalidatedCount = result.invalidated;
      }
    }

    // "Just build it" → stop asking, fill the defaults, hand over.
    if (intent.wantsToSkipAhead) {
      for (const key of ASKABLE_SLOTS) {
        if (isEmptySlot(key, (slots as Record<string, unknown>)[key])) deflected.add(key);
      }
    }

    const withDefaults = applyDocumentedDefaults(slots, meta);
    slots = withDefaults.slots;
    meta = withDefaults.meta;

    // Only slots the user was actually asked about and dodged get assumed —
    // and they are recorded as assumptions so the confirmation says so.
    const withFallbacks = applyFallbacks(slots, meta, [...deflected]);
    slots = withFallbacks.slots;
    meta = withFallbacks.meta;

    const readiness = computeReadiness(slots, meta, { askedAndDeflected: [...deflected] });

    // ---- persist the brief before the reply streams ----------------------
    const storedAmbiguities = [
      ...ambiguities,
      ...[...deflected].map((key) => `deflected:${key}`),
    ];

    await persistBrief(runId, slots, meta, {
      missing,
      ambiguities: storedAmbiguities,
      awarenessResolvedInChat: readiness.awarenessResolved,
    });

    // Record what this turn is about to ask, so the next turn can tell whether
    // the answer landed and the resolver knows which slot the reply targets.
    await prisma.run.update({
      where: { id: runId },
      data: {
        lastAskedSlot: readiness.nextAsk ?? null,
        lastAskedCount: readiness.nextAsk ? askStrikes : 0,
      },
    });

    // ---- 5. pick the turn mode -------------------------------------------
    if (!userMessage) {
      turnMode = 'greeting';
    } else if (readiness.briefComplete) {
      turnMode = readiness.awarenessResolved ? 'awareness_settled' : 'confirm';
    } else if (intent.isMetaQuestion && !changedSlots.length) {
      turnMode = 'acknowledge';
    } else {
      turnMode = 'ask';
    }

    const context: TurnContext = {
      mode: turnMode,
      slots,
      meta,
      readiness,
      targetSlot: readiness.nextAsk,
      ambiguities,
      deflected: [...deflected],
      audience: audienceMode,
      resolvedNothing: userMessage ? changedSlots.length === 0 : false,
      remainingGaps: readiness.missingRequired.length,
      siteNotice,
      changedSlots,
      invalidatedCount,
      isFirstTurn: history.length === 0,
      isRetry,
      lastAssistantMessage: [...history].reverse().find((m) => m.role === 'assistant')?.content ?? null,
    };

    // ---- 6. stream the reply ---------------------------------------------
    let assistantText = '';
    try {
      const messageId = `pending-${Date.now()}`;
      writer.send({ type: 'message_start', messageId });

      assistantText = await converse({
        runId,
        history,
        context,
        signal,
        onDelta: (chunk) => {
          writer.send({ type: 'delta', text: chunk });
        },
      });

      const saved = await appendMessage(runId, 'assistant', assistantText);
      writer.send({ type: 'message_end', messageId: saved.id, content: assistantText });
    } catch (err) {
      const text = friendlyError(err);
      // The failure is recorded as a real turn so the thread stays coherent
      // and the next resolve sees an honest history.
      const saved = await appendMessage(runId, 'assistant', text);
      writer.send({ type: 'delta', text: assistantText ? '' : text });
      writer.send({ type: 'message_end', messageId: saved.id, content: assistantText || text });
    }

    // ---- 7. final state ---------------------------------------------------
    const finalRun = await loadRun(runId);
    if (finalRun) writer.send({ type: 'state', state: serialiseRun(finalRun) });
    writer.send({ type: 'done' });
  });
}
