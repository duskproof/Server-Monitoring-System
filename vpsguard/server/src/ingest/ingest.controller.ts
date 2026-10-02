import { Body, Controller, Ip, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/decorators';
import { CommandsService } from '../commands/commands.service';
import { ApiKeyGuard } from './api-key.guard';
import { CommandResultBodyDto, IngestDto } from './dto';
import { IngestService } from './ingest.service';

@ApiTags('ingest')
@ApiSecurity('agent-api-key')
@Controller()
export class IngestController {
  constructor(
    private readonly ingest: IngestService,
    private readonly commands: CommandsService,
  ) {}

  @Public()
  @UseGuards(ApiKeyGuard)
  @SkipThrottle()
  @Post('ingest')
  @ApiOperation({ summary: 'Receive a metrics packet from an agent' })
  submit(@Body() dto: IngestDto, @Req() request: any, @Ip() ip: string) {
    return this.ingest.ingest(request.agentServer, dto, ip);
  }

  @Public()
  @UseGuards(ApiKeyGuard)
  @SkipThrottle()
  @Post('agent/commands/:id/result')
  @ApiOperation({ summary: 'Report the result of a remote command' })
  reportResult(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: CommandResultBodyDto,
  ) {
    return this.commands.recordResult(id, body);
  }
}
