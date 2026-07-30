import type { Config } from 'tailwindcss';

/**
 * Tailwind is a view onto the token set in globals.css — not a second source
 * of truth. Every value here resolves to a CSS variable, so a token change
 * propagates without touching a single component.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'hsl(var(--bg))',
        fg: {
          DEFAULT: 'hsl(var(--fg))',
          secondary: 'hsl(var(--fg-secondary))',
          muted: 'hsl(var(--fg-muted))',
          subtle: 'hsl(var(--fg-subtle))',
        },
        surface: {
          DEFAULT: 'hsl(var(--surface-1))',
          1: 'hsl(var(--surface-1))',
          2: 'hsl(var(--surface-2))',
          3: 'hsl(var(--surface-3))',
          sunken: 'hsl(var(--surface-sunken))',
        },
        line: {
          DEFAULT: 'hsl(var(--line))',
          strong: 'hsl(var(--line-strong))',
          subtle: 'hsl(var(--line-subtle))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-fg))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-fg))',
          soft: 'hsl(var(--accent-soft))',
        },
        positive: {
          DEFAULT: 'hsl(var(--positive))',
          soft: 'hsl(var(--positive-soft))',
        },
        caution: {
          DEFAULT: 'hsl(var(--caution))',
          soft: 'hsl(var(--caution-soft))',
        },
        critical: {
          DEFAULT: 'hsl(var(--critical))',
          soft: 'hsl(var(--critical-soft))',
        },
        stage: {
          1: 'hsl(var(--stage-1))',
          2: 'hsl(var(--stage-2))',
          3: 'hsl(var(--stage-3))',
          4: 'hsl(var(--stage-4))',
        },
        tr: {
          ink: 'hsl(var(--tr-ink))',
          cyan: 'hsl(var(--tr-cyan))',
          green: 'hsl(var(--tr-green))',
        },
        stated: 'hsl(var(--stated))',
        inferred: 'hsl(var(--inferred))',
        missing: 'hsl(var(--missing))',

        // shadcn-shaped aliases, kept so primitives read conventionally.
        border: 'hsl(var(--line))',
        input: 'hsl(var(--line-strong))',
        ring: 'hsl(var(--focus))',
        background: 'hsl(var(--bg))',
        foreground: 'hsl(var(--fg))',
        card: {
          DEFAULT: 'hsl(var(--surface-1))',
          foreground: 'hsl(var(--fg))',
        },
        popover: {
          DEFAULT: 'hsl(var(--surface-1))',
          foreground: 'hsl(var(--fg))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--surface-3))',
          foreground: 'hsl(var(--fg-secondary))',
        },
        muted: {
          DEFAULT: 'hsl(var(--surface-3))',
          foreground: 'hsl(var(--fg-muted))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--critical))',
          foreground: 'hsl(0 0% 100%)',
        },
      },

      borderRadius: {
        xs: 'var(--r-xs)',
        sm: 'var(--r-sm)',
        md: 'var(--r-md)',
        lg: 'var(--r-lg)',
        xl: 'var(--r-xl)',
        '2xl': 'var(--r-2xl)',
      },

      boxShadow: {
        e1: 'var(--elev-1)',
        e2: 'var(--elev-2)',
        e3: 'var(--elev-3)',
        e4: 'var(--elev-4)',
        hairline: 'var(--ring-inset)',
        highlight: 'var(--highlight)',
      },

      /* A modular scale. Letter-spacing tightens as size grows — the single
         most reliable signal of typographic care. */
      fontSize: {
        '2xs': ['10.5px', { lineHeight: '1.35', letterSpacing: '0.06em' }],
        xs: ['11.5px', { lineHeight: '1.45', letterSpacing: '0.01em' }],
        sm: ['12.5px', { lineHeight: '1.5', letterSpacing: '0.005em' }],
        base: ['13.5px', { lineHeight: '1.6', letterSpacing: '0' }],
        md: ['14.5px', { lineHeight: '1.62', letterSpacing: '-0.003em' }],
        lg: ['16px', { lineHeight: '1.55', letterSpacing: '-0.008em' }],
        xl: ['19px', { lineHeight: '1.4', letterSpacing: '-0.014em' }],
        '2xl': ['23px', { lineHeight: '1.3', letterSpacing: '-0.018em' }],
        '3xl': ['29px', { lineHeight: '1.22', letterSpacing: '-0.022em' }],
        '4xl': ['37px', { lineHeight: '1.14', letterSpacing: '-0.026em' }],
        '5xl': ['48px', { lineHeight: '1.06', letterSpacing: '-0.03em' }],
      },

      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['var(--font-display)', 'Georgia', 'serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },

      spacing: {
        rail: 'var(--rail)',
        topbar: 'var(--topbar)',
        '7.5': '1.875rem',
        '13': '3.25rem',
        '18': '4.5rem',
      },

      maxWidth: {
        measure: 'var(--measure)',
      },

      transitionTimingFunction: {
        out: 'var(--ease-out)',
        in: 'var(--ease-in)',
        'in-out': 'var(--ease-in-out)',
        spring: 'var(--ease-spring)',
        snap: 'var(--ease-snap)',
      },

      transitionDuration: {
        instant: 'var(--t-instant)',
        fast: 'var(--t-fast)',
        base: 'var(--t-base)',
        slow: 'var(--t-slow)',
        deliberate: 'var(--t-deliberate)',
      },

      keyframes: {
        rise: {
          from: { opacity: '0', transform: 'translate3d(0,10px,0)' },
          to: { opacity: '1', transform: 'none' },
        },
        pop: {
          from: { opacity: '0', transform: 'scale(0.94)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        drift: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(340%)' },
        },
      },

      animation: {
        rise: 'rise var(--t-slow) var(--ease-out) both',
        pop: 'pop var(--t-base) var(--ease-spring) both',
        drift: 'drift 1.5s var(--ease-in-out) infinite',
      },

      zIndex: {
        rail: '20',
        chrome: '30',
        float: '40',
        overlay: '50',
        popover: '60',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
