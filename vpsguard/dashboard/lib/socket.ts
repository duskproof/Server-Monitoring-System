import { io, type Socket } from 'socket.io-client';

import { getAccessToken } from '@/lib/session';

export const WS_URL = (process.env.NEXT_PUBLIC_WS_URL || 'http://localhost:4000').replace(/\/+$/, '');

let socket: Socket | null = null;

/**
 * Singleton Socket.IO client. The connection is created lazily on first use and
 * reused by every hook, so a browser tab keeps exactly one gateway connection.
 */
export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(WS_URL, {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: true,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    auth: (cb: (data: Record<string, unknown>) => void) => {
      cb({ token: getAccessToken() ?? '' });
    },
  });

  return socket;
}

/** Re-authenticates the live connection after a login or token refresh. */
export function reconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}

export function subscribeServer(serverId: string): void {
  getSocket().emit('subscribe:server', { serverId });
}

export function unsubscribeServer(serverId: string): void {
  getSocket().emit('unsubscribe:server', { serverId });
}

export function subscribeOverview(): void {
  getSocket().emit('subscribe:overview');
}
