'use client';

import { useState } from 'react';

import { cn } from '@/lib/utils';

const LOCAL_LOGO = '/duskproof.png';
const CDN_LOGO = 'https://app.duskproof.com/duskproof.png';

/** Magenta DuskProof wordmark + white "Guard". */
export function BrandMark({
  className,
  logoClassName,
  guardClassName,
  compact = false,
}: {
  className?: string;
  logoClassName?: string;
  guardClassName?: string;
  compact?: boolean;
}) {
  const [src, setSrc] = useState(LOCAL_LOGO);

  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} aria-label="DuskProof Guard">
      {/* Plain <img>: next/image optimizer often 404s for public assets in standalone Docker. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt="DuskProof"
        width={compact ? 72 : 148}
        height={28}
        className={cn(
          compact ? 'h-5 w-auto max-w-[72px] object-contain object-left' : 'h-7 w-auto object-contain object-left',
          logoClassName,
        )}
        onError={() => {
          if (src !== CDN_LOGO) setSrc(CDN_LOGO);
        }}
      />
      {!compact ? (
        <span className={cn('text-base font-semibold tracking-tight text-white', guardClassName)}>
          Guard
        </span>
      ) : null}
    </span>
  );
}
