'use client';

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/Button';
import { Checkbox, Input, Switch } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useGroups, useSaveAlertRule, useServers } from '@/hooks/queries';
import { ALERT_DURATIONS, ALERT_METRICS, describeMetric, NOTIFICATION_CHANNELS } from '@/lib/metrics';
import type { AlertCondition, AlertRule, AlertRuleInput, AlertSeverity } from '@/lib/types';

interface AlertRuleModalProps {
  open: boolean;
  onClose: () => void;
  /** Existing rule when editing, `null` when creating. */
  rule: AlertRule | null;
}

type TargetKind = 'all' | 'server' | 'group';

const CONDITIONS: Array<{ value: AlertCondition; label: string }> = [
  { value: '>', label: 'is greater than' },
  { value: '<', label: 'is less than' },
  { value: '==', label: 'is equal to' },
  { value: '!=', label: 'is not equal to' },
];

const SEVERITIES: Array<{ value: AlertSeverity; label: string }> = [
  { value: 'info', label: 'Info' },
  { value: 'warning', label: 'Warning' },
  { value: 'critical', label: 'Critical' },
];

const EMPTY_RULE: AlertRuleInput = {
  name: '',
  serverId: null,
  groupId: null,
  metric: 'cpu.percent',
  condition: '>',
  threshold: 90,
  durationSeconds: 300,
  severity: 'warning',
  channels: ['telegram'],
  enabled: true,
};

export function AlertRuleModal({ open, onClose, rule }: AlertRuleModalProps) {
  const serversQuery = useServers({});
  const groupsQuery = useGroups();
  const saveRule = useSaveAlertRule();

  const [form, setForm] = useState<AlertRuleInput>(EMPTY_RULE);
  const [targetKind, setTargetKind] = useState<TargetKind>('all');
  const [nameError, setNameError] = useState<string | undefined>();

  useEffect(() => {
    if (!open) return;
    if (rule) {
      const { id: _id, ...rest } = rule;
      setForm(rest);
      setTargetKind(rule.serverId ? 'server' : rule.groupId ? 'group' : 'all');
    } else {
      setForm(EMPTY_RULE);
      setTargetKind('all');
    }
    setNameError(undefined);
  }, [open, rule]);

  const descriptor = useMemo(() => describeMetric(form.metric), [form.metric]);

  const update = <K extends keyof AlertRuleInput>(key: K, value: AlertRuleInput[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const onMetricChange = (metric: string) => {
    const next = describeMetric(metric);
    setForm((current) => ({
      ...current,
      metric,
      threshold: next ? next.defaultThreshold : current.threshold,
    }));
  };

  const onTargetKindChange = (kind: TargetKind) => {
    setTargetKind(kind);
    setForm((current) => ({
      ...current,
      serverId: kind === 'server' ? current.serverId : null,
      groupId: kind === 'group' ? current.groupId : null,
    }));
  };

  const toggleChannel = (channel: string, checked: boolean) => {
    setForm((current) => ({
      ...current,
      channels: checked
        ? Array.from(new Set([...current.channels, channel]))
        : current.channels.filter((item) => item !== channel),
    }));
  };

  const submit = async () => {
    if (form.name.trim().length < 3) {
      setNameError('Give the rule a descriptive name');
      return;
    }
    setNameError(undefined);

    try {
      await saveRule.mutateAsync({
        id: rule?.id,
        payload: {
          ...form,
          name: form.name.trim(),
          threshold: Number(form.threshold),
          durationSeconds: Number(form.durationSeconds),
        },
      });
      onClose();
    } catch {
      /* The mutation hook already surfaces the error as a toast. */
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={rule ? 'Edit alert rule' : 'New alert rule'}
      description="Alerts fire when the condition holds for the configured duration."
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saveRule.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} loading={saveRule.isPending}>
            {rule ? 'Save changes' : 'Create rule'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Rule name"
          placeholder="High CPU on production"
          value={form.name}
          onChange={(event) => update('name', event.target.value)}
          error={nameError}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label="Applies to"
            value={targetKind}
            onChange={(event) => onTargetKindChange(event.target.value as TargetKind)}
            options={[
              { value: 'all', label: 'All servers' },
              { value: 'server', label: 'A single server' },
              { value: 'group', label: 'A group' },
            ]}
          />

          {targetKind === 'server' ? (
            <Select
              label="Server"
              value={form.serverId ?? ''}
              onChange={(event) => update('serverId', event.target.value || null)}
              placeholder="Select a server"
              options={(serversQuery.data ?? []).map((server) => ({ value: server.id, label: server.name }))}
            />
          ) : targetKind === 'group' ? (
            <Select
              label="Group"
              value={form.groupId ?? ''}
              onChange={(event) => update('groupId', event.target.value || null)}
              placeholder="Select a group"
              options={(groupsQuery.data ?? []).map((group) => ({ value: group.id, label: group.name }))}
            />
          ) : (
            <div className="flex items-end pb-2 text-xs text-muted">
              The rule is evaluated for every server in the fleet.
            </div>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Metric"
            value={form.metric}
            onChange={(event) => onMetricChange(event.target.value)}
            options={ALERT_METRICS.map((metric) => ({ value: metric.value, label: metric.label }))}
            containerClassName="sm:col-span-2"
          />
          <Select
            label="Condition"
            value={form.condition}
            onChange={(event) => update('condition', event.target.value as AlertCondition)}
            options={CONDITIONS}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Input
            label={`Threshold${descriptor?.unit ? ` (${descriptor.unit})` : ''}`}
            type="number"
            step="any"
            value={String(form.threshold)}
            onChange={(event) => update('threshold', Number(event.target.value))}
            hint={descriptor ? `Current unit: ${descriptor.format(Number(form.threshold) || 0)}` : undefined}
          />
          <Select
            label="For at least"
            value={String(form.durationSeconds)}
            onChange={(event) => update('durationSeconds', Number(event.target.value))}
            options={ALERT_DURATIONS.map((duration) => ({
              value: String(duration.value),
              label: duration.label,
            }))}
          />
          <Select
            label="Severity"
            value={form.severity}
            onChange={(event) => update('severity', event.target.value as AlertSeverity)}
            options={SEVERITIES}
          />
        </div>

        <div>
          <p className="mb-2 text-xs font-medium text-muted">Notification channels</p>
          <div className="flex flex-wrap gap-4">
            {NOTIFICATION_CHANNELS.map((channel) => (
              <Checkbox
                key={channel}
                label={<span className="capitalize">{channel}</span>}
                checked={form.channels.includes(channel)}
                onChange={(event) => toggleChannel(channel, event.target.checked)}
              />
            ))}
          </div>
          <p className="mt-1.5 text-xs text-muted">
            Channels must be configured in Settings → Integrations before they can deliver messages.
          </p>
        </div>

        <div className="border-t border-line pt-4">
          <Switch
            checked={form.enabled}
            onChange={(checked) => update('enabled', checked)}
            label={form.enabled ? 'Rule is enabled' : 'Rule is disabled'}
          />
        </div>
      </div>
    </Modal>
  );
}
