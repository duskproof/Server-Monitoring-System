import Image from 'next/image';

import { cn } from '@/lib/utils';

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
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} aria-label="DuskProof Guard">
      <Image
        src="/duskproof.png"
        alt="DuskProof"
        width={compact ? 36 : 148}
        height={compact ? 20 : 28}
        className={cn(
          compact ? 'h-5 w-auto max-w-[72px] object-contain object-left' : 'h-7 w-auto object-contain object-left',
          logoClassName,
        )}
        priority
      />
      {!compact ? (
        <span className={cn('text-base font-semibold tracking-tight text-white', guardClassName)}>
          Guard
        </span>
      ) : null}
    </span>
  );
}
