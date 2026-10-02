import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Command, CommandStatus, CommandType } from '../database/entities';

export interface CommandResultDto {
  status: 'success' | 'failed' | 'timeout' | 'rejected';
  exit_code?: number;
  stdout?: string;
  stderr?: string;
  duration_ms?: number;
}

/** Output is capped so a runaway command cannot bloat the database. */
const MAX_OUTPUT_CHARS = 8192;

@Injectable()
export class CommandsService {
  private readonly logger = new Logger(CommandsService.name);

  constructor(@InjectRepository(Command) private readonly commands: Repository<Command>) {}

  create(
    serverId: string,
    type: CommandType,
    args: Record<string, any> = {},
    createdBy: string | null = null,
    timeoutSeconds = 60,
  ) {
    return this.commands.save(
      this.commands.create({
        serverId,
        type,
        args,
        createdBy,
        timeoutSeconds,
        status: CommandStatus.PENDING,
      }),
    );
  }

  /**
   * Pops pending commands for an agent and marks them dispatched, so the same
   * command is never handed out twice.
   */
  async claimPending(serverId: string, limit = 5) {
    const pending = await this.commands.find({
      where: { serverId, status: CommandStatus.PENDING },
      order: { createdAt: 'ASC' },
      take: limit,
    });
    if (pending.length === 0) return [];

    await this.commands.update(
      { id: In(pending.map((command) => command.id)) },
      { status: CommandStatus.DISPATCHED, dispatchedAt: new Date() },
    );

    return pending.map((command) => ({
      id: command.id,
      type: command.type,
      args: command.args,
      timeout: command.timeoutSeconds,
    }));
  }

  async recordResult(id: string, result: CommandResultDto) {
    const command = await this.commands.findOne({ where: { id } });
    if (!command) throw new NotFoundException('Command not found');

    command.status = result.status as CommandStatus;
    command.exitCode = result.exit_code ?? null;
    command.stdout = result.stdout?.slice(0, MAX_OUTPUT_CHARS) ?? null;
    command.stderr = result.stderr?.slice(0, MAX_OUTPUT_CHARS) ?? null;
    command.durationMs = result.duration_ms ?? null;
    command.completedAt = new Date();

    this.logger.log(`Command ${id} (${command.type}) finished with status ${result.status}`);
    return this.commands.save(command);
  }

  history(serverId?: string, limit = 100) {
    return this.commands.find({
      where: serverId ? { serverId } : {},
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  /** Requeues commands that were dispatched but never reported back. */
  async expireStale(maxAgeSeconds = 600): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeSeconds * 1000);
    const result = await this.commands
      .createQueryBuilder()
      .update(Command)
      .set({ status: CommandStatus.TIMEOUT, completedAt: new Date() })
      .where('status = :status', { status: CommandStatus.DISPATCHED })
      .andWhere('dispatched_at < :cutoff', { cutoff })
      .execute();
    return result.affected ?? 0;
  }
}
