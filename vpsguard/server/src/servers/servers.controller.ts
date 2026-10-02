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
import { requireOrganizationId } from '../common/tenant';
import { ServerStatus, UserRole } from '../database/entities';
import { CreateServerDto, UpdateServerDto } from './dto';
import { ServersService } from './servers.service';

@ApiTags('servers')
@ApiBearerAuth()
@Controller()
export class ServersController {
  constructor(
    private readonly servers: ServersService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  @ApiOperation({ summary: 'Cabinet overview counters' })
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.servers.overview(requireOrganizationId(user));
  }

  @Get('servers')
  @ApiOperation({ summary: 'List monitored servers in your cabinet' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query('group') groupId?: string,
    @Query('status') status?: ServerStatus,
    @Query('search') search?: string,
  ) {
    return this.servers.list(requireOrganizationId(user), { groupId, status, search });
  }

  @Get('servers/:id')
  @ApiOperation({ summary: 'Get one server with its latest metrics' })
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.servers.findOne(requireOrganizationId(user), id);
  }

  @Post('servers')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Register a server and generate its agent API key' })
  async create(@Body() dto: CreateServerDto, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.servers.create(requireOrganizationId(user), dto);
    await this.audit.record(user.id, user.email, 'server.create', {
      serverId: result.id,
      name: result.name,
    });
    return result;
  }

  @Patch('servers/:id')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Update server metadata' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateServerDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.servers.update(requireOrganizationId(user), id, dto);
    await this.audit.record(user.id, user.email, 'server.update', { serverId: id });
    return result;
  }

  @Post('servers/:id/rotate-key')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Rotate the agent API key' })
  async rotate(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    const result = await this.servers.rotateApiKey(requireOrganizationId(user), id);
    await this.audit.record(user.id, user.email, 'server.rotate_key', { serverId: id });
    return result;
  }

  @Delete('servers/:id')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a server' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.servers.remove(requireOrganizationId(user), id);
    await this.audit.record(user.id, user.email, 'server.delete', { serverId: id });
  }
}
