/**
 * Save a document straight to a PDF file — no print dialog.
 *
 * The libraries are imported dynamically, so the ~300 kB they cost is paid only
 * by someone who actually downloads something, and never on first paint.
 *
 * What this does and does not give you
 * ------------------------------------
 * The page is captured as an image and placed on a PDF page of the right size,
 * so the file looks exactly like the document on screen. The text in it is a
 * picture of text: it will not be selectable or searchable in a PDF reader.
 *
 * Producing selectable text means rendering the document in a headless browser
 * on the server, which is a heavier thing to run and deploy. Print → Save as
 * PDF, still on the toolbar, produces that vector output today, which is why
 * that button stayed.
 */

// 3x is a deliberate choice: at 96 CSS dpi that lands near 288 dpi, past the
// point where a laser printer or a customs officer can see the difference, and
// well short of the memory a 4x capture of an A4 sheet wants on a tablet.
const SCALE = 3;
const MM_PER_PX = 25.4 / 96;

async function libs() {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  return { html2canvas, jsPDF };
}

/**
 * Fonts and the logo must be in place before the capture, or the PDF is written
 * in a fallback face and the masthead is blank.
 */
async function ready(root) {
  if (document.fonts?.ready) {
    await document.fonts.ready;
  }
  const images = [...root.querySelectorAll('img')].filter((img) => !img.complete);
  await Promise.all(
    images.map(
      (img) =>
        new Promise((resolve) => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
        })
    )
  );
}

async function capture(html2canvas, node) {
  return html2canvas(node, {
    scale: SCALE,
    useCORS: true,
    // The sheets are white; without this the capture inherits the page ground
    // and the PDF has a grey cast.
    backgroundColor: '#ffffff',
    logging: false,
    // The sheet may be taller than the window; capture all of it, from the top.
    scrollX: 0,
    scrollY: -window.scrollY,
    windowWidth: document.documentElement.clientWidth,
  });
}

/**
 * @param {Element[]} sheets  one element per page, in order
 * @param {string}    filename  without the .pdf
 * @param {'a4'|'receipt'} format
 */
export async function downloadSheetsAsPdf(sheets, filename, format = 'a4') {
  if (!sheets.length) throw new Error('Nothing to download — no document is on screen.');

  const { html2canvas, jsPDF } = await libs();
  await ready(sheets[0].ownerDocument.body);

  let pdf = null;

  for (const [i, sheet] of sheets.entries()) {
    const canvas = await capture(html2canvas, sheet);
    const image = canvas.toDataURL('image/jpeg', 0.94);

    // A4 is fixed. A receipt roll is 80mm wide and as long as the slip, so the
    // page is measured from what was actually rendered — a fixed height would
    // either cut the last line off or waste roll.
    const pageWidth = format === 'receipt' ? 80 : 210;
    const pageHeight =
      format === 'receipt'
        ? Math.max(40, Math.round(sheet.getBoundingClientRect().height * MM_PER_PX) + 4)
        : 297;

    if (!pdf) {
      pdf = new jsPDF({
        orientation: pageWidth > pageHeight ? 'landscape' : 'portrait',
        unit: 'mm',
        format: [pageWidth, pageHeight],
        compress: true,
      });
    } else {
      pdf.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? 'landscape' : 'portrait');
    }

    // Fit inside the page, never across it. Scaling to width alone let a sheet
    // even slightly taller than A4's ratio run off the bottom, which quietly
    // cut the footer — the line carrying the ABN and the document reference —
    // off every invoice. Whichever dimension binds is the one that sets the
    // scale, and the result is centred rather than stretched.
    const fit = Math.min(pageWidth / canvas.width, pageHeight / canvas.height);
    const drawWidth = canvas.width * fit;
    const drawHeight = canvas.height * fit;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;

    pdf.addImage(image, 'JPEG', x, y, drawWidth, drawHeight, `p${i}`, 'FAST');
  }

  pdf.save(`${filename}.pdf`);
}
