import { Controller, Get, Injectable, Module, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Response } from 'express';
import PDFDocument from 'pdfkit';
import { Between, Repository } from 'typeorm';
import { Alert, MonitoredServer } from '../database/entities';
import { InfluxService } from '../influx/influx.service';

interface ReportRow {
  server: string;
  status: string;
  avgCpu: number;
  avgMemory: number;
  maxDisk: number;
  alerts: number;
}

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(MonitoredServer) private readonly servers: Repository<MonitoredServer>,
    @InjectRepository(Alert) private readonly alerts: Repository<Alert>,
    private readonly influx: InfluxService,
  ) {}

  async build(from: string, to: string, serverId?: string): Promise<ReportRow[]> {
    const servers = serverId
      ? await this.servers.find({ where: { id: serverId } })
      : await this.servers.find();

    const rows: ReportRow[] = [];
    for (const server of servers) {
      const [cpu, memory, disk] = await Promise.all([
        this.influx.querySeries(server.id, 'cpu.percent', from, to, '1h'),
        this.influx.querySeries(server.id, 'memory.used_percent', from, to, '1h'),
        this.influx.querySeries(server.id, 'disk.used_percent', from, to, '1h'),
      ]);

      const mean = (series: { points: { v: number }[] }[]) => {
        const values = series.flatMap((s) => s.points.map((p) => p.v)).filter(Number.isFinite);
        return values.length ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(1)) : 0;
      };
      const peak = (series: { points: { v: number }[] }[]) => {
        const values = series.flatMap((s) => s.points.map((p) => p.v)).filter(Number.isFinite);
        return values.length ? Number(Math.max(...values).toFixed(1)) : 0;
      };

      const alertCount = await this.alerts.count({
        where: {
          serverId: server.id,
          createdAt: Between(this.toDate(from), this.toDate(to)),
        },
      });

      rows.push({
        server: server.name,
        status: server.status,
        avgCpu: mean(cpu),
        avgMemory: mean(memory),
        maxDisk: peak(disk),
        alerts: alertCount,
      });
    }
    return rows;
  }

  toCsv(rows: ReportRow[]): string {
    const header = 'server,status,avg_cpu_percent,avg_memory_percent,max_disk_percent,alerts';
    const body = rows
      .map((r) => [r.server, r.status, r.avgCpu, r.avgMemory, r.maxDisk, r.alerts].join(','))
      .join('\n');
    return `${header}\n${body}\n`;
  }

  writePdf(rows: ReportRow[], from: string, to: string, res: Response): void {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    doc.fontSize(18).text('VPSGuard Infrastructure Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').text(`Period: ${from} to ${to}`, { align: 'center' });
    doc.moveDown(1.5);
    doc.fillColor('#000');

    const columns = ['Server', 'Status', 'Avg CPU', 'Avg RAM', 'Max Disk', 'Alerts'];
    const widths = [140, 70, 65, 65, 70, 55];
    let x = doc.x;
    const headerY = doc.y;

    doc.fontSize(10).font('Helvetica-Bold');
    columns.forEach((column, index) => {
      doc.text(column, x, headerY, { width: widths[index] });
      x += widths[index];
    });
    doc.moveDown(0.5);
    doc.font('Helvetica');

    for (const row of rows) {
      const y = doc.y;
      const cells = [
        row.server,
        row.status,
        `${row.avgCpu}%`,
        `${row.avgMemory}%`,
        `${row.maxDisk}%`,
        String(row.alerts),
      ];
      x = doc.page.margins.left;
      cells.forEach((cell, index) => {
        doc.text(cell, x, y, { width: widths[index] });
        x += widths[index];
      });
      doc.moveDown(0.3);
    }

    doc.moveDown(2);
    doc.fontSize(8).fillColor('#999').text(`Generated ${new Date().toISOString()}`);
    doc.end();
  }

  private toDate(value: string): Date {
    // Accepts both ISO timestamps and Flux-style relative durations such as "-7d".
    const relative = /^-(\d+)([hdw])$/.exec(value);
    if (relative) {
      const amount = Number.parseInt(relative[1], 10);
      const unitMs = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }[relative[2]];
      return new Date(Date.now() - amount * unitMs);
    }
    return value === 'now()' ? new Date() : new Date(value);
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  @ApiOperation({ summary: 'Generate an infrastructure report' })
  @ApiQuery({ name: 'from', required: false, example: '-7d' })
  @ApiQuery({ name: 'to', required: false, example: 'now()' })
  @ApiQuery({ name: 'format', required: false, enum: ['json', 'csv', 'pdf'] })
  async generate(
    @Res() res: Response,
    @Query('from') from = '-7d',
    @Query('to') to = 'now()',
    @Query('format') format: 'json' | 'csv' | 'pdf' = 'json',
    @Query('serverId') serverId?: string,
  ): Promise<void> {
    const rows = await this.reports.build(from, to, serverId);

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="vpsguard-report.csv"');
      res.send(this.reports.toCsv(rows));
      return;
    }

    if (format === 'pdf') {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="vpsguard-report.pdf"');
      // The document streams straight into the response and ends it itself.
      this.reports.writePdf(rows, from, to, res);
      return;
    }

    res.json({ from, to, rows });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([MonitoredServer, Alert])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
