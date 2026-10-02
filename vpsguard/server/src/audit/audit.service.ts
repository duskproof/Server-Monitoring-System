import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../database/entities';

@Injectable()
export class AuditService {
  constructor(@InjectRepository(AuditLog) private readonly logs: Repository<AuditLog>) {}

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

  async list(limit = 200, offset = 0) {
    const [items, total] = await this.logs.findAndCount({
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 500),
      skip: offset,
    });
    return { items, total };
  }
}
