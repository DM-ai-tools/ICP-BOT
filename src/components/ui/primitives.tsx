'use client';

/**
 * The component vocabulary.
 *
 * Every primitive consumes tokens and nothing else. Hover, focus-visible,
 * active, disabled and loading are designed states here rather than
 * afterthoughts bolted on at the call site — which is the difference between
 * a set of components and a system.
 */
import * as React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as CheckboxPrimitive from '@radix-ui/react-checkbox';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

const buttonVariants = cva(
  [
    'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap',
    'font-medium transition-all duration-fast ease-snap',
    'outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
    'disabled:pointer-events-none disabled:opacity-40 disabled:saturate-50',
    // A 1px press, not a scale. Scaling text on click looks cheap and blurs
    // glyphs mid-transition.
    'active:translate-y-px',
    '[&_svg]:pointer-events-none [&_svg]:shrink-0',
  ].join(' '),
  {
    variants: {
      variant: {
        primary:
          'bg-primary text-primary-foreground shadow-e1 hover:brightness-[1.08] active:brightness-95',
        accent:
          'bg-accent text-accent-foreground shadow-e1 hover:brightness-[1.08] active:brightness-95',
        outline:
          'border border-line bg-surface-1 text-fg shadow-e1 hover:border-line-strong hover:bg-surface-2',
        subtle: 'bg-surface-3 text-fg-secondary hover:bg-surface-3/70 hover:text-fg',
        ghost: 'text-fg-secondary hover:bg-surface-3 hover:text-fg',
        danger:
          'bg-critical text-white shadow-e1 hover:brightness-110 active:brightness-95',
        link: 'text-accent underline-offset-4 hover:underline',
      },
      size: {
        xs: 'h-6 gap-1.5 rounded-sm px-2 text-2xs [&_svg]:size-3',
        sm: 'h-7.5 rounded-md px-2.5 text-sm [&_svg]:size-3.5',
        md: 'h-9 rounded-md px-3.5 text-base [&_svg]:size-4',
        lg: 'h-11 rounded-lg px-6 text-md [&_svg]:size-4',
        icon: 'h-9 w-9 rounded-md [&_svg]:size-4',
        'icon-sm': 'h-7 w-7 rounded-sm [&_svg]:size-3.5',
        'icon-xs': 'h-6 w-6 rounded-sm [&_svg]:size-3',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /** Swaps the label for a spinner and blocks interaction, keeping width. */
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';

    if (asChild) {
      return (
        <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props}>
          {children}
        </Comp>
      );
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={disabled || loading}
        data-loading={loading || undefined}
        {...props}
      >
        {/* The label stays in flow but goes invisible, so the button cannot
            change width the instant it starts working. */}
        <span
          className={cn(
            'inline-flex items-center gap-2 transition-opacity duration-fast',
            loading && 'opacity-0',
          )}
        >
          {children}
        </span>
        {loading && (
          <span className="absolute inset-0 grid place-items-center">
            <Spinner className="size-4" />
          </span>
        )}
      </button>
    );
  },
);
Button.displayName = 'Button';

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      'fixed inset-0 z-overlay bg-bg/70 backdrop-blur-sm',
      'data-[state=open]:animate-in data-[state=open]:fade-in-0',
      'data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = 'DialogOverlay';

export const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & { hideClose?: boolean }
>(({ className, children, hideClose, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        'panel-float fixed inset-x-0 bottom-0 z-overlay max-h-[92dvh] overflow-y-auto rounded-b-none p-6',
        'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-full sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-8',
        'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=open]:zoom-in-95 sm:data-[state=open]:slide-in-from-bottom-0',
        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-bottom-4 sm:data-[state=closed]:zoom-out-95',
        className,
      )}
      {...props}
    >
      {children}
      {!hideClose && (
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm p-1.5 text-fg-muted transition-colors hover:bg-surface-3 hover:text-fg">
          <X className="size-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = 'DialogContent';

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-2 text-left', className)} {...props} />;
}

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn('display text-2xl text-balance text-fg', className)}
    {...props}
  />
));
DialogTitle.displayName = 'DialogTitle';

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn('text-md leading-relaxed text-pretty text-fg-muted', className)}
    {...props}
  />
));
DialogDescription.displayName = 'DialogDescription';

// ---------------------------------------------------------------------------
// Checkbox / Switch
// ---------------------------------------------------------------------------

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      'peer size-[18px] shrink-0 rounded-xs border-[1.5px] border-line-strong',
      'transition-all duration-fast ease-snap',
      'hover:border-fg-subtle',
      'data-[state=checked]:border-accent data-[state=checked]:bg-accent data-[state=checked]:text-accent-foreground',
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="grid place-items-center text-current animate-pop">
      <Check className="size-3 stroke-[3.5]" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = 'Checkbox';

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      'peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent',
      'transition-colors duration-base ease-snap disabled:cursor-not-allowed disabled:opacity-40',
      'data-[state=checked]:bg-accent data-[state=unchecked]:bg-line-strong',
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-white shadow-e1 ring-0 transition-transform duration-base ease-spring data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
  </SwitchPrimitive.Root>
));
Switch.displayName = 'Switch';

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export const Tabs = TabsPrimitive.Root;

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('inline-flex items-center gap-1', className)} {...props} />
));
TabsList.displayName = 'TabsList';

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'group relative inline-flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium',
      'text-fg-muted transition-colors duration-fast ease-out',
      'hover:bg-surface-3/60 hover:text-fg-secondary',
      'data-[state=active]:bg-surface-3 data-[state=active]:text-fg',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = 'TabsTrigger';

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn('outline-none data-[state=active]:animate-fade', className)}
    {...props}
  />
));
TabsContent.displayName = 'TabsContent';

// ---------------------------------------------------------------------------
// Tooltip
// ---------------------------------------------------------------------------

export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 7, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'panel-raised z-popover max-w-[17rem] rounded-md px-2.5 py-1.5 text-xs leading-relaxed text-fg-secondary',
        'data-[state=delayed-open]:animate-pop data-[state=closed]:animate-out data-[state=closed]:fade-out-0',
        className,
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = 'TooltipContent';

/** Tooltip in one line, for the common icon-button case. */
export function Hint({
  label,
  children,
  side = 'bottom',
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{label}</TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

const badgeVariants = cva(
  'inline-flex items-center gap-1 whitespace-nowrap rounded-full text-2xs font-semibold leading-none ring-1 ring-inset',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-3 text-fg-muted ring-line',
        accent: 'bg-accent/10 text-accent ring-accent/25',
        positive: 'bg-positive/10 text-positive ring-positive/25',
        caution: 'bg-caution/12 text-caution ring-caution/28',
        critical: 'bg-critical/10 text-critical ring-critical/25',
        stated: 'bg-positive/10 text-positive ring-positive/25',
        inferred: 'bg-caution/12 text-caution ring-caution/28',
        missing: 'bg-surface-3 text-fg-subtle ring-line',
      },
      size: {
        sm: 'px-1.5 py-[3px] text-[9.5px]',
        md: 'px-2 py-[4px]',
      },
    },
    defaultVariants: { tone: 'neutral', size: 'md' },
  },
);

export function Badge({
  className,
  tone,
  size,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone, size }), className)} {...props} />;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Spinner({ className }: { className?: string }) {
  return (
    <svg
      className={cn('size-4 animate-spin', className)}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-20" cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="2.75" />
      <path
        d="M12 2.5a9.5 9.5 0 0 1 9.5 9.5"
        stroke="currentColor"
        strokeWidth="2.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('skeleton h-4 w-full', className)} {...props} />;
}

/**
 * Skeleton shaped like a paragraph. Ragged final line, because a block of
 * equal-length bars reads as a table and primes the wrong expectation.
 */
export function SkeletonText({
  lines = 4,
  className,
}: {
  lines?: number;
  className?: string;
}) {
  const widths = ['96%', '88%', '99%', '74%', '92%', '81%', '95%', '62%'];
  return (
    <div className={cn('space-y-2.5', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="h-3.5" style={{ width: widths[i % widths.length] }} />
      ))}
    </div>
  );
}

/** Indeterminate bar for work whose length genuinely cannot be known. */
export function ProgressTrack({ className }: { className?: string }) {
  return (
    <div className={cn('h-[3px] w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div className="h-full w-1/3 rounded-full bg-accent animate-drift" />
    </div>
  );
}

/** Determinate meter. */
export function Meter({ value, className }: { value: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn('h-1 w-full overflow-hidden rounded-full bg-surface-3', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-deliberate ease-out"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-lg border border-dashed border-line px-8 py-14 text-center',
        className,
      )}
    >
      {icon && (
        <span className="mb-4 grid size-11 place-items-center rounded-full bg-surface-3 text-fg-subtle">
          {icon}
        </span>
      )}
      <p className="display text-xl text-fg">{title}</p>
      {body && (
        <p className="mt-1.5 max-w-sm text-base leading-relaxed text-pretty text-fg-muted">{body}</p>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

export function Divider({
  className,
  orientation = 'horizontal',
  soft,
}: {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
  soft?: boolean;
}) {
  if (orientation === 'vertical') {
    return <span aria-hidden className={cn('w-px self-stretch bg-line', className)} />;
  }
  return (
    <div
      aria-hidden
      className={cn(soft ? 'rule-fade' : 'h-px w-full bg-line', className)}
    />
  );
}

export function Eyebrow({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('eyebrow', className)} {...props} />;
}

/** Keyboard hint. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'mono inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-xs border border-line bg-surface-2 px-1 text-[10px] font-medium text-fg-subtle',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Small dot used for provenance and status. */
export function Dot({ tone, className }: { tone: string; className?: string }) {
  return <span className={cn('size-[7px] shrink-0 rounded-full', tone, className)} aria-hidden />;
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-8 w-full rounded-md border border-line bg-surface-2 px-2.5 text-base text-fg',
        'transition-colors duration-fast placeholder:text-fg-subtle',
        'hover:border-line-strong focus:border-accent/60 focus:bg-surface-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex w-full resize-none rounded-md border border-line bg-surface-2 px-3 py-2 text-md text-fg',
      'transition-colors duration-fast placeholder:text-fg-subtle',
      'hover:border-line-strong focus:border-accent/60',
      'disabled:cursor-not-allowed disabled:opacity-50',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';

/** Segmented control — a real one, with a sliding indicator. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: 'sm' | 'md';
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));

  return (
    <div
      className={cn(
        'relative inline-grid rounded-md bg-surface-3 p-[3px]',
        size === 'sm' ? 'h-7' : 'h-8',
        className,
      )}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0,1fr))` }}
      role="tablist"
    >
      {/* The indicator slides between positions rather than the background
          jumping — the movement is what makes the control feel physical. */}
      <span
        aria-hidden
        className="absolute inset-y-[3px] rounded-sm bg-surface-1 shadow-e1 transition-transform duration-base ease-spring"
        style={{
          width: `calc((100% - 6px) / ${options.length})`,
          transform: `translateX(calc(${index} * 100%))`,
          left: 3,
        }}
      />
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={option.value === value}
          onClick={() => onChange(option.value)}
          className={cn(
            'relative z-10 rounded-sm px-3 text-sm font-medium transition-colors duration-fast',
            option.value === value ? 'text-fg' : 'text-fg-muted hover:text-fg-secondary',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
