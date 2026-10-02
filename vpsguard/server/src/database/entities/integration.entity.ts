import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum IntegrationType {
  TELEGRAM = 'telegram',
  SLACK = 'slack',
  EMAIL = 'email',
  WEBHOOK = 'webhook',
}

@Entity('integrations')
export class Integration {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'enum', enum: IntegrationType })
  type: IntegrationType;

  @Column({ type: 'varchar', length: 120 })
  name: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Channel-specific settings. Secret fields are encrypted at rest by CryptoService. */
  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  config: Record<string, any>;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
