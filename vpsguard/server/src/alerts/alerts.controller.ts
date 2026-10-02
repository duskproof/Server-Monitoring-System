import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, CurrentUser, Roles } from '../common/decorators';
import { AlertStatus, UserRole } from '../database/entities';
import { AlertsService } from './alerts.service';
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './dto';

@ApiTags('alerts')
@ApiBearerAuth()
@Controller()
export class AlertsController {
  constructor(
    private readonly alerts: AlertsService,
    private readonly audit: AuditService,
  ) {}

  @Get('alerts')
  @ApiOperation({ summary: 'List alerts, optionally filtered by status or server' })
  list(
    @Query('status') status?: AlertStatus,
    @Query('serverId') serverId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.alerts.listAlerts(status, serverId, limit ? Number.parseInt(limit, 10) : 200);
  }

  @Post('alerts/:id/ack')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Acknowledge a firing alert' })
  async acknowledge(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const alert = await this.alerts.acknowledge(id, user.id);
    await this.audit.record(user.id, user.email, 'alert.acknowledge', { alertId: id });
    return alert;
  }

  @Get('alert-rules')
  @ApiOperation({ summary: 'List alert rules' })
  listRules() {
    return this.alerts.listRules();
  }

  @Post('alert-rules')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Create an alert rule' })
  async createRule(@Body() dto: CreateAlertRuleDto, @CurrentUser() user: AuthenticatedUser) {
    const rule = await this.alerts.createRule(dto);
    await this.audit.record(user.id, user.email, 'alert_rule.create', { ruleId: rule.id });
    return rule;
  }

  @Patch('alert-rules/:id')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Update an alert rule' })
  async updateRule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateAlertRuleDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const rule = await this.alerts.updateRule(id, dto);
    await this.audit.record(user.id, user.email, 'alert_rule.update', { ruleId: id });
    return rule;
  }

  @Delete('alert-rules/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete an alert rule' })
  async removeRule(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.alerts.removeRule(id);
    await this.audit.record(user.id, user.email, 'alert_rule.delete', { ruleId: id });
  }
}
