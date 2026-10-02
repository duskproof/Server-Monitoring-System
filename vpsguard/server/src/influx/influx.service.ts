import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InfluxDB, Point, QueryApi, WriteApi } from '@influxdata/influxdb-client';

export interface SeriesPoint {
  t: string;
  v: number;
}

export interface Series {
  name: string;
  points: SeriesPoint[];
}

/** Maps a dot-notation metric key to an Influx measurement and field. */
const METRIC_MAP: Record<string, { measurement: string; field: string }> = {
  'cpu.percent': { measurement: 'cpu', field: 'percent' },
  'cpu.load_1m': { measurement: 'cpu', field: 'load_1m' },
  'cpu.load_5m': { measurement: 'cpu', field: 'load_5m' },
  'cpu.load_15m': { measurement: 'cpu', field: 'load_15m' },
  'cpu.temperature': { measurement: 'cpu', field: 'temperature' },
  'memory.used_percent': { measurement: 'memory', field: 'used_percent' },
  'memory.used': { measurement: 'memory', field: 'used' },
  'memory.swap_used_percent': { measurement: 'memory', field: 'swap_used_percent' },
  'disk.used_percent': { measurement: 'disk', field: 'used_percent' },
  'disk.free_gb': { measurement: 'disk', field: 'free_gb' },
  'disk.io_read_mb': { measurement: 'disk', field: 'io_read_mb' },
  'disk.io_write_mb': { measurement: 'disk', field: 'io_write_mb' },
  'network.rx_speed_bps': { measurement: 'network', field: 'rx_speed_bps' },
  'network.tx_speed_bps': { measurement: 'network', field: 'tx_speed_bps' },
  'security.failed_ssh_attempts': { measurement: 'security', field: 'failed_ssh_attempts' },
  'ssl.days_left': { measurement: 'ssl', field: 'days_left' },
};

@Injectable()
export class InfluxService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InfluxService.name);
  private client: InfluxDB;
  private writeApi: WriteApi;
  private queryApi: QueryApi;
  private readonly bucket: string;
  private readonly org: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.get<string>('influx.bucket');
    this.org = this.config.get<string>('influx.org');
  }

  onModuleInit(): void {
    this.client = new InfluxDB({
      url: this.config.get<string>('influx.url'),
      token: this.config.get<string>('influx.token'),
    });

    this.writeApi = this.client.getWriteApi(this.org, this.bucket, 'ms', {
      // Batching keeps ingestion cheap at 1000+ metrics/sec.
      batchSize: 1000,
      flushInterval: 2000,
      maxRetries: 3,
      writeFailed: (error) => this.logger.error(`Influx write failed: ${error.message}`),
    });
    this.queryApi = this.client.getQueryApi(this.org);
    this.logger.log(`Connected to InfluxDB bucket "${this.bucket}"`);
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.writeApi?.close();
    } catch (error) {
      this.logger.warn(`Error closing Influx write API: ${(error as Error).message}`);
    }
  }

  /** Converts one agent payload into Influx points and queues them for writing. */
  writeMetrics(serverId: string, timestampMs: number, metrics: Record<string, any>): void {
    const points: Point[] = [];
    const push = (
      measurement: string,
      tags: Record<string, string>,
      fields: Record<string, unknown>,
    ) => {
      const point = new Point(measurement).timestamp(timestampMs).tag('server_id', serverId);
      for (const [key, value] of Object.entries(tags)) {
        if (value !== undefined && value !== null) point.tag(key, String(value));
      }
      let hasField = false;
      for (const [key, value] of Object.entries(fields)) {
        if (typeof value === 'number' && Number.isFinite(value)) {
          point.floatField(key, value);
          hasField = true;
        } else if (typeof value === 'boolean') {
          point.booleanField(key, value);
          hasField = true;
        } else if (typeof value === 'string' && value.length > 0) {
          point.stringField(key, value.slice(0, 255));
          hasField = true;
        }
      }
      if (hasField) points.push(point);
    };

    if (metrics.cpu) {
      const { cores, ...cpuFields } = metrics.cpu;
      push('cpu', {}, cpuFields);
      if (Array.isArray(cores)) {
        cores.forEach((value: number, index: number) =>
          push('cpu_core', { core: String(index) }, { percent: value }),
        );
      }
    }

    if (metrics.memory) push('memory', {}, metrics.memory);

    if (Array.isArray(metrics.disk)) {
      for (const disk of metrics.disk) {
        const { mount, device, fstype, ...fields } = disk;
        push('disk', { mount, device, fstype }, fields);
      }
    }

    if (metrics.network && typeof metrics.network === 'object') {
      for (const [iface, fields] of Object.entries<Record<string, any>>(metrics.network)) {
        push('network', { interface: iface }, fields);
      }
    }

    if (metrics.connections) push('connections', {}, metrics.connections);
    if (metrics.process_summary) push('process_summary', {}, metrics.process_summary);

    if (Array.isArray(metrics.docker)) {
      for (const container of metrics.docker) {
        const { container_id, name, image, ...fields } = container;
        push('docker', { container: name, image, container_id }, fields);
      }
    }

    if (Array.isArray(metrics.temperatures)) {
      for (const temp of metrics.temperatures) {
        push('temperature', { sensor: temp.sensor, label: temp.label }, {
          current: temp.current,
          high: temp.high,
          critical: temp.critical,
        });
      }
    }

    if (Array.isArray(metrics.smart)) {
      for (const drive of metrics.smart) {
        const { device, model, health, ...fields } = drive;
        push('smart', { device, model }, { ...fields, health });
      }
    }

    if (metrics.security) {
      const { open_ports, last_logins, ...fields } = metrics.security;
      push('security', {}, { ...fields, open_ports_count: open_ports?.length ?? 0 });
    }

    if (Array.isArray(metrics.ssl)) {
      for (const cert of metrics.ssl) {
        push('ssl', { domain: cert.domain }, {
          days_left: cert.days_left,
          valid: cert.valid,
        });
      }
    }

    if (Array.isArray(metrics.services)) {
      for (const service of metrics.services) {
        push('service', { name: service.name }, {
          up: service.active === 'active' ? 1 : 0,
          state: service.active,
        });
      }
    }

    for (const point of points) this.writeApi.writePoint(point);
  }

  /** Queries an aggregated time series for a metric key. */
  async querySeries(
    serverId: string,
    metricKey: string,
    from: string,
    to: string,
    interval = '1m',
  ): Promise<Series[]> {
    const mapping = METRIC_MAP[metricKey];
    if (!mapping) return [];

    // Tag used to split the result into multiple series (per mount, per interface, ...).
    const groupTag =
      mapping.measurement === 'disk'
        ? 'mount'
        : mapping.measurement === 'network'
          ? 'interface'
          : mapping.measurement === 'ssl'
            ? 'domain'
            : null;

    const flux = `
      from(bucket: "${this.bucket}")
        |> range(start: ${from}, stop: ${to})
        |> filter(fn: (r) => r._measurement == "${mapping.measurement}")
        |> filter(fn: (r) => r._field == "${mapping.field}")
        |> filter(fn: (r) => r.server_id == "${serverId}")
        |> aggregateWindow(every: ${interval}, fn: mean, createEmpty: false)
        |> yield(name: "mean")
    `;

    const buckets = new Map<string, SeriesPoint[]>();
    for await (const { values, tableMeta } of this.queryApi.iterateRows(flux)) {
      const row = tableMeta.toObject(values);
      const name = groupTag ? (row[groupTag] ?? metricKey) : metricKey;
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push({ t: row._time, v: Number(row._value) });
    }

    return [...buckets.entries()].map(([name, points]) => ({ name, points }));
  }

  /** Returns the most recent value of a metric, used by the alert engine. */
  async lastValue(serverId: string, metricKey: string): Promise<number | null> {
    const mapping = METRIC_MAP[metricKey];
    if (!mapping) return null;

    const flux = `
      from(bucket: "${this.bucket}")
        |> range(start: -10m)
        |> filter(fn: (r) => r._measurement == "${mapping.measurement}")
        |> filter(fn: (r) => r._field == "${mapping.field}")
        |> filter(fn: (r) => r.server_id == "${serverId}")
        |> last()
    `;

    for await (const { values, tableMeta } of this.queryApi.iterateRows(flux)) {
      return Number(tableMeta.toObject(values)._value);
    }
    return null;
  }

  /**
   * Linear-regression forecast used for predictive disk alerts.
   * Returns the number of hours until the metric reaches `target`, or null when
   * the trend is flat or moving away from the target.
   */
  async forecastHoursToThreshold(
    serverId: string,
    metricKey: string,
    target: number,
    lookback = '7d',
  ): Promise<number | null> {
    const mapping = METRIC_MAP[metricKey];
    if (!mapping) return null;

    const flux = `
      from(bucket: "${this.bucket}")
        |> range(start: -${lookback})
        |> filter(fn: (r) => r._measurement == "${mapping.measurement}")
        |> filter(fn: (r) => r._field == "${mapping.field}")
        |> filter(fn: (r) => r.server_id == "${serverId}")
        |> aggregateWindow(every: 1h, fn: mean, createEmpty: false)
    `;

    const samples: Array<{ x: number; y: number }> = [];
    for await (const { values, tableMeta } of this.queryApi.iterateRows(flux)) {
      const row = tableMeta.toObject(values);
      samples.push({ x: new Date(row._time).getTime() / 3_600_000, y: Number(row._value) });
    }
    if (samples.length < 6) return null;

    const n = samples.length;
    const meanX = samples.reduce((sum, s) => sum + s.x, 0) / n;
    const meanY = samples.reduce((sum, s) => sum + s.y, 0) / n;
    const numerator = samples.reduce((sum, s) => sum + (s.x - meanX) * (s.y - meanY), 0);
    const denominator = samples.reduce((sum, s) => sum + (s.x - meanX) ** 2, 0);
    if (denominator === 0) return null;

    const slope = numerator / denominator;
    const intercept = meanY - slope * meanX;
    if (Math.abs(slope) < 1e-6) return null;

    const nowX = Date.now() / 3_600_000;
    const targetX = (target - intercept) / slope;
    const hours = targetX - nowX;
    return hours > 0 && hours < 24 * 365 ? hours : null;
  }
}
