/**
 * GENERATE.
 *
 * Scenarios run in parallel behind a concurrency cap so the first one streams
 * immediately rather than the user watching four spinners. Each document is
 * three sequential calls, then validation, then targeted repair, then persist.
 *
 * Idempotency is enforced by the unique (runId, serviceIndex, scenario)
 * constraint plus a status check: a document that is already complete is
 * skipped, so a retry after a dropped connection never duplicates work or
 * double-charges. `force` regenerates deliberately.
 */
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { awarenessLabel, isAwarenessKey, sortScenarios, type AwarenessKey } from '@/lib/awareness';
import { buildComparison } from '@/lib/compare';
import {
  buildWhyFraming,
  generateDocument,
  type GenerationContext,
} from '@/lib/generate';
import { industryContextBlock, resolveIndustryPack } from '@/lib/industry';
import { masterPromptVersion } from '@/lib/master-prompt';
import { describeError, friendlyError } from '@/lib/openai';
import {
  documentLabel,
  historyFor,
  loadRun,
  metaOf,
  serialiseComparison,
  serialiseRun,
  servicesOf,
  slotsOf,
} from '@/lib/run-service';
import { computeReadiness, type ServiceSlot } from '@/lib/slots';
import { errorResponse, sseStream } from '@/lib/sse';
import { validateAndRepair } from '@/lib/validate';
import { docKeyFor, type DocumentStatus, type GenerateEvent } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 800;

interface GenerateRequest {
  runId: string;
  scenarios: AwarenessKey[];
  /** Omit to generate every service in the brief. */
  serviceIndexes?: number[];
  force?: boolean;
}

export async function POST(request: Request) {
  let body: GenerateRequest;
  try {
    body = (await request.json()) as GenerateRequest;
  } catch {
    return errorResponse('Invalid JSON body');
  }

  if (!body.runId) return errorResponse('runId is required');

  const scenarios = sortScenarios((body.scenarios ?? []).filter(isAwarenessKey));
  if (!scenarios.length) return errorResponse('At least one awareness scenario is required');

  let run: Awaited<ReturnType<typeof loadRun>>;
  try {
    run = await loadRun(body.runId);
  } catch (err) {
    console.error('[generate] database unreachable:', (err as Error).message);
    return errorResponse(
      'Can’t reach the database right now. Nothing was lost — try that again in a moment.',
      503,
    );
  }
  if (!run) return errorResponse('Run not found', 404);

  const slots = slotsOf(run);
  const siteContext = run.siteContext;
  const readiness = computeReadiness(slots, metaOf(run));
  if (!readiness.readyToGenerate) {
    return errorResponse(
      `The brief is not complete yet — still missing: ${readiness.missingRequired.join(', ')}`,
      409,
    );
  }

  return sseStream<GenerateEvent>(async (writer, signal) => {
    const runId = body.runId;
    const services = servicesOf(slots);
    const indexes =
      body.serviceIndexes?.length
        ? body.serviceIndexes.filter((i) => i >= 0 && i < services.length)
        : services.map((_, i) => i);

    const history = await historyFor(runId);
    const firstUserMessage = history.find((m) => m.role === 'user')?.content ?? null;
    const whyFraming = buildWhyFraming(slots, firstUserMessage);
    const version = masterPromptVersion();

    // Resolved once, before the worker pool starts. Four scenarios generating
    // concurrently would otherwise each miss the cache and each pay to build
    // the same pack. Best-effort throughout: a null pack means the run proceeds
    // exactly as it did before this feature existed.
    const industryPack = await resolveIndustryPack({ runId, slots, signal });
    const industryContext = industryPack
      ? industryContextBlock(industryPack.summary.content, industryPack.summary.industryRaw)
      : null;

    if (industryPack) {
      await prisma.run.update({
        where: { id: runId },
        data: { industryPackId: industryPack.id },
      });
      writer.send({
        type: 'industry',
        pack: industryPack.summary,
        built: industryPack.built,
      });
    }

    // Answering the modal is what unblocks generation; record it.
    await prisma.run.update({
      where: { id: runId },
      data: { awarenessModalAnswered: true },
    });

    interface Job {
      serviceIndex: number;
      service: ServiceSlot;
      scenario: AwarenessKey;
      docKey: string;
    }

    const jobs: Job[] = [];
    for (const serviceIndex of indexes) {
      for (const scenario of scenarios) {
        jobs.push({
          serviceIndex,
          service: services[serviceIndex],
          scenario,
          docKey: docKeyFor(serviceIndex, scenario),
        });
      }
    }

    // ---- idempotency -----------------------------------------------------
    const existing = await prisma.document.findMany({
      where: { runId, serviceIndex: { in: indexes }, scenario: { in: scenarios } },
    });
    const existingByKey = new Map(
      existing.map((doc) => [docKeyFor(doc.serviceIndex, doc.scenario as AwarenessKey), doc]),
    );

    const runnable: Job[] = [];
    for (const job of jobs) {
      const prior = existingByKey.get(job.docKey);
      const alreadyGood =
        prior && (prior.status === 'complete' || prior.status === 'repaired') && !body.force;

      if (alreadyGood) {
        writer.send({
          type: 'doc_skipped',
          docKey: job.docKey,
          documentId: prior.id,
          reason: 'Already generated — reusing it rather than regenerating.',
        });
        continue;
      }
      runnable.push(job);
    }

    for (const job of runnable) {
      writer.send({
        type: 'doc_start',
        docKey: job.docKey,
        scenario: job.scenario,
        serviceIndex: job.serviceIndex,
        label: documentLabel(job.service.name, job.scenario),
      });
    }

    // ---- worker pool -----------------------------------------------------
    const queue = [...runnable];
    const workerCount = Math.min(env.concurrency, Math.max(1, queue.length));
    let completedAny = false;

    async function runJob(job: Job): Promise<void> {
      if (signal.aborted) return;

      // Claim the row first so a mid-flight crash leaves a visible `generating`
      // marker rather than a silently missing document.
      const record = await prisma.document.upsert({
        where: {
          runId_serviceIndex_scenario: {
            runId,
            serviceIndex: job.serviceIndex,
            scenario: job.scenario,
          },
        },
        create: {
          runId,
          serviceIndex: job.serviceIndex,
          serviceName: job.service.name,
          tier: job.service.tier === 'focused' ? 'focused' : 'generic',
          serviceSlug: job.service.slug ?? null,
          scenario: job.scenario,
          awarenessLabel: awarenessLabel(job.scenario),
          status: 'generating',
          masterPromptVersion: version,
          slotsSnapshot: slots as object,
          industryPackId: industryPack?.id ?? null,
        },
        update: {
          status: 'generating',
          serviceName: job.service.name,
          tier: job.service.tier === 'focused' ? 'focused' : 'generic',
          serviceSlug: job.service.slug ?? null,
          awarenessLabel: awarenessLabel(job.scenario),
          markdown: '',
          validation: undefined,
          badge: null,
          errorMessage: null,
          masterPromptVersion: version,
          slotsSnapshot: slots as object,
          industryPackId: industryPack?.id ?? null,
        },
      });

      const ctx: GenerationContext = {
        runId,
        slots,
        service: job.service,
        scenario: job.scenario,
        verifiedContext: siteContext,
        industryContext,
        whyFraming,
        // A sub-service profile takes the cheaper two-pass route and is told,
        // by name, which neighbouring offers it must not blend in.
        plan: job.service.tier === 'focused' ? 'focused' : 'full',
        siblingServices: services.map((s) => s.name),
        signal,
      };

      try {
        writer.send({ type: 'doc_phase', docKey: job.docKey, phase: 'A' });

        let currentPass: 'A' | 'B' | 'C' = 'A';
        const { markdown, promptTokens, completionTokens, costUsd } = await generateDocument(
          ctx,
          (chunk, pass) => {
            if (pass !== currentPass) {
              currentPass = pass;
              writer.send({ type: 'doc_phase', docKey: job.docKey, phase: pass });
            }
            writer.send({ type: 'doc_delta', docKey: job.docKey, text: chunk });
          },
        );

        writer.send({ type: 'doc_phase', docKey: job.docKey, phase: 'validating' });

        const validated = await validateAndRepair(markdown, ctx, (detail) => {
          writer.send({ type: 'doc_phase', docKey: job.docKey, phase: 'repairing', detail });
        });

        const saved = await prisma.document.update({
          where: { id: record.id },
          data: {
            markdown: validated.markdown,
            status: validated.badge === 'failed' ? 'failed' : validated.badge,
            badge: validated.badge,
            validation: { sections: validated.sections } as object,
            promptTokens,
            completionTokens,
            costUsd,
            completedAt: new Date(),
            // Only ever a human sentence about sections that genuinely matter.
            // Cosmetic shortfalls resolve to null and are never surfaced.
            errorMessage: validated.userMessage,
          },
        });

        completedAny = true;

        writer.send({
          type: 'doc_end',
          docKey: job.docKey,
          documentId: saved.id,
          status: saved.status as DocumentStatus,
          badge: validated.badge,
          markdown: validated.markdown,
          validation: { sections: validated.sections },
        });
      } catch (err) {
        await prisma.document.update({
          where: { id: record.id },
          data: {
            status: 'failed',
            badge: 'failed',
            errorMessage: describeError(err).slice(0, 500),
          },
        });
        // One document failing never takes down the others, and never touches
        // the ones that already completed.
        writer.send({ type: 'doc_error', docKey: job.docKey, text: friendlyError(err) });
      }
    }

    async function worker(): Promise<void> {
      while (queue.length && !signal.aborted) {
        const job = queue.shift();
        if (!job) return;
        await runJob(job);
      }
    }

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    // ---- comparison ------------------------------------------------------
    if (!signal.aborted) {
      for (const serviceIndex of indexes) {
        try {
          const docs = await prisma.document.findMany({
            where: {
              runId,
              serviceIndex,
              status: { in: ['complete', 'repaired'] },
            },
          });

          if (docs.length < 2) continue;

          const scenarioKeys = sortScenarios(docs.map((d) => d.scenario as AwarenessKey));
          const stored = await prisma.comparison.findUnique({
            where: { runId_serviceIndex: { runId, serviceIndex } },
          });

          const unchanged =
            stored &&
            JSON.stringify((stored.scenarioKeys as string[]) ?? []) === JSON.stringify(scenarioKeys);

          if (unchanged) {
            writer.send({ type: 'comparison', comparison: serialiseComparison(stored) });
            continue;
          }

          const { rows, markdown } = await buildComparison({
            runId,
            slots,
            serviceName: services[serviceIndex].name,
            documents: docs.map((d) => ({
              scenario: d.scenario as AwarenessKey,
              markdown: d.markdown,
            })),
            signal,
          });

          const savedComparison = await prisma.comparison.upsert({
            where: { runId_serviceIndex: { runId, serviceIndex } },
            create: {
              runId,
              serviceIndex,
              serviceName: services[serviceIndex].name,
              rows: rows as object,
              markdown,
              scenarioKeys: scenarioKeys as object,
            },
            update: {
              serviceName: services[serviceIndex].name,
              rows: rows as object,
              markdown,
              scenarioKeys: scenarioKeys as object,
            },
          });

          writer.send({ type: 'comparison', comparison: serialiseComparison(savedComparison) });
        } catch (err) {
          // The comparison is a bonus layer; losing it must not cost the
          // documents underneath it.
          console.warn('[generate] comparison failed:', describeError(err));
        }
      }
    }

    void completedAny;

    const finalRun = await loadRun(runId);
    if (finalRun) writer.send({ type: 'state', state: serialiseRun(finalRun) });
    writer.send({ type: 'done' });
  });
}
