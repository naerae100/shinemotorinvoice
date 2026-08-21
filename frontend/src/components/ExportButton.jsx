import { useState } from 'react';
import { api } from '../lib/api';

/**
 * Downloads a CSV from an authenticated endpoint.
 *
 * A plain <a href> cannot carry the bearer token, so the file is fetched as a
 * blob through the same axios instance as everything else and handed to the
 * browser from memory. The filename comes from the server's Content-Disposition
 * so it stays consistent with what the API decided to call it.
 */
export default function ExportButton({ endpoint, params = {}, label = 'Export CSV', options }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');

  async function download(extraParams = {}) {
    setBusy(true);
    setError('');
    setOpen(false);
    try {
      const res = await api.get(endpoint, {
        params: { ...params, ...extraParams },
        responseType: 'blob',
      });

      const disposition = res.headers['content-disposition'] || '';
      const match = /filename="?([^"]+)"?/.exec(disposition);
      const filename = match?.[1] || 'export.csv';

      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke on the next tick — doing it synchronously can cancel the download.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setError('Export failed. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const base =
    'inline-flex items-center gap-1.5 rounded-lg border border-steel-300 bg-white px-3 py-2 text-sm font-semibold text-steel-700 transition-colors hover:bg-paper disabled:opacity-60';

  return (
    <div className="relative">
      <button
        onClick={() => (options ? setOpen((v) => !v) : download())}
        disabled={busy}
        className={base}
        title="Exports everything matching the current filters, not just this page"
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M8 1.5v8m0 0L5 6.5m3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2 10.5v2a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-2" strokeLinecap="round" />
        </svg>
        {busy ? 'Preparing…' : label}
      </button>

      {open && options && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
          <div className="absolute right-0 z-20 mt-1 w-60 overflow-hidden rounded-lg border border-steel-200 bg-white py-1 shadow-lg">
            {options.map((opt) => (
              <button
                key={opt.label}
                onClick={() => download(opt.params)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-paper"
              >
                <span className="font-medium text-steel-800">{opt.label}</span>
                {opt.hint && <span className="block text-xs text-steel-500">{opt.hint}</span>}
              </button>
            ))}
          </div>
        </>
      )}

      {error && <p className="absolute right-0 mt-1 text-xs text-working-red">{error}</p>}
    </div>
  );
}
