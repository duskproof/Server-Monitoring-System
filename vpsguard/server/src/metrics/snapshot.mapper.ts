/**
 * Maps agent snake_case snapshot documents into the camelCase envelopes the
 * dashboard tabs expect. Detail endpoints return whole documents (not Influx
 * series), so this lives next to the metrics controller.
 */

function mbToBytes(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 1024 * 1024) : 0;
}

function asArray(value: unknown): any[] {
  return Array.isArray(value) ? value : [];
}

function num(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function str(value: unknown, fallback = ''): string {
  return value === undefined || value === null ? fallback : String(value);
}

export function mapProcesses(raw: unknown, summary?: unknown) {
  const processes = asArray(raw).map((item) => ({
    pid: num(item.pid),
    name: str(item.name, 'unknown'),
    user: str(item.user, 'unknown'),
    cpuPercent: num(item.cpu_percent ?? item.cpuPercent),
    memoryPercent: num(item.mem_percent ?? item.memory_percent ?? item.memoryPercent),
    memoryBytes: item.memoryBytes !== undefined ? num(item.memoryBytes) : mbToBytes(item.mem_rss_mb),
    state: str(item.status ?? item.state, 'unknown'),
    command: str(item.command ?? item.cmdline ?? item.name),
  }));

  const summaryObj = summary && typeof summary === 'object' ? (summary as Record<string, any>) : {};

  return {
    collectedAt: new Date().toISOString(),
    totalCount: num(summaryObj.total, processes.length),
    zombieCount: num(summaryObj.zombie, 0),
    processes,
  };
}

export function mapDocker(raw: unknown) {
  const containers = asArray(raw).map((item) => {
    const status = str(item.status ?? item.state, 'unknown');
    return {
      id: str(item.container_id ?? item.id, str(item.name)),
      name: str(item.name, 'unknown'),
      image: str(item.image),
      state: status,
      status: item.health && item.health !== 'none' ? `${status} (${item.health})` : status,
      cpuPercent: num(item.cpu_percent ?? item.cpuPercent),
      memoryUsageBytes:
        item.memoryUsageBytes !== undefined ? num(item.memoryUsageBytes) : mbToBytes(item.mem_usage_mb),
      memoryLimitBytes:
        item.memoryLimitBytes !== undefined
          ? num(item.memoryLimitBytes)
          : item.mem_percent
            ? Math.round(mbToBytes(item.mem_usage_mb) / (num(item.mem_percent) / 100 || 1))
            : 0,
      networkRxBytes:
        item.networkRxBytes !== undefined ? num(item.networkRxBytes) : mbToBytes(item.net_rx_mb),
      networkTxBytes:
        item.networkTxBytes !== undefined ? num(item.networkTxBytes) : mbToBytes(item.net_tx_mb),
      blockReadBytes:
        item.blockReadBytes !== undefined ? num(item.blockReadBytes) : mbToBytes(item.block_read_mb),
      blockWriteBytes:
        item.blockWriteBytes !== undefined ? num(item.blockWriteBytes) : mbToBytes(item.block_write_mb),
      createdAt: item.createdAt ?? item.created_at ?? null,
    };
  });

  return {
    collectedAt: new Date().toISOString(),
    containers,
  };
}

export function mapServices(raw: unknown) {
  const services = asArray(raw).map((item) => ({
    name: str(item.name),
    description: item.description ?? null,
    loadState: str(item.load_state ?? item.loadState, 'loaded'),
    activeState: str(item.active ?? item.activeState, 'unknown'),
    subState: str(item.sub ?? item.subState, 'unknown'),
    enabled: Boolean(item.enabled),
    uptimeSeconds:
      item.uptime_seconds !== undefined || item.uptimeSeconds !== undefined
        ? num(item.uptime_seconds ?? item.uptimeSeconds)
        : null,
  }));

  return {
    collectedAt: new Date().toISOString(),
    services,
  };
}

export function mapTemperatures(raw: unknown) {
  const sensors = asArray(raw).map((item) => {
    const high = item.high ?? item.highCelsius;
    const critical = item.critical ?? item.criticalCelsius;
    return {
      sensor: str(item.sensor, 'unknown'),
      label: str(item.label, 'sensor'),
      celsius: num(item.current ?? item.celsius ?? item.temp),
      highCelsius: high === undefined || high === null ? null : num(high),
      criticalCelsius: critical === undefined || critical === null ? null : num(critical),
    };
  });

  return {
    collectedAt: new Date().toISOString(),
    sensors,
  };
}

export function mapSsl(raw: unknown) {
  const certificates = asArray(raw).map((item, index) => ({
    id: str(item.id, `${item.domain ?? 'cert'}:${item.port ?? 443}:${index}`),
    domain: str(item.domain),
    issuer: item.issuer ?? null,
    validFrom: item.valid_from ?? item.validFrom ?? null,
    validTo: str(item.not_after ?? item.validTo ?? item.valid_to),
    daysLeft: num(item.days_left ?? item.daysLeft),
    valid: Boolean(item.valid),
  }));

  return {
    collectedAt: new Date().toISOString(),
    certificates,
  };
}

/**
 * Agent log collector reports pattern-match aggregates with sample lines.
 * Expand those into the line-oriented rows the Logs tab renders.
 */
export function mapLogs(
  raw: unknown,
  options: { file?: string; pattern?: string; limit?: number } = {},
) {
  const aggregates = asArray(raw).filter(
    (entry) =>
      (!options.file || entry.file === options.file) &&
      (!options.pattern || String(entry.pattern ?? '').includes(options.pattern)),
  );

  const files = [...new Set(asArray(raw).map((entry) => str(entry.file)).filter(Boolean))];
  const entries: Array<{
    id: string;
    timestamp: string;
    file: string;
    level: string;
    message: string;
  }> = [];

  for (const aggregate of aggregates) {
    const file = str(aggregate.file);
    const pattern = str(aggregate.pattern, 'match');
    const level = inferLogLevel(pattern);
    const samples = asArray(aggregate.samples);
    if (samples.length === 0) {
      entries.push({
        id: `${file}:${pattern}:summary`,
        timestamp: new Date().toISOString(),
        file,
        level,
        message: `${num(aggregate.matches)} match(es) for pattern "${pattern}"`,
      });
      continue;
    }
    samples.forEach((sample, index) => {
      const message = str(sample);
      entries.push({
        id: `${file}:${pattern}:${index}:${hashLite(message)}`,
        timestamp: extractTimestamp(message) ?? new Date().toISOString(),
        file,
        level,
        message,
      });
    });
  }

  const limit = options.limit && options.limit > 0 ? options.limit : entries.length;
  const sliced = entries.slice(0, limit);

  return {
    file: options.file ?? '',
    files,
    entries: sliced,
    total: sliced.length,
  };
}

function inferLogLevel(pattern: string): string {
  const lower = pattern.toLowerCase();
  if (lower.includes('critical') || lower.includes('fatal')) return 'critical';
  if (lower.includes('error') || lower.includes('fail')) return 'error';
  if (lower.includes('warn')) return 'warning';
  if (lower.includes('denied') || lower.includes('unauthorized')) return 'warning';
  return 'info';
}

function extractTimestamp(message: string): string | null {
  const iso = message.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?/);
  if (iso) {
    const date = new Date(iso[0]);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
}

function hashLite(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}
