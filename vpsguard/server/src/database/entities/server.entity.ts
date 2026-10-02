import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Group } from './group.entity';

export enum ServerStatus {
  ONLINE = 'online',
  OFFLINE = 'offline',
  WARNING = 'warning',
}

@Entity('servers')
export class MonitoredServer {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  hostname: string | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress: string | null;

  /**
   * Agent API keys are never stored in plaintext. The prefix is kept so the UI can
   * display a recognisable fragment, and lookups are done by prefix then hash compare.
   */
  @Index()
  @Column({ name: 'api_key_prefix', type: 'varchar', length: 16 })
  apiKeyPrefix: string;

  @Column({ name: 'api_key_hash', type: 'varchar', length: 255 })
  apiKeyHash: string;

  @ManyToOne(() => Group, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'group_id' })
  group: Group | null;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string | null;

  @Index()
  @Column({ type: 'enum', enum: ServerStatus, default: ServerStatus.OFFLINE })
  status: ServerStatus;

  @Index()
  @Column({ name: 'last_seen', type: 'timestamptz', nullable: true })
  lastSeen: Date | null;

  @Column({ name: 'agent_version', type: 'varchar', length: 32, nullable: true })
  agentVersion: string | null;

  @Column({ name: 'os_info', type: 'varchar', length: 255, nullable: true })
  osInfo: string | null;

  @Column({ name: 'uptime_seconds', type: 'bigint', nullable: true })
  uptimeSeconds: number | null;

  /** Flattened numeric snapshot of the most recent packet, for fast list rendering. */
  @Column({ name: 'latest_metrics', type: 'jsonb', nullable: true })
  latestMetrics: Record<string, any> | null;

  /**
   * Full document-style sections of the most recent packet (processes, docker,
   * services, temperatures, smart, ssl, security, logs). These are not numeric
   * series, so they are served from here rather than from InfluxDB.
   */
  @Column({ name: 'raw_snapshot', type: 'jsonb', nullable: true })
  rawSnapshot: Record<string, any> | null;

  @Column({ name: 'ssh_user', type: 'varchar', length: 64, nullable: true })
  sshUser: string | null;

  @Column({ name: 'ssh_port', type: 'int', nullable: true })
  sshPort: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
