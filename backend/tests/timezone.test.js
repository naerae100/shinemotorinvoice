import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  boundaryInstant,
  zonedDayKey,
  zonedInstant,
  zonedMonthKey,
  zonedWeekKey,
} from '../src/lib/timezone.js';
import { dateFilter } from '../src/lib/query.js';

/**
 * These run with the process in UTC, which is what Vercel gives us — the
 * condition under which the original bug appeared and a developer's laptop in
 * Sydney would never reproduce it.
 */
describe('business dates are the yard\'s days, not the server\'s', () => {
  test('a docket written at 9am Sydney belongs to that Sydney day', () => {
    // 16 Sep 2026 09:10 Sydney (AEST, +10) is 15 Sep 23:10 UTC.
    const docketWrittenAt = new Date('2026-09-15T23:10:00Z');
    assert.equal(zonedDayKey(docketWrittenAt), '2026-09-16', 'not the 15th');
  });

  test('"today" includes a docket written before 10am', () => {
    const { gte, lte } = dateFilter('2026-09-16', '2026-09-16');
    const docketWrittenAt = new Date('2026-09-15T23:10:00Z'); // 9:10am Sydney

    assert.ok(
      docketWrittenAt >= gte && docketWrittenAt <= lte,
      'this is the regression: the dashboard showed 0 and the docket appeared under yesterday'
    );
  });

  test('the day window is the Sydney day, not the UTC day', () => {
    const { gte, lte } = dateFilter('2026-09-16', '2026-09-16');
    assert.equal(gte.toISOString(), '2026-09-15T14:00:00.000Z', 'midnight Sydney');
    assert.equal(lte.toISOString(), '2026-09-16T13:59:59.999Z', 'last ms of the Sydney day');
  });

  test('a load weighed the morning of 1 July is in the new financial year', () => {
    // 1 Jul 2026 08:00 Sydney = 30 Jun 2026 22:00 UTC. Read as UTC this lands in
    // the previous financial year, which is a tax reporting error, not a display one.
    const { gte } = dateFilter('2026-07-01', '2027-06-30');
    assert.ok(new Date('2026-06-30T22:00:00Z') >= gte);
  });

  test('daylight saving does not move a day boundary', () => {
    // Sydney leaves AEDT on 5 Apr 2026 (+11 -> +10) and enters it on 4 Oct.
    assert.equal(
      boundaryInstant('2026-04-05', 'start').toISOString(),
      '2026-04-04T13:00:00.000Z',
      'midnight on the changeover day is still +11'
    );
    assert.equal(
      boundaryInstant('2026-10-05', 'start').toISOString(),
      '2026-10-04T13:00:00.000Z',
      'and +11 again after the spring change'
    );
    assert.equal(zonedDayKey(new Date('2026-10-04T13:30:00Z')), '2026-10-05');
  });

  test('a value carrying a time is trusted as given', () => {
    const exact = boundaryInstant('2026-09-16T04:30:00Z', 'start');
    assert.equal(exact.toISOString(), '2026-09-16T04:30:00.000Z');
  });

  test('unusable input is ignored rather than throwing', () => {
    assert.equal(boundaryInstant('not-a-date', 'start'), null);
    assert.equal(boundaryInstant('', 'start'), null);
    assert.equal(dateFilter(undefined, undefined), undefined);
  });

  test('week and month keys follow the Sydney calendar', () => {
    // 16 Sep 2026 is a Wednesday; its week starts Monday the 14th.
    assert.equal(zonedWeekKey(new Date('2026-09-15T23:10:00Z')), '2026-09-14');
    // 1 Oct 2026 00:30 Sydney is still 30 Sep in UTC.
    assert.equal(zonedMonthKey(new Date('2026-09-30T14:30:00Z')), '2026-10');
  });

  test('zonedInstant round-trips through its own key', () => {
    const inst = zonedInstant(2026, 9, 16, 0, 0, 0, 0);
    assert.equal(zonedDayKey(inst), '2026-09-16');
  });
});
