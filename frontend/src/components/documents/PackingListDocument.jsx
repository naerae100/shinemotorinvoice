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

export default function PackingListDocument({ invoice, settings }) {
  const c = invoice.consignee;
  const companyName = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  const containers = invoice.containers ?? [];
  const lines = invoice.lineItems ?? [];

  const joinContainers = (field) => containers.map((ct) => ct[field]).filter(Boolean).join(', ');

  const assigned = new Set();
  const groups =
    containers.length > 1
      ? containers.map((ct) => {
          const own = lines.filter((li) => li.containerId === ct.id);
          own.forEach((li) => assigned.add(li.id));
          return { container: ct, lines: own };
        })
      : [{ container: null, lines }];

  if (containers.length > 1) {
    const loose = lines.filter((li) => !assigned.has(li.id));
    if (loose.length) groups.push({ container: null, lines: loose });
  }

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
    <div className="print-sheet relative mx-auto flex min-h-[297mm] flex-col bg-white p-6 sm:p-10 lg:p-10 text-[13px] sm:shadow-lg sm:ring-1 sm:ring-ink-200">
      {invoice.status === 'VOID' && <VoidStamp reason={invoice.voidReason} />}
      <Masthead settings={settings} roleLabel="Exporter / Shipper" />

      <section className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div>
          <PartyBlock
            heading="Consignee / Buyer"
            name={c?.name}
            lines={[...addressLines(c), c?.phone, c?.email]}
          />
        </div>
        <ReferenceBlock
          title="Packing slip"
          references={[
            ['Invoice no.', invoice.invoiceNumber, true],
            ['Invoice date', format(new Date(invoice.date), 'dd MMM yyyy')],
            ...(invoice.contractNo ? [['Contract no.', invoice.contractNo]] : []),
          ]}
        />
      </section>

      <section className="mt-5 grid grid-cols-2 gap-y-4 border-t border-b border-ink-900 py-4 sm:grid-cols-4">
        <Detail label="Shipping terms" value={invoice.shippingTerm} mono={false} />
        <Detail label="Port" value={invoice.fasPort} mono={false} />
        <Detail label="Mode of transport" value={invoice.modeOfTransport} mono={false} />
        <Detail label="Container type" value={joinContainers('containerType')} mono={false} />
        <Detail label="Container no." value={joinContainers('containerNo')} />
        <Detail label="Seal no." value={joinContainers('seal')} />
        <Detail label="Country of origin" value="Australia" mono={false} />
        <Detail label="Containers" value={containers.length ? String(containers.length) : null} />
      </section>

      {!weighed && (
        <div className="print-hidden mt-4 rounded-lg border border-working-amber/30 bg-working-amberDim px-4 py-2.5 text-[11px] font-medium text-ink-800">
          Some lines have no gross or tare weight, so those columns cannot be totalled.
          Add the weighbridge figures before sending this packing list.
        </div>
      )}

      <div className="mt-6 overflow-x-auto print:overflow-visible">
        <table className="doc-lines w-full min-w-[520px] text-[13px] border-collapse">
          <thead>
            <tr className="border-b-2 border-ink-900 text-left uppercase tracking-[0.15em] text-ink-900">
              <th className="w-10 py-2.5 print:py-2 text-[10px] font-bold">SI. No.</th>
              <th className="py-2.5 print:py-2 text-[10px] font-bold">Product</th>
              <th className="w-28 py-2.5 print:py-2 text-right text-[10px] font-bold">Gross weight (MT)</th>
              <th className="w-28 py-2.5 print:py-2 text-right text-[10px] font-bold">Tare weight (MT)</th>
              <th className="w-28 py-2.5 print:py-2 text-right text-[10px] font-bold">
                Net weight (MT)
              </th>
            </tr>
          </thead>
          <tbody className="bg-white">
            {groups.map((group, gi) => (
              <Fragment key={group.container?.id ?? `loose-${gi}`}>
                {containers.length > 1 && (
                  <tr>
                    <td colSpan={5} className="border-b border-ink-200 py-2 print:py-1.5">
                      <span className="num text-[11px] font-bold text-ink-900">
                        {group.container?.containerNo || 'Not assigned to a container'}
                      </span>
                      {group.container && (
                        <span className="ml-3 text-[10.5px] font-medium text-ink-600">
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
                      <td className="num border-b border-ink-100 py-2.5 print:py-2 align-top text-ink-500 font-medium">
                        {serial}
                      </td>
                      <td className="border-b border-ink-100 py-2.5 print:py-2 align-top text-[13px] font-bold text-ink-900">
                        {heading}
                        {li.packageCount && (
                          <span className="font-semibold text-ink-600"> ({li.packageCount})</span>
                        )}
                        {showMaterial && (
                          <div className="mt-0.5 text-[11.5px] font-medium text-ink-500">
                            {li.material.description}
                          </div>
                        )}
                      </td>
                      <td className="num border-b border-ink-100 py-2.5 print:py-2 text-right align-top font-semibold text-ink-800">
                        {weight(li.grossWeightMt)}
                      </td>
                      <td className="num border-b border-ink-100 py-2.5 print:py-2 text-right align-top font-semibold text-ink-800">
                        {weight(li.tareWeightMt)}
                      </td>
                      <td className="num border-b border-ink-100 py-2.5 print:py-2 text-right align-top font-bold text-[13px] text-ink-900">
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
              <td className="py-3 print:py-2 text-[11.5px] font-bold uppercase tracking-[0.15em] text-ink-900">
                Total net weight
              </td>
              <td />
              <td />
              <td className="num py-3 print:py-2 text-right font-bold text-[13.5px] text-ink-900">
                {formatNumber(totals.net, 3)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <section className="avoid-break mt-6 flex flex-col gap-6">
        <div className="flex justify-end">
          <SignatureBlock settings={settings} className="sm:w-80 shrink-0" />
        </div>

        <div className="border-t border-ink-200 pt-4">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-ink-900 text-center">
            Declaration
          </div>
          <p className="text-[12px] font-bold leading-relaxed text-ink-800 text-center max-w-3xl mx-auto">
            All the goods are from Australia.
          </p>
          <p className="mt-1 text-[11.5px] font-medium leading-relaxed text-ink-600 text-center max-w-3xl mx-auto">
            We declare that the particulars given above are true and correct, and that the packages
            described are those presented for shipment.
          </p>
        </div>
      </section>

      <div className="mt-auto pt-6">
        <DocumentFooter
          settings={settings}
          reference={`Packing slip ${invoice.invoiceNumber}`}
          date={invoice.date}
        />
      </div>
    </div>
  );
}
