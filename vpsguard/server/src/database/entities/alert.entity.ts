import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AlertSeverity } from './alert-rule.entity';

export enum AlertStatus {
  FIRING = 'firing',
  ACKNOWLEDGED = 'acknowledged',
  RESOLVED = 'resolved',
}

@Entity('alerts')
@Index(['serverId', 'status'])
export class Alert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'rule_id', type: 'uuid' })
  ruleId: string;

  @Column({ name: 'rule_name', type: 'varchar', length: 160 })
  ruleName: string;

  @Index()
  @Column({ name: 'server_id', type: 'uuid' })
  serverId: string;

  @Column({ name: 'server_name', type: 'varchar', length: 120 })
  serverName: string;

  @Column({ type: 'varchar', length: 80 })
  metric: string;

  @Column({ type: 'enum', enum: AlertSeverity })
  severity: AlertSeverity;

  @Index()
  @Column({ type: 'enum', enum: AlertStatus, default: AlertStatus.FIRING })
  status: AlertStatus;

  @Column({ type: 'double precision' })
  value: number;

  @Column({ type: 'double precision' })
  threshold: number;

  @Column({ type: 'text' })
  message: string;

  /** Stable key used to deduplicate repeated firings of the same rule/server pair. */
  @Index()
  @Column({ name: 'dedup_key', type: 'varchar', length: 200 })
  dedupKey: string;

  @Column({ name: 'acknowledged_by', type: 'uuid', nullable: true })
  acknowledgedBy: string | null;

  @Column({ name: 'acknowledged_at', type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @Column({ name: 'resolved_at', type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
