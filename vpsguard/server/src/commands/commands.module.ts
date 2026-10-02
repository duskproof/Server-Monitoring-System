import { Body, Controller, Get, Module, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IsEnum, IsInt, IsObject, IsOptional, IsUUID } from 'class-validator';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, CurrentUser, Roles } from '../common/decorators';
import { requireOrganizationId } from '../common/tenant';
import { Command, CommandType, MonitoredServer, UserRole } from '../database/entities';
import { CommandsService } from './commands.service';

class CreateCommandDto {
  @ApiProperty()
  @IsUUID()
  serverId: string;

  @ApiProperty({ enum: CommandType })
  @IsEnum(CommandType)
  type: CommandType;

  @ApiPropertyOptional({ example: { name: 'nginx' } })
  @IsOptional()
  @IsObject()
  args?: Record<string, any>;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @IsInt()
  timeoutSeconds?: number;
}

@ApiTags('commands')
@ApiBearerAuth()
@Controller('commands')
export class CommandsController {
  constructor(
    private readonly commands: CommandsService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Queue a command for an agent' })
  async create(@Body() dto: CreateCommandDto, @CurrentUser() user: AuthenticatedUser) {
    const command = await this.commands.create(
      requireOrganizationId(user),
      dto.serverId,
      dto.type,
      dto.args ?? {},
      user.id,
      dto.timeoutSeconds ?? 60,
    );
    await this.audit.record(user.id, user.email, 'command.create', {
      serverId: dto.serverId,
      type: dto.type,
      args: dto.args,
    });
    return command;
  }

  @Get()
  @ApiOperation({ summary: 'Command execution history for your cabinet' })
  history(
    @CurrentUser() user: AuthenticatedUser,
    @Query('serverId') serverId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.commands.history(
      requireOrganizationId(user),
      serverId,
      limit ? Number.parseInt(limit, 10) : 100,
    );
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Command, MonitoredServer]), AuditModule],
  controllers: [CommandsController],
  providers: [CommandsService],
  exports: [CommandsService],
})
export class CommandsModule {}
