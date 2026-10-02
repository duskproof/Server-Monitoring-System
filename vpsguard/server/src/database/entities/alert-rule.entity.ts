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
import { Organization } from './organization.entity';

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

export enum AlertCondition {
  GT = '>',
  LT = '<',
  EQ = '==',
  NEQ = '!=',
}

@Entity('alert_rules')
export class AlertRule {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Index()
  @Column({ name: 'organization_id', type: 'uuid', nullable: true })
  organizationId: string | null;

  @ManyToOne(() => Organization, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'organization_id' })
  organization: Organization | null;

  /** Null server + null group means the rule applies to every server in the org. */
  @Index()
  @Column({ name: 'server_id', type: 'uuid', nullable: true })
  serverId: string | null;

  @Column({ name: 'group_id', type: 'uuid', nullable: true })
  groupId: string | null;

  /** Dot-notation metric key, e.g. cpu.percent or disk.used_percent. */
  @Column({ type: 'varchar', length: 80 })
  metric: string;

  @Column({ type: 'enum', enum: AlertCondition })
  condition: AlertCondition;

  @Column({ type: 'double precision' })
  threshold: number;

  /** The condition must hold for this long before the alert starts firing. */
  @Column({ name: 'duration_seconds', type: 'int', default: 60 })
  durationSeconds: number;

  @Column({ type: 'enum', enum: AlertSeverity, default: AlertSeverity.WARNING })
  severity: AlertSeverity;

  @Column({ type: 'jsonb', default: () => `'[]'::jsonb` })
  channels: string[];

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Optional self-healing action executed on the agent when the rule fires. */
  @Column({ name: 'auto_heal_command', type: 'jsonb', nullable: true })
  autoHealCommand: Record<string, any> | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
