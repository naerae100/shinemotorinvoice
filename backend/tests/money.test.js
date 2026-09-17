import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeTotals, resolveDiscount, round2, round3 } from '../src/lib/money.js';

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
        round3(round3(t.subtotal - t.discountAmount) + t.gst),
        `mismatch for ${JSON.stringify(values)} ${type} ${value}`
      );
      assert.ok(t.total >= 0, 'total must never be negative');
    }
  });
});

describe('three decimals — the unit this yard actually works in', () => {
  test('gross minus tare keeps the kilogram', () => {
    // The case that surfaced it: 21.243 gross, 0.036 tare. Rounded to cents the
    // system stored 21.21 and billed for three kilograms that were never in the
    // container — at AUD 4,350/MT, AUD 13.05 a line.
    assert.equal(round3(21.243 - 0.036), 21.207);
    assert.equal(round2(21.243 - 0.036), 21.21, 'what it used to do');
  });

  test('rounding to three removes float noise rather than adding it', () => {
    // The raw subtraction is 21.206999999999997; three places is the exact
    // answer, not an approximation of it.
    assert.ok(21.243 - 0.036 !== 21.207, 'the raw float is not exact');
    assert.equal(round3(21.243 - 0.036), 21.207);
    assert.equal(round3(0.1 + 0.2), 0.3);
  });

  test('a line worth 0.125 is not paid as 0.13', () => {
    assert.equal(totals([0.125, 0.125]).subtotal, 0.25);
  });

  test('the document still adds up to itself', () => {
    const t = totals([21.207, 14.66, 9.65], { taxMode: 'EXCLUSIVE' });
    assert.equal(round3(t.subtotal - t.discountAmount + t.gst), t.total);
  });
});
