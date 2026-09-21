import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildSeries } from '../src/routes/reports.js';
import { boundaryInstant, zonedWeekKey } from '../src/lib/timezone.js';

/**
 * The chart has to add up to the tile printed directly above it.
 *
 * It did not. A docket bought on the morning of 18 September counted in
 * "Scrap bought" and was absent from the graph, which is the worst shape a
 * reporting bug can take: both numbers look plausible, and only someone who
 * adds them up finds out. Two separate causes, one visible symptom.
 *
 * buildSeries drops any row whose period is not already one of its buckets —
 * that is deliberate, since a row outside the window should not be drawn. It
 * also means every disagreement about what a period is called turns into
 * money quietly vanishing rather than an error. These tests pin the bucket
 * keys, because the keys are the contract between this function and the SQL
 * that groups by date_trunc.
 */

/** The window the endpoint would build for a from/to pair of business days. */
function windowFor(fromDay, toDay) {
  return [boundaryInstant(fromDay, 'start'), boundaryInstant(toDay, 'end')];
}

const keysOf = (rows) => rows.map((r) => r.period);

describe('the chart buckets agree with the totals above it', () => {
  test('week buckets are Mondays whatever weekday the range starts on', () => {
    // 22 June 2026 is a Monday, so this covers every start weekday in turn.
    for (let offset = 0; offset < 7; offset += 1) {
      const day = String(22 + offset).padStart(2, '0');
      const [from, to] = windowFor(`2026-06-${day}`, '2026-09-21');
      const keys = keysOf(buildSeries(from, to, 'week', { purchases: [] }));

      for (const key of keys) {
        const [y, m, d] = key.split('-').map(Number);
        // Midday, so the weekday cannot be moved by a DST boundary.
        const weekday = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
        assert.equal(weekday, 1, `bucket ${key} (range from 2026-06-${day}) is not a Monday`);
      }
    }
  });

  test('the last week of a range gets a bucket', () => {
    // 21 September 2026 is a Monday: the final week is one day long, and
    // stepping seven days from an arbitrary start overshot it entirely.
    const [from, to] = windowFor('2026-06-24', '2026-09-21');
    const keys = keysOf(buildSeries(from, to, 'week', { purchases: [] }));
    assert.ok(
      keys.includes('2026-09-21'),
      `the week of 21 Sep is missing; last bucket was ${keys.at(-1)}`
    );
  });

  test('a row in that last week is counted, not dropped', () => {
    const [from, to] = windowFor('2026-06-24', '2026-09-21');
    const rows = buildSeries(from, to, 'week', {
      purchases: [{ period: '2026-09-21', value: 400, count: 1 }],
    });
    const total = rows.reduce((a, r) => a + r.purchases, 0);
    assert.equal(total, 400, 'the docket vanished between the query and the chart');
  });

  test('month buckets start on the first, even from a mid-month range', () => {
    const [from, to] = windowFor('2026-02-15', '2026-09-21');
    const keys = keysOf(buildSeries(from, to, 'month', { purchases: [] }));
    assert.deepEqual(keys, [
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
      '2026-08',
      '2026-09',
    ]);
  });

  test('a day range keeps every day, including both ends', () => {
    const [from, to] = windowFor('2026-09-15', '2026-09-21');
    const keys = keysOf(buildSeries(from, to, 'day', { purchases: [] }));
    assert.equal(keys.length, 7);
    assert.equal(keys[0], '2026-09-15');
    assert.equal(keys.at(-1), '2026-09-21');
  });

  test('nothing is lost: what goes in comes out', () => {
    const [from, to] = windowFor('2026-09-15', '2026-09-21');
    // The three dockets that exposed this — all bought before 10am Sydney on
    // 18 September, which is when the UTC date is still the 17th.
    const rows = buildSeries(from, to, 'day', {
      purchases: [
        { period: '2026-09-18', value: 269.278, count: 1 },
        { period: '2026-09-18', value: 227.3, count: 1 },
        { period: '2026-09-18', value: 50, count: 1 },
        { period: '2026-09-21', value: 400, count: 1 },
      ],
    });
    const total = rows.reduce((a, r) => a + r.purchases, 0);
    const count = rows.reduce((a, r) => a + r.purchasesCount, 0);
    assert.equal(total, 946.578);
    assert.equal(count, 4);
  });

  test('the week key here is the one the rest of the app uses', () => {
    // If these two ever disagree the buckets and the labels drift apart, and
    // the failure is silent.
    const mondayNoon = new Date('2026-09-21T02:00:00Z'); // midday Sydney, AEST
    assert.equal(zonedWeekKey(mondayNoon), '2026-09-21');
    const fridayNoon = new Date('2026-09-25T02:00:00Z');
    assert.equal(zonedWeekKey(fridayNoon), '2026-09-21');
  });

  test('every currency dataset is bucketed, not just the first', () => {
    const [from, to] = windowFor('2026-09-15', '2026-09-21');
    const rows = buildSeries(from, to, 'day', {
      purchases: [{ period: '2026-09-18', value: 100, count: 1 }],
      sales: [{ period: '2026-09-18', value: 200, count: 1 }],
      sales_USD: [{ period: '2026-09-18', value: 300, count: 2 }],
    });
    const day = rows.find((r) => r.period === '2026-09-18');
    assert.equal(day.purchases, 100);
    assert.equal(day.sales, 200);
    assert.equal(day.sales_USD, 300);
    assert.equal(day.sales_USDCount, 2);
  });
});
