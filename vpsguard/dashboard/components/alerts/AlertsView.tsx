'use client';

import { Check, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

import { AlertRuleModal } from '@/components/alerts/AlertRuleModal';
import { AlertStatusBadge, Badge, SeverityBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader } from '@/components/ui/Card';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { ConfirmDialog } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SkeletonTable } from '@/components/ui/Skeleton';
import { Table, TableWrapper, TBody, TD, TH, THead, TR } from '@/components/ui/Table';
import { Tabs, type TabItem } from '@/components/ui/Tabs';
import {
  useAcknowledgeAlert,
  useAlertRules,
  useAlerts,
  useDeleteAlertRule,
  useGroups,
  useServers,
} from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatRelative, formatShortDuration } from '@/lib/format';
import { describeMetric, formatMetricValue } from '@/lib/metrics';
import type { AlertRule, AlertSeverity, AlertStatus } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCanOperate } from '@/store/auth';

type TabKey = 'firing' | 'acknowledged' | 'resolved';

const TAB_ITEMS: TabItem<TabKey>[] = [
  { key: 'firing', label: 'Active' },
  { key: 'acknowledged', label: 'Acknowledged' },
  { key: 'resolved', label: 'History' },
];

const SEVERITY_OPTIONS = [
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

export function AlertsView() {
  const canOperate = useCanOperate();

  const [tab, setTab] = useState<TabKey>('firing');
  const [severity, setSeverity] = useState<AlertSeverity | ''>('');
  const [serverFilter, setServerFilter] = useState('');
  const [ruleModalOpen, setRuleModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [ruleToDelete, setRuleToDelete] = useState<AlertRule | null>(null);

  const alertsQuery = useAlerts(tab as AlertStatus);
  const rulesQuery = useAlertRules();
  const serversQuery = useServers({});
  const groupsQuery = useGroups();
  const acknowledge = useAcknowledgeAlert();
  const deleteRule = useDeleteAlertRule();

  const alerts = useMemo(() => {
    const list = alertsQuery.data ?? [];
    return list
      .filter((alert) => (severity ? alert.severity === severity : true))
      .filter((alert) => (serverFilter ? alert.serverId === serverFilter : true))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [alertsQuery.data, serverFilter, severity]);

  const targetLabel = (rule: AlertRule): string => {
    if (rule.serverId) {
      return serversQuery.data?.find((server) => server.id === rule.serverId)?.name ?? 'Server';
    }
    if (rule.groupId) {
      return groupsQuery.data?.find((group) => group.id === rule.groupId)?.name ?? 'Group';
    }
    return 'All servers';
  };

  const openRuleModal = (rule: AlertRule | null) => {
    setEditingRule(rule);
    setRuleModalOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-content">Alerts</h2>
          <p className="text-sm text-muted">Incidents raised by your alert rules.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className={cn('h-4 w-4', alertsQuery.isFetching && 'animate-spin')} />}
          onClick={() => void alertsQuery.refetch()}
        >
          Refresh
        </Button>
      </div>

      <div className="space-y-4">
        <Tabs items={TAB_ITEMS} value={tab} onChange={setTab} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            value={severity}
            onChange={(event) => setSeverity(event.target.value as AlertSeverity | '')}
            placeholder="All severities"
            options={SEVERITY_OPTIONS}
            aria-label="Filter by severity"
          />
          <Select
            value={serverFilter}
            onChange={(event) => setServerFilter(event.target.value)}
            placeholder="All servers"
            options={(serversQuery.data ?? []).map((server) => ({ value: server.id, label: server.name }))}
            aria-label="Filter by server"
          />
        </div>

        {alertsQuery.isLoading ? (
          <SkeletonTable rows={5} columns={6} />
        ) : alertsQuery.isError ? (
          <ErrorState
            description={errorMessage(alertsQuery.error, 'Alerts could not be loaded.')}
            action={
              <Button variant="outline" size="sm" onClick={() => void alertsQuery.refetch()}>
                Retry
              </Button>
            }
          />
        ) : alerts.length === 0 ? (
          <EmptyState
            title={
              tab === 'firing'
                ? 'No active alerts'
                : tab === 'acknowledged'
                  ? 'Nothing acknowledged'
                  : 'No resolved alerts yet'
            }
            description={
              tab === 'firing'
                ? 'Everything is within the thresholds defined by your alert rules.'
                : 'Alerts appear here once their status changes.'
            }
          />
        ) : (
          <TableWrapper>
            <Table className="min-w-[880px]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Rule</TH>
                  <TH>Server</TH>
                  <TH>Metric</TH>
                  <TH>Severity</TH>
                  <TH>Status</TH>
                  <TH>Raised</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {alerts.map((alert) => (
                  <TR key={alert.id}>
                    <TD>
                      <p className="font-medium text-content">{alert.ruleName}</p>
                      <p className="truncate text-xs text-muted" title={alert.message}>
                        {alert.message}
                      </p>
                    </TD>
                    <TD>
                      <Link href={`/cabinet/servers/${alert.serverId}`} className="text-sm text-primary hover:underline">
                        {alert.serverName}
                      </Link>
                    </TD>
                    <TD className="text-xs text-muted">
                      <p className="text-content">{describeMetric(alert.metric)?.label ?? alert.metric}</p>
                      <p>
                        {formatMetricValue(alert.metric, alert.value)} / limit{' '}
                        {formatMetricValue(alert.metric, alert.threshold)}
                      </p>
                    </TD>
                    <TD>
                      <SeverityBadge severity={alert.severity} />
                    </TD>
                    <TD>
                      <AlertStatusBadge status={alert.status} />
                      {alert.acknowledgedBy ? (
                        <p className="mt-1 text-xs text-muted">by {alert.acknowledgedBy}</p>
                      ) : null}
                    </TD>
                    <TD className="whitespace-nowrap text-xs text-muted" title={formatDateTime(alert.createdAt)}>
                      {formatRelative(alert.createdAt)}
                      {alert.resolvedAt ? (
                        <p className="text-success">resolved {formatRelative(alert.resolvedAt)}</p>
                      ) : null}
                    </TD>
                    <TD className="text-right">
                      {alert.status === 'firing' && canOperate ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={<Check className="h-3.5 w-3.5" />}
                          loading={acknowledge.isPending && acknowledge.variables === alert.id}
                          onClick={() => acknowledge.mutate(alert.id)}
                        >
                          Acknowledge
                        </Button>
                      ) : (
                        <span className="text-xs text-muted">—</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </div>

      <Card>
        <CardHeader
          title="Alert rules"
          description="Thresholds evaluated continuously against incoming metrics"
          action={
            canOperate ? (
              <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => openRuleModal(null)}>
                New rule
              </Button>
            ) : null
          }
        />

        {rulesQuery.isLoading ? (
          <div className="p-4">
            <SkeletonTable rows={4} columns={5} />
          </div>
        ) : rulesQuery.isError ? (
          <div className="p-4">
            <ErrorState description={errorMessage(rulesQuery.error, 'Alert rules could not be loaded.')} />
          </div>
        ) : (rulesQuery.data ?? []).length === 0 ? (
          <EmptyState
            className="m-4 border-dashed"
            title="No alert rules yet"
            description="Create a rule to be notified when CPU, memory, disk, SSL or security metrics cross a threshold."
            action={
              canOperate ? (
                <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => openRuleModal(null)}>
                  Create the first rule
                </Button>
              ) : null
            }
          />
        ) : (
          <TableWrapper className="rounded-none border-0">
            <Table className="min-w-[860px]">
              <THead>
                <TR className="hover:bg-transparent">
                  <TH>Name</TH>
                  <TH>Target</TH>
                  <TH>Condition</TH>
                  <TH>Severity</TH>
                  <TH>Channels</TH>
                  <TH>State</TH>
                  <TH className="text-right">Actions</TH>
                </TR>
              </THead>
              <TBody>
                {(rulesQuery.data ?? []).map((rule) => (
                  <TR key={rule.id}>
                    <TD className="font-medium text-content">{rule.name}</TD>
                    <TD className="text-xs text-muted">{targetLabel(rule)}</TD>
                    <TD className="text-xs text-muted">
                      <span className="text-content">{describeMetric(rule.metric)?.label ?? rule.metric}</span>{' '}
                      {rule.condition} {formatMetricValue(rule.metric, rule.threshold)}
                      <p>for {formatShortDuration(rule.durationSeconds)}</p>
                    </TD>
                    <TD>
                      <SeverityBadge severity={rule.severity} />
                    </TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        {rule.channels.length === 0 ? (
                          <span className="text-xs text-muted">none</span>
                        ) : (
                          rule.channels.map((channel) => (
                            <Badge key={channel} tone="neutral" className="capitalize">
                              {channel}
                            </Badge>
                          ))
                        )}
                      </div>
                    </TD>
                    <TD>
                      <Badge tone={rule.enabled ? 'success' : 'neutral'}>{rule.enabled ? 'enabled' : 'disabled'}</Badge>
                    </TD>
                    <TD>
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canOperate}
                          onClick={() => openRuleModal(rule)}
                          aria-label={`Edit ${rule.name}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={!canOperate}
                          onClick={() => setRuleToDelete(rule)}
                          aria-label={`Delete ${rule.name}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-danger" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
        )}
      </Card>

      <AlertRuleModal open={ruleModalOpen} onClose={() => setRuleModalOpen(false)} rule={editingRule} />

      <ConfirmDialog
        open={ruleToDelete !== null}
        title="Delete alert rule"
        destructive
        loading={deleteRule.isPending}
        confirmLabel="Delete"
        message={
          <>
            Delete <strong className="text-content">{ruleToDelete?.name}</strong>? Alerts already raised by this rule
            are kept in the history.
          </>
        }
        onConfirm={async () => {
          if (!ruleToDelete) return;
          await deleteRule.mutateAsync(ruleToDelete.id).catch(() => undefined);
          setRuleToDelete(null);
        }}
        onCancel={() => setRuleToDelete(null)}
      />
    </div>
  );
}
