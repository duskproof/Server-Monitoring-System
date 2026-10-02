import { format, formatDistanceToNowStrict, isValid, parseISO } from 'date-fns';

/** Parses ISO strings, epoch numbers and Date objects into a valid Date (or null). */
export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return isValid(value) ? value : null;
  if (typeof value === 'number') {
    const fromNumber = new Date(value < 1e12 ? value * 1000 : value);
    return isValid(fromNumber) ? fromNumber : null;
  }
  const numeric = Number(value);
  if (value.trim() !== '' && !Number.isNaN(numeric)) {
    return toDate(numeric);
  }
  const parsed = parseISO(value);
  return isValid(parsed) ? parsed : null;
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy, HH:mm:ss') : '—';
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy') : '—';
}

export function formatTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'HH:mm:ss') : '—';
}

/** Chart axis label: short for intraday ranges, day + time for long ranges. */
export function formatAxisTime(value: string | number | Date, longRange = false): string {
  const date = toDate(value);
  if (!date) return '';
  return longRange ? format(date, 'dd MMM HH:mm') : format(date, 'HH:mm');
}

export function formatRelative(value: string | number | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return 'never';
  return `${formatDistanceToNowStrict(date)} ago`;
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  }).format(value);
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes === 0) return '0 B';
  const negative = bytes < 0;
  const abs = Math.abs(bytes);
  const exponent = Math.min(Math.floor(Math.log(abs) / Math.log(1024)), BYTE_UNITS.length - 1);
  const scaled = abs / 1024 ** exponent;
  const unit = BYTE_UNITS[exponent];
  return `${negative ? '-' : ''}${scaled.toFixed(exponent === 0 ? 0 : digits)} ${unit}`;
}

/** Formats a bytes-per-second throughput value. */
export function formatBps(bps: number | null | undefined, digits = 1): string {
  if (bps === null || bps === undefined || Number.isNaN(bps)) return '—';
  return `${formatBytes(bps, digits)}/s`;
}

export function formatGigabytes(gb: number | null | undefined, digits = 1): string {
  if (gb === null || gb === undefined || Number.isNaN(gb)) return '—';
  return `${gb.toFixed(digits)} GB`;
}

export function formatTemperature(celsius: number | null | undefined, digits = 1): string {
  if (celsius === null || celsius === undefined || Number.isNaN(celsius)) return '—';
  return `${celsius.toFixed(digits)} °C`;
}

/** Human readable duration, e.g. `12d 4h 31m`. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0 && days === 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${secs}s`);
  return parts.join(' ');
}

/** Compact duration used by alert rule summaries, e.g. `5m`, `2h`. */
export function formatShortDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function truncate(value: string, max = 60): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
