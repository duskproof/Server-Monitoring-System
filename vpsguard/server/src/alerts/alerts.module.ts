import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditModule } from '../audit/audit.module';
import { CommandsModule } from '../commands/commands.module';
import { Alert, AlertRule, Organization } from '../database/entities';
import { NotificationsModule } from '../notifications/notifications.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { AlertEngineService } from './alert-engine.service';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Alert, AlertRule, Organization]),
    NotificationsModule,
    CommandsModule,
    RealtimeModule,
    AuditModule,
  ],
  controllers: [AlertsController],
  providers: [AlertsService, AlertEngineService],
  exports: [AlertsService, AlertEngineService],
})
export class AlertsModule {}
