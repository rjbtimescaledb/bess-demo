'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { format } from 'date-fns';

interface MarketPriceChartProps {
  data: { ts: string; market: string; price_usd_mwh: number }[];
  height?: number;
}

const MARKET_COLORS: Record<string, string> = {
  CAISO: '#1b6bf5',
  ERCOT: '#f97316',
  PJM: '#22c55e',
};

export function MarketPriceChart({ data, height = 250 }: MarketPriceChartProps) {
  // Pivot data by timestamp so each market is a separate series
  const timeMap = new Map<number, Record<string, number>>();
  for (const d of data) {
    const t = new Date(d.ts).getTime();
    if (!timeMap.has(t)) timeMap.set(t, { time: t } as Record<string, number>);
    timeMap.get(t)![d.market] = d.price_usd_mwh;
  }
  const chartData = Array.from(timeMap.values()).sort((a, b) => (a.time as number) - (b.time as number));
  const markets = [...new Set(data.map(d => d.market))];

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
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
          tickFormatter={v => `$${v}`}
        />
        <Tooltip
          labelFormatter={v => format(new Date(v as number), 'MMM d, HH:mm')}
          formatter={(value: number, name: string) => [`$${value.toFixed(2)}/MWh`, name]}
          contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {markets.map(m => (
          <Line key={m} type="monotone" dataKey={m} stroke={MARKET_COLORS[m] || '#94a3b8'} strokeWidth={1.5} dot={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
