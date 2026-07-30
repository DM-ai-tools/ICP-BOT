'use client';

/**
 * The awareness modal.
 *
 * Awareness is the one slot never asked in prose. When the conversation settles
 * it, this never opens. Otherwise it blocks generation — the user cannot
 * generate around it.
 *
 * Contents: four checkbox cards in a 2x2, ALL PRE-CHECKED, a live document
 * count, and one primary button. The default path is a single click to four
 * documents. Nothing else lives in here.
 */
import * as React from 'react';
import { Sparkles } from 'lucide-react';
import {
  AWARENESS,
  MODAL_CARDS,
  READY_TO_BUY_SCENARIO,
  scenariosFromModal,
} from '@/lib/awareness';
import type { AwarenessKey } from '@/lib/slots';
import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Switch,
} from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

interface AwarenessModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onGenerate: (scenarios: AwarenessKey[]) => void;
  busy?: boolean;
  serviceCount?: number;
}

export function AwarenessModal({
  open,
  onOpenChange,
  onGenerate,
  busy,
  serviceCount = 1,
}: AwarenessModalProps) {
  // All pre-checked. One click is the intended path.
  const [checked, setChecked] = React.useState<Set<AwarenessKey>>(new Set(MODAL_CARDS));
  const [readyToBuy, setReadyToBuy] = React.useState(false);

  React.useEffect(() => {
    if (open) {
      setChecked(new Set(MODAL_CARDS));
      setReadyToBuy(false);
    }
  }, [open]);

  const scenarios = React.useMemo(
    () => scenariosFromModal({ cards: [...checked], readyToBuy }),
    [checked, readyToBuy],
  );

  const documentCount = scenarios.length * Math.max(1, serviceCount);
  const canGenerate = scenarios.length > 0 && !busy;

  const toggle = (key: AwarenessKey) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="pr-8">
          <DialogTitle>Which awareness stages should I build?</DialogTitle>
          <DialogDescription>
            The same buyer needs a completely different opening depending on what they already
            know. Each stage becomes its own profile.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {MODAL_CARDS.map((key) => {
            const scenario = AWARENESS[key];
            const isChecked = checked.has(key);
            const isBothAware = key === 'product_aware';

            return (
              <div
                key={key}
                className={cn(
                  'group relative rounded-xl border-2 p-4 text-left transition-all duration-150',
                  isChecked
                    ? 'border-accent/60 bg-accent/[0.06] shadow-sm'
                    : 'border-border bg-card hover:border-muted-foreground/35',
                )}
              >
                <button
                  type="button"
                  onClick={() => toggle(key)}
                  aria-pressed={isChecked}
                  className="flex w-full items-start gap-3 text-left focus-ring rounded-lg"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => toggle(key)}
                    onClick={(event) => event.stopPropagation()}
                    className="mt-0.5"
                    aria-label={scenario.cardTitle}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-semibold leading-tight text-foreground">
                      {scenario.cardTitle}
                    </span>
                    <span className="mt-1 block text-[13px] leading-snug text-muted-foreground text-pretty">
                      {scenario.cardSubtitle}
                    </span>
                    <span className="mt-2.5 block text-[11px] font-medium uppercase tracking-wider text-accent/90">
                      {scenario.label}
                    </span>
                  </span>
                </button>

                {isBothAware && (
                  <label
                    className={cn(
                      'mt-3 flex items-center justify-between gap-3 rounded-lg border border-border/70 bg-background/60 px-3 py-2 transition-opacity',
                      !isChecked && 'pointer-events-none opacity-40',
                    )}
                  >
                    <span className="text-[12.5px] leading-snug text-muted-foreground">
                      Also build{' '}
                      <span className="font-medium text-foreground">ready to buy</span> —{' '}
                      {AWARENESS[READY_TO_BUY_SCENARIO].label}
                    </span>
                    <Switch
                      checked={readyToBuy}
                      onCheckedChange={setReadyToBuy}
                      disabled={!isChecked}
                      aria-label="Also build the most aware stage"
                    />
                  </label>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p
            className="text-sm tabular-nums text-muted-foreground"
            aria-live="polite"
            aria-atomic="true"
          >
            <span className="font-semibold text-foreground">
              {documentCount} document{documentCount === 1 ? '' : 's'}
            </span>
            {serviceCount > 1 && (
              <span>
                {' '}
                · {scenarios.length} stage{scenarios.length === 1 ? '' : 's'} × {serviceCount}{' '}
                services
              </span>
            )}
            {scenarios.length === 0 && <span> · pick at least one stage</span>}
          </p>

          <Button
            size="lg"
            variant="accent"
            disabled={!canGenerate}
            onClick={() => onGenerate(scenarios)}
            className="w-full sm:w-auto"
          >
            <Sparkles />
            {busy ? 'Starting…' : 'Generate awareness map'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
