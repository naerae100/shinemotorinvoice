import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CHART_INK } from './palette';
import { formatAud, formatNumber } from '../../lib/format';

/**
 * Ranked horizontal bars for a single nominal series (top materials, top clients).
 *
 * One series, so every bar takes the same hue and there is no legend box — the
 * card title already says what is plotted. Bar length carries the magnitude;
 * coloring bars by their own value would re-encode what length already shows.
 */
export default function BarList({ items, color, emptyLabel = 'No data in this period.' }) {
  const [hover, setHover] = useState(null);

  if (!items || items.length === 0) {
    return <div className="px-1 py-8 text-center text-sm text-steel-500">{emptyLabel}</div>;
  }

  const max = Math.max(...items.map((i) => i.value), 1);

  return (
    <ul className="space-y-2.5">
      {items.map((item) => {
        const pct = (item.value / max) * 100;
        const isHover = hover === item.key;
        // Every row here answers a question the reader is about to ask
        // ("which purchases were those?"), so it links to that answer.
        const Row = item.to ? Link : 'div';
        const rowProps = item.to
          ? { to: item.to, className: 'block rounded-md -mx-1.5 px-1.5 py-0.5 hover:bg-paper' }
          : {};

        return (
          <li
            key={item.key}
            onMouseEnter={() => setHover(item.key)}
            onMouseLeave={() => setHover(null)}
            className="group"
          >
           <Row {...rowProps}>
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <span
                className={`truncate text-[13px] font-medium text-steel-800 ${
                  item.to ? 'group-hover:text-copper-700' : ''
                }`}
              >
                {item.label}
              </span>
              {/* Value labelled at the tip of every bar: a short ranked list is
                  exactly the case where labelling each one stays readable. */}
              <span className="num shrink-0 text-[13px] font-semibold text-steel-900">
                {formatAud(item.value)}
              </span>
            </div>
            <div
              className="relative h-2 w-full overflow-hidden rounded-sm"
              style={{ background: CHART_INK.grid }}
            >
              <div
                className="absolute inset-y-0 left-0 rounded-r-[4px] transition-[width] duration-300"
                style={{
                  width: `${Math.max(pct, 1.5)}%`,
                  background: color,
                  opacity: hover && !isHover ? 0.5 : 1,
                }}
              />
            </div>
            {item.sub && (
              <div className="num mt-0.5 text-[11px] text-steel-400">{item.sub}</div>
            )}
           </Row>
          </li>
        );
      })}
    </ul>
  );
}

export const materialItem = (m, unit = 'kg') => ({
  key: m.material.id,
  label: m.material.description,
  value: m.value,
  sub: `${formatNumber(m.weight, 2)} ${unit}`,
});

export const clientItem = (c) => ({
  key: c.client.id,
  label: c.client.name,
  value: c.value,
  sub: `${c.count} ${c.count === 1 ? 'document' : 'documents'}`,
});
