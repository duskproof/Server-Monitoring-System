import { cn } from '@/lib/utils';
import { DUSKPROOF_LOGO_DATA_URI } from '@/lib/duskproof-logo';

/** Magenta DuskProof wordmark + matching "Guard" label. */
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
    <span
      className={cn('inline-flex max-w-full items-center gap-2 overflow-hidden text-white', className)}
      aria-label="DuskProof Guard"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={DUSKPROOF_LOGO_DATA_URI}
        alt="DuskProof"
        width={compact ? 40 : 112}
        height={20}
        className={cn(
          'shrink-0 object-contain object-left',
          compact ? 'h-4 w-auto' : 'h-5 w-auto max-w-[112px]',
          logoClassName,
        )}
        draggable={false}
      />
      {!compact ? (
        <>
          <span className="h-3 w-px shrink-0 bg-current opacity-30" aria-hidden />
          <span
            className={cn(
              'shrink-0 select-none text-[11px] font-medium uppercase leading-none tracking-[0.28em] text-current opacity-90',
              guardClassName,
            )}
          >
            Guard
          </span>
        </>
      ) : null}
    </span>
  );
}
