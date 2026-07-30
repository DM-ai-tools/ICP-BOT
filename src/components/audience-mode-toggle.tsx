'use client';

/**
 * The master switch: who is on the other side of the conversation.
 *
 * This changes more than tone. In Client mode the bot explains each thing as it
 * comes up, and when a message gives it nothing to work with it asks for one
 * small thing rather than listing everything it needs — which is the moment a
 * non-marketer would otherwise give up.
 *
 * It applies instance-wide and takes effect on the next message, including in
 * conversations already in progress.
 */
import * as React from 'react';
import { Check } from 'lucide-react';
import { AUDIENCE_MODES, type AudienceMode } from '@/lib/settings-shared';
import { Spinner } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export function AudienceModeToggle({ initial }: { initial: AudienceMode }) {
  const [mode, setMode] = React.useState<AudienceMode>(initial);
  const [saving, setSaving] = React.useState<AudienceMode | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const choose = async (next: AudienceMode) => {
    if (next === mode || saving) return;

    const previous = mode;
    setMode(next); // optimistic — the switch should feel instant
    setSaving(next);
    setError(null);

    try {
      const response = await fetch('/api/admin/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audienceMode: next }),
      });
      if (!response.ok) throw new Error('could not save');
    } catch {
      setMode(previous); // put it back rather than lying about the state
      setError('Could not save that. Try again.');
    } finally {
      setSaving(null);
    }
  };

  return (
    <section className="mt-9">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[15px] font-semibold tracking-tight">Who&rsquo;s using it</h2>
        <p className="text-[12px] text-muted-foreground">
          Applies to every conversation, from the next message
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {AUDIENCE_MODES.map((option) => {
          const active = mode === option.key;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => void choose(option.key)}
              aria-pressed={active}
              className={cn(
                'rounded-xl border-2 p-4 text-left transition-all duration-150 focus-ring',
                active
                  ? 'border-accent/60 bg-accent/[0.06] shadow-sm'
                  : 'border-border bg-card hover:border-muted-foreground/35',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-semibold text-foreground">{option.label}</span>
                {saving === option.key ? (
                  <Spinner className="h-4 w-4 text-accent" />
                ) : active ? (
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-accent text-accent-foreground">
                    <Check className="h-3 w-3 stroke-[3]" />
                  </span>
                ) : null}
              </span>
              <span className="mt-1.5 block text-[13px] leading-relaxed text-muted-foreground text-pretty">
                {option.blurb}
              </span>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-2 text-[12.5px] text-destructive">{error}</p>}
    </section>
  );
}
