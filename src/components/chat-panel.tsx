'use client';

/**
 * The chat thread. Streaming markdown, generous whitespace, no chrome that
 * competes with the words.
 */
import * as React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ArrowUp, Square } from 'lucide-react';
import { Button, Spinner, Textarea } from '@/components/ui/primitives';
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
  onSend: (message: string) => void;
  onStop?: () => void;
  disabled?: boolean;
}

export function ChatPanel({
  messages,
  streaming,
  busy,
  notice,
  onSend,
  onStop,
  disabled,
}: ChatPanelProps) {
  const [draft, setDraft] = React.useState('');
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const endRef = React.useRef<HTMLDivElement>(null);
  const textareaRef = React.useRef<HTMLTextAreaElement>(null);
  const [pinned, setPinned] = React.useState(true);

  // Follow the stream, but stop fighting the user the moment they scroll up.
  React.useEffect(() => {
    if (!pinned) return;
    endRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth', block: 'end' });
  }, [messages, streaming, pinned]);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const distance = element.scrollHeight - element.scrollTop - element.clientHeight;
    setPinned(distance < 120);
  };

  const autoGrow = React.useCallback(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 200)}px`;
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto px-5 py-8 sm:px-8"
      >
        <div className="mx-auto flex max-w-2xl flex-col gap-7">
          {messages.map((message) => (
            <Bubble key={message.id} role={message.role} content={message.content} />
          ))}

          {streaming !== null && (
            <Bubble role="assistant" content={streaming} streaming />
          )}

          {busy && streaming === null && (
            <div className="flex items-center gap-2.5 text-sm text-muted-foreground animate-fade-in">
              <Spinner className="h-3.5 w-3.5" />
              <span>Thinking</span>
            </div>
          )}

          {notice && (
            <div className="rounded-lg border border-border bg-card px-4 py-3 text-[13px] leading-relaxed text-muted-foreground animate-fade-in">
              {notice}
            </div>
          )}

          <div ref={endRef} className="h-px" />
        </div>
      </div>

      <div className="shrink-0 border-t border-border bg-background/85 px-5 py-4 backdrop-blur sm:px-8">
        <div className="mx-auto max-w-2xl">
          <div className="relative flex items-end gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm transition-colors focus-within:border-muted-foreground/45">
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
              className="min-h-[2.25rem] border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />

            {busy && onStop ? (
              <Button
                size="icon"
                variant="secondary"
                onClick={onStop}
                aria-label="Stop"
                className="shrink-0 rounded-xl"
              >
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon"
                onClick={submit}
                disabled={!draft.trim() || busy || disabled}
                aria-label="Send"
                className="shrink-0 rounded-xl"
              >
                <ArrowUp />
              </Button>
            )}
          </div>

          <p className="mt-2 text-center text-[11px] text-muted-foreground/60">
            Enter to send · Shift+Enter for a new line
          </p>
        </div>
      </div>
    </div>
  );
}

function Bubble({
  role,
  content,
  streaming,
}: {
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}) {
  if (role === 'user') {
    return (
      <div className="flex justify-end animate-fade-up">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-[15px] leading-relaxed text-primary-foreground shadow-sm">
          <p className="whitespace-pre-wrap text-pretty">{content}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div
        className={cn(
          'prose-chat max-w-none text-foreground/95',
          streaming && !content && 'text-muted-foreground',
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        {streaming && <span className="streaming-caret" aria-hidden="true" />}
      </div>
    </div>
  );
}
