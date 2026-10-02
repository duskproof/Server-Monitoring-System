import { Controller, Get, Module } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource, TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Public } from '../common/decorators';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness and dependency health probe' })
  async check() {
    let database = 'down';
    try {
      await this.dataSource.query('SELECT 1');
      database = 'up';
    } catch {
      database = 'down';
    }

    return {
      status: database === 'up' ? 'ok' : 'degraded',
      uptimeSeconds: Math.floor(process.uptime()),
      version: process.env.npm_package_version ?? '1.0.0',
      dependencies: { database },
      timestamp: new Date().toISOString(),
    };
  }
}

@Module({
  imports: [TypeOrmModule],
  controllers: [HealthController],
})
export class HealthModule {}
