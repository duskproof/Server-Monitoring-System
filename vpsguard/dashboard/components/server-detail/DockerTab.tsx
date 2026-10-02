'use client';

import { Boxes, Container, RefreshCw, RotateCw } from 'lucide-react';
import { useState } from 'react';
import toast from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { UsageBar } from '@/components/ui/Gauge';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Skeleton } from '@/components/ui/Skeleton';
import { useDocker, useRunCommand } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatBytes, formatDateTime, formatPercent } from '@/lib/format';
import type { DockerContainer } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCanOperate } from '@/store/auth';

function stateTone(state: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const normalized = state.toLowerCase();
  if (normalized.includes('running') || normalized.includes('up')) return 'success';
  if (normalized.includes('restart') || normalized.includes('paused')) return 'warning';
  if (normalized.includes('exit') || normalized.includes('dead')) return 'danger';
  return 'neutral';
}

export function DockerTab({ serverId }: { serverId: string }) {
  const query = useDocker(serverId);
  const runCommand = useRunCommand();
  const canOperate = useCanOperate();
  const [pending, setPending] = useState<DockerContainer | null>(null);

  const restart = async () => {
    if (!pending) return;
    try {
      await runCommand.mutateAsync({
        serverId,
        type: 'restart_docker',
        args: { name: pending.name, containerId: pending.id },
      });
      toast.success(`Restart requested for ${pending.name}`);
      setPending(null);
      window.setTimeout(() => void query.refetch(), 3000);
    } catch {
      /* The mutation hook already surfaces the error as a toast. */
    }
  };

  if (query.isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => (
          <Skeleton key={index} className="h-52 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        title="Docker data unavailable"
        description={errorMessage(query.error, 'Docker may not be installed on this server.')}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const containers = query.data?.containers ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {containers.length} container{containers.length === 1 ? '' : 's'} · snapshot{' '}
          {formatDateTime(query.data?.collectedAt)}
        </p>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      </div>

      {containers.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-5 w-5" />}
          title="No containers found"
          description="Docker is either not installed on this machine or has no containers yet."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {containers.map((container) => {
            const memoryPercent =
              container.memoryLimitBytes > 0
                ? (container.memoryUsageBytes / container.memoryLimitBytes) * 100
                : 0;

            return (
              <div key={container.id} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-content" title={container.name}>
                      {container.name}
                    </p>
                    <p className="truncate text-xs text-muted" title={container.image}>
                      {container.image}
                    </p>
                  </div>
                  <Badge tone={stateTone(container.state || container.status)}>{container.state || 'unknown'}</Badge>
                </div>

                <div className="mt-4 space-y-3">
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">CPU</span>
                      <span className="text-content">{formatPercent(container.cpuPercent)}</span>
                    </div>
                    <UsageBar className="mt-1" value={container.cpuPercent} />
                  </div>
                  <div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted">Memory</span>
                      <span className="text-content">
                        {formatBytes(container.memoryUsageBytes)}
                        {container.memoryLimitBytes > 0 ? ` / ${formatBytes(container.memoryLimitBytes)}` : ''}
                      </span>
                    </div>
                    <UsageBar className="mt-1" value={memoryPercent} />
                  </div>
                </div>

                <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <dt className="text-muted">Network RX</dt>
                    <dd className="text-content">{formatBytes(container.networkRxBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Network TX</dt>
                    <dd className="text-content">{formatBytes(container.networkTxBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Block read</dt>
                    <dd className="text-content">{formatBytes(container.blockReadBytes)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted">Block write</dt>
                    <dd className="text-content">{formatBytes(container.blockWriteBytes)}</dd>
                  </div>
                </dl>

                <div className="mt-4 flex items-center justify-between gap-2 border-t border-line pt-3">
                  <span className="truncate text-xs text-muted" title={container.status}>
                    {container.status}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    leftIcon={<RotateCw className="h-3.5 w-3.5" />}
                    disabled={!canOperate}
                    title={canOperate ? 'Restart container' : 'Requires operator permissions'}
                    onClick={() => setPending(container)}
                  >
                    Restart
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title="Restart container"
        loading={runCommand.isPending}
        confirmLabel="Restart"
        message={
          <>
            Restart <strong className="text-content">{pending?.name}</strong>? Connected clients will be dropped while
            the container comes back up.
          </>
        }
        onConfirm={restart}
        onCancel={() => setPending(null)}
      />

      {containers.length > 0 ? (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Container className="h-3.5 w-3.5" />
          Restart commands are dispatched to the agent and executed asynchronously.
        </p>
      ) : null}
    </div>
  );
}
