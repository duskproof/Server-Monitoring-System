import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Client as SshClient, ClientChannel } from 'ssh2';
import { Server, Socket } from 'socket.io';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { ServersService } from '../servers/servers.service';

interface TerminalSession {
  client: SshClient;
  stream: ClientChannel;
  serverId: string;
  userId: string;
}

@WebSocketGateway({
  cors: { origin: true, credentials: true },
  path: '/socket.io',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly sessions = new Map<string, TerminalSession>();

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly servers: ServersService,
    private readonly audit: AuditService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = client.handshake.auth?.token ?? client.handshake.query?.token;
    try {
      const payload = await this.jwt.verifyAsync(String(token), {
        secret: this.config.get<string>('jwt.accessSecret'),
      });
      client.data.user = {
        id: payload.sub,
        email: payload.email,
        role: payload.role,
        organizationId: payload.organizationId,
      };
    } catch {
      this.logger.warn(`Rejected unauthenticated socket ${client.id}`);
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.userId === client.data?.user?.id) {
        this.closeTerminal(sessionId);
      }
    }
  }

  @SubscribeMessage('subscribe:server')
  async subscribeServer(client: Socket, payload: { serverId: string }): Promise<void> {
    const orgId = client.data?.user?.organizationId as string | undefined;
    if (!orgId || !payload?.serverId) return;
    try {
      await this.servers.findEntity(payload.serverId, orgId);
      client.join(`server:${payload.serverId}`);
    } catch {
      client.emit('error', { message: 'Server not found' });
    }
  }

  @SubscribeMessage('unsubscribe:server')
  unsubscribeServer(client: Socket, payload: { serverId: string }): void {
    client.leave(`server:${payload.serverId}`);
  }

  @SubscribeMessage('subscribe:overview')
  subscribeOverview(client: Socket): void {
    const orgId = client.data?.user?.organizationId as string | undefined;
    if (!orgId) return;
    client.join(`overview:${orgId}`);
  }

  // ---------------------------------------------------------------- broadcast

  emitMetrics(serverId: string, timestamp: number, metrics: Record<string, any>): void {
    this.server?.to(`server:${serverId}`).emit('metrics', { serverId, timestamp, metrics });
  }

  emitAlert(alert: unknown): void {
    this.server?.emit('alert', { alert });
  }

  emitServerStatus(serverId: string, status: string): void {
    this.server?.emit('server:status', { serverId, status });
  }

  emitOverview(organizationId: string, overview: unknown): void {
    this.server?.to(`overview:${organizationId}`).emit('overview', overview);
  }

  // ----------------------------------------------------------- web terminal

  @SubscribeMessage('terminal:start')
  async startTerminal(client: Socket, payload: { serverId: string }): Promise<void> {
    const user = client.data.user;
    if (!user || !['admin', 'operator'].includes(user.role)) {
      client.emit('terminal:error', { message: 'Insufficient permissions' });
      return;
    }

    const server = await this.servers.findEntity(payload.serverId, user.organizationId);
    if (!server.ipAddress) {
      client.emit('terminal:error', { message: 'Server IP address is unknown' });
      return;
    }

    const sessionId = randomUUID();
    const ssh = new SshClient();

    ssh
      .on('ready', () => {
        ssh.shell({ term: 'xterm-256color' }, (err, stream) => {
          if (err) {
            client.emit('terminal:error', { message: err.message });
            ssh.end();
            return;
          }
          this.sessions.set(sessionId, {
            client: ssh,
            stream,
            serverId: payload.serverId,
            userId: user.id,
          });
          client.emit('terminal:ready', { sessionId });

          stream.on('data', (data: Buffer) =>
            client.emit('terminal:output', { sessionId, data: data.toString('utf8') }),
          );
          stream.on('close', () => {
            client.emit('terminal:exit', { sessionId });
            this.closeTerminal(sessionId);
          });
        });
      })
      .on('error', (err) => client.emit('terminal:error', { message: err.message }))
      .connect({
        host: server.ipAddress,
        port: server.sshPort ?? this.config.get<number>('ssh.defaultPort'),
        username: server.sshUser ?? this.config.get<string>('ssh.defaultUser'),
        // Key-based auth only: passwords are never stored by VPSGuard.
        privateKey: process.env.SSH_PRIVATE_KEY,
        readyTimeout: 15_000,
      });

    await this.audit.record(user.id, user.email, 'terminal.open', {
      serverId: payload.serverId,
      sessionId,
    });
  }

  @SubscribeMessage('terminal:input')
  handleInput(client: Socket, payload: { sessionId: string; data: string }): void {
    const session = this.sessions.get(payload.sessionId);
    if (!session || session.userId !== client.data?.user?.id) return;
    session.stream.write(payload.data);
  }

  @SubscribeMessage('terminal:resize')
  handleResize(client: Socket, payload: { sessionId: string; cols: number; rows: number }): void {
    const session = this.sessions.get(payload.sessionId);
    if (!session || session.userId !== client.data?.user?.id) return;
    session.stream.setWindow(payload.rows, payload.cols, 0, 0);
  }

  @SubscribeMessage('terminal:close')
  handleClose(client: Socket, payload: { sessionId: string }): void {
    const session = this.sessions.get(payload.sessionId);
    if (!session || session.userId !== client.data?.user?.id) return;
    this.closeTerminal(payload.sessionId);
  }

  private closeTerminal(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    try {
      session.stream?.end();
      session.client?.end();
    } catch {
      // Session already torn down.
    }
    this.sessions.delete(sessionId);
  }
}
