import Link from 'next/link';
import { getSites } from '@/lib/queries';
import { QueryTimer } from '@/components/layout/QueryTimer';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function SitesPage() {
  const { data: sites, queryMs } = await getSites();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Sites</h1>
        <QueryTimer queryMs={queryMs} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-3">Name</th>
              <th className="px-6 py-3">Organization</th>
              <th className="px-6 py-3">Capacity</th>
              <th className="px-6 py-3">Storage</th>
              <th className="px-6 py-3">Commissioned</th>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3">Timezone</th>
            </tr>
          </thead>
          <tbody>
            {sites.map(site => (
              <tr key={site.site_id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4">
                  <Link href={`/sites/${site.site_id}`} className="font-medium text-brand-600 hover:text-brand-700">
                    {site.name}
                  </Link>
                </td>
                <td className="px-6 py-4 text-slate-600">{site.org_name}</td>
                <td className="px-6 py-4">{site.capacity_mw} MW</td>
                <td className="px-6 py-4">{site.capacity_mwh} MWh</td>
                <td className="px-6 py-4 text-slate-600">{site.commissioned}</td>
                <td className="px-6 py-4">
                  <span className={cn('badge', site.status === 'operational' ? 'badge-online' : 'badge-offline')}>
                    {site.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-slate-500 text-xs font-mono">{site.timezone}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
