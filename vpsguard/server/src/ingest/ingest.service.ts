import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertEngineService } from '../alerts/alert-engine.service';
import { CommandsService } from '../commands/commands.service';
import { MonitoredServer, ServerStatus } from '../database/entities';
import { InfluxService } from '../influx/influx.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { IngestDto } from './dto';

@Injectable()
export class IngestService {
  private readonly logger = new Logger(IngestService.name);

  constructor(
    @InjectRepository(MonitoredServer) private readonly servers: Repository<MonitoredServer>,
    private readonly influx: InfluxService,
    private readonly alertEngine: AlertEngineService,
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigService,
  ) {}

  /**
   * Handles one metrics packet: persists the time series, refreshes the server
   * snapshot, evaluates alert rules and hands back any pending agent commands.
   */
  async ingest(server: MonitoredServer, dto: IngestDto, remoteIp?: string) {
    const timestampMs = (dto.timestamp ?? Math.floor(Date.now() / 1000)) * 1000;
    const metrics = dto.metrics ?? {};

    this.influx.writeMetrics(server.id, timestampMs, metrics);

    const snapshot = this.buildSnapshot(metrics);
    const wasOffline = server.status !== ServerStatus.ONLINE;

    await this.servers.update(
      { id: server.id },
      {
        status: ServerStatus.ONLINE,
        lastSeen: new Date(),
        hostname: dto.hostname ?? server.hostname,
        agentVersion: dto.agent_version ?? server.agentVersion,
        osInfo: dto.os_info ?? server.osInfo,
        ipAddress: remoteIp ?? server.ipAddress,
        uptimeSeconds: dto.uptime_seconds ?? server.uptimeSeconds,
        latestMetrics: snapshot,
        rawSnapshot: this.buildRawSnapshot(metrics),
      },
    );

    if (wasOffline) {
      this.realtime.emitServerStatus(server.id, ServerStatus.ONLINE);
      this.logger.log(`Server ${server.name} is back online`);
    }

    this.realtime.emitMetrics(server.id, timestampMs, metrics);

    // Alert evaluation must never block or fail the ingest path.
    void this.alertEngine
      .evaluate({ ...server, latestMetrics: snapshot }, metrics)
      .catch((error) => this.logger.error(`Alert evaluation failed: ${error.message}`));

    const pending = await this.commands.claimPending(server.id);

    return { status: 'ok', server_id: server.id, commands: pending };
  }

  /** Flattens the payload into the small snapshot rendered in list views. */
  private buildSnapshot(metrics: Record<string, any>): Record<string, any> {
    const disks: any[] = Array.isArray(metrics.disk) ? metrics.disk : [];
    const worstDisk = disks.reduce(
      (worst, disk) =>
        typeof disk?.used_percent === 'number' && disk.used_percent > worst ? disk.used_percent : worst,
      0,
    );

    const interfaces = Object.values<Record<string, any>>(metrics.network ?? {});
    const sum = (field: string) =>
      interfaces.reduce((total, iface) => total + (Number(iface?.[field]) || 0), 0);

    return {
      cpuPercent: Number(metrics.cpu?.percent ?? 0),
      load1m: Number(metrics.cpu?.load_1m ?? 0),
      cpuTemperature: Number(metrics.cpu?.temperature ?? 0),
      memoryUsedPercent: Number(metrics.memory?.used_percent ?? 0),
      swapUsedPercent: Number(metrics.memory?.swap_used_percent ?? 0),
      diskUsedPercent: Number(worstDisk.toFixed?.(1) ?? worstDisk),
      networkRxBps: sum('rx_speed_bps'),
      networkTxBps: sum('tx_speed_bps'),
      processCount: Number(metrics.process_summary?.total ?? 0),
      dockerCount: Array.isArray(metrics.docker) ? metrics.docker.length : 0,
    };
  }

  /**
   * Keeps the document-style sections that the detail tabs render. These are not
   * numeric series, so InfluxDB is a poor fit and the newest copy is enough.
   */
  private buildRawSnapshot(metrics: Record<string, any>): Record<string, any> {
    return {
      processes: metrics.processes ?? [],
      process_summary: metrics.process_summary ?? null,
      docker: metrics.docker ?? [],
      services: metrics.services ?? [],
      temperatures: metrics.temperatures ?? [],
      smart: metrics.smart ?? [],
      security: metrics.security ?? null,
      ssl: metrics.ssl ?? [],
      logs: metrics.logs ?? [],
      disk: metrics.disk ?? [],
      network: metrics.network ?? {},
      connections: metrics.connections ?? null,
    };
  }

  /** Returns the latest raw sub-section of a server's metrics for detail tabs. */
  async latestSection(serverId: string, section: string) {
    const server = await this.servers.findOne({ where: { id: serverId } });
    return (server?.rawSnapshot as any)?.[section] ?? null;
  }
}
