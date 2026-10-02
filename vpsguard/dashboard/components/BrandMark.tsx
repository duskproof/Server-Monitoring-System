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
      className={cn('inline-flex items-end gap-2', className)}
      aria-label="DuskProof Guard"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={DUSKPROOF_LOGO_DATA_URI}
        alt="DuskProof"
        width={compact ? 72 : 160}
        height={28}
        className={cn(
          compact ? 'h-5 w-auto max-w-[72px] object-contain object-left' : 'h-8 w-auto object-contain object-left',
          logoClassName,
        )}
      />
      {!compact ? (
        <span
          className={cn(
            'pb-[1px] text-[1.35rem] font-bold uppercase leading-none tracking-[0.14em] text-white antialiased',
            '[text-shadow:none]',
            guardClassName,
          )}
        >
          Guard
        </span>
      ) : null}
    </span>
  );
}
