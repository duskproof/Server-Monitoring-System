'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import toast from 'react-hot-toast';

import { useSocketEvent } from '@/hooks/useSocket';
import { formatMetricValue } from '@/lib/metrics';
import type { AlertPayload } from '@/lib/types';

/**
 * Mounted once at the root: every alert pushed over the socket raises a toast,
 * no matter which page the user is currently on.
 */
export function GlobalAlertListener() {
  const queryClient = useQueryClient();

  useSocketEvent<AlertPayload>('alert', (payload) => {
    const alert = payload?.alert;
    if (!alert) return;

    void queryClient.invalidateQueries({ queryKey: ['alerts'] });
    void queryClient.invalidateQueries({ queryKey: ['overview'] });

    if (alert.status === 'resolved') {
      toast.success(`${alert.serverName}: ${alert.ruleName} resolved`, { id: `alert-${alert.id}` });
      return;
    }

    toast.custom(
      (instance) => (
        <div
          className={`pointer-events-auto w-[360px] max-w-[92vw] rounded-xl border bg-surface p-3 shadow-lg ${
            alert.severity === 'critical' ? 'border-danger/50' : 'border-line'
          } ${instance.visible ? 'animate-slide-up' : 'opacity-0'}`}
        >
          <div className="min-w-0">
            <p className="text-sm font-semibold text-content">
              {alert.ruleName} · <span className="font-normal text-muted">{alert.serverName}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {alert.message ||
                `${alert.metric} is ${formatMetricValue(alert.metric, alert.value)} (threshold ${formatMetricValue(
                  alert.metric,
                  alert.threshold,
                )})`}
            </p>
            <div className="mt-2 flex items-center gap-3">
              <Link
                href="/cabinet/alerts"
                onClick={() => toast.dismiss(instance.id)}
                className="text-xs font-medium text-primary hover:underline"
              >
                View alerts
              </Link>
              <Link
                href={`/cabinet/servers/${alert.serverId}`}
                onClick={() => toast.dismiss(instance.id)}
                className="text-xs font-medium text-muted hover:text-content"
              >
                Open server
              </Link>
            </div>
          </div>
        </div>
      ),
      { id: `alert-${alert.id}`, duration: alert.severity === 'critical' ? 12_000 : 6000 },
    );
  });

  return null;
}
