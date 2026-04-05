import { cn } from '@/lib/utils';

interface KPICardProps {
  label: string;
  value: string | number;
  unit?: string;
  trend?: number;
  trendDirection?: 'up' | 'down';
  className?: string;
}

export function KPICard({ label, value, unit, trend, trendDirection, className }: KPICardProps) {
  return (
    <div className={cn('card card-body', className)}>
      <p className="kpi-label">{label}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="kpi-value">{value}</span>
        {unit && <span className="text-sm text-slate-400">{unit}</span>}
      </div>
      {trend != null && (
        <div className={cn(
          'mt-1 flex items-center gap-1 text-xs font-medium',
          trendDirection === 'up' ? 'text-emerald-600' : 'text-red-500'
        )}>
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d={trendDirection === 'up' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'} />
          </svg>
          {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
}
