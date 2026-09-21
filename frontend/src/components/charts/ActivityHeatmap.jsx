import { useMemo } from 'react';
import { CHART_INK, SERIES } from './palette';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** 6am to 6pm — the yard's working day. Outside it the grid is all empty. */
const HOURS = Array.from({ length: 13 }, (_, i) => i + 6);

/** "6a", "12p", "6p" — short enough to sit over a column without colliding. */
function hourLabel(h) {
  const suffix = h < 12 ? 'a' : 'p';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${suffix}`;
}

/**
 * Five steps rather than a continuous opacity ramp.
 *
 * A continuous ramp against a single busiest cell means one exceptional
 * morning flattens every other cell to nearly nothing, and the grid stops
 * distinguishing a quiet hour from a steady one. Discrete steps keep the
 * middle of the range legible, and they are what makes a key possible — a
 * reader can match a square to a number instead of guessing at a shade.
 */
const STEPS = [0.18, 0.36, 0.56, 0.78, 1];

function stepFor(count, max) {
  if (count <= 0) return null;
  const i = Math.ceil((count / max) * STEPS.length) - 1;
  return STEPS[Math.min(Math.max(i, 0), STEPS.length - 1)];
}

export default function ActivityHeatmap({ data = [] }) {
  const maxCount = useMemo(() => Math.max(1, ...data.map((d) => d.count)), [data]);

  const lookup = useMemo(() => {
    const map = new Map();
    for (const d of data) map.set(`${d.weekday}-${d.hour}`, d.count);
    return map;
  }, [data]);

  const total = useMemo(() => data.reduce((a, d) => a + d.count, 0), [data]);

  return (
    <div className="w-full">
      {/* 380px did not fit: in a three-column row on the tablet each card has
          about 284px of content width, so the grid was clipped at the card's
          edge with a scrollbar nobody would think to use on a chart. Sized to
          fit that column, with a tighter gap to give the cells the room back.
          It still scrolls below that, which is only a narrow phone. */}
      <div className="overflow-x-auto pb-1">
        <div className="min-w-[272px]">
          {/* The hour row is built exactly like a day row — the same gutter
              width and the same gap between cells. It used to be a plain flex
              row with a margin instead, so the labels drifted steadily out of
              line with the columns they name and the right-hand ones
              overlapped each other and were clipped by the card. */}
          <div className="mb-1.5 flex items-end">
            <div className="w-7 shrink-0" />
            <div className="flex flex-1 gap-[3px]">
              {HOURS.map((h, i) => (
                <div
                  key={h}
                  className="flex-1 text-center text-[10px] font-medium tabular-nums text-steel-400"
                >
                  {/* Every second hour. Thirteen labels in this width collide
                      no matter how they are set. */}
                  {i % 2 === 0 ? hourLabel(h) : ' '}
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-[3px]">
            {DAYS.map((day, dIdx) => {
              const isoDay = dIdx + 1;
              return (
                <div key={day} className="flex items-center">
                  <div className="w-7 shrink-0 pr-1.5 text-right text-[10px] font-medium text-steel-500">
                    {day}
                  </div>
                  <div className="flex flex-1 gap-[3px]">
                    {HOURS.map((h) => {
                      const count = lookup.get(`${isoDay}-${h}`) || 0;
                      const step = stepFor(count, maxCount);
                      return (
                        <div
                          key={h}
                          title={
                            count
                              ? `${count} ${count === 1 ? 'docket' : 'dockets'} · ${day} ${hourLabel(h)}`
                              : `No dockets · ${day} ${hourLabel(h)}`
                          }
                          className="aspect-square flex-1 rounded-[3px] transition-transform hover:scale-110"
                          style={{
                            backgroundColor: step ? SERIES.purchases : CHART_INK.grid,
                            opacity: step ?? 1,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* A key, because a shade on its own is not a quantity. Only shown when
          there is something to compare — on an empty period it would be five
          squares explaining nothing. */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 pl-7 text-[10px] text-steel-400">
          <span>Quiet</span>
          <span className="flex gap-0.5">
            {STEPS.map((o) => (
              <span
                key={o}
                className="h-2.5 w-2.5 rounded-[2px]"
                style={{ backgroundColor: SERIES.purchases, opacity: o }}
              />
            ))}
          </span>
          <span>Busy</span>
          <span className="ml-auto tabular-nums">
            busiest hour: {maxCount} {maxCount === 1 ? 'docket' : 'dockets'}
          </span>
        </div>
      )}
    </div>
  );
}
