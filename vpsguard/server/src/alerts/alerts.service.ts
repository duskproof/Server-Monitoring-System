import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Alert,
  AlertCondition,
  AlertRule,
  AlertSeverity,
  AlertStatus,
} from '../database/entities';
import { AlertEngineService } from './alert-engine.service';
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './dto';

@Injectable()
export class AlertsService {
  constructor(
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
    private readonly engine: AlertEngineService,
  ) {}

  async listAlerts(status?: AlertStatus, serverId?: string, limit = 200) {
    const where: Record<string, any> = {};
    if (status) where.status = status;
    if (serverId) where.serverId = serverId;

    return this.alerts.find({
      where,
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  async acknowledge(id: string, userId: string) {
    const alert = await this.alerts.findOne({ where: { id } });
    if (!alert) throw new NotFoundException('Alert not found');

    alert.status = AlertStatus.ACKNOWLEDGED;
    alert.acknowledgedBy = userId;
    alert.acknowledgedAt = new Date();
    return this.alerts.save(alert);
  }

  listRules() {
    return this.rules.find({ order: { createdAt: 'DESC' } });
  }

  async createRule(dto: CreateAlertRuleDto) {
    const rule = await this.rules.save(
      this.rules.create({
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

  async updateRule(id: string, dto: UpdateAlertRuleDto) {
    const rule = await this.rules.findOne({ where: { id } });
    if (!rule) throw new NotFoundException('Alert rule not found');

    Object.assign(rule, dto);
    const saved = await this.rules.save(rule);
    this.engine.invalidateRulesCache();
    return saved;
  }

  async removeRule(id: string): Promise<void> {
    const result = await this.rules.delete({ id });
    if (!result.affected) throw new NotFoundException('Alert rule not found');
    this.engine.invalidateRulesCache();
    this.engine.forget((key) => key.startsWith(`${id}:`));
  }

  /** Seeds baseline hardware / anomaly rules (idempotent by rule name). */
  async seedDefaultRules(): Promise<void> {
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
      const existing = await this.rules.findOne({ where: { name: rule.name } });
      if (existing) continue;
      await this.rules.save(this.rules.create(rule));
      created += 1;
    }
    if (created > 0) this.engine.invalidateRulesCache();
  }
}
