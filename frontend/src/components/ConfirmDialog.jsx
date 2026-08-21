import { useEffect, useRef, useState } from 'react';

/**
 * Blocking confirmation for destructive actions. When `requireReason` is set the
 * confirm button stays disabled until a reason is typed — voiding a financial
 * record without saying why leaves an audit trail that explains nothing.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  tone = 'danger',
  requireReason = false,
  reasonLabel = 'Reason',
  busy = false,
  onConfirm,
  onCancel,
}) {
  const [reason, setReason] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    if (open) {
      setReason('');
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const canConfirm = !busy && (!requireReason || reason.trim().length > 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-steel-950/40 px-4"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div className="w-full max-w-md rounded-xl border border-steel-200 bg-white p-6 shadow-xl">
        <h2 className="font-display text-lg font-semibold text-steel-900">{title}</h2>
        {body && <div className="mt-2 text-sm leading-relaxed text-steel-600">{body}</div>}

        {requireReason && (
          <div className="mt-4">
            <label className="mb-1 block text-xs font-medium text-steel-500">{reasonLabel}</label>
            <input
              ref={inputRef}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canConfirm && onConfirm(reason.trim())}
              placeholder="e.g. Weighbridge error — reweighed"
              className="w-full rounded-md border border-steel-200 px-3 py-2 text-sm focus:border-copper-500"
            />
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="rounded-md border border-steel-300 bg-white px-4 py-2 text-sm font-semibold text-steel-700 hover:bg-paper disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm}
            className={`rounded-md px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 ${
              tone === 'danger'
                ? 'bg-working-red hover:brightness-110'
                : 'bg-steel-800 hover:bg-steel-700'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
