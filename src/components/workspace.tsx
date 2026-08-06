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
import {
  Command as CommandIcon,
  Copy,
  FolderClock,
  Gauge,
  GripHorizontal,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Moon,
  PanelLeftClose,
  PanelRightClose,
  PanelRightOpen,
  Hammer,
  Plus,
  RotateCcw,
  Sun,
} from 'lucide-react';
import { Brand } from '@/components/brand';
import { BriefPanel } from '@/components/brief-panel';
import { IndustryPanel } from '@/components/industry-panel';
import { ChatPanel, type ThreadMessage } from '@/components/chat-panel';
import { CommandPalette, useCommandPalette, type Command } from '@/components/command-palette';
import { ResultsView, type LiveDoc } from '@/components/results-view';
import { ScopePicker } from '@/components/scope-picker';
import { SignOut } from '@/components/sign-out';
import { StructureCard } from '@/components/structure-card';
import type { ScopeChoice } from '@/lib/discover-types';
import { ThemeToggle, useTheme } from '@/components/theme-provider';
import { Button, Divider, Hint, Kbd, ProgressTrack, Segmented, Spinner } from '@/components/ui/primitives';
import {
  DockPreview,
  ResizeHandles,
  SplitHandle,
  clearPanelLayout,
  useFloating,
  useSplit,
} from '@/components/ui/panels';
import { DEFAULT_SCENARIOS } from '@/lib/awareness';
import { readSse } from '@/lib/sse-client';
import type { AwarenessKey, SlotKey } from '@/lib/slots';
import type { ChatEvent, GenerateEvent, RunState } from '@/lib/types';
import { cn } from '@/lib/utils';

interface WorkspaceProps {
  runId: string;
  initialState: RunState;
  /**
   * admin sees the whole workspace. user gets the chatbot, the results and a
   * download — the brief internals, industry panel, usage figures and command
   * palette are noise to someone who just wants the profiles.
   */
  role?: 'admin' | 'user';
  userName?: string;
  initialMessages: ThreadMessage[];
}

export function Workspace({
  runId,
  initialState,
  initialMessages,
  role = 'admin',
  userName,
}: WorkspaceProps) {
  const simple = role !== 'admin';
  const router = useRouter();

  const [state, setState] = React.useState<RunState>(initialState);
  const [messages, setMessages] = React.useState<ThreadMessage[]>(initialMessages);
  const [streaming, setStreaming] = React.useState<string | null>(null);
  const [chatBusy, setChatBusy] = React.useState(false);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [live, setLive] = React.useState<Record<string, LiveDoc>>({});
  const [markdownById, setMarkdownById] = React.useState<Record<string, string>>({});
  const [generating, setGenerating] = React.useState(false);
  const [packBuilding, setPackBuilding] = React.useState(false);


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
    // A multi-offer site has one question left that only a human can answer:
    // whose profile is this for? Starting before that is answered burns money
    // on the wrong deliverable.
    if (state.discovery.needsScopeChoice) return;

    autoStarted.current = true;
    void startGeneration(DEFAULT_SCENARIOS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    state.readiness.briefComplete,
    state.documents.length,
    state.discovery.needsScopeChoice,
    chatBusy,
    generating,
  ]);

  // ---- scope -------------------------------------------------------------
  const [scopeBusy, setScopeBusy] = React.useState(false);

  async function submitScope(choice: ScopeChoice | null, slugs: string[]) {
    if (scopeBusy) return;
    setScopeBusy(true);
    try {
      const response = await fetch(`/api/runs/${runId}/scope`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(choice ? { choice, slugs } : { dismiss: true }),
      });
      const payload = (await response.json()) as {
        state?: RunState | null;
        error?: string;
        dropped?: number;
      };
      if (!response.ok) {
        setNotice(payload.error ?? 'That scope could not be saved.');
        return;
      }
      if (payload.state) setState(payload.state);
      if (payload.dropped) {
        setNotice(
          `${payload.dropped} offer${payload.dropped === 1 ? '' : 's'} left out of this run — build them in a second run.`,
        );
      }
    } catch {
      setNotice('That scope could not be saved. The brief is untouched.');
    } finally {
      setScopeBusy(false);
    }
  }

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
    setPackBuilding(true);

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

            case 'industry':
              setPackBuilding(false);
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
      setPackBuilding(false);
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

  // The folder map appears only once the build has actually finished. Showing
  // it mid-run would draw a tree of folders that do not exist yet.
  const buildComplete =
    !generating &&
    state.documents.length > 0 &&
    state.documents.every((doc) => doc.status !== 'pending' && doc.status !== 'generating');

  /** Docked to a side, or detached and floating. */
  type Dock = 'left' | 'right' | 'float';
  const [briefDock, setBriefDock] = React.useState<Dock>('right');
  const [briefOpen, setBriefOpen] = React.useState(true);
  const [mobileView, setMobileView] = React.useState<'chat' | 'results' | 'brief'>('chat');

  React.useEffect(() => {
    setBriefDock(readLocal<Dock>('brief:dock', 'right'));
    setBriefOpen(readLocal('brief:open', true));
  }, []);

  const dockTo = React.useCallback((next: Dock) => {
    setBriefDock(next);
    writeLocal('brief:dock', next);
    if (next !== 'float') {
      setBriefOpen(true);
      writeLocal('brief:open', true);
    }
  }, []);

  const toggleBriefOpen = React.useCallback(() => {
    setBriefOpen((v) => {
      writeLocal('brief:open', !v);
      return !v;
    });
  }, []);

  const docked = briefDock !== 'float';
  const dockLeft = briefDock === 'left';

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

  // The handle sits on whichever side faces the rest of the layout, so dragging
  // it outward always widens the brief regardless of which edge it is docked to.
  const briefSplit = useSplit({
    id: 'brief',
    initial: 320,
    min: 268,
    max: 460,
    side: dockLeft ? 'right' : 'left',
    snap: [288, 320, 380],
  });

  React.useEffect(() => {
    if (hasResults && mobileView === 'chat') setMobileView('results');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasResults]);

  /**
   * The right rail carries two panels rather than becoming a fourth column.
   *
   * A separate column for industry context would take width from the document,
   * which is the thing people are actually here to read — and the two are never
   * needed at once: the brief matters while the conversation is happening, the
   * industry context matters once profiles exist.
   */
  const [railTab, setRailTab] = React.useState<'brief' | 'industry'>('brief');

  // Reveal the industry panel once tailoring lands, but only the first time and
  // never over the top of someone who has deliberately switched back.
  const railAutoSwitched = React.useRef(false);
  React.useEffect(() => {
    if (railAutoSwitched.current || !state.industryPack) return;
    railAutoSwitched.current = true;
    setRailTab('industry');
  }, [state.industryPack]);

  const brief = (
    <div className="flex h-full min-h-0 w-full flex-col border-l border-line bg-surface-2">
      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 pt-1.5">
        {([
          { key: 'brief' as const, label: 'Brief' },
          { key: 'industry' as const, label: 'Industry' },
        ]).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setRailTab(tab.key)}
            aria-selected={railTab === tab.key}
            className={cn(
              'relative rounded-t-sm px-2.5 pb-2 pt-1 text-xs font-medium transition-colors duration-fast',
              railTab === tab.key ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
            )}
          >
            {tab.label}
            {tab.key === 'industry' && state.industryPack && (
              <span className="ml-1.5 inline-block size-1.5 rounded-full bg-accent align-middle" />
            )}
            <span
              aria-hidden
              className={cn(
                'absolute inset-x-1.5 -bottom-px h-0.5 origin-left rounded-full bg-accent transition-transform duration-base ease-snap',
                railTab === tab.key ? 'scale-x-100' : 'scale-x-0',
              )}
            />
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {railTab === 'brief' ? (
          <BriefPanel
            state={state}
            onEdit={editSlot}
            onBuild={() => void startGeneration(DEFAULT_SCENARIOS)}
            busy={generating}
            docked={docked}
            onDock={(next: boolean) => dockTo(next ? 'right' : 'float')}
          />
        ) : (
          <IndustryPanel
            pack={state.industryPack}
            building={packBuilding}
            industryLabel={state.slots.industry ?? null}
          />
        )}
      </div>
    </div>
  );

  // ---- commands ------------------------------------------------------------
  const palette = useCommandPalette();
  const { theme, toggle: toggleTheme } = useTheme();

  const resetLayout = React.useCallback(() => {
    clearPanelLayout();
    chatSplit.reset();
    briefSplit.reset();
    dockTo('right');
    setBriefOpen(true);
  }, [chatSplit, briefSplit, dockTo]);

  const commands = React.useMemo<Command[]>(() => {
    const list: Command[] = [
      {
        id: 'new',
        group: 'Run',
        label: 'Start a new ICP',
        icon: <Plus />,
        keywords: 'create begin fresh',
        run: () => void newRun(),
      },
      {
        id: 'saved',
        group: 'Run',
        label: 'Saved ICPs',
        icon: <FolderClock />,
        keywords: 'history library previous',
        run: () => router.push('/runs'),
      },
      {
        id: 'admin',
        group: 'Run',
        label: 'Usage and history',
        icon: <Gauge />,
        keywords: 'cost tokens spend admin',
        run: () => router.push('/admin'),
      },
      {
        id: 'rebuild',
        group: 'Run',
        label: 'Rebuild every profile',
        icon: <Hammer />,
        hint: 'Regenerates all four awareness stages',
        keywords: 'regenerate again redo',
        disabled: !state.readiness.briefComplete || generating,
        run: () => void startGeneration(DEFAULT_SCENARIOS, true),
      },
      {
        id: 'copy-link',
        group: 'Run',
        label: 'Copy a link to this run',
        icon: <Copy />,
        keywords: 'share url',
        run: () => void navigator.clipboard?.writeText(window.location.href).catch(() => {}),
      },

      {
        id: 'brief-toggle',
        group: 'Layout',
        label: briefOpen && docked ? 'Hide the brief' : 'Show the brief',
        icon: briefOpen && docked ? <PanelRightClose /> : <PanelRightOpen />,
        run: () => (docked ? toggleBriefOpen() : dockTo('right')),
      },
      {
        id: 'brief-left',
        group: 'Layout',
        label: 'Dock the brief left',
        icon: <PanelLeftClose />,
        keywords: 'move side',
        disabled: briefDock === 'left',
        run: () => dockTo('left'),
      },
      {
        id: 'brief-right',
        group: 'Layout',
        label: 'Dock the brief right',
        icon: <PanelRightClose />,
        keywords: 'move side',
        disabled: briefDock === 'right',
        run: () => dockTo('right'),
      },
      {
        id: 'brief-float',
        group: 'Layout',
        label: 'Detach the brief',
        icon: <LayoutGrid />,
        hint: 'Float it — drag to an edge to dock again',
        keywords: 'undock floating window',
        disabled: briefDock === 'float',
        run: () => dockTo('float'),
      },
      {
        id: 'layout-reset',
        group: 'Layout',
        label: 'Reset layout',
        icon: <RotateCcw />,
        hint: 'Restore every panel to its default size and position',
        keywords: 'default restore arrangement',
        run: resetLayout,
      },
      {
        id: 'theme',
        group: 'Layout',
        label: theme === 'dark' ? 'Switch to light' : 'Switch to dark',
        icon: theme === 'dark' ? <Sun /> : <Moon />,
        keywords: 'appearance mode contrast',
        run: toggleTheme,
      },
    ];
    return list;
  }, [
    state.readiness.briefComplete, generating, briefOpen, docked, briefDock,
    theme, toggleTheme, dockTo, toggleBriefOpen, resetLayout, router,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ]);

  return (
    <div className="atmosphere flex h-dvh flex-col overflow-hidden bg-bg text-fg">
      <TopBar
        state={state}
        generating={generating}
        onNew={newRun}
        briefOpen={briefOpen && docked}
        onToggleBrief={() => (docked ? toggleBriefOpen() : dockTo('right'))}
        onOpenPalette={() => palette.setOpen(true)}
        hasResults={hasResults}
        mobileView={mobileView}
        onMobileView={setMobileView}
        simple={simple}
        userName={userName}
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
            !chatSplit.dragging && !chatSplit.settling && 'transition-[width] duration-base ease-out',
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
            footer={
              buildComplete ? (
                <StructureCard
                  documents={state.documents}
                  comparisons={state.comparisons}
                  companyName={state.slots.company_name ?? null}
                />
              ) : null
            }
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

        {/* ---- brief, docked ------------------------------------------------
            CSS order rather than conditional placement, so moving the brief
            from one edge to the other never unmounts it — an unmount would
            discard scroll position and any half-finished inline edit. */}
        {!simple && docked && briefOpen && (
          <>
            <SplitHandle
              {...briefSplit.handleProps}
              dragging={briefSplit.dragging}
              label="Resize the brief"
              className={cn('hidden md:block', dockLeft ? 'order-[-1]' : 'order-1')}
            />
            <div
              ref={briefSplit.panelRef}
              // Keyed on the edge so switching sides replays the entrance from
              // the correct direction rather than silently swapping position.
              key={briefDock}
              style={{ width: briefSplit.size }}
              className={cn(
                'hidden shrink-0 md:flex',
                dockLeft ? 'order-[-2] animate-dock-left' : 'order-2 animate-dock-right',
                !briefSplit.dragging && !briefSplit.settling &&
                  'transition-[width] duration-base ease-out',
              )}
            >
              {brief}
            </div>
          </>
        )}

        {/* ---- brief, floating ---------------------------------------------- */}
        {!simple && briefDock === 'float' && (
          <FloatingBrief onDock={(side) => dockTo(side)} onClose={() => dockTo('right')}>
            {brief}
          </FloatingBrief>
        )}

        {/* Mobile gets the brief as a full surface, not a cramped sheet. */}
        {!simple && (
          <div
            className={cn('min-h-0 flex-1 md:hidden', mobileView === 'brief' ? 'flex' : 'hidden')}
          >
            {brief}
          </div>
        )}
      </div>

      {generating && <GeneratingToast count={Object.keys(live).length} />}

      <ScopePicker
        open={state.discovery.needsScopeChoice}
        companyName={state.slots.company_name ?? null}
        services={state.discovery.services}
        pagesRead={state.discovery.pagesRead}
        busy={scopeBusy}
        onSubmit={(choice, slugs) => void submitScope(choice, slugs)}
        onDismiss={() => void submitScope(null, [])}
      />

      {!simple && (
        <CommandPalette
          open={palette.open}
          onOpenChange={palette.setOpen}
          commands={commands}
        />
      )}
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
  onOpenPalette,
  hasResults,
  mobileView,
  onMobileView,
  simple,
  userName,
}: {
  state: RunState;
  generating: boolean;
  onNew: () => void;
  briefOpen: boolean;
  onToggleBrief: () => void;
  onOpenPalette: () => void;
  hasResults: boolean;
  mobileView: 'chat' | 'results' | 'brief';
  onMobileView: (view: 'chat' | 'results' | 'brief') => void;
  simple?: boolean;
  userName?: string;
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
            options={
              simple
                ? [
                    { value: 'chat', label: 'Chat' },
                    { value: 'results', label: 'Profiles' },
                  ]
                : [
                    { value: 'chat', label: 'Chat' },
                    { value: 'results', label: 'Profiles' },
                    { value: 'brief', label: 'Brief' },
                  ]
            }
          />
        )}

        {/* Discoverability for the palette. A bare ⌘K shortcut nobody is told
            about is a shortcut nobody uses, so it gets a real target. */}
        {!simple && (
        <button
          type="button"
          onClick={onOpenPalette}
          aria-label="Open the command palette"
          className={cn(
            'group mr-1 hidden h-7 items-center gap-2 rounded-md border border-line pl-2 pr-1.5 sm:flex',
            'bg-surface-2/60 text-fg-muted transition-all duration-fast ease-out',
            'hover:border-line-strong hover:bg-surface-2 hover:text-fg-secondary active:scale-[0.98]',
          )}
        >
          <CommandIcon className="size-3.5" />
          <span className="text-sm">Commands</span>
          <Kbd className="transition-colors duration-fast group-hover:border-line-strong">⌘K</Kbd>
        </button>
        )}

        <Hint label="Saved ICPs">
          <Button variant="ghost" size="icon-sm" asChild>
            <Link href="/runs" aria-label="Saved ICPs">
              <FolderClock />
            </Link>
          </Button>
        </Hint>

        {!simple && (
          <Hint label="Usage and history">
            <Button variant="ghost" size="icon-sm" asChild>
              <Link href="/admin" aria-label="Admin">
                <Gauge />
              </Link>
            </Button>
          </Hint>
        )}

        <Hint label="Start a new ICP">
          <Button variant="ghost" size="icon-sm" onClick={onNew} aria-label="New ICP">
            <Plus />
          </Button>
        </Hint>

        <ThemeToggle />

        {!simple && (
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
        )}

        <SignOut userName={userName} />
      </div>
    </header>
  );
}

/**
 * The brief, detached.
 *
 * Dragged by its header, resized from any edge or corner, constrained so it can
 * never be lost off-screen, raised above its siblings the moment it is touched,
 * and — the part that makes it feel like a window rather than a div — dragged
 * to a screen edge to re-dock, with the landing zone previewed before release.
 * Escape abandons a drag in flight and springs it home.
 */
const TOPBAR_PX = 52;

function FloatingBrief({
  children,
  onDock,
  onClose,
}: {
  children: React.ReactNode;
  onDock: (side: 'left' | 'right') => void;
  onClose: () => void;
}) {
  const float = useFloating({
    id: 'brief:float',
    initial: {
      x: typeof window === 'undefined' ? 900 : Math.max(24, window.innerWidth - 392),
      y: TOPBAR_PX + 24,
      w: 344,
      h: 560,
    },
    minW: 280,
    minH: 260,
    topInset: TOPBAR_PX,
    onDock,
  });

  const moving = float.busy === 'move';

  return (
    <>
      <DockPreview target={float.dockHint} topInset={TOPBAR_PX} />

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
          float.busy
            ? 'select-none'
            : 'transition-[box-shadow,opacity] duration-base ease-out',
          // Lifting the panel while it moves, and dimming it while a dock is
          // armed, means the preview underneath is the thing you are reading.
          moving && 'shadow-e4',
          moving && float.dockHint && 'opacity-70',
        )}
        role="dialog"
        aria-label="Brief"
      >
        <div
          onPointerDown={float.onMovePointerDown}
          onDoubleClick={float.toggleMaximize}
          className={cn(
            'flex h-9 shrink-0 items-center gap-2 border-b border-line bg-surface-2 px-2.5',
            'transition-colors duration-fast',
            moving ? 'cursor-grabbing bg-surface-3' : 'cursor-grab',
          )}
        >
          <GripHorizontal className="size-3.5 shrink-0 text-fg-subtle" />
          <span className="eyebrow flex-1 select-none">Brief</span>

          <Hint label={float.maximized ? 'Restore' : 'Fill the screen'}>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={float.toggleMaximize}
              data-no-drag
              aria-label={float.maximized ? 'Restore the brief' : 'Maximise the brief'}
            >
              {float.maximized ? <Minimize2 /> : <Maximize2 />}
            </Button>
          </Hint>

          <Hint label="Dock to the side">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onClose}
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
    </>
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
