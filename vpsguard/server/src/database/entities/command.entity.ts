import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum CommandStatus {
  PENDING = 'pending',
  DISPATCHED = 'dispatched',
  SUCCESS = 'success',
  FAILED = 'failed',
  TIMEOUT = 'timeout',
  REJECTED = 'rejected',
}

export enum CommandType {
  RESTART_SERVICE = 'restart_service',
  STOP_SERVICE = 'stop_service',
  START_SERVICE = 'start_service',
  RESTART_DOCKER = 'restart_docker',
  RUN_SCRIPT = 'run_script',
  CLEANUP_LOGS = 'cleanup_logs',
  AGENT_UPDATE = 'agent_update',
  PING = 'ping',
}

@Entity('commands')
@Index(['serverId', 'status'])
export class Command {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ name: 'server_id', type: 'uuid' })
  serverId: string;

  @Column({ type: 'enum', enum: CommandType })
  type: CommandType;

  @Column({ type: 'jsonb', default: () => `'{}'::jsonb` })
  args: Record<string, any>;

  @Column({ type: 'enum', enum: CommandStatus, default: CommandStatus.PENDING })
  status: CommandStatus;

  @Column({ name: 'exit_code', type: 'int', nullable: true })
  exitCode: number | null;

  @Column({ type: 'text', nullable: true })
  stdout: string | null;

  @Column({ type: 'text', nullable: true })
  stderr: string | null;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs: number | null;

  @Column({ name: 'timeout_seconds', type: 'int', default: 60 })
  timeoutSeconds: number;

  /** Null when the command was raised automatically by the self-healing engine. */
  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
