import { subDays, subHours } from 'date-fns';

import { formatBps, formatGigabytes, formatNumber, formatPercent, formatTemperature } from '@/lib/format';
import type { AlertMetric, TimeRangeKey } from '@/lib/types';

export interface TimeRangeOption {
  key: TimeRangeKey;
  label: string;
  /** Aggregation interval passed to the metrics endpoint. */
  interval: string;
  /** Whether axis labels should include the day. */
  longRange: boolean;
}

export const TIME_RANGES: TimeRangeOption[] = [
  { key: '1h', label: '1h', interval: '1m', longRange: false },
  { key: '6h', label: '6h', interval: '5m', longRange: false },
  { key: '24h', label: '24h', interval: '5m', longRange: false },
  { key: '7d', label: '7d', interval: '1h', longRange: true },
  { key: '30d', label: '30d', interval: '6h', longRange: true },
];

export function getTimeRange(key: TimeRangeKey): TimeRangeOption {
  return TIME_RANGES.find((range) => range.key === key) ?? TIME_RANGES[0];
}

/** Absolute [from, to] ISO window for a relative range key. */
export function resolveRange(key: TimeRangeKey): { from: string; to: string } {
  const to = new Date();
  const from = (() => {
    switch (key) {
      case '1h':
        return subHours(to, 1);
      case '6h':
        return subHours(to, 6);
      case '24h':
        return subHours(to, 24);
      case '7d':
        return subDays(to, 7);
      case '30d':
        return subDays(to, 30);
      default:
        return subHours(to, 1);
    }
  })();

  return { from: from.toISOString(), to: to.toISOString() };
}

/** Number of live points retained in memory before the oldest are dropped. */
export const LIVE_WINDOW_POINTS = 240;

export interface MetricDescriptor {
  value: AlertMetric;
  label: string;
  unit: string;
  format: (value: number) => string;
  /** Sensible default threshold offered when creating a rule. */
  defaultThreshold: number;
}

export const ALERT_METRICS: MetricDescriptor[] = [
  { value: 'cpu.percent', label: 'CPU usage', unit: '%', format: (v) => formatPercent(v), defaultThreshold: 90 },
  { value: 'cpu.load_1m', label: 'Load average (1m)', unit: '', format: (v) => formatNumber(v), defaultThreshold: 4 },
  {
    value: 'cpu.temperature',
    label: 'CPU temperature',
    unit: '°C',
    format: (v) => formatTemperature(v),
    defaultThreshold: 80,
  },
  {
    value: 'memory.used_percent',
    label: 'Memory usage',
    unit: '%',
    format: (v) => formatPercent(v),
    defaultThreshold: 90,
  },
  {
    value: 'memory.swap_used_percent',
    label: 'Swap usage',
    unit: '%',
    format: (v) => formatPercent(v),
    defaultThreshold: 50,
  },
  {
    value: 'disk.used_percent',
    label: 'Disk usage',
    unit: '%',
    format: (v) => formatPercent(v),
    defaultThreshold: 85,
  },
  {
    value: 'disk.free_gb',
    label: 'Disk free space',
    unit: 'GB',
    format: (v) => formatGigabytes(v),
    defaultThreshold: 10,
  },
  {
    value: 'network.rx_speed_bps',
    label: 'Network inbound',
    unit: 'B/s',
    format: (v) => formatBps(v),
    defaultThreshold: 100 * 1024 * 1024,
  },
  {
    value: 'network.tx_speed_bps',
    label: 'Network outbound',
    unit: 'B/s',
    format: (v) => formatBps(v),
    defaultThreshold: 100 * 1024 * 1024,
  },
  {
    value: 'security.failed_ssh_attempts',
    label: 'Failed SSH attempts',
    unit: '',
    format: (v) => formatNumber(v, 0),
    defaultThreshold: 20,
  },
  {
    value: 'ssl.days_left',
    label: 'SSL days left',
    unit: 'days',
    format: (v) => `${formatNumber(v, 0)} days`,
    defaultThreshold: 14,
  },
  {
    value: 'disk.forecast_days',
    label: 'Disk fill forecast',
    unit: 'days',
    format: (v) => `${formatNumber(v, 1)} days`,
    defaultThreshold: 3,
  },
  {
    value: 'agent.offline',
    label: 'Agent offline',
    unit: '',
    format: (v) => (v ? 'offline' : 'online'),
    defaultThreshold: 1,
  },
];

export function describeMetric(metric: string): MetricDescriptor | undefined {
  return ALERT_METRICS.find((item) => item.value === metric);
}

/** Formats an alert value/threshold using the metric's natural unit. */
export function formatMetricValue(metric: string, value: number): string {
  const descriptor = describeMetric(metric);
  return descriptor ? descriptor.format(value) : formatNumber(value);
}

export const NOTIFICATION_CHANNELS = ['telegram', 'slack', 'email', 'webhook'] as const;

export const ALERT_DURATIONS = [
  { value: 0, label: 'Immediately' },
  { value: 60, label: '1 minute' },
  { value: 300, label: '5 minutes' },
  { value: 600, label: '10 minutes' },
  { value: 1800, label: '30 minutes' },
  { value: 3600, label: '1 hour' },
];
