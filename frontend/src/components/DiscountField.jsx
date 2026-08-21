import { round2 } from '../lib/format';

/**
 * Mirrors the server's order of operations exactly (see backend src/lib/money.js):
 * discount comes off the subtotal, then GST applies to what's left. If these two
 * ever disagreed, the figure on screen would not match the figure saved.
 */
export function applyDiscount(subtotal, discount, applyGst) {
  const base = round2(subtotal);
  const value = Number(discount.discountValue) || 0;
  let discountAmount = 0;
  if (discount.discountType === 'PERCENT' && value > 0) discountAmount = (base * value) / 100;
  else if (discount.discountType === 'FIXED' && value > 0) discountAmount = value;
  discountAmount = round2(Math.min(Math.max(discountAmount, 0), base));

  const taxable = round2(base - discountAmount);
  const gst = applyGst ? round2(taxable * 0.1) : 0;
  return { discountAmount, taxable, gst, total: round2(taxable + gst) };
}

export default function DiscountField({ value, onChange, subtotal }) {
  const { discountType, discountValue } = value;
  const { discountAmount } = applyDiscount(subtotal, value, false);
  const capped =
    discountType !== 'NONE' && Number(discountValue) > 0 && discountAmount >= round2(subtotal);

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-steel-700">Discount</label>
      <div className="flex items-center gap-2">
        <select
          value={discountType}
          onChange={(e) =>
            onChange({
              discountType: e.target.value,
              discountValue: e.target.value === 'NONE' ? 0 : discountValue,
            })
          }
          className="rounded-md border border-steel-200 bg-paper px-3 py-2 text-sm focus:bg-white"
        >
          <option value="NONE">No discount</option>
          <option value="PERCENT">Percentage</option>
          <option value="FIXED">Fixed amount</option>
        </select>

        {discountType !== 'NONE' && (
          <div className="relative">
            {discountType === 'FIXED' && (
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-steel-400">
                $
              </span>
            )}
            <input
              type="number"
              min="0"
              step={discountType === 'PERCENT' ? '0.5' : '0.01'}
              max={discountType === 'PERCENT' ? '100' : undefined}
              value={discountValue || ''}
              onChange={(e) => onChange({ ...value, discountValue: parseFloat(e.target.value) || 0 })}
              placeholder="0"
              className={`num w-28 rounded-md border border-steel-200 bg-paper py-2 text-sm focus:bg-white ${
                discountType === 'FIXED' ? 'pl-6 pr-2.5' : 'px-2.5'
              }`}
            />
            {discountType === 'PERCENT' && (
              <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-steel-400">
                %
              </span>
            )}
          </div>
        )}

        {discountAmount > 0 && (
          <span className="num text-sm text-steel-500">
            − {new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(discountAmount)}
          </span>
        )}
      </div>
      {capped && (
        <p className="mt-1.5 text-xs text-working-amber">
          This discount covers the whole subtotal — the total will be zero.
        </p>
      )}
    </div>
  );
}
