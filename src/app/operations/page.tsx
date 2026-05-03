'use client';

import { useState, useEffect } from 'react';
import { KPICard } from '@/components/cards/KPICard';
import { QueryTimer } from '@/components/layout/QueryTimer';
import { cn, formatCurrency } from '@/lib/utils';

interface DispatchReadiness {
  site_id: string; name: string; capacity_mw: number; soc_pct: number; soh_pct: number;
  current_power_mw: number; critical_alarms: number; available_energy_mwh: number; readiness_score: number;
}

interface RevenueOpportunity {
  site_id: string; name: string; capacity_mw: number; soc_pct: number; current_power_mw: number;
  market: string; price_usd_mwh: number; available_mw: number; available_mwh: number;
  revenue_per_hour_usd: number; total_opportunity_usd: number;
}

interface MissedRevenue {
  name: string; site_id: string; high_price_hours: number; dispatched_high_price_hours: number;
  missed_hours: number; total_missed_revenue_usd: number; avg_high_price: number;
}

interface AssetHealth {
  site_name: string; soh_current_pct: number; soh_last_week_pct: number; soh_month_ago_pct: number;
  degradation_30d_pct: number; projected_annual_degradation_pct: number; health_status: string;
}

interface FleetUtilization {
  site_name: string; capacity_mw: number; avg_power_mw: number; utilization_pct: number;
  avg_soc_pct: number; avg_soh_pct: number; avg_rte_pct: number; datapoints: number;
}

interface ExecSummary {
  site_count: number; total_capacity_mw: number; total_capacity_mwh: number;
  fleet_avg_soc: number; fleet_avg_soh: number; fleet_avg_rte: number;
  fleet_current_power_mw: number; avg_market_price: number;
  fleet_revenue_potential_per_hour: number; week_dispatches: number;
  week_energy_mwh: number; week_estimated_revenue: number;
  week_total_alarms: number; week_critical_alarms: number; active_alarms: number;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-emerald-500' : score >= 40 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-24 bg-slate-100 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${Math.max(3, score)}%` }} />
      </div>
      <span className="text-xs font-mono font-semibold">{score}</span>
    </div>
  );
}

export default function OperationsPage() {
  const [summary, setSummary] = useState<ExecSummary | null>(null);
  const [readiness, setReadiness] = useState<DispatchReadiness[]>([]);
  const [revenue, setRevenue] = useState<RevenueOpportunity[]>([]);
  const [missed, setMissed] = useState<MissedRevenue[]>([]);
  const [health, setHealth] = useState<AssetHealth[]>([]);
  const [utilization, setUtilization] = useState<FleetUtilization[]>([]);
  const [totalQueryMs, setTotalQueryMs] = useState(0);

  useEffect(() => {
    let totalMs = 0;
    Promise.all([
      fetch('/api/operations?view=summary').then(r => r.json()).then(res => { totalMs += res.meta?.queryMs || 0; setSummary(res.data); }),
      fetch('/api/operations?view=dispatch-readiness').then(r => r.json()).then(res => { totalMs += res.meta?.queryMs || 0; setReadiness(res.data || []); }),
      fetch('/api/operations?view=revenue-now').then(r => r.json()).then(res => { totalMs += res.meta?.queryMs || 0; setRevenue(res.data || []); }),
      fetch('/api/operations?view=missed-revenue').then(r => r.json()).then(res => { totalMs += res.meta?.queryMs || 0; setMissed(res.data || []); }),
      fetch('/api/operations?view=asset-health-degradation').then(r => r.json()).then(res => { totalMs += res.meta?.queryMs || 0; setHealth(res.data || []); }),
      fetch('/api/operations?view=fleet-utilization').then(r => r.json()).then(res => { totalMs += res.meta?.queryMs || 0; setUtilization(res.data || []); }),
    ]).then(() => setTotalQueryMs(totalMs));

    const interval = setInterval(() => {
      fetch('/api/operations?view=summary').then(r => r.json()).then(res => setSummary(res.data));
      fetch('/api/operations?view=dispatch-readiness').then(r => r.json()).then(res => setReadiness(res.data || []));
      fetch('/api/operations?view=revenue-now').then(r => r.json()).then(res => setRevenue(res.data || []));
      fetch('/api/operations?view=fleet-utilization').then(r => r.json()).then(res => setUtilization(res.data || []));
    }, 30_000);
    return () => clearInterval(interval);
  }, []);

  const totalMissed = missed.reduce((s, m) => s + Number(m.total_missed_revenue_usd || 0), 0);
  const totalRevenueNow = revenue.reduce((s, r) => s + Number(r.revenue_per_hour_usd || 0), 0);

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Operations Intelligence</h1>
          <p className="text-sm text-slate-500 mt-1">Decision support for dispatch, revenue, and asset health</p>
        </div>
        <QueryTimer queryMs={totalQueryMs} />
      </div>

      {/* Executive KPIs */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
          <KPICard label="Fleet Power" value={`${Math.abs(Number(summary.fleet_current_power_mw)).toFixed(0)}`} unit="MW" />
          <KPICard label="Avg SoC" value={`${Number(summary.fleet_avg_soc).toFixed(0)}%`} />
          <KPICard label="Avg Price" value={formatCurrency(Number(summary.avg_market_price))} unit="/MWh" />
          <KPICard label="Revenue/hr Now" value={formatCurrency(Number(summary.fleet_revenue_potential_per_hour))} className="border-brand-200 bg-brand-50/30" />
          <KPICard label="Week Dispatches" value={summary.week_dispatches} />
          <KPICard label="Week Energy" value={`${Number(summary.week_energy_mwh).toFixed(0)}`} unit="MWh" />
          <KPICard label="Week Revenue" value={formatCurrency(Number(summary.week_estimated_revenue))} />
          <KPICard label="Active Alarms" value={summary.active_alarms} className={Number(summary.active_alarms) > 0 ? 'border-red-200 bg-red-50/30' : ''} />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Dispatch Readiness */}
        <div className="card">
          <div className="card-header">
            <h3 className="section-title">Best Sites to Dispatch Now</h3>
            <span className="text-xs text-slate-400">Ranked by readiness score</span>
          </div>
          <div className="card-body">
            {readiness.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <th className="py-2 pr-3">Site</th>
                    <th className="py-2 pr-3">SoC</th>
                    <th className="py-2 pr-3">Available</th>
                    <th className="py-2 pr-3">Alarms</th>
                    <th className="py-2">Score</th>
                  </tr>
                </thead>
                <tbody>
                  {readiness.map(r => (
                    <tr key={r.site_id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-medium">{r.name}</td>
                      <td className="py-2.5 pr-3">{r.soc_pct}%</td>
                      <td className="py-2.5 pr-3">{r.available_energy_mwh} MWh</td>
                      <td className="py-2.5 pr-3">
                        {Number(r.critical_alarms) > 0 ? (
                          <span className="badge badge-critical">{r.critical_alarms}</span>
                        ) : (
                          <span className="text-slate-400">0</span>
                        )}
                      </td>
                      <td className="py-2.5"><ScoreBar score={Number(r.readiness_score)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Revenue Opportunity Now */}
        <div className="card">
          <div className="card-header">
            <div>
              <h3 className="section-title">Revenue Opportunity Now</h3>
              <p className="text-xs text-slate-400 mt-0.5">If dispatched at current market prices</p>
            </div>
            {totalRevenueNow > 0 && (
              <span className="text-lg font-bold text-brand-600">{formatCurrency(totalRevenueNow)}/hr</span>
            )}
          </div>
          <div className="card-body">
            {revenue.length === 0 ? (
              <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <th className="py-2 pr-3">Site</th>
                    <th className="py-2 pr-3">Market</th>
                    <th className="py-2 pr-3">Price</th>
                    <th className="py-2 pr-3">Available</th>
                    <th className="py-2">$/hr</th>
                  </tr>
                </thead>
                <tbody>
                  {revenue.map(r => (
                    <tr key={r.site_id} className="border-b border-slate-50 hover:bg-slate-50">
                      <td className="py-2.5 pr-3 font-medium">{r.name}</td>
                      <td className="py-2.5 pr-3"><span className="badge badge-info">{r.market}</span></td>
                      <td className="py-2.5 pr-3">{formatCurrency(Number(r.price_usd_mwh))}/MWh</td>
                      <td className="py-2.5 pr-3">{r.available_mw} MW</td>
                      <td className="py-2.5 font-semibold text-brand-600">{formatCurrency(Number(r.revenue_per_hour_usd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Fleet Utilization Ranking */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="section-title">Fleet Utilization — Last 24 Hours</h3>
            <p className="text-xs text-slate-400 mt-0.5">Sites ranked by capacity utilization efficiency</p>
          </div>
        </div>
        <div className="card-body">
          {utilization.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Site</th>
                  <th className="py-2 pr-3">Capacity</th>
                  <th className="py-2 pr-3">Avg Power</th>
                  <th className="py-2 pr-3">Utilization</th>
                  <th className="py-2 pr-3">Avg SoC</th>
                  <th className="py-2 pr-3">Avg SoH</th>
                  <th className="py-2">Efficiency</th>
                </tr>
              </thead>
              <tbody>
                {utilization.map((u, i) => (
                  <tr key={u.site_name} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2.5 pr-3 text-slate-400 font-mono">{i + 1}</td>
                    <td className="py-2.5 pr-3 font-medium">{u.site_name}</td>
                    <td className="py-2.5 pr-3">{u.capacity_mw} MW</td>
                    <td className="py-2.5 pr-3 font-mono">{u.avg_power_mw} MW</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', Number(u.utilization_pct) > 50 ? 'bg-emerald-500' : Number(u.utilization_pct) > 25 ? 'bg-amber-400' : 'bg-slate-300')}
                            style={{ width: `${Math.min(100, Math.abs(Number(u.utilization_pct)))}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono">{u.utilization_pct}%</span>
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">{u.avg_soc_pct}%</td>
                    <td className="py-2.5 pr-3">{u.avg_soh_pct}%</td>
                    <td className="py-2.5 font-mono">{u.avg_rte_pct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Missed Revenue */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="section-title">Missed Revenue — Last 7 Days</h3>
            <p className="text-xs text-slate-400 mt-0.5">Hours where price was &gt;$60/MWh but site wasn&apos;t dispatching</p>
          </div>
          {totalMissed > 0 && (
            <span className="text-lg font-bold text-red-600">{formatCurrency(totalMissed)} missed</span>
          )}
        </div>
        <div className="card-body">
          {missed.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="py-2 pr-4">Site</th>
                  <th className="py-2 pr-4">High-Price Hours</th>
                  <th className="py-2 pr-4">Dispatched</th>
                  <th className="py-2 pr-4">Missed Hours</th>
                  <th className="py-2 pr-4">Avg High Price</th>
                  <th className="py-2">Missed Revenue</th>
                </tr>
              </thead>
              <tbody>
                {missed.map(m => (
                  <tr key={m.site_id} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="py-2.5 pr-4 font-medium">{m.name}</td>
                    <td className="py-2.5 pr-4">{m.high_price_hours}h</td>
                    <td className="py-2.5 pr-4 text-emerald-600">{m.dispatched_high_price_hours}h</td>
                    <td className="py-2.5 pr-4 text-red-600">{m.missed_hours}h</td>
                    <td className="py-2.5 pr-4">{formatCurrency(Number(m.avg_high_price))}/MWh</td>
                    <td className="py-2.5 font-semibold text-red-600">{formatCurrency(Number(m.total_missed_revenue_usd))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Asset Health Degradation */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="section-title">Asset Health — 30-Day Degradation Trend</h3>
            <p className="text-xs text-slate-400 mt-0.5">Weekly SoH comparison to identify sites degrading faster than expected</p>
          </div>
        </div>
        <div className="card-body">
          {health.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">Loading...</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                  <th className="py-2 pr-3">Site</th>
                  <th className="py-2 pr-3">SoH Now</th>
                  <th className="py-2 pr-3">Last Week</th>
                  <th className="py-2 pr-3">Month Ago</th>
                  <th className="py-2 pr-3">30d Change</th>
                  <th className="py-2 pr-3">Annual (proj.)</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {health.map(h => (
                  <tr key={h.site_name} className={cn(
                    'border-b border-slate-50 hover:bg-slate-50',
                    h.health_status === 'CRITICAL' && 'bg-red-50/50',
                    h.health_status === 'WATCH' && 'bg-amber-50/50',
                  )}>
                    <td className="py-2.5 pr-3 font-medium">{h.site_name}</td>
                    <td className="py-2.5 pr-3 font-mono">{Number(h.soh_current_pct).toFixed(2)}%</td>
                    <td className="py-2.5 pr-3 font-mono">{Number(h.soh_last_week_pct).toFixed(2)}%</td>
                    <td className="py-2.5 pr-3 font-mono">{Number(h.soh_month_ago_pct).toFixed(2)}%</td>
                    <td className={cn('py-2.5 pr-3 font-mono font-semibold',
                      Number(h.degradation_30d_pct) < -0.1 ? 'text-red-600' : 'text-emerald-600'
                    )}>
                      {Number(h.degradation_30d_pct) > 0 ? '+' : ''}{Number(h.degradation_30d_pct).toFixed(3)}%
                    </td>
                    <td className={cn('py-2.5 pr-3 font-mono',
                      Number(h.projected_annual_degradation_pct) < -1 ? 'text-red-600' : 'text-slate-600'
                    )}>
                      {Number(h.projected_annual_degradation_pct).toFixed(2)}%/yr
                    </td>
                    <td className="py-2.5">
                      <span className={cn('badge',
                        h.health_status === 'CRITICAL' && 'badge-critical',
                        h.health_status === 'WATCH' && 'bg-amber-100 text-amber-800 border-amber-200',
                        h.health_status === 'NORMAL' && 'badge-online',
                      )}>
                        {h.health_status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Why Tiger Cloud */}
      <div className="card bg-slate-900 text-white border-slate-800">
        <div className="card-body space-y-3">
          <h3 className="text-lg font-semibold">Why This Matters for Tiger Cloud</h3>
          <p className="text-sm text-slate-300">
            Every query on this page combines <strong>telemetry</strong>, <strong>market prices</strong>,
            <strong> alarms</strong>, and <strong>dispatch history</strong> — all in standard SQL against one Postgres database.
            Tiger Cloud makes this possible at scale through:
          </p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Continuous Aggregates</p>
              <p className="text-sm mt-1">Sub-second fleet snapshot from 1-min rollups — no ETL pipeline needed</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Multi-Domain Joins</p>
              <p className="text-sm mt-1">Telemetry + prices + alarms + dispatch in one query, one database</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Columnstore Compression</p>
              <p className="text-sm mt-1">Historical missed-revenue analysis over compressed 7-day windows</p>
            </div>
            <div className="bg-slate-800 rounded-lg p-3">
              <p className="text-xs text-slate-400 uppercase">Real-Time + Historical</p>
              <p className="text-sm mt-1">Live dispatch readiness alongside week-over-week revenue trends</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
