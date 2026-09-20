import { describe, test, expect } from 'vitest';
import { computeTotals, resolveDiscount, applyDiscount, GST_RATE } from '../money';
import { round2, round3 } from '../format';

/**
 * The browser's arithmetic, asserted against the same cases as
 * backend/tests/money.test.js.
 *
 * The point of this file is drift. There are two implementations of the money
 * rules — there has to be, because the operator needs a live total as they type
 * — and the risk is not that either one is wrong today but that one of them
 * changes alone. Every case below has a twin on the server; if someone retunes
 * the rounding or the order of operations on one side, this goes red.
 */

const totals = (lineValues, opts = {}) =>
  computeTotals({ lineValues, discountType: 'NONE', discountValue: 0, taxMode: 'NO_TAX', ...opts });

describe('money — rounding', () => {
  test('subtotal sums the rounded line values so a document adds up to itself', () => {
    expect(totals([0.13, 0.13]).subtotal).toBe(0.26);
  });

  test('round2 does not lose a cent to float representation', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });
});

describe('money — discount', () => {
  test('percentage discount', () => {
    const t = totals([1000], { discountType: 'PERCENT', discountValue: 10 });
    expect(t.discountAmount).toBe(100);
    expect(t.total).toBe(900);
  });

  test('fixed discount', () => {
    const t = totals([1000], { discountType: 'FIXED', discountValue: 250 });
    expect(t.discountAmount).toBe(250);
    expect(t.total).toBe(750);
  });

  test('a discount larger than the subtotal is capped, never negative', () => {
    const t = totals([300], { discountType: 'FIXED', discountValue: 9999 });
    expect(t.discountAmount).toBe(300);
    expect(t.total).toBe(0);
  });

  test('a percentage over 100 is capped', () => {
    expect(resolveDiscount(300, 'PERCENT', 120)).toBe(300);
  });

  test('a zero or negative discount value is ignored', () => {
    expect(resolveDiscount(500, 'PERCENT', 0)).toBe(0);
    expect(resolveDiscount(500, 'FIXED', -50)).toBe(0);
  });
});

describe('money — GST order of operations', () => {
  test('GST applies AFTER the discount, not before', () => {
    const t = totals([1000], {
      discountType: 'PERCENT',
      discountValue: 10,
      taxMode: 'EXCLUSIVE',
    });
    expect(t.discountAmount).toBe(100);
    expect(t.gst).toBe(90); // 10% of 900, not of 1000
    expect(t.total).toBe(990);
  });

  test('INCLUSIVE takes the GST out of the price rather than adding it on', () => {
    // The weighbridge quotes a rate with GST already in it, so this is the
    // default a docket is written on.
    const t = totals([1100], { taxMode: 'INCLUSIVE' });
    expect(t.gst).toBe(100);
    expect(t.total).toBe(1100);
  });

  test('NO_TAX records no GST at all', () => {
    expect(totals([1000], { taxMode: 'NO_TAX' }).gst).toBe(0);
  });

  test('the legacy boolean maps onto EXCLUSIVE / NO_TAX', () => {
    // What the export-invoice screens pass: an export is GST-free, a local sale
    // on the same document is not.
    expect(totals([1000], { taxMode: true }).gst).toBe(100);
    expect(totals([1000], { taxMode: false }).gst).toBe(0);
    expect(GST_RATE).toBe(0.1);
  });

  test('total always equals subtotal - discount + gst', () => {
    const cases = [
      [[123.45, 67.89], 'PERCENT', 7.5, 'EXCLUSIVE'],
      [[1000], 'FIXED', 333.33, 'EXCLUSIVE'],
      [[0.01], 'NONE', 0, 'EXCLUSIVE'],
      [[99999.99], 'PERCENT', 33.3, 'NO_TAX'],
      [[4350.125], 'PERCENT', 2.5, 'INCLUSIVE'],
    ];
    for (const [values, type, value, mode] of cases) {
      const t = computeTotals({
        lineValues: values,
        discountType: type,
        discountValue: value,
        taxMode: mode,
      });
      const expected =
        mode === 'EXCLUSIVE' ? round3(round3(t.subtotal - t.discountAmount) + t.gst) : t.taxable;
      expect(t.total).toBe(expected);
      expect(t.total).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('three decimals — the unit this yard actually works in', () => {
  test('gross minus tare keeps the kilogram', () => {
    // 21.243 gross less 0.036 tare. Rounded to cents this stored 21.21 and
    // billed three kilograms that were never in the container.
    expect(round3(21.243 - 0.036)).toBe(21.207);
    expect(round2(21.243 - 0.036)).toBe(21.21); // what it used to do
  });

  test('a line worth 0.125 is not paid as 0.13', () => {
    expect(totals([0.125, 0.125]).subtotal).toBe(0.25);
  });
});

describe('applyDiscount — what the forms call as the operator types', () => {
  test('it agrees with computeTotals for an already-summed subtotal', () => {
    const viaForm = applyDiscount(21.207 * 4350, { discountType: 'PERCENT', discountValue: 5 }, 'EXCLUSIVE');
    const viaLines = computeTotals({
      lineValues: [21.207 * 4350],
      discountType: 'PERCENT',
      discountValue: 5,
      taxMode: 'EXCLUSIVE',
    });
    expect(viaForm.total).toBe(viaLines.total);
    expect(viaForm.gst).toBe(viaLines.gst);
    expect(viaForm.discountAmount).toBe(viaLines.discountAmount);
  });
});
