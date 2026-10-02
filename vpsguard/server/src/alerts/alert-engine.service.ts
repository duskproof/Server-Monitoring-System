import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  Alert,
  AlertRule,
  AlertStatus,
  CommandType,
  MonitoredServer,
} from '../database/entities';
import { CommandsService } from '../commands/commands.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { compare, extractMetric } from './metric-extractor';

/** Tracks how long a rule's condition has continuously held for a server. */
interface PendingState {
  since: number;
  lastValue: number;
}

@Injectable()
export class AlertEngineService {
  private readonly logger = new Logger(AlertEngineService.name);
  private readonly pending = new Map<string, PendingState>();
  private rulesCache: AlertRule[] = [];
  private rulesCacheExpiry = 0;

  constructor(
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    private readonly notifications: NotificationsService,
    private readonly commands: CommandsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  invalidateRulesCache(): void {
    this.rulesCacheExpiry = 0;
  }

  /** Rules change rarely, so they are cached for a few seconds to keep ingest fast. */
  private async getRules(): Promise<AlertRule[]> {
    if (Date.now() < this.rulesCacheExpiry) return this.rulesCache;
    this.rulesCache = await this.rules.find({ where: { enabled: true } });
    this.rulesCacheExpiry = Date.now() + 10_000;
    return this.rulesCache;
  }

  /** Evaluates every applicable rule against a freshly ingested metrics packet. */
  async evaluate(server: MonitoredServer, metrics: Record<string, any>): Promise<void> {
    const rules = await this.getRules();

    for (const rule of rules) {
      if (rule.serverId && rule.serverId !== server.id) continue;
      if (rule.groupId && rule.groupId !== server.groupId) continue;
      if (rule.metric === 'agent.offline') continue; // handled by the heartbeat scheduler

      const extracted = extractMetric(metrics, rule.metric);
      if (!extracted) continue;

      const key = `${rule.id}:${server.id}`;
      const breached = compare(extracted.value, rule.condition, rule.threshold);

      if (!breached) {
        this.pending.delete(key);
        await this.resolveIfOpen(rule, server);
        continue;
      }

      const state = this.pending.get(key);
      if (!state) {
        this.pending.set(key, { since: Date.now(), lastValue: extracted.value });
        continue;
      }
      state.lastValue = extracted.value;

      const heldForSeconds = (Date.now() - state.since) / 1000;
      if (heldForSeconds < rule.durationSeconds) continue;

      await this.fire(rule, server, extracted.value, extracted.label);
    }
  }

  /** Creates and dispatches an alert, unless an identical one is already open. */
  async fire(
    rule: AlertRule,
    server: MonitoredServer,
    value: number,
    label?: string,
  ): Promise<void> {
    const dedupKey = `${rule.id}:${server.id}`;
    const open = await this.alerts.findOne({
      where: [
        { dedupKey, status: AlertStatus.FIRING },
        { dedupKey, status: AlertStatus.ACKNOWLEDGED },
      ],
    });
    if (open) return;

    const target = label ? ` on ${label}` : '';
    const alert = await this.alerts.save(
      this.alerts.create({
        ruleId: rule.id,
        ruleName: rule.name,
        serverId: server.id,
        serverName: server.name,
        metric: rule.metric,
        severity: rule.severity,
        status: AlertStatus.FIRING,
        value,
        threshold: rule.threshold,
        dedupKey,
        message:
          `${rule.metric}${target} is ${value.toFixed(2)} ` +
          `(condition ${rule.condition} ${rule.threshold} held for ${rule.durationSeconds}s)`,
      }),
    );

    this.logger.warn(`Alert firing: ${rule.name} on ${server.name} (${value.toFixed(2)})`);
    this.realtime.emitAlert(alert);
    await this.notifications.dispatch(alert, rule.channels ?? []);

    if (rule.autoHealCommand?.type) {
      await this.triggerSelfHealing(rule, server);
    }
  }

  /** Queues the rule's remediation command on the agent (self-healing). */
  private async triggerSelfHealing(rule: AlertRule, server: MonitoredServer): Promise<void> {
    try {
      await this.commands.create(
        server.id,
        rule.autoHealCommand.type as CommandType,
        rule.autoHealCommand.args ?? {},
        null,
      );
      this.logger.log(
        `Self-healing queued for ${server.name}: ${rule.autoHealCommand.type}`,
      );
    } catch (error) {
      this.logger.error(`Self-healing failed to queue: ${(error as Error).message}`);
    }
  }

  private async resolveIfOpen(rule: AlertRule, server: MonitoredServer): Promise<void> {
    const dedupKey = `${rule.id}:${server.id}`;
    const open = await this.alerts.find({
      where: [
        { dedupKey, resolvedAt: IsNull(), status: AlertStatus.FIRING },
        { dedupKey, resolvedAt: IsNull(), status: AlertStatus.ACKNOWLEDGED },
      ],
    });
    if (open.length === 0) return;

    for (const alert of open) {
      alert.status = AlertStatus.RESOLVED;
      alert.resolvedAt = new Date();
      await this.alerts.save(alert);
      this.realtime.emitAlert(alert);
      await this.notifications.dispatch(alert, rule.channels ?? []);
      this.logger.log(`Alert resolved: ${rule.name} on ${server.name}`);
    }
  }

  /** Clears in-memory pending state for a deleted server or rule. */
  forget(predicate: (key: string) => boolean): void {
    for (const key of this.pending.keys()) {
      if (predicate(key)) this.pending.delete(key);
    }
  }
}
