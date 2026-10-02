import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';
import { In, Repository } from 'typeorm';
import { Group, MonitoredServer, ServerStatus, Alert, AlertStatus } from '../database/entities';
import { CreateServerDto, UpdateServerDto } from './dto';

export interface ServerListFilters {
  groupId?: string;
  status?: ServerStatus;
  search?: string;
}

@Injectable()
export class ServersService {
  constructor(
    @InjectRepository(MonitoredServer) private readonly servers: Repository<MonitoredServer>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    private readonly config: ConfigService,
  ) {}

  async list(filters: ServerListFilters = {}) {
    const query = this.servers
      .createQueryBuilder('server')
      .leftJoinAndSelect('server.group', 'group')
      .orderBy('server.name', 'ASC');

    if (filters.groupId) query.andWhere('server.group_id = :groupId', { groupId: filters.groupId });
    if (filters.status) query.andWhere('server.status = :status', { status: filters.status });
    if (filters.search) {
      query.andWhere('(server.name ILIKE :search OR server.hostname ILIKE :search)', {
        search: `%${filters.search}%`,
      });
    }

    const rows = await query.getMany();
    return rows.map((row) => this.toDto(row));
  }

  async findOne(id: string) {
    const server = await this.servers.findOne({ where: { id }, relations: { group: true } });
    if (!server) throw new NotFoundException('Server not found');
    return this.toDto(server);
  }

  async findEntity(id: string): Promise<MonitoredServer> {
    const server = await this.servers.findOne({ where: { id } });
    if (!server) throw new NotFoundException('Server not found');
    return server;
  }

  /**
   * Creates a server record and returns the plaintext API key exactly once.
   * Only a bcrypt hash is persisted, so the key cannot be recovered later.
   */
  async create(dto: CreateServerDto) {
    const apiKey = `vg_${randomBytes(24).toString('hex')}`;
    const server = await this.servers.save(
      this.servers.create({
        name: dto.name,
        groupId: dto.groupId ?? null,
        ipAddress: this.normalizeHost(dto.ipAddress) || null,
        sshUser: dto.sshUser ?? null,
        sshPort: dto.sshPort ?? null,
        apiKeyPrefix: apiKey.slice(0, 11),
        apiKeyHash: await bcrypt.hash(apiKey, 10),
        status: ServerStatus.OFFLINE,
      }),
    );

    const baseUrl = this.resolvePublicUrl(dto.publicUrl);
    return {
      ...this.toDto(server),
      apiKey,
      installCommand: this.buildInstallCommand(baseUrl, apiKey),
    };
  }

  async update(id: string, dto: UpdateServerDto) {
    const server = await this.findEntity(id);
    Object.assign(server, {
      name: dto.name ?? server.name,
      groupId: dto.groupId === undefined ? server.groupId : dto.groupId,
      ipAddress: dto.ipAddress === undefined ? server.ipAddress : this.normalizeHost(dto.ipAddress) || null,
      sshUser: dto.sshUser ?? server.sshUser,
      sshPort: dto.sshPort ?? server.sshPort,
    });
    return this.toDto(await this.servers.save(server));
  }

  /** Base URL agents use to reach this VPSGuard instance. */
  private resolvePublicUrl(override?: string): string {
    const fromDto = this.normalizeBaseUrl(override);
    if (fromDto) return fromDto;

    const fromEnv = this.normalizeBaseUrl(
      process.env.PUBLIC_API_URL || this.config.get<string>('app.publicApiUrl'),
    );
    if (fromEnv) return fromEnv;

    const origins = this.config.get<string[]>('app.corsOrigins') ?? [];
    const dashboard = origins.find((origin) => /^https?:\/\//i.test(origin));
    if (dashboard) {
      try {
        const url = new URL(dashboard);
        const port = url.port || (url.protocol === 'https:' ? '443' : '80');
        // Dashboard is often on :3000/:3010 — agents talk to the API on :4000.
        if (port === '3000' || port === '3010') {
          return `${url.protocol}//${url.hostname}:4000`;
        }
        return `${url.protocol}//${url.host}`;
      } catch {
        /* fall through */
      }
    }
    return 'http://localhost:4000';
  }

  private buildInstallCommand(baseUrl: string, apiKey: string): string {
    return (
      `curl -fsSL ${baseUrl}/install.sh | sudo bash -s -- ` +
      `--url ${baseUrl} --api-key ${apiKey}`
    );
  }

  private normalizeHost(value?: string | null): string {
    if (!value) return '';
    return value.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
  }

  private normalizeBaseUrl(value?: string | null): string {
    if (!value?.trim()) return '';
    let raw = value.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(raw)) {
      // Bare IP/hostname → assume HTTP API on 4000.
      const host = raw.includes(':') ? raw : `${raw}:4000`;
      raw = `http://${host}`;
    }
    try {
      const url = new URL(raw);
      return `${url.protocol}//${url.host}`;
    } catch {
      return '';
    }
  }

  async remove(id: string): Promise<void> {
    const result = await this.servers.delete({ id });
    if (!result.affected) throw new NotFoundException('Server not found');
  }

  /** Rotates the API key, invalidating the agent's current credentials. */
  async rotateApiKey(id: string) {
    const server = await this.findEntity(id);
    const apiKey = `vg_${randomBytes(24).toString('hex')}`;
    server.apiKeyPrefix = apiKey.slice(0, 11);
    server.apiKeyHash = await bcrypt.hash(apiKey, 10);
    await this.servers.save(server);
    return { apiKey };
  }

  /**
   * Resolves an agent API key to a server. Candidates are narrowed by prefix
   * before the (expensive) bcrypt comparison.
   */
  async resolveByApiKey(apiKey: string): Promise<MonitoredServer | null> {
    if (!apiKey?.startsWith('vg_')) return null;
    const candidates = await this.servers.find({
      where: { apiKeyPrefix: apiKey.slice(0, 11) },
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(apiKey, candidate.apiKeyHash)) return candidate;
    }
    return null;
  }

  /** Flags servers that have missed their heartbeat window as offline. */
  async markStaleOffline(offlineAfterSeconds: number): Promise<MonitoredServer[]> {
    const cutoff = new Date(Date.now() - offlineAfterSeconds * 1000);
    const stale = await this.servers
      .createQueryBuilder('server')
      .where('server.status != :offline', { offline: ServerStatus.OFFLINE })
      .andWhere('(server.last_seen IS NULL OR server.last_seen < :cutoff)', { cutoff })
      .getMany();

    if (stale.length > 0) {
      await this.servers.update(
        { id: In(stale.map((server) => server.id)) },
        { status: ServerStatus.OFFLINE },
      );
    }
    return stale;
  }

  async overview() {
    const servers = await this.servers.find();
    const online = servers.filter((s) => s.status === ServerStatus.ONLINE);
    const average = (selector: (metrics: Record<string, any>) => number): number => {
      const values = online
        .map((s) => (s.latestMetrics ? selector(s.latestMetrics) : NaN))
        .filter((value) => Number.isFinite(value));
      if (values.length === 0) return 0;
      return Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1));
    };

    return {
      serverCount: servers.length,
      onlineCount: online.length,
      offlineCount: servers.filter((s) => s.status === ServerStatus.OFFLINE).length,
      warningCount: servers.filter((s) => s.status === ServerStatus.WARNING).length,
      firingAlerts: await this.alerts.count({ where: { status: AlertStatus.FIRING } }),
      avgCpu: average((m) => m.cpuPercent),
      avgMemory: average((m) => m.memoryUsedPercent),
      avgDisk: average((m) => m.diskUsedPercent),
    };
  }

  private toDto(server: MonitoredServer) {
    return {
      id: server.id,
      name: server.name,
      hostname: server.hostname,
      ipAddress: server.ipAddress,
      status: server.status,
      groupId: server.groupId,
      groupName: server.group?.name ?? null,
      lastSeen: server.lastSeen?.toISOString() ?? null,
      agentVersion: server.agentVersion,
      osInfo: server.osInfo,
      uptimeSeconds: server.uptimeSeconds ? Number(server.uptimeSeconds) : null,
      apiKeyPrefix: server.apiKeyPrefix,
      sshUser: server.sshUser,
      sshPort: server.sshPort,
      latestMetrics: server.latestMetrics,
      createdAt: server.createdAt.toISOString(),
    };
  }
}
