import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { getSettings } from '../lib/settings';
import { useAuth } from '../context/AuthContext';
import { formatAud, formatNumber, formatRate, amountInWords } from '../lib/format';
import ConfirmDialog from '../components/ConfirmDialog';
import DocketDocument, { PAYG_LABELS } from '../components/documents/DocketDocument';
import DocketReceipt from '../components/documents/DocketReceipt';

/**
 * Three ways of looking at one purchase.
 *
 * "Record" is the yard's own view and the default: everything held about the
 * docket, including the things deliberately kept off the printed copies — who
 * entered it, what was amended, the audit trail. The other two are the documents
 * that leave the building, and they show only what the supplier should see.
 */
const VIEWS = [
  ['record', 'Record'],
  ['receipt', 'Receipt'],
  ['document', 'A4 docket'],
];

const TAX_MODE_LABELS = {
  INCLUSIVE: 'Price includes GST',
  EXCLUSIVE: 'GST added to price',
  NO_TAX: 'No GST',
};

const AUDIT_LABELS = {
  CREATE: 'Created',
  UPDATE: 'Amended',
  VOID: 'Voided',
  RESTORE: 'Restored',
  ISSUE: 'Issued',
};

function Chip({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'border-steel-200 bg-white text-steel-600',
    green: 'border-working-green/25 bg-working-green/10 text-working-green',
    red: 'border-working-red/25 bg-working-red/10 text-working-red',
    amber: 'border-working-amber/30 bg-working-amberDim text-working-amber',
  };
  return (
    <span
      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function Card({ title, children, className = '' }) {
  return (
    <section className={`rounded-xl border border-steel-200 bg-white shadow-ticket ${className}`}>
      <div className="border-b border-steel-200 px-4 py-2.5">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.12em] text-steel-500">
          {title}
        </h2>
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function Field({ label, children, mono = false }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-[0.1em] text-steel-400">{label}</dt>
      <dd className={`mt-0.5 text-[13px] text-steel-900 ${mono ? 'num' : ''}`}>
        {children || <span className="text-steel-300">—</span>}
      </dd>
    </div>
  );
}

/** The changed fields of an audit event, as "field: before → after". */
function AuditChange({ event }) {
  const keys = [...new Set([...Object.keys(event.before || {}), ...Object.keys(event.after || {})])];
  if (!keys.length) return null;
  const show = (v) =>
    v === null || v === undefined || v === '' ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  return (
    <ul className="mt-1 space-y-0.5">
      {keys.map((k) => (
        <li key={k} className="num text-[11px] text-steel-500">
          <span className="text-steel-400">{k}:</span> {show(event.before?.[k])}{' '}
          <span className="text-steel-300">→</span>{' '}
          <span className="text-steel-700">{show(event.after?.[k])}</span>
        </li>
      ))}
    </ul>
  );
}

export default function DocketDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = useAuth();

  const [docket, setDocket] = useState(null);
  const [settings, setSettings] = useState(null);
  const [events, setEvents] = useState(null);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState(null);
  const [view, setView] = useState('record');

  const load = useCallback(
    () => api.get(`/dockets/${id}`).then((res) => setDocket(res.data.docket)),
    [id]
  );

  useEffect(() => {
    Promise.all([load(), getSettings().then(setSettings)]).catch(() =>
      setError('Could not load this docket.')
    );
  }, [id, load]);

  // Admin-only: the trail records IP addresses, so the endpoint refuses anyone
  // else and there is no point asking for it.
  useEffect(() => {
    if (!isAdmin) return;
    api
      .get(`/audit?entity=Docket&entityId=${id}&pageSize=50`)
      .then((res) => setEvents(res.data.events))
      .catch(() => setEvents([]));
  }, [id, isAdmin]);

  const runAction = async (fn, message) => {
    setBusy(true);
    setActionError('');
    try {
      await fn();
      await load();
      if (isAdmin) {
        const res = await api.get(`/audit?entity=Docket&entityId=${id}&pageSize=50`);
        setEvents(res.data.events);
      }
      setDialog(null);
    } catch (err) {
      setActionError(err?.response?.data?.error || message);
    } finally {
      setBusy(false);
    }
  };

  if (error) {
    return <div className="px-4 py-6 text-sm text-working-red sm:px-6 lg:px-8 lg:py-8">{error}</div>;
  }
  if (!docket) {
    return <div className="px-4 py-6 text-sm text-steel-500 sm:px-6 lg:px-8 lg:py-8">Loading…</div>;
  }

  const isTaxInvoice = docket.type === 'TAX_INVOICE';
  const isVoid = docket.status === 'VOID';
  const isIssued = Boolean(docket.issuedAt);
  const taxMode = docket.taxMode ?? (isTaxInvoice ? 'EXCLUSIVE' : 'NO_TAX');
  const basePath = isTaxInvoice ? '/tax-invoices' : '/purchases';
  const totalWeight = docket.lineItems.reduce((sum, li) => sum + Number(li.netWeight), 0);
  const s = docket.supplier;

  const btn =
    'rounded-md border border-steel-200 bg-white px-3 py-2 text-xs font-semibold text-steel-700 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-40';

  return (
    <div className="mx-auto max-w-[980px] px-3 py-5 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
      <div className="print-hidden">
        <Link to={basePath} className="text-sm text-steel-500 hover:text-copper-600">
          ← {isTaxInvoice ? 'Tax invoices' : 'Purchases'}
        </Link>

        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="font-display text-2xl font-semibold text-steel-900">
                {isTaxInvoice ? 'Tax invoice' : 'Docket'} #{docket.docketNumber}
              </h1>
              {isVoid ? <Chip tone="red">Void</Chip> : <Chip tone="green">Active</Chip>}
              {isIssued ? (
                <Chip tone="neutral">
                  Issued {format(new Date(docket.issuedAt), 'd MMM yyyy')}
                </Chip>
              ) : (
                <Chip tone="amber">Draft — not issued</Chip>
              )}
              {docket.xeroInvoiceId && <Chip tone="green">✓ Xero</Chip>}
            </div>
            <div className="mt-1 text-sm text-steel-500">
              {s?.name} · {format(new Date(docket.date), 'd MMM yyyy')} ·{' '}
              <span className="num font-semibold text-steel-800">{formatAud(docket.total)}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              className={btn}
              disabled={isVoid || isIssued}
              title={
                isIssued
                  ? 'An issued docket is a record of a completed purchase and cannot be edited.'
                  : isVoid
                    ? 'A voided docket cannot be edited.'
                    : undefined
              }
              onClick={() => navigate(`${basePath}/${docket.id}/edit`)}
            >
              Edit
            </button>
            {!isIssued && !isVoid && (
              <button
                className={btn}
                disabled={busy}
                onClick={() =>
                  setDialog({
                    kind: 'issue',
                    title: `Issue docket #${docket.docketNumber}?`,
                    body: 'This marks it as handed to the supplier. The figures are frozen from that point and the docket can no longer be edited — a correction has to be a new docket. This cannot be undone.',
                    confirmLabel: 'Issue docket',
                  })
                }
              >
                Issue
              </button>
            )}
            {isVoid ? (
              <button
                className={btn}
                disabled={busy}
                onClick={() =>
                  runAction(
                    () => api.post(`/dockets/${docket.id}/restore`),
                    'Could not restore this docket.'
                  )
                }
              >
                Restore
              </button>
            ) : (
              <button
                className={btn}
                disabled={busy}
                onClick={() =>
                  setDialog({
                    kind: 'void',
                    title: `Void #${docket.docketNumber}?`,
                    body: 'It stays in history for the audit trail and keeps its number, but drops out of every total and report. You can restore it later.',
                    confirmLabel: 'Void record',
                    requireReason: true,
                  })
                }
              >
                Void
              </button>
            )}
            <button
              onClick={() => window.print()}
              className="rounded-md bg-copper-500 px-4 py-2 text-xs font-semibold text-steel-950 hover:bg-copper-400"
            >
              Print {view === 'receipt' ? 'receipt' : 'docket'}
            </button>
          </div>
        </div>

        {actionError && (
          <div className="mt-3 rounded-lg border border-working-red/25 bg-working-redDim px-4 py-2.5 text-sm text-working-red">
            {actionError}
          </div>
        )}

        <div
          role="tablist"
          aria-label="View"
          className="mt-4 flex w-fit rounded-md border border-steel-200 bg-white p-0.5"
        >
          {VIEWS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                view === key ? 'bg-steel-900 text-paper' : 'text-steel-500 hover:text-steel-800'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === 'receipt' && (
          <p className="mt-2 text-xs text-steel-500">
            Sized for an 80mm thermal roll. Print with margins set to none and scale 100%.
          </p>
        )}
      </div>

      {/* The record is a screen view of the yard's own data and never prints —
          it carries the audit trail and the IP addresses in it. Printing from
          here gives the A4 docket instead, which is the document this record
          describes; it is mounted print-only so the button never produces a
          blank page and the screen is left as it was. */}
      {view === 'record' && (
        <div className="hidden print:block">
          <DocketDocument docket={docket} settings={settings} />
        </div>
      )}

      {view === 'record' && (
        <div className="mt-4 space-y-4 print:hidden">
          {isVoid && (
            <div className="rounded-xl border border-working-red/25 bg-working-redDim px-4 py-3 text-sm text-working-red">
              <span className="font-semibold">
                Voided
                {docket.voidedBy?.name ? ` by ${docket.voidedBy.name}` : ''}
                {docket.voidedAt ? ` on ${format(new Date(docket.voidedAt), 'd MMM yyyy')}` : ''}
              </span>
              {docket.voidReason && <span> — {docket.voidReason}</span>}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
            <Card title="Supplier">
              <div className="text-[15px] font-semibold text-steel-900">
                {s?.id ? (
                  <Link to={`/clients/${s.id}`} className="hover:text-copper-600">
                    {s.name}
                  </Link>
                ) : (
                  s?.name
                )}
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Sale type">
                  {s?.saleType === 'BUSINESS' ? 'Business' : 'Private'}
                </Field>
                <Field label="ABN" mono>
                  {s?.abn}
                </Field>
                <Field label="Phone" mono>
                  {s?.phone}
                </Field>
                <Field label="Licence" mono>
                  {s?.licenceNo}
                </Field>
                <div className="col-span-2">
                  <Field label="Address">
                    {[s?.address, [s?.suburb, s?.postcode].filter(Boolean).join(' ')]
                      .filter(Boolean)
                      .join(', ')}
                  </Field>
                </div>
              </dl>
            </Card>

            <Card title="Purchase">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Date" mono>
                  {format(new Date(docket.date), 'd MMM yyyy')}
                </Field>
                <Field label="Time" mono>
                  {format(new Date(docket.createdAt || docket.date), 'HH:mm')}
                </Field>
                <Field label="Document type">
                  {isTaxInvoice ? 'Tax invoice' : 'Purchase docket'}
                </Field>
                <Field label="GST treatment">{TAX_MODE_LABELS[taxMode]}</Field>
                <div className="col-span-2">
                  <Field label="Statement by supplier">
                    {docket.paygStatement ? PAYG_LABELS[docket.paygStatement] : null}
                  </Field>
                </div>
                <Field label="Entered by">{docket.createdBy?.name}</Field>
                <Field label="Amended by">{docket.editedBy?.name}</Field>
              </dl>
            </Card>
          </div>

          {(docket.vehicleModel || docket.vehicleReg || docket.vehicleVin) && (
            <Card title="Vehicle">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                <Field label="Model">{docket.vehicleModel}</Field>
                <Field label="Registration" mono>
                  {docket.vehicleReg}
                </Field>
                <Field label="VIN" mono>
                  {docket.vehicleVin}
                </Field>
              </dl>
            </Card>
          )}

          <Card title={`Materials — ${docket.lineItems.length} ${docket.lineItems.length === 1 ? 'line' : 'lines'}`}>
            <div className="-mx-4 overflow-x-auto">
              <table className="w-full min-w-[520px] text-[13px]">
                <thead>
                  <tr className="border-b border-steel-200 text-left">
                    <th className="w-8 px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-steel-400">
                      #
                    </th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-steel-400">
                      Material
                    </th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-steel-400">
                      Net weight
                    </th>
                    <th className="px-2 py-2 text-[10px] font-bold uppercase tracking-wider text-steel-400">
                      Unit
                    </th>
                    <th className="px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-steel-400">
                      Rate
                    </th>
                    <th className="px-4 py-2 text-right text-[10px] font-bold uppercase tracking-wider text-steel-400">
                      Value
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {docket.lineItems.map((li, i) => (
                    <tr key={li.id} className="border-b border-steel-100">
                      <td className="num px-4 py-2.5 align-top text-steel-300">{i + 1}</td>
                      <td className="px-2 py-2.5 align-top font-semibold text-steel-900">
                        {li.description || li.material?.description}
                        {li.description && li.material?.description && (
                          <div className="text-[11px] font-medium text-steel-500">
                            {li.material.description}
                          </div>
                        )}
                      </td>
                      <td className="num px-2 py-2.5 text-right align-top text-steel-700">
                        {formatNumber(li.netWeight, 3)}
                      </td>
                      <td className="px-2 py-2.5 align-top text-[11px] uppercase text-steel-500">
                        {(li.material?.unit || 'kg').toLowerCase()}
                      </td>
                      <td className="num px-2 py-2.5 text-right align-top text-steel-700">
                        {formatRate(li.price)}
                      </td>
                      <td className="num px-4 py-2.5 text-right align-top font-semibold text-steel-900">
                        {formatNumber(li.value, 2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="font-semibold">
                    <td />
                    <td className="px-2 py-2.5 text-[11px] uppercase tracking-wider text-steel-500">
                      Total
                    </td>
                    <td className="num px-2 py-2.5 text-right text-steel-900">
                      {formatNumber(totalWeight, 3)}
                    </td>
                    <td colSpan={2} />
                    <td className="num px-4 py-2.5 text-right text-steel-900">
                      {formatNumber(docket.subtotal, 2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="mt-3 flex flex-col gap-4 border-t border-steel-200 pt-3 sm:flex-row sm:justify-between">
              <div className="flex-1 text-[12px] text-steel-500">
                <span className="font-semibold text-steel-700">In words: </span>
                {amountInWords(docket.total)}
              </div>
              <dl className="w-full shrink-0 space-y-1 text-[13px] sm:w-64">
                <div className="flex justify-between">
                  <dt className="text-steel-500">Subtotal</dt>
                  <dd className="num text-steel-900">{formatAud(docket.subtotal)}</dd>
                </div>
                {Number(docket.discountAmount) > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-steel-500">
                      {docket.discountType === 'PERCENT'
                        ? `Discount (${Number(docket.discountValue)}%)`
                        : 'Discount'}
                    </dt>
                    <dd className="num text-steel-900">− {formatAud(docket.discountAmount)}</dd>
                  </div>
                )}
                {taxMode !== 'NO_TAX' && (
                  <div className="flex justify-between">
                    <dt className="text-steel-500">
                      {taxMode === 'INCLUSIVE' ? 'Includes GST' : 'GST (10%)'}
                    </dt>
                    <dd className="num text-steel-900">{formatAud(docket.gst)}</dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-steel-200 pt-1.5 text-[15px] font-bold">
                  <dt className="text-steel-900">Total</dt>
                  <dd className="num text-steel-900">{formatAud(docket.total)}</dd>
                </div>
              </dl>
            </div>
          </Card>

          {docket.notes && (
            <Card title="Notes">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-steel-700">
                {docket.notes}
              </p>
            </Card>
          )}

          {isAdmin && (
            <Card title="Audit trail">
              {events === null ? (
                <div className="text-[13px] text-steel-400">Loading…</div>
              ) : events.length === 0 ? (
                <div className="text-[13px] text-steel-400">
                  Nothing recorded against this docket.
                </div>
              ) : (
                <ol className="space-y-3">
                  {events.map((e) => (
                    <li key={e.id} className="flex gap-3">
                      <div className="num w-32 shrink-0 text-[11px] text-steel-400">
                        {format(new Date(e.at), 'd MMM yyyy HH:mm')}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] text-steel-900">
                          <span className="font-semibold">
                            {AUDIT_LABELS[e.action] || e.action}
                          </span>
                          {e.actorEmail && (
                            <span className="text-steel-500"> by {e.actorEmail}</span>
                          )}
                          {e.ip && <span className="num text-steel-300"> · {e.ip}</span>}
                        </div>
                        <AuditChange event={e} />
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </Card>
          )}
        </div>
      )}

      {view === 'receipt' && (
        <div className="mt-4 flex justify-center print:mt-0 print:block">
          <div className="shadow-ticket print:shadow-none">
            <DocketReceipt docket={docket} settings={settings} />
          </div>
        </div>
      )}

      {view === 'document' && (
        <div className="mt-4 print:mt-0">
          <DocketDocument docket={docket} settings={settings} />
        </div>
      )}

      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialog?.title}
        body={dialog?.body}
        busy={busy}
        requireReason={Boolean(dialog?.requireReason)}
        reasonLabel="Why is this being voided?"
        confirmLabel={dialog?.confirmLabel}
        tone={dialog?.kind === 'issue' ? 'primary' : 'danger'}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) =>
          dialog?.kind === 'void'
            ? runAction(
                () => api.post(`/dockets/${docket.id}/void`, { reason }),
                'Could not void this record.'
              )
            : runAction(
                () => api.post(`/dockets/${docket.id}/issue`),
                'Could not issue this docket.'
              )
        }
      />
    </div>
  );
}
