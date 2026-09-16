import { printAs } from '../lib/printDocument';

/**
 * Save the document on screen as a PDF, named after the record it is.
 *
 * An icon rather than a labelled button: it sits in a row with the view switch
 * and the CSV export, and a third block of text there competed with the two
 * things that actually need reading. The action is named for screen readers and
 * on hover.
 *
 * It opens the print dialog, because that is where "Save as PDF" lives — the
 * same place the paper copy comes from, which is the point. What changes is the
 * filename it arrives under.
 */
export default function DownloadDocument({ filename, label = 'Download PDF', className = '' }) {
  return (
    <button
      type="button"
      onClick={() => printAs(filename)}
      aria-label={label}
      title={`${label} — saves as “${filename}.pdf”`}
      className={`inline-flex h-9 w-9 items-center justify-center rounded-md border border-steel-200 bg-white text-steel-600 hover:bg-paper hover:text-steel-900 ${className}`}
    >
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
    </button>
  );
}
