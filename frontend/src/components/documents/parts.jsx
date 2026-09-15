import { format } from 'date-fns';

/**
 * Shared building blocks for the printable documents. These are deliberately pure
 * — they take data as props and fetch nothing — so the same markup can be rendered
 * in the browser, in a test, or server-side for a PDF endpoint.
 */

export function Detail({ label, value, mono = true }) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <div className="text-[9px] font-bold uppercase tracking-[0.15em] text-ink-500">
        {label}
      </div>
      <div className={`${mono ? 'num' : ''} text-[12px] font-medium text-ink-900`}>
        {value || '—'}
      </div>
    </div>
  );
}

export function PartyBlock({ heading, name, lines }) {
  return (
    <div className="py-2">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-ink-500">
        {heading}
      </div>
      <div className="text-[14px] font-bold leading-snug text-ink-900">{name}</div>
      <div className="mt-1 space-y-0.5 text-[12px] leading-snug text-ink-700">
        {lines.filter(Boolean).map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}

const joinDot = (parts) => parts.filter(Boolean).join('  ·  ');

/**
 * Letterhead: logo on the left, company particulars on the right.
 *
 * The document type and its reference numbers deliberately do NOT live here —
 * they sit in the right-hand cell of the parties row below, opposite the other
 * party, which is where someone reading the page looks for them.
 */
export function Masthead({ settings, roleLabel }) {
  const companyName = settings?.companyName || 'Shine Motor Corporation Pty Ltd';
  return (
    <header className="flex flex-col gap-4 border-b-2 border-ink-900 pb-6 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 shrink-0">
        {settings?.logoUrl ? (
          <img src={settings.logoUrl} alt={companyName} className="h-24 object-contain object-left" />
        ) : (
          <div className="font-display text-[22px] font-bold leading-tight text-ink-900">
            {companyName}
          </div>
        )}
      </div>

      <div className="min-w-0 sm:text-right">
        {roleLabel && (
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-ink-500">
            {roleLabel}
          </div>
        )}
        {settings?.logoUrl && (
          <div className="font-display text-[15px] font-bold leading-tight text-ink-900">
            {companyName}
          </div>
        )}
        <div className="mt-1 space-y-0.5 text-[12px] leading-snug text-ink-700">
          {settings?.address && <div>{settings.address}</div>}
          <div className="num text-ink-500">
            {joinDot([
              settings?.abn && `ABN ${settings.abn}`,
              settings?.acn && `ACN ${settings.acn}`,
            ])}
          </div>
          <div className="num text-ink-500">
            {joinDot([settings?.phone, settings?.mobile].filter(Boolean))}
          </div>
          <div className="text-ink-500">{joinDot([settings?.email, settings?.website])}</div>
        </div>
      </div>
    </header>
  );
}

/**
 * The document's identity — its type and reference numbers — sized to sit in the
 * parties row opposite the supplier or consignee.
 */
export function ReferenceBlock({ title, references }) {
  return (
    <div className="py-2">
      <div className="mb-4 font-display text-[26px] font-bold uppercase leading-none tracking-tight text-ink-900">
        {title}
      </div>
      <table className="w-full text-[12px]">
        <tbody>
          {references
            .filter(([, value]) => value)
            .map(([label, value, strong]) => (
              <tr key={label}>
                <td className="py-1.5 pr-4 text-[10px] font-bold uppercase tracking-[0.15em] text-ink-500">{label}</td>
                <td
                  className={`num py-1.5 text-right text-ink-900 ${
                    strong ? 'text-[16px] font-bold' : 'font-medium'
                  }`}
                >
                  {value}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Amount-in-words on the left, the running totals on the right.
 *
 * `currency` labels the plate. It is a required-in-practice prop rather than a
 * constant because the plate used to read "Total AUD" on every document: a USD
 * invoice printed "Total AUD" directly above "USD 39,495.30", which states two
 * different currencies for one figure on the largest element of the page.
 */
export function TotalsBlock({ words, rows, total, currency = 'AUD', children }) {
  return (
    <section className="avoid-break mt-8 flex flex-col gap-6 sm:flex-row sm:items-stretch sm:justify-between sm:gap-12">
      <div className="flex-1 py-2">
        <div className="text-[10px] font-bold uppercase tracking-[0.15em] text-ink-500">
          Amount in words
        </div>
        <div className="mt-2 text-[13px] font-bold uppercase leading-relaxed text-ink-900">
          {words}
        </div>
        <div className="mt-6 text-[12px]">{children}</div>
      </div>
      <div className="w-full shrink-0 sm:w-[320px]">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between border-b border-ink-200 py-2.5 text-[12px]"
          >
            <span className="font-medium text-ink-600">{label}</span>
            <span className="num font-bold text-ink-900">{value}</span>
          </div>
        ))}
        <div className="mt-4 flex items-baseline justify-between border-b-4 border-t-2 border-ink-900 py-3">
          <span className="text-[12px] font-bold uppercase tracking-[0.15em] text-ink-900">
            Total {currency}
          </span>
          <span className="num text-[24px] font-bold tracking-tight text-ink-900">{total}</span>
        </div>
      </div>
    </section>
  );
}

/**
 * The company's execution of the document: room to sign, the stamp, and who is
 * signing. Shared, because a packing list and its invoice are handed over as a
 * pair and any difference between the two blocks reads as one of them being a
 * different document.
 *
 * The stamp is sized and placed to sit across the signature rule the way a
 * rubber stamp actually lands on paper — overlapping the line, not parked in the
 * margin beside it — and multiplied into the page so the rule shows through it
 * instead of being covered by an opaque white square.
 */
export function SignatureBlock({ settings, className = '' }) {
  return (
    <div className={`relative flex flex-col items-end ${className}`}>
      {(() => {
        const url = settings?.stampUrl || '/branding/stamp.png';
        return (
          <img
            src={url}
            alt="Company Stamp"
            aria-hidden="true"
            className="pointer-events-none h-32 max-w-[280px] object-contain mix-blend-multiply"
          />
        );
      })()}
    </div>
  );
}

export function DocumentFooter({ settings, reference, date }) {
  return (
    <footer className="mt-6 flex flex-col gap-1 border-t border-ink-200 pt-2 text-[9px] text-ink-400 sm:flex-row sm:justify-between sm:gap-0">
      <span>
        {settings?.companyName || 'Shine Motor Corporation Pty Ltd'}
        {settings?.abn ? ` · ABN ${settings.abn}` : ''}
      </span>
      <span className="num">
        {reference} · {format(new Date(date), 'dd/MM/yyyy')}
      </span>
    </footer>
  );
}

/** "Discount (5%)" or "Discount" — the reader should see how it was worked out. */
export function discountLabel(doc) {
  if (doc.discountType === 'PERCENT') {
    const pct = Number(doc.discountValue);
    return `Discount (${pct % 1 === 0 ? pct : pct.toFixed(2)}%)`;
  }
  return 'Discount';
}

/**
 * A voided document must never be mistaken for a live one if it's printed or
 * left on a desk, so the cancellation is stamped across the page itself.
 */
export function VoidStamp({ reason }) {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
      aria-hidden="true"
    >
      <div className="-rotate-[18deg] border-[6px] border-working-red/40 px-10 py-4 text-center">
        <div className="font-display text-6xl font-bold uppercase tracking-widest text-working-red/40">
          Void
        </div>
        {reason && (
          <div className="mt-1 max-w-md text-sm font-semibold uppercase tracking-wide text-working-red/40">
            {reason}
          </div>
        )}
      </div>
    </div>
  );
}
