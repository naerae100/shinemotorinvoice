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
import { SERIES, CHART_INK, formatAxisMoney, currencyColor } from './palette';
import { formatMoney } from '../../lib/format';

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
          {formatMoney(row[series.key], series.currency)}
        </span>
        <span className="num text-steel-400">({row[`${series.key}Count`] ?? 0})</span>
      </div>
    </div>
  );
}

/** One panel of the small multiple — its own y-scale, shared x-axis below. */
function Panel({ data, series, showAxis }) {
  const gradientId = `grad-${series.key}`;
  const hasData = series.hasData ?? data.some((d) => Number(d[series.key]) > 0);

  const header = (
    <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span
        className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
        style={{ background: series.color }}
        aria-hidden="true"
      />
      <span className="text-[11px] font-semibold uppercase tracking-wider text-steel-600">
        {series.label}
      </span>
      <span className="num text-xs text-steel-500">
        {formatMoney(series.total, series.currency)}
      </span>
    </div>
  );

  // Plotting nothing produced a full-height panel with a meaningless $0-$1-$2
  // axis, which reads as a broken chart rather than an empty period. Say it
  // plainly and give the space back to the series that does have data.
  if (!hasData) {
    return (
      <div>
        {header}
        <div className="flex h-[60px] items-center justify-center rounded-lg border border-dashed border-steel-200 bg-paper/50 px-3">
          <span className="text-center text-xs text-steel-400">
            No {series.noun} recorded in this period
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
            // A named currency needs the room the bare dollar sign did not.
            width={series.currency === 'AUD' ? 54 : 78}
            tick={{ fontSize: 10, fill: CHART_INK.label, fontFamily: 'IBM Plex Mono, monospace' }}
            axisLine={false}
            tickLine={false}
            tickCount={3}
            tickFormatter={(v) => formatAxisMoney(v, series.currency)}
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
 * Buying and selling over time, as small multiples — one panel per series.
 *
 * Two reasons there is a panel per series rather than one shared frame:
 *
 *   Magnitude. Purchases and sales are both AUD but live at completely
 *   different scales — the yard writes a hundred small dockets a month and
 *   ships a handful of containers worth six figures each. On one shared scale
 *   the purchases flatten to a smear along the baseline, measured at 3% of the
 *   plot height against 94% for sales, so the main business becomes invisible.
 *
 *   Currency. A container sold in USD cannot share an axis with an AUD figure
 *   at all: there is no exchange rate in this system, and drawing the two
 *   against one scale would assert a conversion nobody entered. Each currency
 *   gets its own panel, its own axis and its own total, and nothing is ever
 *   summed across them.
 *
 * The USD panel is the reason this file changed: sales were queried with
 * `currency = 'AUD'`, so the chart drew a flat line under tiles that were
 * simultaneously reporting a USD sale.
 */
export default function TimeSeriesChart({ data, granularity, currencies = ['AUD'] }) {
  const [showTable, setShowTable] = useState(false);

  const chartData = data.map((d) => ({
    ...d,
    formattedPeriod: periodLabel(d.period, granularity),
  }));

  // AUD sales are the `sales` key for historical reasons; every other currency
  // is `sales_USD`, `sales_NZD` and so on, as the overview endpoint emits them.
  const salesKey = (c) => (c === 'AUD' ? 'sales' : `sales_${c}`);

  const sum = (key) => data.reduce((a, d) => a + (Number(d[key]) || 0), 0);

  const panels = [
    {
      key: 'purchases',
      label: 'Purchases',
      color: SERIES.purchases,
      currency: 'AUD',
      noun: 'purchases',
      total: sum('purchases'),
    },
    ...currencies.map((c) => ({
      key: salesKey(c),
      // Named per currency even when there is only one, so a reader never has
      // to assume which dollars a panel is counting.
      label: `Sales (${c})`,
      color: currencyColor(c),
      currency: c,
      noun: `sales in ${c}`,
      total: sum(salesKey(c)),
    })),
  ].map((p) => ({ ...p, hasData: data.some((d) => Number(d[p.key]) > 0) }));

  // The shared date axis belongs to the last panel that actually draws a chart.
  // Pinning it to the last panel outright meant an empty series at the bottom
  // silently removed the axis from the whole figure.
  const axisPanelKey = [...panels].reverse().find((p) => p.hasData)?.key ?? null;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span className="text-[11px] text-steel-400">
          Each panel has its own scale — heights are not comparable between them
          {currencies.length > 1 && ', and currencies are never converted'}
        </span>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="btn-secondary btn-sm"
          aria-pressed={showTable}
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        // Scrolls in both directions: a month of days is long, and a column per
        // currency gets wide. min-w keeps the columns readable rather than
        // letting four of them crush into a tablet's width.
        <div className="-mx-1 max-h-[320px] overflow-auto px-1">
          <table className="w-full min-w-[420px] text-sm">
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-steel-200 text-left text-xs uppercase tracking-wider text-steel-500">
                <th className="whitespace-nowrap py-2 pr-3 font-semibold">Period</th>
                {panels.map((p) => (
                  <th key={p.key} className="whitespace-nowrap py-2 pl-3 text-right font-semibold">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.period} className="border-b border-steel-100 last:border-0">
                  <td className="whitespace-nowrap py-1.5 pr-3 text-steel-700">
                    {periodLabel(d.period, granularity)}
                  </td>
                  {panels.map((p) => (
                    <td
                      key={p.key}
                      className="num whitespace-nowrap py-1.5 pl-3 text-right text-steel-900"
                    >
                      {formatMoney(d[p.key] ?? 0, p.currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            {/* A period total per column. Down a column is the only direction
                these may be added — never across a row, which would be adding
                AUD to USD. */}
            <tfoot>
              <tr className="border-t-2 border-steel-200 font-semibold">
                <td className="py-2 pr-3 text-steel-700">Total</td>
                {panels.map((p) => (
                  <td
                    key={p.key}
                    className="num whitespace-nowrap py-2 pl-3 text-right text-steel-900"
                  >
                    {formatMoney(p.total, p.currency)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          {panels.map((series) => (
            <Panel
              key={series.key}
              data={chartData}
              series={series}
              showAxis={series.key === axisPanelKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}
