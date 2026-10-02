import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type StatTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_STYLES: Record<StatTone, { icon: string; ring: string }> = {
  primary: { icon: 'bg-primary/15 text-primary', ring: 'ring-primary/20' },
  success: { icon: 'bg-success/15 text-success', ring: 'ring-success/20' },
  warning: { icon: 'bg-warning/15 text-warning', ring: 'ring-warning/20' },
  danger: { icon: 'bg-danger/15 text-danger', ring: 'ring-danger/20' },
  info: { icon: 'bg-info/15 text-info', ring: 'ring-info/20' },
  neutral: { icon: 'bg-elevated text-muted', ring: 'ring-line' },
};

export interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: StatTone;
  hint?: ReactNode;
  footer?: ReactNode;
  className?: string;
}

export function StatCard({ label, value, icon, tone = 'primary', hint, footer, className }: StatCardProps) {
  const styles = TONE_STYLES[tone];

  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-surface p-4 shadow-sm shadow-black/5 ring-1 ring-inset',
        styles.ring,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-content sm:text-3xl">{value}</p>
          {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
        </div>
        {icon ? (
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', styles.icon)}>
            {icon}
          </span>
        ) : null}
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}
