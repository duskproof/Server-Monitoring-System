'use client';

import { RefreshCw, Thermometer } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorState } from '@/components/ui/EmptyState';
import { Gauge } from '@/components/ui/Gauge';
import { Skeleton } from '@/components/ui/Skeleton';
import { useTemperatures } from '@/hooks/queries';
import { errorMessage } from '@/lib/api';
import { formatDateTime, formatTemperature } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Sensors rarely report a maximum, so 100 °C is used as the visual ceiling. */
const DEFAULT_MAX_CELSIUS = 100;

export function TemperaturesTab({ serverId }: { serverId: string }) {
  const query = useTemperatures(serverId);

  if (query.isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-44 w-full rounded-2xl" />
        ))}
      </div>
    );
  }

  if (query.isError) {
    return (
      <ErrorState
        title="Temperature data unavailable"
        description={errorMessage(query.error, 'This machine may not expose thermal sensors.')}
        action={
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    );
  }

  const sensors = query.data?.sensors ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {sensors.length} sensor{sensors.length === 1 ? '' : 's'} · snapshot {formatDateTime(query.data?.collectedAt)}
        </p>
        <Button
          variant="outline"
          size="sm"
          leftIcon={<RefreshCw className={cn('h-4 w-4', query.isFetching && 'animate-spin')} />}
          onClick={() => void query.refetch()}
        >
          Refresh
        </Button>
      </div>

      {sensors.length === 0 ? (
        <EmptyState
          icon={<Thermometer className="h-5 w-5" />}
          title="No sensors reported"
          description="Thermal readings require lm-sensors, nvidia-smi or SMART support on the host."
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {sensors.map((sensor) => {
            const critical = sensor.criticalCelsius ?? DEFAULT_MAX_CELSIUS;
            const high = sensor.highCelsius ?? critical * 0.85;

            return (
              <div
                key={`${sensor.sensor}-${sensor.label}`}
                className="flex flex-col items-center rounded-2xl border border-line bg-surface p-4"
              >
                <Gauge
                  value={sensor.celsius}
                  max={critical}
                  label={sensor.label || sensor.sensor}
                  sublabel={sensor.label ? sensor.sensor : undefined}
                  size={124}
                  warningAt={(high / critical) * 100}
                  dangerAt={95}
                  formatValue={(value) => formatTemperature(value, 0)}
                />
                <p className="mt-2 text-xs text-muted">
                  High {formatTemperature(sensor.highCelsius, 0)} · Critical {formatTemperature(sensor.criticalCelsius, 0)}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
