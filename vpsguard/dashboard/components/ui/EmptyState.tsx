import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line bg-surface/50 px-6 py-12 text-center',
        className,
      )}
    >
      {icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-elevated text-muted">{icon}</span>
      ) : null}
      <div>
        <p className="text-sm font-semibold text-content">{title}</p>
        {description ? <p className="mx-auto mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load data',
  description,
  action,
  className,
}: {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 rounded-2xl border border-danger/30 bg-danger/5 px-6 py-10 text-center',
        className,
      )}
    >
      <p className="text-sm font-semibold text-danger">{title}</p>
      {description ? <p className="max-w-md text-sm text-muted">{description}</p> : null}
      {action}
    </div>
  );
}
