import { useMemo } from 'react';

const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function startOfWeek(d) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  return x;
}

/** The ranges a yard actually asks for, rather than a generic calendar. */
export const PRESETS = {
  today: () => {
    const n = new Date();
    return { from: toISODate(n), to: toISODate(n), label: 'Today' };
  },
  yesterday: () => {
    const n = new Date();
    n.setDate(n.getDate() - 1);
    return { from: toISODate(n), to: toISODate(n), label: 'Yesterday' };
  },
  thisWeek: () => {
    const n = new Date();
    return { from: toISODate(startOfWeek(n)), to: toISODate(n), label: 'This week' };
  },
  lastWeek: () => {
    const n = new Date();
    const start = startOfWeek(n);
    start.setDate(start.getDate() - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { from: toISODate(start), to: toISODate(end), label: 'Last week' };
  },
  thisMonth: () => {
    const n = new Date();
    return {
      from: toISODate(new Date(n.getFullYear(), n.getMonth(), 1)),
      to: toISODate(n),
      label: 'This month',
    };
  },
  lastMonth: () => {
    const n = new Date();
    return {
      from: toISODate(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
      to: toISODate(new Date(n.getFullYear(), n.getMonth(), 0)),
      label: 'Last month',
    };
  },
  last90: () => {
    const n = new Date();
    const s = new Date();
    s.setDate(s.getDate() - 89);
    return { from: toISODate(s), to: toISODate(n), label: 'Last 90 days' };
  },
  thisFinancialYear: () => {
    // Australian FY runs 1 July – 30 June
    const n = new Date();
    const startYear = n.getMonth() >= 6 ? n.getFullYear() : n.getFullYear() - 1;
    return {
      from: toISODate(new Date(startYear, 6, 1)),
      to: toISODate(n),
      label: 'This financial year',
    };
  },
};

const PRESET_ORDER = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'last90',
  'thisFinancialYear',
];

export default function DateRangePicker({ from, to, granularity, onChange, showGranularity = true }) {
  const activePreset = useMemo(
    () => PRESET_ORDER.find((k) => {
      const p = PRESETS[k]();
      return p.from === from && p.to === to;
    }),
    [from, to]
  );

  const dayCount = useMemo(() => {
    if (!from || !to) return 0;
    return Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  }, [from, to]);

  function applyPreset(key) {
    const p = PRESETS[key]();
    const span = Math.round((new Date(p.to) - new Date(p.from)) / 86400000) + 1;
    // Pick a sensible bucket size so a year doesn't render 365 columns
    const g = span > 180 ? 'month' : span > 45 ? 'week' : 'day';
    onChange({ from: p.from, to: p.to, granularity: g });
  }

  const field =
    'rounded-md border border-steel-200 bg-white px-2.5 py-1.5 text-sm text-steel-800 focus:border-copper-500';

  return (
    <div className="space-y-2.5">
      {/* On a phone eight wrapped buttons became an eight-line vertical stack
          that pushed the whole page down. A single scrolling row of chips keeps
          it to one line and stays thumb-friendly. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:flex-wrap lg:overflow-visible">
        {PRESET_ORDER.map((key) => (
          <button
            key={key}
            onClick={() => applyPreset(key)}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors lg:py-1.5 ${
              activePreset === key
                ? 'bg-steel-900 text-paper'
                : 'border border-steel-200 bg-white text-steel-600 hover:bg-steel-100'
            }`}
          >
            {PRESETS[key]().label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:flex-initial">
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => onChange({ from: e.target.value, to, granularity })}
            className={`num min-w-0 flex-1 ${field} sm:flex-initial`}
            aria-label="From date"
          />
          <span className="shrink-0 text-sm text-steel-400">to</span>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => onChange({ from, to: e.target.value, granularity })}
            className={`num min-w-0 flex-1 ${field} sm:flex-initial`}
            aria-label="To date"
          />
        </div>
        {showGranularity && (
          <select
            value={granularity}
            onChange={(e) => onChange({ from, to, granularity: e.target.value })}
            className={field}
            aria-label="Group by"
          >
            <option value="day">By day</option>
            <option value="week">By week</option>
            <option value="month">By month</option>
          </select>
        )}
        <span className="num whitespace-nowrap text-xs text-steel-400">
          {dayCount} {dayCount === 1 ? 'day' : 'days'}
        </span>
      </div>
    </div>
  );
}
