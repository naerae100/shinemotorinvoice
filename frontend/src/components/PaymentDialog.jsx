import { useEffect, useRef, useState } from 'react';

/**
 * Record a payment against an unpaid docket.
 *
 * Separate from ConfirmDialog because this is not a confirmation: it captures
 * two fields, and marking money as paid is not a destructive action that wants
 * a red button and a warning.
 *
 * Cash is deliberately not offered. NSW scrap metal law requires payment by
 * electronic transfer, so a cash option would invite the record to describe an
 * unlawful transaction; the API rejects it too.
 */
const METHODS = [
  ['TRANSFER', 'Bank transfer'],
  ['PAYID', 'PayID'],
  ['CHEQUE', 'Cheque'],
];

export default function PaymentDialog({ open, docket, busy = false, onConfirm, onCancel }) {
  const [method, setMethod] = useState('TRANSFER');
  const [reference, setReference] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    setReference('');
    // PayID where the supplier has one and no account number, since that is
    // then the only way they can actually be paid.
    setMethod(docket?.supplier?.payId && !docket?.supplier?.bankAccountNo ? 'PAYID' : 'TRANSFER');
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open, docket]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const s = docket?.supplier;
  const hasAccount = s?.bankBsb || s?.bankAccountNo || s?.payId;

  const submit = () =>
    !busy && onConfirm({ paymentMethod: method, paymentReference: reference.trim() || null });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-steel-950/40 px-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-md rounded-xl border border-steel-200 bg-white p-6 shadow-xl">
        <h2 className="font-display text-lg font-semibold text-steel-900">
          Record payment for docket #{docket?.docketNumber}
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-steel-600">
          This marks the docket as settled. It stops appearing in the payment run.
        </p>

        {/* The account is shown here because this is the moment it is needed —
            otherwise the transfer is made in another window from details copied
            off a different screen. */}
        {hasAccount && (
          <div className="mt-4 rounded-md border border-steel-200 bg-paper p-3 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-steel-500">
              Pay to
            </div>
            <div className="mt-1 font-semibold text-steel-900">
              {s.bankAccountName || s.name}
            </div>
            {(s.bankBsb || s.bankAccountNo) && (
              <div className="num mt-0.5 text-steel-700">
                {s.bankBsb && <span>BSB {s.bankBsb}</span>}
                {s.bankBsb && s.bankAccountNo && <span className="mx-2 text-steel-300">·</span>}
                {s.bankAccountNo && <span>Acct {s.bankAccountNo}</span>}
              </div>
            )}
            {s.payId && <div className="num mt-0.5 text-steel-700">PayID {s.payId}</div>}
          </div>
        )}
        {!hasAccount && (
          <div className="mt-4 rounded-md border border-working-amber/30 bg-working-amberDim p-3 text-sm text-steel-800">
            No bank details are saved for {s?.name || 'this supplier'}. Add them on the
            supplier record so the next load does not need them asked for again.
          </div>
        )}

        <div className="mt-4">
          <label className="mb-1 block text-xs font-medium text-steel-500">Paid by</label>
          <div className="flex flex-wrap gap-2">
            {METHODS.map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setMethod(value)}
                className={`rounded-md border px-3 py-2 text-sm font-semibold ${
                  method === value
                    ? 'border-steel-900 bg-steel-900 text-white'
                    : 'border-steel-200 bg-white text-steel-700 hover:bg-paper'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="payment-reference" className="mb-1 block text-xs font-medium text-steel-500">
            Reference <span className="font-normal text-steel-400">(optional)</span>
          </label>
          <input
            id="payment-reference"
            ref={inputRef}
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
            placeholder="Bank receipt or transaction number"
            className="w-full rounded-md border border-steel-200 px-3 py-2 text-sm focus:border-copper-500"
          />
          <p className="mt-1 text-xs text-steel-500">
            What makes this findable when the supplier rings up about it.
          </p>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-steel-300 bg-white px-4 py-2 text-sm font-semibold text-steel-700 hover:bg-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-working-green px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Mark as paid'}
          </button>
        </div>
      </div>
    </div>
  );
}
