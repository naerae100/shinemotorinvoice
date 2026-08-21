import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, resolveDiscount, round2 } from '../src/lib/money.js';

const totals = (lineValues, opts = {}) =>
  computeTotals({ lineValues, discountType: 'NONE', discountValue: 0, applyGst: false, ...opts });

describe('money — rounding', () => {
  test('subtotal sums the rounded line values so a document adds up to itself', () => {
    // Each line prints as 0.13; the subtotal must be 0.26, not the raw 0.25.
    assert.equal(totals([0.13, 0.13]).subtotal, 0.26);
  });

  test('round2 does not lose a cent to float representation', () => {
    assert.equal(round2(1.005), 1.01);
    assert.equal(round2(0.1 + 0.2), 0.3);
  });
});

describe('money — discount', () => {
  test('percentage discount', () => {
    const t = totals([1000], { discountType: 'PERCENT', discountValue: 10 });
    assert.equal(t.discountAmount, 100);
    assert.equal(t.total, 900);
  });

  test('fixed discount', () => {
    const t = totals([1000], { discountType: 'FIXED', discountValue: 250 });
    assert.equal(t.discountAmount, 250);
    assert.equal(t.total, 750);
  });

  test('a discount larger than the subtotal is capped, never negative', () => {
    const t = totals([300], { discountType: 'FIXED', discountValue: 9999 });
    assert.equal(t.discountAmount, 300);
    assert.equal(t.total, 0);
  });

  test('a percentage over 100 is capped', () => {
    assert.equal(resolveDiscount(300, 'PERCENT', 120), 300);
  });

  test('a zero or negative discount value is ignored', () => {
    assert.equal(resolveDiscount(500, 'PERCENT', 0), 0);
    assert.equal(resolveDiscount(500, 'FIXED', -50), 0);
  });

  test('discountType is normalised to NONE when nothing was actually taken off', () => {
    assert.equal(totals([1000], { discountType: 'PERCENT', discountValue: 0 }).discountType, 'NONE');
  });
});

describe('money — GST order of operations', () => {
  test('GST applies AFTER the discount, not before', () => {
    const t = totals([1000], { discountType: 'PERCENT', discountValue: 10, applyGst: true });
    assert.equal(t.discountAmount, 100);
    assert.equal(t.gst, 90, 'GST must be 10% of 900, not of 1000');
    assert.equal(t.total, 990);
  });

  test('no GST when not requested', () => {
    assert.equal(totals([1000], { applyGst: false }).gst, 0);
  });

  test('total always equals subtotal - discount + gst', () => {
    for (const [values, type, value, gst] of [
      [[123.45, 67.89], 'PERCENT', 7.5, true],
      [[1000], 'FIXED', 333.33, true],
      [[0.01], 'NONE', 0, true],
      [[99999.99], 'PERCENT', 33.3, false],
    ]) {
      const t = computeTotals({
        lineValues: values,
        discountType: type,
        discountValue: value,
        applyGst: gst,
      });
      assert.equal(
        t.total,
        round2(round2(t.subtotal - t.discountAmount) + t.gst),
        `mismatch for ${JSON.stringify(values)} ${type} ${value}`
      );
      assert.ok(t.total >= 0, 'total must never be negative');
    }
  });
});
