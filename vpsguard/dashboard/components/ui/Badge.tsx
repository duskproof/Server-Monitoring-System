import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import type { AlertSeverity, AlertStatus, ServerStatus } from '@/lib/types';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-elevated text-muted border-line',
  primary: 'bg-primary/15 text-primary border-primary/30',
  success: 'bg-success/15 text-success border-success/30',
  warning: 'bg-warning/15 text-warning border-warning/30',
  danger: 'bg-danger/15 text-danger border-danger/30',
  info: 'bg-info/15 text-info border-info/30',
};

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
}

export function Badge({ tone = 'neutral', icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

const SERVER_STATUS_TONE: Record<ServerStatus, BadgeTone> = {
  online: 'success',
  warning: 'warning',
  offline: 'danger',
};

export function StatusPill({ status, className }: { status: ServerStatus; className?: string }) {
  const tone = SERVER_STATUS_TONE[status];
  return (
    <Badge tone={tone} className={cn('capitalize', className)}>
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'online' && 'bg-success',
          status === 'warning' && 'bg-warning',
          status === 'offline' && 'bg-danger',
        )}
      />
      {status}
    </Badge>
  );
}

const SEVERITY_TONE: Record<AlertSeverity, BadgeTone> = {
  info: 'info',
  warning: 'warning',
  critical: 'danger',
};

export function SeverityBadge({ severity, className }: { severity: AlertSeverity; className?: string }) {
  return (
    <Badge tone={SEVERITY_TONE[severity]} className={cn('capitalize', className)}>
      {severity}
    </Badge>
  );
}

const ALERT_STATUS_TONE: Record<AlertStatus, BadgeTone> = {
  firing: 'danger',
  acknowledged: 'warning',
  resolved: 'success',
};

export function AlertStatusBadge({ status, className }: { status: AlertStatus; className?: string }) {
  return (
    <Badge tone={ALERT_STATUS_TONE[status]} className={cn('capitalize', className)}>
      {status}
    </Badge>
  );
}
