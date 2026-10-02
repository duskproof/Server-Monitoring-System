import { Controller, Get, Module, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MonitoredServer } from '../database/entities';
import { InfluxService } from '../influx/influx.service';
import {
  mapDocker,
  mapLogs,
  mapProcesses,
  mapServices,
  mapSsl,
  mapTemperatures,
} from './snapshot.mapper';

@ApiTags('metrics')
@ApiBearerAuth()
@Controller('servers/:id')
export class MetricsController {
  constructor(
    @InjectRepository(MonitoredServer) private readonly servers: Repository<MonitoredServer>,
    private readonly influx: InfluxService,
  ) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Query a metric time series' })
  @ApiQuery({ name: 'metric', example: 'cpu.percent' })
  @ApiQuery({ name: 'from', required: false, example: '-1h' })
  @ApiQuery({ name: 'to', required: false, example: 'now()' })
  @ApiQuery({ name: 'interval', required: false, example: '1m' })
  async series(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('metric') metric = 'cpu.percent',
    @Query('from') from = '-1h',
    @Query('to') to = 'now()',
    @Query('interval') interval = '1m',
  ) {
    const series = await this.influx.querySeries(id, metric, from, to, interval);
    return { metric, from, to, interval, series };
  }

  @Get('forecast')
  @ApiOperation({ summary: 'Predict when a metric will cross a threshold' })
  async forecast(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('metric') metric = 'disk.used_percent',
    @Query('target') target = '100',
  ) {
    const hours = await this.influx.forecastHoursToThreshold(
      id,
      metric,
      Number.parseFloat(target),
    );
    return {
      metric,
      target: Number.parseFloat(target),
      hoursUntilThreshold: hours,
      estimatedAt: hours ? new Date(Date.now() + hours * 3_600_000).toISOString() : null,
    };
  }

  @Get('processes')
  @ApiOperation({ summary: 'Latest process snapshot' })
  async processes(@Param('id', ParseUUIDPipe) id: string) {
    const snapshot = await this.raw(id);
    return mapProcesses(snapshot.processes, snapshot.process_summary);
  }

  @Get('docker')
  @ApiOperation({ summary: 'Latest Docker container snapshot' })
  async docker(@Param('id', ParseUUIDPipe) id: string) {
    return mapDocker((await this.raw(id)).docker);
  }

  @Get('services')
  @ApiOperation({ summary: 'Latest systemd service statuses' })
  async services(@Param('id', ParseUUIDPipe) id: string) {
    return mapServices((await this.raw(id)).services);
  }

  @Get('temperatures')
  @ApiOperation({ summary: 'Latest temperature sensor readings' })
  async temperatures(@Param('id', ParseUUIDPipe) id: string) {
    return mapTemperatures((await this.raw(id)).temperatures);
  }

  @Get('ssl')
  @ApiOperation({ summary: 'Latest SSL certificate checks' })
  async ssl(@Param('id', ParseUUIDPipe) id: string) {
    return mapSsl((await this.raw(id)).ssl);
  }

  @Get('smart')
  @ApiOperation({ summary: 'Latest SMART disk health data' })
  async smart(@Param('id', ParseUUIDPipe) id: string) {
    return (await this.raw(id)).smart ?? [];
  }

  @Get('security')
  @ApiOperation({ summary: 'Latest security posture snapshot' })
  async security(@Param('id', ParseUUIDPipe) id: string) {
    return (await this.raw(id)).security ?? null;
  }

  @Get('logs')
  @ApiOperation({ summary: 'Latest log scan results' })
  async logs(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('file') file?: string,
    @Query('pattern') pattern?: string,
    @Query('limit') limit?: string,
  ) {
    const snapshot = await this.raw(id);
    return mapLogs(snapshot.logs, {
      file,
      pattern,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  private async raw(id: string): Promise<Record<string, any>> {
    const server = await this.servers.findOne({ where: { id } });
    if (!server) throw new NotFoundException('Server not found');
    return (server.rawSnapshot as Record<string, any>) ?? {};
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([MonitoredServer])],
  controllers: [MetricsController],
})
export class MetricsModule {}
