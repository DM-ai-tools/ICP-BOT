'use client';

/**
 * Panel manipulation: resizable splits and a detachable floating panel.
 *
 * The single most important decision in here is that a drag NEVER goes through
 * React state. Every pointermove writes straight to the element's inline style
 * inside a rAF, and state is committed once on release. Routing 120 pointer
 * events a second through a re-render of a subtree containing a streaming
 * markdown document is exactly how a resize handle acquires that half-frame of
 * lag that makes an interface feel cheap.
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
  setSize: (next: number) => void;
}

export function useSplit(options: SplitOptions): SplitControls {
  const { id, initial, min, max, side, snap = [], enabled = true } = options;

  const [size, setSizeState] = React.useState(initial);
  const [dragging, setDragging_] = React.useState(false);
  const panelRef = React.useRef<HTMLDivElement | null>(null);

  const frame = React.useRef<number | null>(null);
  const live = React.useRef(initial);
  const start = React.useRef({ pointer: 0, size: 0 });

  // Restore after mount so server and client markup agree.
  React.useEffect(() => {
    const stored = load(id, { size: initial });
    const next = clamp(stored.size, min, max);
    live.current = next;
    setSizeState(next);
  }, [id, initial, min, max]);

  const commit = React.useCallback(
    (next: number) => {
      const clamped = clamp(next, min, max);
      live.current = clamped;
      setSizeState(clamped);
      save(id, { size: clamped });
    },
    [id, min, max],
  );

  const paint = React.useCallback((next: number) => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (panelRef.current) panelRef.current.style.width = `${live.current}px`;
    });
    void next;
  }, []);

  const onPointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault();

      const handle = event.currentTarget as HTMLElement;
      handle.setPointerCapture(event.pointerId);

      start.current = { pointer: event.clientX, size: live.current };
      setDragging_(true);
      setDragging(true, 'col-resize');

      const move = (e: PointerEvent) => {
        const delta = e.clientX - start.current.pointer;
        const raw = side === 'right' ? start.current.size + delta : start.current.size - delta;
        live.current = applySnap(clamp(raw, min, max), snap);
        paint(live.current);
      };

      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        setDragging_(false);
        setDragging(false, '');
        commit(live.current);
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    },
    [enabled, side, min, max, snap, paint, commit],
  );

  const onKeyDown = React.useCallback(
    (event: React.KeyboardEvent) => {
      const step = event.shiftKey ? 48 : 12;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        commit(live.current + (side === 'right' ? -step : step));
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        commit(live.current + (side === 'right' ? step : -step));
      } else if (event.key === 'Home') {
        event.preventDefault();
        commit(min);
      } else if (event.key === 'End') {
        event.preventDefault();
        commit(max);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        commit(initial);
      }
    },
    [commit, side, min, max, initial],
  );

  // Keep the inline width honest when state changes outside a drag.
  React.useEffect(() => {
    if (!dragging && panelRef.current) panelRef.current.style.width = `${size}px`;
  }, [size, dragging]);

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
    },
    [],
  );

  return {
    size,
    dragging,
    panelRef,
    handleProps: {
      onPointerDown,
      onDoubleClick: () => commit(initial),
      onKeyDown,
      'aria-valuenow': Math.round(size),
      'aria-valuemin': min,
      'aria-valuemax': max,
    },
    reset: () => commit(initial),
    setSize: commit,
  };
}

/**
 * The handle itself. Two pixels of visible line, twelve pixels of hit area —
 * a resize target you have to aim for is a resize target people stop using.
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
      {/* The visible rule. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 transition-colors duration-fast',
          dragging ? 'bg-accent' : 'bg-line group-hover:bg-line-strong',
        )}
      />
      {/* Grip dots — the discoverability affordance. Invisible until the
          pointer is near, so the chrome stays quiet at rest. */}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-[3px]',
          'opacity-0 transition-opacity duration-base group-hover:opacity-100 group-focus-visible:opacity-100',
          dragging && 'opacity-100',
        )}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={cn('size-[3px] rounded-full', dragging ? 'bg-accent' : 'bg-fg-subtle')}
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

export interface FloatOptions {
  id: string;
  initial: FloatRect;
  minW?: number;
  minH?: number;
  enabled?: boolean;
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

let zCounter = 40;

export function useFloating(options: FloatOptions) {
  const { id, initial, minW = 280, minH = 220, enabled = true } = options;

  const [rect, setRect] = React.useState<FloatRect>(initial);
  const [z, setZ] = React.useState(zCounter);
  const [busy, setBusy] = React.useState<null | 'move' | 'resize'>(null);

  const ref = React.useRef<HTMLDivElement | null>(null);
  const live = React.useRef<FloatRect>(initial);
  const frame = React.useRef<number | null>(null);

  React.useEffect(() => {
    const stored = load(id, initial);
    const constrained = constrain(stored, minW, minH);
    live.current = constrained;
    setRect(constrained);
  }, [id, initial, minW, minH]);

  const paint = React.useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const node = ref.current;
      if (!node) return;
      const { x, y, w, h } = live.current;
      node.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
      node.style.width = `${Math.round(w)}px`;
      node.style.height = `${Math.round(h)}px`;
    });
  }, []);

  const commit = React.useCallback(() => {
    const next = constrain(live.current, minW, minH);
    live.current = next;
    setRect(next);
    save(id, next);
  }, [id, minW, minH]);

  const raise = React.useCallback(() => {
    zCounter += 1;
    setZ(zCounter);
  }, []);

  /** Drag by the header. */
  const onMovePointerDown = React.useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || event.button !== 0) return;
      // Buttons inside the header must stay clickable.
      if ((event.target as HTMLElement).closest('button,a,input,[data-no-drag]')) return;

      event.preventDefault();
      raise();

      const handle = event.currentTarget as HTMLElement;
      handle.setPointerCapture(event.pointerId);

      const origin = { px: event.clientX, py: event.clientY, ...live.current };
      setBusy('move');
      setDragging(true, 'grabbing');

      const move = (e: PointerEvent) => {
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let x = origin.x + (e.clientX - origin.px);
        let y = origin.y + (e.clientY - origin.py);

        // Snap to the viewport's own edges and centre line.
        x = applySnap(x, [16, vw - origin.w - 16, (vw - origin.w) / 2], 12);
        y = applySnap(y, [16, vh - origin.h - 16], 12);

        // A panel can be pushed against an edge but never past it — losing a
        // panel off-screen with no way to get it back is unforgivable.
        live.current = {
          ...live.current,
          x: clamp(x, -origin.w + 88, vw - 88),
          y: clamp(y, 0, vh - 44),
        };
        paint();
      };

      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
        setBusy(null);
        setDragging(false, '');
        commit();
      };

      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
    },
    [enabled, raise, paint, commit],
  );

  /** Resize from any edge or corner. */
  const resizeHandleProps = React.useCallback(
    (edge: Edge) => ({
      onPointerDown: (event: React.PointerEvent) => {
        if (!enabled || event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        raise();

        const handle = event.currentTarget as HTMLElement;
        handle.setPointerCapture(event.pointerId);

        const origin = { px: event.clientX, py: event.clientY, ...live.current };
        setBusy('resize');
        setDragging(true, EDGE_CURSOR[edge]);

        const move = (e: PointerEvent) => {
          const dx = e.clientX - origin.px;
          const dy = e.clientY - origin.py;
          let { x, y, w, h } = origin;

          if (edge.includes('e')) w = origin.w + dx;
          if (edge.includes('s')) h = origin.h + dy;
          if (edge.includes('w')) {
            // Dragging the west edge moves the origin as well as the width,
            // and must stop moving once the minimum is reached.
            w = clamp(origin.w - dx, minW, Infinity);
            x = origin.x + (origin.w - w);
          }
          if (edge.includes('n')) {
            h = clamp(origin.h - dy, minH, Infinity);
            y = origin.y + (origin.h - h);
          }

          live.current = constrain({ x, y, w, h }, minW, minH);
          paint();
        };

        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          setBusy(null);
          setDragging(false, '');
          commit();
        };

        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      },
    }),
    [enabled, raise, paint, commit, minW, minH],
  );

  // Keep a floating panel reachable when the window shrinks under it.
  React.useEffect(() => {
    const onResize = () => {
      const next = constrain(live.current, minW, minH);
      live.current = next;
      setRect(next);
      paint();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [minW, minH, paint]);

  React.useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  return {
    rect,
    z,
    busy,
    ref,
    raise,
    onMovePointerDown,
    resizeHandleProps,
    reset: () => {
      live.current = initial;
      setRect(initial);
      save(id, initial);
      paint();
    },
  };
}

function constrain(rect: FloatRect, minW: number, minH: number): FloatRect {
  const vw = typeof window === 'undefined' ? 1440 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 900 : window.innerHeight;

  const w = clamp(rect.w, minW, Math.max(minW, vw - 32));
  const h = clamp(rect.h, minH, Math.max(minH, vh - 32));

  return {
    w,
    h,
    x: clamp(rect.x, -w + 88, Math.max(0, vw - 88)),
    y: clamp(rect.y, 0, Math.max(0, vh - 44)),
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
      <span aria-hidden className="pointer-events-none absolute bottom-[5px] right-[5px] z-10 opacity-45">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
          <path
            d="M10 1v9H1"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            className="text-fg-subtle"
            strokeDasharray="0.5 3"
          />
        </svg>
      </span>
    </>
  );
}
