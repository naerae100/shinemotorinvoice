import { format } from 'date-fns';
import { addressLines, formatAud, formatNumber, formatRate, amountInWords } from '../../lib/format';
import { Detail, Masthead, ReferenceBlock, TotalsBlock, DocumentFooter, discountLabel, VoidStamp } from './parts';

export const PAYG_LABELS = {
  NOT_APPLICABLE: 'Business sale with valid ABN',
  PRIVATE_HOBBY: 'Private recreational pursuit or hobby',
  TAX_EXEMPT: 'Wholly exempt from income tax',
  SCRAP_CODE_NO_ABN: 'Scrap Metal Industry Code — no ABN required',
};

/**
 * The three grounds from the ATO's "Statement by supplier", worded as they are
 * on the printed pad this system replaces. All three are always shown with the
 * declared one ticked — a form that printed only the selected line would not be
 * the statement the supplier signed, it would be an assertion about them.
 */
const PAYG_GROUNDS = [
  {
    key: 'PRIVATE_HOBBY',
    text: 'Of a private recreational pursuit or hobby, or is wholly of a private nature for me, or',
  },
  { key: 'TAX_EXEMPT', text: 'Wholly exempt from income tax, or' },
  {
    key: 'SCRAP_CODE_NO_ABN',
    text:
      'A supply made in a circumstance under the Scrap Metal Industry Code of Compliance that ' +
      'would ordinarily require an ABN to be provided, and I supply specific reasons why the ' +
      'No ABN withholding provisions should not apply.',
  },
];

function Tickbox({ checked }) {
  return (
    <span
      aria-hidden="true"
      className="mt-[1px] flex h-[14px] w-[14px] shrink-0 items-center justify-center rounded-[4px] border-[1.5px] border-ink-400 bg-white leading-none"
    >
      {checked && <span className="text-[11px] font-bold leading-none text-brand-700">✓</span>}
    </span>
  );
}

/**
 * The printable purchase docket / tax invoice. Pure — see InvoiceDocument.
 */
export default function DocketDocument({ docket, settings }) {
  const isTaxInvoice = docket.type === 'TAX_INVOICE';
  const title = isTaxInvoice ? 'Tax Invoice' : 'Purchase Docket';
  const s = docket.supplier;
  const hasVehicle = docket.vehicleModel || docket.vehicleReg || docket.vehicleVin;
  const totalWeight = docket.lineItems.reduce((sum, li) => sum + Number(li.netWeight), 0);
  // Older dockets predate the field; they were written under the rule that only
  // a tax invoice carried GST.
  const taxMode = docket.taxMode ?? (isTaxInvoice ? 'EXCLUSIVE' : 'NO_TAX');

  return (
    <div className="print-sheet relative mx-auto flex min-h-[297mm] flex-col rounded-2xl border border-ink-200 bg-white p-5 shadow-ticket sm:p-8 lg:p-10">
      {docket.status === 'VOID' && <VoidStamp reason={docket.voidReason} />}
      <Masthead settings={settings} />

      <section className="grid grid-cols-1 border-b border-ink-200 sm:grid-cols-2">
        <div className="border-r border-ink-200 px-4 py-3">
          <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-widest text-brand-600">
            Supplier / Seller
          </div>
          <div className="text-[15px] font-bold leading-snug text-ink-900">{s?.name}</div>
          <div className="mt-1.5 space-y-[3px] text-[11.5px] font-medium leading-snug text-ink-700">
            {addressLines(s).map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {s?.phone && <div className="num">Phone {s.phone}</div>}
            {s?.abn && <div className="num">ABN {s.abn}</div>}
            {s?.licenceNo && <div className="num">Licence {s.licenceNo}</div>}
          </div>
        </div>
        <ReferenceBlock
          title={title}
          references={[
            ['Docket no.', docket.docketNumber, true],
            ['Date', format(new Date(docket.date), 'dd MMM yyyy')],
            ['Time', format(new Date(docket.createdAt || docket.date), 'HH:mm')],
          ]}
        />
      </section>

      {hasVehicle && (
        <section className="grid grid-cols-2 border-b border-ink-200 bg-ink-50 sm:grid-cols-3">
          <Detail label="Vehicle model" value={docket.vehicleModel} mono={false} />
          <Detail label="Registration" value={docket.vehicleReg} />
          <Detail label="VIN" value={docket.vehicleVin} />
        </section>
      )}

      <div className="-mx-1 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
      <table className="w-full min-w-[520px] overflow-hidden rounded-xl border-separate border-spacing-0 text-[11.5px] ring-1 ring-ink-200">
        <thead>
          <tr className="bg-ink-900 text-left uppercase tracking-[0.1em] text-white">
            <th className="w-8 rounded-tl-xl px-3 py-3 text-[9.5px] font-bold">#</th>
            <th className="px-2 py-3 text-[9.5px] font-bold">Material</th>
            <th className="w-28 px-2 py-3 text-right text-[9.5px] font-bold">Net weight</th>
            <th className="w-14 px-2 py-3 text-[9.5px] font-bold">Unit</th>
            <th className="w-28 px-2 py-3 text-right text-[9.5px] font-bold">Rate (AUD)</th>
            <th className="w-32 rounded-tr-xl px-3 py-3 text-right text-[9.5px] font-semibold">
              Value (AUD)
            </th>
          </tr>
        </thead>
        <tbody>
          {docket.lineItems.map((li, i) => (
            <tr key={li.id} className={i % 2 ? 'bg-ink-50' : ''}>
              <td className="num border-b border-ink-200 px-3 py-3 align-top text-ink-300">
                {i + 1}
              </td>
              <td className="border-b border-ink-200 px-2 py-3 align-top text-[12.5px] font-semibold text-ink-900">
                {li.description || li.material?.description}
                {li.description && li.material?.description && (
                  <div className="text-[9.5px] font-medium text-ink-500">
                    {li.material.description}
                  </div>
                )}
              </td>
              <td className="num border-b border-ink-200 px-2 py-3 text-right align-top text-ink-700">
                {formatNumber(li.netWeight, 3)}
              </td>
              <td className="border-b border-ink-200 px-2 py-3 align-top text-[10px] uppercase text-ink-500">
                {(li.material?.unit || 'kg').toLowerCase()}
              </td>
              <td className="num border-b border-ink-200 px-2 py-3 text-right align-top text-ink-700">
                {/* Rates are quoted to fractions of a cent per kilo, so the rate
                    column keeps what was actually agreed rather than rounding it
                    to look tidy. Only the value is rounded, and only to the cent. */}
                {formatRate(li.price)}
              </td>
              <td className="num border-b border-ink-200 px-3 py-3 text-right align-top font-semibold text-ink-900">
                {formatNumber(li.value, 2)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="bg-ink-100 font-semibold">
            <td className="rounded-bl-xl" />
            <td className="px-2 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-700">
              Total {docket.lineItems.length} {docket.lineItems.length === 1 ? 'line' : 'lines'}
            </td>
            <td className="num px-2 py-3 text-right text-ink-900">
              {formatNumber(totalWeight, 3)}
            </td>
            <td colSpan={2} />
            <td className="num rounded-br-xl px-3 py-3 text-right text-ink-900">
              {formatNumber(docket.subtotal, 2)}
            </td>
          </tr>
        </tfoot>
      </table>
      </div>

      <TotalsBlock
        words={amountInWords(docket.total)}
        rows={[
          ['Subtotal', formatAud(docket.subtotal)],
          ...(Number(docket.discountAmount) > 0
            ? [[discountLabel(docket), `− ${formatAud(docket.discountAmount)}`]]
            : []),
          // Nothing for INCLUSIVE: the GST is already inside the total, so a
          // separate line just invites the reader to add it on again. Only an
          // exclusive docket has an amount being added, and only that is shown.
          ...(taxMode === 'EXCLUSIVE' ? [['GST (10%)', formatAud(docket.gst)]] : []),
        ]}
        total={formatNumber(docket.total, 2)}
      >
        {docket.notes && (
          <div className="mt-3">
            <div className="text-[9px] font-bold uppercase tracking-[0.12em] text-ink-500">
              Notes
            </div>
            <div className="text-[10.5px] font-medium leading-relaxed text-ink-700">{docket.notes}</div>
          </div>
        )}
      </TotalsBlock>

      <section className="avoid-break pt-3">
        {/* Laid out as the printed pad has it: the declaration, the three
            grounds as tick boxes, then both signatures inside the same frame —
            so the signature sits under the statement it attests to.

            The boxes always print, ticked or not. The operator may need to tick
            one by hand at the weighbridge, and a box that only appears when a
            value was chosen on screen cannot be ticked on paper.

            No company stamp: a purchase docket is the yard's own record of what
            it bought and paid; the stamp is for documents sent to a buyer. */}
        <div className="avoid-break overflow-hidden rounded-xl border border-ink-200">
          <div className="border-b border-ink-200 bg-ink-50 px-4 py-2.5">
            <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-ink-500">
              Statement by supplier
            </span>
          </div>

          <div className="px-4 py-3">
            <p className="text-[10.5px] font-medium leading-relaxed text-ink-700">
              In accordance with the pay as you go (PAYG) legislation and Tax Office guidelines, I
              state that the supply made by me is in the course of an activity that is:{' '}
              <span className="italic text-ink-500">(tick appropriate boxes)</span>
            </p>

            <ul className="mt-2 space-y-1.5">
              {PAYG_GROUNDS.map((g) => (
                <li key={g.key} className="flex gap-2">
                  <Tickbox checked={docket.paygStatement === g.key} />
                  <span className="text-[10.5px] font-medium leading-relaxed text-ink-700">{g.text}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid grid-cols-2 gap-6 border-t border-ink-200 px-4 pb-3 pt-7 sm:gap-10">
            <div>
              <div className="border-b border-ink-400" />
              <div className="mt-1 text-[11px] font-bold text-ink-700">
                Supplier&rsquo;s Signature
              </div>
            </div>
            <div>
              <div className="border-b border-ink-400" />
              <div className="mt-1 text-[11px] font-bold text-ink-700">
                Buyer&rsquo;s Signature
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-auto pt-4">
        <DocumentFooter
          settings={settings}
          reference={`${title} #${docket.docketNumber}`}
          date={docket.date}
        />
      </div>
    </div>
  );
}
