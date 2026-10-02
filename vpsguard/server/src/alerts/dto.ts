import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';
import { AlertCondition, AlertSeverity } from '../database/entities';

export class CreateAlertRuleDto {
  @ApiProperty({ example: 'High CPU usage' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Scope to a single server' })
  @IsOptional()
  @IsUUID()
  serverId?: string;

  @ApiPropertyOptional({ description: 'Scope to a server group' })
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiProperty({ example: 'cpu.percent' })
  @IsString()
  metric: string;

  @ApiProperty({ enum: AlertCondition })
  @IsEnum(AlertCondition)
  condition: AlertCondition;

  @ApiProperty({ example: 90 })
  @IsNumber()
  threshold: number;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @IsInt()
  @Min(0)
  durationSeconds?: number;

  @ApiProperty({ enum: AlertSeverity })
  @IsEnum(AlertSeverity)
  severity: AlertSeverity;

  @ApiPropertyOptional({ example: ['telegram', 'email'] })
  @IsOptional()
  @IsArray()
  channels?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    description: 'Self-healing action executed on the agent when the rule fires',
    example: { type: 'restart_service', args: { name: 'nginx' } },
  })
  @IsOptional()
  @IsObject()
  autoHealCommand?: Record<string, any>;
}

export class UpdateAlertRuleDto extends CreateAlertRuleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  declare metric: string;

  @ApiPropertyOptional({ enum: AlertCondition })
  @IsOptional()
  @IsEnum(AlertCondition)
  declare condition: AlertCondition;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  declare threshold: number;

  @ApiPropertyOptional({ enum: AlertSeverity })
  @IsOptional()
  @IsEnum(AlertSeverity)
  declare severity: AlertSeverity;
}
