import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  AlertRule,
  Group,
  Integration,
  MonitoredServer,
  Organization,
  User,
} from '../database/entities';

@Injectable()
export class OrganizationsService implements OnModuleInit {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    @InjectRepository(Organization) private readonly orgs: Repository<Organization>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(MonitoredServer) private readonly servers: Repository<MonitoredServer>,
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(AlertRule) private readonly rules: Repository<AlertRule>,
    @InjectRepository(Integration) private readonly integrations: Repository<Integration>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.migrateLegacyRows();
  }

  async createCabinet(name: string, slugHint?: string): Promise<Organization> {
    const slug = await this.uniqueSlug(slugHint || name);
    return this.orgs.save(this.orgs.create({ name: name.slice(0, 160) || 'Cabinet', slug }));
  }

  async findById(id: string): Promise<Organization | null> {
    return this.orgs.findOne({ where: { id } });
  }

  private async migrateLegacyRows(): Promise<void> {
    const needsOrg =
      (await this.users.count({ where: { organizationId: IsNull() } })) +
        (await this.servers.count({ where: { organizationId: IsNull() } })) +
        (await this.groups.count({ where: { organizationId: IsNull() } })) +
        (await this.rules.count({ where: { organizationId: IsNull() } })) +
        (await this.integrations.count({ where: { organizationId: IsNull() } })) >
      0;

    if (!needsOrg) return;

    let org = await this.orgs.find({ order: { createdAt: 'ASC' }, take: 1 }).then((rows) => rows[0]);
    if (!org) {
      const admin =
        (await this.users.findOne({
          where: { email: process.env.ADMIN_EMAIL ?? 'admin@vpsguard.local' },
        })) ?? (await this.users.find({ order: { createdAt: 'ASC' }, take: 1 }))[0];
      const label = admin?.name || admin?.email || 'Default';
      org = await this.createCabinet(`${label} cabinet`, admin?.email ?? 'default');
      this.logger.warn(`Created cabinet "${org.name}" for legacy data (${org.id})`);
    }

    await this.users.update({ organizationId: IsNull() }, { organizationId: org.id });
    await this.servers.update({ organizationId: IsNull() }, { organizationId: org.id });
    await this.groups.update({ organizationId: IsNull() }, { organizationId: org.id });
    await this.rules.update({ organizationId: IsNull() }, { organizationId: org.id });
    await this.integrations.update({ organizationId: IsNull() }, { organizationId: org.id });
    this.logger.warn(`Assigned legacy rows to cabinet ${org.id}`);
  }

  private async uniqueSlug(hint: string): Promise<string> {
    const base =
      hint
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'cabinet';
    let slug = base;
    let n = 0;
    while (await this.orgs.findOne({ where: { slug } })) {
      n += 1;
      slug = `${base}-${n}`;
    }
    return slug;
  }
}
