import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { getSettings } from '../lib/settings';
import DocketDocument from '../components/documents/DocketDocument';

export default function DocketDetailPage() {
  const { id } = useParams();
  const [docket, setDocket] = useState(null);
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get(`/dockets/${id}`).then((res) => res.data.docket),
      getSettings(),
    ])
      .then(([d, s]) => {
        setDocket(d);
        setSettings(s);
      })
      .catch(() => setError('Could not load this docket.'));
  }, [id]);

  if (error) return <div className="px-8 py-8 text-sm text-working-red">{error}</div>;
  if (!docket) return <div className="px-8 py-8 text-sm text-steel-500">Loading…</div>;

  const isTaxInvoice = docket.type === 'TAX_INVOICE';

  return (
    <div className="mx-auto max-w-[860px] px-8 py-8 print:max-w-none print:p-0">
      <div className="print-hidden mb-4 flex items-center justify-between">
        <div>
          <Link
            to={isTaxInvoice ? '/tax-invoices' : '/purchases'}
            className="text-sm text-steel-500 hover:text-copper-600"
          >
            ← {isTaxInvoice ? 'Tax invoices' : 'Purchases'}
          </Link>
          <h1 className="font-display text-2xl font-semibold text-steel-900">
            {isTaxInvoice ? 'Tax invoice' : 'Docket'} #{docket.docketNumber}
          </h1>
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
        >
          Print / Save PDF
        </button>
      </div>

      {/* Internal audit info — deliberately not on the printed document, which
          goes to the supplier. Kept on screen because the yard still needs it. */}
      <div className="print-hidden mb-3 flex flex-wrap gap-x-6 gap-y-1 rounded-lg border border-steel-200 bg-white px-4 py-2.5 text-xs text-steel-500 shadow-ticket">
        <span>
          Sale type:{' '}
          <span className="font-medium text-steel-800">
            {docket.supplier?.saleType === 'BUSINESS' ? 'Business' : 'Private'}
          </span>
        </span>
        {docket.createdBy?.name && (
          <span>
            Processed by <span className="font-medium text-steel-800">{docket.createdBy.name}</span>
          </span>
        )}
        {docket.editedBy?.name && (
          <span>
            Amended by <span className="font-medium text-steel-800">{docket.editedBy.name}</span>
          </span>
        )}
        {docket.status === 'VOID' && (
          <span className="font-semibold text-working-red">
            Voided{docket.voidedBy?.name ? ` by ${docket.voidedBy.name}` : ''}
            {docket.voidReason ? ` — ${docket.voidReason}` : ''}
          </span>
        )}
      </div>

      <DocketDocument docket={docket} settings={settings} />
    </div>
  );
}
