export interface AppConfig {
  env: string;
  port: number;
  apiPrefix: string;
  corsOrigins: string[];
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
};

export default () => ({
  app: {
    env: process.env.NODE_ENV ?? 'development',
    port: toInt(process.env.PORT, 4000),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    /** Public base URL agents use (also used in generated install commands). */
    publicApiUrl: process.env.PUBLIC_API_URL ?? '',
  },
  postgres: {
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: toInt(process.env.POSTGRES_PORT, 5432),
    username: process.env.POSTGRES_USER ?? 'vpsguard',
    password: process.env.POSTGRES_PASSWORD ?? 'vpsguard',
    database: process.env.POSTGRES_DB ?? 'vpsguard',
    synchronize: toBool(process.env.POSTGRES_SYNCHRONIZE, true),
  },
  influx: {
    url: process.env.INFLUX_URL ?? 'http://localhost:8086',
    token: process.env.INFLUX_TOKEN ?? '',
    org: process.env.INFLUX_ORG ?? 'vpsguard',
    bucket: process.env.INFLUX_BUCKET ?? 'metrics',
    retentionDays: toInt(process.env.INFLUX_RETENTION_DAYS, 30),
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? 'dev-refresh-secret',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '7d',
  },
  agent: {
    offlineAfterSeconds: toInt(process.env.AGENT_OFFLINE_AFTER_SECONDS, 120),
  },
  notifications: {
    telegram: {
      botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
      chatId: process.env.TELEGRAM_CHAT_ID ?? '',
    },
    slack: { webhookUrl: process.env.SLACK_WEBHOOK_URL ?? '' },
    smtp: {
      host: process.env.SMTP_HOST ?? '',
      port: toInt(process.env.SMTP_PORT, 587),
      user: process.env.SMTP_USER ?? '',
      password: process.env.SMTP_PASSWORD ?? '',
      from: process.env.SMTP_FROM ?? 'vpsguard@example.com',
    },
  },
  ssh: {
    defaultPort: toInt(process.env.SSH_DEFAULT_PORT, 22),
    defaultUser: process.env.SSH_DEFAULT_USER ?? 'root',
  },
});
