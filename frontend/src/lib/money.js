import { round3 } from './format';

/**
 * The browser's copy of the server's arithmetic.
 *
 * This is a deliberate duplicate of backend/src/lib/money.js, and the only
 * honest way to have a live totals panel: the operator has to see the total
 * change as they type, and a round trip per keystroke is not that. What it must
 * never be is a *different* calculation — a screen that says 4,350.00 and a
 * record that stores 4,349.99 is worse than a screen with no total at all.
 *
 * So the two are kept in step by three things, not by hope:
 *   1. one function here, rather than the sum being re-derived per page;
 *   2. the same order of operations, written out below in the same words;
 *   3. money.test.js, which asserts the cases backend/tests/money.test.js
 *      asserts, so a change to one side fails on the other.
 *
 * It used to live inside DiscountField.jsx, where a component that renders a
 * dropdown also owned the definition of GST.
 */

export const GST_RATE = 0.1; // Australia — 10%

/**
 * Resolves a discount to a dollar amount, capped at the subtotal.
 *
 * Uncapped, a 120% discount or a $500 discount on a $300 docket produces a
 * negative total and a negative GST.
 */
export function resolveDiscount(subtotal, type, value) {
  const base = round3(subtotal);
  const v = Number(value) || 0;
  if (!type || type === 'NONE' || v <= 0) return 0;
  const raw = type === 'PERCENT' ? (base * v) / 100 : v;
  return round3(Math.min(Math.max(raw, 0), base));
}

/**
 * Document totals, in the one order both sides agree on:
 *
 *   subtotal  = sum of the line values, each to three places
 *   discount  = percentage of subtotal, or a fixed amount, capped at subtotal
 *   taxable   = subtotal − discount        (GST applies after the discount)
 *
 *   EXCLUSIVE — gst = taxable × 10%, total = taxable + gst  (added on top)
 *   INCLUSIVE — gst = taxable ÷ 11,  total = taxable        (already inside)
 *   NO_TAX    — gst = 0,             total = taxable        (no tax at all)
 *
 * `taxMode` also accepts a boolean, which is what the export-invoice screens
 * pass: an export is GST-free, a local sale on the same document is not.
 */
export function computeTotals({ lineValues, discountType, discountValue, taxMode }) {
  const mode = typeof taxMode === 'boolean' ? (taxMode ? 'EXCLUSIVE' : 'NO_TAX') : taxMode;

  const subtotal = round3((lineValues ?? []).reduce((sum, v) => sum + (Number(v) || 0), 0));
  const discountAmount = resolveDiscount(subtotal, discountType, discountValue);
  const taxable = round3(subtotal - discountAmount);

  let gst;
  let total;
  if (mode === 'INCLUSIVE') {
    gst = round3(taxable / 11);
    total = round3(taxable);
  } else if (mode === 'EXCLUSIVE') {
    gst = round3(taxable * GST_RATE);
    total = round3(taxable + gst);
  } else {
    gst = 0;
    total = round3(taxable);
  }

  return { subtotal, discountAmount, taxable, gst, total };
}

/**
 * The same thing for a subtotal that has already been summed, which is what the
 * forms hold — they total their own line rows as the operator types.
 */
export function applyDiscount(subtotal, discount, taxMode = 'EXCLUSIVE') {
  const { discountAmount, taxable, gst, total } = computeTotals({
    lineValues: [subtotal],
    discountType: discount?.discountType,
    discountValue: discount?.discountValue,
    taxMode,
  });
  return { discountAmount, taxable, gst, total };
}
