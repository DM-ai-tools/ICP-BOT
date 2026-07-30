'use client';

/**
 * Command palette.
 *
 * The keyboard surface for everything the chrome can do. It exists because the
 * alternative to a palette is a toolbar that grows a button per capability
 * until the top bar is a control panel — and this product's whole posture is
 * that the interface should recede behind the conversation.
 *
 * Matching is subsequence-based rather than substring: "rsl" finds "Reset
 * layout". Ranked so that earlier, tighter, word-boundary matches win, which is
 * what makes a two-keystroke hit feel like the tool read your mind.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { CornerDownLeft, Search } from 'lucide-react';
import { Kbd } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: React.ReactNode;
  /** Extra words that should match this command but are not shown. */
  keywords?: string;
  hint?: string;
  shortcut?: string[];
  disabled?: boolean;
  run: () => void;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Subsequence match with a quality score, or null if the query does not fit.
 * Consecutive characters and word-boundary hits score higher, so "dl" prefers
 * "Download" over "Detach the brief pane*l*".
 */
function score(text: string, query: string): number | null {
  if (!query) return 0;

  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();

  let cursor = 0;
  let total = 0;
  let streak = 0;

  for (const char of needle) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;

    const atStart = found === 0;
    const afterBoundary = found > 0 && /[\s\-—/]/.test(haystack[found - 1]);

    if (atStart) total += 12;
    else if (afterBoundary) total += 8;
    else total += 1;

    // Reward runs — a contiguous hit is almost always the intended one.
    streak = found === cursor ? streak + 1 : 0;
    total += streak * 3;

    cursor = found + 1;
  }

  // Shorter labels that satisfy the query are more likely to be what was meant.
  return total - haystack.length * 0.06;
}

// ---------------------------------------------------------------------------

export function CommandPalette({
  open,
  onOpenChange,
  commands,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: Command[];
}) {
  const [query, setQuery] = React.useState('');
  const [active, setActive] = React.useState(0);
  const listRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
    }
  }, [open]);

  const results = React.useMemo(() => {
    const usable = commands.filter((c) => !c.disabled);
    if (!query.trim()) return usable;

    return usable
      .map((command) => {
        const best = Math.max(
          score(command.label, query) ?? -Infinity,
          (score(`${command.group} ${command.label}`, query) ?? -Infinity) - 4,
          command.keywords ? (score(command.keywords, query) ?? -Infinity) - 6 : -Infinity,
        );
        return { command, rank: best };
      })
      .filter((r) => r.rank > -Infinity)
      .sort((a, b) => b.rank - a.rank)
      .map((r) => r.command);
  }, [commands, query]);

  // Grouping is suppressed while searching: a ranked list interleaved with
  // headings reads as broken, because the headings imply an order the ranking
  // has already overruled.
  const grouped = React.useMemo(() => {
    if (query.trim()) return [{ group: null as string | null, items: results }];
    const order: string[] = [];
    const byGroup = new Map<string, Command[]>();
    for (const command of results) {
      if (!byGroup.has(command.group)) {
        byGroup.set(command.group, []);
        order.push(command.group);
      }
      byGroup.get(command.group)!.push(command);
    }
    return order.map((group) => ({ group, items: byGroup.get(group)! }));
  }, [results, query]);

  React.useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  // Keep the highlighted row in view without yanking the list around.
  React.useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const fire = React.useCallback(
    (command: Command | undefined) => {
      if (!command) return;
      onOpenChange(false);
      // Let the dialog close first; a command that navigates or moves a panel
      // shouldn't fight the exit animation for the same frame.
      window.setTimeout(() => command.run(), 0);
    },
    [onOpenChange],
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setActive(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      setActive(Math.max(0, results.length - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      fire(results[active]);
    }
  };

  let flatIndex = -1;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            'fixed inset-0 z-overlay bg-bg/55 backdrop-blur-[3px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
          )}
        />
        <DialogPrimitive.Content
          onKeyDown={onKeyDown}
          className={cn(
            'panel-float fixed left-1/2 top-[14vh] z-popover w-[calc(100vw-2rem)] max-w-[38rem]',
            '-translate-x-1/2 overflow-hidden p-0',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98] data-[state=open]:slide-in-from-top-2',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-[0.98]',
            'duration-base',
          )}
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Search for an action and press Enter to run it.
          </DialogPrimitive.Description>

          {/* Search */}
          <div className="flex items-center gap-2.5 border-b border-line px-3.5">
            <Search className="size-4 shrink-0 text-fg-subtle" aria-hidden />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              placeholder="Search commands…"
              aria-label="Search commands"
              className={cn(
                'h-12 w-full min-w-0 border-0 bg-transparent text-md text-fg outline-none',
                'placeholder:text-fg-subtle',
              )}
            />
            <Kbd className="shrink-0">Esc</Kbd>
          </div>

          {/* Results */}
          <div ref={listRef} className="max-h-[min(24rem,52vh)] overflow-y-auto overscroll-contain p-1.5">
            {results.length === 0 ? (
              <div className="px-3 py-10 text-center">
                <p className="text-base text-fg-muted">No command matches that.</p>
                <p className="mt-1 text-sm text-fg-subtle">
                  Try a shorter query — matching is by initials too.
                </p>
              </div>
            ) : (
              grouped.map(({ group, items }) => (
                <div key={group ?? '_'} className="mb-1 last:mb-0">
                  {group && <p className="eyebrow px-2.5 pb-1.5 pt-2">{group}</p>}
                  {items.map((command) => {
                    flatIndex += 1;
                    const index = flatIndex;
                    const isActive = index === active;

                    return (
                      <button
                        key={command.id}
                        data-index={index}
                        type="button"
                        onClick={() => fire(command)}
                        onPointerMove={() => setActive(index)}
                        className={cn(
                          'group flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left',
                          'transition-colors duration-instant',
                          isActive ? 'bg-surface-3' : 'hover:bg-surface-2',
                        )}
                      >
                        <span
                          className={cn(
                            'flex size-6 shrink-0 items-center justify-center rounded-sm',
                            'transition-colors duration-instant [&_svg]:size-3.5',
                            isActive ? 'bg-accent/12 text-accent' : 'text-fg-muted',
                          )}
                        >
                          {command.icon}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-base text-fg">{command.label}</span>
                          {command.hint && (
                            <span className="block truncate text-xs text-fg-subtle">
                              {command.hint}
                            </span>
                          )}
                        </span>

                        {command.shortcut && (
                          <span className="flex shrink-0 items-center gap-1">
                            {command.shortcut.map((key) => (
                              <Kbd key={key}>{key}</Kbd>
                            ))}
                          </span>
                        )}

                        <CornerDownLeft
                          aria-hidden
                          className={cn(
                            'size-3.5 shrink-0 text-fg-subtle transition-opacity duration-instant',
                            isActive ? 'opacity-100' : 'opacity-0',
                          )}
                        />
                      </button>
                    );
                  })
                  }
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-3 border-t border-line bg-surface-2 px-3.5 py-2">
            <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
              to navigate
            </span>
            <span className="flex items-center gap-1.5 text-xs text-fg-subtle">
              <Kbd>↵</Kbd>
              to run
            </span>
            <span className="ml-auto text-xs tabular-nums text-fg-subtle">
              {results.length} command{results.length === 1 ? '' : 's'}
            </span>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * Global ⌘K / Ctrl+K. Deliberately ignores the shortcut while the user is
 * typing into a field, so it cannot steal a keystroke mid-sentence in the chat
 * composer — which is where this app's users spend most of their time.
 */
export function useCommandPalette() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const isPaletteKey = event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey);
      if (!isPaletteKey) return;

      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      // ⌘K is unambiguous even while typing; a bare "k" never is.
      if (typing && !(event.metaKey || event.ctrlKey)) return;

      event.preventDefault();
      setOpen((v) => !v);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return { open, setOpen };
}
