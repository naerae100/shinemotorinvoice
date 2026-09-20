/**
 * Save a document straight to a PDF file — no print dialog.
 *
 * The libraries are imported dynamically, so the ~180 kB gzipped they cost is
 * paid only by someone who actually downloads something, never on first paint.
 *
 * The aim is that this file and the one out of Print → Save as PDF are the same
 * document. Screenshotting the page does not achieve that, for three reasons:
 *
 *   1. This document is designed for paper. 178 lines of print.css and a
 *      Tailwind `print:` variant on most rows live inside `@media print`, which
 *      never applies on screen — so a plain capture showed screen padding,
 *      card shadows, and a generous layout meant for reading at a desk.
 *   2. The element's width and the viewport's width are different things. The
 *      sheet has to be the page's content width, while the viewport stays wide:
 *      Tailwind breakpoints are viewport queries, and a narrow one silently
 *      drops the document to its stacked mobile layout — the masthead below the
 *      logo, the four-column detail grid collapsed to two.
 *   3. `@page` margins are what hold the document off the edge of the paper.
 *      print.css sets the sheet's own padding to 0 precisely because the page
 *      margin does that job; a PDF page has no margin unless one is drawn.
 *
 * Restyling html2canvas's own clone could not fix all three, because it sizes
 * the canvas from the element it was given before that clone is touched: the
 * canvas came out the shape of the on-screen sheet while the print-styled
 * content rendered shorter inside it, leaving the document in the top half of
 * the page. So the document is instead rebuilt offscreen at exactly the page
 * size, with the paper styles applied, and that is what gets photographed. The
 * thing measured is the thing captured.
 *
 * What it still does not give you: the text is a picture of text, so it is not
 * selectable or searchable. Vector output means rendering in a headless browser
 * on the server. Print, still on the toolbar, produces that today.
 */

import { deliverFile } from './platform';

// 3x at 96 CSS dpi lands near 288 dpi — past what a laser printer or a customs
// officer can resolve, and well short of what a 4x A4 capture costs a tablet.
const SCALE = 3;
const PX_PER_MM = 96 / 25.4;
const mmToPx = (mm) => Math.round(mm * PX_PER_MM);

const STAGE_ID = 'pdf-stage';

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

/**
 * Every `@media print` rule, rewritten to apply only inside the offscreen stage.
 *
 * Scoping matters. These rules are written for a whole page — they strip the
 * sheet's padding, shrink the masthead, compress every table row — and letting
 * them loose on the live document would visibly rearrange the screen behind the
 * download. `html` and `body` rules are dropped rather than scoped: they set up
 * the page itself, which the stage is not.
 */
function scopedPrintCss(scope) {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      continue; // cross-origin stylesheet; ours are all local
    }
    for (const rule of rules) {
      if (rule.type !== CSSRule.MEDIA_RULE || !/print/i.test(rule.conditionText || '')) continue;
      for (const inner of rule.cssRules) {
        if (!inner.selectorText || !inner.style) continue;
        const selector = inner.selectorText
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s && !/^(html|body|:root)\b/i.test(s))
          .map((s) => `${scope} ${s}`)
          .join(', ');
        if (selector) out.push(`${selector} { ${inner.style.cssText} }`);
      }
    }
  }
  return out.join('\n');
}

/**
 * Put a copy of the document offscreen, at exactly the size it will print at,
 * with the paper styles applied.
 */
function buildStage(sheet, contentWidthPx) {
  const stage = document.createElement('div');
  stage.id = STAGE_ID;
  // Offscreen rather than hidden: `display: none` and `visibility: hidden` both
  // stop the browser laying the content out, and there would be nothing to
  // measure or to photograph.
  stage.style.cssText = `
    position: fixed;
    left: -20000px;
    top: 0;
    width: ${contentWidthPx}px;
    background: #ffffff;
    z-index: -1;
  `;

  const style = document.createElement('style');
  style.textContent = `
    ${scopedPrintCss(`#${STAGE_ID}`)}
    /* Screen-only chrome: on paper the sheet is the page, not a card floating
       above one. Width is pinned here so the sheet cannot inherit the
       max-width it wears on screen. */
    #${STAGE_ID} .print-sheet,
    #${STAGE_ID} .receipt-sheet {
      box-shadow: none !important;
      border-radius: 0 !important;
      border: none !important;
      margin: 0 !important;
      max-width: none !important;
      width: ${contentWidthPx}px !important;
      --tw-ring-shadow: 0 0 #0000 !important;
    }
  `;
  stage.appendChild(style);
  stage.appendChild(sheet.cloneNode(true));
  document.body.appendChild(stage);
  return stage;
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
    const stage = buildStage(sheet, contentWidthPx);
    let canvas;
    try {
      await ready(stage);
      const target = stage.querySelector('.print-sheet, .receipt-sheet') ?? stage;
      canvas = await html2canvas(target, {
        scale: SCALE,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        // The stage is laid out in the live document at the right size, so
        // html2canvas measures exactly what it renders and the viewport keeps
        // its real width — which is what satisfies the `sm:` breakpoints the
        // printed layout depends on.
        scrollX: 0,
        scrollY: 0,
      });
    } finally {
      stage.remove();
    }

    const image = canvas.toDataURL('image/jpeg', 0.94);

    // A receipt roll is as long as the slip; a fixed height would either cut the
    // last line off or feed blank paper before the cut.
    const pageHeight =
      page.height ??
      Math.max(40, Math.round(canvas.height / SCALE / PX_PER_MM) + margin.top + margin.bottom + 2);
    const contentHeightMm = pageHeight - margin.top - margin.bottom;

    if (!pdf) {
      pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [page.width, pageHeight],
        compress: true,
      });
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

  // Through the platform layer rather than pdf.save(): in the Android shell
  // there is no download manager, so the same file goes to the share sheet
  // instead — which is how it reaches email, Drive or a printer app.
  await deliverFile(pdf.output('blob'), `${filename}.pdf`, { title: filename });
}
