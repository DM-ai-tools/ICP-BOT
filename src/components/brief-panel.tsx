'use client';

/**
 * The live brief.
 *
 * This is where progress is visible, which is precisely why the chat never
 * narrates it. Every value is click-to-edit and carries its provenance — told
 * to me, worked out, or still open — as a coloured dot rather than a word, so
 * the column reads as one scannable stripe of state.
 *
 * The completion meter is the only ambient motion here. It moves when the brief
 * moves and at no other time, which is what makes it informative rather than
 * decorative.
 */
import * as React from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Pencil,
  PictureInPicture2,
  ShieldAlert,
  Sparkles,
  X,
} from 'lucide-react';
import { AWARENESS } from '@/lib/awareness';
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
  Button,
  Eyebrow,
  Hint,
  Input,
  Meter,
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

const OPTIONAL: ReadonlySet<SlotKey> = new Set<SlotKey>([
  'offer_type',
  'size_band',
  'notes',
  'website_url',
]);

/** The run of slots that actually gates generation. */
const REQUIRED_ORDER = PANEL_ORDER.filter((key) => !OPTIONAL.has(key));

interface BriefPanelProps {
  state: RunState | null;
  onEdit: (key: SlotKey, value: unknown) => Promise<void>;
  onBuild: () => void;
  busy?: boolean;
  docked?: boolean;
  onDock?: (docked: boolean) => void;
}

export function BriefPanel({
  state,
  onEdit,
  onBuild,
  busy,
  docked = true,
  onDock,
}: BriefPanelProps) {
  const [editing, setEditing] = React.useState<SlotKey | null>(null);
  const [saving, setSaving] = React.useState<SlotKey | null>(null);
  const [showOptional, setShowOptional] = React.useState(false);

  const slots = state?.slots ?? {};
  const meta = state?.slotMeta ?? {};

  const filled = REQUIRED_ORDER.filter(
    (key) => !isEmptySlot(key, (slots as Record<string, unknown>)[key]),
  ).length;
  const total = REQUIRED_ORDER.length;
  const pct = total ? (filled / total) * 100 : 0;
  const complete = filled === total;

  const save = async (key: SlotKey, value: unknown) => {
    setSaving(key);
    try {
      await onEdit(key, value);
      setEditing(null);
    } finally {
      setSaving(null);
    }
  };

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-l border-line bg-surface-2">
      <header className="shrink-0 px-4 pb-3.5 pt-4">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>The brief</Eyebrow>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'mono text-2xs tabular transition-colors duration-base',
                complete ? 'text-positive' : 'text-fg-subtle',
              )}
            >
              {filled}/{total}
            </span>
            {onDock && (
              <Hint label={docked ? 'Float this panel' : 'Dock to the side'} side="left">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="hidden md:inline-flex"
                  onClick={() => onDock(!docked)}
                  aria-label={docked ? 'Float the brief' : 'Dock the brief'}
                >
                  <PictureInPicture2 />
                </Button>
              </Hint>
            )}
          </div>
        </div>
        <Meter value={pct} className="mt-3" />
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {state?.regulated && (
          <Flag
            icon={<ShieldAlert className="size-3.5" />}
            tone="caution"
            title="Regulated industry"
            body={`${state.regulatedReason ? `${state.regulatedReason}. ` : ''}Compliance-aware language is enforced — no guarantees, no invented outcomes.`}
          />
        )}

        {state?.siteFetchStatus === 'failed' && (
          <Flag
            icon={<AlertTriangle className="size-3.5" />}
            tone="neutral"
            title="Website unreadable"
            body="Nothing was pulled from it. Everything else is unaffected."
          />
        )}

        <div className="mt-1">
          {REQUIRED_ORDER.map((key) => (
            <SlotRow
              key={key}
              slotKey={key}
              slots={slots}
              meta={meta}
              editing={editing === key}
              saving={saving === key}
              onStartEdit={() => setEditing(key)}
              onCancel={() => setEditing(null)}
              onSave={(value) => save(key, value)}
            />
          ))}
        </div>

        {/* Optional slots are collapsed by design. They are never chased in
            conversation, so giving them permanent visual weight would misstate
            how much of the brief is actually outstanding. */}
        <button
          type="button"
          onClick={() => setShowOptional((v) => !v)}
          className="mt-3 flex w-full items-center gap-1.5 rounded-md px-3 py-1.5 text-left text-2xs font-semibold uppercase tracking-[0.1em] text-fg-subtle transition-colors hover:text-fg-muted"
        >
          <ChevronDown
            className={cn(
              'size-3 transition-transform duration-base ease-snap',
              showOptional && 'rotate-180',
            )}
          />
          Optional
        </button>

        {showOptional && (
          <div className="animate-fade">
            {PANEL_ORDER.filter((key) => OPTIONAL.has(key)).map((key) => (
              <SlotRow
                key={key}
                slotKey={key}
                slots={slots}
                meta={meta}
                optional
                editing={editing === key}
                saving={saving === key}
                onStartEdit={() => setEditing(key)}
                onCancel={() => setEditing(null)}
                onSave={(value) => save(key, value)}
              />
            ))}
          </div>
        )}

        {state?.ambiguities && state.ambiguities.length > 0 && (
          <div className="mx-1 mt-4 rounded-md border border-line bg-surface-1 px-3 py-2.5">
            <Eyebrow className="mb-1.5">Open questions</Eyebrow>
            <ul className="space-y-1.5">
              {state.ambiguities.slice(0, 4).map((item, index) => (
                <li key={index} className="text-xs leading-relaxed text-fg-muted">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <footer className="shrink-0 border-t border-line px-3 py-3">
        {state?.readiness.readyToGenerate ? (
          <Button variant="accent" className="w-full" onClick={onBuild} loading={busy}>
            <Sparkles />
            {state.documents.length ? 'Rebuild all four' : 'Build the profiles'}
          </Button>
        ) : (
          <p className="px-1 text-center text-xs leading-relaxed text-fg-subtle">
            {filled > 0
              ? 'Keep talking — this fills itself in.'
              : 'Tell me about your business to begin.'}
          </p>
        )}

        {state && state.usage.costUsd > 0 && (
          <p className="mono mt-2.5 text-center text-2xs tabular text-fg-subtle/70">
            {(state.usage.promptTokens + state.usage.completionTokens).toLocaleString()} tokens ·{' '}
            {state.usage.costUsd < 0.01 ? '<$0.01' : `$${state.usage.costUsd.toFixed(2)}`}
          </p>
        )}
      </footer>
    </aside>
  );
}

// ---------------------------------------------------------------------------

function Flag({
  icon,
  tone,
  title,
  body,
}: {
  icon: React.ReactNode;
  tone: 'caution' | 'neutral';
  title: string;
  body: string;
}) {
  return (
    <div
      className={cn(
        'mx-1 mt-2 flex items-start gap-2.5 rounded-md border px-3 py-2.5 animate-rise',
        tone === 'caution' ? 'border-caution/25 bg-caution/[0.07]' : 'border-line bg-surface-1',
      )}
    >
      <span className={cn('mt-px shrink-0', tone === 'caution' ? 'text-caution' : 'text-fg-muted')}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-fg">{title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">{body}</p>
      </div>
    </div>
  );
}

interface SlotRowProps {
  slotKey: SlotKey;
  slots: SlotValues;
  meta: SlotMeta;
  optional?: boolean;
  editing: boolean;
  saving: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  onSave: (value: unknown) => void;
}

function SlotRow({
  slotKey,
  slots,
  meta,
  optional,
  editing,
  saving,
  onStartEdit,
  onCancel,
  onSave,
}: SlotRowProps) {
  const spec = SLOT_SPECS.find((s) => s.key === slotKey);
  const value = (slots as Record<string, unknown>)[slotKey];
  const empty = isEmptySlot(slotKey, value);
  const entry = meta[slotKey];
  const display = slotDisplayValue(slotKey, slots);
  const source = empty ? 'missing' : (entry?.source ?? 'stated');

  if (editing) {
    return (
      <div className="mx-1 my-0.5 rounded-md border border-accent/40 bg-surface-1 px-3 py-2.5 shadow-e1 animate-fade">
        <Eyebrow className="mb-2">{spec?.label ?? slotKey}</Eyebrow>
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

  // Awareness has no picker any more — every run builds all four stages — so
  // the row states that rather than offering an edit that leads nowhere.
  const isAwareness = slotKey === 'awareness_level';

  return (
    <button
      type="button"
      onClick={isAwareness ? undefined : onStartEdit}
      disabled={isAwareness}
      aria-label={isAwareness ? undefined : `Edit ${spec?.label ?? slotKey}`}
      className={cn(
        'group flex w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-fast',
        !isAwareness && 'hover:bg-surface-1',
        empty && 'opacity-70 hover:opacity-100',
      )}
    >
      <SourceDot source={source} entry={entry} />

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
            {spec?.label ?? slotKey}
          </span>
          {optional && empty && (
            <span className="text-2xs normal-case tracking-normal text-fg-subtle/60">optional</span>
          )}
        </span>

        {empty ? (
          <span className="mt-0.5 block text-base italic text-fg-subtle/80">
            {isAwareness ? 'all four stages' : 'not set'}
          </span>
        ) : (
          <span className="mt-0.5 block break-words text-base leading-snug text-fg">
            {isAwareness && typeof value === 'string'
              ? (AWARENESS[value as keyof typeof AWARENESS]?.label ?? display)
              : display}
          </span>
        )}
      </span>

      {!isAwareness && (
        <Pencil className="mt-0.5 size-3 shrink-0 text-fg-subtle opacity-0 transition-opacity duration-fast group-hover:opacity-100" />
      )}
    </button>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  stated: 'You told me this',
  inferred: 'I worked this out',
  default: 'Framework default',
  missing: 'Still open',
};

const SOURCE_TONE: Record<string, string> = {
  stated: 'bg-positive',
  inferred: 'bg-caution',
  default: 'bg-caution/50',
  missing: 'bg-line-strong',
};

function SourceDot({
  source,
  entry,
}: {
  source: string;
  entry?: { justification?: string; confidence?: number; source?: string };
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="mt-[7px] grid size-2 shrink-0 cursor-help place-items-center">
          <span className={cn('size-[7px] rounded-full', SOURCE_TONE[source])} />
        </span>
      </TooltipTrigger>
      <TooltipContent side="left">
        <span className="font-semibold text-fg">{SOURCE_LABEL[source]}</span>
        {entry?.justification && (
          <span className="mt-1 block text-fg-muted">{entry.justification}</span>
        )}
        {source === 'inferred' && typeof entry?.confidence === 'number' && (
          <span className="mono mt-1 block text-fg-subtle">
            {Math.round(entry.confidence * 100)}% confidence
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
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            disabled={saving}
            onClick={() => onSave(option.value)}
            className={cn(
              'rounded-sm border px-2 py-1 text-xs font-medium transition-all duration-fast',
              current === option.value
                ? 'border-accent bg-accent/12 text-fg'
                : 'border-line bg-surface-2 text-fg-secondary hover:border-line-strong hover:bg-surface-3',
            )}
          >
            {option.label}
          </button>
        ))}
        <Button variant="ghost" size="icon-xs" onClick={onCancel} aria-label="Cancel">
          <X />
        </Button>
      </div>
    );
  }

  if (slotKey === 'services') {
    return <ServicesEditor slots={slots} saving={saving} onCancel={onCancel} onSave={onSave} />;
  }

  return (
    <TextEditor
      slotKey={slotKey}
      slots={slots}
      saving={saving}
      onCancel={onCancel}
      onSave={onSave}
    />
  );
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
  const ref = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  return (
    <div className="flex items-center gap-1">
      <Input
        ref={ref}
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onSave(draft.trim() || null);
          if (event.key === 'Escape') onCancel();
        }}
      />
      <Button
        variant="ghost"
        size="icon-sm"
        disabled={saving}
        onClick={() => onSave(draft.trim() || null)}
        aria-label="Save"
      >
        {saving ? <Spinner className="size-3.5" /> : <Check />}
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

  const update = (index: number, patch: Partial<ServiceSlot>) =>
    setDraft((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <div className="space-y-2">
      {draft.map((service, index) => (
        <div key={index} className="space-y-1.5 rounded-sm border border-line bg-surface-2 p-2">
          <Input
            value={service.name}
            placeholder="Service name"
            disabled={saving}
            onChange={(event) => update(index, { name: event.target.value })}
          />
          <Input
            value={service.price_terms ?? ''}
            placeholder="Price / terms — blank is fine"
            disabled={saving}
            onChange={(event) => update(index, { price_terms: event.target.value || null })}
          />
          {draft.length > 1 && (
            <button
              type="button"
              onClick={() => setDraft((prev) => prev.filter((_, i) => i !== index))}
              className="text-2xs text-fg-subtle underline underline-offset-2 transition-colors hover:text-critical"
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
            className="text-xs font-medium text-accent underline underline-offset-2"
          >
            Add service
          </button>
        ) : (
          <span className="text-2xs text-fg-subtle">Maximum {SERVICE_CAP}</span>
        )}

        <div className="flex items-center gap-1">
          <Button
            size="xs"
            loading={saving}
            onClick={() => onSave(draft.filter((s) => s.name.trim()))}
          >
            Save
          </Button>
          <Button variant="ghost" size="xs" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>

      <p className="text-2xs leading-relaxed text-fg-subtle">
        A blank price is fine — documents say &ldquo;quote required&rdquo; rather than inventing a
        number.
      </p>
    </div>
  );
}
