import { cn } from '@/lib/utils';
import { DUSKPROOF_LOGO_DATA_URI } from '@/lib/duskproof-logo';

/** Magenta DuskProof wordmark + clean white "Guard". */
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
      className={cn('inline-flex max-w-full items-center gap-1.5 overflow-hidden', className)}
      aria-label="DuskProof Guard"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={DUSKPROOF_LOGO_DATA_URI}
        alt="DuskProof"
        width={compact ? 40 : 118}
        height={22}
        className={cn(
          'shrink-0 object-contain object-left',
          compact ? 'h-5 w-auto' : 'h-[22px] w-auto max-w-[118px]',
          logoClassName,
        )}
      />
      {!compact ? (
        <span
          className={cn(
            'shrink-0 text-[15px] font-semibold leading-none tracking-wide text-white antialiased',
            guardClassName,
          )}
        >
          Guard
        </span>
      ) : null}
    </span>
  );
}
