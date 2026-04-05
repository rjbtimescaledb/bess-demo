'use client';

import { useState, useEffect } from 'react';
import { AlarmTable } from '@/components/tables/AlarmTable';
import { QueryTimer } from '@/components/layout/QueryTimer';
import { cn } from '@/lib/utils';
import type { Alarm } from '@/lib/types';

const SEVERITIES = ['all', 'emergency', 'critical', 'warning', 'info'];

export default function AlarmsPage() {
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [stats, setStats] = useState<{ severity: string; count: number }[]>([]);
  const [severity, setSeverity] = useState('all');
  const [activeOnly, setActiveOnly] = useState(true);
  const [queryMs, setQueryMs] = useState(0);

  useEffect(() => {
    const params = new URLSearchParams();
    if (activeOnly) params.set('active', 'true');
    fetch(`/api/alarms?${params}`).then(r => r.json()).then(res => {
      setAlarms(res.data || []);
      setQueryMs(res.meta?.queryMs || 0);
    });
    fetch('/api/alarms/stats').then(r => r.json()).then(res => setStats(res.data || []));
  }, [activeOnly]);

  const filtered = severity === 'all' ? alarms : alarms.filter(a => a.severity === severity);
  const totalActive = stats.reduce((s, x) => s + parseInt(String(x.count)), 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Alarms</h1>
        <QueryTimer queryMs={queryMs} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="card card-body text-center">
          <p className="kpi-label">Total Active</p>
          <p className="kpi-value mt-1">{totalActive}</p>
        </div>
        {['emergency', 'critical', 'warning', 'info'].map(sev => {
          const count = stats.find(s => s.severity === sev)?.count || 0;
          return (
            <div key={sev} className="card card-body text-center">
              <p className="kpi-label">{sev}</p>
              <p className={cn('kpi-value mt-1', sev === 'emergency' || sev === 'critical' ? 'text-red-600' : sev === 'warning' ? 'text-amber-600' : 'text-blue-600')}>
                {count}
              </p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          {SEVERITIES.map(s => (
            <button
              key={s}
              onClick={() => setSeverity(s)}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize',
                severity === s ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-600 ml-auto">
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} className="rounded" />
          Active only
        </label>
      </div>

      {/* Table */}
      <div className="card">
        <div className="card-body">
          <AlarmTable alarms={filtered} />
        </div>
      </div>
    </div>
  );
}
