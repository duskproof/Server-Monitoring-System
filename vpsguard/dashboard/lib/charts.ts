import { toDate } from '@/lib/format';
import type { MetricSeries } from '@/lib/types';
import { slugify } from '@/lib/utils';

/**
 * Literal hex colours (not CSS variables) because Recharts writes them into SVG
 * presentation attributes, which do not resolve `var()` — and because the PNG
 * export rasterises the SVG outside of the document's cascade.
 */
export const CHART_PALETTE = [
  '#a855f7',
  '#e879f9',
  '#4ade80',
  '#f472b6',
  '#818cf8',
  '#22d3ee',
  '#fbbf24',
  '#fb7185',
  '#34d399',
  '#c084fc',
];

export interface ChartSeriesConfig {
  /** Data key inside a chart row. */
  key: string;
  name: string;
  color: string;
}

export interface ChartRow {
  t: number;
  [key: string]: number;
}

export interface ChartData {
  rows: ChartRow[];
  series: ChartSeriesConfig[];
}

export function seriesKey(name: string, index: number): string {
  const slug = slugify(name);
  return slug ? `s_${slug}` : `s_${index}`;
}

/** Converts the API's `{series:[{name,points}]}` payload into recharts rows. */
export function buildChartData(series: MetricSeries[] | undefined): ChartData {
  if (!series || series.length === 0) return { rows: [], series: [] };

  const configs: ChartSeriesConfig[] = series.map((item, index) => ({
    key: seriesKey(item.name, index),
    name: item.name,
    color: CHART_PALETTE[index % CHART_PALETTE.length],
  }));

  const byTimestamp = new Map<number, ChartRow>();

  series.forEach((item, index) => {
    const key = configs[index].key;
    for (const point of item.points ?? []) {
      const date = toDate(point.t);
      if (!date) continue;
      const timestamp = date.getTime();
      const existing = byTimestamp.get(timestamp);
      if (existing) {
        existing[key] = point.v;
      } else {
        byTimestamp.set(timestamp, { t: timestamp, [key]: point.v });
      }
    }
  });

  const rows = Array.from(byTimestamp.values()).sort((a, b) => a.t - b.t);
  return { rows, series: configs };
}

/**
 * Appends a realtime sample and trims the rolling window.
 * Samples closer than one second to the previous row are merged in place, which
 * keeps the chart smooth when several metrics arrive in the same tick.
 */
export function appendLivePoint(
  rows: ChartRow[],
  timestamp: number,
  values: Record<string, number | undefined>,
  windowSize: number,
): ChartRow[] {
  const cleaned: Record<string, number> = {};
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === 'number' && Number.isFinite(value)) cleaned[key] = value;
  }
  if (Object.keys(cleaned).length === 0) return rows;

  const last = rows[rows.length - 1];
  if (last && Math.abs(timestamp - last.t) < 1000) {
    const merged = [...rows];
    merged[merged.length - 1] = { ...last, ...cleaned };
    return merged;
  }

  const next = [...rows, { t: timestamp, ...cleaned }];
  return next.length > windowSize ? next.slice(next.length - windowSize) : next;
}

export interface ChartTheme {
  grid: string;
  axis: string;
  tooltipBg: string;
  tooltipBorder: string;
  tooltipText: string;
  exportBackground: string;
}

export function chartTheme(dark: boolean): ChartTheme {
  return dark
    ? {
        grid: '#1e293b',
        axis: '#94a3b8',
        tooltipBg: '#0f172a',
        tooltipBorder: '#1e293b',
        tooltipText: '#e2e8f0',
        exportBackground: '#0c0814',
      }
    : {
        grid: '#e2e8f0',
        axis: '#64748b',
        tooltipBg: '#ffffff',
        tooltipBorder: '#e2e8f0',
        tooltipText: '#0f172a',
        exportBackground: '#ffffff',
      };
}
