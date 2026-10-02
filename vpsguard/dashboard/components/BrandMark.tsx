import { cn } from '@/lib/utils';
import { DUSKPROOF_LOGO_DATA_URI } from '@/lib/duskproof-logo';

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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={DUSKPROOF_LOGO_DATA_URI}
        alt="DuskProof"
        width={compact ? 72 : 148}
        height={28}
        className={cn(
          compact ? 'h-5 w-auto max-w-[72px] object-contain object-left' : 'h-7 w-auto object-contain object-left',
          logoClassName,
        )}
      />
      {!compact ? (
        <span className={cn('text-base font-semibold tracking-tight text-white', guardClassName)}>
          Guard
        </span>
      ) : null}
    </span>
  );
}
