import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog, User } from '../database/entities';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async record(
    userId: string | null,
    userEmail: string | null,
    action: string,
    details: Record<string, any> = {},
    ipAddress?: string,
  ): Promise<void> {
    await this.logs.save(
      this.logs.create({ userId, userEmail, action, details, ipAddress: ipAddress ?? null }),
    );
  }

  async list(organizationId: string, limit = 200, offset = 0) {
    const qb = this.logs
      .createQueryBuilder('log')
      .innerJoin(User, 'user', 'user.id = log.user_id')
      .where('user.organization_id = :organizationId', { organizationId })
      .orderBy('log.created_at', 'DESC')
      .take(Math.min(limit, 500))
      .skip(offset);

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }
}
