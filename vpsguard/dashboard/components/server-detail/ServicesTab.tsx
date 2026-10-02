'use client';

import { Play, RefreshCw, RotateCw, Search, Settings2, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { ConfirmDialog } from '@/components/ui/Modal';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { useRunCommand, useServices } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatDuration } from '@/lib/format';
import type { SystemdService } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCanOperate } from '@/store/auth';

type ServiceAction = 'start' | 'stop' | 'restart';

const ACTION_LABELS: Record<ServiceAction, string> = {
  start: 'Start',
  stop: 'Stop',
  restart: 'Restart',
};

function activeTone(state: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const normalized = state.toLowerCase();
  if (normalized === 'active') return 'success';
  if (normalized === 'activating' || normalized === 'reloading') return 'warning';
  if (normalized === 'failed') return 'danger';
  return 'neutral';
}

export function ServicesTab({ serverId }: { serverId: string }) {
  const query = useServices(serverId);
  const runCommand = useRunCommand();
  const canOperate = useCanOperate();

  const [search, setSearch] = useState('');
  const [pending, setPending] = useState<{ service: SystemdService; action: ServiceAction } | null>(null);

  const services = useMemo(() => query.data?.services ?? [], [query.data]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return services;
    return services.filter(
      (service) =>
        service.name.toLowerCase().includes(term) ||
        (service.description ?? '').toLowerCase().includes(term),
    );
  }, [search, services]);

  const execute = async () => {
    if (!pending) return;
    const typeMap: Record<ServiceAction, string> = {
      start: 'start_service',
      stop: 'stop_service',
      restart: 'restart_service',
    };
    try {
      await runCommand.mutateAsync({
        serverId,
        type: typeMap[pending.action],
        args: { name: pending.service.name },
      });
      toast.success(`${ACTION_LABELS[pending.action]} requested for ${pending.service.name}`);
      setPending(null);
      window.setTimeout(() => void query.refetch(), 3000);
    } catch {
      /* The mutation hook already surfaces the error as a toast. */
    }
  };

  if (query.isLoading) return <SkeletonTable rows={8} columns={5} />;

  if (query.isError) {
    return (
      <ErrorState
        title="Services unavailable"
        description={errorMessage(query.error, 'The agent has not reported systemd units yet.')}
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
        <p className="text-xs text-muted">
          {services.length} unit{services.length === 1 ? '' : 's'} · snapshot {formatDateTime(query.data?.collectedAt)}
        </p>
        <div className="flex items-center gap-2">
          <Input
            placeholder="Filter services"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            icon={<Search className="h-4 w-4" />}
            containerClassName="w-full sm:w-64"
            aria-label="Filter services"
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
          icon={<Settings2 className="h-5 w-5" />}
          title="No services found"
          description="Nothing matches your filter, or systemd data has not been collected yet."
        />
      ) : (
        <TableWrapper>
          <Table className="min-w-[780px]">
            <THead>
              <TR className="hover:bg-transparent">
                <TH>Unit</TH>
                <TH>Active state</TH>
                <TH>Sub state</TH>
                <TH>Uptime</TH>
                <TH className="text-right">Actions</TH>
              </TR>
            </THead>
            <TBody>
              {visible.map((service) => (
                <TR key={service.name}>
                  <TD>
                    <p className="font-medium text-content">{service.name}</p>
                    <p className="truncate text-xs text-muted">{service.description ?? '—'}</p>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <Badge tone={activeTone(service.activeState)}>{service.activeState}</Badge>
                      {service.enabled ? <Badge tone="primary">enabled</Badge> : null}
                    </div>
                  </TD>
                  <TD className="text-xs text-muted">{service.subState}</TD>
                  <TD className="text-xs text-muted">{formatDuration(service.uptimeSeconds)}</TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canOperate}
                        onClick={() => setPending({ service, action: 'start' })}
                        title="Start"
                        aria-label={`Start ${service.name}`}
                      >
                        <Play className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canOperate}
                        onClick={() => setPending({ service, action: 'stop' })}
                        title="Stop"
                        aria-label={`Stop ${service.name}`}
                      >
                        <Square className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!canOperate}
                        onClick={() => setPending({ service, action: 'restart' })}
                        title="Restart"
                        aria-label={`Restart ${service.name}`}
                      >
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </TableWrapper>
      )}

      <ConfirmDialog
        open={pending !== null}
        title={pending ? `${ACTION_LABELS[pending.action]} service` : 'Service action'}
        destructive={pending?.action === 'stop'}
        loading={runCommand.isPending}
        confirmLabel={pending ? ACTION_LABELS[pending.action] : 'Confirm'}
        message={
          <>
            {pending ? ACTION_LABELS[pending.action] : ''}{' '}
            <strong className="text-content">{pending?.service.name}</strong> on this server? The command is executed by
            the agent with root privileges.
          </>
        }
        onConfirm={execute}
        onCancel={() => setPending(null)}
      />
    </div>
  );
}
