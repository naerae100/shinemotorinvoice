import { Link } from 'react-router-dom';
import { CHART_INK } from './palette';

/**
 * A headline figure with its movement against the previous period, and a
 * sparkline for shape. Deliberately not a one-bar chart — a single current
 * value reads faster as a figure, but a figure with no context is just a
 * number, so the delta and the shape earn their place.
 */

function Sparkline({ points, color }) {
  const values = (points || []).map((p) => Number(p) || 0);
  if (values.length < 2 || values.every((v) => v === 0)) return null;

  const W = 100;
  const H = 26;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const step = W / (values.length - 1);

  const path = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(2)},${(H - ((v - min) / span) * H).toFixed(2)}`)
    .join(' ');
  const last = values[values.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H + 4}`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={path} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" opacity="0.85" />
      <circle cx={W} cy={H - ((last - min) / span) * H} r="2.5" fill={color}
        stroke={CHART_INK.surface} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Delta({ current, previous, invert }) {
  // No prior activity to compare against — say so rather than inventing "+100%".
  if (previous === null || previous === undefined) return null;
  if (previous === 0) {
    return current === 0 ? (
      <span className="text-xs text-steel-400">No change</span>
    ) : (
      <span className="text-xs text-steel-500">No prior activity</span>
    );
  }

  const pct = ((current - previous) / Math.abs(previous)) * 100;
  const flat = Math.abs(pct) < 0.5;
  const good = invert ? pct < 0 : pct > 0;

  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-medium ${
        flat ? 'text-steel-400' : good ? 'text-working-green' : 'text-working-red'
      }`}
    >
      {!flat && (
        <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" fill="currentColor" aria-hidden="true">
          <path d={pct > 0 ? 'M5 0l5 7H0z' : 'M5 10L0 3h10z'} />
        </svg>
      )}
      {flat ? 'Level' : `${Math.abs(pct).toFixed(pct >= 100 ? 0 : 1)}%`}
      <span className="font-normal text-steel-400">vs previous</span>
    </span>
  );
}

export default function StatTile({
  label,
  value,
  sub,
  accent,
  tone = 'default',
  current,
  previous,
  invertDelta = false,
  spark,
  sparkColor,
  to,
  linkLabel,
}) {
  const toneClass =
    tone === 'positive'
      ? 'text-working-green'
      : tone === 'negative'
        ? 'text-working-red'
        : accent
          ? 'text-copper-600'
          : 'text-steel-900';

  // A headline figure is a question ("34 dockets — which ones?"), so where there
  // is an answer to show, the whole tile is the way through to it.
  const Wrapper = to ? Link : 'div';
  const wrapperProps = to ? { to } : {};

  return (
    <Wrapper
      {...wrapperProps}
      className={`group relative block overflow-hidden rounded-xl border border-steel-200 bg-white p-5 shadow-ticket transition-all ${
        to
          ? 'hover:-translate-y-0.5 hover:border-copper-300 hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-copper-500'
          : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-steel-500">
          {label}
        </div>
        {to && (
          <svg
            viewBox="0 0 16 16"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-steel-300 transition-colors group-hover:text-copper-500"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <div className={`num mt-1.5 text-[26px] font-semibold leading-none tracking-tight ${toneClass}`}>
        {value}
      </div>

      <div className="mt-2 flex min-h-[18px] items-center gap-2">
        <Delta current={current} previous={previous} invert={invertDelta} />
      </div>

      {sub && <div className="mt-0.5 text-xs text-steel-500">{sub}</div>}

      {spark && (
        <div className="-mx-1 mt-3">
          <Sparkline points={spark} color={sparkColor || CHART_INK.axis} />
        </div>
      )}

      {to && linkLabel && (
        <div className="mt-2 text-xs font-medium text-copper-600 opacity-0 transition-opacity group-hover:opacity-100">
          {linkLabel} →
        </div>
      )}
    </Wrapper>
  );
}
