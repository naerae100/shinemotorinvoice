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

export default function InvoiceDocument({ invoice, settings }) {
  const c = invoice.consignee;
  const bank = invoice.bankSnapshot;
  const companyName = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  const totalWeight = invoice.lineItems.reduce((s, li) => s + Number(li.netWeightMt), 0);
  const currency = invoice.currency || 'AUD';
  const money = (n) => formatMoney(n, currency);
  const containers = invoice.containers ?? [];
  const joinContainers = (field) => containers.map((ct) => ct[field]).filter(Boolean).join(', ');
  const containerNoFor = (li) =>
    li.container?.containerNo ?? containers.find((ct) => ct.id === li.containerId)?.containerNo;

  return (
    <div className="print-sheet relative mx-auto flex min-h-[297mm] flex-col rounded-md border border-ink-200 bg-white p-6 shadow-xl sm:p-10 lg:p-12 text-[13px]">
      {invoice.status === 'VOID' && <VoidStamp reason={invoice.voidReason} />}
      <Masthead settings={settings} roleLabel="Exporter / Seller" />

      <section className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div>
          <PartyBlock
            heading="Consignee / Buyer"
            name={c?.name}
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

      <section className="mt-8 grid grid-cols-2 border-y-2 border-ink-900 py-5 sm:grid-cols-4">
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

      <div className="-mx-1 mt-10 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink-900 text-left uppercase tracking-[0.15em] text-ink-900">
              <th className="w-10 py-3 print:py-2 text-[11px] font-bold">#</th>
              <th className="py-3 print:py-2 text-[11px] font-bold">Description of goods</th>
              <th className="w-24 py-3 print:py-2 text-right text-[11px] font-bold">
                Weight (MT)
              </th>
              <th className="w-32 py-3 print:py-2 text-right text-[11px] font-bold">
                Unit price ({currency})
              </th>
              <th className="w-36 py-3 print:py-2 text-right text-[11px] font-bold">
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
                <tr key={li.id}>
                  <td className="num border-b border-ink-100 py-5 print:py-3 align-top text-ink-500 font-medium">
                    {i + 1}
                  </td>
                  <td className="border-b border-ink-100 py-5 print:py-3 align-top text-[14px] font-bold text-ink-900">
                    {heading}
                    {li.packageCount && (
                      <span className="font-semibold text-ink-600"> ({li.packageCount})</span>
                    )}
                    {showMaterial && (
                      <div className="mt-1 text-[12px] font-medium text-ink-500">
                        {li.material.description}
                      </div>
                    )}
                    {containers.length > 1 && containerNo && (
                      <div className="num mt-1 text-[12px] font-medium text-ink-500">{containerNo}</div>
                    )}
                  </td>
                  <td className="num border-b border-ink-100 py-5 print:py-3 text-right align-top font-semibold text-ink-800">
                    {formatNumber(li.netWeightMt, 3)}
                  </td>
                  <td className="num border-b border-ink-100 py-5 print:py-3 text-right align-top font-semibold text-ink-800">
                    {formatNumber(li.pricePerMt, 2)}
                  </td>
                  <td className="num border-b border-ink-100 py-5 print:py-3 text-right align-top font-bold text-[14px] text-ink-900">
                    {formatNumber(li.total, 2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td className="py-5 print:py-3 text-[12px] font-bold uppercase tracking-[0.15em] text-ink-900">
                Total {invoice.lineItems.length} {invoice.lineItems.length === 1 ? 'item' : 'items'}
              </td>
              <td className="num py-5 print:py-3 text-right font-bold text-ink-900">
                {formatNumber(totalWeight, 3)}
              </td>
              <td />
              <td className="num py-5 print:py-3 text-right font-bold text-[14px] text-ink-900">
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
        total={formatNumber(invoice.total, 2)}
      />

      <section className="avoid-break mt-12 flex flex-col gap-10">
        <div className="flex flex-col sm:flex-row justify-between items-start gap-8">
          <div className="flex-1">
            <div className="mb-3 text-[11px] font-bold uppercase tracking-[0.15em] text-brand-600">
              Bank details for payment
            </div>
            {bank ? (
              <table className="w-full text-[12px] leading-relaxed">
                <tbody className="text-ink-900">
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
                        <td className="w-32 py-1 pr-4 align-top text-[11px] font-bold uppercase tracking-[0.15em] text-ink-500">{label}</td>
                        <td className="num py-1 align-top font-bold">{value}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            ) : (
              <div className="text-[12px] text-ink-400 font-medium">
                No bank details were recorded on this invoice.
              </div>
            )}
          </div>

          <SignatureBlock settings={settings} className="sm:w-80 shrink-0" />
        </div>

        <div className="border-t-2 border-ink-900 pt-8">
          <div className="mb-3 text-[12px] font-bold uppercase tracking-[0.15em] text-brand-600 text-center">
            Declaration
          </div>
          <p className="text-[13px] font-semibold leading-relaxed text-ink-800 text-center max-w-3xl mx-auto">
            We declare that this invoice shows the actual price of the goods described, that all
            particulars are true and correct, and that the goods are of Australian origin.
          </p>
        </div>
      </section>

      <div className="mt-auto pt-10">
        <DocumentFooter
          settings={settings}
          reference={`Invoice ${invoice.invoiceNumber}`}
          date={invoice.date}
        />
      </div>
    </div>
  );
}
