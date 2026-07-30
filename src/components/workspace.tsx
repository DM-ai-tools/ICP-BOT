'use client';

/**
 * The workspace shell.
 *
 * Chat, results and brief are independently resizable panes whose widths persist
 * per run. The brief can be undocked into a floating panel that drags and
 * resizes from any edge. Owns the SSE lifecycles and the run state.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderClock, Gauge, GripHorizontal, PanelRightClose, PanelRightOpen, Plus } from 'lucide-react';
import { Brand } from '@/components/brand';
import { BriefPanel } from '@/components/brief-panel';
import { ChatPanel, type ThreadMessage } from '@/components/chat-panel';
import { ResultsView, type LiveDoc } from '@/components/results-view';
import { ThemeToggle } from '@/components/theme-provider';
import { Button, Divider, Hint, ProgressTrack, Segmented, Spinner } from '@/components/ui/primitives';
import { ResizeHandles, SplitHandle, useFloating, useSplit } from '@/components/ui/panels';
import { DEFAULT_SCENARIOS } from '@/lib/awareness';
import { readSse } from '@/lib/sse-client';
import type { AwarenessKey, SlotKey } from '@/lib/slots';
import type { ChatEvent, GenerateEvent, RunState } from '@/lib/types';
import { cn } from '@/lib/utils';

interface WorkspaceProps {
  runId: string;
  initialState: RunState;
  initialMessages: ThreadMessage[];
}

export function Workspace({ runId, initialState, initialMessages }: WorkspaceProps) {
  const router = useRouter();

  const [state, setState] = React.useState<RunState>(initialState);
  const [messages, setMessages] = React.useState<ThreadMessage[]>(initialMessages);
  const [streaming, setStreaming] = React.useState<string | null>(null);
  const [chatBusy, setChatBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [live, setLive] = React.useState<Record<string, LiveDoc>>({});
  const [markdownById, setMarkdownById] = React.useState<Record<string, string>>({});
  const [generating, setGenerating] = React.useState(false);


  const chatAbort = React.useRef<AbortController | null>(null);
  const generateAbort = React.useRef<AbortController | null>(null);
  const greeted = React.useRef(false);

  // ---- opening line ------------------------------------------------------
  React.useEffect(() => {
    if (greeted.current || messages.length > 0) return;
    greeted.current = true;
    void sendTurn(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- generation starts itself -------------------------------------------
  //
  // There is no stage picker any more. Every run builds all four awareness
  // stages, because the value of the deliverable is the contrast between them
  // and the answer to "which ones?" was always "all of them". A complete brief
  // is the only trigger.
  const autoStarted = React.useRef(false);

  React.useEffect(() => {
    if (chatBusy || generating || autoStarted.current) return;
    if (!state.readiness.briefComplete) return;
    if (state.documents.length > 0) return;

    autoStarted.current = true;
    void startGeneration(DEFAULT_SCENARIOS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.readiness.briefComplete, state.documents.length, chatBusy, generating]);

  // ---- chat --------------------------------------------------------------
  async function sendTurn(message: string | null) {
    if (chatBusy) return;

    chatAbort.current?.abort();
    const controller = new AbortController();
    chatAbort.current = controller;

    setChatBusy(true);
    setNotice(null);

    if (message) {
      setMessages((prev) => [
        ...prev,
        { id: `local-${Date.now()}`, role: 'user', content: message },
      ]);
    }

    let buffer = '';
    setStreaming(null);

    try {
      await readSse<ChatEvent>(
        '/api/chat',
        message ? { runId, message } : { runId, greeting: true },
        (event) => {
          switch (event.type) {
            case 'message_start':
              buffer = '';
              setStreaming('');
              break;
            case 'delta':
              buffer += event.text;
              setStreaming(buffer);
              break;
            case 'message_end':
              setStreaming(null);
              setMessages((prev) => [
                ...prev,
                { id: event.messageId, role: 'assistant', content: event.content },
              ]);
              break;
            case 'notice':
              setNotice(event.text);
              break;
            case 'state':
              setState(event.state);
              break;
            case 'error':
              setNotice(event.text);
              break;
            default:
              break;
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setNotice(
          (err as Error).message ||
            'Lost the connection. Your brief is saved — send that again.',
        );
      }
      setStreaming(null);
    } finally {
      setChatBusy(false);
    }
  }

  // ---- generation --------------------------------------------------------
  async function startGeneration(scenarios: AwarenessKey[], force = false, serviceIndexes?: number[]) {
    if (!scenarios.length || generating) return;

    generateAbort.current?.abort();
    const controller = new AbortController();
    generateAbort.current = controller;

    setGenerating(true);

    try {
      await readSse<GenerateEvent>(
        '/api/generate',
        { runId, scenarios, force, serviceIndexes },
        (event) => {
          switch (event.type) {
            case 'doc_start':
              setLive((prev) => ({
                ...prev,
                [event.docKey]: {
                  docKey: event.docKey,
                  label: event.label,
                  scenario: event.scenario,
                  serviceIndex: event.serviceIndex,
                  text: '',
                  phase: 'A',
                },
              }));
              break;

            case 'doc_phase':
              setLive((prev) =>
                prev[event.docKey]
                  ? {
                      ...prev,
                      [event.docKey]: {
                        ...prev[event.docKey],
                        phase: event.phase,
                        detail: event.detail,
                      },
                    }
                  : prev,
              );
              break;

            case 'doc_delta':
              setLive((prev) =>
                prev[event.docKey]
                  ? {
                      ...prev,
                      [event.docKey]: {
                        ...prev[event.docKey],
                        text: prev[event.docKey].text + event.text,
                      },
                    }
                  : prev,
              );
              break;

            case 'doc_end':
              setMarkdownById((prev) => ({ ...prev, [event.documentId]: event.markdown }));
              setLive((prev) =>
                prev[event.docKey]
                  ? {
                      ...prev,
                      [event.docKey]: {
                        ...prev[event.docKey],
                        phase: 'done',
                        text: event.markdown,
                        documentId: event.documentId,
                        badge: event.badge,
                      },
                    }
                  : prev,
              );
              break;

            case 'doc_error':
              setLive((prev) =>
                prev[event.docKey]
                  ? { ...prev, [event.docKey]: { ...prev[event.docKey], phase: 'error', error: event.text } }
                  : prev,
              );
              break;

            case 'doc_skipped':
              setLive((prev) => {
                const next = { ...prev };
                delete next[event.docKey];
                return next;
              });
              break;

            case 'state':
              setState(event.state);
              break;

            case 'error':
              setNotice(event.text);
              break;

            default:
              break;
          }
        },
        controller.signal,
      );

      // One line about what landed and the natural next step.
      void sendTurn(null).catch(() => {});
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setNotice((err as Error).message || 'Generation stopped unexpectedly.');
      }
    } finally {
      setGenerating(false);
    }
  }

  // ---- brief editing -----------------------------------------------------
  async function editSlot(key: SlotKey, value: unknown) {
    const response = await fetch(`/api/runs/${runId}/slots`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    });

    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      setNotice(payload.error ?? 'Could not save that change.');
      return;
    }

    const payload = (await response.json()) as { state: RunState | null; invalidated: number };
    if (payload.state) setState(payload.state);
    if (payload.invalidated > 0) {
      setNotice(
        `Brief updated. ${payload.invalidated} document${payload.invalidated === 1 ? '' : 's'} no longer match — rebuild before sending them anywhere.`,
      );
    }
  }

  const loadingDocs = React.useRef<Set<string>>(new Set());

  const loadDocument = React.useCallback(
    (documentId: string) => {
      if (loadingDocs.current.has(documentId)) return;
      loadingDocs.current.add(documentId);

      void fetch(`/api/runs/${runId}/documents/${documentId}`)
        .then((response) => (response.ok ? response.json() : null))
        .then((payload: { document?: { markdown: string } } | null) => {
          if (payload?.document) {
            setMarkdownById((prev) => ({ ...prev, [documentId]: payload.document!.markdown }));
          }
        })
        .catch(() => {
          loadingDocs.current.delete(documentId);
        });
    },
    [runId],
  );

  async function newRun() {
    const response = await fetch('/api/runs', { method: 'POST' });
    if (!response.ok) return;
    const { id } = (await response.json()) as { id: string };
    router.push(`/r/${id}`);
  }

  // ---- layout -------------------------------------------------------------
  const hasResults = state.documents.length > 0 || Object.keys(live).length > 0;

  // Two independent, persisted splits. The brief keeps its width whether or not
  // results exist, so the layout does not lurch when generation finishes.
  const chatSplit = useSplit({
    id: `${runId}:chat`,
    initial: 520,
    min: 380,
    max: 860,
    side: 'right',
    snap: [440, 520, 640],
    enabled: hasResults,
  });

  const briefSplit = useSplit({
    id: 'brief',
    initial: 320,
    min: 268,
    max: 460,
    side: 'left',
    snap: [288, 320, 380],
  });

  const [briefDocked, setBriefDocked] = React.useState(true);
  const [briefOpen, setBriefOpen] = React.useState(true);
  const [mobileView, setMobileView] = React.useState<'chat' | 'results' | 'brief'>('chat');

  React.useEffect(() => {
    setBriefDocked(readLocal('brief:docked', true));
  }, []);

  const dock = (next: boolean) => {
    setBriefDocked(next);
    writeLocal('brief:docked', next);
  };

  React.useEffect(() => {
    if (hasResults && mobileView === 'chat') setMobileView('results');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResults]);

  const brief = (
    <BriefPanel
      state={state}
      onEdit={editSlot}
      onBuild={() => void startGeneration(DEFAULT_SCENARIOS)}
      busy={generating}
      docked={briefDocked}
      onDock={dock}
    />
  );

  return (
    <div className="atmosphere flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <TopBar
        state={state}
        generating={generating}
        onNew={newRun}
        briefOpen={briefOpen && briefDocked}
        onToggleBrief={() => (briefDocked ? setBriefOpen((v) => !v) : dock(true))}
        hasResults={hasResults}
        mobileView={mobileView}
        onMobileView={setMobileView}
      />

      <div className="relative flex min-h-0 flex-1">
        {/* ---- chat ------------------------------------------------------- */}
        <div
          ref={chatSplit.panelRef}
          style={hasResults ? { width: chatSplit.size } : undefined}
          className={cn(
            'min-h-0 min-w-0 flex-col',
            hasResults ? 'shrink-0' : 'flex-1',
            hasResults && mobileView !== 'chat' ? 'hidden lg:flex' : 'flex',
            !chatSplit.dragging && 'transition-[width] duration-base ease-out',
          )}
        >
          <ChatPanel
            messages={messages}
            streaming={streaming}
            busy={chatBusy}
            notice={notice}
            onDismissNotice={() => setNotice(null)}
            onSend={(text) => void sendTurn(text)}
            onStop={() => chatAbort.current?.abort()}
            compact={hasResults}
          />
        </div>

        {hasResults && (
          <SplitHandle
            {...chatSplit.handleProps}
            dragging={chatSplit.dragging}
            label="Resize the conversation"
            className="hidden lg:block"
          />
        )}

        {/* ---- results ----------------------------------------------------- */}
        {hasResults && (
          <div
            className={cn(
              'min-h-0 min-w-0 flex-1 flex-col',
              mobileView === 'results' ? 'flex' : 'hidden lg:flex',
            )}
          >
            <ResultsView
              state={state}
              live={live}
              markdownById={markdownById}
              generating={generating}
              onLoadDocument={loadDocument}
              onRegenerate={(scenario, serviceIndex) =>
                void startGeneration([scenario], true, [serviceIndex])
              }
            />
          </div>
        )}

        {/* ---- brief, docked ------------------------------------------------ */}
        {briefDocked && briefOpen && (
          <>
            <SplitHandle
              {...briefSplit.handleProps}
              dragging={briefSplit.dragging}
              label="Resize the brief"
              className="hidden md:block"
            />
            <div
              ref={briefSplit.panelRef}
              style={{ width: briefSplit.size }}
              className={cn(
                'hidden shrink-0 md:flex',
                !briefSplit.dragging && 'transition-[width] duration-base ease-out',
              )}
            >
              {brief}
            </div>
          </>
        )}

        {/* ---- brief, floating ---------------------------------------------- */}
        {briefDocked ? null : <FloatingBrief onDock={() => dock(true)}>{brief}</FloatingBrief>}

        {/* Mobile gets the brief as a full surface, not a cramped sheet. */}
        <div className={cn('min-h-0 flex-1 md:hidden', mobileView === 'brief' ? 'flex' : 'hidden')}>
          {brief}
        </div>
      </div>

      {generating && <GeneratingToast count={Object.keys(live).length} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shell chrome
// ---------------------------------------------------------------------------

function TopBar({
  state,
  generating,
  onNew,
  briefOpen,
  onToggleBrief,
  hasResults,
  mobileView,
  onMobileView,
}: {
  state: RunState;
  generating: boolean;
  onNew: () => void;
  briefOpen: boolean;
  onToggleBrief: () => void;
  hasResults: boolean;
  mobileView: 'chat' | 'results' | 'brief';
  onMobileView: (view: 'chat' | 'results' | 'brief') => void;
}) {
  const titled = state.title !== 'Untitled ICP';

  return (
    <header className="chrome relative z-chrome flex h-topbar shrink-0 items-center gap-3 border-b border-line px-3 sm:px-4">
      <Brand />

      {titled ? (
        <>
          <Divider orientation="vertical" className="my-3 hidden sm:block" />
          <p className="hidden min-w-0 flex-1 truncate text-base text-fg-muted sm:block">
            {state.title}
          </p>
        </>
      ) : (
        <span className="flex-1" />
      )}

      {/* Indeterminate by design — generation length genuinely cannot be known. */}
      {generating && (
        <div className="hidden items-center gap-2.5 sm:flex">
          <ProgressTrack className="w-20" />
          <span className="text-xs text-fg-muted">Building</span>
        </div>
      )}

      <div className="flex shrink-0 items-center gap-0.5">
        {hasResults && (
          <Segmented
            size="sm"
            className="mr-1 lg:hidden"
            value={mobileView}
            onChange={onMobileView}
            options={[
              { value: 'chat', label: 'Chat' },
              { value: 'results', label: 'Profiles' },
              { value: 'brief', label: 'Brief' },
            ]}
          />
        )}

        <Hint label="Saved ICPs">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/runs" aria-label="Saved ICPs">
              <FolderClock />
            </Link>
          </Button>
        </Hint>

        <Hint label="Usage and history">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/admin" aria-label="Admin">
              <Gauge />
            </Link>
          </Button>
        </Hint>

        <Hint label="Start a new ICP">
          <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New ICP">
            <Plus />
          </Button>
        </Hint>

        <ThemeToggle />

        <Hint label={briefOpen ? 'Hide the brief' : 'Show the brief'}>
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            onClick={onToggleBrief}
            aria-label={briefOpen ? 'Hide the brief' : 'Show the brief'}
          >
            {briefOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </Hint>
      </div>
    </header>
  );
}

/**
 * The brief, detached. Dragged by its header, resized from any edge or corner,
 * constrained so it can never be lost off-screen, and raised above its siblings
 * the moment it is touched.
 */
function FloatingBrief({ children, onDock }: { children: React.ReactNode; onDock: () => void }) {
  const float = useFloating({
    id: 'brief:float',
    initial: {
      x: typeof window === 'undefined' ? 900 : Math.max(24, window.innerWidth - 392),
      y: 76,
      w: 344,
      h: 560,
    },
    minW: 280,
    minH: 260,
  });

  return (
    <div
      ref={float.ref}
      onPointerDownCapture={float.raise}
      style={{
        transform: `translate3d(${float.rect.x}px, ${float.rect.y}px, 0)`,
        width: float.rect.w,
        height: float.rect.h,
        zIndex: float.z,
      }}
      className={cn(
        'panel-float gpu fixed left-0 top-0 hidden flex-col overflow-hidden md:flex',
        float.busy ? 'select-none' : 'transition-shadow duration-base ease-out',
      )}
      role="dialog"
      aria-label="Brief"
    >
      <div
        onPointerDown={float.onMovePointerDown}
        className={cn(
          'flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-2.5',
          float.busy === 'move' ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <GripHorizontal className="size-3.5 shrink-0 text-fg-subtle" />
        <span className="eyebrow flex-1">Brief</span>
        <Hint label="Dock to the side">
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onDock}
            data-no-drag
            aria-label="Dock the brief"
          >
            <PanelRightClose />
          </Button>
        </Hint>
      </div>

      <div className="min-h-0 flex-1">{children}</div>

      <ResizeHandles handleProps={float.resizeHandleProps} />
    </div>
  );
}

function GeneratingToast({ count }: { count: number }) {
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-float -translate-x-1/2 animate-rise sm:hidden">
      <div className="panel-raised flex items-center gap-2.5 rounded-full px-4 py-2">
        <Spinner className="size-3.5 text-accent" />
        <span className="text-sm font-medium">
          Building {count || 4} profile{count === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function readLocal<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(`prism:${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(`prism:${key}`, JSON.stringify(value));
  } catch {
    /* private mode or quota — an unsaved preference is not worth an error */
  }
}
