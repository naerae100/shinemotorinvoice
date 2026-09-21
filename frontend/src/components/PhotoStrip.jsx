import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { compressImage } from '../lib/imageCompress';

/**
 * Photographs already on a record: shown, added to, and opened full size.
 *
 * Adding is available here as well as on the form because an upload can fail
 * — a yard with one bar, a phone that slept mid-request — and the collection
 * is saved regardless. Without a way back in, a failed photo would be lost
 * rather than merely delayed.
 *
 * Deleting is admin-only, deliberately. A photograph is the evidence behind
 * a disputed weight; the person who took it should not be the person who can
 * quietly remove it.
 */
export default function PhotoStrip({
  collectionId,
  lineId = null,
  photos,
  onChanged,
  canDelete = false,
  canAdd = true,
  compact = false,
  emptyHint,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);

  // Escape closes the viewer — a fullscreen overlay with no way out on a
  // keyboard is a trap.
  useEffect(() => {
    if (open === null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(null);
      if (e.key === 'ArrowRight') setOpen((i) => Math.min(photos.length - 1, i + 1));
      if (e.key === 'ArrowLeft') setOpen((i) => Math.max(0, i - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, photos.length]);

  async function add(e) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!picked.length) return;

    setBusy(true);
    setError('');
    let failed = 0;
    for (const raw of picked) {
      try {
        const file = await compressImage(raw);
        const form = new FormData();
        form.append('photo', file);
        if (lineId) form.append('lineId', lineId);
        await api.post(`/collections/${collectionId}/photos`, form);
      } catch {
        failed += 1;
      }
    }
    if (failed) setError(`${failed} ${failed === 1 ? 'photo' : 'photos'} did not upload.`);
    setBusy(false);
    await onChanged?.();
  }

  async function remove(photo) {
    setBusy(true);
    try {
      await api.delete(`/collections/photos/${photo.id}`);
      await onChanged?.();
    } catch {
      setError('Could not remove that photo.');
    } finally {
      setBusy(false);
    }
  }

  const tile = compact ? 'h-16 w-16' : 'h-24 w-24';

  if (!photos.length && !canAdd) {
    return emptyHint ? <p className="text-xs text-steel-400">{emptyHint}</p> : null;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p, i) => (
          <div
            key={p.id}
            className={`group relative ${tile} overflow-hidden rounded-lg border border-steel-200 bg-paper`}
          >
            <button
              type="button"
              onClick={() => setOpen(i)}
              className="block h-full w-full"
              aria-label={`Open photo ${i + 1}`}
            >
              <img
                src={p.url}
                alt={p.filename}
                loading="lazy"
                className="h-full w-full object-cover transition-transform group-hover:scale-105"
              />
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => remove(p)}
                disabled={busy}
                aria-label={`Remove photo ${i + 1}`}
                className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-steel-900/80 text-xs font-bold text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
              >
                ×
              </button>
            )}
          </div>
        ))}

        {canAdd && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className={`flex ${tile} flex-col items-center justify-center gap-0.5 rounded-lg border border-dashed border-steel-300 bg-paper text-steel-500 transition-colors hover:border-copper-400 hover:text-copper-600 disabled:opacity-50`}
          >
            {busy ? (
              <span className="text-[10px] font-semibold">Working…</span>
            ) : (
              <>
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                  <path d="M3 8.5A1.5 1.5 0 014.5 7h2L8 5h8l1.5 2h2A1.5 1.5 0 0121 8.5v9A1.5 1.5 0 0119.5 19h-15A1.5 1.5 0 013 17.5v-9z" strokeLinejoin="round" />
                  <circle cx="12" cy="12.5" r="3.2" />
                </svg>
                <span className="text-[10px] font-semibold">Photo</span>
              </>
            )}
          </button>
        )}
      </div>

      {error && <p className="mt-1.5 text-xs text-working-red">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={add}
        className="hidden"
      />

      {/* Full size. A thumbnail proves a photo exists; reading a label off a
          bundle needs the whole thing. */}
      {open !== null && photos[open] && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-steel-950/95 p-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(null)}
        >
          <div className="flex items-center justify-between gap-4 pb-3 text-sm text-steel-300">
            <span className="truncate">
              {photos[open].filename}
              <span className="ml-2 text-steel-400">
                {open + 1} of {photos.length}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="btn-ghost btn-icon btn-sm text-steel-300 hover:bg-white/10 hover:text-white"
              aria-label="Close"
            >
              ×
            </button>
          </div>
          <img
            src={photos[open].url}
            alt={photos[open].filename}
            className="min-h-0 flex-1 object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          {photos.length > 1 && (
            <div className="flex justify-center gap-2 pt-3" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                onClick={() => setOpen(Math.max(0, open - 1))}
                disabled={open === 0}
                className="btn-secondary btn-sm"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setOpen(Math.min(photos.length - 1, open + 1))}
                disabled={open === photos.length - 1}
                className="btn-secondary btn-sm"
              >
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
