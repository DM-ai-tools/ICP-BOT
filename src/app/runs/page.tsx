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
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/" aria-label="Back">
              <ArrowLeft />
            </Link>
          </Button>
          <Brand href={null} />
          <span className="hidden text-sm text-muted-foreground sm:inline">· Saved ICPs</span>
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
          <div className="rounded-2xl border border-dashed border-border px-8 py-16 text-center">
            <FileText className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <h2 className="mt-4 text-lg font-semibold">Nothing saved yet</h2>
            <p className="mx-auto mt-1.5 max-w-sm text-[14px] leading-relaxed text-muted-foreground text-pretty">
              Start a conversation, describe your business, and the profiles you build will live
              here — downloads and all.
            </p>
            <Button className="mt-6" asChild>
              <Link href="/">Build your first ICP</Link>
            </Button>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {runs.map((run) => (
              <li key={run.id}>
                <div className="group flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3.5 transition-colors hover:border-muted-foreground/30">
                  <Link href={`/r/${run.id}`} className="min-w-0 flex-1 focus-ring rounded-md">
                    <p className="truncate text-[15px] font-medium">{run.title}</p>
                    <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                      {[run.industry, run.region].filter(Boolean).join(' · ') || 'Brief in progress'}
                      {' · '}
                      {new Date(run.updatedAt).toLocaleDateString(undefined, {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </p>
                  </Link>

                  <div className="flex shrink-0 items-center gap-2">
                    {run.documentCount > 0 ? (
                      <Badge tone={run.completeCount === run.documentCount ? 'stated' : 'warn'}>
                        {run.completeCount}/{run.documentCount} profiles
                      </Badge>
                    ) : (
                      <Badge tone="missing">No profiles yet</Badge>
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
