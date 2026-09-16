import { useState } from 'react';
import { downloadSheetsAsPdf } from '../lib/downloadPdf';

/**
 * Download the document on screen as a PDF file. One click, no print dialog.
 *
 * An icon rather than a labelled button: it sits in a row with the view switch
 * and the CSV export, and a third block of text there competed with the two
 * that have to be read. The action is named for screen readers and on hover.
 *
 * Capturing an A4 sheet at 3x takes a moment on a tablet, so the icon shows it
 * is working — a button that appears to do nothing gets clicked again, and two
 * captures at once is how a slow device runs out of memory.
 */
export default function DownloadDocument({
  filename,
  selector = '.print-sheet',
  format = 'a4',
  label = 'Download PDF',
  className = '',
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState('');

  async function run() {
    if (busy) return;
    setBusy(true);
    setFailed('');
    try {
      const sheets = [...document.querySelectorAll(selector)];
      await downloadSheetsAsPdf(sheets, filename, format);
    } catch (err) {
      // Worth surfacing: the usual cause is a sheet too large for the device's
      // canvas limit, and silently doing nothing would look like a dead button.
      setFailed(err?.message || 'Could not build the PDF.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        aria-label={label}
        aria-busy={busy}
        title={busy ? 'Building the PDF…' : `${label} — saves as “${filename}.pdf”`}
        className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-steel-200 bg-white text-steel-600 hover:bg-paper hover:text-steel-900 disabled:cursor-wait disabled:opacity-60 ${className}`}
      >
        {busy ? (
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
            <path
              d="M21 12a9 9 0 0 0-9-9"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <animateTransform
                attributeName="transform"
                type="rotate"
                from="0 12 12"
                to="360 12 12"
                dur="0.8s"
                repeatCount="indefinite"
              />
            </path>
          </svg>
        ) : (
          <svg
            width="17"
            height="17"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M12 3v12" />
            <path d="m7 11 5 5 5-5" />
            <path d="M4 20h16" />
          </svg>
        )}
      </button>
      {failed && (
        <span
          role="alert"
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-working-red/30 bg-working-redDim px-2.5 py-1.5 text-[11px] font-medium text-working-red shadow-lg"
        >
          {failed}
        </span>
      )}
    </span>
  );
}
