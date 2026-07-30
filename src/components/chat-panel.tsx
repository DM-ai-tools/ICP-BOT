'use client';

/**
 * The conversation.
 *
 * Composition rules that carry the whole panel:
 *
 *  - The assistant does not get a bubble. Its words are the primary content of
 *    the product, so they sit directly on the surface with nothing framing
 *    them. Only the user's own messages are boxed, which makes the thread read
 *    as one voice being answered rather than two chat participants.
 *  - Turns are separated by space and a hairline rule, not by alternating
 *    fills. Fills would turn a considered exchange into a messaging app.
 *  - The composer is a single raised surface that gains an accent ring on
 *    focus, so the one place you can act is unmistakable at a glance.
 */
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Info, Square, X } from 'lucide-react';
import { Button, Kbd, Skeleton, Textarea } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

export interface ThreadMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ChatPanelProps {
  messages: ThreadMessage[];
  streaming: string | null;
  busy: boolean;
  notice: string | null;
  onDismissNotice?: () => void;
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
  /** Results are on screen, so the column is narrower. */
  compact?: boolean;
}

export function ChatPanel({
  messages,
  streaming,
  busy,
  notice,
  onDismissNotice,
  onSend,
  onStop,
  disabled,
  compact,
}: ChatPanelProps) {
  const [draft, setDraft] = React.useState('');
  const [pinned, setPinned] = React.useState(true);

  const scrollRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);

  // Follow the stream, but stop the moment the user scrolls away — hijacking
  // someone's scroll position while they are reading is unforgivable.
  React.useEffect(() => {
    if (!pinned) return;
    endRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth', block: 'end' });
  }, [messages, streaming, pinned]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 140);
  };

  const autoGrow = React.useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, []);

  React.useEffect(autoGrow, [draft, autoGrow]);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy || disabled) return;
    onSend(text);
    setDraft('');
    setPinned(true);
    requestAnimationFrame(autoGrow);
  };

  const gutter = compact ? 'px-5' : 'px-6 sm:px-10';

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={cn('min-h-0 flex-1 overflow-y-auto py-8', gutter)}
      >
        <div className={cn('mx-auto flex flex-col', compact ? 'max-w-2xl' : 'max-w-[46rem]')}>
          {messages.length === 0 && streaming === null && !busy && <Opening />}

          {messages.map((message, index) => (
            <Turn
              key={message.id}
              role={message.role}
              content={message.content}
              first={index === 0}
            />
          ))}

          {streaming !== null && <Turn role="assistant" content={streaming} streaming />}

          {busy && streaming === null && <Thinking />}

          {notice && <Notice text={notice} onDismiss={onDismissNotice} />}

          <div ref={endRef} className="h-2" />
        </div>
      </div>

      {/* ---- composer ------------------------------------------------------ */}
      <div className={cn('chrome shrink-0 border-t border-line py-4', gutter)}>
        <div className={cn('mx-auto', compact ? 'max-w-2xl' : 'max-w-[46rem]')}>
          <div
            className={cn(
              'group relative flex items-end gap-2 rounded-xl border border-line bg-surface-1 p-2',
              'shadow-e1 transition-all duration-base ease-out',
              'focus-within:border-accent/45 focus-within:shadow-e2',
              'focus-within:ring-4 focus-within:ring-accent/10',
            )}
          >
            <Textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              disabled={disabled}
              placeholder="Tell me about your business…"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              className="min-h-[2.25rem] border-0 bg-transparent px-2 py-2 shadow-none hover:border-0 focus:border-0"
            />

            {busy && onStop ? (
              <Button
                size="icon"
                variant="subtle"
                onClick={onStop}
                aria-label="Stop generating"
                className="shrink-0 rounded-lg"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                variant="accent"
                onClick={submit}
                disabled={!draft.trim() || busy || disabled}
                aria-label="Send message"
                className="shrink-0 rounded-lg"
              >
                <ArrowUp />
              </Button>
            )}
          </div>

          <p className="mt-2 flex items-center justify-center gap-1.5 text-2xs text-fg-subtle">
            <Kbd>↵</Kbd> to send
            <span className="opacity-40">·</span>
            <Kbd>⇧</Kbd>
            <Kbd>↵</Kbd> for a new line
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function Turn({
  role,
  content,
  streaming,
  first,
}: {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
  first?: boolean;
}) {
  if (role === 'user') {
    return (
      <div className={cn('flex justify-end animate-rise', first ? 'mt-0' : 'mt-7')}>
        <div className="max-w-[85%] rounded-xl rounded-br-sm border border-line bg-surface-2 px-3.5 py-2.5 shadow-e1">
          <p className="whitespace-pre-wrap text-md leading-relaxed text-pretty text-fg">
            {content}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn('animate-rise', first ? 'mt-0' : 'mt-7')}>
      {/* A hairline rather than an avatar. It marks the turn without adding a
          face to something that does not have one. */}
      <div className="mb-2.5 flex items-center gap-2">
        <span className="h-px w-4 bg-accent/50" />
        <span className="eyebrow text-accent/80">Prism</span>
      </div>
      <div className="prose-chat max-w-none text-fg-secondary">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        {streaming && <span className="streaming-caret" aria-hidden />}
      </div>
    </div>
  );
}

/** The pause before the first token. Shaped like the reply that is coming. */
function Thinking() {
  return (
    <div className="mt-7 animate-fade" aria-label="Thinking">
      <div className="mb-2.5 flex items-center gap-2">
        <span className="h-px w-4 bg-accent/50" />
        <span className="eyebrow text-accent/80">Prism</span>
      </div>
      <div className="space-y-2.5">
        <Skeleton className="h-3.5 w-[72%]" />
        <Skeleton className="h-3.5 w-[54%]" />
      </div>
    </div>
  );
}

function Opening() {
  return (
    <div className="animate-fade py-6">
      <div className="stagger">
        <p className="eyebrow mb-3">Ideal customer profile</p>
        <h1 className="display text-3xl text-balance text-fg">
          Describe your business.
          <br />
          <span className="text-fg-muted">I&rsquo;ll work out who to sell to.</span>
        </h1>
      </div>
    </div>
  );
}

function Notice({ text, onDismiss }: { text: string; onDismiss?: () => void }) {
  return (
    <div className="mt-6 flex items-start gap-2.5 rounded-lg border border-caution/25 bg-caution/[0.07] px-3.5 py-3 animate-rise">
      <Info className="mt-0.5 size-4 shrink-0 text-caution" />
      <p className="flex-1 text-base leading-relaxed text-fg-secondary">{text}</p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-m-1 shrink-0 rounded-sm p-1 text-fg-subtle transition-colors hover:text-fg"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}
