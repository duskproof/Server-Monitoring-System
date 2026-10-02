import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export class IngestDto {
  @ApiPropertyOptional({ description: 'Also accepted via the X-API-Key header' })
  @IsOptional()
  @IsString()
  api_key?: string;

  @ApiPropertyOptional({ description: 'Null on the agent\'s very first packet' })
  @IsOptional()
  @IsUUID()
  server_id?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  hostname?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  agent_version?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  os_info?: string;

  @ApiProperty({ description: 'Unix timestamp in seconds' })
  @IsInt()
  timestamp: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  uptime_seconds?: number;

  @ApiProperty({ type: Object })
  @IsObject()
  metrics: Record<string, any>;
}

export class CommandResultBodyDto {
  @ApiProperty({ enum: ['success', 'failed', 'timeout', 'rejected'] })
  @IsString()
  status: 'success' | 'failed' | 'timeout' | 'rejected';

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  exit_code?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stdout?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  stderr?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  duration_ms?: number;
}
