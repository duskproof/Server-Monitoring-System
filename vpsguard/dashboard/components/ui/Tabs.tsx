'use client';

import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface TabItem<T extends string> {
  key: T;
  label: string;
  icon?: ReactNode;
  badge?: ReactNode;
}

interface TabsProps<T extends string> {
  items: TabItem<T>[];
  value: T;
  onChange: (key: T) => void;
  className?: string;
  variant?: 'underline' | 'pills';
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  className,
  variant = 'underline',
}: TabsProps<T>) {
  if (variant === 'pills') {
    return (
      <div
        role="tablist"
        className={cn('flex gap-1 overflow-x-auto rounded-xl border border-line bg-surface p-1', className)}
      >
        {items.map((item) => (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={value === item.key}
            onClick={() => onChange(item.key)}
            className={cn(
              'inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
              value === item.key ? 'bg-primary text-primary-fg' : 'text-muted hover:bg-elevated hover:text-content',
            )}
          >
            {item.label}
            {item.badge}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div role="tablist" className={cn('flex gap-1 overflow-x-auto border-b border-line', className)}>
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          type="button"
          aria-selected={value === item.key}
          onClick={() => onChange(item.key)}
          className={cn(
            'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
            value === item.key
              ? 'border-primary text-content'
              : 'border-transparent text-muted hover:border-line hover:text-content',
          )}
        >
          {item.label}
          {item.badge}
        </button>
      ))}
    </div>
  );
}
