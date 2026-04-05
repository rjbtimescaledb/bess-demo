import { getSiteDetail, getSiteKPIs, getSiteAssets } from '@/lib/queries';
import { formatPower, formatPercent, formatTemp, cn } from '@/lib/utils';
import { KPICard } from '@/components/cards/KPICard';
import { AssetTable } from '@/components/tables/AssetTable';
import { QueryTimer } from '@/components/layout/QueryTimer';
import { SiteDetailClient } from './SiteDetailClient';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default async function SiteDetailPage({ params }: { params: Promise<{ siteId: string }> }) {
  const { siteId } = await params;
  const [siteRes, kpisRes, assetsRes] = await Promise.all([
    getSiteDetail(siteId),
    getSiteKPIs(siteId),
    getSiteAssets(siteId),
  ]);

  const site = siteRes.data;
  const kpis = kpisRes.data;
  const totalQueryMs = siteRes.queryMs + kpisRes.queryMs + assetsRes.queryMs;

  if (!site) {
    return <div className="text-center py-20 text-slate-400">Site not found</div>;
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb + Header */}
      <div>
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-2">
          <Link href="/sites" className="hover:text-brand-600">Sites</Link>
          <span>/</span>
          <span className="text-slate-700">{site.name}</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">{site.name}</h1>
            <p className="text-sm text-slate-500 mt-1">
              {site.capacity_mw} MW / {site.capacity_mwh} MWh &middot; {site.timezone}
              &middot; <span className={cn('badge', site.status === 'operational' ? 'badge-online' : 'badge-offline')}>{site.status}</span>
            </p>
          </div>
          <QueryTimer queryMs={totalQueryMs} />
        </div>
      </div>

      {/* KPI Cards */}
      {kpis && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard label="Current Power" value={formatPower(kpis.site_power_mw)} />
          <KPICard label="State of Charge" value={formatPercent(kpis.state_of_charge_pct)} />
          <KPICard label="State of Health" value={formatPercent(kpis.state_of_health_pct)} />
          <KPICard label="Efficiency" value={formatPercent(kpis.round_trip_efficiency)} />
          <KPICard label="Inverter Temp" value={formatTemp(kpis.inverter_temp_c)} />
          <KPICard
            label="Active Alarms"
            value={kpis.active_alarms || 0}
            className={kpis.active_alarms > 0 ? 'border-red-200 bg-red-50/30' : ''}
          />
        </div>
      )}

      {/* Live charts + data (client component) */}
      <SiteDetailClient siteId={siteId} />

      {/* Assets */}
      <div className="card">
        <div className="card-header">
          <h3 className="section-title">Assets ({assetsRes.data.length})</h3>
          <QueryTimer queryMs={assetsRes.queryMs} />
        </div>
        <div className="card-body">
          <AssetTable assets={assetsRes.data} />
        </div>
      </div>
    </div>
  );
}
