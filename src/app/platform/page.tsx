'use client';

import { useState, useEffect } from 'react';
import { KPICard } from '@/components/cards/KPICard';
import { QueryTimer } from '@/components/layout/QueryTimer';
import { formatBytes, formatNumber } from '@/lib/utils';
import type { PlatformStats } from '@/lib/types';

export default function PlatformPage() {
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [queryMs, setQueryMs] = useState(0);

  useEffect(() => {
    fetch('/api/platform').then(r => r.json()).then(res => {
      setStats(res.data);
      setQueryMs(res.meta?.queryMs || 0);
    });
  }, []);

  if (!stats) {
    return <div className="flex items-center justify-center h-64 text-slate-400">Loading platform stats...</div>;
  }

  const savingsPct = stats.before_compression_bytes > 0
    ? ((1 - stats.after_compression_bytes / stats.before_compression_bytes) * 100).toFixed(1)
    : '0';

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Platform &mdash; Tiger Cloud</h1>
          <p className="text-sm text-slate-500 mt-1">TimescaleDB performance metrics and architecture showcase</p>
        </div>
        <QueryTimer queryMs={queryMs} />
      </div>

      {/* Key metrics */}
      <div>
        <h2 className="section-title mb-4">Database Performance</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KPICard label="Telemetry Rows" value={formatNumber(stats.telemetry_row_count)} />
          <KPICard label="Compression Ratio" value={`${stats.compression_ratio}x`} />
          <KPICard label="Storage Savings" value={`${savingsPct}%`} />
          <KPICard label="Continuous Aggregates" value={stats.continuous_aggregates} />
          <KPICard label="Total Chunks" value={stats.chunk_count} />
          <KPICard label="Query Latency" value={`${queryMs}`} unit="ms" />
        </div>
      </div>

      {/* Compression detail */}
      <div className="card">
        <div className="card-header">
          <h3 className="section-title">Columnstore Compression</h3>
        </div>
        <div className="card-body space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="text-center">
              <p className="kpi-label">Before Compression</p>
              <p className="text-3xl font-bold text-slate-400 mt-2">{formatBytes(stats.before_compression_bytes)}</p>
            </div>
            <div className="text-center flex flex-col items-center justify-center">
              <svg className="w-8 h-8 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
              <p className="text-sm font-semibold text-brand-600 mt-1">{stats.compression_ratio}x reduction</p>
            </div>
            <div className="text-center">
              <p className="kpi-label">After Compression</p>
              <p className="text-3xl font-bold text-brand-600 mt-2">{formatBytes(stats.after_compression_bytes)}</p>
            </div>
          </div>

          {/* Visual bar */}
          <div>
            <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
              <span>Storage footprint</span>
              <span>{savingsPct}% savings</span>
            </div>
            <div className="h-8 bg-slate-100 rounded-lg overflow-hidden relative">
              <div className="absolute inset-y-0 left-0 bg-slate-300 rounded-lg" style={{ width: '100%' }}>
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-slate-600">Uncompressed</span>
              </div>
              <div
                className="absolute inset-y-0 left-0 bg-brand-500 rounded-lg transition-all duration-1000"
                style={{ width: `${Math.max(5, 100 / Math.max(1, stats.compression_ratio))}%` }}
              >
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-white font-medium">Compressed</span>
              </div>
            </div>
          </div>

          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-sm text-slate-600">
              <strong>How it works:</strong> Tiger Cloud&apos;s columnstore compression automatically converts older time-series chunks
              from row-oriented to column-oriented storage. For BESS telemetry data with many numeric columns,
              this typically achieves 10-20x compression through delta encoding, dictionary compression, and LZ4.
              Compressed data remains fully queryable with no application changes.
            </p>
          </div>
        </div>
      </div>

      {/* Chunk details */}
      <div className="card">
        <div className="card-header">
          <h3 className="section-title">Chunk Management</h3>
        </div>
        <div className="card-body">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <p className="text-sm font-medium text-slate-700 mb-3">Chunk Status</p>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Total chunks</span>
                  <span className="font-semibold">{stats.chunk_count}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Compressed</span>
                  <span className="font-semibold text-brand-600">{stats.compressed_chunk_count}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">Uncompressed (recent)</span>
                  <span className="font-semibold">{stats.chunk_count - stats.compressed_chunk_count}</span>
                </div>
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700 mb-3">Policies</p>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-brand-500"></span>
                  <span className="text-slate-600">Compress telemetry after <strong>2 days</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                  <span className="text-slate-600">Compress alarms/dispatch after <strong>7 days</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-500"></span>
                  <span className="text-slate-600">Drop raw telemetry after <strong>90 days</strong></span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                  <span className="text-slate-600">Retain aggregates <strong>indefinitely</strong></span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Continuous Aggregates */}
      <div className="card">
        <div className="card-header">
          <h3 className="section-title">Continuous Aggregates</h3>
        </div>
        <div className="card-body">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase tracking-wider border-b border-slate-100">
                <th className="py-2 pr-4">View</th>
                <th className="py-2 pr-4">Resolution</th>
                <th className="py-2 pr-4">Refresh Interval</th>
                <th className="py-2 pr-4">Source</th>
                <th className="py-2">Use Case</th>
              </tr>
            </thead>
            <tbody>
              {[
                { view: 'telemetry_1min', res: '1 minute', refresh: 'Every 1 min', source: 'telemetry_raw', use: 'Real-time dashboards, recent site views' },
                { view: 'telemetry_15min', res: '15 minutes', refresh: 'Every 15 min', source: 'telemetry_raw', use: 'Intraday analysis, 4-48h views' },
                { view: 'telemetry_1hour', res: '1 hour', refresh: 'Every 1 hr', source: 'telemetry_raw', use: 'Historical trends, 7d+ views' },
                { view: 'alarms_hourly', res: '1 hour', refresh: 'Every 1 hr', source: 'alarms_events', use: 'Alarm trend analysis' },
              ].map(agg => (
                <tr key={agg.view} className="border-b border-slate-50">
                  <td className="py-3 pr-4 font-mono text-xs text-brand-600">{agg.view}</td>
                  <td className="py-3 pr-4">{agg.res}</td>
                  <td className="py-3 pr-4">{agg.refresh}</td>
                  <td className="py-3 pr-4 font-mono text-xs">{agg.source}</td>
                  <td className="py-3 text-slate-600">{agg.use}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="bg-slate-50 rounded-lg p-4 mt-4">
            <p className="text-sm text-slate-600">
              <strong>How it works:</strong> Continuous aggregates are automatically materialized views that incrementally
              compute rollups as new data arrives. The query layer automatically selects the optimal resolution based on
              the requested time range, keeping dashboard queries fast (&lt;50ms) regardless of raw data volume.
            </p>
          </div>
        </div>
      </div>

      {/* Architecture */}
      <div className="card">
        <div className="card-header">
          <h3 className="section-title">Architecture</h3>
        </div>
        <div className="card-body">
          <div className="bg-slate-900 rounded-lg p-6 font-mono text-sm text-slate-300 overflow-auto">
            <pre>{`┌──────────────────────────────────────────────────┐
│                 Tiger Cloud                       │
│                (TimescaleDB)                      │
├──────────────────────────────────────────────────┤
│                                                   │
│  Hypertables (5)                                  │
│  ├── telemetry_raw     [1-day chunks]            │
│  ├── alarms_events     [7-day chunks]            │
│  ├── dispatch_commands [7-day chunks]            │
│  ├── market_price_signals [1-day chunks]         │
│  └── maintenance_logs  [30-day chunks]           │
│                                                   │
│  Continuous Aggregates (4)                        │
│  ├── telemetry_1min   ← auto-refresh 1m          │
│  ├── telemetry_15min  ← auto-refresh 15m         │
│  ├── telemetry_1hour  ← auto-refresh 1h          │
│  └── alarms_hourly    ← auto-refresh 1h          │
│                                                   │
│  Compression Policies                             │
│  ├── telemetry_raw    → compress after 2 days    │
│  ├── alarms_events    → compress after 7 days    │
│  ├── dispatch_commands→ compress after 7 days    │
│  ├── market_prices    → compress after 3 days    │
│  └── maintenance_logs → compress after 30 days   │
│                                                   │
│  Retention Policies                               │
│  ├── telemetry_raw    → drop after 90 days       │
│  ├── alarms_events    → drop after 365 days      │
│  └── market_prices    → drop after 365 days      │
│                                                   │
└──────────────────────────────────────────────────┘`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}
