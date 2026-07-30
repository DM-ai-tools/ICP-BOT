'use client';

/**
 * The live brief.
 *
 * This is where progress is visible — which is precisely why the chat never
 * narrates it. Every value is click-to-edit, and every value carries its
 * provenance: told to me, worked out, or still open.
 */
import * as React from 'react';
import { AlertTriangle, Check, Pencil, ShieldAlert, Sparkles, X } from 'lucide-react';
import {
  AWARENESS,
} from '@/lib/awareness';
import {
  SERVICE_CAP,
  SLOT_ENUM_OPTIONS,
  SLOT_SPECS,
  isEmptySlot,
  slotDisplayValue,
  type ServiceSlot,
  type SlotKey,
  type SlotMeta,
  type SlotValues,
} from '@/lib/slots';
import type { RunState } from '@/lib/types';
import {
  Badge,
  Button,
  Input,
  Spinner,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const PANEL_ORDER: SlotKey[] = [
  'company_name',
  'website_url',
  'company_type',
  'industry',
  'business_model',
  'audience_type',
  'region',
  'services',
  'maturity_tier',
  'awareness_level',
  'offer_type',
  'size_band',
  'notes',
];

const OPTIONAL_KEYS = new Set<SlotKey>(['offer_type', 'size_band', 'notes', 'website_url']);

interface BriefPanelProps {
  state: RunState | null;
  onEdit: (key: SlotKey, value: unknown) => Promise<void>;
  onOpenAwareness: () => void;
  busy?: boolean;
}

export function BriefPanel({ state, onEdit, onOpenAwareness, busy }: BriefPanelProps) {
  const [editing, setEditing] = React.useState<SlotKey | null>(null);
  const [saving, setSaving] = React.useState<SlotKey | null>(null);

  const slots = state?.slots ?? {};
  const meta = state?.slotMeta ?? {};

  const filled = PANEL_ORDER.filter(
    (key) => !OPTIONAL_KEYS.has(key) && !isEmptySlot(key, (slots as Record<string, unknown>)[key]),
  ).length;
  const total = PANEL_ORDER.filter((key) => !OPTIONAL_KEYS.has(key)).length;

  const handleSave = async (key: SlotKey, value: unknown) => {
    setSaving(key);
    try {
      await onEdit(key, value);
      setEditing(null);
    } finally {
      setSaving(null);
    }
  };

  return (
    <aside className="flex h-full flex-col overflow-hidden border-l border-border bg-surface/60">
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            The brief
          </h2>
          <span className="text-xs tabular-nums text-muted-foreground/80">
            {filled}/{total}
          </span>
        </div>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-border">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-500 ease-out"
            style={{ width: `${total ? (filled / total) * 100 : 0}%` }}
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {state?.regulated && (
          <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-inferred/30 bg-inferred/[0.07] px-3 py-2.5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-inferred" />
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              <span className="font-medium text-foreground">Regulated industry</span>
              {state.regulatedReason ? ` (${state.regulatedReason})` : ''}. Compliance-aware
              language is enforced — no guarantees, no invented outcomes.
            </p>
          </div>
        )}

        {state?.siteFetchStatus === 'failed' && (
          <div className="mb-3 flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <p className="text-[12.5px] leading-snug text-muted-foreground">
              Couldn&rsquo;t read that website. Everything else is unaffected.
            </p>
          </div>
        )}

        <div className="space-y-0.5">
          {PANEL_ORDER.map((key) => (
            <SlotRow
              key={key}
              slotKey={key}
              slots={slots}
              meta={meta}
              editing={editing === key}
              saving={saving === key}
              onStartEdit={() => setEditing(key)}
              onCancel={() => setEditing(null)}
              onSave={(value) => handleSave(key, value)}
              onOpenAwareness={onOpenAwareness}
            />
          ))}
        </div>

        {state?.ambiguities && state.ambiguities.length > 0 && (
          <div className="mt-4 rounded-lg border border-border bg-card px-3 py-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Open questions
            </p>
            <ul className="space-y-1">
              {state.ambiguities.slice(0, 4).map((item, index) => (
                <li key={index} className="text-[12.5px] leading-snug text-muted-foreground">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-border px-4 py-3.5">
        {state?.readiness.readyToGenerate ? (
          <Button
            variant="accent"
            className="w-full"
            onClick={onOpenAwareness}
            disabled={busy}
          >
            {busy ? <Spinner /> : <Sparkles />}
            {state.documents.length ? 'Build more scenarios' : 'Choose awareness stages'}
          </Button>
        ) : (
          <p className="text-center text-[12.5px] leading-snug text-muted-foreground">
            {state?.readiness.missingRequired.length
              ? 'Keep talking — the brief fills itself in.'
              : 'Tell me about your business to get started.'}
          </p>
        )}

        {state && state.usage.costUsd > 0 && (
          <p className="mt-2.5 text-center text-[11px] tabular-nums text-muted-foreground/60">
            {(state.usage.promptTokens + state.usage.completionTokens).toLocaleString()} tokens ·{' '}
            {state.usage.costUsd < 0.01 ? '<$0.01' : `$${state.usage.costUsd.toFixed(2)}`}
          </p>
        )}
      </footer>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface SlotRowProps {
  slotKey: SlotKey;
  slots: SlotValues;
  meta: SlotMeta;
  editing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: unknown) => void;
  onOpenAwareness: () => void;
}

function SlotRow({
  slotKey,
  slots,
  meta,
  editing,
  saving,
  onStartEdit,
  onCancel,
  onSave,
  onOpenAwareness,
}: SlotRowProps) {
  const spec = SLOT_SPECS.find((s) => s.key === slotKey);
  const value = (slots as Record<string, unknown>)[slotKey];
  const empty = isEmptySlot(slotKey, value);
  const entry = meta[slotKey];
  const display = slotDisplayValue(slotKey, slots);

  const source = empty ? 'missing' : (entry?.source ?? 'stated');
  const isOptional = OPTIONAL_KEYS.has(slotKey);

  if (editing) {
    return (
      <div className="rounded-lg border border-accent/40 bg-card px-3 py-2.5 animate-fade-in">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {spec?.label ?? slotKey}
        </p>
        <SlotEditor
          slotKey={slotKey}
          slots={slots}
          saving={saving}
          onCancel={onCancel}
          onSave={onSave}
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-card',
        empty && 'opacity-60',
      )}
    >
      <SourceDot source={source} justification={entry?.justification} confidence={entry?.confidence} />

      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {spec?.label ?? slotKey}
          {isOptional && empty && <span className="ml-1 normal-case tracking-normal">· optional</span>}
        </p>

        {empty ? (
          <p className="mt-0.5 text-[13px] italic text-muted-foreground/70">
            {slotKey === 'awareness_level' ? 'chosen in the picker' : 'not set'}
          </p>
        ) : (
          <p className="mt-0.5 break-words text-[13.5px] leading-snug text-foreground">
            {slotKey === 'awareness_level' && typeof value === 'string'
              ? (AWARENESS[value as keyof typeof AWARENESS]?.label ?? display)
              : display}
          </p>
        )}
      </div>

      {slotKey === 'awareness_level' ? (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onOpenAwareness}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Choose awareness stages"
        >
          <Sparkles />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onStartEdit}
          className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Edit ${spec?.label ?? slotKey}`}
        >
          <Pencil />
        </Button>
      )}
    </div>
  );
}

function SourceDot({
  source,
  justification,
  confidence,
}: {
  source: string;
  justification?: string;
  confidence?: number;
}) {
  const colours: Record<string, string> = {
    stated: 'bg-stated',
    inferred: 'bg-inferred',
    default: 'bg-inferred/60',
    missing: 'bg-missing/50',
  };

  const labels: Record<string, string> = {
    stated: 'You told me this',
    inferred: 'I worked this out',
    default: 'Framework default',
    missing: 'Still open',
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn('mt-[7px] h-2 w-2 shrink-0 cursor-help rounded-full', colours[source])}
          aria-label={labels[source]}
        />
      </TooltipTrigger>
      <TooltipContent side="left">
        <span className="font-medium">{labels[source]}</span>
        {justification && <span className="mt-1 block text-muted-foreground">{justification}</span>}
        {source === 'inferred' && typeof confidence === 'number' && (
          <span className="mt-1 block text-muted-foreground">
            Confidence {Math.round(confidence * 100)}%
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

function SlotEditor({
  slotKey,
  slots,
  saving,
  onCancel,
  onSave,
}: {
  slotKey: SlotKey;
  slots: SlotValues;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: unknown) => void;
}) {
  const options = SLOT_ENUM_OPTIONS[slotKey];

  if (options) {
    const current = (slots as Record<string, unknown>)[slotKey] as string | null;
    return (
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={saving}
            onClick={() => onSave(option.value)}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-[12.5px] font-medium transition-colors focus-ring',
              current === option.value
                ? 'border-accent bg-accent/15 text-foreground'
                : 'border-border bg-background hover:border-muted-foreground/40',
            )}
          >
            {option.label}
          </button>
        ))}
        <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Cancel">
          <X />
        </Button>
      </div>
    );
  }

  if (slotKey === 'services') {
    return <ServicesEditor slots={slots} saving={saving} onCancel={onCancel} onSave={onSave} />;
  }

  return <TextEditor slotKey={slotKey} slots={slots} saving={saving} onCancel={onCancel} onSave={onSave} />;
}

function TextEditor({
  slotKey,
  slots,
  saving,
  onCancel,
  onSave,
}: {
  slotKey: SlotKey;
  slots: SlotValues;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: unknown) => void;
}) {
  const initial = ((slots as Record<string, unknown>)[slotKey] as string | null) ?? '';
  const [draft, setDraft] = React.useState(initial);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-1.5">
      <Input
        ref={inputRef}
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSave(draft.trim() || null);
          if (event.key === 'Escape') onCancel();
        }}
        className="h-8 text-[13px]"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={saving}
        onClick={() => onSave(draft.trim() || null)}
        aria-label="Save"
      >
        {saving ? <Spinner className="h-3.5 w-3.5" /> : <Check />}
      </Button>
      <Button variant="ghost" size="icon-sm" onClick={onCancel} aria-label="Cancel">
        <X />
      </Button>
    </div>
  );
}

function ServicesEditor({
  slots,
  saving,
  onCancel,
  onSave,
}: {
  slots: SlotValues;
  saving: boolean;
  onCancel: () => void;
  onSave: (value: unknown) => void;
}) {
  const [draft, setDraft] = React.useState<ServiceSlot[]>(() => {
    const existing = slots.services ?? [];
    return existing.length ? existing.map((s) => ({ ...s })) : [{ name: '', price_terms: null }];
  });

  const update = (index: number, patch: Partial<ServiceSlot>) => {
    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  return (
    <div className="space-y-2">
      {draft.map((service, index) => (
        <div key={index} className="space-y-1.5 rounded-md border border-border bg-background p-2">
          <Input
            value={service.name}
            placeholder="Service name"
            disabled={saving}
            onChange={(event) => update(index, { name: event.target.value })}
            className="h-8 text-[13px]"
          />
          <Input
            value={service.price_terms ?? ''}
            placeholder="Price / terms — leave blank if not set"
            disabled={saving}
            onChange={(event) => update(index, { price_terms: event.target.value || null })}
            className="h-8 text-[13px]"
          />
          {draft.length > 1 && (
            <button
              type="button"
              onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
              className="text-[11.5px] text-muted-foreground underline underline-offset-2 hover:text-destructive"
            >
              Remove
            </button>
          )}
        </div>
      ))}

      <div className="flex items-center justify-between gap-2">
        {draft.length < SERVICE_CAP ? (
          <button
            type="button"
            onClick={() => setDraft((prev) => [...prev, { name: '', price_terms: null }])}
            className="text-[12px] font-medium text-accent underline underline-offset-2"
          >
            Add service
          </button>
        ) : (
          <span className="text-[11.5px] text-muted-foreground">Maximum {SERVICE_CAP}</span>
        )}

        <div className="flex items-center gap-1">
          <Button
            size="xs"
            disabled={saving}
            onClick={() => onSave(draft.filter((s) => s.name.trim()))}
          >
            {saving ? <Spinner className="h-3 w-3" /> : 'Save'}
          </Button>
          <Button variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      <p className="text-[11.5px] leading-snug text-muted-foreground">
        A blank price is fine — documents will say &ldquo;quote/assessment required&rdquo; rather
        than inventing a number.
      </p>
    </div>
  );
}
