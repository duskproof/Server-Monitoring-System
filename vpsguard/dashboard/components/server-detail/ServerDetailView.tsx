'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Clock,
  Cpu,
  HardDrive,
  MemoryStick,
  Network,
  Tag,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ReportsButton } from '@/components/ReportsButton';
import { DockerTab } from '@/components/server-detail/DockerTab';
import { LogsTab } from '@/components/server-detail/LogsTab';
import { OverviewTab } from '@/components/server-detail/OverviewTab';
import { ProcessesTab } from '@/components/server-detail/ProcessesTab';
import { ServicesTab } from '@/components/server-detail/ServicesTab';
import { SslTab } from '@/components/server-detail/SslTab';
import { TemperaturesTab } from '@/components/server-detail/TemperaturesTab';
import { TerminalTab } from '@/components/server-detail/TerminalTab';
import { DeleteServerDialog } from '@/components/servers/DeleteServerDialog';
import { StatusPill } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ErrorState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import { useDeleteServer, useServer } from '@/hooks/queries';
import { useServerSubscription, useSocketEvent } from '@/hooks/useSocket';
import { errorMessage } from '@/lib/api';
import { formatBps, formatDuration, formatPercent, formatRelative } from '@/lib/format';
import type { LiveMetricsPayload, Server, ServerStatusPayload } from '@/lib/types';
import { useCanOperate } from '@/store/auth';

type TabKey =
  | 'overview'
  | 'processes'
  | 'docker'
  | 'logs'
  | 'services'
  | 'temperatures'
  | 'ssl'
  | 'terminal';

const TAB_ITEMS: TabItem<TabKey>[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'processes', label: 'Processes' },
  { key: 'docker', label: 'Docker' },
  { key: 'logs', label: 'Logs' },
  { key: 'services', label: 'Services' },
  { key: 'temperatures', label: 'Temperatures' },
  { key: 'ssl', label: 'SSL' },
  { key: 'terminal', label: 'Terminal' },
];

const TAB_KEYS = TAB_ITEMS.map((item) => item.key);

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as string[]).includes(value);
}

export function ServerDetailView({ serverId }: { serverId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const canOperate = useCanOperate();

  const query = useServer(serverId);
  const deleteServer = useDeleteServer();
  const [confirmDelete, setConfirmDelete] = useState(false);

  useServerSubscription(serverId);

  useSocketEvent<ServerStatusPayload>('server:status', (payload) => {
    if (payload?.serverId !== serverId) return;
    queryClient.setQueryData<Server>(['server', serverId], (current) =>
      current ? { ...current, status: payload.status } : current,
    );
  });

  useSocketEvent<LiveMetricsPayload>('metrics', (payload) => {
    if (payload?.serverId !== serverId || !payload.metrics) return;
    queryClient.setQueryData<Server>(['server', serverId], (current) => {
      if (!current) return current;
      return {
        ...current,
        lastSeen: payload.timestamp ?? current.lastSeen,
        latestMetrics: {
          cpuPercent: payload.metrics.cpuPercent ?? current.latestMetrics?.cpuPercent ?? 0,
          memoryUsedPercent: payload.metrics.memoryUsedPercent ?? current.latestMetrics?.memoryUsedPercent ?? 0,
          diskUsedPercent: payload.metrics.diskUsedPercent ?? current.latestMetrics?.diskUsedPercent ?? 0,
          load1m: payload.metrics.load1m ?? current.latestMetrics?.load1m ?? 0,
          networkRxBps: payload.metrics.networkRxBps ?? current.latestMetrics?.networkRxBps ?? 0,
          networkTxBps: payload.metrics.networkTxBps ?? current.latestMetrics?.networkTxBps ?? 0,
        },
      };
    });
  });

  const tabParam = searchParams.get('tab');
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : 'overview';

  const setTab = useCallback(
    (key: TabKey) => {
      const params = new URLSearchParams(searchParams.toString());
      if (key === 'overview') params.delete('tab');
      else params.set('tab', key);
      const queryString = params.toString();
      router.replace(`/cabinet/servers/${serverId}${queryString ? `?${queryString}` : ''}`, { scroll: false });
    },
    [router, searchParams, serverId],
  );

  const server = query.data;

  const summary = useMemo(() => {
    if (!server) return [];
    return [
      {
        icon: <Cpu className="h-4 w-4" />,
        label: 'CPU',
        value: formatPercent(server.latestMetrics?.cpuPercent, 1),
      },
      {
        icon: <MemoryStick className="h-4 w-4" />,
        label: 'Memory',
        value: formatPercent(server.latestMetrics?.memoryUsedPercent, 1),
      },
      {
        icon: <HardDrive className="h-4 w-4" />,
        label: 'Disk',
        value: formatPercent(server.latestMetrics?.diskUsedPercent, 1),
      },
      {
        icon: <Network className="h-4 w-4" />,
        label: 'Network',
        value: `${formatBps(server.latestMetrics?.networkRxBps)} ↓ / ${formatBps(server.latestMetrics?.networkTxBps)} ↑`,
      },
      {
        icon: <Clock className="h-4 w-4" />,
        label: 'Uptime',
        value: formatDuration(server.uptimeSeconds),
      },
      {
        icon: <Tag className="h-4 w-4" />,
        label: 'Agent',
        value: server.agentVersion ?? 'unknown',
      },
    ];
  }, [server]);

  if (query.isLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="grid gap-4 xl:grid-cols-2">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-72 w-full rounded-2xl" />
        </div>
      </div>
    );
  }

  if (query.isError || !server) {
    return (
      <ErrorState
        title="Server not found"
        description={errorMessage(query.error, 'This server may have been deleted or you lack access to it.')}
        action={
          <Link
            href="/cabinet/servers"
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary/90"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to servers
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-5">
      <Link
        href="/cabinet/servers"
        className="inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-content"
      >
        <ArrowLeft className="h-4 w-4" />
        All servers
      </Link>

      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="truncate text-xl font-semibold text-content">{server.name}</h2>
              <StatusPill status={server.status} />
              {server.groupName ? (
                <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                  {server.groupName}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted">
              {server.hostname ?? 'unknown host'} · {server.ipAddress ?? 'no address'} ·{' '}
              {server.osInfo ?? 'unknown OS'}
            </p>
            <p className="mt-0.5 text-xs text-muted">Last seen {formatRelative(server.lastSeen)}</p>
          </div>

          <div className="flex items-center gap-2">
            <ReportsButton serverId={server.id} />
            {canOperate ? (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Trash2 className="h-4 w-4" />}
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            ) : null}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-line pt-4 sm:grid-cols-3 xl:grid-cols-6">
          {summary.map((item) => (
            <div key={item.label}>
              <dt className="flex items-center gap-1.5 text-xs text-muted">
                {item.icon}
                {item.label}
              </dt>
              <dd className="mt-1 truncate text-sm font-medium text-content" title={item.value}>
                {item.value}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <Tabs items={TAB_ITEMS} value={activeTab} onChange={setTab} />

      <ErrorBoundary label={TAB_ITEMS.find((item) => item.key === activeTab)?.label}>
        {activeTab === 'overview' ? <OverviewTab serverId={server.id} /> : null}
        {activeTab === 'processes' ? <ProcessesTab serverId={server.id} /> : null}
        {activeTab === 'docker' ? <DockerTab serverId={server.id} /> : null}
        {activeTab === 'logs' ? <LogsTab serverId={server.id} /> : null}
        {activeTab === 'services' ? <ServicesTab serverId={server.id} /> : null}
        {activeTab === 'temperatures' ? <TemperaturesTab serverId={server.id} /> : null}
        {activeTab === 'ssl' ? <SslTab serverId={server.id} /> : null}
        {activeTab === 'terminal' ? <TerminalTab serverId={server.id} serverName={server.name} /> : null}
      </ErrorBoundary>

      <DeleteServerDialog
        open={confirmDelete}
        serverName={server.name}
        loading={deleteServer.isPending}
        onConfirm={async () => {
          await deleteServer.mutateAsync(server.id).catch(() => undefined);
          setConfirmDelete(false);
          router.push('/cabinet/servers');
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
