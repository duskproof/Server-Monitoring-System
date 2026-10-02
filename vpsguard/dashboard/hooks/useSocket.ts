'use client';

import { useEffect, useRef, useState } from 'react';

import { getSocket, subscribeOverview, subscribeServer, unsubscribeServer } from '@/lib/socket';

/** Subscribes to a Socket.IO event without re-binding when the handler changes. */
export function useSocketEvent<T>(
  event: string,
  handler: (payload: T) => void,
  enabled = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();
    const listener = (payload: T) => handlerRef.current(payload);
    socket.on(event, listener);
    return () => {
      socket.off(event, listener);
    };
  }, [event, enabled]);
}

/** Live connection state of the shared socket. */
export function useSocketStatus(): boolean {
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = getSocket();
    setConnected(socket.connected);

    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  return connected;
}

/** Keeps a per-server subscription alive, re-subscribing after reconnects. */
export function useServerSubscription(serverId: string | null | undefined): void {
  useEffect(() => {
    if (!serverId) return;
    const socket = getSocket();

    const join = () => subscribeServer(serverId);
    join();
    socket.on('connect', join);

    return () => {
      socket.off('connect', join);
      if (socket.connected) unsubscribeServer(serverId);
    };
  }, [serverId]);
}

/** Keeps the aggregate overview subscription alive across reconnects. */
export function useOverviewSubscription(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const socket = getSocket();

    const join = () => subscribeOverview();
    join();
    socket.on('connect', join);

    return () => {
      socket.off('connect', join);
    };
  }, [enabled]);
}
