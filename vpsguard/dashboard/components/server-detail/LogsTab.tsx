'use client';

import { Download, FileText, RefreshCw, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useLogs } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { exportRowsAsCsv } from '@/lib/export';
import { formatDateTime } from '@/lib/format';
import type { LogLevel } from '@/lib/types';
import { cn } from '@/lib/utils';

const ROW_HEIGHT = 68;
const VIEWPORT_HEIGHT = 540;
const OVERSCAN = 6;

const LEVEL_TONE: Record<LogLevel, BadgeTone> = {
  debug: 'neutral',
  info: 'info',
  notice: 'info',
  warning: 'warning',
  error: 'danger',
  critical: 'danger',
  unknown: 'neutral',
};

const LIMIT_OPTIONS = [
  { value: '200', label: '200 lines' },
  { value: '500', label: '500 lines' },
  { value: '1000', label: '1 000 lines' },
  { value: '5000', label: '5 000 lines' },
];

const DEFAULT_FILES = ['/var/log/syslog', '/var/log/auth.log', '/var/log/nginx/error.log'];

export function LogsTab({ serverId }: { serverId: string }) {
  const [file, setFile] = useState('');
  const [pattern, setPattern] = useState('');
  const [debouncedPattern, setDebouncedPattern] = useState('');
  const [limit, setLimit] = useState('500');
  const [scrollTop, setScrollTop] = useState(0);

  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedPattern(pattern.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [pattern]);

  const query = useLogs(serverId, { file, pattern: debouncedPattern, limit: Number(limit) });

  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);

  // Reset the virtual window whenever the result set changes.
  useEffect(() => {
    setScrollTop(0);
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [file, debouncedPattern, limit]);

  const fileOptions = useMemo(() => {
    const files = query.data?.files?.length ? query.data.files : DEFAULT_FILES;
    return files.map((path) => ({ value: path, label: path }));
  }, [query.data]);

  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN);
  const endIndex = Math.min(entries.length, Math.ceil((scrollTop + VIEWPORT_HEIGHT) / ROW_HEIGHT) + OVERSCAN);
  const visible = entries.slice(startIndex, endIndex);

  const onExport = () => {
    if (entries.length === 0) {
      toast.error('There is nothing to export');
      return;
    }
    exportRowsAsCsv(
      entries.map((entry) => ({
        timestamp: entry.timestamp,
        level: entry.level,
        file: entry.file,
        message: entry.message,
      })),
      `logs-${Date.now()}.csv`,
      ['timestamp', 'level', 'file', 'message'],
    );
    toast.success('Log lines exported');
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select
          value={file}
          onChange={(event) => setFile(event.target.value)}
          placeholder="Default log file"
          options={fileOptions}
          aria-label="Log file"
        />
        <Input
          placeholder="Filter pattern (regex or text)"
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          icon={<Search className="h-4 w-4" />}
          containerClassName="lg:col-span-2"
          aria-label="Log filter pattern"
        />
        <div className="flex items-center gap-2">
          <Select
            value={limit}
            onChange={(event) => setLimit(event.target.value)}
            options={LIMIT_OPTIONS}
            containerClassName="flex-1"
            aria-label="Line limit"
          />
          <Button
            variant="outline"
            size="icon"
            onClick={() => void query.refetch()}
            title="Refresh"
            aria-label="Refresh logs"
          >
            <RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />
          </Button>
          <Button variant="outline" size="icon" onClick={onExport} title="Export CSV" aria-label="Export logs as CSV">
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {query.isLoading ? (
        <div className="space-y-2 rounded-2xl border border-line bg-surface p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-10 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState
          title="Logs unavailable"
          description={errorMessage(query.error, 'The agent could not read the requested log file.')}
          action={
            <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      ) : entries.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-5 w-5" />}
          title="No log lines"
          description={
            debouncedPattern
              ? 'No lines match this pattern in the selected file.'
              : 'The selected file is empty or the agent has not collected it yet.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5 text-xs text-muted">
            <span className="truncate font-mono">{query.data?.file || file || 'default log file'}</span>
            <span>
              {entries.length} of {query.data?.total ?? entries.length} lines
            </span>
          </div>

          {/* Windowed list: only the visible slice is mounted. */}
          <div
            ref={viewportRef}
            className="scrollbar-thin overflow-y-auto"
            style={{ height: VIEWPORT_HEIGHT }}
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
          >
            <div style={{ height: entries.length * ROW_HEIGHT, position: 'relative' }}>
              <div style={{ transform: `translateY(${startIndex * ROW_HEIGHT}px)` }}>
                {visible.map((entry, index) => (
                  <div
                    key={entry.id ?? `${startIndex + index}-${entry.timestamp}`}
                    className="flex items-start gap-3 border-b border-line px-4 py-3"
                    style={{ height: ROW_HEIGHT }}
                  >
                    <Badge tone={LEVEL_TONE[entry.level] ?? 'neutral'} className="mt-0.5 shrink-0 uppercase">
                      {entry.level}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="line-clamp-2 break-all font-mono text-xs text-content">{entry.message}</p>
                      <p className="mt-1 text-[11px] text-muted">{formatDateTime(entry.timestamp)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
