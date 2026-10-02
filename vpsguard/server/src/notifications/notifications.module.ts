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
import { Roles } from '../common/decorators';
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
  @ApiOperation({ summary: 'List notification integrations' })
  async list() {
    const rows = await this.integrations.find({ order: { type: 'ASC' } });
    // Secrets are masked so the dashboard never receives raw tokens.
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
    @Body() body: { type: IntegrationType; name: string; enabled?: boolean; config: Record<string, any> },
  ) {
    const existing = await this.integrations.findOne({ where: { type: body.type } });
    const entity = existing ?? this.integrations.create({ type: body.type });
    entity.name = body.name ?? body.type;
    entity.enabled = body.enabled ?? true;
    entity.config = { ...(existing?.config ?? {}), ...body.config };
    return this.integrations.save(entity);
  }

  @Post('test/:channel')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Send a test notification through a channel' })
  test(@Param('channel') channel: string) {
    return this.notifications.sendTest(channel);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete an integration' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.integrations.delete({ id });
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
