import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as nodemailer from 'nodemailer';
import { Repository } from 'typeorm';
import { Alert, Integration, IntegrationType } from '../database/entities';

/** Telegram hard-limits a message to 4096 UTF-8 characters. */
const TELEGRAM_MAX_LENGTH = 4096;

const SEVERITY_ICON: Record<string, string> = {
  info: 'INFO',
  warning: 'WARNING',
  critical: 'CRITICAL',
};

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectRepository(Integration) private readonly integrations: Repository<Integration>,
    private readonly config: ConfigService,
  ) {}

  /** Fans an alert out to every requested channel; individual failures are isolated. */
  async dispatch(
    alert: Alert,
    channels: string[],
    organizationId?: string | null,
  ): Promise<void> {
    const targets = channels.length > 0 ? channels : ['telegram'];
    const message = this.renderAlert(alert);

    await Promise.allSettled(
      targets.map(async (channel) => {
        try {
          switch (channel) {
            case 'telegram':
              return await this.sendTelegram(message, organizationId);
            case 'slack':
              return await this.sendSlack(message, organizationId);
            case 'email':
              return await this.sendEmail(
                `[${alert.severity}] ${alert.ruleName}`,
                message,
                organizationId,
              );
            case 'webhook':
              return await this.sendWebhook(alert, organizationId);
            default:
              this.logger.warn(`Unknown notification channel "${channel}"`);
          }
        } catch (error) {
          this.logger.error(`Channel "${channel}" failed: ${(error as Error).message}`);
        }
      }),
    );
  }

  async sendTest(
    channel: string,
    organizationId?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const text = 'VPSGuard test notification. If you can read this, the channel works.';
    try {
      switch (channel) {
        case 'telegram':
          await this.sendTelegram(text, organizationId);
          break;
        case 'slack':
          await this.sendSlack(text, organizationId);
          break;
        case 'email':
          await this.sendEmail('VPSGuard test notification', text, organizationId);
          break;
        case 'webhook':
          await this.sendWebhook({ test: true, message: text } as any, organizationId);
          break;
        default:
          return { ok: false, message: `Unknown channel "${channel}"` };
      }
      return { ok: true, message: 'Test notification sent' };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  }

  private renderAlert(alert: Alert): string {
    const status = alert.status === 'resolved' ? 'RESOLVED' : 'FIRING';
    const lines = [
      `${status} - ${SEVERITY_ICON[alert.severity] ?? alert.severity}`,
      `Rule: ${alert.ruleName}`,
      `Server: ${alert.serverName}`,
      `Metric: ${alert.metric}`,
      `Value: ${Number(alert.value).toFixed(2)} (threshold ${alert.threshold})`,
      `Time: ${new Date(alert.createdAt ?? Date.now()).toISOString()}`,
      '',
      alert.message,
    ];
    const text = lines.join('\n');
    return text.length > TELEGRAM_MAX_LENGTH
      ? `${text.slice(0, TELEGRAM_MAX_LENGTH - 3)}...`
      : text;
  }

  private async resolveConfig(
    type: IntegrationType,
    organizationId?: string | null,
  ): Promise<Record<string, any> | null> {
    const where: Record<string, any> = { type, enabled: true };
    if (organizationId) where.organizationId = organizationId;
    const integration = await this.integrations.findOne({ where });
    return integration?.config ?? null;
  }

  private async sendTelegram(text: string, organizationId?: string | null): Promise<void> {
    const stored = await this.resolveConfig(IntegrationType.TELEGRAM, organizationId);
    const botToken = stored?.botToken || this.config.get<string>('notifications.telegram.botToken');
    const chatId = stored?.chatId || this.config.get<string>('notifications.telegram.chatId');
    if (!botToken || !chatId) throw new Error('Telegram bot token or chat ID is not configured');

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    });
    if (!response.ok) {
      throw new Error(`Telegram API responded ${response.status}: ${await response.text()}`);
    }
  }

  private async sendSlack(text: string, organizationId?: string | null): Promise<void> {
    const stored = await this.resolveConfig(IntegrationType.SLACK, organizationId);
    const webhookUrl = stored?.webhookUrl || this.config.get<string>('notifications.slack.webhookUrl');
    if (!webhookUrl) throw new Error('Slack webhook URL is not configured');

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) throw new Error(`Slack webhook responded ${response.status}`);
  }

  private async sendEmail(
    subject: string,
    text: string,
    organizationId?: string | null,
  ): Promise<void> {
    const stored = await this.resolveConfig(IntegrationType.EMAIL, organizationId);
    const smtp = {
      host: stored?.host || this.config.get<string>('notifications.smtp.host'),
      port: stored?.port || this.config.get<number>('notifications.smtp.port'),
      user: stored?.user || this.config.get<string>('notifications.smtp.user'),
      password: stored?.password || this.config.get<string>('notifications.smtp.password'),
      from: stored?.from || this.config.get<string>('notifications.smtp.from'),
      to: stored?.to,
    };
    if (!smtp.host || !smtp.to) throw new Error('SMTP host or recipient is not configured');

    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465,
      auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
    });
    await transport.sendMail({ from: smtp.from, to: smtp.to, subject, text });
  }

  private async sendWebhook(payload: unknown, organizationId?: string | null): Promise<void> {
    const stored = await this.resolveConfig(IntegrationType.WEBHOOK, organizationId);
    if (!stored?.url) throw new Error('Webhook URL is not configured');

    const response = await fetch(stored.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(stored.headers ?? {}) },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`Webhook responded ${response.status}`);
  }
}
