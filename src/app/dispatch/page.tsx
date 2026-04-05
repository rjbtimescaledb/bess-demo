'use client';

import { useState, useEffect } from 'react';
import { DispatchTable } from '@/components/tables/DispatchTable';
import { QueryTimer } from '@/components/layout/QueryTimer';
import type { DispatchCommand } from '@/lib/types';

export default function DispatchPage() {
  const [dispatches, setDispatches] = useState<DispatchCommand[]>([]);
  const [queryMs, setQueryMs] = useState(0);

  useEffect(() => {
    fetch('/api/dispatch').then(r => r.json()).then(res => {
      setDispatches(res.data || []);
      setQueryMs(res.meta?.queryMs || 0);
    });
  }, []);

  const todayCount = dispatches.filter(d => {
    const dt = new Date(d.ts);
    const now = new Date();
    return dt.toDateString() === now.toDateString();
  }).length;

  const completedCount = dispatches.filter(d => d.status === 'completed').length;
  const totalEnergyMwh = dispatches
    .filter(d => d.status === 'completed')
    .reduce((sum, d) => sum + (d.target_power_mw || 0) * (d.duration_min || 0) / 60, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Dispatch Commands</h1>
        <QueryTimer queryMs={queryMs} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card card-body">
          <p className="kpi-label">Total Commands</p>
          <p className="kpi-value mt-1">{dispatches.length}</p>
        </div>
        <div className="card card-body">
          <p className="kpi-label">Today</p>
          <p className="kpi-value mt-1">{todayCount}</p>
        </div>
        <div className="card card-body">
          <p className="kpi-label">Completed</p>
          <p className="kpi-value mt-1">{completedCount}</p>
        </div>
        <div className="card card-body">
          <p className="kpi-label">Energy Dispatched</p>
          <p className="kpi-value mt-1">{totalEnergyMwh.toFixed(0)} <span className="text-sm text-slate-400">MWh</span></p>
        </div>
      </div>

      <div className="card">
        <div className="card-body">
          <DispatchTable dispatches={dispatches} />
        </div>
      </div>
    </div>
  );
}
