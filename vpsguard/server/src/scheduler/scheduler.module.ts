import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { CommandsModule } from '../commands/commands.module';
import { AlertRule, MonitoredServer } from '../database/entities';
import { RealtimeModule } from '../realtime/realtime.module';
import { ServersModule } from '../servers/servers.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MonitoredServer, AlertRule]),
    ServersModule,
    CommandsModule,
    AlertsModule,
    RealtimeModule,
  ],
  providers: [SchedulerService],
})
export class SchedulerModule {}
