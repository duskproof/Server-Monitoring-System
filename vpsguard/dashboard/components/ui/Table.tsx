'use client';

import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type SortDirection = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

export function TableWrapper({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('w-full overflow-x-auto rounded-2xl border border-line bg-surface', className)}
      {...props}
    />
  );
}

export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full min-w-[640px] border-collapse text-sm', className)} {...props} />;
}

export function THead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-elevated/60', className)} {...props} />;
}

export function TBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-line', className)} {...props} />;
}

export function TR({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-elevated/40', className)} {...props} />;
}

export function TH({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        'whitespace-nowrap px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted',
        className,
      )}
      {...props}
    />
  );
}

export function TD({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle text-content', className)} {...props} />;
}

interface SortableTHProps<K extends string> extends ThHTMLAttributes<HTMLTableCellElement> {
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  children: ReactNode;
}

/** Header cell that toggles asc/desc sorting for its column. */
export function SortableTH<K extends string>({
  sortKey,
  sort,
  onSort,
  children,
  className,
  ...props
}: SortableTHProps<K>) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.direction === 'asc' ? ChevronUp : ChevronDown;

  return (
    <TH
      className={cn('cursor-pointer select-none', className)}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      onClick={() => onSort(sortKey)}
      {...props}
    >
      <span className={cn('inline-flex items-center gap-1', active && 'text-content')}>
        {children}
        <Icon className="h-3.5 w-3.5" aria-hidden />
      </span>
    </TH>
  );
}
