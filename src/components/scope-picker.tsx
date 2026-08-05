'use client';

/**
 * The scope choice.
 *
 * Appears once, when the site turns out to sell several distinct things and the
 * brief is otherwise ready. It exists because generating one profile for a
 * mortgage broker with seventeen loan products averages a first home buyer and
 * a property developer into a person who does not exist — and only the
 * strategist knows which of those two the client is actually paying for.
 *
 * Three options, because there are genuinely three answers: the business, some
 * of its offers, or both. Everything is ticked off the client's own website, so
 * the list is theirs, not ours — and every row shows where it came from.
 */
import * as React from 'react';
import { Check, ExternalLink, Layers, Loader2, X } from 'lucide-react';
import {
  MAX_FOCUSED_SERVICES,
  SCOPE_CHOICES,
  groupServices,
  type DiscoveredService,
  type ScopeChoice,
} from '@/lib/discover-types';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Eyebrow,
} from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export interface ScopePickerProps {
  open: boolean;
  companyName: string | null;
  services: DiscoveredService[];
  pagesRead: number;
  busy?: boolean;
  onSubmit: (choice: ScopeChoice, slugs: string[]) => void;
  onDismiss: () => void;
}

export function ScopePicker({
  open,
  companyName,
  services,
  pagesRead,
  busy,
  onSubmit,
  onDismiss,
}: ScopePickerProps) {
  const [choice, setChoice] = React.useState<ScopeChoice>('both');
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());

  // Everything ticked by default. The strategist is far more likely to remove
  // one or two than to hand-pick eleven, and an empty list reads as a chore.
  React.useEffect(() => {
    if (!open) return;
    setSelected(new Set(services.slice(0, MAX_FOCUSED_SERVICES).map((s) => s.slug)));
  }, [open, services]);

  const grouped = React.useMemo(() => groupServices(services), [services]);
  const needsTicks = choice !== 'generic';
  const allSelected = selected.size === services.length && services.length > 0;
  const overCap = selected.size > MAX_FOCUSED_SERVICES;

  const toggle = (slug: string) => {
    setSelected((prior) => {
      const next = new Set(prior);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prior) => (prior.size === services.length ? new Set() : new Set(services.map((s) => s.slug))));
  };

  const documentCount =
    (choice === 'generic' ? 1 : choice === 'both' ? 1 + selected.size : selected.size) * 4;

  const canSubmit = !busy && (!needsTicks || (selected.size > 0 && !overCap));

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onDismiss()}>
      <DialogContent className="flex max-h-[88dvh] w-[min(46rem,94vw)] flex-col gap-0 overflow-hidden p-0">
        <header className="shrink-0 border-b border-line px-6 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <Eyebrow className="flex items-center gap-1.5">
                <Layers className="size-3" />
                Several offers found
              </Eyebrow>
              <DialogTitle className="display mt-1.5 text-xl text-fg">
                {companyName ? `${companyName} sells more than one thing` : 'This site sells more than one thing'}
              </DialogTitle>
              <DialogDescription className="mt-1.5 text-sm leading-relaxed text-pretty text-fg-muted">
                Reading {pagesRead} page{pagesRead === 1 ? '' : 's'} of the site turned up{' '}
                <strong className="font-semibold text-fg-secondary">{services.length} distinct offers</strong>. These
                usually sell to different people, so one profile covering all of them would describe nobody. What do
                you want built?
              </DialogDescription>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={onDismiss} disabled={busy} aria-label="Skip">
              <X />
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-2">
            {SCOPE_CHOICES.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setChoice(option.value)}
                aria-pressed={choice === option.value}
                className={cn(
                  'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-all duration-fast',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70',
                  choice === option.value
                    ? 'border-accent/60 bg-accent/[0.06] shadow-e1'
                    : 'border-line bg-surface-1 hover:border-line-strong hover:bg-surface-2',
                )}
              >
                <span
                  className={cn(
                    'mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border transition-colors duration-fast',
                    choice === option.value ? 'border-accent bg-accent text-bg' : 'border-line-strong',
                  )}
                >
                  {choice === option.value && <Check className="size-2.5 stroke-[3]" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-md font-medium text-fg">{option.label}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-pretty text-fg-muted">
                    {option.blurb}
                  </span>
                </span>
              </button>
            ))}
          </div>

          {needsTicks && (
            <div className="mt-5">
              <div className="flex items-center justify-between gap-3 border-b border-line pb-2">
                <Eyebrow>Which offers</Eyebrow>
                <button
                  type="button"
                  onClick={toggleAll}
                  className="rounded text-2xs font-semibold uppercase tracking-[0.08em] text-fg-muted transition-colors duration-fast hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                >
                  {allSelected ? 'Clear all' : 'Select all'}
                </button>
              </div>

              {grouped.map(({ group, services: rows }) => (
                <section key={group ?? '_'} className="mt-3">
                  {group && (
                    <p className="px-1 pb-1 text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
                      {group}
                    </p>
                  )}
                  <ul className="space-y-px">
                    {rows.map((service) => {
                      const ticked = selected.has(service.slug);
                      return (
                        <li key={service.slug}>
                          <label
                            className={cn(
                              'flex cursor-pointer items-start gap-3 rounded-md px-2 py-2 transition-colors duration-fast',
                              ticked ? 'bg-surface-2' : 'hover:bg-surface-2/60',
                            )}
                          >
                            <Checkbox
                              checked={ticked}
                              onCheckedChange={() => toggle(service.slug)}
                              className="mt-0.5 shrink-0"
                              aria-label={service.name}
                            />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5">
                                <span className="text-sm font-medium text-fg">{service.name}</span>
                                {service.url && (
                                  <a
                                    href={service.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    onClick={(event) => event.stopPropagation()}
                                    className="text-fg-subtle transition-colors duration-fast hover:text-fg-muted"
                                    aria-label={`Open the ${service.name} page`}
                                  >
                                    <ExternalLink className="size-3" />
                                  </a>
                                )}
                              </span>
                              {service.summary && (
                                <span className="mt-0.5 block text-xs leading-snug text-pretty text-fg-muted">
                                  {service.summary}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}

              {overCap && (
                <p className="mt-3 rounded-md border border-caution/40 bg-caution/[0.07] px-3 py-2 text-xs text-fg-secondary">
                  {selected.size} ticked — a run covers at most {MAX_FOCUSED_SERVICES}. Untick{' '}
                  {selected.size - MAX_FOCUSED_SERVICES} of them, or build the rest in a second run.
                </p>
              )}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-surface-2 px-6 py-3.5">
          <p className="mono text-2xs leading-relaxed text-fg-subtle">
            {canSubmit ? (
              <>
                {documentCount} documents · 4 awareness stages each
                {choice !== 'generic' && selected.size > 0 && (
                  <>
                    <br />
                    Sub-service profiles run on the shorter two-pass path
                  </>
                )}
              </>
            ) : needsTicks && selected.size === 0 ? (
              'Tick at least one offer'
            ) : (
              ''
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onDismiss} disabled={busy}>
              Skip
            </Button>
            <Button
              size="sm"
              onClick={() => onSubmit(choice, choice === 'generic' ? [] : [...selected])}
              disabled={!canSubmit}
            >
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Confirm scope
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
