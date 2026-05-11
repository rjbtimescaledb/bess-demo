'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';

interface SoHDegradationChartProps {
  data: { day: string; avg_soh: number }[];
  height?: number;
}

export function SoHDegradationChart({ data, height = 300 }: SoHDegradationChartProps) {
  const formatted = data.map(d => ({
    time: new Date(d.day).getTime(),
    soh: Number(d.avg_soh),
  }));

  // Calculate domain: show enough range to see the degradation curve
  const values = formatted.map(d => d.soh).filter(v => v > 0);
  const min = values.length ? Math.floor(Math.min(...values) * 10) / 10 : 95;
  const max = values.length ? Math.ceil(Math.max(...values) * 10) / 10 : 100;
  const padding = (max - min) * 0.1 || 0.5;
  const yMin = Math.max(90, min - padding);
  const yMax = Math.min(100, max + padding);

  // Determine date format based on data range
  const rangeMs = formatted.length > 1 ? formatted[formatted.length - 1].time - formatted[0].time : 0;
  const rangeDays = rangeMs / 86_400_000;
  const dateFormat = rangeDays > 365 ? 'MMM yyyy' : rangeDays > 60 ? 'MMM d' : 'MMM d';

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="sohGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={v => format(new Date(v), dateFormat)}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          stroke="#cbd5e1"
        />
        <YAxis
          domain={[yMin, yMax]}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          stroke="#cbd5e1"
          tickFormatter={v => `${v}%`}
        />
        <Tooltip
          labelFormatter={v => format(new Date(v as number), 'MMM d, yyyy')}
          formatter={(value: number) => [`${value.toFixed(3)}%`, 'SoH']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <ReferenceLine y={95} stroke="#eab308" strokeDasharray="3 3" label={{ value: 'Watch', fontSize: 10, fill: '#eab308' }} />
        <ReferenceLine y={92} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Critical', fontSize: 10, fill: '#ef4444' }} />
        <Area type="monotone" dataKey="soh" stroke="#10b981" fill="url(#sohGradient)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
