'use client';

import type { DispatchCommand } from '@/lib/types';
import { timeAgo, cn } from '@/lib/utils';

interface DispatchTableProps {
  dispatches: DispatchCommand[];
}

const statusBadge: Record<string, string> = {
  pending: 'bg-amber-50 text-amber-700',
  executing: 'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
  failed: 'bg-red-50 text-red-700',
};

export function DispatchTable({ dispatches }: DispatchTableProps) {
  if (dispatches.length === 0) {
    return <p className="text-sm text-slate-400 py-4 text-center">No dispatch commands</p>;
  }

  return (
    <div className="overflow-auto max-h-96">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
            <th className="py-2 pr-4">Time</th>
            <th className="py-2 pr-4">Site</th>
            <th className="py-2 pr-4">Command</th>
            <th className="py-2 pr-4">Target</th>
            <th className="py-2 pr-4">Duration</th>
            <th className="py-2 pr-4">Source</th>
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {dispatches.map((d, i) => (
            <tr key={`${d.ts}-${i}`} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
              <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap font-mono text-xs">{timeAgo(d.ts)}</td>
              <td className="py-2.5 pr-4 text-slate-700">{d.site_name}</td>
              <td className="py-2.5 pr-4 font-mono text-xs">{d.command_type}</td>
              <td className="py-2.5 pr-4">{d.target_power_mw?.toFixed(1)} MW</td>
              <td className="py-2.5 pr-4">{d.duration_min} min</td>
              <td className="py-2.5 pr-4 text-slate-500">{d.source}</td>
              <td className="py-2.5">
                <span className={cn('badge', statusBadge[d.status] || 'badge-info')}>{d.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
