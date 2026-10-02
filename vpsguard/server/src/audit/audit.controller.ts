import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../common/decorators';
import { UserRole } from '../database/entities';
import { AuditService } from './audit.service';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List audit log entries (admin only)' })
  list(@Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.audit.list(
      limit ? Number.parseInt(limit, 10) : 200,
      offset ? Number.parseInt(offset, 10) : 0,
    );
  }
}
