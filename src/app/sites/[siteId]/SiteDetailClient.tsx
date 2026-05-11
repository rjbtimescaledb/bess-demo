'use client';

import { useState, useEffect, useCallback } from 'react';
import { PowerChart } from '@/components/charts/PowerChart';
import { SoCChart } from '@/components/charts/SoCChart';
import { SoHDegradationChart } from '@/components/charts/SoHDegradationChart';
import { AlarmTable } from '@/components/tables/AlarmTable';
import { DispatchTable } from '@/components/tables/DispatchTable';
import { QueryTimer } from '@/components/layout/QueryTimer';
import { cn } from '@/lib/utils';

const SOH_RANGES = [
  { label: '30D', days: 30 },
  { label: '3M', days: 90 },
  { label: '6M', days: 180 },
  { label: '1Y', days: 365 },
  { label: 'All', days: 0 },
];

const RANGES = [
  { label: '1H', hours: 1 },
  { label: '4H', hours: 4 },
  { label: '12H', hours: 12 },
  { label: '24H', hours: 24 },
  { label: '7D', hours: 168 },
  { label: '30D', hours: 720 },
  { label: '1Y', hours: 8760 },
];

interface SiteDetailClientProps {
  siteId: string;
}

export function SiteDetailClient({ siteId }: SiteDetailClientProps) {
  const [range, setRange] = useState(24);
  const [telemetry, setTelemetry] = useState<{ data: unknown[]; meta?: { queryMs: number; table: string } } | null>(null);
  const [alarms, setAlarms] = useState<{ data: unknown[] } | null>(null);
  const [dispatches, setDispatches] = useState<{ data: unknown[] } | null>(null);
  const [sohDays, setSohDays] = useState(30);
  const [sohData, setSohData] = useState<{ data: { day: string; avg_soh: number }[] | null; meta?: { queryMs: number; days: number } } | null>(null);

  const fetchData = useCallback(() => {
    const from = new Date(Date.now() - range * 3600_000).toISOString();
    const to = new Date().toISOString();

    fetch(`/api/sites/${siteId}/telemetry?from=${from}&to=${to}`)
      .then(r => r.json()).then(setTelemetry);
    fetch(`/api/alarms?siteId=${siteId}&active=true`)
      .then(r => r.json()).then(setAlarms);
    fetch(`/api/dispatch?siteId=${siteId}&from=${from}&to=${to}`)
      .then(r => r.json()).then(setDispatches);
  }, [siteId, range]);

  const fetchSoh = useCallback(() => {
    const daysParam = sohDays === 0 ? 3650 : sohDays; // 'All' = 10 years
    fetch(`/api/sites/${siteId}/soh-trend?days=${daysParam}`)
      .then(r => r.json()).then(setSohData);
  }, [siteId, sohDays]);

  useEffect(() => { fetchSoh(); }, [fetchSoh]);

  useEffect(() => {
    fetchData();
    // Adaptive refresh: 5s for 1H, 15s for 4-12H, 30s for 24H+
    const refreshMs = range <= 1 ? 5_000 : range <= 12 ? 15_000 : 30_000;
    const interval = setInterval(fetchData, refreshMs);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <div className="space-y-6">
      {/* Time range selector */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 uppercase tracking-wider font-medium">Range:</span>
        {RANGES.map(r => (
          <button
            key={r.hours}
            onClick={() => setRange(r.hours)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
              range === r.hours ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
          >
            {r.label}
          </button>
        ))}
        {telemetry?.meta && (
          <span className="ml-auto flex items-center gap-2">
            <span className="text-xs text-slate-400">Source: <span className="font-mono">{telemetry.meta.table}</span></span>
            <QueryTimer queryMs={telemetry.meta.queryMs} />
          </span>
        )}
      </div>

      {/* Power Chart */}
      <div className="card">
        <div className="card-header">
          <h3 className="section-title">Power Output</h3>
        </div>
        <div className="card-body">
          {telemetry?.data ? (
            <PowerChart data={telemetry.data as never[]} height={350} />
          ) : (
            <div className="h-[350px] flex items-center justify-center text-slate-400">Loading...</div>
          )}
        </div>
      </div>

      {/* SoC Chart */}
      <div className="card">
        <div className="card-header">
          <h3 className="section-title">State of Charge</h3>
        </div>
        <div className="card-body">
          {telemetry?.data ? (
            <SoCChart data={telemetry.data as never[]} height={250} />
          ) : (
            <div className="h-[250px] flex items-center justify-center text-slate-400">Loading...</div>
          )}
        </div>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="card-header">
            <h3 className="section-title">Active Alarms</h3>
          </div>
          <div className="card-body">
            {alarms?.data ? <AlarmTable alarms={alarms.data as never[]} compact /> : <p className="text-slate-400 text-sm">Loading...</p>}
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <h3 className="section-title">Dispatch Commands</h3>
          </div>
          <div className="card-body">
            {dispatches?.data ? <DispatchTable dispatches={dispatches.data as never[]} /> : <p className="text-slate-400 text-sm">Loading...</p>}
          </div>
        </div>
      </div>

      {/* SoH Degradation Trend */}
      <div className="card">
        <div className="card-header">
          <div>
            <h3 className="section-title">Battery Health (SoH) — Degradation Trend</h3>
            <p className="text-xs text-slate-400 mt-0.5">Daily average State of Health from 1-hour continuous aggregate</p>
          </div>
          <div className="flex items-center gap-2">
            {SOH_RANGES.map(r => (
              <button
                key={r.days}
                onClick={() => setSohDays(r.days)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                  sohDays === r.days ? 'bg-emerald-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                )}
              >
                {r.label}
              </button>
            ))}
            {sohData?.meta && <QueryTimer queryMs={sohData.meta.queryMs} />}
          </div>
        </div>
        <div className="card-body">
          {sohData?.data && sohData.data.length > 0 ? (
            <SoHDegradationChart data={sohData.data} height={300} />
          ) : sohData?.data?.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-slate-400">No SoH data for this period</div>
          ) : (
            <div className="h-[300px] flex items-center justify-center text-slate-400">Loading...</div>
          )}
        </div>
      </div>
    </div>
  );
}
