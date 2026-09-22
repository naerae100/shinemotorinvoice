import { format } from 'date-fns';
import { formatNumber } from '../../lib/format';
import { Masthead, DocumentFooter, VoidStamp } from './parts';

/**
 * The printable field collection.
 *
 * Deliberately not styled like a docket, because it is not one. A docket is a
 * tax document with a price, a GST line and a signed PAYG declaration; this
 * is a record of what was weighed and by whom, with no money on it anywhere.
 * Printing it in the same clothes would invite somebody to treat it as a bill.
 *
 * What it is for: handing or emailing to the seller so both sides hold the
 * same numbers, and settling a later argument about a weight. So the two
 * weighings sit side by side with the difference stated, and the photographs
 * are listed rather than printed — a thumbnail on paper proves nothing, while
 * a count and a filename says what exists to be looked at.
 */
export default function CollectionDocument({ collection, settings }) {
  const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
  const totalNet = round3(collection.lines.reduce((a, l) => a + Number(l.netWeight), 0));

  const both = collection.lines.filter((l) => l.supplierNetWeight != null);
  const comparison = both.length
    ? {
        lines: both.length,
        ours: round3(both.reduce((a, l) => a + Number(l.netWeight), 0)),
        theirs: round3(both.reduce((a, l) => a + Number(l.supplierNetWeight), 0)),
      }
    : null;

  const photoCount =
    collection.photos.length + collection.lines.reduce((a, l) => a + l.photos.length, 0);

  const s = collection.localSupplier;
  const where = [s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(', ');

  return (
    <div className="print-sheet relative mx-auto flex min-h-[297mm] flex-col rounded-2xl border border-ink-200 bg-white p-5 shadow-ticket sm:p-8 lg:p-10">
      {collection.status === 'VOID' && <VoidStamp reason={collection.voidReason} />}
      <Masthead settings={settings} />

      <section className="mt-4 grid grid-cols-1 gap-4 border-b border-ink-200 pb-4 sm:grid-cols-2">
        <div>
          <div className="text-[9.5px] font-bold uppercase tracking-wider text-brand-700">
            Collected from
          </div>
          <div className="mt-1 text-[15px] font-bold text-ink-900">{s.name}</div>
          {where && <div className="text-[10.5px] text-ink-600">{where}</div>}
          {s.phone && <div className="num text-[10.5px] text-ink-600">{s.phone}</div>}
        </div>

        <div className="sm:text-right">
          <div className="font-display text-[22px] font-bold leading-none tracking-tight text-ink-900">
            Field Collection
          </div>
          <div className="mt-2 space-y-0.5 text-[10.5px]">
            <Line label="Collection no." value={`#${collection.collectionNumber}`} />
            <Line
              label="Date"
              value={format(new Date(collection.date), 'd MMM yyyy')}
            />
            <Line label="Time" value={format(new Date(collection.date), 'HH:mm')} />
            <Line label="Recorded by" value={collection.createdBy?.name ?? '—'} />
          </div>
        </div>
      </section>

      {/* No price column anywhere on this sheet. Nothing was bought. */}
      <table className="mt-4 w-full border-collapse text-[10.5px]">
        <thead>
          <tr className="bg-ink-900 text-white">
            <th className="px-2 py-1.5 text-left text-[9.5px] font-bold uppercase tracking-wider">
              Grade
            </th>
            <th className="px-2 py-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider">
              Our gross
            </th>
            <th className="px-2 py-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider">
              Tare
            </th>
            <th className="px-2 py-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider">
              Our net
            </th>
            <th className="px-2 py-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider">
              Their net
            </th>
            <th className="px-2 py-1.5 text-right text-[9.5px] font-bold uppercase tracking-wider">
              Diff
            </th>
          </tr>
        </thead>
        <tbody>
          {collection.lines.map((l, i) => {
            const theirs = l.supplierNetWeight == null ? null : Number(l.supplierNetWeight);
            const diff = theirs === null ? null : round3(Number(l.netWeight) - theirs);
            return (
              <tr key={l.id} className={i % 2 ? 'bg-ink-50' : ''}>
                <td className="px-2 py-1.5 text-ink-900">
                  {l.material?.description ?? l.description}
                </td>
                <td className="num px-2 py-1.5 text-right text-ink-700">
                  {formatNumber(l.grossWeight, 3)}
                </td>
                <td className="num px-2 py-1.5 text-right text-ink-700">
                  {formatNumber(l.tareWeight, 3)}
                </td>
                <td className="num px-2 py-1.5 text-right font-bold text-ink-900">
                  {formatNumber(l.netWeight, 3)}
                </td>
                <td className="num px-2 py-1.5 text-right text-ink-700">
                  {theirs === null ? '—' : formatNumber(theirs, 3)}
                </td>
                <td className="num px-2 py-1.5 text-right font-bold text-ink-900">
                  {diff === null ? '—' : `${diff > 0 ? '+' : ''}${formatNumber(diff, 3)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="mt-4 flex flex-col gap-4 sm:flex-row sm:justify-between">
        <div className="max-w-[60%] text-[10.5px]">
          {collection.notes && (
            <>
              <div className="text-[9.5px] font-bold uppercase tracking-wider text-brand-700">
                Notes
              </div>
              <p className="mt-0.5 whitespace-pre-line leading-relaxed text-ink-700">
                {collection.notes}
              </p>
            </>
          )}
          {/* Listed, not printed. A thumbnail on paper proves nothing; a
              count tells the reader what exists to be looked at. */}
          {photoCount > 0 && (
            <p className="mt-2 text-[10px] text-ink-600">
              {photoCount} {photoCount === 1 ? 'photograph' : 'photographs'} held against this
              collection in the system.
            </p>
          )}
        </div>

        <div className="min-w-[46%] text-[11px]">
          <Total label="Total net weight (ours)" value={`${formatNumber(totalNet, 3)} kg`} strong />
          {comparison && (
            <>
              <Total
                label={
                  comparison.lines < collection.lines.length
                    ? `Supplier total (${comparison.lines} of ${collection.lines.length} grades)`
                    : 'Supplier total'
                }
                value={`${formatNumber(comparison.theirs, 3)} kg`}
              />
              <div className="mt-1 flex items-baseline justify-between border-t-2 border-ink-900 pt-1.5">
                <span className="text-[11.5px] font-bold text-ink-900">Difference</span>
                <span className="num text-[15px] font-bold text-ink-900">
                  {comparison.ours - comparison.theirs > 0 ? '+' : ''}
                  {formatNumber(round3(comparison.ours - comparison.theirs), 3)} kg
                </span>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Two signatures, because the whole point of the second weighing is
          that both parties agreed what was on the truck. */}
      <section className="mt-8 grid grid-cols-2 gap-8 text-[10px]">
        <SignatureLine label="Supplier's signature" />
        <SignatureLine label="Collected by" />
      </section>

      <div className="mt-auto pt-6">
        <DocumentFooter
          settings={settings}
          reference={`Field Collection #${collection.collectionNumber}`}
          date={collection.date}
        />
      </div>
    </div>
  );
}

function Line({ label, value }) {
  return (
    <div className="flex justify-between gap-6 sm:justify-end">
      <span className="text-[9.5px] font-bold uppercase tracking-wider text-ink-500">{label}</span>
      <span className="num font-bold text-ink-900">{value}</span>
    </div>
  );
}

function Total({ label, value, strong = false }) {
  return (
    <div className="flex items-baseline justify-between gap-6 py-0.5">
      <span className={strong ? 'font-bold text-ink-800' : 'text-ink-600'}>{label}</span>
      <span className={`num ${strong ? 'font-bold text-ink-900' : 'text-ink-700'}`}>{value}</span>
    </div>
  );
}

function SignatureLine({ label }) {
  return (
    <div>
      <div className="h-8 border-b border-ink-400" />
      <div className="mt-1 text-[9.5px] font-bold uppercase tracking-wider text-ink-600">
        {label}
      </div>
    </div>
  );
}
