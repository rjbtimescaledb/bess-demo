'use client';

import type { Alarm } from '@/lib/types';
import { severityColor, timeAgo, cn } from '@/lib/utils';

interface AlarmTableProps {
  alarms: Alarm[];
  compact?: boolean;
}

export function AlarmTable({ alarms, compact }: AlarmTableProps) {
  if (alarms.length === 0) {
    return <p className="text-sm text-slate-400 py-4 text-center">No alarms</p>;
  }

  return (
    <div className="overflow-auto max-h-96">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-white">
          <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
            <th className="py-2 pr-4">Time</th>
            {!compact && <th className="py-2 pr-4">Site</th>}
            <th className="py-2 pr-4">Severity</th>
            <th className="py-2 pr-4">Code</th>
            {!compact && <th className="py-2 pr-4">Message</th>}
            <th className="py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          {alarms.map((alarm, i) => (
            <tr
              key={`${alarm.ts}-${alarm.alarm_code}-${i}`}
              className={cn(
                'border-b border-slate-50 hover:bg-slate-50 transition-colors',
                !alarm.resolved_at && 'bg-red-50/40'
              )}
            >
              <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap font-mono text-xs">{timeAgo(alarm.ts)}</td>
              {!compact && <td className="py-2.5 pr-4 text-slate-700">{alarm.site_name}</td>}
              <td className="py-2.5 pr-4">
                <span className={cn('badge', severityColor(alarm.severity))}>{alarm.severity}</span>
              </td>
              <td className="py-2.5 pr-4 font-mono text-xs">{alarm.alarm_code}</td>
              {!compact && <td className="py-2.5 pr-4 text-slate-600 max-w-xs truncate">{alarm.message}</td>}
              <td className="py-2.5">
                {alarm.resolved_at ? (
                  <span className="badge badge-online">Resolved</span>
                ) : (
                  <span className="badge badge-critical">Active</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
