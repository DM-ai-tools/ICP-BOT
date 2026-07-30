'use client';

/**
 * Download menu: a scenario × format matrix.
 *
 * Everything starts selected — the common case is "give me all of it" and that
 * has to stay one click — but any cell can be switched off, so you can take
 * PDFs only, or drop markdown before a client handover, without generating
 * files nobody asked for. Green means it goes in the zip.
 */
import * as React from 'react';
import { Check, Download, Layers } from 'lucide-react';
import { awarenessShort } from '@/lib/awareness';
import type { RunState } from '@/lib/types';
import { Button } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

type ExportFormat = 'docx' | 'pdf' | 'md';

const FORMATS: { key: ExportFormat; label: string; code: string }[] = [
  { key: 'docx', label: 'DOCX', code: 'd' },
  { key: 'pdf', label: 'PDF', code: 'p' },
  { key: 'md', label: 'MD', code: 'm' },
];

type Matrix = Record<string, Record<ExportFormat, boolean>>;

const ALL_ON: Record<ExportFormat, boolean> = { docx: true, pdf: true, md: true };

export function ExportMenu({ state }: { state: RunState }) {
  const ready = React.useMemo(
    () => state.documents.filter((d) => ['complete', 'repaired', 'failed'].includes(d.status)),
    [state.documents],
  );

  const [open, setOpen] = React.useState(false);
  const [matrix, setMatrix] = React.useState<Matrix>({});

  // Every newly-generated document arrives selected in all three formats.
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
    setMatrix((m) => ({ ...m, [id]: { docx: !allOn, pdf: !allOn, md: !allOn } }));
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

  // Compact encoding: docId:dpm,docId2:p — spelling out cuids and format names
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

          <div className="absolute right-0 top-full z-50 mt-2 w-[23rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-border bg-popover p-2 shadow-xl animate-slide-down">
            <div className="flex items-baseline justify-between gap-2 px-1.5 pb-1.5 pt-0.5">
              <p className="text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                Choose what to include
              </p>
              <button
                type="button"
                onClick={selectAll}
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
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
                  className="w-[52px] text-[10px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="max-h-64 overflow-y-auto">
              {ready.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center gap-1 rounded-lg px-1.5 py-1 hover:bg-secondary/50"
                >
                  <button
                    type="button"
                    onClick={() => toggleRow(doc.id)}
                    title="Toggle every format for this scenario"
                    className="min-w-0 flex-1 truncate text-left text-[12.5px] font-medium hover:underline"
                  >
                    {awarenessShort(doc.scenario)}
                    {multiService && (
                      <span className="ml-1 font-normal text-muted-foreground">
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
                          'h-7 w-[52px] rounded-md border text-[10.5px] font-semibold uppercase tracking-wide transition-all',
                          on
                            ? 'border-stated/45 bg-stated/15 text-stated'
                            : 'border-border text-muted-foreground/50 hover:border-muted-foreground/40 hover:text-muted-foreground',
                        )}
                      >
                        {on ? <Check className="mx-auto h-3.5 w-3.5 stroke-[3]" /> : f.label}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>

            <div className="mt-2 space-y-1 border-t border-border pt-2">
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
                    ? 'bg-accent text-accent-foreground hover:bg-accent/90'
                    : 'pointer-events-none bg-secondary text-muted-foreground opacity-60',
                )}
              >
                <span className="flex items-center gap-2 text-[13px] font-medium">
                  <Download className="h-4 w-4" />
                  Download ZIP
                </span>
                <span className="text-[11.5px] tabular-nums">
                  {selectedCount} file{selectedCount === 1 ? '' : 's'}
                </span>
              </a>

              <a
                href={`${base}&format=map-docx`}
                onClick={() => setOpen(false)}
                className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 transition-colors hover:bg-secondary"
              >
                <Layers className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium">Awareness map (DOCX)</span>
                  <span className="block text-[11.5px] leading-snug text-muted-foreground">
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
