import { Controller, Get, Header, NotFoundException, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Public } from '../common/decorators';

/**
 * Serves the agent installer and package at the API origin so generated
 * one-liners (`curl …/install.sh`) work without a separate Nginx profile.
 */
@ApiExcludeController()
@Controller()
export class InstallController {
  @Public()
  @Get('install.sh')
  @Header('Content-Type', 'text/x-shellscript; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="install.sh"')
  downloadInstallScript(@Res() res: Response): void {
    const candidates = [
      process.env.VPSGUARD_INSTALL_SH,
      '/app/install.sh',
      join(process.cwd(), 'install.sh'),
      join(process.cwd(), '..', 'agent', 'packaging', 'install.sh'),
      join(__dirname, '..', '..', '..', 'agent', 'packaging', 'install.sh'),
    ].filter(Boolean) as string[];

    for (const path of candidates) {
      if (existsSync(path)) {
        // Strip CR so Windows checkouts never break `set -o pipefail` under bash.
        const body = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        res.send(body);
        return;
      }
    }

    res
      .status(404)
      .type('text/plain')
      .send(
        'install.sh is not bundled in this image. Mount the agent packaging script ' +
          'at /app/install.sh or set VPSGUARD_INSTALL_SH.',
      );
  }

  @Public()
  @Get('download/vpsguard-agent.tar.gz')
  @Header('Content-Type', 'application/gzip')
  @Header('Content-Disposition', 'attachment; filename="vpsguard-agent.tar.gz"')
  downloadAgentPackage(@Res() res: Response): void {
    const candidates = [
      process.env.VPSGUARD_AGENT_SDIST,
      '/app/download/vpsguard-agent.tar.gz',
      join(process.cwd(), 'download', 'vpsguard-agent.tar.gz'),
      join(process.cwd(), '..', 'agent', 'packaging', 'download', 'vpsguard-agent.tar.gz'),
      join(
        __dirname,
        '..',
        '..',
        '..',
        'agent',
        'packaging',
        'download',
        'vpsguard-agent.tar.gz',
      ),
    ].filter(Boolean) as string[];

    for (const path of candidates) {
      if (existsSync(path)) {
        res.send(readFileSync(path));
        return;
      }
    }

    throw new NotFoundException(
      'Agent package missing. Run agent/packaging/build-sdist.sh and mount ' +
        'packaging/download/vpsguard-agent.tar.gz at /app/download/, or set VPSGUARD_AGENT_SDIST.',
    );
  }

  @Public()
  @Get('download/vpsguard-agent.service')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="vpsguard-agent.service"')
  downloadAgentService(@Res() res: Response): void {
    const candidates = [
      process.env.VPSGUARD_AGENT_SERVICE,
      '/app/download/vpsguard-agent.service',
      join(process.cwd(), 'download', 'vpsguard-agent.service'),
      join(process.cwd(), '..', 'agent', 'packaging', 'vpsguard-agent.service'),
      join(__dirname, '..', '..', '..', 'agent', 'packaging', 'vpsguard-agent.service'),
    ].filter(Boolean) as string[];

    for (const path of candidates) {
      if (existsSync(path)) {
        const body = readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
        res.send(body);
        return;
      }
    }

    throw new NotFoundException(
      'Agent unit file missing. Mount packaging/vpsguard-agent.service or set VPSGUARD_AGENT_SERVICE.',
    );
  }
}
