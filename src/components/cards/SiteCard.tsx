import Link from 'next/link';
import type { SiteOverview } from '@/lib/types';
import { formatPower, formatPercent, cn } from '@/lib/utils';

interface SiteCardProps {
  site: SiteOverview;
}

export function SiteCard({ site }: SiteCardProps) {
  const isCharging = (site.latest_power_mw ?? 0) < 0;
  const socPct = site.latest_soc_pct ?? 0;

  return (
    <Link href={`/sites/${site.site_id}`} className="card hover:shadow-md transition-shadow block">
      <div className="card-body">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">{site.name}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{site.capacity_mw} MW / {site.capacity_mwh} MWh</p>
          </div>
          <span className={cn('badge', site.status === 'operational' ? 'badge-online' : 'badge-offline')}>
            {site.status}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-slate-500">Power</p>
            <p className={cn('text-lg font-semibold', isCharging ? 'text-charge' : 'text-discharge')}>
              {isCharging ? '-' : '+'}{formatPower(site.latest_power_mw)}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-500">SoH</p>
            <p className="text-lg font-semibold text-slate-700">{formatPercent(site.latest_soh_pct)}</p>
          </div>
        </div>

        {/* SoC bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-slate-500">State of Charge</span>
            <span className="font-medium">{formatPercent(site.latest_soc_pct)}</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(2, socPct)}%`,
                background: socPct > 60 ? '#22c55e' : socPct > 30 ? '#eab308' : '#ef4444',
              }}
            />
          </div>
        </div>

        {site.active_alarms > 0 && (
          <div className="mt-3 flex items-center gap-1.5 text-xs text-red-600 font-medium">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M12 2l10 18H2L12 2z" />
            </svg>
            {site.active_alarms} active alarm{site.active_alarms > 1 ? 's' : ''}
          </div>
        )}
      </div>
    </Link>
  );
}
