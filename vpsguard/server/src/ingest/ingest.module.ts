import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlertsModule } from '../alerts/alerts.module';
import { CommandsModule } from '../commands/commands.module';
import { MonitoredServer } from '../database/entities';
import { RealtimeModule } from '../realtime/realtime.module';
import { ServersModule } from '../servers/servers.module';
import { ApiKeyGuard } from './api-key.guard';
import { IngestController } from './ingest.controller';
import { IngestService } from './ingest.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([MonitoredServer]),
    ServersModule,
    AlertsModule,
    CommandsModule,
    RealtimeModule,
  ],
  controllers: [IngestController],
  providers: [IngestService, ApiKeyGuard],
  exports: [IngestService],
})
export class IngestModule {}
