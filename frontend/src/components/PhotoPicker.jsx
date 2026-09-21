import { useEffect, useRef, useState } from 'react';
import { compressImage, readableSize } from '../lib/imageCompress';

/**
 * Photographs chosen on the form, before the collection exists.
 *
 * They cannot be uploaded yet — there is nothing to attach them to until the
 * collection is saved — so they are held as files and sent afterwards. That
 * ordering is deliberate: a photo that fails to upload must never cost
 * somebody the weights they just typed standing next to a truck. The
 * collection saves first, always; the photos follow, and any that fail can
 * be added again from the record.
 *
 * `capture="environment"` asks a phone for the rear camera directly rather
 * than the photo library, which is the difference between two taps and five.
 * A laptop ignores it and opens a file picker, which is what a laptop should
 * do.
 */
export default function PhotoPicker({ files, onChange, label = 'Add photos', compact = false }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [previews, setPreviews] = useState([]);

  // Object URLs are a leak if they are not revoked, and a gallery of them on
  // a tablet left open all day is a real one.
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f));
    setPreviews(urls);
    return () => urls.forEach(URL.revokeObjectURL);
  }, [files]);

  async function add(e) {
    const picked = [...(e.target.files ?? [])];
    e.target.value = '';
    if (!picked.length) return;

    setBusy(true);
    try {
      // Sequentially: a phone asked to decode six full-size photos at once
      // will drop the tab.
      const next = [];
      for (const f of picked) next.push(await compressImage(f));
      onChange([...files, ...next]);
    } finally {
      setBusy(false);
    }
  }

  const tile = compact ? 'h-16 w-16' : 'h-20 w-20';

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {previews.map((url, i) => (
          <div key={url} className={`group relative ${tile} overflow-hidden rounded-lg border border-steel-200`}>
            <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(files.filter((_, idx) => idx !== i))}
              aria-label={`Remove photo ${i + 1}`}
              className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-steel-900/80 text-xs font-bold text-white"
            >
              ×
            </button>
          </div>
        ))}

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
              <span className="text-[10px] font-semibold">{compact ? 'Photo' : label}</span>
            </>
          )}
        </button>
      </div>

      {files.length > 0 && (
        <p className="mt-1.5 text-[11px] text-steel-400">
          {files.length} {files.length === 1 ? 'photo' : 'photos'} ·{' '}
          {readableSize(files.reduce((a, f) => a + f.size, 0))} · uploads after saving
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        onChange={add}
        className="hidden"
      />
    </div>
  );
}
