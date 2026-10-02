import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Alert,
  AlertRule,
  AuditLog,
  Command,
  Group,
  Integration,
  MonitoredServer,
  Organization,
  User,
} from './entities';

export const ENTITIES = [
  Organization,
  User,
  Group,
  MonitoredServer,
  AlertRule,
  Alert,
  Command,
  AuditLog,
  Integration,
];

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        host: config.get<string>('postgres.host'),
        port: config.get<number>('postgres.port'),
        username: config.get<string>('postgres.username'),
        password: config.get<string>('postgres.password'),
        database: config.get<string>('postgres.database'),
        entities: ENTITIES,
        synchronize: config.get<boolean>('postgres.synchronize'),
        autoLoadEntities: true,
        logging: config.get<string>('app.env') === 'development' ? ['error', 'warn'] : ['error'],
      }),
    }),
  ],
})
export class DatabaseModule {}
