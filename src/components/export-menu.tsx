'use client';

/**
 * Download menu: a scenario × format matrix.
 *
 * Everything starts selected — the common case is "give me all of it" and that
 * has to stay one click — but any cell can be switched off, so PDFs-only across
 * every stage, or one stage in both formats, takes a couple of clicks and
 * generates nothing you did not ask for. Green means it goes in the zip.
 */
import * as React from 'react';
import { Check, Download, Layers } from 'lucide-react';
import { awarenessShort, stageTone } from '@/lib/awareness';
import type { RunState } from '@/lib/types';
import { Button, Divider, Eyebrow } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type ExportFormat = 'pdf' | 'xlsx';

/**
 * Two formats: PDF to read and send, Excel to work with field-by-field.
 * The awareness map is still a Word document and has its own button below.
 */
const FORMATS: { key: ExportFormat; label: string; code: string }[] = [
  { key: 'pdf', label: 'PDF', code: 'p' },
  { key: 'xlsx', label: 'Excel', code: 'x' },
];

type Matrix = Record<string, Record<ExportFormat, boolean>>;

const ALL_ON: Record<ExportFormat, boolean> = { pdf: true, xlsx: true };

/** Spectral marker per scenario, matching the results tabs. */
const TONE = ['', 'bg-stage-1', 'bg-stage-2', 'bg-stage-3', 'bg-stage-4'] as const;

export function ExportMenu({ state }: { state: RunState }) {
  const ready = React.useMemo(
    () => state.documents.filter((d) => ['complete', 'repaired', 'failed'].includes(d.status)),
    [state.documents],
  );

  const [open, setOpen] = React.useState(false);
  const [matrix, setMatrix] = React.useState<Matrix>({});

  // Every newly-generated document arrives selected in both formats.
  React.useEffect(() => {
    setMatrix((prev) => {
      const next: Matrix = {};
      for (const doc of ready) next[doc.id] = prev[doc.id] ?? { ...ALL_ON };
      return next;
    });
  }, [ready]);

  if (!ready.length) return null;

  const isOn = (id: string, format: ExportFormat) => matrix[id]?.[format] ?? false;

  const toggleCell = (id: string, format: ExportFormat) =>
    setMatrix((m) => ({ ...m, [id]: { ...m[id], [format]: !m[id]?.[format] } }));

  const toggleRow = (id: string) => {
    const allOn = FORMATS.every((f) => isOn(id, f.key));
    setMatrix((m) => ({ ...m, [id]: { pdf: !allOn, xlsx: !allOn } }));
  };

  const toggleColumn = (format: ExportFormat) => {
    const allOn = ready.every((d) => isOn(d.id, format));
    setMatrix((m) => {
      const next = { ...m };
      for (const doc of ready) next[doc.id] = { ...next[doc.id], [format]: !allOn };
      return next;
    });
  };

  const selectAll = () => {
    const next: Matrix = {};
    for (const doc of ready) next[doc.id] = { ...ALL_ON };
    setMatrix(next);
  };

  const selectedCount = ready.reduce(
    (sum, doc) => sum + FORMATS.filter((f) => isOn(doc.id, f.key)).length,
    0,
  );

  // Compact encoding: docId:px,docId2:p — spelling out cuids and format names
  // for a full matrix would push the query string past what some proxies
  // forward happily.
  const include = ready
    .map((doc) => {
      const codes = FORMATS.filter((f) => isOn(doc.id, f.key))
        .map((f) => f.code)
        .join('');
      return codes ? `${doc.id}:${codes}` : null;
    })
    .filter(Boolean)
    .join(',');

  const base = `/api/export?runId=${encodeURIComponent(state.id)}`;
  const zipHref = `${base}&format=zip&include=${encodeURIComponent(include)}`;
  const multiService = (state.slots.services?.length ?? 0) > 1;

  return (
    <div className="relative shrink-0">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        <Download />
        Download
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />

          <div className="panel-float absolute right-0 top-full z-popover mt-2 w-[23rem] max-w-[calc(100vw-2rem)] overflow-hidden p-2 animate-slide-down">
            <div className="flex items-baseline justify-between gap-2 px-1.5 pb-1.5 pt-0.5">
              <p className="eyebrow">
                Choose what to include
              </p>
              <button
                type="button"
                onClick={selectAll}
                className="text-xs text-fg-subtle underline underline-offset-2 transition-colors hover:text-fg"
              >
                Select all
              </button>
            </div>

            {/* Column headers double as whole-column toggles. */}
            <div className="flex items-center gap-1 px-1.5 pb-1">
              <span className="flex-1" />
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => toggleColumn(f.key)}
                  title={`Toggle ${f.label} for every scenario`}
                  className="w-[60px] rounded-sm py-0.5 text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle transition-colors hover:text-fg"
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="max-h-64 overflow-y-auto">
              {ready.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors duration-fast hover:bg-surface-2"
                >
                  <button
                    type="button"
                    onClick={() => toggleRow(doc.id)}
                    title="Toggle every format for this scenario"
                    className="flex min-w-0 flex-1 items-center gap-2 truncate rounded-sm text-left text-sm font-medium text-fg hover:underline"
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", TONE[stageTone(doc.scenario)])} />
                    {awarenessShort(doc.scenario)}
                    {multiService && (
                      <span className="ml-1 font-normal text-fg-muted">
                        {doc.serviceName}
                      </span>
                    )}
                  </button>

                  {FORMATS.map((f) => {
                    const on = isOn(doc.id, f.key);
                    return (
                      <button
                        key={f.key}
                        type="button"
                        aria-pressed={on}
                        aria-label={`${f.label} for ${doc.awarenessLabel}`}
                        onClick={() => toggleCell(doc.id, f.key)}
                        className={cn(
                          'h-7 w-[60px] rounded-sm border text-2xs font-semibold uppercase tracking-wide transition-all duration-fast ease-snap',
                          on
                            ? 'border-positive/45 bg-positive/12 text-positive'
                            : 'border-line text-fg-subtle/60 hover:border-line-strong hover:text-fg-muted',
                        )}
                      >
                        {on ? <Check className="mx-auto size-3.5 stroke-[3]" /> : f.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="mt-2 space-y-1 border-t border-line pt-2">
              <a
                href={selectedCount ? zipHref : undefined}
                onClick={(event) => {
                  if (!selectedCount) event.preventDefault();
                  else setOpen(false);
                }}
                aria-disabled={selectedCount === 0}
                className={cn(
                  'flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 transition-colors',
                  selectedCount
                    ? 'bg-accent text-accent-foreground hover:brightness-110'
                    : 'pointer-events-none bg-surface-3 text-fg-subtle opacity-60',
                )}
              >
                <span className="flex items-center gap-2 text-base font-medium">
                  <Download className="size-4" />
                  Download ZIP
                </span>
                <span className="mono text-xs tabular">
                  {selectedCount} file{selectedCount === 1 ? '' : 's'}
                </span>
              </a>

              <a
                href={`${base}&format=map-docx`}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 rounded-md px-2.5 py-2 transition-colors duration-fast hover:bg-surface-2"
              >
                <Layers className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0">
                  <span className="block text-base font-medium text-fg">Awareness map (DOCX)</span>
                  <span className="block text-xs leading-snug text-fg-muted">
                    Cover, comparison table, every scenario as a chapter
                  </span>
                </span>
              </a>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
