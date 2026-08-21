import { useState, useId } from 'react';
import { SERIES, CHART_INK, formatAxisMoney, niceCeiling } from './palette';
import { formatAud } from '../../lib/format';

const W = 900;
const PANEL_H = 116;
const PANEL_GAP = 26;
const PAD = { top: 12, right: 12, bottom: 28, left: 58 };
const PLOT_W = W - PAD.left - PAD.right;
const H = PAD.top + PANEL_H * 2 + PANEL_GAP + PAD.bottom;

const MAX_BAR = 24; // cap it — the band's leftover is air
const GAP = 2;      // surface gap between touching marks

function periodLabel(period, granularity) {
  const [y, m, d] = period.split('-').map(Number);
  if (granularity === 'month') {
    return new Date(y, m - 1, 1).toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
  }
  return new Date(y, m - 1, d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

/**
 * Purchases and sales over time, as small multiples.
 *
 * These two series are both AUD but live at completely different magnitudes: the
 * yard writes a hundred small dockets a month and ships a handful of containers
 * worth six figures each. Plotted on one shared scale the purchases flatten into
 * invisible stubs; plotted on two y-axes in one frame the comparison would be
 * silently false. So each series gets its own panel and its own scale, stacked on
 * a shared time axis with a shared crosshair — you can still read them against
 * each other in time, without the chart implying their heights are comparable.
 */
export default function TimeSeriesChart({ data, granularity }) {
  const [hover, setHover] = useState(null);
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();

  const bandW = PLOT_W / Math.max(data.length, 1);
  const barW = Math.max(1.5, Math.min(MAX_BAR, bandW - GAP * 2));
  const labelEvery = Math.ceil(data.length / 12);

  const totals = data.reduce(
    (a, d) => ({ purchases: a.purchases + d.purchases, sales: a.sales + d.sales }),
    { purchases: 0, sales: 0 }
  );

  const panels = [
    { key: 'purchases', label: 'Purchases', color: SERIES.purchases, top: PAD.top },
    { key: 'sales', label: 'Sales', color: SERIES.sales, top: PAD.top + PANEL_H + PANEL_GAP },
  ].map((p) => ({
    ...p,
    max: niceCeiling(Math.max(1, ...data.map((d) => d[p.key]))),
  }));

  const yIn = (panel, v) => panel.top + PANEL_H - (v / panel.max) * PANEL_H;
  const hoverIndex = hover ? data.indexOf(hover) : -1;

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {panels.map((p) => (
            <span key={p.key} className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: p.color }}
                aria-hidden="true"
              />
              <span className="text-xs font-medium text-steel-700">{p.label}</span>
              <span className="num text-xs text-steel-500">{formatAud(totals[p.key])}</span>
            </span>
          ))}
          <span className="text-[11px] text-steel-400">· each panel has its own scale</span>
        </div>
        <button
          onClick={() => setShowTable((v) => !v)}
          className="text-xs font-medium text-steel-500 hover:text-copper-600"
        >
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        <div className="max-h-[300px] overflow-y-auto">
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
        <div className="relative">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full"
            role="img"
            aria-labelledby={titleId}
            onMouseLeave={() => setHover(null)}
          >
            <title id={titleId}>{`Purchases and sales by ${granularity}`}</title>

            {panels.map((panel) => (
              <g key={panel.key}>
                <text
                  x={PAD.left}
                  y={panel.top - 5}
                  fontSize="10"
                  fontWeight="600"
                  fill={CHART_INK.label}
                  className="uppercase"
                  letterSpacing="0.06em"
                >
                  {panel.label}
                </text>

                {[0, 0.5, 1].map((f) => {
                  const v = f * panel.max;
                  return (
                    <g key={f}>
                      <line
                        x1={PAD.left}
                        x2={W - PAD.right}
                        y1={yIn(panel, v)}
                        y2={yIn(panel, v)}
                        stroke={f === 0 ? CHART_INK.axis : CHART_INK.grid}
                        strokeWidth="1"
                      />
                      <text
                        x={PAD.left - 8}
                        y={yIn(panel, v) + 3.5}
                        textAnchor="end"
                        fontSize="10"
                        fill={CHART_INK.label}
                        fontFamily="IBM Plex Mono, monospace"
                      >
                        {formatAxisMoney(v)}
                      </text>
                    </g>
                  );
                })}

                {data.map((d, i) => {
                  const v = d[panel.key];
                  if (v <= 0) return null;
                  const x = PAD.left + i * bandW + (bandW - barW) / 2;
                  const top = yIn(panel, v);
                  const barH = Math.max(2, panel.top + PANEL_H - top);
                  const r = Math.min(4, barW / 2, barH);
                  return (
                    <path
                      key={d.period}
                      d={`M${x},${panel.top + PANEL_H} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + barW - r},${top} Q${x + barW},${top} ${x + barW},${top + r} L${x + barW},${panel.top + PANEL_H} Z`}
                      fill={panel.color}
                      opacity={hoverIndex >= 0 && hoverIndex !== i ? 0.4 : 1}
                      pointerEvents="none"
                    />
                  );
                })}
              </g>
            ))}

            {/* Shared crosshair + hit targets spanning both panels */}
            {data.map((d, i) => {
              const bandX = PAD.left + i * bandW;
              return (
                <rect
                  key={d.period}
                  x={bandX}
                  y={PAD.top}
                  width={bandW}
                  height={PANEL_H * 2 + PANEL_GAP}
                  fill={hoverIndex === i ? 'rgba(88,116,133,0.08)' : 'transparent'}
                  onMouseEnter={() => setHover(d)}
                />
              );
            })}

            {data.map((d, i) =>
              i % labelEvery === 0 ? (
                <text
                  key={d.period}
                  x={PAD.left + i * bandW + bandW / 2}
                  y={H - 9}
                  textAnchor="middle"
                  fontSize="10"
                  fill={CHART_INK.label}
                >
                  {periodLabel(d.period, granularity)}
                </text>
              ) : null
            )}
          </svg>

          {hover && (
            <div
              className="pointer-events-none absolute top-0 rounded-lg border border-steel-200 bg-white px-3 py-2 shadow-lg"
              style={{
                left: `${Math.min(84, ((PAD.left + hoverIndex * bandW) / W) * 100)}%`,
              }}
            >
              <div className="mb-1 text-xs font-semibold text-steel-900">
                {periodLabel(hover.period, granularity)}
              </div>
              {panels.map((p) => (
                <div key={p.key} className="flex items-center gap-2 text-xs">
                  <span
                    className="inline-block h-2 w-2 rounded-sm"
                    style={{ background: p.color }}
                    aria-hidden="true"
                  />
                  <span className="text-steel-500">{p.label}</span>
                  <span className="num ml-auto font-medium text-steel-900">
                    {formatAud(hover[p.key])}
                  </span>
                  <span className="num text-steel-400">({hover[`${p.key}Count`]})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
