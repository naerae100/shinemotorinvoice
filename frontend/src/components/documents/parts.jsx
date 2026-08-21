import { format } from 'date-fns';

/**
 * Shared building blocks for the printable documents. These are deliberately pure
 * — they take data as props and fetch nothing — so the same markup can be rendered
 * in the browser, in a test, or server-side for a PDF endpoint.
 */

export function Detail({ label, value, mono = true }) {
  return (
    <div className="border-b border-steel-200 px-3 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-steel-400">
        {label}
      </div>
      <div className={`${mono ? 'num' : ''} text-[11px] font-medium text-steel-900`}>
        {value || '—'}
      </div>
    </div>
  );
}

export function PartyBlock({ heading, name, lines }) {
  return (
    <div className="px-4 py-3">
      <div className="mb-1.5 text-[9px] font-bold uppercase tracking-widest text-copper-700">
        {heading}
      </div>
      <div className="text-[13px] font-bold leading-snug text-steel-900">{name}</div>
      <div className="mt-1 space-y-0.5 text-[11px] leading-snug text-steel-600">
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
    <header className="flex flex-col gap-4 border-b-2 border-steel-900 pb-5 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
      <div className="min-w-0 shrink-0">
        {settings?.logoUrl ? (
          <img src={settings.logoUrl} alt={companyName} className="h-16 object-contain object-left" />
        ) : (
          <div className="font-display text-[19px] font-bold leading-tight text-steel-900">
            {companyName}
          </div>
        )}
      </div>

      <div className="min-w-0 sm:text-right">
        {roleLabel && (
          <div className="mb-1 text-[9px] font-bold uppercase tracking-widest text-copper-700">
            {roleLabel}
          </div>
        )}
        {settings?.logoUrl && (
          <div className="font-display text-[13px] font-bold leading-tight text-steel-900">
            {companyName}
          </div>
        )}
        <div className="mt-0.5 space-y-0.5 text-[10.5px] leading-snug text-steel-600">
          {settings?.address && <div>{settings.address}</div>}
          <div className="num">
            {joinDot([
              settings?.abn && `ABN ${settings.abn}`,
              settings?.acn && `ACN ${settings.acn}`,
            ])}
          </div>
          <div className="num">
            {joinDot([
              settings?.phone && `T ${settings.phone}`,
              settings?.mobile && `M ${settings.mobile}`,
            ])}
          </div>
          <div>{joinDot([settings?.email, settings?.website])}</div>
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
    <div className="px-4 py-3">
      <div className="mb-2 font-display text-[17px] font-bold uppercase leading-none tracking-tight text-copper-600">
        {title}
      </div>
      <table className="w-full text-[11px]">
        <tbody>
          {references
            .filter(([, value]) => value)
            .map(([label, value, strong]) => (
              <tr key={label}>
                <td className="py-0.5 pr-4 uppercase tracking-wide text-steel-400">{label}</td>
                <td
                  className={`num py-0.5 text-right text-steel-900 ${
                    strong ? 'text-[13px] font-bold' : 'font-medium'
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

/** Amount-in-words on the left, the running totals on the right. */
export function TotalsBlock({ words, rows, total, children }) {
  return (
    <section className="avoid-break flex flex-col gap-4 border-b border-steel-300 py-4 sm:flex-row sm:items-stretch sm:justify-between sm:gap-6">
      <div className="flex-1">
        <div className="text-[9px] font-semibold uppercase tracking-wider text-steel-400">
          Amount in words
        </div>
        <div className="mt-1 text-[11.5px] font-semibold uppercase leading-snug text-steel-900">
          {words}
        </div>
        {children}
      </div>
      <div className="w-full shrink-0 sm:w-64">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex justify-between border-b border-steel-200 py-1 text-[11px]"
          >
            <span className="text-steel-500">{label}</span>
            <span className="num font-medium text-steel-900">{value}</span>
          </div>
        ))}
        <div className="mt-1 flex items-baseline justify-between bg-steel-900 px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-steel-300">
            Total AUD
          </span>
          <span className="num text-[15px] font-bold text-copper-400">{total}</span>
        </div>
      </div>
    </section>
  );
}

export function DocumentFooter({ settings, reference, date }) {
  return (
    <footer className="mt-6 flex flex-col gap-1 border-t border-steel-200 pt-2 text-[9px] text-steel-400 sm:flex-row sm:justify-between sm:gap-0">
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
