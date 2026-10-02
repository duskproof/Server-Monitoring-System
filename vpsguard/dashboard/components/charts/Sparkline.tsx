'use client';

import { Area, AreaChart, ResponsiveContainer, YAxis } from 'recharts';

import { cn } from '@/lib/utils';

export interface SparklineProps {
  data: Array<{ t: number; v: number }>;
  color?: string;
  height?: number;
  /** Locks the Y axis to 0–100 so percentage sparklines stay comparable. */
  percentScale?: boolean;
  className?: string;
  gradientId?: string;
}

export function Sparkline({
  data,
  color = '#3b82f6',
  height = 40,
  percentScale = true,
  className,
  gradientId,
}: SparklineProps) {
  const id = gradientId ?? `spark-${color.replace('#', '')}`;

  if (data.length === 0) {
    return <div className={cn('flex items-center text-xs text-muted', className)} style={{ height }} />;
  }

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis hide domain={percentScale ? [0, 100] : ['dataMin', 'dataMax']} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            strokeWidth={1.6}
            fill={`url(#${id})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
