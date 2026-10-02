'use client';

import { Cpu, RefreshCw, Search, Skull } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';
import {
  SortableTH,
  Table,
  TableWrapper,
  TBody,
  TD,
  THead,
  TR,
  type SortState,
} from '@/components/ui/Table';
import { useProcesses } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatBytes, formatDateTime, formatPercent, truncate } from '@/lib/format';
import type { ProcessInfo } from '@/lib/types';
import { cn, sortBy } from '@/lib/utils';

type SortKey = 'pid' | 'name' | 'user' | 'cpuPercent' | 'memoryPercent' | 'memoryBytes' | 'state';

const TOP_N_OPTIONS = [
  { value: '10', label: 'Top 10' },
  { value: '25', label: 'Top 25' },
  { value: '50', label: 'Top 50' },
  { value: '0', label: 'All processes' },
];

export function ProcessesTab({ serverId }: { serverId: string }) {
  const query = useProcesses(serverId);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState('25');
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'cpuPercent', direction: 'desc' });

  const processes = useMemo(() => query.data?.processes ?? [], [query.data]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const filtered = term
      ? processes.filter(
          (process) =>
            process.name.toLowerCase().includes(term) ||
            process.user.toLowerCase().includes(term) ||
            String(process.pid).includes(term) ||
            process.command.toLowerCase().includes(term),
        )
      : processes;

    const selector = (process: ProcessInfo): unknown => process[sort.key];
    const ordered = sortBy(filtered, selector, sort.direction);
    const max = Number(limit);
    return max > 0 ? ordered.slice(0, max) : ordered;
  }, [limit, processes, search, sort]);

  const onSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'name' || key === 'user' || key === 'state' ? 'asc' : 'desc' },
    );
  };

  if (query.isLoading) return <SkeletonTable rows={8} columns={6} />;

  if (query.isError) {
    return (
      <ErrorState
        title="Process snapshot unavailable"
        description={errorMessage(query.error, 'The agent has not reported processes yet.')}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="neutral">{query.data?.totalCount ?? processes.length} processes</Badge>
          {query.data?.zombieCount ? (
            <Badge tone="warning" icon={<Skull className="h-3 w-3" />}>
              {query.data.zombieCount} zombie
            </Badge>
          ) : null}
          <span>Snapshot: {formatDateTime(query.data?.collectedAt)}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Filter by name, user, PID"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon={<Search className="h-4 w-4" />}
            containerClassName="w-full sm:w-64"
            aria-label="Filter processes"
          />
          <Select
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            options={TOP_N_OPTIONS}
            containerClassName="w-36"
            aria-label="Number of processes"
          />
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />}
            onClick={() => void query.refetch()}
          >
            Refresh
          </Button>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={<Cpu className="h-5 w-5" />}
          title="No matching processes"
          description="Adjust the filter or wait for the next agent snapshot."
        />
      ) : (
        <TableWrapper>
          <Table className="min-w-[820px]">
            <THead>
              <TR className="hover:bg-transparent">
                <SortableTH sortKey="pid" sort={sort} onSort={onSort}>
                  PID
                </SortableTH>
                <SortableTH sortKey="name" sort={sort} onSort={onSort}>
                  Process
                </SortableTH>
                <SortableTH sortKey="user" sort={sort} onSort={onSort}>
                  User
                </SortableTH>
                <SortableTH sortKey="cpuPercent" sort={sort} onSort={onSort}>
                  CPU
                </SortableTH>
                <SortableTH sortKey="memoryPercent" sort={sort} onSort={onSort}>
                  Memory
                </SortableTH>
                <SortableTH sortKey="memoryBytes" sort={sort} onSort={onSort}>
                  RSS
                </SortableTH>
                <SortableTH sortKey="state" sort={sort} onSort={onSort}>
                  State
                </SortableTH>
              </TR>
            </THead>
            <TBody>
              {visible.map((process) => (
                <TR key={`${process.pid}-${process.name}`}>
                  <TD className="font-mono text-xs text-muted">{process.pid}</TD>
                  <TD>
                    <p className="font-medium text-content">{process.name}</p>
                    <p className="truncate font-mono text-xs text-muted" title={process.command}>
                      {truncate(process.command, 72)}
                    </p>
                  </TD>
                  <TD className="text-xs text-muted">{process.user}</TD>
                  <TD className="text-xs text-content">{formatPercent(process.cpuPercent)}</TD>
                  <TD className="text-xs text-content">{formatPercent(process.memoryPercent)}</TD>
                  <TD className="text-xs text-muted">{formatBytes(process.memoryBytes)}</TD>
                  <TD>
                    <Badge tone={process.state.toLowerCase().startsWith('z') ? 'warning' : 'neutral'}>
                      {process.state}
                    </Badge>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}
    </div>
  );
}
