import type { Metadata, Viewport } from 'next';
import { Instrument_Sans, Instrument_Serif, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { APP_DESCRIPTION, APP_FULL_NAME, APP_NAME } from '@/lib/brand';
import { ThemeProvider } from '@/components/theme-provider';
import { TooltipProvider } from '@/components/ui/primitives';

/**
 * Three registers, each with a job.
 *
 * Instrument Sans carries the interface: a grotesque with actual character in
 * its terminals and a tighter, more deliberate rhythm than the system default.
 * Instrument Serif appears only where the product wants gravitas — document
 * titles and large numerals — which suits an app whose output is a written
 * deliverable. JetBrains Mono handles anything tabular or machine-ish: token
 * counts, prompt versions, costs.
 */
const sans = Instrument_Sans({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
});

const display = Instrument_Serif({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: '400',
  style: ['normal', 'italic'],
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: APP_DESCRIPTION,
  applicationName: APP_FULL_NAME,
  icons: { icon: '/traffic-radius-logo.svg' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#faf8f4' },
    { media: '(prefers-color-scheme: dark)', color: '#0d1117' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sans.variable} ${display.variable} ${mono.variable}`}
    >
      <body className="min-h-dvh font-sans antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={220} skipDelayDuration={400}>
            {children}
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
