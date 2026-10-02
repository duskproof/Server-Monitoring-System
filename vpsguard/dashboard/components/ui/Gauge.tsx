import { clamp, cn } from '@/lib/utils';

export interface GaugeProps {
  /** Current value expressed on the same scale as `max`. */
  value: number;
  max?: number;
  label: string;
  sublabel?: string;
  size?: number;
  /** Percent thresholds that switch the arc to warning/danger colours. */
  warningAt?: number;
  dangerAt?: number;
  formatValue?: (value: number) => string;
  className?: string;
}

export function Gauge({
  value,
  max = 100,
  label,
  sublabel,
  size = 132,
  warningAt = 75,
  dangerAt = 90,
  formatValue,
  className,
}: GaugeProps) {
  const safeValue = Number.isFinite(value) ? value : 0;
  const ratio = clamp(max === 0 ? 0 : safeValue / max, 0, 1);
  const percent = ratio * 100;

  const stroke = 10;
  const radius = (size - stroke) / 2;
  const circumference = Math.PI * radius; // semicircle
  const dash = circumference * ratio;

  const color =
    percent >= dangerAt ? 'hsl(var(--danger))' : percent >= warningAt ? 'hsl(var(--warning))' : 'hsl(var(--success))';

  return (
    <div className={cn('flex flex-col items-center', className)}>
      <svg width={size} height={size / 2 + 12} viewBox={`0 0 ${size} ${size / 2 + 12}`} role="img" aria-label={`${label}: ${percent.toFixed(1)}%`}>
        <path
          d={`M ${stroke / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke="hsl(var(--line))"
          strokeWidth={stroke}
          strokeLinecap="round"
        />
        <path
          d={`M ${stroke / 2} ${size / 2} A ${radius} ${radius} 0 0 1 ${size - stroke / 2} ${size / 2}`}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="transition-all duration-500"
        />
        <text
          x={size / 2}
          y={size / 2 - 6}
          textAnchor="middle"
          className="fill-[hsl(var(--content))] text-xl font-semibold"
          style={{ fontSize: size * 0.17 }}
        >
          {formatValue ? formatValue(safeValue) : `${percent.toFixed(0)}%`}
        </text>
      </svg>
      <p className="mt-1 text-sm font-medium text-content">{label}</p>
      {sublabel ? <p className="text-xs text-muted">{sublabel}</p> : null}
    </div>
  );
}

export interface MiniBarProps {
  value: number;
  max?: number;
  warningAt?: number;
  dangerAt?: number;
  className?: string;
}

/** Compact horizontal usage bar used inside dense tables. */
export function UsageBar({ value, max = 100, warningAt = 75, dangerAt = 90, className }: MiniBarProps) {
  const percent = clamp(max === 0 ? 0 : (value / max) * 100, 0, 100);
  const tone =
    percent >= dangerAt ? 'bg-danger' : percent >= warningAt ? 'bg-warning' : 'bg-success';

  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-elevated', className)}>
      <div className={cn('h-full rounded-full transition-all duration-500', tone)} style={{ width: `${percent}%` }} />
    </div>
  );
}
