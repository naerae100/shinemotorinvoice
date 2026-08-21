import { format } from 'date-fns';
import { formatAud, formatNumber, amountInWords } from '../../lib/format';
import { Detail, Masthead, ReferenceBlock, TotalsBlock, DocumentFooter, discountLabel, VoidStamp } from './parts';

export const PAYG_LABELS = {
  NOT_APPLICABLE: 'Business sale with valid ABN',
  PRIVATE_HOBBY: 'Private recreational pursuit or hobby',
  TAX_EXEMPT: 'Wholly exempt from income tax',
  SCRAP_CODE_NO_ABN: 'Scrap Metal Industry Code — no ABN required',
};

/**
 * The printable purchase docket / tax invoice. Pure — see InvoiceDocument.
 */
export default function DocketDocument({ docket, settings }) {
  const isTaxInvoice = docket.type === 'TAX_INVOICE';
  const title = isTaxInvoice ? 'Tax Invoice' : 'Purchase Docket';
  const s = docket.supplier;
  const companyName = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  const hasVehicle = docket.vehicleModel || docket.vehicleReg || docket.vehicleVin;
  const totalWeight = docket.lineItems.reduce((sum, li) => sum + Number(li.netWeight), 0);

  return (
    <div className="print-sheet relative mx-auto flex min-h-[297mm] flex-col border border-steel-300 bg-white p-10 shadow-ticket">
      {docket.status === 'VOID' && <VoidStamp reason={docket.voidReason} />}
      <Masthead settings={settings} />

      <section className="grid grid-cols-2 border-b border-steel-300">
        <div className="border-r border-steel-300 px-4 py-3">
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-copper-700">
            Supplier / Seller
          </div>
          <div className="text-[13px] font-bold leading-snug text-steel-900">{s?.name}</div>
          <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-steel-600">
            {s?.address && <div>{s.address}</div>}
            {(s?.suburb || s?.postcode) && (
              <div>{[s.suburb, s.postcode].filter(Boolean).join(' ')}</div>
            )}
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
        <section className="grid grid-cols-3 border-b border-steel-300 bg-paper">
          <Detail label="Vehicle model" value={docket.vehicleModel} mono={false} />
          <Detail label="Registration" value={docket.vehicleReg} />
          <Detail label="VIN" value={docket.vehicleVin} />
        </section>
      )}

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-steel-900 text-left uppercase tracking-wider text-paper">
            <th className="w-8 px-2 py-2.5 text-[9px] font-semibold">#</th>
            <th className="px-2 py-2.5 text-[9px] font-semibold">Material</th>
            <th className="w-24 px-2 py-2.5 text-right text-[9px] font-semibold">Net weight</th>
            <th className="w-16 px-2 py-2.5 text-[9px] font-semibold">Unit</th>
            <th className="w-28 px-2 py-2.5 text-right text-[9px] font-semibold">Rate (AUD)</th>
            <th className="w-32 px-2 py-2.5 text-right text-[9px] font-semibold">Value (AUD)</th>
          </tr>
        </thead>
        <tbody>
          {docket.lineItems.map((li, i) => (
            <tr key={li.id} className="border-b border-steel-200">
              <td className="num px-2 py-2.5 align-top text-steel-400">{i + 1}</td>
              <td className="px-2 py-2.5 align-top font-medium text-steel-900">
                {li.material?.description}
              </td>
              <td className="num px-2 py-2.5 text-right align-top text-steel-700">
                {formatNumber(li.netWeight, 2)}
              </td>
              <td className="px-2 py-2.5 align-top text-[10px] uppercase text-steel-500">
                {li.material?.unit?.toLowerCase()}
              </td>
              <td className="num px-2 py-2.5 text-right align-top text-steel-700">
                {formatNumber(li.price, 2)}
              </td>
              <td className="num px-2 py-2.5 text-right align-top font-semibold text-steel-900">
                {formatNumber(li.value, 2)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-b-2 border-steel-900 bg-paper font-semibold">
            <td />
            <td className="px-2 py-2 text-[10px] uppercase tracking-wider text-steel-500">
              Total {docket.lineItems.length} {docket.lineItems.length === 1 ? 'line' : 'lines'}
            </td>
            <td className="num px-2 py-2 text-right text-steel-900">
              {formatNumber(totalWeight, 2)}
            </td>
            <td colSpan={2} />
            <td className="num px-2 py-2 text-right text-steel-900">
              {formatNumber(docket.subtotal, 2)}
            </td>
          </tr>
        </tfoot>
      </table>

      <TotalsBlock
        words={amountInWords(docket.total)}
        rows={[
          ['Subtotal', formatAud(docket.subtotal)],
          ...(Number(docket.discountAmount) > 0
            ? [[discountLabel(docket), `− ${formatAud(docket.discountAmount)}`]]
            : []),
          [`GST${isTaxInvoice ? ' (10%)' : ''}`, formatAud(docket.gst)],
        ]}
        total={formatAud(docket.total)}
      >
        {docket.notes && (
          <div className="mt-3">
            <div className="text-[9px] font-semibold uppercase tracking-wider text-steel-400">
              Notes
            </div>
            <div className="text-[10.5px] leading-snug text-steel-700">{docket.notes}</div>
          </div>
        )}
      </TotalsBlock>

      <section className="avoid-break pt-4">
        {docket.paygStatement && (
          <div className="mb-5 border-l-2 border-copper-500 bg-paper px-3 py-2">
            <div className="text-[9px] font-bold uppercase tracking-widest text-copper-700">
              Supplier statement (PAYG withholding)
            </div>
            <div className="mt-0.5 text-[10.5px] font-medium leading-snug text-steel-900">
              {PAYG_LABELS[docket.paygStatement]}
            </div>
            <div className="mt-1 text-[9.5px] leading-snug text-steel-500">
              The supplier declares the above in respect of this sale. Where no ABN is quoted,
              this statement is the basis on which no amount has been withheld.
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-12">
          <div>
            <div className="h-11 border-b border-steel-500" />
            <div className="mt-1 text-[10px] font-medium text-steel-800">Supplier's signature</div>
            <div className="text-[9px] text-steel-400">{s?.name}</div>
          </div>
          <div className="relative">
            {settings?.stampUrl && (
              <img
                src={settings.stampUrl}
                alt=""
                className="pointer-events-none absolute -top-2 right-0 h-20 object-contain opacity-90"
              />
            )}
            <div className="h-11 border-b border-steel-500" />
            <div className="mt-1 text-[10px] font-medium text-steel-800">Buyer's signature</div>
            <div className="text-[9px] text-steel-400">For {companyName}</div>
          </div>
        </div>
      </section>

      <div className="mt-auto pt-6">
        <DocumentFooter
          settings={settings}
          reference={`${title} #${docket.docketNumber}`}
          date={docket.date}
        />
      </div>
    </div>
  );
}
