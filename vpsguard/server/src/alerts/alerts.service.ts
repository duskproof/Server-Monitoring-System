import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Alert,
  AlertCondition,
  AlertRule,
  AlertSeverity,
  AlertStatus,
  MonitoredServer,
  Organization,
} from '../database/entities';
import { AlertEngineService } from './alert-engine.service';
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './dto';

@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    private readonly engine: AlertEngineService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Backfill recommended baseline rules for every workspace (idempotent by name).
    const organizations = await this.orgs.find();
    for (const org of organizations) {
      await this.seedDefaultRules(org.id);
    }
  }

  async listAlerts(organizationId: string, status?: AlertStatus, serverId?: string, limit = 200) {
    const qb = this.alerts
      .createQueryBuilder('alert')
      .innerJoin(MonitoredServer, 'server', 'server.id = alert.server_id')
      .where('server.organization_id = :organizationId', { organizationId })
      .orderBy('alert.created_at', 'DESC')
      .take(Math.min(Math.max(limit || 200, 1), 500));

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

  /**
   * Recommended baseline for every workspace: load, capacity, agent health,
   * SSL and basic security. Idempotent per organization + rule name.
   */
  async seedDefaultRules(organizationId: string): Promise<void> {
    const defaults = [
      {
        name: 'High CPU usage',
        metric: 'cpu.percent',
        condition: AlertCondition.GT,
        threshold: 90,
        durationSeconds: 300,
        severity: AlertSeverity.CRITICAL,
        channels: ['telegram'],
      },
      {
        name: 'High memory usage',
        metric: 'memory.used_percent',
        condition: AlertCondition.GT,
        threshold: 90,
        durationSeconds: 300,
        severity: AlertSeverity.WARNING,
        channels: ['telegram'],
      },
      {
        name: 'Low disk space',
        metric: 'disk.used_percent',
        condition: AlertCondition.GT,
        threshold: 85,
        durationSeconds: 600,
        severity: AlertSeverity.WARNING,
        channels: ['telegram'],
      },
      {
        name: 'Agent offline',
        metric: 'agent.offline',
        condition: AlertCondition.EQ,
        threshold: 1,
        durationSeconds: 0,
        severity: AlertSeverity.CRITICAL,
        channels: ['telegram'],
      },
      {
        name: 'SSL certificate expiring',
        metric: 'ssl.days_left',
        condition: AlertCondition.LT,
        threshold: 14,
        durationSeconds: 0,
        severity: AlertSeverity.WARNING,
        channels: ['telegram'],
      },
      {
        name: 'Disk projected to fill within 3 days',
        metric: 'disk.forecast_days',
        condition: AlertCondition.LT,
        threshold: 3,
        durationSeconds: 0,
        severity: AlertSeverity.WARNING,
        channels: ['telegram'],
      },
      {
        name: 'CPU temperature high',
        metric: 'cpu.temperature',
        condition: AlertCondition.GT,
        threshold: 80,
        durationSeconds: 60,
        severity: AlertSeverity.WARNING,
        channels: ['telegram'],
      },
      {
        name: 'Failed SSH attempts spike',
        metric: 'security.failed_ssh_attempts',
        condition: AlertCondition.GT,
        threshold: 20,
        durationSeconds: 300,
        severity: AlertSeverity.CRITICAL,
        channels: ['telegram'],
      },
    ];

    let created = 0;
    for (const rule of defaults) {
      const existing = await this.rules.findOne({
        where: { name: rule.name, organizationId },
      });
      if (existing) continue;
      await this.rules.save(this.rules.create({ ...rule, organizationId }));
      created += 1;
    }
    if (created > 0) {
      this.engine.invalidateRulesCache();
      this.logger.log(`Seeded ${created} baseline alert rule(s) for workspace ${organizationId}`);
    }
  }
}
