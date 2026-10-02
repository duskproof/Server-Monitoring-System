import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AlertRule,
  Group,
  Integration,
  MonitoredServer,
  Organization,
  User,
} from '../database/entities';
import { OrganizationsService } from './organizations.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      User,
      MonitoredServer,
      Group,
      AlertRule,
      Integration,
    ]),
  ],
  providers: [OrganizationsService],
  exports: [OrganizationsService, TypeOrmModule],
})
export class OrganizationsModule {}
