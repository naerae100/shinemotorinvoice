/**
 * Save a document straight to a PDF file — no print dialog.
 *
 * The libraries are imported dynamically, so the ~180 kB gzipped they cost is
 * paid only by someone who actually downloads something, never on first paint.
 *
 * The aim is that this file and the one that comes out of Print → Save as PDF
 * are the same document. That takes more than screenshotting the page:
 *
 *   - This document is designed for paper. 178 lines of print.css and a Tailwind
 *     `print:` variant on most rows live inside `@media print`, which never
 *     applies on screen, so a plain capture produced a picture of the web page
 *     instead — four-column detail grids collapsed to two, screen padding and
 *     shadows intact. Those rules are flattened into the clone.
 *   - Media queries have to be evaluated against the page, not the monitor, or
 *     the layout is whatever the window happened to be.
 *   - `@page` margins are what hold the document off the edge of the paper —
 *     print.css sets the sheet's own padding to 0 precisely because the page
 *     margin does that job. A PDF page has no such margin unless one is drawn,
 *     so without this the text ran off both edges.
 *
 * What it still does not give you: the text is a picture of text, so it is not
 * selectable or searchable. Vector output means rendering in a headless browser
 * on the server. Print, still on the toolbar, produces that today.
 */

// 3x at 96 CSS dpi lands near 288 dpi — past what a laser printer or a customs
// officer can resolve, and well short of what a 4x A4 capture costs a tablet.
const SCALE = 3;
const PX_PER_MM = 96 / 25.4;
const mmToPx = (mm) => Math.round(mm * PX_PER_MM);

// Mirrors @page in print.css and in DocketReceipt. If either changes, this has
// to change with it, or the file and the paper stop agreeing.
const PAGES = {
  a4: { width: 210, height: 297, margin: { top: 12, right: 12, bottom: 14, left: 12 } },
  receipt: { width: 80, height: null, margin: { top: 0, right: 0, bottom: 0, left: 0 } },
};

async function libs() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  return { html2canvas, jsPDF };
}

/** Fonts and the logo must be in place, or the PDF is written in a fallback
 *  face with a blank masthead. */
async function ready(root) {
  if (document.fonts?.ready) await document.fonts.ready;
  const pending = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  await Promise.all(
    pending.map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        })
    )
  );
}

/** Everything inside `@media print`, flattened so it applies to the clone. */
function flattenedPrintCss() {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet; ours are all local
    }
    for (const rule of rules) {
      if (rule.type === CSSRule.MEDIA_RULE && /print/i.test(rule.conditionText || '')) {
        for (const inner of rule.cssRules) out.push(inner.cssText);
      }
    }
  }
  return out.join('\n');
}

async function capture(html2canvas, node, contentWidthPx) {
  return html2canvas(node, {
    scale: SCALE,
    useCORS: true,
    backgroundColor: '#ffffff',
    logging: false,
    scrollX: 0,
    scrollY: -window.scrollY,
    // Evaluated by media queries in the clone, so the layout follows the page
    // rather than the monitor.
    //
    // Deliberately no `width`: that crops the output, and anything inside with
    // a min-width — the goods table has one — then lost its right-hand edge, so
    // the total and half the letterhead were sliced off. Letting html2canvas
    // measure what it actually laid out means an overhang is scaled to fit
    // instead of cut away.
    windowWidth: contentWidthPx,
    onclone: (doc, cloned) => {
      const style = doc.createElement('style');
      style.textContent = `
        ${flattenedPrintCss()}
        /* Screen-only chrome that has no business on a document: on paper the
           sheet is the page, not a card floating above one. */
        .print-sheet, .receipt-sheet {
          box-shadow: none !important;
          border-radius: 0 !important;
          border: none !important;
          --tw-ring-shadow: 0 0 #0000 !important;
        }
      `;
      doc.head.appendChild(style);

      cloned.style.width = `${contentWidthPx}px`;
      cloned.style.maxWidth = 'none';
      cloned.style.margin = '0';
    },
  });
}

/**
 * @param {Element[]} sheets   one element per page, in order
 * @param {string}    filename without the .pdf
 * @param {'a4'|'receipt'} format
 */
export async function downloadSheetsAsPdf(sheets, filename, format = 'a4') {
  if (!sheets.length) throw new Error('Nothing to download — no document is on screen.');

  const page = PAGES[format] ?? PAGES.a4;
  const { margin } = page;
  const contentWidthMm = page.width - margin.left - margin.right;
  const contentWidthPx = mmToPx(contentWidthMm);

  const { html2canvas, jsPDF } = await libs();
  await ready(sheets[0].ownerDocument.body);

  let pdf = null;

  for (const [i, sheet] of sheets.entries()) {
    const canvas = await capture(html2canvas, sheet, contentWidthPx);
    const image = canvas.toDataURL('image/jpeg', 0.94);

    // A receipt roll is as long as the slip; a fixed height would either cut the
    // last line off or feed blank paper before the cut.
    const pageHeight =
      page.height ??
      Math.max(40, Math.round(canvas.height / SCALE / PX_PER_MM) + margin.top + margin.bottom + 2);
    const contentHeightMm = pageHeight - margin.top - margin.bottom;

    if (!pdf) {
      pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [page.width, pageHeight], compress: true });
    } else {
      pdf.addPage([page.width, pageHeight], 'portrait');
    }

    // Contain within the printable area. Scaling to width alone let a sheet even
    // slightly taller than the page run off the bottom, which quietly cut the
    // footer — the line carrying the ABN and the document reference — off every
    // invoice.
    const fit = Math.min(contentWidthMm / canvas.width, contentHeightMm / canvas.height);
    const drawWidth = canvas.width * fit;
    const drawHeight = canvas.height * fit;
    const x = margin.left + (contentWidthMm - drawWidth) / 2;
    const y = margin.top;

    pdf.addImage(image, 'JPEG', x, y, drawWidth, drawHeight, `p${i}`, 'FAST');
  }

  pdf.save(`${filename}.pdf`);
}
