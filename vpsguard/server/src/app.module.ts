import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AlertsModule } from './alerts/alerts.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CommandsModule } from './commands/commands.module';
import configuration from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { GroupsModule } from './groups/groups.module';
import { HealthModule } from './health/health.module';
import { InstallModule } from './install/install.module';
import { InfluxModule } from './influx/influx.module';
import { IngestModule } from './ingest/ingest.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ReportsModule } from './reports/reports.module';
import { SchedulerModule } from './scheduler/scheduler.module';
import { ServersModule } from './servers/servers.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ScheduleModule.forRoot(),
    // Baseline API rate limiting; the ingest endpoint opts out via @SkipThrottle.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    DatabaseModule,
    InfluxModule,
    AuditModule,
    AuthModule,
    UsersModule,
    GroupsModule,
    ServersModule,
    NotificationsModule,
    CommandsModule,
    RealtimeModule,
    AlertsModule,
    IngestModule,
    MetricsModule,
    SchedulerModule,
    ReportsModule,
    HealthModule,
    InstallModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
