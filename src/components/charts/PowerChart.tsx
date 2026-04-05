'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';

interface PowerChartProps {
  data: { time: string; site_power_mw: number; charge_power_mw: number; discharge_power_mw: number }[];
  height?: number;
}

export function PowerChart({ data, height = 300 }: PowerChartProps) {
  const formatted = data.map(d => ({
    ...d,
    time: new Date(d.time).getTime(),
    charge: -Math.abs(d.charge_power_mw || 0),
    discharge: Math.abs(d.discharge_power_mw || 0),
    net: d.site_power_mw,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis
          dataKey="time"
          type="number"
          domain={['dataMin', 'dataMax']}
          tickFormatter={v => format(new Date(v), 'HH:mm')}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          stroke="#cbd5e1"
        />
        <YAxis
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          stroke="#cbd5e1"
          tickFormatter={v => `${v} MW`}
        />
        <Tooltip
          labelFormatter={v => format(new Date(v as number), 'MMM d, HH:mm:ss')}
          formatter={(value: number, name: string) => [`${value.toFixed(1)} MW`, name === 'charge' ? 'Charge' : name === 'discharge' ? 'Discharge' : 'Net Power']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <ReferenceLine y={0} stroke="#94a3b8" strokeDasharray="3 3" />
        <Area type="monotone" dataKey="charge" stroke="#16a34a" fill="#22c55e" fillOpacity={0.3} name="charge" />
        <Area type="monotone" dataKey="discharge" stroke="#ea580c" fill="#f97316" fillOpacity={0.3} name="discharge" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
