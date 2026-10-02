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
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { InjectRepository, TypeOrmModule } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { IsBoolean, IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { Repository } from 'typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser, CurrentUser, Roles } from '../common/decorators';
import { User, UserRole } from '../database/entities';

class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  async list() {
    const rows = await this.users.find({ order: { createdAt: 'ASC' } });
    return rows.map((user) => this.toDto(user));
  }

  async create(dto: CreateUserDto) {
    const user = await this.users.save(
      this.users.create({
        email: dto.email.toLowerCase(),
        passwordHash: await bcrypt.hash(dto.password, 12),
        name: dto.name ?? null,
        role: dto.role,
      }),
    );
    return this.toDto(user);
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.users.findOne({ where: { id } });
    if (!user) throw new NotFoundException('User not found');

    if (dto.password) user.passwordHash = await bcrypt.hash(dto.password, 12);
    if (dto.name !== undefined) user.name = dto.name;
    if (dto.role) user.role = dto.role;
    if (dto.isActive !== undefined) user.isActive = dto.isActive;

    // Any credential or role change invalidates existing sessions.
    if (dto.password || dto.role || dto.isActive === false) user.refreshTokenHash = null;

    return this.toDto(await this.users.save(user));
  }

  async remove(id: string): Promise<void> {
    const result = await this.users.delete({ id });
    if (!result.affected) throw new NotFoundException('User not found');
  }

  private toDto(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'List users (admin only)' })
  list() {
    return this.users.list();
  }

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a user (admin only)' })
  async create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    const user = await this.users.create(dto);
    await this.audit.record(actor.id, actor.email, 'user.create', {
      userId: user.id,
      role: user.role,
    });
    return user;
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update a user (admin only)' })
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    const user = await this.users.update(id, dto);
    await this.audit.record(actor.id, actor.email, 'user.update', { userId: id });
    return user;
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a user (admin only)' })
  async remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    await this.users.remove(id);
    await this.audit.record(actor.id, actor.email, 'user.delete', { userId: id });
  }
}

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuditModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
