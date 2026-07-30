'use client';

import Link from 'next/link';
import { APP_NAME } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * Header lockup: the Traffic Radius mark, a hairline divider, then the product
 * name.
 *
 * The mark is drawn inline rather than loaded from the SVG file, for two
 * reasons the file version got wrong:
 *
 *  - the wordmark was clipped, because SVG text is laid out by the viewer's
 *    font metrics and any viewBox guess is wrong on some machine somewhere;
 *  - it had to be force-inverted to monochrome in dark mode to stay legible,
 *    which threw away the brand colours entirely.
 *
 * Drawing the bars as inline SVG in their real colours and setting the wordmark
 * in HTML keeps the green and cyan intact in both themes, lets the text take the
 * theme's foreground colour, and makes clipping impossible — HTML text simply
 * flows. public/traffic-radius-logo.svg is still there for the favicon and for
 * anywhere the logo is needed as a file.
 */
export function Brand({
  href = '/',
  className,
  showName = true,
}: {
  href?: string | null;
  className?: string;
  showName?: boolean;
}) {
  const content = (
    <span className={cn('flex items-center gap-2.5', className)}>
      <span className="flex items-baseline gap-[3px]" aria-hidden="true">
        <span className="block w-[4px] rounded-[1px] bg-[#1B1D21] dark:bg-foreground" style={{ height: 11 }} />
        <span className="block w-[4px] rounded-[1px] bg-[#3EBBE3]" style={{ height: 16 }} />
        <span className="block w-[4px] rounded-[1px] bg-[#8DC63F]" style={{ height: 22 }} />
        <span className="block w-[4px] rounded-[1px] bg-[#1B1D21] dark:bg-foreground" style={{ height: 18 }} />
      </span>

      <span className="whitespace-nowrap text-[16px] leading-none tracking-[-0.02em] text-foreground">
        <span className="font-bold">Traffic</span>
        <span className="font-light"> Radius</span>
      </span>

      <span className="sr-only">Traffic Radius</span>

      {showName && (
        <>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-border" />
          <span className="text-[15px] font-semibold tracking-tight text-foreground">{APP_NAME}</span>
        </>
      )}
    </span>
  );

  if (!href) return content;

  return (
    <Link href={href} className="focus-ring rounded-md">
      {content}
    </Link>
  );
}
