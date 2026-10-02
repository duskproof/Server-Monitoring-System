/**
 * Shared domain types mirroring the VPSGuard REST API contract.
 */

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

export type Role = 'admin' | 'operator' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  createdAt: string;
  lastLoginAt?: string | null;
}

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

export interface LoginPayload {
  email: string;
  password: string;
}

export interface RegisterPayload {
  email: string;
  password: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/* Servers                                                             */
/* ------------------------------------------------------------------ */

export type ServerStatus = 'online' | 'offline' | 'warning';

export interface LatestMetrics {
  cpuPercent: number;
  memoryUsedPercent: number;
  diskUsedPercent: number;
  load1m: number;
  networkRxBps: number;
  networkTxBps: number;
}

export interface Server {
  id: string;
  name: string;
  hostname: string | null;
  ipAddress: string | null;
  status: ServerStatus;
  groupId: string | null;
  groupName: string | null;
  lastSeen: string | null;
  agentVersion: string | null;
  osInfo: string | null;
  uptimeSeconds: number | null;
  latestMetrics?: LatestMetrics;
}

/** Response of `POST /api/v1/servers` — contains the one-time agent credentials. */
export interface CreatedServer extends Server {
  apiKey: string;
  installCommand?: string | null;
}

export interface ServerQuery {
  group?: string;
  status?: ServerStatus | '';
  search?: string;
}

export interface ServerGroup {
  id: string;
  name: string;
  description: string | null;
  serverCount: number;
}

/* ------------------------------------------------------------------ */
/* Metrics                                                             */
/* ------------------------------------------------------------------ */

export interface MetricPoint {
  /** ISO timestamp or epoch milliseconds, depending on the backend build. */
  t: string | number;
  v: number;
}

export interface MetricSeries {
  name: string;
  points: MetricPoint[];
}

export interface MetricsResponse {
  series: MetricSeries[];
}

export type MetricGroup = 'cpu' | 'memory' | 'disk' | 'network';

export type TimeRangeKey = '1h' | '6h' | '24h' | '7d' | '30d';

/** Union of every metric selectable inside an alert rule. */
export type AlertMetric =
  | 'cpu.percent'
  | 'cpu.load_1m'
  | 'cpu.temperature'
  | 'memory.used_percent'
  | 'memory.swap_used_percent'
  | 'disk.used_percent'
  | 'disk.free_gb'
  | 'network.rx_speed_bps'
  | 'network.tx_speed_bps'
  | 'security.failed_ssh_attempts'
  | 'ssl.days_left'
  | 'disk.forecast_days'
  | 'agent.offline';

/* ------------------------------------------------------------------ */
/* Processes / Docker / Services / Logs / Temperatures / SSL           */
/* ------------------------------------------------------------------ */

export interface ProcessInfo {
  pid: number;
  name: string;
  user: string;
  cpuPercent: number;
  memoryPercent: number;
  memoryBytes: number;
  state: string;
  command: string;
}

export interface ProcessSnapshot {
  collectedAt: string | null;
  totalCount: number;
  zombieCount: number;
  processes: ProcessInfo[];
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  cpuPercent: number;
  memoryUsageBytes: number;
  memoryLimitBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  blockReadBytes: number;
  blockWriteBytes: number;
  createdAt: string | null;
}

export interface DockerSnapshot {
  collectedAt: string | null;
  containers: DockerContainer[];
}

export interface SystemdService {
  name: string;
  description: string | null;
  loadState: string;
  activeState: string;
  subState: string;
  enabled: boolean;
  uptimeSeconds: number | null;
}

export interface ServicesSnapshot {
  collectedAt: string | null;
  services: SystemdService[];
}

export type LogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'unknown';

export interface LogEntry {
  id: string;
  timestamp: string;
  file: string;
  level: LogLevel;
  message: string;
}

export interface LogsResponse {
  file: string;
  files: string[];
  entries: LogEntry[];
  total: number;
}

export interface TemperatureSensor {
  sensor: string;
  label: string;
  celsius: number;
  highCelsius: number | null;
  criticalCelsius: number | null;
}

export interface TemperaturesSnapshot {
  collectedAt: string | null;
  sensors: TemperatureSensor[];
}

export interface SslCertificate {
  id: string;
  domain: string;
  issuer: string | null;
  validFrom: string | null;
  validTo: string;
  daysLeft: number;
  valid: boolean;
}

export interface SslSnapshot {
  collectedAt: string | null;
  certificates: SslCertificate[];
}

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus = 'firing' | 'acknowledged' | 'resolved';
export type AlertCondition = '>' | '<' | '==' | '!=';

export interface Alert {
  id: string;
  ruleId: string;
  ruleName: string;
  serverId: string;
  serverName: string;
  metric: string;
  severity: AlertSeverity;
  status: AlertStatus;
  value: number;
  threshold: number;
  message: string;
  createdAt: string;
  resolvedAt: string | null;
  acknowledgedBy: string | null;
}

export interface AlertRule {
  id: string;
  name: string;
  serverId: string | null;
  groupId: string | null;
  metric: string;
  condition: AlertCondition;
  threshold: number;
  durationSeconds: number;
  severity: AlertSeverity;
  channels: string[];
  enabled: boolean;
}

export type AlertRuleInput = Omit<AlertRule, 'id'>;

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export type CommandStatus = 'pending' | 'running' | 'success' | 'failed' | 'timeout';

export interface RemoteCommand {
  id: string;
  serverId: string;
  type: string;
  args: Record<string, unknown>;
  status: CommandStatus;
  output: string | null;
  exitCode: number | null;
  requestedBy: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface CommandPayload {
  serverId: string;
  type: string;
  args: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* Integrations / Users / Audit                                        */
/* ------------------------------------------------------------------ */

export type IntegrationType = 'telegram' | 'slack' | 'email' | 'webhook';

export interface Integration {
  id: string;
  type: IntegrationType;
  enabled: boolean;
  config: Record<string, string>;
  updatedAt: string | null;
}

export interface IntegrationInput {
  type: IntegrationType;
  enabled: boolean;
  config: Record<string, string>;
  /** When true the backend sends a test notification instead of persisting. */
  test?: boolean;
}

export interface UserInput {
  email: string;
  name: string;
  role: Role;
  password?: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  details?: Record<string, unknown>;
  resource?: string;
  resourceId?: string | null;
  ipAddress?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

export interface Overview {
  serverCount: number;
  onlineCount: number;
  offlineCount: number;
  firingAlerts: number;
  avgCpu: number;
  avgMemory: number;
  avgDisk: number;
}

/* ------------------------------------------------------------------ */
/* Realtime payloads                                                   */
/* ------------------------------------------------------------------ */

export interface LiveMetricsPayload {
  serverId: string;
  timestamp: string;
  metrics: Partial<LatestMetrics> & Record<string, number | undefined>;
}

export interface ServerStatusPayload {
  serverId: string;
  status: ServerStatus;
}

export interface AlertPayload {
  alert: Alert;
}

export interface TerminalReadyPayload {
  sessionId: string;
}

export interface TerminalOutputPayload {
  sessionId: string;
  data: string;
}

export interface TerminalExitPayload {
  sessionId: string;
  code?: number;
  reason?: string;
}

/** Paginated envelope tolerated by the API for list endpoints. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page?: number;
  pageSize?: number;
}
