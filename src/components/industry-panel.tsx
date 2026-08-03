'use client';

/**
 * The industry panel.
 *
 * Shows the domain context the profiles were tailored with. It exists because
 * tailoring that happens invisibly is indistinguishable from tailoring that
 * did not happen — a strategist about to put this in front of a client needs to
 * see what the model was told about their vertical, and be able to disagree
 * with it.
 *
 * Curated packs are labelled as such, because "we wrote this for dental" and
 * "a model wrote this about dental" deserve different levels of trust.
 */
import * as React from 'react';
import { BookOpen, Check, Sparkles } from 'lucide-react';
import { PACK_SECTIONS, type IndustryPackSummary } from '@/lib/industry-types';
import { Badge, Eyebrow, Hint, SkeletonText } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export function IndustryPanel({
  pack,
  building,
  industryLabel,
}: {
  pack: IndustryPackSummary | null;
  building?: boolean;
  industryLabel?: string | null;
}) {
  if (building && !pack) return <BuildingState industry={industryLabel} />;
  if (!pack) return <EmptyState industry={industryLabel} />;

  const { content } = pack;

  return (
    <div className="flex h-full min-h-0 w-full flex-col border-l border-line bg-surface-2">
      <header className="shrink-0 px-4 pb-3 pt-4">
        <div className="flex items-center justify-between gap-2">
          <Eyebrow>Tailored to</Eyebrow>
          <Hint
            label={
              pack.source === 'curated'
                ? 'Hand-written for this vertical — not model-generated.'
                : 'Researched once for this industry and cached for every future run.'
            }
            side="left"
          >
            <span>
              <Badge tone={pack.source === 'curated' ? 'positive' : 'accent'} size="sm">
                {pack.source === 'curated' ? (
                  <>
                    <Check className="size-2.5 stroke-[3]" />
                    curated
                  </>
                ) : (
                  <>
                    <Sparkles className="size-2.5" />
                    researched
                  </>
                )}
              </Badge>
            </span>
          </Hint>
        </div>

        <p className="mt-1.5 text-md font-semibold capitalize leading-tight text-fg">
          {pack.canonicalIndustry}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-pretty text-fg-muted">{content.summary}</p>

        <div className="mono mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-fg-subtle">
          <span>{pack.region}</span>
          <span className="opacity-40">·</span>
          <span className="uppercase">{pack.businessModel}</span>
          {pack.useCount > 1 && (
            <>
              <span className="opacity-40">·</span>
              <Hint label="Runs that have reused this pack. After the first, it costs nothing." side="bottom">
                <span className="cursor-help">reused {pack.useCount}×</span>
              </Hint>
            </>
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {PACK_SECTIONS.map((section) => {
          const value = content[section.key];
          if (!Array.isArray(value) || value.length === 0) return null;

          return (
            <section key={section.key} className="mt-3 first:mt-1">
              <div className="px-2">
                <p className="text-2xs font-semibold uppercase tracking-[0.09em] text-fg-subtle">
                  {section.label}
                </p>
                <p className="mt-0.5 text-2xs leading-snug text-fg-subtle/70">{section.hint}</p>
              </div>

              <ul className="mt-1.5 space-y-px">
                {value.map((item, index) => (
                  <li
                    key={index}
                    className="rounded-md px-2 py-1.5 text-xs leading-relaxed text-fg-secondary transition-colors duration-fast hover:bg-surface-1"
                  >
                    {typeof item === 'string' ? (
                      item
                    ) : (
                      <>
                        <span className="font-semibold text-fg">{item.term}</span>
                        <span className="text-fg-muted"> — {item.meaning}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}

        <p className="mt-5 px-2 text-2xs leading-relaxed text-fg-subtle/70">
          Reference material only. It shapes language and specificity — it is never presented as a
          fact about your business, and carries no figures by design.
        </p>
      </div>
    </div>
  );
}

function BuildingState({ industry }: { industry?: string | null }) {
  return (
    <div className="flex h-full w-full flex-col border-l border-line bg-surface-2">
      <header className="shrink-0 px-4 pb-3 pt-4">
        <Eyebrow>Tailored to</Eyebrow>
        <p className="mt-1.5 text-md font-semibold capitalize text-fg">
          {industry ?? 'this industry'}
        </p>
        <p className="mt-1 text-xs text-fg-muted">Researching how this vertical actually works…</p>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-hidden px-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="skeleton h-2.5 w-[30%]" />
            <SkeletonText lines={3} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ industry }: { industry?: string | null }) {
  return (
    <div className="flex h-full w-full flex-col border-l border-line bg-surface-2">
      <header className="shrink-0 px-4 pb-3 pt-4">
        <Eyebrow>Industry</Eyebrow>
      </header>
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-surface-3 text-fg-subtle">
          <BookOpen className="size-4" />
        </span>
        <p className="mt-3 text-base font-medium text-fg">
          {industry ? 'Not built yet' : 'No industry yet'}
        </p>
        <p className={cn('mt-1 text-xs leading-relaxed text-pretty text-fg-muted')}>
          {industry
            ? `Context for ${industry} is assembled when the profiles are built.`
            : 'Once the brief names an industry, the profiles get tailored to how that vertical actually works — its language, roles, triggers and objections.'}
        </p>
      </div>
    </div>
  );
}
