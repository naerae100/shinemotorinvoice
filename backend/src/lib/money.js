import { z } from 'zod';

export const GST_RATE = 0.1; // Australia — 10%

/**
 * The yard works to three decimal places, so the arithmetic does too.
 *
 * Weights are read off a weighbridge in kilograms — three decimals of a tonne —
 * and rates are agreed to three. Rounding to cents threw the third digit away
 * at every step: 21.243 gross less 0.036 tare is 21.207, and the system stored
 * 21.21. Three kilograms a line, and at AUD 4,350/MT that is AUD 13.05 billed
 * for metal that was never in the container.
 *
 * Rounding to three is also what removes floating-point noise rather than
 * adding it: the raw subtraction above evaluates to 21.206999999999997, and
 * three decimals is the exact answer, not an approximation of it.
 */
export const round3 = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/** Cents. Kept for amounts in words, which have to be dollars and cents. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const discountSchema = {
  discountType: z.enum(['NONE', 'PERCENT', 'FIXED']).default('NONE'),
  discountValue: z.number().nonnegative().default(0),
};

/**
 * Resolves a discount to a dollar amount.
 * Never exceeds the subtotal — a 120% discount or a $500 discount on a $300
 * docket would otherwise produce a negative total and a negative GST.
 */
export function resolveDiscount(subtotal, type, value) {
  const base = round3(subtotal);
  const v = Number(value) || 0;
  if (!type || type === 'NONE' || v <= 0) return 0;
  const raw = type === 'PERCENT' ? (base * v) / 100 : v;
  return round3(Math.min(Math.max(raw, 0), base));
}

/**
 * The one place document totals are computed, so a purchase docket and a sales
 * invoice can never disagree about the order of operations.
 *
 *   subtotal  = sum of the line values, each to three places (so the document adds up to itself)
 *   discount  = percentage of subtotal, or a fixed amount, capped at subtotal
 *   taxable   = subtotal − discount        (GST applies after the discount)
 *
 *   taxMode determines how GST is handled:
 *     EXCLUSIVE — gst = taxable × 10%, total = taxable + gst  (added on top)
 *     INCLUSIVE  — gst = taxable ÷ 11,  total = taxable        (already inside)
 *     NO_TAX    — gst = 0,              total = taxable        (no tax at all)
 *
 *   Legacy callers may still pass `applyGst` (boolean); it is mapped automatically.
 */
export function computeTotals({ lineValues, discountType, discountValue, taxMode, applyGst }) {
  // Bridge legacy boolean → taxMode string
  const mode = taxMode ?? (applyGst ? 'EXCLUSIVE' : 'NO_TAX');

  const subtotal = round3(lineValues.reduce((sum, v) => sum + Number(v), 0));
  const discountAmount = resolveDiscount(subtotal, discountType, discountValue);
  const taxable = round3(subtotal - discountAmount);

  let gst, total;
  if (mode === 'INCLUSIVE') {
    gst = round3(taxable / 11);
    total = round3(taxable);          // price already includes GST
  } else if (mode === 'EXCLUSIVE') {
    gst = round3(taxable * GST_RATE);
    total = round3(taxable + gst);    // GST added on top
  } else {
    gst = 0;
    total = round3(taxable);          // no tax at all
  }

  return {
    subtotal,
    discountType: discountAmount > 0 ? discountType : 'NONE',
    discountValue: discountAmount > 0 ? Number(discountValue) || 0 : 0,
    discountAmount,
    gst,
    total,
  };
}

