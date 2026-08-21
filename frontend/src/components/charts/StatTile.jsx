import { formatAud } from '../../lib/format';

/**
 * A headline number. Deliberately not a one-bar chart — a single current value
 * reads faster as a figure than as a plot.
 */
export default function StatTile({ label, value, sub, accent, tone = 'default', hero = false }) {
  const toneClass =
    tone === 'positive'
      ? 'text-working-green'
      : tone === 'negative'
        ? 'text-working-red'
        : accent
          ? 'text-copper-600'
          : 'text-steel-900';

  return (
    <div className="rounded-xl border border-steel-200 bg-white p-5 shadow-ticket">
      <div className="text-xs font-medium uppercase tracking-wider text-steel-500">{label}</div>
      <div className={`num mt-2 font-semibold ${hero ? 'text-4xl' : 'text-3xl'} ${toneClass}`}>
        {value}
      </div>
      {sub && <div className="mt-1 text-sm text-steel-500">{sub}</div>}
    </div>
  );
}

export const money = formatAud;
