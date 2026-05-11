'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatPower, formatPercent, formatEnergy } from '@/lib/utils';
import { KPICard } from '@/components/cards/KPICard';
import { SiteCard } from '@/components/cards/SiteCard';
import { AlarmTable } from '@/components/tables/AlarmTable';
import { QueryTimer } from '@/components/layout/QueryTimer';
import type { SiteOverview, FleetKPIs, Alarm } from '@/lib/types';

export default function DashboardPage() {
  const [fleet, setFleet] = useState<SiteOverview[]>([]);
  const [kpis, setKpis] = useState<FleetKPIs | null>(null);
  const [alarms, setAlarms] = useState<Alarm[]>([]);
  const [queryMs, setQueryMs] = useState(0);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const fetchData = useCallback(() => {
    let totalMs = 0;
    Promise.all([
      fetch('/api/fleet').then(r => r.json()).then(res => {
        totalMs += res.meta?.queryMs || 0;
        setFleet(res.data?.sites || []);
        setKpis(res.data?.kpis || null);
      }),
      fetch('/api/alarms?active=true').then(r => r.json()).then(res => {
        totalMs += res.meta?.queryMs || 0;
        setAlarms(res.data || []);
      }),
    ]).then(() => {
      setQueryMs(totalMs);
      setLastUpdate(new Date());
    });
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5_000);
    return () => clearInterval(interval);
  }, [fetchData]);

  const k = kpis;

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Fleet Dashboard</h1>
        <div className="flex items-center gap-3">
          {lastUpdate && (
            <span className="text-xs text-slate-400">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          )}
          <QueryTimer queryMs={queryMs} />
        </div>
      </div>

      {/* KPI Cards */}
      {k && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard label="Total Capacity" value={k.total_capacity_mw} unit="MW" />
          <KPICard label="Current Output" value={formatPower(k.total_current_power_mw)} />
          <KPICard label="Avg State of Charge" value={formatPercent(k.avg_soc_pct)} />
          <KPICard
            label="Active Alarms"
            value={k.active_alarm_count}
            className={Number(k.active_alarm_count) > 0 ? 'border-red-200 bg-red-50/30' : ''}
          />
          <KPICard label="Avg Efficiency" value={formatPercent(k.avg_rte)} />
          <KPICard label="Fleet Storage" value={formatEnergy(k.total_capacity_mwh)} />
        </div>
      )}

      {/* Sites Grid */}
      <div>
        <h2 className="section-title mb-4">Sites ({fleet.length})</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {fleet.map(site => (
            <SiteCard key={site.site_id} site={site} />
          ))}
        </div>
      </div>

      {/* Active Alarms */}
      <div className="card">
        <div className="card-header">
          <h3 className="section-title">Active Alarms</h3>
          <span className="text-xs text-slate-400">{alarms.length} active</span>
        </div>
        <div className="card-body">
          <AlarmTable alarms={alarms.slice(0, 10)} compact />
        </div>
      </div>
    </div>
  );
}
