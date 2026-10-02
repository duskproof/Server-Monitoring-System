'use client';

import { useEffect, useMemo, useState } from 'react';

import { MetricChart } from '@/components/charts/MetricChart';
import { Button } from '@/components/ui/Button';
import { useServerMetrics } from '@/hooks/queries';
import { useSocketEvent } from '@/hooks/useSocket';
import {
  appendLivePoint,
  buildChartData,
  type ChartRow,
  type ChartSeriesConfig,
} from '@/lib/charts';
import { formatBps, formatNumber, formatPercent } from '@/lib/format';
import { getTimeRange, LIVE_WINDOW_POINTS, TIME_RANGES } from '@/lib/metrics';
import type { LiveMetricsPayload, TimeRangeKey } from '@/lib/types';
import { cn } from '@/lib/utils';

/** Maps a realtime payload field onto one of the chart's series. */
interface LiveRule {
  match: RegExp;
  fallbackIndex: number;
  pick: (metrics: Record<string, any>) => number | undefined;
}

interface MetricPanelProps {
  serverId: string;
  /** One or more Influx metric keys (`cpu.percent`, `network.rx_speed_bps`, …). */
  metric: string | string[];
  title: string;
  description: string;
  range: TimeRangeKey;
  formatValue: (value: number) => string;
  percentScale?: boolean;
  liveRules: LiveRule[];
}

function MetricPanel({
  serverId,
  metric,
  title,
  description,
  range,
  formatValue,
  percentScale = false,
  liveRules,
}: MetricPanelProps) {
  const option = getTimeRange(range);
  const query = useServerMetrics(serverId, metric, range, option);

  const [rows, setRows] = useState<ChartRow[]>([]);
  const [series, setSeries] = useState<ChartSeriesConfig[]>([]);

  useEffect(() => {
    const data = buildChartData(query.data?.series);
    setRows(data.rows);
    setSeries(data.series);
  }, [query.data]);

  // Live samples are appended to the rolling window instead of refetching.
  useSocketEvent<LiveMetricsPayload>('metrics', (payload) => {
    if (payload?.serverId !== serverId || !payload.metrics || series.length === 0) return;

    const values: Record<string, number | undefined> = {};
    for (const rule of liveRules) {
      const target =
        series.find((item) => rule.match.test(item.name.toLowerCase())) ?? series[rule.fallbackIndex];
      if (!target) continue;
      values[target.key] = rule.pick(payload.metrics);
    }

    const timestamp = new Date(payload.timestamp).getTime() || Date.now();
    setRows((current) => appendLivePoint(current, timestamp, values, LIVE_WINDOW_POINTS));
  });

  return (
    <MetricChart
      title={title}
      description={description}
      rows={rows}
      series={series}
      loading={query.isLoading}
      longRange={option.longRange}
      percentScale={percentScale}
      formatValue={formatValue}
      exportName={`${title.toLowerCase().replace(/\s+/g, '-')}-${range}`}
    />
  );
}

/** Prefer flattened snapshot fields, fall back to nested agent payload. */
function pickNumber(...candidates: unknown[]): number | undefined {
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

export function OverviewTab({ serverId }: { serverId: string }) {
  const [range, setRange] = useState<TimeRangeKey>('1h');

  const panels = useMemo(
    () => [
      {
        metric: 'cpu.percent',
        title: 'CPU usage',
        description: 'Processor load reported by the agent',
        percentScale: true,
        formatValue: (value: number) => formatPercent(value, 0),
        liveRules: [
          {
            match: /cpu|usage|percent/,
            fallbackIndex: 0,
            pick: (m) => pickNumber(m.cpuPercent, m.cpu?.percent),
          },
        ] satisfies LiveRule[],
      },
      {
        metric: 'memory.used_percent',
        title: 'Memory usage',
        description: 'RAM and swap utilisation',
        percentScale: true,
        formatValue: (value: number) => formatPercent(value, 0),
        liveRules: [
          {
            match: /mem|ram|used/,
            fallbackIndex: 0,
            pick: (m) => pickNumber(m.memoryUsedPercent, m.memory?.used_percent),
          },
        ] satisfies LiveRule[],
      },
      {
        metric: ['network.rx_speed_bps', 'network.tx_speed_bps'],
        title: 'Network throughput',
        description: 'Inbound and outbound traffic',
        percentScale: false,
        formatValue: (value: number) => formatBps(value, 1),
        liveRules: [
          {
            match: /rx|in|down/,
            fallbackIndex: 0,
            pick: (m) => pickNumber(m.networkRxBps, sumNetwork(m.network, 'rx_speed_bps')),
          },
          {
            match: /tx|out|up/,
            fallbackIndex: 1,
            pick: (m) => pickNumber(m.networkTxBps, sumNetwork(m.network, 'tx_speed_bps')),
          },
        ] satisfies LiveRule[],
      },
      {
        metric: ['disk.io_read_mb', 'disk.io_write_mb'],
        title: 'Disk I/O',
        description: 'Cumulative read and write volume per mount (MB)',
        percentScale: false,
        formatValue: (value: number) => `${formatNumber(value, 1)} MB`,
        liveRules: [
          {
            match: /read|rd|io_read/,
            fallbackIndex: 0,
            pick: (m) => pickNumber(m.diskReadMb, firstDisk(m.disk, 'io_read_mb')),
          },
          {
            match: /write|wr|io_write/,
            fallbackIndex: 1,
            pick: (m) => pickNumber(m.diskWriteMb, firstDisk(m.disk, 'io_write_mb')),
          },
        ] satisfies LiveRule[],
      },
    ],
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Charts stream live samples over WebSocket — drag across any chart to zoom into a window.
        </p>
        <div className="inline-flex rounded-lg border border-line bg-surface p-1">
          {TIME_RANGES.map((option) => (
            <Button
              key={option.key}
              variant="ghost"
              size="sm"
              onClick={() => setRange(option.key)}
              className={cn(
                'px-3',
                range === option.key ? 'bg-primary text-primary-fg hover:bg-primary' : 'text-muted',
              )}
              aria-pressed={range === option.key}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        {panels.map((panel) => (
          <MetricPanel
            key={Array.isArray(panel.metric) ? panel.metric.join(',') : panel.metric}
            serverId={serverId}
            metric={panel.metric}
            title={panel.title}
            description={panel.description}
            range={range}
            percentScale={panel.percentScale}
            formatValue={panel.formatValue}
            liveRules={panel.liveRules}
          />
        ))}
      </div>

      <p className="text-xs text-muted">
        Historical points are aggregated at a {getTimeRange(range).interval} interval; live samples arrive at the
        agent&apos;s reporting interval and are appended to the rolling window.
      </p>
    </div>
  );
}

function sumNetwork(network: unknown, field: string): number | undefined {
  if (!network || typeof network !== 'object') return undefined;
  let total = 0;
  let any = false;
  for (const iface of Object.values(network as Record<string, any>)) {
    const value = Number(iface?.[field]);
    if (Number.isFinite(value)) {
      total += value;
      any = true;
    }
  }
  return any ? total : undefined;
}

function firstDisk(disks: unknown, field: string): number | undefined {
  if (!Array.isArray(disks) || disks.length === 0) return undefined;
  const value = Number(disks[0]?.[field]);
  return Number.isFinite(value) ? value : undefined;
}
