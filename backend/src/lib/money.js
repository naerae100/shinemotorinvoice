import { z } from 'zod';

export const GST_RATE = 0.1; // Australia — 10%

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
  const base = round2(subtotal);
  const v = Number(value) || 0;
  if (!type || type === 'NONE' || v <= 0) return 0;
  const raw = type === 'PERCENT' ? (base * v) / 100 : v;
  return round2(Math.min(Math.max(raw, 0), base));
}

/**
 * The one place document totals are computed, so a purchase docket and a sales
 * invoice can never disagree about the order of operations.
 *
 *   subtotal  = sum of the ROUNDED line values (so the document adds up to itself)
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

  const subtotal = round2(lineValues.reduce((sum, v) => sum + Number(v), 0));
  const discountAmount = resolveDiscount(subtotal, discountType, discountValue);
  const taxable = round2(subtotal - discountAmount);

  let gst, total;
  if (mode === 'INCLUSIVE') {
    gst = round2(taxable / 11);
    total = round2(taxable);          // price already includes GST
  } else if (mode === 'EXCLUSIVE') {
    gst = round2(taxable * GST_RATE);
    total = round2(taxable + gst);    // GST added on top
  } else {
    gst = 0;
    total = round2(taxable);          // no tax at all
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

