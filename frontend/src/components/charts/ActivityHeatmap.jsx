import { useMemo } from 'react';
import { CHART_INK, SERIES } from './palette';

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export default function ActivityHeatmap({ data = [] }) {
  const maxCount = useMemo(() => Math.max(1, ...data.map((d) => d.count)), [data]);

  // ISODOW: 1=Monday, 7=Sunday
  // Hours: 6am to 6pm is the yard's active day, so we crop the grid to 6..18
  const HOURS = Array.from({ length: 13 }, (_, i) => i + 6);

  const lookup = useMemo(() => {
    const map = new Map();
    for (const d of data) map.set(`${d.weekday}-${d.hour}`, d.count);
    return map;
  }, [data]);

  return (
    <div className="w-full overflow-x-auto pb-2">
      <div className="min-w-[400px]">
        <div className="flex text-[10px] text-steel-400 mb-1 ml-8">
          {HOURS.map((h) => (
            <div key={h} className="flex-1 text-center font-medium">
              {h}:00
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-1">
          {DAYS.map((day, dIdx) => {
            const isoDay = dIdx + 1;
            return (
              <div key={day} className="flex items-center">
                <div className="w-8 text-[11px] font-medium text-steel-500 text-right pr-2">
                  {day}
                </div>
                <div className="flex-1 flex gap-1">
                  {HOURS.map((h) => {
                    const count = lookup.get(`${isoDay}-${h}`) || 0;
                    const opacity = count === 0 ? 0.05 : Math.max(0.15, count / maxCount);
                    return (
                      <div
                        key={h}
                        title={`${count} dockets on ${day} at ${h}:00`}
                        className="flex-1 aspect-square rounded-[3px] transition-opacity hover:opacity-80"
                        style={{ 
                          backgroundColor: count > 0 ? SERIES.purchases : CHART_INK.grid,
                          opacity: count > 0 ? opacity : 1
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
  );
}
