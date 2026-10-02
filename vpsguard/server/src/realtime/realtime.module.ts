import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ServersModule } from '../servers/servers.module';
import { RealtimeGateway } from './realtime.gateway';

@Module({
  imports: [AuthModule, ServersModule, AuditModule],
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
