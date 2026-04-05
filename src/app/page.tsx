import { getFleetOverview, getFleetKPIs, getActiveAlarms, getPlatformStats } from '@/lib/queries';
import { formatPower, formatPercent, formatEnergy, formatNumber } from '@/lib/utils';
import { KPICard } from '@/components/cards/KPICard';
import { SiteCard } from '@/components/cards/SiteCard';
import { AlarmTable } from '@/components/tables/AlarmTable';
import { QueryTimer } from '@/components/layout/QueryTimer';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [fleet, kpis, alarms, platform] = await Promise.all([
    getFleetOverview(),
    getFleetKPIs(),
    getActiveAlarms(),
    getPlatformStats(),
  ]);

  const k = kpis.data;
  const totalQueryMs = fleet.queryMs + kpis.queryMs + alarms.queryMs + platform.queryMs;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Fleet Dashboard</h1>
        <QueryTimer queryMs={totalQueryMs} />
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <KPICard label="Total Capacity" value={k.total_capacity_mw} unit="MW" />
        <KPICard label="Current Output" value={formatPower(k.total_current_power_mw)} />
        <KPICard label="Avg State of Charge" value={formatPercent(k.avg_soc_pct)} />
        <KPICard
          label="Active Alarms"
          value={k.active_alarm_count}
          className={k.active_alarm_count > 0 ? 'border-red-200 bg-red-50/30' : ''}
        />
        <KPICard label="Avg Efficiency" value={formatPercent(k.avg_rte)} />
        <KPICard label="Fleet Storage" value={formatEnergy(k.total_capacity_mwh)} />
      </div>

      {/* Sites Grid */}
      <div>
        <h2 className="section-title mb-4">Sites ({fleet.data.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fleet.data.map(site => (
            <SiteCard key={site.site_id} site={site} />
          ))}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Active Alarms */}
        <div className="card">
          <div className="card-header">
            <h3 className="section-title">Active Alarms</h3>
            <span className="text-xs text-slate-400">{alarms.data.length} active</span>
          </div>
          <div className="card-body">
            <AlarmTable alarms={alarms.data.slice(0, 10)} compact />
          </div>
        </div>

        {/* Platform Stats */}
        <div className="card">
          <div className="card-header">
            <h3 className="section-title">Tiger Cloud Stats</h3>
            <QueryTimer queryMs={platform.queryMs} />
          </div>
          <div className="card-body">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="kpi-label">Telemetry Rows</p>
                <p className="text-xl font-semibold mt-1">{formatNumber(platform.data.telemetry_row_count)}</p>
              </div>
              <div>
                <p className="kpi-label">Compression Ratio</p>
                <p className="text-xl font-semibold mt-1">{platform.data.compression_ratio}x</p>
              </div>
              <div>
                <p className="kpi-label">Chunks</p>
                <p className="text-xl font-semibold mt-1">{platform.data.chunk_count} <span className="text-sm text-slate-400">({platform.data.compressed_chunk_count} compressed)</span></p>
              </div>
              <div>
                <p className="kpi-label">Continuous Aggregates</p>
                <p className="text-xl font-semibold mt-1">{platform.data.continuous_aggregates}</p>
              </div>
              <div>
                <p className="kpi-label">Hypertables</p>
                <p className="text-xl font-semibold mt-1">{platform.data.hypertable_count}</p>
              </div>
              <div>
                <p className="kpi-label">Sites Monitored</p>
                <p className="text-xl font-semibold mt-1">{k.site_count}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
