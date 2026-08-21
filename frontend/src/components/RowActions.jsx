import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Per-row action menu. The old table linked only from the reference number,
 * which gave no hint that anything was clickable — several actions were simply
 * undiscoverable.
 */
export default function RowActions({ viewTo, onEdit, onVoid, onRestore, onDelete, isVoid, isAdmin }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = 'block w-full px-3 py-2 text-left text-sm hover:bg-paper';

  return (
    <div className="flex items-center justify-end gap-1" ref={ref}>
      <Link
        to={viewTo}
        className="rounded-md border border-steel-200 bg-white px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper"
      >
        View
      </Link>
      <div className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-label="More actions"
          aria-expanded={open}
          className="rounded-md border border-steel-200 bg-white px-2 py-1 text-xs font-semibold text-steel-600 hover:bg-paper"
        >
          ⋯
        </button>
        {open && (
          <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-steel-200 bg-white py-1 shadow-lg">
            <Link to={viewTo} className={item} onClick={() => setOpen(false)}>
              View &amp; print PDF
            </Link>
            {!isVoid && (
              <button
                className={item}
                onClick={() => {
                  setOpen(false);
                  onEdit();
                }}
              >
                Edit
              </button>
            )}
            {!isVoid && (
              <button
                className={`${item} text-working-amber`}
                onClick={() => {
                  setOpen(false);
                  onVoid();
                }}
              >
                Void…
              </button>
            )}
            {isVoid && (
              <button
                className={`${item} text-working-green`}
                onClick={() => {
                  setOpen(false);
                  onRestore();
                }}
              >
                Restore
              </button>
            )}
            {isAdmin && (
              <button
                className={`${item} border-t border-steel-100 text-working-red`}
                onClick={() => {
                  setOpen(false);
                  onDelete();
                }}
              >
                Delete permanently…
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
