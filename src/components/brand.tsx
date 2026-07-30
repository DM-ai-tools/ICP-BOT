'use client';

import Link from 'next/link';
import { APP_NAME, LOGO_SRC } from '@/lib/brand';
import { cn } from '@/lib/utils';

/**
 * Header lockup: the Traffic Radius mark, a hairline divider, then the product
 * name. The divider is what stops it reading as one long wordmark.
 *
 * The logo inverts in dark mode — the supplied artwork is dark charcoal on
 * white, which disappears against a dark header otherwise. The coloured bars
 * survive inversion well enough to stay recognisable; if you swap in a
 * purpose-made light variant, drop the `dark:` classes.
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={LOGO_SRC}
        alt="Traffic Radius"
        className="h-[26px] w-auto shrink-0 dark:brightness-0 dark:invert"
        width={141}
        height={26}
      />
      {showName && (
        <>
          <span aria-hidden="true" className="h-5 w-px shrink-0 bg-border" />
          <span className="text-[15px] font-semibold tracking-tight">{APP_NAME}</span>
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
