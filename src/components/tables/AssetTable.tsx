'use client';

import { useState } from 'react';
import type { BatteryAsset } from '@/lib/types';
import { cn } from '@/lib/utils';

interface AssetTableProps {
  assets: BatteryAsset[];
}

export function AssetTable({ assets }: AssetTableProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  if (assets.length === 0) {
    return <p className="text-sm text-slate-400 py-4 text-center">No assets</p>;
  }

  return (
    <div className="overflow-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
            <th className="py-2 pr-4 w-8"></th>
            <th className="py-2 pr-4">Name</th>
            <th className="py-2 pr-4">Manufacturer</th>
            <th className="py-2 pr-4">Chemistry</th>
            <th className="py-2 pr-4">Capacity</th>
            <th className="py-2 pr-4">Max Power</th>
            <th className="py-2 pr-4">Inverters</th>
            <th className="py-2 pr-4">Racks</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {assets.map(asset => (
            <tr
              key={asset.asset_id}
              className={cn('border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer')}
              onClick={() => toggle(asset.asset_id)}
            >
              <td className="py-2.5 pr-2">
                <svg className={cn('w-4 h-4 text-slate-400 transition-transform', expanded.has(asset.asset_id) && 'rotate-90')} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </td>
              <td className="py-2.5 pr-4 font-medium text-slate-900">{asset.name}</td>
              <td className="py-2.5 pr-4 text-slate-600">{asset.manufacturer}</td>
              <td className="py-2.5 pr-4"><span className="badge badge-info">{asset.chemistry}</span></td>
              <td className="py-2.5 pr-4">{asset.capacity_mwh} MWh</td>
              <td className="py-2.5 pr-4">{asset.max_power_mw} MW</td>
              <td className="py-2.5 pr-4">{asset.inverter_count || 0}</td>
              <td className="py-2.5 pr-4">{asset.rack_count || 0}</td>
              <td className="py-2.5">
                <span className={cn('badge', asset.status === 'online' ? 'badge-online' : 'badge-offline')}>{asset.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
