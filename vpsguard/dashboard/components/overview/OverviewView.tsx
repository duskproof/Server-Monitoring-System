'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  BellRing,
  CircleSlash,
  Cpu,
  HardDrive,
  MemoryStick,
  ServerIcon,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Sparkline } from '@/components/charts/Sparkline';
import { ReportsButton } from '@/components/ReportsButton';
import { AlertStatusBadge, SeverityBadge, StatusPill } from '@/components/ui/Badge';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Gauge } from '@/components/ui/Gauge';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { StatCard } from '@/components/ui/StatCard';
import { useAlerts, useOverview, useServers } from '@/hooks/queries';
import { useOverviewSubscription, useSocketEvent } from '@/hooks/useSocket';
import { formatPercent, formatRelative } from '@/lib/format';
import { formatMetricValue } from '@/lib/metrics';
import type { LiveMetricsPayload, Overview, Server, ServerStatusPayload } from '@/lib/types';

const SPARK_WINDOW = 40;

type SparkHistory = Record<string, Array<{ t: number; v: number }>>;

export function OverviewView() {
  const queryClient = useQueryClient();
  const overviewQuery = useOverview();
  const serversQuery = useServers({});
  const alertsQuery = useAlerts();

  const [liveOverview, setLiveOverview] = useState<Overview | null>(null);
  const [history, setHistory] = useState<SparkHistory>({});

  useOverviewSubscription(true);

  useSocketEvent<Overview>('overview', (payload) => {
    if (payload && typeof payload.serverCount === 'number') setLiveOverview(payload);
  });

  useSocketEvent<ServerStatusPayload>('server:status', (payload) => {
    if (!payload?.serverId) return;
    queryClient.setQueriesData<Server[]>({ queryKey: ['servers'] }, (current) =>
      current?.map((server) =>
        server.id === payload.serverId ? { ...server, status: payload.status } : server,
      ),
    );
  });

  useSocketEvent<LiveMetricsPayload>('metrics', (payload) => {
    if (!payload?.serverId) return;
    const cpu = payload.metrics?.cpuPercent;
    if (typeof cpu !== 'number') return;
    const timestamp = new Date(payload.timestamp).getTime() || Date.now();

    setHistory((current) => {
      const previous = current[payload.serverId] ?? [];
      const next = [...previous, { t: timestamp, v: cpu }];
      return {
        ...current,
        [payload.serverId]: next.length > SPARK_WINDOW ? next.slice(next.length - SPARK_WINDOW) : next,
      };
    });
  });

  const servers = useMemo(() => serversQuery.data ?? [], [serversQuery.data]);

  // Seed each sparkline with the last known sample so the widget is never blank.
  useEffect(() => {
    if (servers.length === 0) return;
    setHistory((current) => {
      const next = { ...current };
      let changed = false;
      for (const server of servers) {
        if (next[server.id]?.length) continue;
        const cpu = server.latestMetrics?.cpuPercent;
        if (typeof cpu !== 'number') continue;
        next[server.id] = [{ t: Date.now() - 60_000, v: cpu }, { t: Date.now(), v: cpu }];
        changed = true;
      }
      return changed ? next : current;
    });
  }, [servers]);

  const overview: Overview | undefined = liveOverview ?? overviewQuery.data;

  const derived = useMemo(() => {
    if (overview) return overview;
    if (servers.length === 0) return undefined;

    const online = servers.filter((server) => server.status === 'online');
    const average = (selector: (server: Server) => number | undefined): number => {
      const values = servers.map(selector).filter((value): value is number => typeof value === 'number');
      return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
    };

    return {
      serverCount: servers.length,
      onlineCount: online.length,
      offlineCount: servers.filter((server) => server.status === 'offline').length,
      firingAlerts: (alertsQuery.data ?? []).filter((alert) => alert.status === 'firing').length,
      avgCpu: average((server) => server.latestMetrics?.cpuPercent),
      avgMemory: average((server) => server.latestMetrics?.memoryUsedPercent),
      avgDisk: average((server) => server.latestMetrics?.diskUsedPercent),
    } satisfies Overview;
  }, [alertsQuery.data, overview, servers]);

  const recentAlerts = useMemo(
    () =>
      [...(alertsQuery.data ?? [])]
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 6),
    [alertsQuery.data],
  );

  const busiestServers = useMemo(
    () =>
      [...servers]
        .sort((a, b) => (b.latestMetrics?.cpuPercent ?? -1) - (a.latestMetrics?.cpuPercent ?? -1))
        .slice(0, 6),
    [servers],
  );

  const renderStats = useCallback(() => {
    if (overviewQuery.isLoading && !derived) {
      return (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      );
    }

    if (!derived) {
      return (
        <ErrorState
          title="Overview is unavailable"
          description="The API did not return aggregate statistics. Check that the backend is reachable."
        />
      );
    }

    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total servers"
          value={derived.serverCount}
          tone="primary"
          icon={<ServerIcon className="h-5 w-5" />}
          hint="Registered agents"
        />
        <StatCard
          label="Online"
          value={derived.onlineCount}
          tone="success"
          icon={<ShieldCheck className="h-5 w-5" />}
          hint={
            derived.serverCount > 0
              ? `${formatPercent((derived.onlineCount / derived.serverCount) * 100, 0)} of the fleet`
              : 'No servers yet'
          }
        />
        <StatCard
          label="Offline"
          value={derived.offlineCount}
          tone={derived.offlineCount > 0 ? 'danger' : 'neutral'}
          icon={<CircleSlash className="h-5 w-5" />}
          hint={derived.offlineCount > 0 ? 'Agents not reporting' : 'Everything is reporting'}
        />
        <StatCard
          label="Firing alerts"
          value={derived.firingAlerts}
          tone={derived.firingAlerts > 0 ? 'warning' : 'neutral'}
          icon={<BellRing className="h-5 w-5" />}
          hint={
            derived.firingAlerts > 0 ? (
              <Link href="/cabinet/alerts" className="text-primary hover:underline">
                Review now
              </Link>
            ) : (
              'No active incidents'
            )
          }
        />
      </div>
    );
  }, [derived, overviewQuery.isLoading]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-content">Fleet overview</h2>
          <p className="text-sm text-muted">Live health of every monitored server.</p>
        </div>
        <div className="flex items-center gap-2">
          <ReportsButton servers={servers} />
          <Link
            href="/cabinet/servers"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-fg transition-colors hover:bg-primary/90"
          >
            Manage servers
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {renderStats()}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Aggregate resource usage"
            description="Fleet-wide averages across all reporting agents"
            icon={<Activity className="h-4 w-4" />}
          />
          <div className="grid gap-6 px-4 py-6 sm:grid-cols-3 sm:px-6">
            {derived ? (
              <>
                <Gauge value={derived.avgCpu} label="CPU" sublabel="Average load" formatValue={(value) => formatPercent(value, 0)} />
                <Gauge
                  value={derived.avgMemory}
                  label="Memory"
                  sublabel="Average usage"
                  formatValue={(value) => formatPercent(value, 0)}
                />
                <Gauge
                  value={derived.avgDisk}
                  label="Disk"
                  sublabel="Average usage"
                  warningAt={80}
                  dangerAt={92}
                  formatValue={(value) => formatPercent(value, 0)}
                />
              </>
            ) : (
              Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-28 w-full" />)
            )}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Recent alerts"
            description="Latest events from every server"
            icon={<BellRing className="h-4 w-4" />}
            action={
              <Link href="/cabinet/alerts" className="text-xs font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          <div className="divide-y divide-line">
            {alertsQuery.isLoading ? (
              Array.from({ length: 4 }).map((_, index) => (
                <div key={index} className="px-4 py-3">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="mt-2 h-3 w-1/3" />
                </div>
              ))
            ) : recentAlerts.length === 0 ? (
              <EmptyState
                className="border-0 bg-transparent py-10"
                icon={<ShieldCheck className="h-5 w-5" />}
                title="No alerts yet"
                description="Alert rules you create in the Alerts page will show their events here."
              />
            ) : (
              recentAlerts.map((alert) => (
                <Link
                  key={alert.id}
                  href={`/cabinet/servers/${alert.serverId}`}
                  className="block px-4 py-3 transition-colors hover:bg-elevated/50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate text-sm font-medium text-content">{alert.ruleName}</p>
                    <SeverityBadge severity={alert.severity} />
                  </div>
                  <p className="mt-1 truncate text-xs text-muted">
                    {alert.serverName} · {formatMetricValue(alert.metric, alert.value)}
                  </p>
                  <div className="mt-1.5 flex items-center gap-2">
                    <AlertStatusBadge status={alert.status} />
                    <span className="text-xs text-muted">{formatRelative(alert.createdAt)}</span>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Busiest servers"
          description="Live CPU trend of the most loaded machines"
          icon={<Cpu className="h-4 w-4" />}
          action={
            <Link href="/cabinet/servers" className="text-xs font-medium text-primary hover:underline">
              All servers
            </Link>
          }
        />
        {serversQuery.isLoading ? (
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : busiestServers.length === 0 ? (
          <EmptyState
            className="m-4 border-dashed"
            icon={<ServerIcon className="h-5 w-5" />}
            title="No servers registered"
            description="Add your first server to start collecting metrics."
            action={
              <Link
                href="/cabinet/servers"
                className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-fg hover:bg-primary/90"
              >
                Add a server
              </Link>
            }
          />
        ) : (
          <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
            {busiestServers.map((server) => (
              <Link
                key={server.id}
                href={`/cabinet/servers/${server.id}`}
                className="focus-ring rounded-xl border border-line bg-bg/40 p-3 transition-colors hover:border-primary/40"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium text-content">{server.name}</p>
                  <StatusPill status={server.status} />
                </div>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {server.ipAddress ?? server.hostname ?? 'Address unknown'}
                </p>

                <Sparkline data={history[server.id] ?? []} className="mt-2" />

                <div className="mt-2 flex items-center justify-between text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <Cpu className="h-3 w-3" />
                    {formatPercent(server.latestMetrics?.cpuPercent, 0)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <MemoryStick className="h-3 w-3" />
                    {formatPercent(server.latestMetrics?.memoryUsedPercent, 0)}
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <HardDrive className="h-3 w-3" />
                    {formatPercent(server.latestMetrics?.diskUsedPercent, 0)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
