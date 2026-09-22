import { Fragment } from 'react';
import { format } from 'date-fns';
import { formatNumber } from '../../lib/format';
import { collectionRef } from '../../lib/collectionRef';

/**
 * The shareable field collection.
 *
 * Deliberately not styled like a docket, and not only because it is not one.
 * A docket is a tax document — price, GST, a signed PAYG declaration — and
 * dressing this in the same clothes invites somebody to read it as a bill.
 * Nothing on this page was bought.
 *
 * What it is for: sending to the seller so both sides hold the same numbers,
 * and settling a later argument about a weight. So the sheet is built around
 * one table where all six weights sit under two banners, ours and theirs,
 * with the difference at the end of every row and the lot totalled at the
 * foot. No signature lines: this is normally read on a phone, and an empty
 * signature box on a page nobody prints just makes the document look
 * unfinished.
 *
 * One page is a hard constraint, so the type is small, the rows are tight,
 * and nothing is said twice that the table already says once.
 */
export default function CollectionDocument({ collection, settings }) {
  const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;
  const num = (v) => (v == null ? null : Number(v));

  const lines = collection.lines;
  const compared = lines.filter((l) => l.supplierNetWeight != null);

  const sum = (rows, pick) => round3(rows.reduce((a, l) => a + (num(pick(l)) ?? 0), 0));
  const totals = {
    gross: sum(lines, (l) => l.grossWeight),
    tare: sum(lines, (l) => l.tareWeight),
    net: sum(lines, (l) => l.netWeight),
    theirGross: sum(compared, (l) => l.supplierGrossWeight),
    theirTare: sum(compared, (l) => l.supplierTareWeight),
    theirNet: sum(compared, (l) => l.supplierNetWeight),
  };
  // Like for like: only grades both sides weighed can be differenced. The
  // full total would make a partial comparison look like a huge shortfall.
  const comparableNet = sum(compared, (l) => l.netWeight);
  const difference = compared.length ? round3(comparableNet - totals.theirNet) : null;

  const photoCount = collection.photos.length + lines.reduce((a, l) => a + l.photos.length, 0);

  const s = collection.localSupplier;
  const where = [s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(', ');
  const company = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  const contact = [settings?.address, settings?.phone].filter(Boolean).join('  ·  ');

  return (
    <div className="print-sheet mx-auto flex flex-col bg-white p-5 text-ink-900 sm:min-h-[297mm] sm:p-8">
      {/* ── Letterhead ─────────────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-6 border-b-2 border-ink-900 pb-3">
        <div className="min-w-0">
          {settings?.logoUrl ? (
            <img src={settings.logoUrl} alt={company} className="h-12 object-contain object-left" />
          ) : (
            <div className="font-display text-[17px] font-bold leading-tight">{company}</div>
          )}
          {settings?.logoUrl && (
            <div className="mt-1 text-[10px] font-semibold text-ink-700">{company}</div>
          )}
          <div className="mt-0.5 text-[9px] leading-snug text-ink-500">
            {settings?.abn && <span className="num">ABN {settings.abn}</span>}
            {settings?.abn && contact ? '  ·  ' : ''}
            {contact}
          </div>
        </div>

        <div className="shrink-0 text-right">
          <div className="text-[9px] font-bold uppercase tracking-[0.18em] text-ink-500">
            Field collection
          </div>
          <div className="num font-display text-[26px] font-bold leading-none">
            {collectionRef(collection.collectionNumber)}
          </div>
          {collection.status === 'VOID' && (
            <div className="mt-1 inline-block rounded bg-ink-900 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-white">
              Void
            </div>
          )}
        </div>
      </header>

      {/* ── Who, where, when ───────────────────────────────────────────── */}
      <section className="grid grid-cols-3 gap-4 border-b border-ink-200 py-3">
        <div className="col-span-2 min-w-0">
          <Label>Collected from</Label>
          <div className="text-[15px] font-bold leading-tight">{s.name}</div>
          {where && <div className="text-[10px] leading-snug text-ink-600">{where}</div>}
          {s.phone && <div className="num text-[10px] text-ink-600">{s.phone}</div>}
        </div>
        <div>
          <Label>Collected</Label>
          <div className="text-[11px] font-semibold leading-tight">
            {format(new Date(collection.date), 'EEEE d MMMM yyyy')}
          </div>
          <div className="num text-[10px] text-ink-600">
            {format(new Date(collection.date), 'h:mmaaa')}
          </div>
          <div className="mt-1 text-[10px] text-ink-600">
            by {collection.createdBy?.name ?? '—'}
          </div>
        </div>
      </section>

      {/* ── The weights. No price column anywhere: nothing was bought. ─── */}
      {/* doc-lines: print.css sets the line-item table's cell padding off
          this class. Without it the sheet inherits the reference-table rule
          and the rows print at 0.05rem, which is a solid block of digits. */}
      {/* Eight columns is a sheet of A4, and this is mostly read on a phone,
          where it ran half off the screen. Same figures, two shapes: the
          table from 640px and on paper, stacked cards below that. */}
      <table className="doc-lines mt-3 hidden w-full border-collapse sm:table print:table">
        <thead>
          {/* Two banners, so "gross" and "tare" need not be written twice. */}
          <tr>
            <th className="w-[26%] border-b border-ink-200 pb-1 text-left align-bottom">
              <Label>Grade</Label>
            </th>
            <th
              colSpan={3}
              className="border-b-2 border-ink-900 pb-1 text-center text-[9px] font-bold uppercase tracking-[0.18em]"
            >
              Our weighbridge
            </th>
            <th
              colSpan={3}
              className="border-b border-ink-300 pb-1 text-center text-[9px] font-bold uppercase tracking-[0.18em] text-ink-500"
            >
              Supplier&rsquo;s
            </th>
            <th className="border-b border-ink-200 pb-1 text-right align-bottom">
              <Label>Diff</Label>
            </th>
          </tr>
          <tr className="text-[8.5px] font-semibold uppercase tracking-wider text-ink-500">
            <th />
            <Head>Gross</Head>
            <Head>Tare</Head>
            <Head strong>Net</Head>
            <Head>Gross</Head>
            <Head>Tare</Head>
            <Head strong>Net</Head>
            <th className="px-1.5 pb-1 pt-1 text-right">kg</th>
          </tr>
        </thead>

        <tbody className="text-[10.5px]">
          {lines.map((l, i) => {
            const theirs = num(l.supplierNetWeight);
            const diff = theirs === null ? null : round3(num(l.netWeight) - theirs);
            const zebra = i % 2 ? 'bg-ink-50' : '';
            return (
              <Fragment key={l.id}>
                <tr className={zebra}>
                  <td className="px-1.5 py-1.5 font-semibold leading-snug">
                    {l.material?.description ?? l.description}
                  </td>
                  <Cell>{formatNumber(l.grossWeight, 3)}</Cell>
                  <Cell>{formatNumber(l.tareWeight, 3)}</Cell>
                  <Cell strong>{formatNumber(l.netWeight, 3)}</Cell>
                  <Cell muted>{theirs === null ? '—' : formatNumber(l.supplierGrossWeight, 3)}</Cell>
                  <Cell muted>{theirs === null ? '—' : formatNumber(l.supplierTareWeight, 3)}</Cell>
                  <Cell muted strong>
                    {theirs === null ? '—' : formatNumber(theirs, 3)}
                  </Cell>
                  <td className="num px-1.5 py-1.5 text-right font-bold">
                    {diff === null ? (
                      <span className="text-[9px] font-medium text-ink-400">not weighed</span>
                    ) : (
                      `${diff > 0 ? '+' : ''}${formatNumber(diff, 3)}`
                    )}
                  </td>
                </tr>
                {/* A note belongs under its own grade, not in a footnote
                    block that makes the reader match numbers back up. */}
                {l.notes && (
                  <tr className={zebra}>
                    <td
                      colSpan={8}
                      className="px-1.5 pb-1.5 text-[9px] italic leading-snug text-ink-600"
                    >
                      {l.notes}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>

        <tfoot>
          <tr className="bg-ink-900 text-white">
            <td className="px-1.5 py-2 text-[9px] font-bold uppercase tracking-[0.15em]">
              Total · {lines.length} {lines.length === 1 ? 'grade' : 'grades'}
            </td>
            <Cell foot>{formatNumber(totals.gross, 3)}</Cell>
            <Cell foot>{formatNumber(totals.tare, 3)}</Cell>
            <Cell foot strong>
              {formatNumber(totals.net, 3)}
            </Cell>
            <Cell foot>{compared.length ? formatNumber(totals.theirGross, 3) : '—'}</Cell>
            <Cell foot>{compared.length ? formatNumber(totals.theirTare, 3) : '—'}</Cell>
            <Cell foot strong>
              {compared.length ? formatNumber(totals.theirNet, 3) : '—'}
            </Cell>
            <td className="num px-1.5 py-2 text-right text-[12px] font-bold">
              {difference === null
                ? '—'
                : `${difference > 0 ? '+' : ''}${formatNumber(difference, 3)}`}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* The same figures, stacked, for a screen narrower than the table. */}
      <div className="mt-3 space-y-2.5 sm:hidden print:hidden">
        {lines.map((l) => {
          const theirs = num(l.supplierNetWeight);
          const diff = theirs === null ? null : round3(num(l.netWeight) - theirs);
          return (
            <div key={l.id} className="overflow-hidden rounded-lg border border-ink-200">
              <div className="border-b border-ink-200 bg-ink-50 px-3 py-1.5 text-[12px] font-bold">
                {l.material?.description ?? l.description}
              </div>
              <div className="grid grid-cols-[2.6rem_1fr_1fr] gap-x-2 gap-y-1 px-3 py-2 text-[11px]">
                <div />
                <div className="text-right text-[8.5px] font-bold uppercase tracking-wider text-ink-500">
                  Ours
                </div>
                <div className="text-right text-[8.5px] font-bold uppercase tracking-wider text-ink-400">
                  Theirs
                </div>
                <PhoneRow label="Gross" ours={formatNumber(l.grossWeight, 3)} theirs={theirs === null ? '—' : formatNumber(l.supplierGrossWeight, 3)} />
                <PhoneRow label="Tare" ours={formatNumber(l.tareWeight, 3)} theirs={theirs === null ? '—' : formatNumber(l.supplierTareWeight, 3)} />
                <PhoneRow label="Net" strong ours={formatNumber(l.netWeight, 3)} theirs={theirs === null ? '—' : formatNumber(theirs, 3)} />
              </div>
              {l.notes && (
                <p className="border-t border-ink-100 px-3 py-1.5 text-[10px] italic leading-snug text-ink-600">
                  {l.notes}
                </p>
              )}
              <div className="flex items-baseline justify-between bg-ink-900 px-3 py-1.5 text-white">
                <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-ink-300">
                  Difference
                </span>
                <span className="num text-[13px] font-bold">
                  {diff === null ? (
                    <span className="text-[10px] font-medium text-ink-400">they did not weigh</span>
                  ) : (
                    `${diff > 0 ? '+' : ''}${formatNumber(diff, 3)} kg`
                  )}
                </span>
              </div>
            </div>
          );
        })}

        <div className="rounded-lg border-2 border-ink-900 px-3 py-2">
          <div className="flex items-baseline justify-between">
            <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-ink-500">
              Total · {lines.length} {lines.length === 1 ? 'grade' : 'grades'}
            </span>
            <span className="num text-[15px] font-bold">{formatNumber(totals.net, 3)} kg</span>
          </div>
          {compared.length > 0 && (
            <div className="mt-1 flex items-baseline justify-between border-t border-ink-200 pt-1">
              <span className="text-[8.5px] font-bold uppercase tracking-[0.15em] text-ink-500">
                Difference
              </span>
              <span className="num text-[13px] font-bold">
                {difference > 0 ? '+' : ''}
                {formatNumber(difference, 3)} kg
              </span>
            </div>
          )}
        </div>
      </div>

      {/* The one sentence that stops the totals being read wrongly. */}
      {compared.length > 0 && compared.length < lines.length && (
        <p className="mt-1.5 text-[9px] text-ink-500">
          The supplier weighed {compared.length} of {lines.length} grades, so the difference
          compares only those — not the {formatNumber(totals.net, 3)} kg total.
        </p>
      )}

      {(collection.notes || photoCount > 0) && (
        <section className="mt-4 border-t border-ink-200 pt-3 text-[10px]">
          {collection.notes && (
            <>
              <Label>Notes</Label>
              <p className="whitespace-pre-line leading-relaxed text-ink-700">{collection.notes}</p>
            </>
          )}
          {/* Listed, not printed. A thumbnail on paper proves nothing; a
              count tells the reader what exists to be looked at. */}
          {photoCount > 0 && (
            <p className={`text-[9.5px] text-ink-500 ${collection.notes ? 'mt-2' : ''}`}>
              {photoCount} {photoCount === 1 ? 'photograph was' : 'photographs were'} taken at this
              collection and are held on file.
            </p>
          )}
        </section>
      )}

      <footer className="mt-auto flex items-end justify-between gap-4 border-t border-ink-200 pt-3 text-[8.5px] text-ink-400">
        <span>
          Field collection {collectionRef(collection.collectionNumber)} · {company} · weights in kilograms
        </span>
        <span className="num">{format(new Date(), 'd MMM yyyy')}</span>
      </footer>
    </div>
  );
}

function Label({ children }) {
  return (
    <div className="text-[8.5px] font-bold uppercase tracking-[0.18em] text-ink-500">{children}</div>
  );
}

function Head({ children, strong = false }) {
  return <th className={`px-1.5 pb-1 pt-1 text-right ${strong ? 'text-ink-800' : ''}`}>{children}</th>;
}

function Cell({ children, strong = false, muted = false, foot = false }) {
  const tone = foot ? '' : muted ? 'text-ink-500' : 'text-ink-700';
  return (
    <td
      className={`num px-1.5 text-right ${foot ? 'py-2 text-[10.5px]' : 'py-1.5'} ${
        strong ? 'font-bold' : ''
      } ${strong && !foot ? 'text-ink-900' : tone}`}
    >
      {children}
    </td>
  );
}

function PhoneRow({ label, ours, theirs, strong = false }) {
  return (
    <>
      <div className="text-[10px] font-semibold text-ink-600">{label}</div>
      <div className={`num text-right ${strong ? 'font-bold text-ink-900' : 'text-ink-700'}`}>
        {ours}
      </div>
      <div className={`num text-right ${strong ? 'font-bold text-ink-500' : 'text-ink-400'}`}>
        {theirs}
      </div>
    </>
  );
}
