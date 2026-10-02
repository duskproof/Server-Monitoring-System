import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class CreateServerDto {
  @ApiProperty({ example: 'web-01' })
  @IsString()
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({
    example: '203.0.113.10',
    description: 'IP or hostname of the monitored machine (SSH / list view)',
  })
  @IsOptional()
  @IsString()
  ipAddress?: string;

  @ApiPropertyOptional({
    example: 'http://203.0.113.50:4000',
    description: 'Public VPSGuard URL used in the generated agent install command',
  })
  @IsOptional()
  @IsString()
  publicUrl?: string;

  @ApiPropertyOptional({ description: 'SSH user for the web terminal' })
  @IsOptional()
  @IsString()
  sshUser?: string;

  @ApiPropertyOptional({ default: 22 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(65535)
  sshPort?: number;
}

export class UpdateServerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  groupId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  ipAddress?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  sshUser?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sshPort?: number;
}
