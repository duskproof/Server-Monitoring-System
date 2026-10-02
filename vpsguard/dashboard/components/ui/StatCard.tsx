import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export type StatTone = 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_STYLES: Record<StatTone, string> = {
  primary: 'ring-primary/20',
  success: 'ring-success/20',
  warning: 'ring-warning/20',
  danger: 'ring-danger/20',
  info: 'ring-info/20',
  neutral: 'ring-line',
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

export function StatCard({ label, value, tone = 'primary', hint, footer, className }: StatCardProps) {
  return (
    <div
      className={cn(
        'rounded-2xl border border-line bg-surface p-4 shadow-sm shadow-black/5 ring-1 ring-inset',
        TONE_STYLES[tone],
        className,
      )}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-content sm:text-3xl">{value}</p>
        {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  );
}
