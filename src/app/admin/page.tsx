import Link from 'next/link';
import { ArrowLeft, Download, FileText, Plus } from 'lucide-react';
import { prisma } from '@/lib/db';
import { APP_NAME } from '@/lib/brand';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-provider';
import { Badge, Button } from '@/components/ui/primitives';
import { getAudienceMode } from '@/lib/settings';
import { AudienceModeToggle } from '@/components/audience-mode-toggle';
import { slotsOf } from '@/lib/run-service';
import { markdownToPlainText } from '@/lib/markdown';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export const metadata = { title: `Admin · ${APP_NAME}` };

/** Human labels for the UsageLog.kind values. */
const KIND_LABEL: Record<string, string> = {
  resolve: 'Slot resolution',
  converse: 'Conversation',
  generate_a: 'Generation — part 1',
  generate_b: 'Generation — part 2',
  generate_c: 'Generation — part 3',
  repair: 'Section repair',
  compare: 'Comparison table',
  title: 'Titling',
};

function usd(value: number): string {
  if (!value) return '$0.00';
  if (value < 0.01) return '<$0.01';
  return `$${value.toFixed(value < 1 ? 3 : 2)}`;
}

function num(value: number): string {
  return value.toLocaleString();
}

function when(date: Date): string {
  return date.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default async function AdminPage() {
  const [byKind, byModel, runTotals, runs, documents, failures, docStatuses] = await Promise.all([
    prisma.usageLog.groupBy({
      by: ['kind'],
      _sum: { promptTokens: true, completionTokens: true, costUsd: true, durationMs: true },
      _count: { _all: true },
    }),
    prisma.usageLog.groupBy({
      by: ['model'],
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      _count: { _all: true },
    }),
    prisma.run.aggregate({
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
      _count: { _all: true },
    }),
    prisma.run.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: { documents: { select: { status: true } }, _count: { select: { messages: true } } },
    }),
    prisma.document.findMany({
      orderBy: { updatedAt: 'desc' },
      take: 100,
      include: { run: { select: { id: true, title: true, slots: true } } },
    }),
    prisma.usageLog.findMany({
      where: { ok: false },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
    prisma.document.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);

  const audienceMode = await getAudienceMode();

  const totalPrompt = runTotals._sum.promptTokens ?? 0;
  const totalCompletion = runTotals._sum.completionTokens ?? 0;
  const totalCost = runTotals._sum.costUsd ?? 0;

  const docCount = docStatuses.reduce((sum, s) => sum + s._count._all, 0);
  const usableDocs = docStatuses
    .filter((s) => s.status === 'complete' || s.status === 'repaired')
    .reduce((sum, s) => sum + s._count._all, 0);

  const totalCalls = byKind.reduce((sum, k) => sum + k._count._all, 0);
  const maxKindCost = Math.max(...byKind.map((k) => k._sum.costUsd ?? 0), 0.0001);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/" aria-label="Back">
              <ArrowLeft />
            </Link>
          </Button>
          <Brand href={null} />
          <span className="hidden text-sm text-muted-foreground sm:inline">· Admin</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/runs">Saved ICPs</Link>
          </Button>
          <ThemeToggle />
          <Button size="sm" asChild>
            <Link href="/">
              <Plus />
              New
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {/* ---- headline numbers -------------------------------------- */}
        <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Total spend"
            value={usd(totalCost)}
            sub={`${num(totalCalls)} model call${totalCalls === 1 ? '' : 's'}`}
            emphasis
          />
          <Stat
            label="Tokens consumed"
            value={num(totalPrompt + totalCompletion)}
            sub={`${num(totalPrompt)} in · ${num(totalCompletion)} out`}
          />
          <Stat
            label="Documents"
            value={num(docCount)}
            sub={`${num(usableDocs)} client-ready`}
          />
          <Stat
            label="Runs"
            value={num(runTotals._count._all)}
            sub={
              runTotals._count._all
                ? `${usd(totalCost / runTotals._count._all)} average`
                : 'none yet'
            }
          />
        </section>

        <AudienceModeToggle initial={audienceMode} />

        {/* ---- spend by call type ------------------------------------ */}
        <Section
          title="Where the money goes"
          hint="Generation is three calls per document by design — that split is what stops the later sections coming back thin."
        >
          {byKind.length === 0 ? (
            <Empty>No model calls recorded yet.</Empty>
          ) : (
            <Table
              head={['Call type', 'Calls', 'In', 'Out', 'Avg time', 'Cost', '']}
              align={['left', 'right', 'right', 'right', 'right', 'right', 'left']}
            >
              {[...byKind]
                .sort((a, b) => (b._sum.costUsd ?? 0) - (a._sum.costUsd ?? 0))
                .map((k) => {
                  const cost = k._sum.costUsd ?? 0;
                  const avgMs = k._count._all
                    ? Math.round((k._sum.durationMs ?? 0) / k._count._all)
                    : 0;
                  return (
                    <tr key={k.kind} className="border-b border-border/50 last:border-0">
                      <Td>{KIND_LABEL[k.kind] ?? k.kind}</Td>
                      <Td right mono>{num(k._count._all)}</Td>
                      <Td right mono muted>{num(k._sum.promptTokens ?? 0)}</Td>
                      <Td right mono muted>{num(k._sum.completionTokens ?? 0)}</Td>
                      <Td right mono muted>{avgMs ? `${(avgMs / 1000).toFixed(1)}s` : '—'}</Td>
                      <Td right mono>{usd(cost)}</Td>
                      <Td>
                        <span className="block h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
                          <span
                            className="block h-full rounded-full bg-accent"
                            style={{ width: `${Math.max(3, (cost / maxKindCost) * 100)}%` }}
                          />
                        </span>
                      </Td>
                    </tr>
                  );
                })}
            </Table>
          )}
        </Section>

        {/* ---- by model ---------------------------------------------- */}
        {byModel.length > 0 && (
          <Section title="By model">
            <Table
              head={['Model', 'Calls', 'In', 'Out', 'Cost']}
              align={['left', 'right', 'right', 'right', 'right']}
            >
              {byModel.map((m) => (
                <tr key={m.model} className="border-b border-border/50 last:border-0">
                  <Td>
                    <code className="rounded bg-secondary px-1.5 py-0.5 text-[12px]">{m.model}</code>
                  </Td>
                  <Td right mono>{num(m._count._all)}</Td>
                  <Td right mono muted>{num(m._sum.promptTokens ?? 0)}</Td>
                  <Td right mono muted>{num(m._sum.completionTokens ?? 0)}</Td>
                  <Td right mono>{usd(m._sum.costUsd ?? 0)}</Td>
                </tr>
              ))}
            </Table>
            <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
              Cost is computed from the per-million rates in <code>OPENAI_PRICE_*</code>. It is an
              estimate for tracking, not a billing record — reconcile against your OpenAI dashboard.
            </p>
          </Section>
        )}

        {/* ---- run history ------------------------------------------- */}
        <Section title="Run history" hint={`${runs.length} most recent`}>
          {runs.length === 0 ? (
            <Empty>No runs yet.</Empty>
          ) : (
            <Table
              head={['Brief', 'Turns', 'Docs', 'Tokens', 'Cost', 'Updated', '']}
              align={['left', 'right', 'right', 'right', 'right', 'left', 'right']}
            >
              {runs.map((run) => {
                const slots = slotsOf(run);
                const done = run.documents.filter(
                  (d) => d.status === 'complete' || d.status === 'repaired',
                ).length;
                return (
                  <tr key={run.id} className="border-b border-border/50 last:border-0">
                    <Td>
                      <Link href={`/r/${run.id}`} className="font-medium hover:underline">
                        {run.title}
                      </Link>
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                        {[slots.industry, slots.region].filter(Boolean).join(' · ') ||
                          'brief in progress'}
                      </span>
                    </Td>
                    <Td right mono muted>{num(run._count.messages)}</Td>
                    <Td right mono>
                      {run.documents.length ? (
                        <span className={done === run.documents.length ? '' : 'text-inferred'}>
                          {done}/{run.documents.length}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </Td>
                    <Td right mono muted>{num(run.promptTokens + run.completionTokens)}</Td>
                    <Td right mono>{usd(run.costUsd)}</Td>
                    <Td muted>{when(run.updatedAt)}</Td>
                    <Td right>
                      {run.documents.length > 0 && (
                        <a
                          href={`/api/export?runId=${run.id}&format=zip`}
                          className="inline-flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground"
                          title="Download everything as a zip"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Section>

        {/* ---- documents --------------------------------------------- */}
        <Section title="Documents created" hint={`${documents.length} most recent`}>
          {documents.length === 0 ? (
            <Empty>Nothing generated yet.</Empty>
          ) : (
            <Table
              head={['Document', 'Stage', 'Quality', 'Words', 'Cost', 'Created', 'Download']}
              align={['left', 'left', 'left', 'right', 'right', 'left', 'left']}
            >
              {documents.map((doc) => {
                const words = doc.markdown
                  ? markdownToPlainText(doc.markdown).split(/\s+/).filter(Boolean).length
                  : 0;
                return (
                  <tr key={doc.id} className="border-b border-border/50 last:border-0">
                    <Td>
                      <Link href={`/r/${doc.runId}`} className="font-medium hover:underline">
                        {doc.run.title}
                      </Link>
                      <span className="mt-0.5 block text-[11.5px] text-muted-foreground">
                        {doc.serviceName}
                      </span>
                    </Td>
                    <Td muted>{doc.awarenessLabel}</Td>
                    <Td>
                      <Badge
                        tone={
                          doc.status === 'stale'
                            ? 'warn'
                            : doc.badge === 'complete'
                              ? 'stated'
                              : doc.badge === 'repaired'
                                ? 'warn'
                                : doc.badge === 'failed'
                                  ? 'danger'
                                  : 'missing'
                        }
                      >
                        {doc.status === 'stale' ? 'brief changed' : (doc.badge ?? doc.status)}
                      </Badge>
                    </Td>
                    <Td right mono muted>{words ? num(words) : '—'}</Td>
                    <Td right mono muted>{usd(doc.costUsd)}</Td>
                    <Td muted>{when(doc.createdAt)}</Td>
                    <Td>
                      {doc.markdown ? (
                        <span className="flex gap-1">
                          {(['docx', 'pdf', 'md'] as const).map((fmt) => (
                            <a
                              key={fmt}
                              href={`/api/export?runId=${doc.runId}&documentId=${doc.id}&format=${fmt}`}
                              className="rounded border border-border px-1.5 py-0.5 text-[10.5px] font-medium uppercase text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                              {fmt}
                            </a>
                          ))}
                        </span>
                      ) : (
                        <span className="text-[12px] text-muted-foreground">—</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </Table>
          )}
        </Section>

        {/* ---- failures ---------------------------------------------- */}
        {failures.length > 0 && (
          <Section
            title="Recent failed calls"
            hint="Retries and backoff are automatic; these are the attempts that still did not land."
          >
            <Table
              head={['When', 'Call', 'Model', 'Attempts', 'Detail']}
              align={['left', 'left', 'left', 'right', 'left']}
            >
              {failures.map((f) => (
                <tr key={f.id} className="border-b border-border/50 last:border-0">
                  <Td muted>{when(f.createdAt)}</Td>
                  <Td>{KIND_LABEL[f.kind] ?? f.kind}</Td>
                  <Td muted>
                    <code className="text-[12px]">{f.model}</code>
                  </Td>
                  <Td right mono muted>{f.attempts}</Td>
                  <Td>
                    <span className="block max-w-md truncate text-[12px] text-destructive">
                      {f.detail ?? 'no detail recorded'}
                    </span>
                  </Td>
                </tr>
              ))}
            </Table>
          </Section>
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Presentational bits
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card px-4 py-3.5',
        emphasis && 'border-accent/40 bg-accent/[0.05]',
      )}
    >
      <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[11.5px] tabular-nums text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-9">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
        {hint && <p className="text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </section>
  );
}

function Table({
  head,
  align,
  children,
}: {
  head: string[];
  align: ('left' | 'right')[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border">
      <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
        <thead>
          <tr className="bg-secondary/50">
            {head.map((h, i) => (
              <th
                key={i}
                className={cn(
                  'border-b border-border px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground',
                  align[i] === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Td({
  children,
  right,
  mono,
  muted,
}: {
  children: React.ReactNode;
  right?: boolean;
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={cn(
        'px-3.5 py-2.5 align-top',
        right && 'text-right',
        mono && 'tabular-nums',
        muted && 'text-muted-foreground',
      )}
    >
      {children}
    </td>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
      <FileText className="mx-auto h-6 w-6 text-muted-foreground/40" />
      <p className="mt-2 text-[13.5px] text-muted-foreground">{children}</p>
    </div>
  );
}
