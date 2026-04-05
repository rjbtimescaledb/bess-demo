'use client';

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { format } from 'date-fns';

interface SoCChartProps {
  data: { time: string; state_of_charge_pct: number }[];
  height?: number;
}

export function SoCChart({ data, height = 250 }: SoCChartProps) {
  const formatted = data.map(d => ({
    time: new Date(d.time).getTime(),
    soc: d.state_of_charge_pct,
  }));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={formatted} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
        <defs>
          <linearGradient id="socGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#338cff" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#338cff" stopOpacity={0.05} />
          </linearGradient>
        </defs>
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
          domain={[0, 100]}
          tick={{ fontSize: 11, fill: '#94a3b8' }}
          stroke="#cbd5e1"
          tickFormatter={v => `${v}%`}
        />
        <Tooltip
          labelFormatter={v => format(new Date(v as number), 'MMM d, HH:mm:ss')}
          formatter={(value: number) => [`${value.toFixed(1)}%`, 'SoC']}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <ReferenceLine y={20} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Low', fontSize: 10, fill: '#ef4444' }} />
        <ReferenceLine y={90} stroke="#eab308" strokeDasharray="3 3" label={{ value: 'High', fontSize: 10, fill: '#eab308' }} />
        <Area type="monotone" dataKey="soc" stroke="#1b6bf5" fill="url(#socGradient)" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
