'use client';

import type { FitAddon } from '@xterm/addon-fit';
import type { Terminal as XTerminal } from '@xterm/xterm';
import { Eraser, Play, PowerOff, TerminalSquare } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';

import { Button } from '@/components/ui/Button';
import { getSocket } from '@/lib/socket';
import type { TerminalExitPayload, TerminalOutputPayload, TerminalReadyPayload } from '@/lib/types';
import { cn } from '@/lib/utils';
import { useCanOperate } from '@/store/auth';

import '@xterm/xterm/css/xterm.css';

type ConnectionState = 'idle' | 'connecting' | 'connected' | 'closed';

const DARK_THEME = {
  background: '#0b1220',
  foreground: '#e2e8f0',
  cursor: '#38bdf8',
  selectionBackground: '#1e40af80',
  black: '#0f172a',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#e2e8f0',
};

export function TerminalTab({ serverId, serverName }: { serverId: string; serverName: string }) {
  const canOperate = useCanOperate();

  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<XTerminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string | null>(null);

  const [state, setState] = useState<ConnectionState>('idle');

  const emitResize = useCallback(() => {
    const terminal = terminalRef.current;
    const sessionId = sessionRef.current;
    if (!terminal || !sessionId) return;
    getSocket().emit('terminal:resize', { sessionId, cols: terminal.cols, rows: terminal.rows });
  }, []);

  /** Boots xterm lazily so the library never runs during SSR. */
  useEffect(() => {
    let disposed = false;
    let resizeObserver: ResizeObserver | null = null;

    const boot = async () => {
      const [{ Terminal }, { FitAddon: FitAddonCtor }] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
      ]);
      if (disposed || !containerRef.current) return;

      const terminal = new Terminal({
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
        convertEol: true,
        scrollback: 5000,
        theme: DARK_THEME,
      });
      const fitAddon = new FitAddonCtor();
      terminal.loadAddon(fitAddon);
      terminal.open(containerRef.current);
      fitAddon.fit();

      terminal.writeln('\u001b[38;5;39mVPSGuard remote shell\u001b[0m');
      terminal.writeln(`Target: ${serverName}`);
      terminal.writeln('Press "Connect" to open a session.\r\n');

      terminal.onData((data) => {
        const sessionId = sessionRef.current;
        if (!sessionId) return;
        getSocket().emit('terminal:input', { sessionId, data });
      });

      terminalRef.current = terminal;
      fitRef.current = fitAddon;

      resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          emitResize();
        } catch {
          /* The container can be detached mid-resize — safe to ignore. */
        }
      });
      resizeObserver.observe(containerRef.current);
    };

    void boot();

    return () => {
      disposed = true;
      resizeObserver?.disconnect();
      const sessionId = sessionRef.current;
      if (sessionId) getSocket().emit('terminal:exit', { sessionId });
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitRef.current = null;
      sessionRef.current = null;
    };
  }, [emitResize, serverName]);

  /** Session lifecycle events from the gateway. */
  useEffect(() => {
    const socket = getSocket();

    const onReady = (payload: TerminalReadyPayload) => {
      if (!payload?.sessionId) return;
      sessionRef.current = payload.sessionId;
      setState('connected');
      terminalRef.current?.writeln('\u001b[38;5;42mSession established.\u001b[0m\r\n');
      terminalRef.current?.focus();
      emitResize();
    };

    const onOutput = (payload: TerminalOutputPayload) => {
      if (!payload || payload.sessionId !== sessionRef.current) return;
      terminalRef.current?.write(payload.data);
    };

    const onExit = (payload: TerminalExitPayload) => {
      if (payload?.sessionId && payload.sessionId !== sessionRef.current) return;
      sessionRef.current = null;
      setState('closed');
      terminalRef.current?.writeln(
        `\r\n\u001b[38;5;203mSession closed${payload?.code !== undefined ? ` (exit code ${payload.code})` : ''}.\u001b[0m`,
      );
    };

    const onDisconnect = () => {
      if (!sessionRef.current) return;
      sessionRef.current = null;
      setState('closed');
      terminalRef.current?.writeln('\r\n\u001b[38;5;203mConnection to the gateway was lost.\u001b[0m');
    };

    socket.on('terminal:ready', onReady);
    socket.on('terminal:output', onOutput);
    socket.on('terminal:exit', onExit);
    socket.on('disconnect', onDisconnect);

    return () => {
      socket.off('terminal:ready', onReady);
      socket.off('terminal:output', onOutput);
      socket.off('terminal:exit', onExit);
      socket.off('disconnect', onDisconnect);
    };
  }, [emitResize]);

  const connect = () => {
    if (!canOperate) {
      toast.error('Your role does not allow remote shell access');
      return;
    }
    setState('connecting');
    terminalRef.current?.writeln('\u001b[38;5;39mOpening session…\u001b[0m');
    getSocket().emit('terminal:start', { serverId });
  };

  const disconnect = () => {
    const sessionId = sessionRef.current;
    if (!sessionId) return;
    getSocket().emit('terminal:exit', { sessionId });
    sessionRef.current = null;
    setState('closed');
    terminalRef.current?.writeln('\r\n\u001b[38;5;203mSession terminated.\u001b[0m');
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1',
              state === 'connected'
                ? 'border-success/30 bg-success/10 text-success'
                : state === 'connecting'
                  ? 'border-warning/30 bg-warning/10 text-warning'
                  : 'border-line bg-elevated text-muted',
            )}
          >
            <TerminalSquare className="h-3.5 w-3.5" />
            {state === 'connected'
              ? 'Connected'
              : state === 'connecting'
                ? 'Connecting…'
                : state === 'closed'
                  ? 'Session closed'
                  : 'Not connected'}
          </span>
          {!canOperate ? <span className="text-muted">Read-only role — shell access is disabled.</span> : null}
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<Eraser className="h-3.5 w-3.5" />}
            onClick={() => terminalRef.current?.clear()}
          >
            Clear
          </Button>
          {state === 'connected' ? (
            <Button variant="danger" size="sm" leftIcon={<PowerOff className="h-3.5 w-3.5" />} onClick={disconnect}>
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              leftIcon={<Play className="h-3.5 w-3.5" />}
              loading={state === 'connecting'}
              disabled={!canOperate}
              onClick={connect}
            >
              Connect
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-[#0b1220] p-3">
        <div ref={containerRef} className="h-[520px] w-full" />
      </div>

      <p className="text-xs text-muted">
        Keystrokes are streamed to the agent over the authenticated WebSocket channel. Every session is recorded in the
        audit log.
      </p>
    </div>
  );
}
