import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  Alert,
  AlertRule,
  AlertStatus,
  MonitoredServer,
} from '../database/entities';
import { AlertEngineService } from './alert-engine.service';
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './dto';

/** Names previously auto-injected on register/bootstrap — never seed these again. */
const LEGACY_AUTO_SEED_RULE_NAMES = [
  'High CPU usage',
  'High memory usage',
  'Low disk space',
  'Agent offline',
  'SSL certificate expiring',
  'Disk projected to fill within 3 days',
  'CPU temperature high',
  'Failed SSH attempts spike',
];

@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
    private readonly engine: AlertEngineService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.purgeLegacyAutoSeededRules();
  }

  /**
   * Removes the old “default 8 rules” that were auto-created for every cabinet.
   * Workspaces stay empty until the owner creates their own rules.
   */
  private async purgeLegacyAutoSeededRules(): Promise<void> {
    const result = await this.rules.delete({
      name: In(LEGACY_AUTO_SEED_RULE_NAMES),
    });
    const orphans = await this.rules.delete({ organizationId: IsNull() });
    const removed = (result.affected ?? 0) + (orphans.affected ?? 0);
    if (removed > 0) {
      this.engine.invalidateRulesCache();
      this.logger.warn(`Removed ${removed} legacy auto-seeded / orphan alert rule(s)`);
    }
  }

  async listAlerts(organizationId: string, status?: AlertStatus, serverId?: string, limit = 200) {
    const qb = this.alerts
      .createQueryBuilder('alert')
      .innerJoin(MonitoredServer, 'server', 'server.id = alert.server_id')
      .where('server.organization_id = :organizationId', { organizationId })
      .orderBy('alert.created_at', 'DESC')
      .take(Math.min(limit, 500));

    if (status) qb.andWhere('alert.status = :status', { status });
    if (serverId) qb.andWhere('alert.server_id = :serverId', { serverId });

    return qb.getMany();
  }

  async acknowledge(organizationId: string, id: string, userId: string) {
    const alert = await this.alerts
      .createQueryBuilder('alert')
      .innerJoin(MonitoredServer, 'server', 'server.id = alert.server_id')
      .where('alert.id = :id', { id })
      .andWhere('server.organization_id = :organizationId', { organizationId })
      .getOne();
    if (!alert) throw new NotFoundException('Alert not found');

    alert.status = AlertStatus.ACKNOWLEDGED;
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = new Date();
    return this.alerts.save(alert);
  }

  listRules(organizationId: string) {
    return this.rules.find({
      where: { organizationId },
      order: { createdAt: 'DESC' },
    });
  }

  async createRule(organizationId: string, dto: CreateAlertRuleDto) {
    const rule = await this.rules.save(
      this.rules.create({
        organizationId,
        name: dto.name,
        serverId: dto.serverId ?? null,
        groupId: dto.groupId ?? null,
        metric: dto.metric,
        condition: dto.condition,
        threshold: dto.threshold,
        durationSeconds: dto.durationSeconds ?? 60,
        severity: dto.severity,
        channels: dto.channels ?? [],
        enabled: dto.enabled ?? true,
        autoHealCommand: dto.autoHealCommand ?? null,
      }),
    );
    this.engine.invalidateRulesCache();
    return rule;
  }

  async updateRule(organizationId: string, id: string, dto: UpdateAlertRuleDto) {
    const rule = await this.rules.findOne({ where: { id, organizationId } });
    if (!rule) throw new NotFoundException('Alert rule not found');

    Object.assign(rule, dto);
    const saved = await this.rules.save(rule);
    this.engine.invalidateRulesCache();
    return saved;
  }

  async removeRule(organizationId: string, id: string): Promise<void> {
    const result = await this.rules.delete({ id, organizationId });
    if (!result.affected) throw new NotFoundException('Alert rule not found');
    this.engine.invalidateRulesCache();
    this.engine.forget((key) => key.startsWith(`${id}:`));
  }
}
