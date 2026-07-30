'use client';

/**
 * Results: one tab per scenario (and per service where there is more than one),
 * with the comparison table as the first tab. Sticky in-document nav is built
 * from the master prompt's own headings, so it always matches the document.
 */
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  AlertCircle,
  Check,
  Copy,
  Download,
  Layers,
  RefreshCw,
  Wrench,
} from 'lucide-react';
import { AWARENESS, awarenessShort } from '@/lib/awareness';
import { parseSections } from '@/lib/markdown';
import { COMPARISON_COLUMNS } from '@/lib/comparison';
import type { ComparisonSummary, DocumentSummary, RunState } from '@/lib/types';
import type { AwarenessKey } from '@/lib/slots';
import {
  Badge,
  Button,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/primitives';
import { ExportMenu } from '@/components/export-menu';
import { cn } from '@/lib/utils';

export interface LiveDoc {
  docKey: string;
  label: string;
  scenario: AwarenessKey;
  serviceIndex: number;
  text: string;
  phase: 'A' | 'B' | 'C' | 'validating' | 'repairing' | 'done' | 'error';
  detail?: string;
  documentId?: string;
  badge?: 'complete' | 'repaired' | 'failed';
  error?: string;
}

interface ResultsViewProps {
  state: RunState;
  live: Record<string, LiveDoc>;
  markdownById: Record<string, string>;
  onRegenerate?: (scenario: AwarenessKey, serviceIndex: number) => void;
  /** Pulls stored markdown for a saved document the first time it is opened. */
  onLoadDocument?: (documentId: string) => void;
  generating: boolean;
}

export function ResultsView({
  state,
  live,
  markdownById,
  onRegenerate,
  onLoadDocument,
  generating,
}: ResultsViewProps) {
  const liveDocs = Object.values(live);
  const hasComparison = state.comparisons.length > 0;

  const tabs = React.useMemo(() => {
    const entries: {
      value: string;
      label: string;
      doc?: DocumentSummary;
      liveDoc?: LiveDoc;
    }[] = [];

    if (hasComparison) {
      entries.push({ value: 'comparison', label: 'Comparison' });
    }

    const seen = new Set<string>();

    for (const doc of state.documents) {
      if (doc.status === 'pending') continue;
      const value = `${doc.serviceIndex}:${doc.scenario}`;
      seen.add(value);
      entries.push({
        value,
        label: awarenessShort(doc.scenario),
        doc,
        liveDoc: live[value],
      });
    }

    for (const liveDoc of liveDocs) {
      if (seen.has(liveDoc.docKey)) continue;
      entries.push({
        value: liveDoc.docKey,
        label: awarenessShort(liveDoc.scenario),
        liveDoc,
      });
    }

    return entries;
  }, [state.documents, state.slots.services, live, liveDocs, hasComparison]);

  const [active, setActive] = React.useState<string>('');

  // Follow the first document that starts streaming, then leave the user alone.
  React.useEffect(() => {
    if (active && tabs.some((t) => t.value === active)) return;
    const firstStreaming = tabs.find((t) => t.liveDoc && t.liveDoc.phase !== 'done');
    setActive(firstStreaming?.value ?? tabs[0]?.value ?? '');
  }, [tabs, active]);

  // Saved documents keep their markdown in the database, not in the run state —
  // fetch it the first time a tab is actually opened.
  React.useEffect(() => {
    if (!onLoadDocument || !active) return;
    const tab = tabs.find((t) => t.value === active);
    if (!tab?.doc) return;
    if (markdownById[tab.doc.id] !== undefined) return;
    if (live[active] && live[active].phase !== 'done') return;
    onLoadDocument(tab.doc.id);
  }, [active, tabs, markdownById, live, onLoadDocument]);

  if (!tabs.length) return null;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Tabs value={active} onValueChange={setActive} className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <TabsList className="max-w-full overflow-x-auto">
              {tabs.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value} className="shrink-0">
                  {tab.value === 'comparison' ? (
                    <>
                      <Layers className="h-3.5 w-3.5" />
                      Comparison
                    </>
                  ) : (
                    <>
                      <span>{tab.label}</span>
                      <TabStatus doc={tab.doc} liveDoc={tab.liveDoc} />
                    </>
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <ExportMenu state={state} />
          </div>
        </div>

        {hasComparison && (
          <TabsContent value="comparison" className="min-h-0 flex-1 overflow-y-auto">
            {state.comparisons.map((comparison) => (
              <ComparisonTable key={comparison.serviceIndex} comparison={comparison} />
            ))}
          </TabsContent>
        )}

        {tabs
          .filter((tab) => tab.value !== 'comparison')
          .map((tab) => (
            <TabsContent
              key={tab.value}
              value={tab.value}
              className="min-h-0 flex-1 overflow-hidden"
            >
              <DocumentView
                state={state}
                doc={tab.doc}
                liveDoc={tab.liveDoc}
                loading={Boolean(
                  tab.doc &&
                    !tab.liveDoc &&
                    markdownById[tab.doc.id] === undefined &&
                    tab.doc.status !== 'pending',
                )}
                markdown={
                  tab.liveDoc && tab.liveDoc.phase !== 'done'
                    ? tab.liveDoc.text
                    : (tab.doc && markdownById[tab.doc.id]) ||
                      tab.liveDoc?.text ||
                      ''
                }
                onRegenerate={onRegenerate}
                generating={generating}
              />
            </TabsContent>
          ))}
      </Tabs>
    </div>
  );
}

function TabStatus({ doc, liveDoc }: { doc?: DocumentSummary; liveDoc?: LiveDoc }) {
  if (liveDoc && liveDoc.phase !== 'done' && liveDoc.phase !== 'error') {
    return <Spinner className="h-3 w-3" />;
  }
  const badge = liveDoc?.badge ?? doc?.badge;
  if (doc?.status === 'stale') {
    return <span className="h-1.5 w-1.5 rounded-full bg-inferred" title="Brief changed" />;
  }
  if (badge === 'repaired') {
    return <Wrench className="h-3 w-3 text-inferred" />;
  }
  if (badge === 'failed') {
    return <AlertCircle className="h-3 w-3 text-destructive" />;
  }
  if (badge === 'complete') {
    return <Check className="h-3 w-3 text-stated" />;
  }
  return null;
}

// ---------------------------------------------------------------------------
// One document
// ---------------------------------------------------------------------------

function DocumentView({
  state,
  doc,
  liveDoc,
  markdown,
  loading,
  onRegenerate,
  generating,
}: {
  state: RunState;
  doc?: DocumentSummary;
  liveDoc?: LiveDoc;
  markdown: string;
  loading?: boolean;
  onRegenerate?: (scenario: AwarenessKey, serviceIndex: number) => void;
  generating: boolean;
}) {
  const sections = React.useMemo(() => parseSections(markdown), [markdown]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [activeAnchor, setActiveAnchor] = React.useState<string>('');

  const streaming = Boolean(liveDoc && liveDoc.phase !== 'done' && liveDoc.phase !== 'error');
  const badge = liveDoc?.badge ?? doc?.badge ?? null;
  const scenario = doc?.scenario ?? liveDoc?.scenario;
  const serviceIndex = doc?.serviceIndex ?? liveDoc?.serviceIndex ?? 0;

  // Auto-follow the stream only while the user is at the bottom.
  React.useEffect(() => {
    if (!streaming) return;
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distance < 300) element.scrollTop = element.scrollHeight;
  }, [markdown, streaming]);

  React.useEffect(() => {
    const element = scrollRef.current;
    if (!element || streaming) return;

    const onScroll = () => {
      const headings = element.querySelectorAll('[data-anchor]');
      let current = '';
      for (const heading of Array.from(headings)) {
        if (heading.getBoundingClientRect().top - element.getBoundingClientRect().top < 90) {
          current = heading.getAttribute('data-anchor') ?? '';
        }
      }
      setActiveAnchor(current);
    };

    element.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => element.removeEventListener('scroll', onScroll);
  }, [streaming, markdown]);

  return (
    <div className="flex h-full min-h-0">
      {/* Sticky in-document nav, built from the headings actually present. */}
      <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-border px-3 py-5 lg:block">
        <p className="mb-2.5 px-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
          In this profile
        </p>
        <ul className="space-y-0.5">
          {sections.map((section) => (
            <li key={section.anchor}>
              <button
                type="button"
                onClick={() => {
                  scrollRef.current
                    ?.querySelector(`[data-anchor="${section.anchor}"]`)
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                className={cn(
                  'w-full truncate rounded-md px-2 py-1.5 text-left text-[12.5px] leading-snug transition-colors',
                  activeAnchor === section.anchor
                    ? 'bg-secondary font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  section.level === 1 && 'font-medium',
                )}
                title={section.heading}
              >
                {section.heading}
              </button>
            </li>
          ))}
          {!sections.length && (
            <li className="px-2 text-[12.5px] text-muted-foreground">Writing…</li>
          )}
        </ul>
      </nav>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-7 sm:px-10">
          <div className="mb-6 flex flex-wrap items-center gap-2">
            {scenario && (
              <Badge tone="accent">{AWARENESS[scenario]?.label ?? scenario}</Badge>
            )}
            {badge === 'complete' && <Badge tone="stated">Complete</Badge>}
            {badge === 'repaired' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Badge tone="warn">Repaired</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  One or more sections came back thin and were expanded before saving.
                </TooltipContent>
              </Tooltip>
            )}
            {badge === 'failed' && <Badge tone="danger">Needs review</Badge>}
            {doc?.status === 'stale' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Badge tone="warn">Brief changed</Badge>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  The brief was edited after this was written, so it no longer matches. Rebuild it
                  before sending it anywhere.
                </TooltipContent>
              </Tooltip>
            )}
            {state.regulated && <Badge tone="warn">Regulated</Badge>}

            <div className="ml-auto flex items-center gap-1">
              {doc && <CopyButton text={markdown} label="Copy all" />}
              {doc && onRegenerate && scenario && (
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={generating}
                  onClick={() => onRegenerate(scenario, serviceIndex)}
                >
                  <RefreshCw />
                  Rebuild
                </Button>
              )}
            </div>
          </div>

          {liveDoc?.error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p className="text-[13px] leading-relaxed text-muted-foreground">{liveDoc.error}</p>
            </div>
          )}

          {doc?.errorMessage && !liveDoc?.error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-inferred/30 bg-inferred/[0.06] px-4 py-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-inferred" />
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {doc.errorMessage}
              </p>
            </div>
          )}

          {streaming && (
            <div className="mb-5 flex items-center gap-2.5 text-[13px] text-muted-foreground">
              <Spinner className="h-3.5 w-3.5" />
              <span>{phaseLabel(liveDoc)}</span>
            </div>
          )}

          {loading && !markdown && (
            <div className="space-y-3" aria-label="Loading profile">
              {[92, 78, 96, 61, 88, 70].map((width, index) => (
                <div
                  key={index}
                  className="h-4 animate-pulse rounded bg-secondary"
                  style={{ width: `${width}%` }}
                />
              ))}
            </div>
          )}

          <article className="prose-icp">
            {sections.length ? (
              sections.map((section) => (
                <section key={section.anchor}>
                  <SectionHeading section={section} />
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown>
                  <div className="mt-1 flex justify-end">
                    <CopyButton
                      text={`${'#'.repeat(section.level)} ${section.heading}\n\n${section.body}`}
                      label="Copy section"
                      subtle
                    />
                  </div>
                </section>
              ))
            ) : (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
            )}
            {streaming && <span className="streaming-caret" aria-hidden="true" />}
          </article>

          {doc && (
            <footer className="mt-10 border-t border-border pt-4 text-[11.5px] text-muted-foreground">
              {doc.wordCount.toLocaleString()} words · master prompt {doc.masterPromptVersion}
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeading({
  section,
}: {
  section: { heading: string; level: number; anchor: string };
}) {
  const props = { 'data-anchor': section.anchor, id: section.anchor };
  if (section.level === 1) return <h1 {...props}>{section.heading}</h1>;
  if (section.level === 2) return <h2 {...props}>{section.heading}</h2>;
  return <h3 {...props}>{section.heading}</h3>;
}

function phaseLabel(liveDoc?: LiveDoc): string {
  switch (liveDoc?.phase) {
    case 'A':
      return 'Writing the avatar and their current reality';
    case 'B':
      return 'Writing goals, pains and what moves them';
    case 'C':
      return 'Writing objections, opportunities and qualifiers';
    case 'validating':
      return 'Checking every section against the framework';
    case 'repairing':
      return liveDoc.detail ?? 'Expanding a thin section';
    default:
      return 'Working';
  }
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

function ComparisonTable({ comparison }: { comparison: ComparisonSummary }) {
  return (
    <div className="mx-auto max-w-6xl px-6 py-8 sm:px-8">
      <header className="mb-6">
        <h2 className="text-xl font-semibold tracking-tight">
          Awareness map — {comparison.serviceName}
        </h2>
        <p className="mt-1.5 max-w-2xl text-[14px] leading-relaxed text-muted-foreground text-pretty">
          The same buyer, five different conversations. The message that wins one stage is usually
          the message that loses another — that&rsquo;s what this table is for.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[900px] border-collapse text-left text-[13.5px]">
          <thead>
            <tr className="bg-secondary/60">
              {COMPARISON_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className="border-b border-border px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => (
              <tr key={row.scenario} className="align-top even:bg-secondary/25">
                {COMPARISON_COLUMNS.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      'border-b border-border/60 px-4 py-3.5 leading-relaxed',
                      column.key === 'awarenessLabel' && 'whitespace-nowrap font-medium',
                      column.key === 'messageThatBackfires' && 'text-muted-foreground',
                    )}
                  >
                    {String(row[column.key] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

function CopyButton({
  text,
  label,
  subtle,
}: {
  text: string;
  label: string;
  subtle?: boolean;
}) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Button
      variant="ghost"
      size="xs"
      className={subtle ? 'opacity-0 transition-opacity hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-60' : undefined}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // Clipboard is permission-gated; a silent no-op beats an error toast.
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  );
}
