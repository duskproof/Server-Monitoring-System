import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuthenticatedUser, CurrentUser, Roles } from '../common/decorators';
import { requireOrganizationId } from '../common/tenant';
import { Integration, IntegrationType, UserRole } from '../database/entities';
import { NotificationsService } from './notifications.service';

@ApiTags('integrations')
@ApiBearerAuth()
@Controller('integrations')
export class IntegrationsController {
  constructor(
    @InjectRepository(Integration) private readonly integrations: Repository<Integration>,
    private readonly notifications: NotificationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List notification integrations in your cabinet' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    const organizationId = requireOrganizationId(user);
    const rows = await this.integrations.find({
      where: { organizationId },
      order: { type: 'ASC' },
    });
    return rows.map((row) => ({
      ...row,
      config: Object.fromEntries(
        Object.entries(row.config).map(([key, value]) =>
          /token|password|secret|key/i.test(key) && typeof value === 'string'
            ? [key, `${value.slice(0, 4)}...`]
            : [key, value],
        ),
      ),
    }));
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create or update an integration' })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: { type: IntegrationType; name: string; enabled?: boolean; config: Record<string, any> },
  ) {
    const organizationId = requireOrganizationId(user);
    const existing = await this.integrations.findOne({
      where: { type: body.type, organizationId },
    });
    const entity = existing ?? this.integrations.create({ type: body.type, organizationId });
    entity.name = body.name ?? body.type;
    entity.enabled = body.enabled ?? true;
    entity.organizationId = organizationId;
    entity.config = { ...(existing?.config ?? {}), ...body.config };
    return this.integrations.save(entity);
  }

  @Post('test/:channel')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Send a test notification through a channel' })
  test(@Param('channel') channel: string, @CurrentUser() user: AuthenticatedUser) {
    return this.notifications.sendTest(channel, requireOrganizationId(user));
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete an integration' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthenticatedUser) {
    await this.integrations.delete({ id, organizationId: requireOrganizationId(user) });
    return { ok: true };
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Integration])],
  controllers: [IntegrationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
