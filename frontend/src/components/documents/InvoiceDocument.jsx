import { format } from 'date-fns';
import { addressLines, formatMoney, formatNumber, amountInWords } from '../../lib/format';
import {
  Detail,
  PartyBlock,
  Masthead,
  ReferenceBlock,
  TotalsBlock,
  SignatureBlock,
  DocumentFooter,
  discountLabel,
  VoidStamp,
} from './parts';

/**
 * The printable export commercial invoice. Pure — give it an invoice and the
 * company settings and it renders; it fetches nothing of its own.
 *
 * Laid out as the sibling of PackingListDocument: same masthead, same parties
 * row, same table treatment, same execution block. The two are handed to the
 * buyer together and are checked against each other, so anything that differs
 * between them should differ because the documents differ — here, the goods are
 * priced rather than weighed.
 */
export default function InvoiceDocument({ invoice, settings }) {
  const c = invoice.consignee;
  const bank = invoice.bankSnapshot;
  const companyName = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  const totalWeight = invoice.lineItems.reduce((s, li) => s + Number(li.netWeightMt), 0);
  const currency = invoice.currency || 'AUD';
  const money = (n) => formatMoney(n, currency);
  const containers = invoice.containers ?? [];
  // Several containers are listed one per line rather than crammed into the
  // single-value box the layout gives each detail.
  const joinContainers = (field) => containers.map((ct) => ct[field]).filter(Boolean).join(', ');
  const containerNoFor = (li) =>
    li.container?.containerNo ?? containers.find((ct) => ct.id === li.containerId)?.containerNo;

  return (
    <div className="print-sheet relative mx-auto flex min-h-[297mm] flex-col rounded-2xl border border-ink-200 bg-white p-5 shadow-ticket sm:p-8 lg:p-10">
      {invoice.status === 'VOID' && <VoidStamp reason={invoice.voidReason} />}
      <Masthead settings={settings} roleLabel="Exporter / Seller" />

      <section className="grid grid-cols-1 border-b border-ink-200 sm:grid-cols-2">
        <div className="border-r border-ink-200">
          <PartyBlock
            heading="Consignee / Buyer"
            name={c?.name}
            // Street, then "Suburb STATE 2565", then the country — falling back
            // to the single imported line for a buyer whose parts are not filled
            // in. See addressLines.
            lines={[...addressLines(c), c?.phone, c?.email]}
          />
        </div>
        <ReferenceBlock
          title="Commercial Invoice"
          references={[
            ['Invoice no.', invoice.invoiceNumber, true],
            ['Invoice date', format(new Date(invoice.date), 'dd MMM yyyy')],
            ...(invoice.contractNo ? [['Contract no.', invoice.contractNo]] : []),
          ]}
        />
      </section>

      <section className="grid grid-cols-2 border-b border-ink-200 bg-ink-50 sm:grid-cols-4">
        <Detail label="Shipping terms" value={invoice.shippingTerm} mono={false} />
        <Detail label="Port" value={invoice.fasPort} mono={false} />
        <Detail label="Mode of transport" value={invoice.modeOfTransport} mono={false} />
        <Detail label="Container type" value={joinContainers('containerType')} mono={false} />
        <Detail label="Container no." value={joinContainers('containerNo')} />
        <Detail label="Seal no." value={joinContainers('seal')} />
        <Detail label="Country of origin" value="Australia" mono={false} />
        <Detail
          label="Currency"
          value={invoice.applyGst ? `${currency} (incl. GST)` : currency}
          mono={false}
        />
      </section>

      <div className="-mx-1 mt-3 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
      <table className="w-full min-w-[520px] overflow-hidden rounded-xl border-separate border-spacing-0 text-[11.5px] ring-1 ring-ink-200">
        <thead>
          <tr className="bg-ink-900 text-left uppercase tracking-[0.1em] text-white">
            <th className="w-10 rounded-tl-xl px-3 py-3 print:py-1.5 text-[9.5px] font-bold">#</th>
            <th className="px-2 py-3 print:py-1.5 text-[9.5px] font-bold">Description of goods</th>
            <th className="w-24 px-2 py-3 print:py-1.5 text-right text-[9.5px] font-bold">
              Weight (MT)
            </th>
            <th className="w-28 px-2 py-3 print:py-1.5 text-right text-[9.5px] font-bold">
              Unit price ({currency})
            </th>
            <th className="w-32 rounded-tr-xl px-3 py-3 print:py-1.5 text-right text-[9.5px] font-bold">
              Amount ({currency})
            </th>
          </tr>
        </thead>
        <tbody>
          {invoice.lineItems.map((li, i) => {
            const heading = li.description || li.material?.description;
            const showMaterial =
              li.description && li.material?.description && li.description !== li.material.description;
            const containerNo = containerNoFor(li);
            return (
              <tr key={li.id} className={i % 2 ? 'bg-ink-50' : ''}>
                <td className="num border-b border-ink-200 px-3 py-3 print:py-1.5 align-top text-ink-300">
                  {i + 1}
                </td>
                <td className="border-b border-ink-200 px-2 py-3 print:py-1.5 align-top text-[12.5px] font-semibold text-ink-900">
                  {heading}
                  {li.packageCount && (
                    <span className="font-medium text-ink-500"> ({li.packageCount})</span>
                  )}
                  {showMaterial && (
                    <div className="text-[9.5px] font-medium text-ink-500">
                      {li.material.description}
                    </div>
                  )}
                  {/* Only worth naming when there is more than one to tell apart. */}
                  {containers.length > 1 && containerNo && (
                    <div className="num text-[9.5px] font-medium text-ink-500">{containerNo}</div>
                  )}
                </td>
                <td className="num border-b border-ink-200 px-2 py-3 print:py-1.5 text-right align-top text-ink-700">
                  {formatNumber(li.netWeightMt, 3)}
                </td>
                <td className="num border-b border-ink-200 px-2 py-3 print:py-1.5 text-right align-top text-ink-700">
                  {formatNumber(li.pricePerMt, 2)}
                </td>
                <td className="num border-b border-ink-200 px-3 py-3 print:py-1.5 text-right align-top font-semibold text-ink-900">
                  {formatNumber(li.total, 2)}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="bg-ink-100 font-semibold">
            <td className="rounded-bl-xl" />
            <td className="px-2 py-3 print:py-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-700">
              Total {invoice.lineItems.length} {invoice.lineItems.length === 1 ? 'item' : 'items'}
            </td>
            <td className="num px-2 py-3 print:py-1.5 text-right text-ink-900">
              {formatNumber(totalWeight, 3)}
            </td>
            <td />
            <td className="num rounded-br-xl px-3 py-3 print:py-1.5 text-right text-ink-900">
              {formatNumber(invoice.subtotal, 2)}
            </td>
          </tr>
        </tfoot>
      </table>
      </div>

      <TotalsBlock
        words={amountInWords(invoice.total, currency)}
        currency={currency}
        rows={[
          ['Subtotal', money(invoice.subtotal)],
          ...(Number(invoice.discountAmount) > 0
            ? [[discountLabel(invoice), `− ${money(invoice.discountAmount)}`]]
            : []),
          ...(invoice.applyGst ? [['GST (10%)', money(invoice.gst)]] : []),
        ]}
        // Bare figure: the plate's own label already names the currency, and
        // printing it twice reads as two different numbers at a glance.
        total={formatNumber(invoice.total, 2)}
      />

      <section className="avoid-break grid grid-cols-1 gap-8 pt-4 sm:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[9.5px] font-bold uppercase tracking-[0.12em] text-brand-600">
            Bank details for payment
          </div>
          {bank ? (
            <table className="w-full text-[10.5px] leading-snug">
              <tbody className="text-ink-800">
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
                      <td className="w-24 py-0.5 pr-2 align-top text-ink-500">{label}</td>
                      <td className="num py-0.5 align-top font-semibold">{value}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <div className="text-[10.5px] text-ink-400">
              No bank details were recorded on this invoice.
            </div>
          )}

          <div className="mt-3">
            <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.12em] text-brand-600">
              Declaration
            </div>
            <p className="text-[10px] leading-relaxed text-ink-600">
              We declare that this invoice shows the actual price of the goods described, that all
              particulars are true and correct, and that the goods are of Australian origin.
            </p>
          </div>
        </div>

        <SignatureBlock settings={settings} companyName={companyName} />
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
