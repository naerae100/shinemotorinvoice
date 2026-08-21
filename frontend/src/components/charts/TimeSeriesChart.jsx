import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatAud } from '../../lib/format';

const SERIES = {
  purchases: '#587485', // steel-600
  sales: '#d97736', // copper-500
};

function periodLabel(period, granularity) {
  const [y, m, d] = period.split('-').map(Number);
  if (granularity === 'month') {
    return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
  }
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

export default function TimeSeriesChart({ data, granularity }) {
  const [showTable, setShowTable] = useState(false);

  // Format data for Recharts
  const chartData = data.map(d => ({
    ...d,
    formattedPeriod: periodLabel(d.period, granularity)
  }));

  const totals = data.reduce(
    (a, d) => ({ purchases: a.purchases + d.purchases, sales: a.sales + d.sales }),
    { purchases: 0, sales: 0 }
  );

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="rounded-lg border border-steel-200 bg-white/95 p-3 shadow-xl backdrop-blur-sm">
          <p className="mb-2 text-sm font-semibold text-steel-900">{label}</p>
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center gap-3 text-sm">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span className="capitalize text-steel-600">{entry.name}:</span>
              <span className="ml-auto font-bold text-steel-900">
                {formatAud(entry.value)}
              </span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <div className="flex flex-col h-[450px]">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded bg-copper-500 shadow-sm" />
            <span className="text-sm font-medium text-steel-700">Total Sales</span>
            <span className="font-bold text-steel-900 ml-1">{formatAud(totals.sales)}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-3 w-3 rounded bg-steel-600 shadow-sm" />
            <span className="text-sm font-medium text-steel-700">Total Purchases</span>
            <span className="font-bold text-steel-900 ml-1">{formatAud(totals.purchases)}</span>
          </div>
        </div>
        
        <button
          onClick={() => setShowTable((v) => !v)}
          className="rounded-md border border-steel-200 bg-white px-3 py-1.5 text-xs font-medium text-steel-600 shadow-sm transition hover:bg-steel-50 hover:text-copper-600"
        >
          {showTable ? 'Switch to Chart View' : 'Switch to Data Table'}
        </button>
      </div>

      {showTable ? (
        <div className="flex-1 overflow-y-auto rounded-lg border border-steel-100 shadow-inner">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-steel-50 shadow-sm">
              <tr className="text-left text-xs uppercase tracking-wider text-steel-500">
                <th className="py-3 px-4 font-semibold">Period</th>
                <th className="py-3 px-4 text-right font-semibold">Purchases</th>
                <th className="py-3 px-4 text-right font-semibold">Sales</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-steel-100">
              {chartData.map((d) => (
                <tr key={d.period} className="hover:bg-steel-50/50 transition-colors">
                  <td className="py-2.5 px-4 font-medium text-steel-800">{d.formattedPeriod}</td>
                  <td className="py-2.5 px-4 text-right font-mono text-steel-600">{formatAud(d.purchases)}</td>
                  <td className="py-2.5 px-4 text-right font-mono font-medium text-copper-700">{formatAud(d.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="flex-1 w-full relative">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={chartData}
              margin={{ top: 10, right: 10, left: 20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SERIES.sales} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={SERIES.sales} stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorPurchases" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={SERIES.purchases} stopOpacity={0.2} />
                  <stop offset="95%" stopColor={SERIES.purchases} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
              <XAxis 
                dataKey="formattedPeriod" 
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickLine={false}
                axisLine={{ stroke: '#cbd5e1' }}
                dy={10}
              />
              <YAxis 
                tickFormatter={(value) => `$${value >= 1000 ? (value / 1000).toFixed(0) + 'k' : value}`}
                tick={{ fontSize: 12, fill: '#64748b' }}
                tickLine={false}
                axisLine={false}
                dx={-10}
              />
              <Tooltip content={<CustomTooltip />} />
              <Area 
                type="monotone" 
                dataKey="sales" 
                name="Sales"
                stroke={SERIES.sales} 
                strokeWidth={3}
                fillOpacity={1} 
                fill="url(#colorSales)" 
                activeDot={{ r: 6, strokeWidth: 0, fill: SERIES.sales }}
              />
              <Area 
                type="monotone" 
                dataKey="purchases" 
                name="Purchases"
                stroke={SERIES.purchases} 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorPurchases)" 
                activeDot={{ r: 5, strokeWidth: 0, fill: SERIES.purchases }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
