import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiProperty, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import { IsOptional, IsString } from 'class-validator';
import { Repository } from 'typeorm';
import { Roles } from '../common/decorators';
import { Group, MonitoredServer, UserRole } from '../database/entities';

class CreateGroupDto {
  @ApiProperty({ example: 'production' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ example: '#3b82f6' })
  @IsOptional()
  @IsString()
  color?: string;
}

@Injectable()
export class GroupsService {
  constructor(
    @InjectRepository(Group) private readonly groups: Repository<Group>,
    @InjectRepository(MonitoredServer) private readonly servers: Repository<MonitoredServer>,
  ) {}

  async list() {
    const groups = await this.groups.find({ order: { name: 'ASC' } });
    const counts = await this.servers
      .createQueryBuilder('server')
      .select('server.group_id', 'groupId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('server.group_id')
      .getRawMany<{ groupId: string; count: string }>();

    const countByGroup = new Map(counts.map((row) => [row.groupId, Number(row.count)]));
    return groups.map((group) => ({ ...group, serverCount: countByGroup.get(group.id) ?? 0 }));
  }

  create(dto: CreateGroupDto) {
    return this.groups.save(this.groups.create(dto));
  }

  async remove(id: string): Promise<void> {
    const result = await this.groups.delete({ id });
    if (!result.affected) throw new NotFoundException('Group not found');
  }
}

@ApiTags('groups')
@ApiBearerAuth()
@Controller('groups')
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @ApiOperation({ summary: 'List server groups' })
  list() {
    return this.groups.list();
  }

  @Post()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Create a server group' })
  create(@Body() dto: CreateGroupDto) {
    return this.groups.create(dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a server group' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.groups.remove(id);
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([Group, MonitoredServer])],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
