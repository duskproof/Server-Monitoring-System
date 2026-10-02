/**
 * Resolves a dot-notation metric key against a raw agent payload.
 *
 * Array-backed metrics collapse to the value most likely to trigger an alert:
 * the maximum for "usage" style metrics and the minimum for "headroom" style
 * metrics (free space, certificate days left).
 */
export function extractMetric(
  metrics: Record<string, any>,
  key: string,
): { value: number; label?: string } | null {
  if (!metrics) return null;

  const numeric = (value: unknown): number | null =>
    typeof value === 'number' && Number.isFinite(value) ? value : null;

  const pickExtreme = (
    items: any[],
    field: string,
    labelField: string,
    mode: 'max' | 'min',
  ): { value: number; label?: string } | null => {
    let best: { value: number; label?: string } | null = null;
    for (const item of items ?? []) {
      const value = numeric(item?.[field]);
      if (value === null) continue;
      if (!best || (mode === 'max' ? value > best.value : value < best.value)) {
        best = { value, label: item?.[labelField] };
      }
    }
    return best;
  };

  switch (key) {
    case 'cpu.percent':
    case 'cpu.load_1m':
    case 'cpu.load_5m':
    case 'cpu.load_15m':
    case 'cpu.temperature': {
      const value = numeric(metrics.cpu?.[key.split('.')[1]]);
      return value === null ? null : { value };
    }

    case 'memory.used_percent':
    case 'memory.swap_used_percent': {
      const value = numeric(metrics.memory?.[key.split('.')[1]]);
      return value === null ? null : { value };
    }

    case 'disk.used_percent':
      return pickExtreme(metrics.disk, 'used_percent', 'mount', 'max');

    case 'disk.free_gb':
      return pickExtreme(metrics.disk, 'free_gb', 'mount', 'min');

    case 'network.rx_speed_bps':
    case 'network.tx_speed_bps': {
      const field = key.split('.')[1];
      const interfaces = Object.entries<Record<string, any>>(metrics.network ?? {});
      let best: { value: number; label?: string } | null = null;
      for (const [name, stats] of interfaces) {
        const value = numeric(stats?.[field]);
        if (value !== null && (!best || value > best.value)) best = { value, label: name };
      }
      return best;
    }

    case 'security.failed_ssh_attempts':
    case 'security.failed_ssh_last_hour': {
      const value = numeric(metrics.security?.[key.split('.')[1]]);
      return value === null ? null : { value };
    }

    case 'ssl.days_left':
      return pickExtreme(metrics.ssl, 'days_left', 'domain', 'min');

    case 'process_summary.zombie': {
      const value = numeric(metrics.process_summary?.zombie);
      return value === null ? null : { value };
    }

    default: {
      // Generic fallback for plain nested numeric paths.
      const value = numeric(
        key.split('.').reduce<any>((node, part) => (node ? node[part] : undefined), metrics),
      );
      return value === null ? null : { value };
    }
  }
}

export function compare(value: number, condition: string, threshold: number): boolean {
  switch (condition) {
    case '>':
      return value > threshold;
    case '<':
      return value < threshold;
    case '==':
      return value === threshold;
    case '!=':
      return value !== threshold;
    default:
      return false;
  }
}
