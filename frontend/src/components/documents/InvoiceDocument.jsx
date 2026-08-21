import { format } from 'date-fns';
import { formatAud, formatNumber, amountInWords } from '../../lib/format';
import { Detail, PartyBlock, Masthead, ReferenceBlock, TotalsBlock, DocumentFooter, discountLabel, VoidStamp } from './parts';

/**
 * The printable export commercial invoice. Pure — give it an invoice and the
 * company settings and it renders; it fetches nothing of its own.
 */
export default function InvoiceDocument({ invoice, settings }) {
  const c = invoice.consignee;
  const bank = invoice.bankSnapshot;
  const companyName = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  const totalWeight = invoice.lineItems.reduce((s, li) => s + Number(li.weightTonnes), 0);

  return (
    <div className="print-sheet relative mx-auto flex min-h-[297mm] flex-col border border-steel-300 bg-white p-10 shadow-ticket">
      {invoice.status === 'VOID' && <VoidStamp reason={invoice.voidReason} />}
      <Masthead settings={settings} roleLabel="Exporter / Seller" />

      <section className="grid grid-cols-2 border-b border-steel-300">
        <div className="border-r border-steel-300">
          <PartyBlock
            heading="Consignee / Buyer"
            name={c?.name}
            lines={[c?.address, c?.country, c?.phone, c?.email]}
          />
        </div>
        <ReferenceBlock
          title="Commercial Invoice"
          references={[
            ['Invoice no.', invoice.invoiceNumber, true],
            ['Date', format(new Date(invoice.date), 'dd MMM yyyy')],
            ['PO no.', invoice.poNumber],
          ]}
        />
      </section>

      <section className="grid grid-cols-4 border-b border-steel-300 bg-paper">
        <Detail label="Shipping terms" value={invoice.shippingTerm} mono={false} />
        <Detail label="Port" value={invoice.fasPort} mono={false} />
        <Detail label="Mode of transport" value={invoice.modeOfTransport} mono={false} />
        <Detail label="Container type" value={invoice.containerType} mono={false} />
        <Detail label="Container no." value={invoice.containerNo} />
        <Detail label="Seal no." value={invoice.seal} />
        <Detail label="Country of origin" value="Australia" mono={false} />
        <Detail label="Currency" value={invoice.applyGst ? 'AUD (incl. GST)' : 'AUD'} mono={false} />
      </section>

      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr className="bg-steel-900 text-left uppercase tracking-wider text-paper">
            <th className="w-8 px-2 py-2.5 text-[9px] font-semibold">#</th>
            <th className="px-2 py-2.5 text-[9px] font-semibold">Description of goods</th>
            <th className="w-24 px-2 py-2.5 text-right text-[9px] font-semibold">Weight (MT)</th>
            <th className="w-28 px-2 py-2.5 text-right text-[9px] font-semibold">
              Unit price (AUD)
            </th>
            <th className="w-32 px-2 py-2.5 text-right text-[9px] font-semibold">Amount (AUD)</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((li, i) => {
            const heading = li.description || li.material?.description;
            const showMaterial =
              li.description && li.material?.description && li.description !== li.material.description;
            return (
              <tr key={li.id} className="border-b border-steel-200">
                <td className="num px-2 py-2.5 align-top text-steel-400">{i + 1}</td>
                <td className="px-2 py-2.5 align-top font-medium text-steel-900">
                  {heading}
                  {showMaterial && (
                    <div className="text-[10px] font-normal text-steel-500">
                      {li.material.description}
                    </div>
                  )}
                </td>
                <td className="num px-2 py-2.5 text-right align-top text-steel-700">
                  {formatNumber(li.weightTonnes, 3)}
                </td>
                <td className="num px-2 py-2.5 text-right align-top text-steel-700">
                  {formatNumber(li.pricePerMt, 2)}
                </td>
                <td className="num px-2 py-2.5 text-right align-top font-semibold text-steel-900">
                  {formatNumber(li.totalAud, 2)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-b-2 border-steel-900 bg-paper font-semibold">
            <td />
            <td className="px-2 py-2 text-[10px] uppercase tracking-wider text-steel-500">
              Total {invoice.lineItems.length} {invoice.lineItems.length === 1 ? 'item' : 'items'}
            </td>
            <td className="num px-2 py-2 text-right text-steel-900">
              {formatNumber(totalWeight, 3)}
            </td>
            <td />
            <td className="num px-2 py-2 text-right text-steel-900">
              {formatNumber(invoice.subtotalAud, 2)}
            </td>
          </tr>
        </tfoot>
      </table>

      <TotalsBlock
        words={amountInWords(invoice.totalAud)}
        rows={[
          ['Subtotal', formatAud(invoice.subtotalAud)],
          ...(Number(invoice.discountAmount) > 0
            ? [[discountLabel(invoice), `− ${formatAud(invoice.discountAmount)}`]]
            : []),
          ...(invoice.applyGst ? [['GST (10%)', formatAud(invoice.gstAud)]] : []),
        ]}
        total={formatAud(invoice.totalAud)}
      />

      <section className="avoid-break grid grid-cols-2 gap-6 pt-4">
        <div>
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-copper-700">
            Bank details for payment
          </div>
          {bank ? (
            <table className="w-full text-[10.5px] leading-snug">
              <tbody className="text-steel-800">
                {[
                  ['Beneficiary', bank.beneficiary],
                  ['Bank', bank.bankName],
                  ['BSB', bank.bankBsb],
                  ['Account no.', bank.bankAccountNo],
                  ['SWIFT', bank.bankSwift],
                  ['Bank address', bank.bankAddress],
                ]
                  .filter(([, v]) => v)
                  .map(([label, value]) => (
                    <tr key={label}>
                      <td className="w-24 py-0.5 pr-2 align-top text-steel-400">{label}</td>
                      <td className="num py-0.5 align-top font-medium">{value}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[10.5px] text-steel-400">
              No bank details were recorded on this invoice.
            </div>
          )}
        </div>

        <div className="flex flex-col">
          <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-copper-700">
            Declaration
          </div>
          <p className="text-[10px] leading-snug text-steel-600">
            We declare that this invoice shows the actual price of the goods described, that all
            particulars are true and correct, and that the goods are of Australian origin.
          </p>

          <div className="relative mt-auto pt-10">
            {settings?.stampUrl && (
              <img
                src={settings.stampUrl}
                alt=""
                className="pointer-events-none absolute bottom-8 right-0 h-20 object-contain opacity-90"
              />
            )}
            <div className="border-b border-steel-500" />
            <div className="mt-1 text-[10px] font-medium text-steel-700">
              For and on behalf of {companyName}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-steel-400">
              Authorised signatory
            </div>
          </div>
        </div>
      </section>

      <div className="mt-auto pt-6">
        <DocumentFooter
          settings={settings}
          reference={`Invoice ${invoice.invoiceNumber}`}
          date={invoice.date}
        />
      </div>
    </div>
  );
}
