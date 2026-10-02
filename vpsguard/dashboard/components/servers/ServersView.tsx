'use client';

import { useQueryClient } from '@tanstack/react-query';
import { MoreHorizontal, Plus, RefreshCw, Search, ServerIcon, Terminal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';

import { AddServerModal } from '@/components/servers/AddServerModal';
import { DeleteServerDialog } from '@/components/servers/DeleteServerDialog';
import { StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { UsageBar } from '@/components/ui/Gauge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';
import {
  SortableTH,
  Table,
  TableWrapper,
  TBody,
  TD,
  TH,
  THead,
  TR,
  type SortState,
} from '@/components/ui/Table';
import { useDeleteServer, useGroups, useServers } from '@/hooks/queries';
import { useSocketEvent } from '@/hooks/useSocket';
import { errorMessage } from '@/lib/api';
import { formatPercent, formatRelative } from '@/lib/format';
import type { LiveMetricsPayload, Server, ServerStatus, ServerStatusPayload } from '@/lib/types';
import { cn, sortBy } from '@/lib/utils';
import { useCanOperate } from '@/store/auth';

type SortKey = 'name' | 'ipAddress' | 'status' | 'cpu' | 'memory' | 'disk' | 'group' | 'lastSeen';

const STATUS_OPTIONS = [
  { value: 'online', label: 'Online' },
  { value: 'warning', label: 'Warning' },
  { value: 'offline', label: 'Offline' },
];

export function ServersView() {
  const queryClient = useQueryClient();
  const canOperate = useCanOperate();

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [group, setGroup] = useState('');
  const [status, setStatus] = useState<ServerStatus | ''>('');
  const [sort, setSort] = useState<SortState<SortKey>>({ key: 'name', direction: 'asc' });
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Server | null>(null);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const groupsQuery = useGroups();
  const serversQuery = useServers({ group, status, search: debouncedSearch });
  const deleteServer = useDeleteServer();

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (!openMenu) return;
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenu(null);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [openMenu]);

  useSocketEvent<ServerStatusPayload>('server:status', (payload) => {
    if (!payload?.serverId) return;
    queryClient.setQueriesData<Server[]>({ queryKey: ['servers'] }, (current) =>
      current?.map((server) =>
        server.id === payload.serverId ? { ...server, status: payload.status } : server,
      ),
    );
  });

  useSocketEvent<LiveMetricsPayload>('metrics', (payload) => {
    if (!payload?.serverId || !payload.metrics) return;
    queryClient.setQueriesData<Server[]>({ queryKey: ['servers'] }, (current) =>
      current?.map((server) =>
        server.id === payload.serverId
          ? {
              ...server,
              lastSeen: payload.timestamp ?? server.lastSeen,
              latestMetrics: {
                cpuPercent: payload.metrics.cpuPercent ?? server.latestMetrics?.cpuPercent ?? 0,
                memoryUsedPercent:
                  payload.metrics.memoryUsedPercent ?? server.latestMetrics?.memoryUsedPercent ?? 0,
                diskUsedPercent: payload.metrics.diskUsedPercent ?? server.latestMetrics?.diskUsedPercent ?? 0,
                load1m: payload.metrics.load1m ?? server.latestMetrics?.load1m ?? 0,
                networkRxBps: payload.metrics.networkRxBps ?? server.latestMetrics?.networkRxBps ?? 0,
                networkTxBps: payload.metrics.networkTxBps ?? server.latestMetrics?.networkTxBps ?? 0,
              },
            }
          : server,
      ),
    );
  });

  const servers = useMemo(() => serversQuery.data ?? [], [serversQuery.data]);

  const sorted = useMemo(() => {
    const selector = (server: Server): unknown => {
      switch (sort.key) {
        case 'name':
          return server.name;
        case 'ipAddress':
          return server.ipAddress ?? server.hostname ?? '';
        case 'status':
          return server.status;
        case 'cpu':
          return server.latestMetrics?.cpuPercent ?? -1;
        case 'memory':
          return server.latestMetrics?.memoryUsedPercent ?? -1;
        case 'disk':
          return server.latestMetrics?.diskUsedPercent ?? -1;
        case 'group':
          return server.groupName ?? '';
        case 'lastSeen':
          return server.lastSeen ? new Date(server.lastSeen).getTime() : 0;
        default:
          return server.name;
      }
    };
    return sortBy(servers, selector, sort.direction);
  }, [servers, sort]);

  const onSort = (key: SortKey) => {
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: key === 'name' || key === 'group' || key === 'ipAddress' ? 'asc' : 'desc' },
    );
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    await deleteServer.mutateAsync(pendingDelete.id).catch(() => undefined);
    setPendingDelete(null);
  };

  const hasFilters = Boolean(debouncedSearch || group || status);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-content">Servers</h2>
          <p className="text-sm text-muted">
            {serversQuery.isLoading ? 'Loading fleet…' : `${servers.length} server${servers.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            leftIcon={<RefreshCw className={cn('h-4 w-4', serversQuery.isFetching && 'animate-spin')} />}
            onClick={() => void serversQuery.refetch()}
          >
            Refresh
          </Button>
          {canOperate ? (
            <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
              Add server
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Input
          placeholder="Search by name, hostname or IP"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          icon={<Search className="h-4 w-4" />}
          containerClassName="lg:col-span-2"
          aria-label="Search servers"
        />
        <Select
          value={group}
          onChange={(event) => setGroup(event.target.value)}
          placeholder="All groups"
          options={(groupsQuery.data ?? []).map((item) => ({ value: item.id, label: item.name }))}
          aria-label="Filter by group"
        />
        <Select
          value={status}
          onChange={(event) => setStatus(event.target.value as ServerStatus | '')}
          placeholder="All statuses"
          options={STATUS_OPTIONS}
          aria-label="Filter by status"
        />
      </div>

      {serversQuery.isLoading ? (
        <SkeletonTable rows={6} columns={7} />
      ) : serversQuery.isError ? (
        <ErrorState
          description={errorMessage(serversQuery.error, 'The server list could not be loaded.')}
          action={
            <Button variant="outline" size="sm" onClick={() => void serversQuery.refetch()}>
              Retry
            </Button>
          }
        />
      ) : sorted.length === 0 ? (
        <EmptyState
          icon={<ServerIcon className="h-5 w-5" />}
          title={hasFilters ? 'No servers match your filters' : 'No servers yet'}
          description={
            hasFilters
              ? 'Try a different search term, group or status.'
              : 'Register your first machine and install the agent with the generated one-line command.'
          }
          action={
            hasFilters ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setGroup('');
                  setStatus('');
                }}
              >
                Clear filters
              </Button>
            ) : canOperate ? (
              <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setAddOpen(true)}>
                Add server
              </Button>
            ) : null
          }
        />
      ) : (
        <TableWrapper>
          <Table className="min-w-[900px]">
            <THead>
              <TR className="hover:bg-transparent">
                <SortableTH sortKey="name" sort={sort} onSort={onSort}>
                  Server
                </SortableTH>
                <SortableTH sortKey="ipAddress" sort={sort} onSort={onSort}>
                  Address
                </SortableTH>
                <SortableTH sortKey="status" sort={sort} onSort={onSort}>
                  Status
                </SortableTH>
                <SortableTH sortKey="cpu" sort={sort} onSort={onSort}>
                  CPU
                </SortableTH>
                <SortableTH sortKey="memory" sort={sort} onSort={onSort}>
                  RAM
                </SortableTH>
                <SortableTH sortKey="disk" sort={sort} onSort={onSort}>
                  Disk
                </SortableTH>
                <SortableTH sortKey="group" sort={sort} onSort={onSort}>
                  Group
                </SortableTH>
                <SortableTH sortKey="lastSeen" sort={sort} onSort={onSort}>
                  Last seen
                </SortableTH>
                <TH className="w-12 text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {sorted.map((server) => (
                <TR key={server.id}>
                  <TD>
                    <Link href={`/cabinet/servers/${server.id}`} className="font-medium text-content hover:text-primary">
                      {server.name}
                    </Link>
                    <p className="truncate text-xs text-muted">{server.osInfo ?? server.hostname ?? '—'}</p>
                  </TD>
                  <TD className="font-mono text-xs text-muted">{server.ipAddress ?? '—'}</TD>
                  <TD>
                    <StatusPill status={server.status} />
                  </TD>
                  <TD className="w-28">
                    <span className="text-xs text-content">{formatPercent(server.latestMetrics?.cpuPercent, 0)}</span>
                    <UsageBar className="mt-1" value={server.latestMetrics?.cpuPercent ?? 0} />
                  </TD>
                  <TD className="w-28">
                    <span className="text-xs text-content">
                      {formatPercent(server.latestMetrics?.memoryUsedPercent, 0)}
                    </span>
                    <UsageBar className="mt-1" value={server.latestMetrics?.memoryUsedPercent ?? 0} />
                  </TD>
                  <TD className="w-28">
                    <span className="text-xs text-content">
                      {formatPercent(server.latestMetrics?.diskUsedPercent, 0)}
                    </span>
                    <UsageBar className="mt-1" value={server.latestMetrics?.diskUsedPercent ?? 0} warningAt={80} dangerAt={92} />
                  </TD>
                  <TD className="text-xs text-muted">{server.groupName ?? '—'}</TD>
                  <TD className="whitespace-nowrap text-xs text-muted">{formatRelative(server.lastSeen)}</TD>
                  <TD className="relative text-right">
                    <button
                      type="button"
                      onClick={() => setOpenMenu(openMenu === server.id ? null : server.id)}
                      className="focus-ring rounded-lg p-1.5 text-muted transition-colors hover:bg-elevated hover:text-content"
                      aria-label={`Actions for ${server.name}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </button>

                    {openMenu === server.id ? (
                      <div
                        ref={menuRef}
                        className="absolute right-3 top-[calc(100%-6px)] z-20 w-44 animate-fade-in overflow-hidden rounded-xl border border-line bg-surface text-left shadow-xl"
                      >
                        <Link
                          href={`/cabinet/servers/${server.id}`}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-content"
                        >
                          <ServerIcon className="h-4 w-4" />
                          Details
                        </Link>
                        <Link
                          href={`/cabinet/servers/${server.id}?tab=terminal`}
                          className="flex items-center gap-2 px-3 py-2 text-sm text-muted transition-colors hover:bg-elevated hover:text-content"
                        >
                          <Terminal className="h-4 w-4" />
                          Terminal
                        </Link>
                        {canOperate ? (
                          <button
                            type="button"
                            onClick={() => {
                              setOpenMenu(null);
                              setPendingDelete(server);
                            }}
                            className="flex w-full items-center gap-2 px-3 py-2 text-sm text-danger transition-colors hover:bg-danger/10"
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}

      <AddServerModal open={addOpen} onClose={() => setAddOpen(false)} />

      <DeleteServerDialog
        open={pendingDelete !== null}
        serverId={pendingDelete?.id ?? ''}
        serverName={pendingDelete?.name ?? ''}
        loading={deleteServer.isPending}
        onForceRemove={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
