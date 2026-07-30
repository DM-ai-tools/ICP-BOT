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
        <h2 className="text-md font-semibold tracking-tight">Who&rsquo;s using it</h2>
        <p className="text-sm text-fg-muted">
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
                'rounded-xl border-2 p-4 text-left transition-all duration-fast focus-visible:ring-2 focus-visible:ring-ring/70',
                active
                  ? 'border-accent/60 bg-accent/[0.06] shadow-e1'
                  : 'border-line bg-surface-1 hover:border-line-strong',
              )}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="text-md font-semibold text-fg">{option.label}</span>
                {saving === option.key ? (
                  <Spinner className="size-4 text-accent" />
                ) : active ? (
                  <span className="grid size-5 place-items-center rounded-full bg-accent text-accent-foreground">
                    <Check className="size-3 stroke-[3]" />
                  </span>
                ) : null}
              </span>
              <span className="mt-1.5 block text-base leading-relaxed text-fg-muted text-pretty">
                {option.blurb}
              </span>
            </button>
          );
        })}
      </div>

      {error && <p className="mt-2 text-sm text-critical">{error}</p>}
    </section>
  );
}
