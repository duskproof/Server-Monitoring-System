'use client';

import { Download, ImageDown, RotateCcw, ZoomIn } from 'lucide-react';
import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { chartTheme, type ChartRow, type ChartSeriesConfig } from '@/lib/charts';
import { exportRowsAsCsv, exportSvgAsPng } from '@/lib/export';
import { formatAxisTime, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useUiStore } from '@/store/ui';

export interface MetricChartProps {
  title: string;
  description?: string;
  rows: ChartRow[];
  series: ChartSeriesConfig[];
  formatValue: (value: number) => string;
  loading?: boolean;
  longRange?: boolean;
  height?: number;
  /** Fixes the Y axis to 0–100 for percentage metrics. */
  percentScale?: boolean;
  exportName?: string;
  actions?: ReactNode;
  className?: string;
}

interface ZoomWindow {
  from: number;
  to: number;
}

export function MetricChart({
  title,
  description,
  rows,
  series,
  formatValue,
  loading = false,
  longRange = false,
  height = 280,
  percentScale = false,
  exportName,
  actions,
  className,
}: MetricChartProps) {
  const theme = useUiStore((state) => state.theme);
  const colors = useMemo(() => chartTheme(theme === 'dark'), [theme]);

  const containerRef = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [zoom, setZoom] = useState<ZoomWindow | null>(null);
  const [selectionStart, setSelectionStart] = useState<number | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

  const visibleSeries = useMemo(() => series.filter((item) => !hidden[item.key]), [series, hidden]);

  const zoomedRows = useMemo(() => {
    if (!zoom) return rows;
    return rows.filter((row) => row.t >= zoom.from && row.t <= zoom.to);
  }, [rows, zoom]);

  const toggleSeries = useCallback((key: string) => {
    setHidden((current) => ({ ...current, [key]: !current[key] }));
  }, []);

  const finishSelection = useCallback(() => {
    if (selectionStart === null || selectionEnd === null || selectionStart === selectionEnd) {
      setSelectionStart(null);
      setSelectionEnd(null);
      return;
    }
    const from = Math.min(selectionStart, selectionEnd);
    const to = Math.max(selectionStart, selectionEnd);
    const inWindow = rows.filter((row) => row.t >= from && row.t <= to);

    if (inWindow.length < 2) {
      toast('Select a wider range to zoom in', { icon: '🔍' });
    } else {
      setZoom({ from, to });
    }

    setSelectionStart(null);
    setSelectionEnd(null);
  }, [rows, selectionEnd, selectionStart]);

  const baseName = exportName ?? title.toLowerCase().replace(/\s+/g, '-');

  const handleExportCsv = useCallback(() => {
    if (zoomedRows.length === 0) {
      toast.error('There is no data to export');
      return;
    }
    const csvRows = zoomedRows.map((row) => {
      const record: Record<string, unknown> = { timestamp: new Date(row.t).toISOString() };
      for (const item of series) record[item.name] = row[item.key] ?? '';
      return record;
    });
    exportRowsAsCsv(csvRows, `${baseName}-${Date.now()}.csv`, ['timestamp', ...series.map((s) => s.name)]);
    toast.success('CSV exported');
  }, [baseName, series, zoomedRows]);

  const handleExportPng = useCallback(async () => {
    try {
      await exportSvgAsPng(containerRef.current, `${baseName}-${Date.now()}.png`, colors.exportBackground);
      toast.success('PNG exported');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to export the chart');
    }
  }, [baseName, colors.exportBackground]);

  return (
    <div className={cn('rounded-2xl border border-line bg-surface', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-content">{title}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {description ?? (zoom ? 'Zoomed view — drag to refine or reset' : 'Drag across the chart to zoom')}
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          {actions}
          {zoom ? (
            <Button variant="ghost" size="sm" leftIcon={<RotateCcw className="h-3.5 w-3.5" />} onClick={() => setZoom(null)}>
              Reset zoom
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={handleExportPng} title="Export as PNG" aria-label="Export as PNG">
            <ImageDown className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={handleExportCsv} title="Export as CSV" aria-label="Export as CSV">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {series.length > 1 ? (
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {series.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => toggleSeries(item.key)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors',
                hidden[item.key]
                  ? 'border-line text-muted opacity-60'
                  : 'border-line bg-elevated/60 text-content',
              )}
              aria-pressed={!hidden[item.key]}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: item.color }} />
              {item.name}
            </button>
          ))}
        </div>
      ) : null}

      <div ref={containerRef} className="px-2 py-3" style={{ height }}>
        {loading ? (
          <div className="flex h-full flex-col justify-end gap-2 px-2 pb-6">
            <Skeleton className="h-full w-full" />
          </div>
        ) : zoomedRows.length === 0 ? (
          <EmptyState
            className="h-full border-0 bg-transparent"
            icon={<ZoomIn className="h-5 w-5" />}
            title="No data for this period"
            description="Metrics appear a few moments after the agent starts reporting."
          />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={zoomedRows}
              margin={{ top: 8, right: 12, left: 4, bottom: 4 }}
              onMouseDown={(state) => {
                const value = state?.activeLabel;
                if (typeof value === 'number') setSelectionStart(value);
              }}
              onMouseMove={(state) => {
                if (selectionStart === null) return;
                const value = state?.activeLabel;
                if (typeof value === 'number') setSelectionEnd(value);
              }}
              onMouseUp={finishSelection}
              onMouseLeave={() => {
                setSelectionStart(null);
                setSelectionEnd(null);
              }}
            >
              <defs>
                {series.map((item) => (
                  <linearGradient key={item.key} id={`gradient-${item.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={item.color} stopOpacity={0.35} />
                    <stop offset="95%" stopColor={item.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} vertical={false} />
              <XAxis
                dataKey="t"
                type="number"
                domain={['dataMin', 'dataMax']}
                scale="time"
                tickFormatter={(value: number) => formatAxisTime(value, longRange)}
                stroke={colors.axis}
                tick={{ fontSize: 11, fill: colors.axis }}
                tickLine={false}
                axisLine={{ stroke: colors.grid }}
                minTickGap={28}
              />
              <YAxis
                stroke={colors.axis}
                tick={{ fontSize: 11, fill: colors.axis }}
                tickLine={false}
                axisLine={false}
                width={62}
                domain={percentScale ? [0, 100] : ['auto', 'auto']}
                tickFormatter={(value: number) => formatValue(value)}
              />
              <Tooltip
                isAnimationActive={false}
                contentStyle={{
                  backgroundColor: colors.tooltipBg,
                  border: `1px solid ${colors.tooltipBorder}`,
                  borderRadius: 12,
                  color: colors.tooltipText,
                  fontSize: 12,
                }}
                labelFormatter={(label) => formatDateTime(Number(label))}
                formatter={(value: number | string, name: string) => [
                  formatValue(Number(value)),
                  name,
                ]}
              />

              {visibleSeries.map((item) => (
                <Area
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  strokeWidth={2}
                  fill={`url(#gradient-${item.key})`}
                  isAnimationActive={false}
                  connectNulls
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              ))}

              {selectionStart !== null && selectionEnd !== null ? (
                <ReferenceArea
                  x1={Math.min(selectionStart, selectionEnd)}
                  x2={Math.max(selectionStart, selectionEnd)}
                  strokeOpacity={0.2}
                  fill={colors.axis}
                  fillOpacity={0.16}
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
