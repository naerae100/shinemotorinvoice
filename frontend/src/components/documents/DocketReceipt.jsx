import { useEffect, useRef } from 'react';
import { format } from 'date-fns';
import { formatAud, formatNumber, formatRate, amountInWords } from '../../lib/format';
import { PAYG_LABELS } from './DocketDocument';

const PX_PER_MM = 96 / 25.4;

/**
 * Swap the sheet size for a roll while a receipt is on screen.
 *
 * Two things make this awkward. `@page` is global and cannot be scoped to an
 * element — a named page is ignored, because the root box fixes the page context
 * long before the receipt is laid out, so the receipt printed on A4 with 200mm
 * of white space beside it. And a roll has no height: the obvious
 * `size: 80mm auto` is invalid CSS (the grammar takes lengths or `auto`, never
 * both), so the whole declaration is dropped and A4 silently stands.
 *
 * So the height is measured off the rendered receipt and written into the rule,
 * which is also what the printer wants — an exact page length feeds no blank
 * paper before the cut. It is rounded up: a page a millimetre too long costs a
 * millimetre of roll, while one a millimetre too short spills the last line onto
 * a second slip. A ResizeObserver keeps it honest when the logo or the web font
 * lands after first paint and everything shifts down.
 */
function useReceiptPageSize(ref) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const style = document.createElement('style');
    style.dataset.receiptPage = '';
    document.head.appendChild(style);

    const apply = () => {
      const mm = Math.ceil(el.scrollHeight / PX_PER_MM) + 2;
      // No margin: the thermal driver already insets the printable area, and
      // adding to it pushes the right-hand figures off the edge of the roll.
      style.textContent = `@page { size: 80mm ${mm}mm; margin: 0; }`;
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(el);
    return () => {
      observer.disconnect();
      style.remove();
    };
  }, [ref]);
}

/**
 * The purchase docket as an 80mm till receipt, for the thermal printer at the
 * weighbridge. Pure — give it a docket and the company settings and it renders.
 *
 * This is a different document from DocketDocument, not a restyling of it. A
 * thermal head prints a one-bit raster onto a 72mm printable strip of unknown
 * length, so everything the A4 sheet relies on is unavailable here: there is no
 * page height to lay out against, no greys that survive (a tint either burns
 * solid or drops out), and no room for a two-column grid. What it gets instead
 * is a single measured column, rules made of characters, and figures aligned
 * hard right so a supplier can check the total at a glance.
 *
 * Deliberately no signature line: the supplier is handed this and walks away,
 * and a line nobody signs reads as an unsigned document. The PAYG ground they
 * declared is still printed — that is information about the sale, and it
 * belongs on their copy.
 */
export default function DocketReceipt({ docket, settings }) {
  const sheetRef = useRef(null);
  useReceiptPageSize(sheetRef);

  const isTaxInvoice = docket.type === 'TAX_INVOICE';
  const title = isTaxInvoice ? 'Tax Invoice' : 'Purchase Docket';
  const s = docket.supplier;
  const companyName = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  const taxMode = docket.taxMode ?? (isTaxInvoice ? 'EXCLUSIVE' : 'NO_TAX');
  const totalWeight = docket.lineItems.reduce((sum, li) => sum + Number(li.netWeight), 0);

  const rule = <div className="my-1.5 border-t border-dashed border-black" />;
  const ruleSolid = <div className="my-1.5 border-t-2 border-black" />;

  /** Label left, figure hard right — the only alignment a receipt needs. */
  const Row = ({ label, value, bold }) => (
    <div className={`flex justify-between gap-2 ${bold ? 'font-bold' : ''}`}>
      <span>{label}</span>
      <span className="num whitespace-nowrap">{value}</span>
    </div>
  );

  /** A field whose value may wrap onto its own lines under a fixed-width label. */
  const Field = ({ label, children }) => (
    <div className="flex gap-2">
      <span className="w-[62px] shrink-0 uppercase">{label}</span>
      <span className="min-w-0 flex-1 break-words font-bold">{children}</span>
    </div>
  );

  return (
    <div
      ref={sheetRef}
      // Vertical padding is deliberately the same on screen and on paper: the
      // page height is measured from what is rendered here, so any print-only
      // change to it would make the measurement describe a different receipt.
      className="receipt-sheet mx-auto bg-white p-4 font-mono text-[11px] leading-[1.45] text-black print:px-1 print:shadow-none"
      style={{ width: '72mm' }}
    >
      <div className="text-center">
        {settings?.logoUrl ? (
          // Thermal output is one bit deep, so the logo is pushed to pure black
          // and white rather than being dithered into a grey smear.
          <img
            src={settings.logoUrl}
            alt={companyName}
            className="mx-auto mb-1.5 h-10 object-contain contrast-200 grayscale"
          />
        ) : null}
        <div className="text-[12px] font-bold uppercase leading-tight">{companyName}</div>
        {settings?.address && <div className="leading-tight">{settings.address}</div>}
        <div className="num leading-tight">
          {[settings?.abn && `ABN ${settings.abn}`, settings?.acn && `ACN ${settings.acn}`]
            .filter(Boolean)
            .join('  ')}
        </div>
        {settings?.phone && <div className="num leading-tight">{settings.phone}</div>}
      </div>

      {ruleSolid}

      <div className="text-center">
        <div className="text-[13px] font-bold uppercase tracking-[0.08em]">{title}</div>
        <div className="num text-[15px] font-bold">No. {docket.docketNumber}</div>
        {docket.status === 'VOID' && (
          <div className="mt-1 border-2 border-black py-0.5 text-[12px] font-bold uppercase tracking-widest">
            *** Void ***
          </div>
        )}
        {/* An unissued docket is still a draft. If one is printed by accident it
            has to say so on the paper, or it is indistinguishable from the real
            handover copy the supplier keeps. */}
        {!docket.issuedAt && docket.status !== 'VOID' && (
          <div className="mt-1 text-[10px] font-bold uppercase tracking-widest">
            — Not yet issued —
          </div>
        )}
      </div>

      {ruleSolid}

      <div className="space-y-0.5">
        <Field label="Date">
          <span className="num">
            {format(new Date(docket.date), 'dd/MM/yyyy')}{' '}
            {format(new Date(docket.createdAt || docket.date), 'HH:mm')}
          </span>
        </Field>
        <Field label="Supplier">{s?.name}</Field>
        {(s?.address || s?.suburb || s?.postcode) && (
          <Field label="">
            <span className="font-normal">
              {[s.address, [s.suburb, s.postcode].filter(Boolean).join(' ')]
                .filter(Boolean)
                .join(', ')}
            </span>
          </Field>
        )}
        {s?.abn && (
          <Field label="ABN">
            <span className="num">{s.abn}</span>
          </Field>
        )}
        {s?.licenceNo && (
          <Field label="Licence">
            <span className="num">{s.licenceNo}</span>
          </Field>
        )}
        {(docket.vehicleReg || docket.vehicleModel) && (
          <Field label="Vehicle">
            <span className="num">
              {[docket.vehicleReg, docket.vehicleModel].filter(Boolean).join('  ')}
            </span>
          </Field>
        )}
      </div>

      {rule}

      {/* Each line gets two rows: the material on its own, then the arithmetic
          indented beneath it. Fitting name, weight, rate and value onto one
          72mm line would mean truncating the name, and a supplier cannot check
          a figure against a grade they can only half read. */}
      <div className="space-y-1.5">
        {docket.lineItems.map((li, i) => {
          const unit = (li.material?.unit || 'KG').toLowerCase();
          return (
            <div key={li.id}>
              <div className="font-bold">
                <span className="num">{i + 1}. </span>
                {li.description || li.material?.description}
              </div>
              <div className="flex justify-between gap-2 pl-4">
                <span className="num">
                  {formatNumber(li.netWeight, 3)} {unit} @ {formatRate(li.price)}
                </span>
                <span className="num font-bold">{formatNumber(li.value, 2)}</span>
              </div>
            </div>
          );
        })}
      </div>

      {rule}

      <Row
        label={`Total weight (${docket.lineItems.length} ${
          docket.lineItems.length === 1 ? 'line' : 'lines'
        })`}
        value={formatNumber(totalWeight, 3)}
      />

      {rule}

      <div className="space-y-0.5">
        <Row label="Subtotal" value={formatAud(docket.subtotal)} />
        {Number(docket.discountAmount) > 0 && (
          <Row
            label={
              docket.discountType === 'PERCENT'
                ? `Discount (${Number(docket.discountValue)}%)`
                : 'Discount'
            }
            value={`- ${formatAud(docket.discountAmount)}`}
          />
        )}
        {/* Only an exclusive docket has GST being added on top. On an inclusive
            one the tax is already inside the total, and printing it as its own
            line invites the supplier to add it again. */}
        {taxMode === 'EXCLUSIVE' && <Row label="GST (10%)" value={formatAud(docket.gst)} />}
        {taxMode === 'INCLUSIVE' && (
          <Row label="Includes GST" value={formatAud(docket.gst)} />
        )}
      </div>

      {ruleSolid}

      <div className="flex items-baseline justify-between gap-2 text-[15px] font-bold">
        <span className="uppercase">Total</span>
        <span className="num">{formatAud(docket.total)}</span>
      </div>

      {ruleSolid}

      <div className="text-[10px] leading-snug">
        <span className="font-bold uppercase">Amount: </span>
        {amountInWords(docket.total)}
      </div>

      {docket.paygStatement && (
        <>
          {rule}
          <div className="text-[10px] leading-snug">
            <div className="font-bold uppercase">Statement by supplier</div>
            <div>
              The supplier declared this supply is made in the course of an activity that is:
            </div>
            <div className="mt-0.5 font-bold">
              {PAYG_LABELS[docket.paygStatement] || docket.paygStatement}
            </div>
          </div>
        </>
      )}

      {docket.notes && (
        <>
          {rule}
          <div className="text-[10px] leading-snug">
            <span className="font-bold uppercase">Notes: </span>
            {docket.notes}
          </div>
        </>
      )}

      {rule}

      <div className="text-center text-[10px] leading-snug">
        {docket.createdBy?.name && <div>Served by {docket.createdBy.name}</div>}
        <div className="num">
          {title} #{docket.docketNumber} · {format(new Date(docket.date), 'dd/MM/yyyy')}
        </div>
        <div className="mt-1.5 font-bold uppercase tracking-widest">Thank you</div>
        {settings?.website && <div>{settings.website}</div>}
      </div>

      {/* The roll is cut a few millimetres below the last line of print; without
          this the closing line sits in the cutter's path. */}
      <div className="h-10 print:h-8" aria-hidden="true" />
    </div>
  );
}
