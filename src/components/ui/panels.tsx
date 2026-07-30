'use client';

/**
 * Panel manipulation: resizable splits, and a floating panel with a real
 * window-manager's behaviour — drag-to-dock, spring settle, maximise,
 * escape-to-cancel.
 *
 * Two rules govern everything in this file.
 *
 * ONE: a drag never goes through React state. Every pointermove writes straight
 * to the element's inline style inside a rAF, and state is committed once on
 * release. Routing 120 pointer events a second through a re-render of a subtree
 * containing a streaming markdown document is exactly how a resize handle
 * acquires the half-frame of lag that makes an interface feel cheap.
 *
 * TWO: direct manipulation is 1:1, everything else is sprung. While a finger is
 * down the panel tracks the pointer exactly — a spring here would feel like
 * dragging something through treacle. The moment the finger lifts and the panel
 * has somewhere to *go* (a snap point, a dock, a maximise), it springs. That
 * split is the whole difference between "animated" and "physical".
 *
 * Everything persists per panel id, so an arrangement survives a reload.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const NS = 'prism:panel:';

function load<T>(id: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(NS + id);
    return raw ? ({ ...fallback, ...JSON.parse(raw) } as T) : fallback;
  } catch {
    return fallback;
  }
}

function save<T>(id: string, value: T): void {
  try {
    window.localStorage.setItem(NS + id, JSON.stringify(value));
  } catch {
    /* private mode, quota — an unsaved layout is not worth an error */
  }
}

/** Wipe every stored arrangement. Backs the "reset layout" command. */
export function clearPanelLayout(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(NS)) doomed.push(key);
    }
    doomed.forEach((key) => window.localStorage.removeItem(key));
  } catch {
    /* nothing to do */
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Pull toward a nearby landmark, but only when genuinely close to it. */
function applySnap(value: number, points: number[], threshold = 9): number {
  let best = value;
  let bestDistance = threshold;
  for (const point of points) {
    const distance = Math.abs(value - point);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = point;
    }
  }
  return best;
}

function setDragging(on: boolean, cursor: string) {
  if (typeof document === 'undefined') return;
  document.body.classList.toggle('dragging', on);
  document.body.style.setProperty('--drag-cursor', cursor);
}

// ---------------------------------------------------------------------------
// Spring
// ---------------------------------------------------------------------------

export interface SpringConfig {
  stiffness: number;
  damping: number;
  mass: number;
}

/** Settles in ~340ms with a whisper of overshoot. Used for release and dock. */
const SETTLE: SpringConfig = { stiffness: 210, damping: 24, mass: 1 };
/** Tighter, no overshoot. Used when a panel snaps back to a bound. */
const SNAP_BACK: SpringConfig = { stiffness: 260, damping: 30, mass: 1 };

/**
 * Integrate a 0→1 progress spring and hand each frame to the caller.
 *
 * A single progress value drives every dimension rather than one spring per
 * axis, so width and x can never desynchronise mid-flight — which is what
 * produces that subtle shearing wobble in naive implementations.
 *
 * Semi-implicit Euler with fixed substeps: stable regardless of frame rate, so
 * a dropped frame slows the animation rather than exploding it.
 */
function runSpring(
  onProgress: (t: number) => void,
  onDone: () => void,
  config: SpringConfig = SETTLE,
): () => void {
  if (typeof window === 'undefined') {
    onProgress(1);
    onDone();
    return () => {};
  }

  // Respect the OS setting. Physics is expression, not information.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    onProgress(1);
    onDone();
    return () => {};
  }

  let value = 0;
  let velocity = 0;
  let last = performance.now();
  let frame = requestAnimationFrame(step);

  function step(now: number) {
    const dt = Math.min(0.064, (now - last) / 1000);
    last = now;

    const substeps = Math.max(1, Math.ceil(dt / 0.004));
    const h = dt / substeps;
    for (let i = 0; i < substeps; i++) {
      const force = config.stiffness * (1 - value) - config.damping * velocity;
      velocity += (force / config.mass) * h;
      value += velocity * h;
    }

    if (Math.abs(1 - value) < 0.0015 && Math.abs(velocity) < 0.02) {
      onProgress(1);
      onDone();
      return;
    }

    onProgress(value);
    frame = requestAnimationFrame(step);
  }

  return () => cancelAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// Resizable split
// ---------------------------------------------------------------------------

export interface SplitOptions {
  id: string;
  initial: number;
  min: number;
  max: number;
  /** Which edge the handle sits on, relative to the panel being sized. */
  side: 'left' | 'right';
  /** Landmarks the handle should gravitate toward. */
  snap?: number[];
  enabled?: boolean;
}

export interface SplitControls {
  size: number;
  dragging: boolean;
  /** True while the width is being sprung, so transitions stay out of the way. */
  settling: boolean;
  /** Attach to the element whose width is being controlled. */
  panelRef: React.RefObject<HTMLDivElement | null>;
  /** Spread onto <SplitHandle>. */
  handleProps: {
    onPointerDown: (event: React.PointerEvent) => void;
    onDoubleClick: () => void;
    onKeyDown: (event: React.KeyboardEvent) => void;
    'aria-valuenow': number;
    'aria-valuemin': number;
    'aria-valuemax': number;
  };
  reset: () => void;
  setSize: (next: number, animate?: boolean) => void;
}

export function useSplit(options: SplitOptions): SplitControls {
  const { id, initial, min, max, side, snap = [], enabled = true } = options;

  const [size, setSizeState] = React.useState(initial);
  const [dragging, setDragging_] = React.useState(false);
  const [settling, setSettling] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const frame = React.useRef<number | null>(null);
  const cancelSpring = React.useRef<(() => void) | null>(null);
  const live = React.useRef(initial);
  const start = React.useRef({ pointer: 0, size: 0 });

  // Restore after mount so server and client markup agree.
  React.useEffect(() => {
    const stored = load(id, { size: initial });
    const next = clamp(stored.size, min, max);
    live.current = next;
    setSizeState(next);
  }, [id, initial, min, max]);

  const paintWidth = React.useCallback((value: number) => {
    if (panelRef.current) panelRef.current.style.width = `${Math.round(value)}px`;
  }, []);

  const paint = React.useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      paintWidth(live.current);
    });
  }, [paintWidth]);

  const commit = React.useCallback(
    (next: number) => {
      const clamped = clamp(next, min, max);
      live.current = clamped;
      setSizeState(clamped);
      save(id, { size: clamped });
    },
    [id, min, max],
  );

  /** Spring the width to a target — used by keyboard, double-click and reset. */
  const springTo = React.useCallback(
    (target: number, config: SpringConfig = SETTLE) => {
      cancelSpring.current?.();
      const from = live.current;
      const to = clamp(target, min, max);
      if (Math.abs(to - from) < 0.5) {
        commit(to);
        return;
      }

      setSettling(true);
      cancelSpring.current = runSpring(
        (t) => paintWidth(from + (to - from) * t),
        () => {
          cancelSpring.current = null;
          setSettling(false);
          commit(to);
        },
        config,
      );
    },
    [min, max, commit, paintWidth],
  );

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault();
      cancelSpring.current?.();
      setSettling(false);

      const handle = event.currentTarget as HTMLElement;
      handle.setPointerCapture(event.pointerId);

      start.current = { pointer: event.clientX, size: live.current };
      const origin = live.current;
      setDragging_(true);
      setDragging(true, 'col-resize');

      let cancelled = false;

      const move = (e: PointerEvent) => {
        const delta = e.clientX - start.current.pointer;
        const raw = side === 'right' ? start.current.size + delta : start.current.size - delta;
        live.current = applySnap(clamp(raw, min, max), snap);
        paint();
      };

      const finish = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        window.removeEventListener('keydown', onKey);
        setDragging_(false);
        setDragging(false, '');
      };

      const up = () => {
        finish();
        if (cancelled) return;
        commit(live.current);
      };

      // Escape abandons the gesture and springs back to where it started.
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        cancelled = true;
        e.preventDefault();
        finish();
        live.current = origin;
        springTo(origin, SNAP_BACK);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
      window.addEventListener('keydown', onKey);
    },
    [enabled, side, min, max, snap, paint, commit, springTo],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 48 : 12;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        springTo(live.current + (side === 'right' ? -step : step));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        springTo(live.current + (side === 'right' ? step : -step));
      } else if (event.key === 'Home') {
        event.preventDefault();
        springTo(min);
      } else if (event.key === 'End') {
        event.preventDefault();
        springTo(max);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        springTo(initial);
      }
    },
    [springTo, side, min, max, initial],
  );

  // Keep the inline width honest when state changes outside a drag.
  React.useEffect(() => {
    if (!dragging && !settling && panelRef.current) {
      panelRef.current.style.width = `${size}px`;
    }
  }, [size, dragging, settling]);

  // A window that shrinks must not leave a panel wider than the viewport.
  React.useEffect(() => {
    const onResize = () => {
      const ceiling = Math.min(max, window.innerWidth - 320);
      if (live.current > ceiling) commit(ceiling);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [max, commit]);

  React.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      cancelSpring.current?.();
    },
    [],
  );

  return {
    size,
    dragging,
    settling,
    panelRef,
    handleProps: {
      onPointerDown,
      onDoubleClick: () => springTo(initial),
      onKeyDown,
      'aria-valuenow': Math.round(size),
      'aria-valuemin': min,
      'aria-valuemax': max,
    },
    reset: () => springTo(initial),
    setSize: (next, animate = true) => (animate ? springTo(next) : commit(next)),
  };
}

/**
 * The handle itself. One pixel of visible line, twelve pixels of hit area — a
 * resize target you have to aim for is a resize target people stop using.
 */
export function SplitHandle({
  dragging,
  label,
  className,
  ...props
}: {
  dragging?: boolean;
  label: string;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      tabIndex={0}
      className={cn(
        'group relative z-rail w-3 shrink-0 cursor-col-resize touch-none',
        'focus-visible:outline-none',
        className,
      )}
      {...props}
    >
      {/* The visible rule. Thickens rather than only recolouring on hover — a
          1px line changing hue is far below the threshold of noticing. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-full',
          'transition-[background-color,width] duration-fast ease-out',
          dragging ? 'w-[2px] bg-accent' : 'w-px bg-line group-hover:w-[2px] group-hover:bg-line-strong',
        )}
      />
      {/* Grip dots — the discoverability affordance. Invisible until the pointer
          is near, so the chrome stays quiet at rest. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-[3px]',
          'transition-opacity duration-base ease-out',
          dragging
            ? 'opacity-100'
            : 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100',
        )}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn(
              'size-[3px] rounded-full transition-colors duration-fast',
              dragging ? 'bg-accent' : 'bg-fg-subtle',
            )}
          />
        ))}
      </span>
      {/* Widened focus ring that does not disturb layout. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full opacity-0 ring-2 ring-ring group-focus-visible:opacity-100"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Floating panel
// ---------------------------------------------------------------------------

export interface FloatRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a drag would land if released now. */
export type DockTarget = 'left' | 'right' | 'maximize' | null;

export interface FloatOptions {
  id: string;
  initial: FloatRect;
  minW?: number;
  minH?: number;
  enabled?: boolean;
  /** Fired when a drag is released inside a dock zone. */
  onDock?: (side: 'left' | 'right') => void;
  /** Height of fixed chrome above the panel, so maximise does not sit under it. */
  topInset?: number;
}

type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const EDGE_CURSOR: Record<Edge, string> = {
  n: 'ns-resize',
  s: 'ns-resize',
  e: 'ew-resize',
  w: 'ew-resize',
  ne: 'nesw-resize',
  sw: 'nesw-resize',
  nw: 'nwse-resize',
  se: 'nwse-resize',
};

/** How close to an edge the POINTER must be for a dock to arm. */
const DOCK_ZONE = 76;

let zCounter = 40;

export function useFloating(options: FloatOptions) {
  const { id, initial, minW = 280, minH = 220, enabled = true, onDock, topInset = 0 } = options;

  const [rect, setRect] = React.useState<FloatRect>(initial);
  const [z, setZ] = React.useState(zCounter);
  const [busy, setBusy] = React.useState<null | 'move' | 'resize'>(null);
  const [settling, setSettling] = React.useState(false);
  const [dockHint, setDockHint] = React.useState<DockTarget>(null);
  const [maximized, setMaximized] = React.useState(false);

  const ref = React.useRef<HTMLDivElement | null>(null);
  const live = React.useRef<FloatRect>(initial);
  const frame = React.useRef<number | null>(null);
  const cancelSpring = React.useRef<(() => void) | null>(null);
  /** The rect to return to when un-maximising. */
  const restoreRect = React.useRef<FloatRect | null>(null);

  React.useEffect(() => {
    const stored = load(id, initial);
    const constrained = constrain(stored, minW, minH);
    live.current = constrained;
    setRect(constrained);
  }, [id, initial, minW, minH]);

  const write = React.useCallback((r: FloatRect) => {
    const node = ref.current;
    if (!node) return;
    node.style.transform = `translate3d(${Math.round(r.x)}px, ${Math.round(r.y)}px, 0)`;
    node.style.width = `${Math.round(r.w)}px`;
    node.style.height = `${Math.round(r.h)}px`;
  }, []);

  const paint = React.useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      write(live.current);
    });
  }, [write]);

  const commit = React.useCallback(() => {
    const next = constrain(live.current, minW, minH);
    live.current = next;
    setRect(next);
    save(id, next);
  }, [id, minW, minH]);

  /** Spring the whole rect to a target and commit when it lands. */
  const springTo = React.useCallback(
    (target: FloatRect, config: SpringConfig = SETTLE) => {
      cancelSpring.current?.();
      const from = { ...live.current };
      const to = constrain(target, minW, minH);

      const distance =
        Math.abs(to.x - from.x) + Math.abs(to.y - from.y) +
        Math.abs(to.w - from.w) + Math.abs(to.h - from.h);

      if (distance < 1) {
        live.current = to;
        commit();
        return;
      }

      setSettling(true);
      cancelSpring.current = runSpring(
        (t) => {
          const frameRect = {
            x: from.x + (to.x - from.x) * t,
            y: from.y + (to.y - from.y) * t,
            w: from.w + (to.w - from.w) * t,
            h: from.h + (to.h - from.h) * t,
          };
          live.current = frameRect;
          write(frameRect);
        },
        () => {
          cancelSpring.current = null;
          setSettling(false);
          live.current = to;
          commit();
        },
        config,
      );
    },
    [minW, minH, commit, write],
  );

  const raise = React.useCallback(() => {
    zCounter += 1;
    setZ(zCounter);
  }, []);

  const maximizedRect = React.useCallback((): FloatRect => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return { x: 16, y: topInset + 12, w: vw - 32, h: vh - topInset - 28 };
  }, [topInset]);

  const toggleMaximize = React.useCallback(() => {
    if (maximized) {
      const target = restoreRect.current ?? initial;
      restoreRect.current = null;
      setMaximized(false);
      springTo(target);
    } else {
      restoreRect.current = { ...live.current };
      setMaximized(true);
      springTo(maximizedRect());
    }
  }, [maximized, initial, springTo, maximizedRect]);

  /** Drag by the header. */
  const onMovePointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.button !== 0) return;
      // Buttons inside the header must stay clickable.
      if ((event.target as HTMLElement).closest('button,a,input,[data-no-drag]')) return;

      event.preventDefault();
      cancelSpring.current?.();
      setSettling(false);
      raise();

      const handle = event.currentTarget as HTMLElement;
      handle.setPointerCapture(event.pointerId);

      // Dragging a maximised panel restores it, sized so the grab point stays
      // under the cursor proportionally — the behaviour every OS window manager
      // has, and its absence is felt immediately.
      let origin = { px: event.clientX, py: event.clientY, ...live.current };
      if (maximized) {
        const restore = restoreRect.current ?? initial;
        const ratio = (event.clientX - live.current.x) / live.current.w;
        const next: FloatRect = {
          w: restore.w,
          h: restore.h,
          x: event.clientX - restore.w * ratio,
          y: Math.max(topInset + 8, event.clientY - 18),
        };
        setMaximized(false);
        restoreRect.current = null;
        live.current = constrain(next, minW, minH);
        write(live.current);
        origin = { px: event.clientX, py: event.clientY, ...live.current };
      }

      const startRect = { ...live.current };
      setBusy('move');
      setDragging(true, 'grabbing');

      let hint: DockTarget = null;
      let cancelled = false;

      const move = (e: PointerEvent) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let x = origin.x + (e.clientX - origin.px);
        let y = origin.y + (e.clientY - origin.py);

        // Dock arming is driven by the POINTER, not the panel's edge. Using the
        // panel edge means a wide panel arms a dock while the cursor is still
        // near the middle of the screen, which feels like the app guessing.
        const nextHint: DockTarget =
          e.clientX <= DOCK_ZONE
            ? 'left'
            : e.clientX >= vw - DOCK_ZONE
              ? 'right'
              : e.clientY <= topInset + 8
                ? 'maximize'
                : null;

        if (nextHint !== hint) {
          hint = nextHint;
          setDockHint(nextHint);
        }

        // Free-drag snapping to the viewport's own edges and centre line.
        if (!nextHint) {
          x = applySnap(x, [16, vw - origin.w - 16, (vw - origin.w) / 2], 12);
          y = applySnap(y, [topInset + 12, vh - origin.h - 16], 12);
        }

        // A panel can be pushed against an edge but never past it — losing a
        // panel off-screen with no way to retrieve it is unforgivable.
        live.current = {
          ...live.current,
          x: clamp(x, -origin.w + 88, vw - 88),
          y: clamp(y, topInset, vh - 44),
        };
        paint();
      };

      const finish = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        window.removeEventListener('keydown', onKey);
        setBusy(null);
        setDragging(false, '');
        setDockHint(null);
      };

      const up = () => {
        const landed = hint;
        finish();
        if (cancelled) return;

        if (landed === 'maximize') {
          restoreRect.current = startRect;
          setMaximized(true);
          springTo(maximizedRect());
          return;
        }
        if (landed === 'left' || landed === 'right') {
          // Hand over immediately. Springing into the edge and *then* unmounting
          // mid-flight is two animations fighting for the same 300ms; the
          // preview has already shown where this lands, so the docked panel
          // appearing is the continuity. Direct manipulation commits at once.
          //
          // The pre-dock rect is kept so undocking later returns the panel to
          // where the user last had it, not to a factory default.
          commit();
          onDock?.(landed);
          return;
        }
        commit();
      };

      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        cancelled = true;
        e.preventDefault();
        finish();
        springTo(startRect, SNAP_BACK);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
      window.addEventListener('keydown', onKey);
    },
    [
      enabled, raise, paint, commit, springTo, onDock, maximized,
      initial, minW, minH, topInset, write, maximizedRect,
    ],
  );

  /** Resize from any edge or corner. */
  const resizeHandleProps = React.useCallback(
    (edge: Edge) => ({
      onPointerDown: (event: React.PointerEvent) => {
        if (!enabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        cancelSpring.current?.();
        setSettling(false);
        raise();

        const handle = event.currentTarget as HTMLElement;
        handle.setPointerCapture(event.pointerId);

        const origin = { px: event.clientX, py: event.clientY, ...live.current };
        const startRect = { ...live.current };
        setBusy('resize');
        setDragging(true, EDGE_CURSOR[edge]);

        let cancelled = false;

        const move = (e: PointerEvent) => {
          const dx = e.clientX - origin.px;
          const dy = e.clientY - origin.py;
          let { x, y, w, h } = origin;

          if (edge.includes('e')) w = origin.w + dx;
          if (edge.includes('s')) h = origin.h + dy;
          if (edge.includes('w')) {
            // Dragging the west edge moves the origin as well as the width, and
            // must stop moving once the minimum is reached.
            w = clamp(origin.w - dx, minW, Infinity);
            x = origin.x + (origin.w - w);
          }
          if (edge.includes('n')) {
            h = clamp(origin.h - dy, minH, Infinity);
            y = origin.y + (origin.h - h);
          }

          live.current = constrain({ x, y, w, h }, minW, minH, topInset);
          paint();
        };

        const finish = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          window.removeEventListener('keydown', onKey);
          setBusy(null);
          setDragging(false, '');
        };

        const up = () => {
          finish();
          if (cancelled) return;
          if (maximized) setMaximized(false);
          commit();
        };

        const onKey = (e: KeyboardEvent) => {
          if (e.key !== 'Escape') return;
          cancelled = true;
          e.preventDefault();
          finish();
          springTo(startRect, SNAP_BACK);
        };

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
        window.addEventListener('keydown', onKey);
      },
    }),
    [enabled, raise, paint, commit, springTo, minW, minH, maximized, topInset],
  );

  // Keep a floating panel reachable when the window shrinks under it.
  React.useEffect(() => {
    const onResize = () => {
      if (maximized) {
        live.current = maximizedRect();
        setRect(live.current);
        write(live.current);
        return;
      }
      const next = constrain(live.current, minW, minH, topInset);
      live.current = next;
      setRect(next);
      write(next);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [minW, minH, write, maximized, maximizedRect, topInset]);

  React.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      cancelSpring.current?.();
    },
    [],
  );

  return {
    rect,
    z,
    busy,
    settling,
    dockHint,
    maximized,
    ref,
    raise,
    toggleMaximize,
    onMovePointerDown,
    resizeHandleProps,
    reset: () => {
      setMaximized(false);
      restoreRect.current = null;
      springTo(initial);
    },
  };
}

function constrain(rect: FloatRect, minW: number, minH: number, topInset = 0): FloatRect {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;

  const w = clamp(rect.w, minW, Math.max(minW, vw - 32));
  const h = clamp(rect.h, minH, Math.max(minH, vh - topInset - 16));

  return {
    w,
    h,
    x: clamp(rect.x, -w + 88, Math.max(0, vw - 88)),
    y: clamp(rect.y, topInset, Math.max(topInset, vh - 44)),
  };
}

/** The eight invisible grab zones around a floating panel. */
export function ResizeHandles({
  handleProps,
}: {
  handleProps: (edge: Edge) => { onPointerDown: (event: React.PointerEvent) => void };
}) {
  const edges: { edge: Edge; className: string }[] = [
    { edge: 'n', className: 'left-3 right-3 top-0 h-1.5 cursor-ns-resize' },
    { edge: 's', className: 'left-3 right-3 bottom-0 h-1.5 cursor-ns-resize' },
    { edge: 'w', className: 'top-3 bottom-3 left-0 w-1.5 cursor-ew-resize' },
    { edge: 'e', className: 'top-3 bottom-3 right-0 w-1.5 cursor-ew-resize' },
    { edge: 'nw', className: 'left-0 top-0 size-3.5 cursor-nwse-resize' },
    { edge: 'ne', className: 'right-0 top-0 size-3.5 cursor-nesw-resize' },
    { edge: 'sw', className: 'bottom-0 left-0 size-3.5 cursor-nesw-resize' },
    { edge: 'se', className: 'bottom-0 right-0 size-3.5 cursor-nwse-resize' },
  ];

  return (
    <>
      {edges.map(({ edge, className }) => (
        <span
          key={edge}
          aria-hidden
          className={cn('absolute z-20 touch-none', className)}
          {...handleProps(edge)}
        />
      ))}
      {/* The one corner that gets a visible grip, bottom-right, because that is
          where people look for it. */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[5px] right-[5px] z-10 text-fg-subtle opacity-40 transition-opacity duration-base"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path
            d="M10 1v9H1"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeDasharray="0.5 3"
          />
        </svg>
      </span>
    </>
  );
}

/**
 * The landing-zone preview.
 *
 * Shown only while a drag is armed over a dock target. It is the difference
 * between a drop that feels intentional and one that feels like the app
 * deciding something on your behalf: you see the outcome before committing.
 */
export function DockPreview({ target, topInset = 0 }: { target: DockTarget; topInset?: number }) {
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted || !target) return null;

  const geometry =
    target === 'left'
      ? { left: 0, right: 'auto', width: 'clamp(280px, 26vw, 440px)' }
      : target === 'right'
        ? { left: 'auto', right: 0, width: 'clamp(280px, 26vw, 440px)' }
        : { left: 0, right: 0, width: 'auto' };

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed z-overlay animate-fade"
      style={{
        top: topInset,
        bottom: 0,
        ...geometry,
        padding: target === 'maximize' ? 12 : 8,
      }}
    >
      <div
        className={cn(
          'h-full w-full rounded-lg border-2 border-dashed border-accent/55 bg-accent/[0.07]',
          'shadow-[inset_0_0_40px_-12px_hsl(var(--accent)/0.35)]',
        )}
      >
        <div className="flex h-full items-center justify-center">
          <span className="eyebrow rounded-full bg-surface-1/90 px-2.5 py-1 text-accent shadow-e1">
            {target === 'maximize' ? 'Fill' : `Dock ${target}`}
          </span>
        </div>
      </div>
    </div>
  );
}
