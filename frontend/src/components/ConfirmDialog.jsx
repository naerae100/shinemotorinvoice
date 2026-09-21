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
            <label className="field-label">{reasonLabel}</label>
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

        {/* Stacked and reversed on a narrow screen: the confirm sits above the
            cancel so the thumb reaches the action being asked for, and neither
            button is a half-width sliver. */}
        <div className="btn-row mt-6 flex-col-reverse sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="btn-secondary btn-block sm:w-auto"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!canConfirm}
            className={`btn-block sm:w-auto ${
              tone === 'danger' ? 'btn-danger' : 'btn-primary'
            }`}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
