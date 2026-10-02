import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedUser, CurrentUser, Roles } from '../common/decorators';
import { requireOrganizationId } from '../common/tenant';
import { UserRole } from '../database/entities';
import { AuditService } from './audit.service';

@ApiTags('audit-logs')
@ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List audit log entries for your cabinet (admin only)' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.audit.list(
      requireOrganizationId(user),
      limit ? Number.parseInt(limit, 10) : 200,
      offset ? Number.parseInt(offset, 10) : 0,
    );
  }
}
