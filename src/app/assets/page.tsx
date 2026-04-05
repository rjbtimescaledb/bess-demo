import { getSites, getSiteAssets } from '@/lib/queries';
import { AssetTable } from '@/components/tables/AssetTable';
import { QueryTimer } from '@/components/layout/QueryTimer';

export const dynamic = 'force-dynamic';

export default async function AssetsPage() {
  const { data: sites, queryMs: sitesMs } = await getSites();

  const assetResults = await Promise.all(
    sites.map(s => getSiteAssets(s.site_id))
  );

  const totalQueryMs = sitesMs + assetResults.reduce((s, r) => s + r.queryMs, 0);
  const totalAssets = assetResults.reduce((s, r) => s + r.data.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Asset Management</h1>
        <QueryTimer queryMs={totalQueryMs} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-body">
          <p className="kpi-label">Total Sites</p>
          <p className="kpi-value mt-1">{sites.length}</p>
        </div>
        <div className="card card-body">
          <p className="kpi-label">Battery Assets</p>
          <p className="kpi-value mt-1">{totalAssets}</p>
        </div>
        <div className="card card-body">
          <p className="kpi-label">Total Capacity</p>
          <p className="kpi-value mt-1">{sites.reduce((s, x) => s + x.capacity_mw, 0)} <span className="text-sm text-slate-400">MW</span></p>
        </div>
        <div className="card card-body">
          <p className="kpi-label">Total Storage</p>
          <p className="kpi-value mt-1">{sites.reduce((s, x) => s + x.capacity_mwh, 0)} <span className="text-sm text-slate-400">MWh</span></p>
        </div>
      </div>

      {sites.map((site, i) => (
        <div key={site.site_id} className="card">
          <div className="card-header">
            <h3 className="section-title">{site.name}</h3>
            <span className="text-xs text-slate-400">{site.capacity_mw} MW / {site.capacity_mwh} MWh</span>
          </div>
          <div className="card-body">
            <AssetTable assets={assetResults[i].data} />
          </div>
        </div>
      ))}
    </div>
  );
}
