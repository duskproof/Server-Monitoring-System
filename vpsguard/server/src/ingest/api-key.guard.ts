import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ServersService } from '../servers/servers.service';

/**
 * Authenticates agent traffic. The key may arrive either in the X-API-Key header
 * (preferred) or in the request body, which keeps the wire format from the spec valid.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly servers: ServersService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey: string | undefined =
      request.headers['x-api-key'] ?? request.body?.api_key ?? undefined;

    if (!apiKey) throw new UnauthorizedException('Missing agent API key');

    const server = await this.servers.resolveByApiKey(apiKey);
    if (!server) throw new UnauthorizedException('Invalid agent API key');

    request.agentServer = server;
    return true;
  }
}
