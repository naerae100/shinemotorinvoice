import { Fragment } from 'react';
import { format } from 'date-fns';
import { addressLines, formatNumber } from '../../lib/format';
import {
  Detail,
  PartyBlock,
  Masthead,
  ReferenceBlock,
  DocumentFooter,
  VoidStamp,
  SignatureBlock,
} from './parts';

/**
 * The printable packing list. Pure — give it an invoice and the company settings
 * and it renders; it fetches nothing of its own.
 *
 * A packing list and its commercial invoice are the same shipment described
 * twice: identical parties, references and containers, with one band of columns
 * swapped. Here the goods are weighed (gross / tare / net); on the invoice the
 * net weight is priced. That is why this reads from an ExportInvoice rather than
 * a record of its own — the net weight a customs officer checks and the net
 * weight the buyer is billed for must be the same number, and the only way to
 * guarantee that is for there to be one number.
 */
export default function PackingListDocument({ invoice, settings }) {
  const c = invoice.consignee;
  const companyName = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  const containers = invoice.containers ?? [];
  const lines = invoice.lineItems ?? [];

  // Several containers are listed one per line rather than crammed into the
  // single-value box the layout gives each detail.
  const joinContainers = (field) => containers.map((ct) => ct[field]).filter(Boolean).join(', ');

  /**
   * Goods are listed under the container they travelled in, because that is the
   * unit the list is checked against — someone opens one container and ticks off
   * what is in front of them. With a single container the heading would be noise,
   * so the lines are simply listed.
   *
   * Grouping keys off the `containerId` scalar rather than the `container`
   * relation. The scalar is on the row whatever the endpoint chose to include,
   * so the grouping cannot quietly collapse into "unassigned" if that include
   * is ever changed.
   */
  const assigned = new Set();
  const groups =
    containers.length > 1
      ? containers.map((ct) => {
          const own = lines.filter((li) => li.containerId === ct.id);
          own.forEach((li) => assigned.add(li.id));
          return { container: ct, lines: own };
        })
      : [{ container: null, lines }];

  // A line on no container — or on one since removed — still has to appear. A
  // packing list that quietly omits a row is worse than one that looks untidy.
  if (containers.length > 1) {
    const loose = lines.filter((li) => !assigned.has(li.id));
    if (loose.length) groups.push({ container: null, lines: loose });
  }

  /**
   * Gross and tare are nullable on a line — an invoice can be raised before the
   * truck is weighed — so a column is only totalled when every line carries it.
   * Summing the rows that happen to have a figure would print a shipment weight
   * that is short by however many were missing, and nothing on the page would
   * say so. Net is always present, so it always totals.
   */
  const sumIfComplete = (rows, field) =>
    rows.length && rows.every((li) => li[field] != null && li[field] !== '')
      ? rows.reduce((sum, li) => sum + Number(li[field]), 0)
      : null;

  const weight = (v) => (v == null ? '—' : formatNumber(v, 3));
  const weighed = lines.every((li) => li.grossWeightMt != null && li.tareWeightMt != null);

  const totals = {
    gross: sumIfComplete(lines, 'grossWeightMt'),
    tare: sumIfComplete(lines, 'tareWeightMt'),
    net: lines.reduce((sum, li) => sum + Number(li.netWeightMt), 0),
  };

  let serial = 0;

  return (
    <div className="print-sheet relative mx-auto flex min-h-[297mm] flex-col rounded-md border border-ink-200 bg-white p-6 shadow-xl sm:p-10 lg:p-12 text-[13px]">
      {invoice.status === 'VOID' && <VoidStamp reason={invoice.voidReason} />}
      <Masthead settings={settings} roleLabel="Exporter / Shipper" />

      <section className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-2">
        <div>
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
          title="Packing List"
          references={[
            // The packing list carries the invoice's number, not one of its
            // own: the pair is filed, cleared and paid against a single
            // reference, which is what the buyer quotes back.
            ['Invoice no.', invoice.invoiceNumber, true],
            ['Invoice date', format(new Date(invoice.date), 'dd MMM yyyy')],
            ...(invoice.contractNo ? [['Contract no.', invoice.contractNo]] : []),
          ]}
        />
      </section>

      <section className="mt-8 grid grid-cols-2 border-y-2 border-ink-900 py-4 sm:grid-cols-4">
        <Detail label="Shipping terms" value={invoice.shippingTerm} mono={false} />
        <Detail label="Port" value={invoice.fasPort} mono={false} />
        <Detail label="Mode of transport" value={invoice.modeOfTransport} mono={false} />
        <Detail label="Container type" value={joinContainers('containerType')} mono={false} />
        <Detail label="Container no." value={joinContainers('containerNo')} />
        <Detail label="Seal no." value={joinContainers('seal')} />
        <Detail label="Country of origin" value="Australia" mono={false} />
        {/* How the goods are made up is stated per line, in the parentheses after
            each description, as the spreadsheets this replaces did it. Repeating
            every package count up here would restate the table badly: across
            several containers it collapses into an unreadable run of counts
            belonging to nothing in particular. The count of containers is what
            belongs in this last cell — it is checked off against the goods, and
            it keeps the band of details square. */}
        <Detail label="Containers" value={containers.length ? String(containers.length) : null} />
      </section>

      {/* On screen only. A list still missing gross or tare weights is not ready
          to travel — customs clears on gross — and the printed page deliberately
          shows an em dash rather than a total, so the gap has to be caught here. */}
      {!weighed && (
        <div className="print-hidden mt-6 rounded-xl border border-working-amber/30 bg-working-amberDim px-4 py-2.5 text-[11px] font-medium text-ink-800">
          Some lines have no gross or tare weight, so those columns cannot be totalled.
          Add the weighbridge figures before sending this packing list.
        </div>
      )}

      <div className="-mx-1 mt-8 overflow-x-auto px-1 print:mx-0 print:overflow-visible print:px-0">
        <table className="w-full min-w-[520px] text-[13px]">
          <thead>
            <tr className="border-b-2 border-ink-900 text-left uppercase tracking-[0.15em] text-ink-900">
              <th className="w-10 py-3 print:py-2 text-[11px] font-bold">SI. No.</th>
              <th className="py-3 print:py-2 text-[11px] font-bold">Product</th>
              <th className="w-28 py-3 print:py-2 text-right text-[11px] font-bold">Gross weight (MT)</th>
              <th className="w-28 py-3 print:py-2 text-right text-[11px] font-bold">Tare weight (MT)</th>
              <th className="w-28 py-3 print:py-2 text-right text-[11px] font-bold">
                Net weight (MT)
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group, gi) => (
              <Fragment key={group.container?.id ?? `loose-${gi}`}>
                {containers.length > 1 && (
                  <tr className="bg-ink-50">
                    <td colSpan={5} className="border-b border-ink-200 px-3 py-3 print:py-2">
                      <span className="num text-[12px] font-bold text-ink-900">
                        {group.container?.containerNo || 'Not assigned to a container'}
                      </span>
                      {group.container && (
                        <span className="ml-3 text-[11px] font-medium text-ink-500">
                          {[
                            group.container.containerType,
                            group.container.seal && `Seal ${group.container.seal}`,
                          ]
                            .filter(Boolean)
                            .join('  ·  ')}
                        </span>
                      )}
                    </td>
                  </tr>
                )}

                {group.lines.map((li) => {
                  serial += 1;
                  const heading = li.description || li.material?.description;
                  const showMaterial =
                    li.description &&
                    li.material?.description &&
                    li.description !== li.material.description;
                  return (
                  <tr key={li.id}>
                      <td className="num border-b border-ink-100 py-5 print:py-3 align-top text-ink-500 font-medium">
                        {serial}
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
                      </td>
                      <td className="num border-b border-ink-100 py-5 print:py-3 text-right align-top font-semibold text-ink-800">
                        {weight(li.grossWeightMt)}
                      </td>
                      <td className="num border-b border-ink-100 py-5 print:py-3 text-right align-top font-semibold text-ink-800">
                        {weight(li.tareWeightMt)}
                      </td>
                      <td className="num border-b border-ink-100 py-5 print:py-3 text-right align-top font-bold text-[14px] text-ink-900">
                        {formatNumber(li.netWeightMt, 3)}
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td className="py-5 print:py-3 text-[12px] font-bold uppercase tracking-[0.15em] text-ink-900">
                Total net weight
              </td>
              <td />
              <td />
              <td className="num py-5 print:py-3 text-right font-bold text-[14px] text-ink-900">
                {formatNumber(totals.net, 3)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section className="avoid-break mt-12 flex flex-col gap-10">
        <div className="flex justify-end">
          <SignatureBlock settings={settings} className="sm:w-80 shrink-0" />
        </div>

        <div className="border-t-2 border-ink-900 pt-8">
          <div className="mb-3 text-[12px] font-bold uppercase tracking-[0.15em] text-brand-600 text-center">
            Declaration
          </div>
          <p className="text-[13px] font-bold leading-relaxed text-ink-800 text-center max-w-3xl mx-auto">
            All the goods are from Australia.
          </p>
          <p className="mt-2 text-[12px] font-medium leading-relaxed text-ink-600 text-center max-w-3xl mx-auto">
            We declare that the particulars given above are true and correct, and that the packages
            described are those presented for shipment.
          </p>
        </div>
      </section>

      <div className="mt-auto pt-8">
        <DocumentFooter
          settings={settings}
          reference={`Packing list ${invoice.invoiceNumber}`}
          date={invoice.date}
        />
      </div>
    </div>
  );
}
