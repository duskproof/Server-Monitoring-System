import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AlertEngineService } from '../alerts/alert-engine.service';
import { CommandsService } from '../commands/commands.service';
import { AlertRule, MonitoredServer, ServerStatus } from '../database/entities';
import { InfluxService } from '../influx/influx.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ServersService } from '../servers/servers.service';

/** Predictive disk alerts fire this many days before the projected fill-up. */
const DISK_FORECAST_WARNING_DAYS = 3;

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectRepository(MonitoredServer) private readonly serversRepo: Repository<MonitoredServer>,
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
    private readonly servers: ServersService,
    private readonly commands: CommandsService,
    private readonly alertEngine: AlertEngineService,
    private readonly influx: InfluxService,
    private readonly realtime: RealtimeGateway,
    private readonly config: ConfigService,
  ) {}

  /** Detects agents that stopped sending heartbeats and raises offline alerts. */
  @Cron(CronExpression.EVERY_30_SECONDS)
  async detectOfflineAgents(): Promise<void> {
    const offlineAfter = this.config.get<number>('agent.offlineAfterSeconds');
    const wentOffline = await this.servers.markStaleOffline(offlineAfter);

    if (wentOffline.length === 0) return;

    const offlineRules = await this.rules.find({
      where: { metric: 'agent.offline', enabled: true },
    });

    for (const server of wentOffline) {
      this.logger.warn(`Server ${server.name} went offline`);
      this.realtime.emitServerStatus(server.id, ServerStatus.OFFLINE);

      for (const rule of offlineRules) {
        if (!rule.organizationId || !server.organizationId || rule.organizationId !== server.organizationId) {
          continue;
        }
        if (rule.serverId && rule.serverId !== server.id) continue;
        if (rule.groupId && rule.groupId !== server.groupId) continue;
        await this.alertEngine.fire(rule, server, 1);
      }
    }
  }

  /** Broadcasts per-cabinet counters to dashboards subscribed to their overview room. */
  @Cron(CronExpression.EVERY_10_SECONDS)
  async pushOverview(): Promise<void> {
    try {
      const orgIds = await this.serversRepo
        .createQueryBuilder('server')
        .select('DISTINCT server.organization_id', 'organizationId')
        .where('server.organization_id IS NOT NULL')
        .getRawMany<{ organizationId: string }>();
      for (const row of orgIds) {
        if (!row.organizationId) continue;
        this.realtime.emitOverview(
          row.organizationId,
          await this.servers.overview(row.organizationId),
        );
      }
    } catch (error) {
      this.logger.debug(`Overview broadcast skipped: ${(error as Error).message}`);
    }
  }

  /** Marks commands that were dispatched but never acknowledged as timed out. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async expireStaleCommands(): Promise<void> {
    const expired = await this.commands.expireStale();
    if (expired > 0) this.logger.warn(`Expired ${expired} stale command(s)`);
  }

  /**
   * Predictive disk alerting: projects the current fill trend forward and warns
   * when a filesystem is expected to reach 100 % within the warning window.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async forecastDiskExhaustion(): Promise<void> {
    const online = await this.serversRepo.find({ where: { status: ServerStatus.ONLINE } });
    const forecastRules = await this.rules.find({
      where: { metric: 'disk.forecast_days', enabled: true },
    });
    if (forecastRules.length === 0) return;

    for (const server of online) {
      const hours = await this.influx.forecastHoursToThreshold(
        server.id,
        'disk.used_percent',
        100,
      );
      if (hours === null) continue;

      const days = hours / 24;
      if (days > DISK_FORECAST_WARNING_DAYS) continue;

      for (const rule of forecastRules) {
        if (!rule.organizationId || !server.organizationId || rule.organizationId !== server.organizationId) {
          continue;
        }
        if (rule.serverId && rule.serverId !== server.id) continue;
        if (rule.groupId && rule.groupId !== server.groupId) continue;
        await this.alertEngine.fire(rule, server, Number(days.toFixed(2)));
      }
      this.logger.warn(
        `Disk on ${server.name} is projected to fill in ${days.toFixed(1)} day(s)`,
      );
    }
  }
}
