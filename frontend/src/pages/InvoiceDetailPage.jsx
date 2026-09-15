import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getSettings } from '../lib/settings';
import InvoiceDocument from '../components/documents/InvoiceDocument';
import PackingListDocument from '../components/documents/PackingListDocument';
import ExportButton from '../components/ExportButton';

/**
 * A shipment is described by two documents drawn from the same record. They are
 * prepared in this order — the goods are weighed onto the packing list first,
 * and its net weight is what the invoice prices — and they travel to the buyer
 * together, which is what "Both" prints.
 */
const VIEWS = [
  ['packing', 'Packing list'],
  ['invoice', 'Invoice'],
  ['both', 'Both'],
];

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [invoice, setInvoice] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [view, setView] = useState('invoice');

  // A packing slip has no prices yet, so the invoice and "both" views would
  // render a document of zeroes. Until it is priced there is one thing to look
  // at, and the switch is not shown at all.
  const isSlip = invoice?.stage === 'PACKING_SLIP';

  useEffect(() => {
    Promise.all([
      api.get(`/invoices/${id}`).then((res) => res.data.invoice),
      getSettings(),
    ])
      .then(([inv, s]) => {
        setInvoice(inv);
        setSettings(s);
      })
      .catch(() => setError('Could not load this invoice.'));
  }, [id]);

  useEffect(() => {
    if (invoice?.stage === 'PACKING_SLIP') setView('packing');
  }, [invoice?.stage]);

  if (error) return <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 text-sm text-working-red">{error}</div>;
  if (!invoice) return <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 text-sm text-steel-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-[860px] px-3 py-5 sm:px-6 lg:px-8 lg:py-8 print:max-w-none print:p-0">
      <div className="print-hidden mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            to={isSlip ? '/packing-slips' : '/export-invoices'}
            className="text-sm text-steel-500 hover:text-copper-600"
          >
            ← {isSlip ? 'Packing slips' : 'Export invoices'}
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="font-display text-2xl font-semibold text-steel-900">
              {isSlip ? 'Packing slip' : 'Invoice'} {invoice.invoiceNumber}
            </h1>
            {invoice.xeroInvoiceId && (
              <div className="rounded border border-working-green/20 bg-working-green/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-working-green">
                ✓ Synced to Xero
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {isSlip ? (
            <button
              onClick={() => navigate(`/export-invoices/${invoice.id}/edit`)}
              className="rounded-md border border-steel-300 bg-white px-4 py-2.5 text-sm font-semibold text-steel-800 hover:bg-paper"
            >
              Create sales invoice →
            </button>
          ) : (
            // A priced shipment still has a packing list, and its weights are
            // still the shipment's weights, so it has to stay editable. Editing
            // here changes both documents at once — they are one record.
            <button
              onClick={() => navigate(`/export-invoices/${invoice.id}/edit`)}
              disabled={invoice.status === 'VOID' || Boolean(invoice.issuedAt)}
              title={
                invoice.issuedAt
                  ? 'This invoice has been issued to the buyer and can no longer be edited. Void it and raise a replacement.'
                  : invoice.status === 'VOID'
                    ? 'A voided invoice cannot be edited. Restore it first.'
                    : 'Edit the shipment — the invoice and its packing list update together.'
              }
              className="rounded-md border border-steel-300 bg-white px-4 py-2.5 text-sm font-semibold text-steel-800 hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50"
            >
              Edit
            </button>
          )}
          <div
            role="tablist"
            aria-label="Document"
            className={`rounded-md border border-steel-200 bg-white p-0.5 ${isSlip ? 'hidden' : 'flex'}`}
          >
            {VIEWS.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={`rounded px-3 py-1.5 text-xs font-semibold transition ${
                  view === key
                    ? 'bg-steel-900 text-paper'
                    : 'text-steel-500 hover:text-steel-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <ExportButton endpoint={`/invoices/${invoice.id}/export`} label="Export CSV" />
          <button
            onClick={() => window.print()}
            className="rounded-md bg-copper-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-copper-400"
          >
            Print / Save PDF
          </button>
        </div>
      </div>

      {/* Internal audit info — not printed; the document goes to the buyer. */}
      <div className="print-hidden mb-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-steel-200 bg-white px-4 py-2.5 text-xs text-steel-500 shadow-ticket">
        {isSlip ? (
          <span className="font-semibold text-working-amber">
            Not yet priced — weights only
          </span>
        ) : (
          <span>
            GST:{' '}
            <span className="font-medium text-steel-800">
              {invoice.applyGst ? 'Applied (local sale)' : 'None (export)'}
            </span>
          </span>
        )}
        {invoice.createdBy?.name && (
          <span>
            Raised by <span className="font-medium text-steel-800">{invoice.createdBy.name}</span>
          </span>
        )}
        {invoice.editedBy?.name && (
          <span>
            Amended by <span className="font-medium text-steel-800">{invoice.editedBy.name}</span>
          </span>
        )}
        {invoice.status === 'VOID' && (
          <span className="font-semibold text-working-red">
            Voided{invoice.voidedBy?.name ? ` by ${invoice.voidedBy.name}` : ''}
            {invoice.voidReason ? ` — ${invoice.voidReason}` : ''}
          </span>
        )}
      </div>

      {view !== 'invoice' && <PackingListDocument invoice={invoice} settings={settings} />}

      {view !== 'packing' && (
        // In "Both" the two sheets are stacked, and the invoice is forced onto a
        // new sheet of paper: they are separate documents, and letting the second
        // flow up into whatever room is left at the foot of the first would put
        // half an invoice on the packing list's page.
        <div className={view === 'both' ? 'mt-8 print:mt-0 print:break-before-page' : ''}>
          <InvoiceDocument invoice={invoice} settings={settings} />
        </div>
      )}
    </div>
  );
}
