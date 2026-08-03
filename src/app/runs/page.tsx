import Link from 'next/link';
import { ArrowLeft, FileText, Plus } from 'lucide-react';
import { listRuns } from '@/lib/run-service';
import { RunCardActions } from '@/components/run-card-actions';
import { Badge, Button } from '@/components/ui/primitives';
import { Brand } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-provider';

export const dynamic = 'force-dynamic';

/**
 * Saved runs. Every download is reachable from here, not only from the fresh
 * result screen — that is the difference between a tool and a demo.
 */
export default async function RunsPage() {
  const runs = await listRuns();

  return (
    <div className="atmosphere min-h-dvh bg-bg">
      <header className="chrome sticky top-0 z-chrome flex h-topbar items-center justify-between gap-3 border-b border-line px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/" aria-label="Back">
              <ArrowLeft />
            </Link>
          </Button>
          <Brand href={null} />
          <span className="hidden text-sm text-fg-muted sm:inline">· Saved ICPs</span>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/admin">Admin</Link>
          </Button>
          <ThemeToggle />
          <Button size="sm" asChild>
            <Link href="/">
              <Plus />
              New ICP
            </Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-12">
        {runs.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line px-8 py-16 text-center">
            <FileText className="mx-auto h-8 w-8 text-fg-muted/50" />
            <h2 className="display mt-4 text-2xl text-fg">Nothing saved yet</h2>
            <p className="mx-auto mt-2 max-w-sm text-md leading-relaxed text-pretty text-fg-muted">
              Start a conversation, describe your business, and the profiles you build will live
              here — downloads and all.
            </p>
            <Button className="mt-6" asChild>
              <Link href="/">Build your first ICP</Link>
            </Button>
          </div>
        ) : (
          <ul className="stagger space-y-2.5">
            {runs.map((run) => (
              <li key={run.id}>
                <div className="group flex items-center gap-4 rounded-lg border border-line bg-surface-1 px-4 py-3.5 shadow-e1 transition-all duration-base ease-out hover:-translate-y-px hover:border-line-strong hover:shadow-e2">
                  <Link href={`/r/${run.id}`} className="min-w-0 flex-1 focus-visible:ring-2 focus-visible:ring-ring/70 rounded-md">
                    <p className="truncate text-md font-medium text-fg">{run.title}</p>
                    <p className="mt-0.5 truncate text-sm text-fg-muted">
                      {[run.industry, run.region].filter(Boolean).join(' · ') || 'Brief in progress'}
                      {' · '}
                      {new Date(run.updatedAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>

                    {/* Which vertical the profiles were actually tailored to.
                        Deliberately quiet — it confirms tailoring happened
                        without competing with the run's own name. */}
                    {run.tailoredTo && (
                      <p className="mt-1 flex items-center gap-1.5 truncate text-2xs text-fg-subtle">
                        <span className="inline-block size-1 shrink-0 rounded-full bg-accent/70" />
                        <span className="truncate">
                          Tailored to{' '}
                          <span className="capitalize text-fg-muted">{run.tailoredTo}</span>
                          {run.tailoredSource === 'curated' ? ' · curated' : ' · retrieved'}
                        </span>
                      </p>
                    )}
                  </Link>

                  <div className="flex shrink-0 items-center gap-2">
                    {run.documentCount > 0 ? (
                      <Badge tone={run.completeCount === run.documentCount ? 'positive' : 'caution'}>
                        {run.completeCount}/{run.documentCount} profiles
                      </Badge>
                    ) : (
                      <Badge tone="neutral">No profiles yet</Badge>
                    )}
                    <RunCardActions runId={run.id} hasDocuments={run.documentCount > 0} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
