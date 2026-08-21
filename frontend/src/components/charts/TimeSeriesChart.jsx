import { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { SERIES, CHART_INK, formatAxisMoney } from './palette';
import { formatAud } from '../../lib/format';

function periodLabel(period, granularity) {
  const [y, m, d] = period.split('-').map(Number);
  if (granularity === 'month') {
    return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
  }
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function Tip({ active, payload, label, series }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-lg border border-steel-200 bg-white px-3 py-2 shadow-lg">
      <div className="mb-1 text-xs font-semibold text-steel-900">{label}</div>
      <div className="flex items-center gap-2 text-xs">
        <span
          className="inline-block h-2 w-2 rounded-sm"
          style={{ background: series.color }}
          aria-hidden="true"
        />
        <span className="text-steel-500">{series.label}</span>
        <span className="num ml-auto font-medium text-steel-900">
          {formatAud(row[series.key])}
        </span>
        <span className="num text-steel-400">({row[`${series.key}Count`] ?? 0})</span>
      </div>
    </div>
  );
}

/** One panel of the small multiple — its own y-scale, shared x-axis below. */
function Panel({ data, series, granularity, showAxis }) {
  const gradientId = `grad-${series.key}`;
  const hasData = series.hasData ?? data.some((d) => Number(d[series.key]) > 0);

  const header = (
    <div className="mb-1 flex items-baseline gap-2">
      <span
        className="inline-block h-2.5 w-2.5 rounded-sm"
        style={{ background: series.color }}
        aria-hidden="true"
      />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-steel-600">
        {series.label}
      </span>
      <span className="num text-xs text-steel-500">{formatAud(series.total)}</span>
    </div>
  );

  // Plotting nothing produced a full-height panel with a meaningless $0-$1-$2
  // axis, which reads as a broken chart rather than an empty period. Say it
  // plainly and give the space back to the series that does have data.
  if (!hasData) {
    return (
      <div>
        {header}
        <div className="flex h-[60px] items-center justify-center rounded-lg border border-dashed border-steel-200 bg-paper/50">
          <span className="text-xs text-steel-400">
            No {series.label.toLowerCase()} recorded in this period
          </span>
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <ResponsiveContainer width="100%" height={showAxis ? 150 : 128}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: showAxis ? 0 : 4 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={series.color} stopOpacity={0.18} />
              <stop offset="100%" stopColor={series.color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={CHART_INK.grid} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="formattedPeriod"
            hide={!showAxis}
            tick={{ fontSize: 10, fill: CHART_INK.label }}
            axisLine={{ stroke: CHART_INK.axis }}
            tickLine={false}
            minTickGap={24}
          />
          <YAxis
            width={54}
            tick={{ fontSize: 10, fill: CHART_INK.label, fontFamily: 'IBM Plex Mono, monospace' }}
            axisLine={false}
            tickLine={false}
            tickCount={3}
            tickFormatter={formatAxisMoney}
          />
          <Tooltip
            content={<Tip series={series} />}
            cursor={{ stroke: CHART_INK.axis, strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey={series.key}
            name={series.label}
            stroke={series.color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            // Off by default: the sweep-in made the dashboard look empty for a
            // beat on every load, which reads as "still loading".
            isAnimationActive={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: CHART_INK.surface, fill: series.color }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Purchases and sales over time, as small multiples.
 *
 * These are both AUD but live at completely different magnitudes: the yard writes
 * a hundred small dockets a month and ships a handful of containers worth six
 * figures each. On one shared scale the purchases flatten to a smear along the
 * baseline — measured at 3% of the plot height against 94% for sales — so the
 * main business becomes invisible. Two y-axes in one frame would be worse: it
 * would imply the two heights are comparable when they are not. Each series gets
 * its own panel and its own scale, stacked on a shared time axis.
 */
export default function TimeSeriesChart({ data, granularity }) {
  const [showTable, setShowTable] = useState(false);

  const chartData = data.map((d) => ({
    ...d,
    formattedPeriod: periodLabel(d.period, granularity),
  }));

  const totals = data.reduce(
    (a, d) => ({ purchases: a.purchases + d.purchases, sales: a.sales + d.sales }),
    { purchases: 0, sales: 0 }
  );

  const panels = [
    { key: 'purchases', label: 'Purchases', color: SERIES.purchases, total: totals.purchases },
    { key: 'sales', label: 'Sales', color: SERIES.sales, total: totals.sales },
  ].map((p) => ({ ...p, hasData: data.some((d) => Number(d[p.key]) > 0) }));

  // The shared date axis belongs to the last panel that actually draws a chart.
  // Pinning it to the last panel outright meant an empty series at the bottom
  // silently removed the axis from the whole figure.
  const axisPanelKey = [...panels].reverse().find((p) => p.hasData)?.key ?? null;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <span className="text-[11px] text-steel-400">
          Each panel has its own scale — heights are not comparable between them
        </span>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-xs font-medium text-steel-500 hover:text-copper-600"
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-white">
              <tr className="border-b border-steel-200 text-left text-xs uppercase tracking-wider text-steel-500">
                <th className="py-2 font-medium">Period</th>
                <th className="py-2 text-right font-medium">Purchases</th>
                <th className="py-2 text-right font-medium">Sales</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.period} className="border-b border-steel-100 last:border-0">
                  <td className="py-1.5 text-steel-700">{periodLabel(d.period, granularity)}</td>
                  <td className="num py-1.5 text-right text-steel-900">{formatAud(d.purchases)}</td>
                  <td className="num py-1.5 text-right text-steel-900">{formatAud(d.sales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {panels.map((series, i) => (
            <Panel
              key={series.key}
              data={chartData}
              series={series}
              granularity={granularity}
              showAxis={series.key === axisPanelKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}
