'use client';

/**
 * The workspace: chat on the left, live brief on the right, results below once
 * documents exist. Owns the SSE lifecycles and the run state.
 */
import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FolderClock, Gauge, MessageSquare, PanelRightClose, PanelRightOpen, Plus } from 'lucide-react';
import { AwarenessModal } from '@/components/awareness-modal';
import { Brand } from '@/components/brand';
import { BriefPanel } from '@/components/brief-panel';
import { ChatPanel, type ThreadMessage } from '@/components/chat-panel';
import { ResultsView, type LiveDoc } from '@/components/results-view';
import { ThemeToggle } from '@/components/theme-provider';
import { Button, Spinner } from '@/components/ui/primitives';
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

  const [modalOpen, setModalOpen] = React.useState(false);
  const [panelOpen, setPanelOpen] = React.useState(true);
  const [view, setView] = React.useState<'chat' | 'results'>('chat');

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

  // ---- the blocking modal ------------------------------------------------
  // Opens only when the brief is complete AND awareness is genuinely unresolved.
  React.useEffect(() => {
    if (chatBusy || generating) return;
    if (state.readiness.needsAwarenessModal && !state.awarenessModalAnswered) {
      setModalOpen(true);
    }
  }, [state.readiness.needsAwarenessModal, state.awarenessModalAnswered, chatBusy, generating]);

  // Awareness settled in conversation → straight to generation, no modal.
  React.useEffect(() => {
    if (chatBusy || generating) return;
    if (
      state.readiness.briefComplete &&
      state.readiness.awarenessResolved &&
      state.awarenessResolvedInChat &&
      !state.awarenessModalAnswered &&
      state.documents.length === 0 &&
      state.slots.awareness_level
    ) {
      void startGeneration([state.slots.awareness_level]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.readiness.briefComplete,
    state.readiness.awarenessResolved,
    state.awarenessResolvedInChat,
    chatBusy,
  ]);

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
    setModalOpen(false);
    setView('results');

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

  const hasResults = state.documents.length > 0 || Object.keys(live).length > 0;
  const serviceCount = Math.max(1, state.slots.services?.length ?? 1);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Brand />
          <span className="hidden truncate text-sm text-muted-foreground sm:block">
            {state.title !== 'Untitled ICP' ? `· ${state.title}` : ''}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {hasResults && (
            <div className="mr-1 flex items-center gap-1 rounded-lg bg-secondary/70 p-0.5 lg:hidden">
              <button
                type="button"
                onClick={() => setView('chat')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                  view === 'chat' ? 'bg-card shadow-sm' : 'text-muted-foreground',
                )}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setView('results')}
                className={cn(
                  'rounded-md px-2.5 py-1 text-[12.5px] font-medium transition-colors',
                  view === 'results' ? 'bg-card shadow-sm' : 'text-muted-foreground',
                )}
              >
                Profiles
              </button>
            </div>
          )}

          <Button variant="ghost" size="icon-sm" asChild title="Saved runs">
            <Link href="/runs">
              <FolderClock />
            </Link>
          </Button>
          <Button variant="ghost" size="icon-sm" asChild title="Admin — usage and history">
            <Link href="/admin">
              <Gauge />
            </Link>
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={newRun} title="New ICP">
            <Plus />
          </Button>
          <ThemeToggle />
          <Button
            variant="ghost"
            size="icon-sm"
            className="hidden md:inline-flex"
            onClick={() => setPanelOpen((v) => !v)}
            title={panelOpen ? 'Hide brief' : 'Show brief'}
          >
            {panelOpen ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {hasResults ? (
            <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
              <div
                className={cn(
                  'flex min-h-0 flex-col border-border lg:w-[42%] lg:max-w-xl lg:border-r',
                  view === 'chat' ? 'flex-1' : 'hidden lg:flex',
                )}
              >
                <ChatPanel
                  messages={messages}
                  streaming={streaming}
                  busy={chatBusy}
                  notice={notice}
                  onSend={(text) => void sendTurn(text)}
                  onStop={() => chatAbort.current?.abort()}
                />
              </div>

              <div
                className={cn(
                  'min-h-0 flex-1',
                  view === 'results' ? 'flex flex-col' : 'hidden lg:flex lg:flex-col',
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
            </div>
          ) : (
            <ChatPanel
              messages={messages}
              streaming={streaming}
              busy={chatBusy}
              notice={notice}
              onSend={(text) => void sendTurn(text)}
              onStop={() => chatAbort.current?.abort()}
            />
          )}
        </main>

        <div
          className={cn(
            'w-[19rem] shrink-0 transition-[width] duration-200',
            panelOpen ? 'hidden md:block' : 'hidden',
          )}
        >
          <BriefPanel
            state={state}
            onEdit={editSlot}
            onOpenAwareness={() => setModalOpen(true)}
            busy={generating}
          />
        </div>
      </div>

      {/* Mobile: the brief lives behind a bar so the modal still fits a phone. */}
      <MobileBrief
        state={state}
        onEdit={editSlot}
        onOpenAwareness={() => setModalOpen(true)}
        busy={generating}
      />

      <AwarenessModal
        open={modalOpen}
        onOpenChange={(open) => {
          // Dismissing returns to chat with nothing generated and no lost state.
          setModalOpen(open);
        }}
        onGenerate={(scenarios) => void startGeneration(scenarios)}
        busy={generating}
        serviceCount={serviceCount}
      />

      {generating && (
        <div className="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2 md:hidden">
          <div className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-2 shadow-lg">
            <Spinner className="h-3.5 w-3.5" />
            <span className="text-[12.5px] font-medium">Building profiles…</span>
          </div>
        </div>
      )}
    </div>
  );
}

function MobileBrief({
  state,
  onEdit,
  onOpenAwareness,
  busy,
}: {
  state: RunState;
  onEdit: (key: SlotKey, value: unknown) => Promise<void>;
  onOpenAwareness: () => void;
  busy: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 shrink-0 items-center justify-center gap-2 border-t border-border bg-surface text-[13px] font-medium text-muted-foreground md:hidden"
      >
        <MessageSquare className="h-3.5 w-3.5" />
        {open ? 'Hide the brief' : 'Show the brief'}
      </button>

      {open && (
        <div className="h-[55dvh] shrink-0 md:hidden">
          <BriefPanel
            state={state}
            onEdit={onEdit}
            onOpenAwareness={onOpenAwareness}
            busy={busy}
          />
        </div>
      )}
    </>
  );
}
