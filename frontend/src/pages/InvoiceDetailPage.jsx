import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getSettings } from '../lib/settings';
import InvoiceDocument from '../components/documents/InvoiceDocument';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const [invoice, setInvoice] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

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

  if (error) return <div className="px-8 py-8 text-sm text-working-red">{error}</div>;
  if (!invoice) return <div className="px-8 py-8 text-sm text-steel-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-[860px] px-8 py-8 print:max-w-none print:p-0">
      <div className="print-hidden mb-4 flex items-center justify-between">
        <div>
          <Link to="/export-invoices" className="text-sm text-steel-500 hover:text-copper-600">
            ← Export invoices
          </Link>
          <h1 className="font-display text-2xl font-semibold text-steel-900">
            Invoice {invoice.invoiceNumber}
          </h1>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
        >
          Print / Save PDF
        </button>
      </div>

      {/* Internal audit info — not printed; the document goes to the buyer. */}
      <div className="print-hidden mb-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-steel-200 bg-white px-4 py-2.5 text-xs text-steel-500 shadow-ticket">
        <span>
          GST:{' '}
          <span className="font-medium text-steel-800">
            {invoice.applyGst ? 'Applied (local sale)' : 'None (export)'}
          </span>
        </span>
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

      <InvoiceDocument invoice={invoice} settings={settings} />
    </div>
  );
}
