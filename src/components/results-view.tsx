'use client';

/**
 * Results.
 *
 * This is where the product's own idea becomes visible. A prism splits one beam
 * into a spectrum, and the four awareness stages ARE that spectrum — so each
 * tab carries a position on a cold-to-warm ramp, as a 2px underline and a small
 * marker. Never as a fill: the moment these become blocks of colour the screen
 * stops being an instrument and starts being a chart.
 *
 * The in-document nav is built from the headings actually present, so it can
 * never drift from the document it indexes.
 */
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, Check, Copy, Layers, RefreshCw, Wrench } from 'lucide-react';
import { AWARENESS, awarenessShort, stageTone } from '@/lib/awareness';
import { parseSections } from '@/lib/markdown';
import { COMPARISON_COLUMNS } from '@/lib/comparison';
import type { ComparisonSummary, DocumentSummary, RunState } from '@/lib/types';
import type { AwarenessKey } from '@/lib/slots';
import {
  Badge,
  Button,
  Divider,
  Eyebrow,
  Hint,
  SkeletonText,
  Spinner,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
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

/** Spectral position → the token that paints it. Index 0 is the non-staged tab. */
const TONE_TEXT = ['', 'text-stage-1', 'text-stage-2', 'text-stage-3', 'text-stage-4'] as const;
const TONE_BG = ['', 'bg-stage-1', 'bg-stage-2', 'bg-stage-3', 'bg-stage-4'] as const;

interface ResultsViewProps {
  state: RunState;
  live: Record<string, LiveDoc>;
  markdownById: Record<string, string>;
  onRegenerate?: (scenario: AwarenessKey, serviceIndex: number) => void;
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
      tone: number;
      doc?: DocumentSummary;
      liveDoc?: LiveDoc;
    }[] = [];

    if (hasComparison) entries.push({ value: 'comparison', label: 'Comparison', tone: 0 });

    const seen = new Set<string>();
    for (const doc of state.documents) {
      if (doc.status === 'pending') continue;
      const value = `${doc.serviceIndex}:${doc.scenario}`;
      seen.add(value);
      entries.push({
        value,
        label: awarenessShort(doc.scenario),
        tone: stageTone(doc.scenario),
        doc,
        liveDoc: live[value],
      });
    }
    for (const liveDoc of liveDocs) {
      if (seen.has(liveDoc.docKey)) continue;
      entries.push({
        value: liveDoc.docKey,
        label: awarenessShort(liveDoc.scenario),
        tone: stageTone(liveDoc.scenario),
        liveDoc,
      });
    }
    return entries;
  }, [state.documents, live, liveDocs, hasComparison]);

  const [active, setActive] = React.useState('');

  React.useEffect(() => {
    if (active && tabs.some((t) => t.value === active)) return;
    const streamingTab = tabs.find((t) => t.liveDoc && t.liveDoc.phase !== 'done');
    setActive(streamingTab?.value ?? tabs[0]?.value ?? '');
  }, [tabs, active]);

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
    <div className="flex h-full min-h-0 flex-col bg-bg">
      <Tabs value={active} onValueChange={setActive} className="flex min-h-0 flex-1 flex-col">
        <div className="chrome z-chrome flex shrink-0 items-center gap-3 border-b border-line px-3 py-2">
          <TabsList className="min-w-0 flex-1 overflow-x-auto">
            {tabs.map((tab) => (
              <TabsTrigger
                key={tab.value}
                value={tab.value}
                className="group relative shrink-0 pb-2 pt-1.5 data-[state=active]:bg-transparent"
              >
                {tab.value === 'comparison' ? (
                  <>
                    <Layers className="size-3.5" />
                    <span>Comparison</span>
                  </>
                ) : (
                  <>
                    <span
                      className={cn(
                        'size-1.5 rounded-full transition-transform duration-base ease-spring',
                        TONE_BG[tab.tone],
                        active === tab.value ? 'scale-100' : 'scale-75 opacity-60',
                      )}
                    />
                    <span>{tab.label}</span>
                    <TabStatus doc={tab.doc} liveDoc={tab.liveDoc} tone={tab.tone} />
                  </>
                )}

                {/* The spectral underline. The only place the ramp appears this
                    saturated, and only for the tab you are actually reading. */}
                <span
                  aria-hidden
                  className={cn(
                    'absolute inset-x-2 -bottom-px h-0.5 origin-left rounded-full transition-transform duration-base ease-snap',
                    tab.tone ? TONE_BG[tab.tone] : 'bg-accent',
                    active === tab.value ? 'scale-x-100' : 'scale-x-0',
                  )}
                />
              </TabsTrigger>
            ))}
          </TabsList>

          <ExportMenu state={state} />
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
                tone={tab.tone}
                loading={Boolean(
                  tab.doc &&
                    !tab.liveDoc &&
                    markdownById[tab.doc.id] === undefined &&
                    tab.doc.status !== 'pending',
                )}
                markdown={
                  tab.liveDoc && tab.liveDoc.phase !== 'done'
                    ? tab.liveDoc.text
                    : (tab.doc && markdownById[tab.doc.id]) || tab.liveDoc?.text || ''
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

function TabStatus({
  doc,
  liveDoc,
  tone,
}: {
  doc?: DocumentSummary;
  liveDoc?: LiveDoc;
  tone: number;
}) {
  if (liveDoc && liveDoc.phase !== 'done' && liveDoc.phase !== 'error') {
    return <Spinner className={cn('size-3', TONE_TEXT[tone])} />;
  }
  if (doc?.status === 'stale') {
    return <span className="size-1.5 rounded-full bg-caution" title="Brief changed" />;
  }
  const badge = liveDoc?.badge ?? doc?.badge;
  if (badge === 'repaired') return <Wrench className="size-3 text-caution" />;
  if (badge === 'failed') return <AlertCircle className="size-3 text-critical" />;
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
  tone,
  loading,
  onRegenerate,
  generating,
}: {
  state: RunState;
  doc?: DocumentSummary;
  liveDoc?: LiveDoc;
  markdown: string;
  tone: number;
  loading?: boolean;
  onRegenerate?: (scenario: AwarenessKey, serviceIndex: number) => void;
  generating: boolean;
}) {
  const sections = React.useMemo(() => parseSections(markdown), [markdown]);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [activeAnchor, setActiveAnchor] = React.useState('');

  const streaming = Boolean(liveDoc && liveDoc.phase !== 'done' && liveDoc.phase !== 'error');
  const badge = liveDoc?.badge ?? doc?.badge ?? null;
  const scenario = doc?.scenario ?? liveDoc?.scenario;
  const serviceIndex = doc?.serviceIndex ?? liveDoc?.serviceIndex ?? 0;

  React.useEffect(() => {
    if (!streaming) return;
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 320) el.scrollTop = el.scrollHeight;
  }, [markdown, streaming]);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || streaming) return;

    const onScroll = () => {
      const headings = el.querySelectorAll('[data-anchor]');
      let current = '';
      for (const heading of Array.from(headings)) {
        if (heading.getBoundingClientRect().top - el.getBoundingClientRect().top < 96) {
          current = heading.getAttribute('data-anchor') ?? '';
        }
      }
      setActiveAnchor(current);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [streaming, markdown]);

  return (
    <div className="flex h-full min-h-0">
      {/* ---- in-document nav ---------------------------------------------- */}
      <nav className="hidden w-52 shrink-0 overflow-y-auto border-r border-line px-2.5 py-5 xl:block">
        <Eyebrow className="mb-2.5 px-2">In this profile</Eyebrow>
        <ul className="space-y-px">
          {sections.map((section) => {
            const isActive = activeAnchor === section.anchor;
            return (
              <li key={section.anchor}>
                <button
                  type="button"
                  onClick={() =>
                    scrollRef.current
                      ?.querySelector(`[data-anchor="${section.anchor}"]`)
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }
                  title={section.heading}
                  className={cn(
                    'relative w-full truncate rounded-sm py-1.5 pl-3 pr-2 text-left text-xs leading-snug transition-colors duration-fast',
                    isActive
                      ? 'bg-surface-2 font-medium text-fg'
                      : 'text-fg-muted hover:bg-surface-2/60 hover:text-fg-secondary',
                  )}
                >
                  {/* Active marker rides this document's spectral hue. */}
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-y-1 left-0 w-0.5 rounded-full transition-transform duration-base ease-snap',
                      TONE_BG[tone],
                      isActive ? 'scale-y-100' : 'scale-y-0',
                    )}
                  />
                  {section.heading}
                </button>
              </li>
            );
          })}
          {!sections.length && (
            <li className="space-y-2 px-2 pt-1">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton h-3" style={{ width: `${88 - i * 9}%` }} />
              ))}
            </li>
          )}
        </ul>
      </nav>

      {/* ---- document ------------------------------------------------------ */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-7 sm:px-10">
          <div className="mb-7 flex flex-wrap items-center gap-2">
            {scenario && (
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('size-1.5 rounded-full', TONE_BG[tone])} />
                <span className={cn('text-xs font-semibold', TONE_TEXT[tone])}>
                  {AWARENESS[scenario]?.label ?? scenario}
                </span>
              </span>
            )}

            <Divider orientation="vertical" className="mx-0.5 h-3.5 self-center" />

            {badge === 'complete' && <Badge tone="positive">Complete</Badge>}
            {badge === 'repaired' && (
              <Hint label="One or more sections came back thin and were expanded before saving.">
                <span>
                  <Badge tone="caution">Repaired</Badge>
                </span>
              </Hint>
            )}
            {badge === 'failed' && <Badge tone="critical">Needs review</Badge>}
            {doc?.status === 'stale' && (
              <Hint label="The brief was edited after this was written, so it no longer matches. Rebuild before sending it anywhere.">
                <span>
                  <Badge tone="caution">Brief changed</Badge>
                </span>
              </Hint>
            )}
            {state.regulated && <Badge tone="neutral">Regulated</Badge>}

            <div className="ml-auto flex items-center gap-1">
              {doc && <CopyButton text={markdown} label="Copy" />}
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

          {liveDoc?.error && <Callout tone="critical" body={liveDoc.error} />}

          {doc?.errorMessage && doc.badge === 'failed' && !liveDoc?.error && (
            <Callout tone="caution" body={doc.errorMessage} />
          )}

          {streaming && (
            <div className="mb-6 flex items-center gap-2.5">
              <Spinner className={cn('size-3.5', TONE_TEXT[tone])} />
              <span className="text-sm text-fg-muted">{phaseLabel(liveDoc)}</span>
            </div>
          )}

          {loading && !markdown && <DocumentSkeleton />}

          <article className="prose-icp">
            {sections.length
              ? sections.map((section) => (
                  <section key={section.anchor} className="group/section">
                    <SectionHeading section={section} />
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{section.body}</ReactMarkdown>
                    <div className="mt-1.5 flex justify-end opacity-0 transition-opacity duration-base focus-within:opacity-100 group-hover/section:opacity-100">
                      <CopyButton
                        text={`${'#'.repeat(section.level)} ${section.heading}\n\n${section.body}`}
                        label="Copy section"
                      />
                    </div>
                  </section>
                ))
              : !loading && <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>}
            {streaming && <span className="streaming-caret" aria-hidden />}
          </article>

          {doc && (
            <footer className="mt-12 border-t border-line pt-4">
              <p className="mono text-2xs tabular text-fg-subtle">
                {doc.wordCount.toLocaleString()} words · master prompt {doc.masterPromptVersion}
              </p>
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

/** Shaped like the document that is coming, not a generic grey box. */
function DocumentSkeleton() {
  return (
    <div className="space-y-9" aria-label="Loading profile">
      <div className="space-y-3">
        <div className="skeleton h-7 w-[70%]" />
        <div className="skeleton h-3.5 w-[34%]" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3">
          <div className="skeleton h-2.5 w-[22%]" />
          <SkeletonText lines={4} />
        </div>
      ))}
    </div>
  );
}

function Callout({ tone, body }: { tone: 'critical' | 'caution'; body: string }) {
  return (
    <div
      className={cn(
        'mb-6 flex items-start gap-2.5 rounded-lg border px-4 py-3 animate-rise',
        tone === 'critical'
          ? 'border-critical/25 bg-critical/[0.06]'
          : 'border-caution/25 bg-caution/[0.07]',
      )}
    >
      <AlertCircle
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'critical' ? 'text-critical' : 'text-caution',
        )}
      />
      <p className="text-base leading-relaxed text-fg-secondary">{body}</p>
    </div>
  );
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
    <div className="mx-auto max-w-6xl px-6 py-9 sm:px-8">
      <header className="stagger mb-7 max-w-2xl">
        <Eyebrow className="mb-2.5">Awareness map</Eyebrow>
        <h2 className="display text-3xl text-balance text-fg">{comparison.serviceName}</h2>
        <p className="mt-2.5 text-md leading-relaxed text-pretty text-fg-muted">
          The same buyer, four different conversations. The message that wins one stage is usually
          the message that loses another — that is what this table is for.
        </p>
      </header>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface-1 shadow-e1">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <thead>
            <tr className="bg-surface-2">
              {COMPARISON_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className="border-b border-line px-4 py-3 text-2xs font-semibold uppercase tracking-[0.09em] text-fg-muted"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {comparison.rows.map((row) => {
              const tone = stageTone(row.scenario);
              return (
                <tr
                  key={row.scenario}
                  className="group align-top transition-colors duration-fast hover:bg-surface-2/60"
                >
                  {COMPARISON_COLUMNS.map((column, index) => (
                    <td
                      key={column.key}
                      className={cn(
                        'relative border-b border-line-subtle px-4 py-4 text-base leading-relaxed',
                        column.key === 'awarenessLabel' && 'whitespace-nowrap font-medium text-fg',
                        column.key === 'messageThatBackfires' && 'text-fg-muted',
                      )}
                    >
                      {/* Spectral spine on the leading cell — the row's identity. */}
                      {index === 0 && (
                        <span
                          aria-hidden
                          className={cn(
                            'absolute inset-y-3 left-0 w-0.5 rounded-full',
                            TONE_BG[tone],
                          )}
                        />
                      )}
                      {String(row[column.key] ?? '')}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = React.useState(false);

  return (
    <Button
      variant="ghost"
      size="xs"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          /* clipboard is permission-gated; a silent no-op beats an error toast */
        }
      }}
    >
      {copied ? <Check className="text-positive" /> : <Copy />}
      {copied ? 'Copied' : label}
    </Button>
  );
}
