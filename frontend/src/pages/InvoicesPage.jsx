import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { format } from 'date-fns';
import { formatAud } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import RowActions from '../components/RowActions';
import ConfirmDialog from '../components/ConfirmDialog';
import ExportButton from '../components/ExportButton';

const PAGE_SIZE = 25;

export default function InvoicesPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const consigneeId = searchParams.get('consigneeId');
  // Carried in the URL so the dashboard can link straight to a period.
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';

  const [invoices, setInvoices] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredTotals, setFilteredTotals] = useState({ total: 0, gst: 0 });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get('/invoices', {
        params: Object.fromEntries(
          Object.entries({ search, status, consigneeId, from, to, page, pageSize: PAGE_SIZE }).filter(
            ([, v]) => v !== '' && v != null
          )
        ),
      })
      .then((res) => {
        setInvoices(res.data.invoices);
        setTotalCount(res.data.totalCount);
        setFilteredTotals(res.data.filteredTotals);
        setError('');
      })
      .catch(() => setError('Could not load invoices.'))
      .finally(() => setLoading(false));
  }, [search, status, consigneeId, from, to, page]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function runAction(fn, failMessage) {
    setBusy(true);
    try {
      await fn();
      await load();
      setDialog(null);
    } catch (err) {
      setError(err.response?.data?.error || failMessage);
      setDialog(null);
    } finally {
      setBusy(false);
    }
  }

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">Sales invoices</h1>
          <p className="mt-0.5 text-sm text-steel-500">
            Container exports and local sales — GST is set per invoice
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton
            endpoint="/invoices/export"
            params={Object.fromEntries(
              Object.entries({ search, status, consigneeId, from, to }).filter(([, v]) => v)
            )}
            options={[
              { label: 'One row per invoice', hint: 'Totals, buyer, container', params: {} },
              { label: 'One row per material line', hint: 'Tonnage and price by material', params: { detail: 'lines' } },
            ]}
          />
          <Link
            to="/export-invoices/new"
            className="rounded-lg bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
          >
            + New sales invoice
          </Link>
        </div>
      </div>

      {(from || to) && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-copper-300 bg-copper-100/50 px-3 py-2 text-sm text-steel-700">
          <span>
            Showing invoices dated{' '}
            <span className="num font-medium">{from || '…'}</span> to{' '}
            <span className="num font-medium">{to || '…'}</span>
          </span>
          <button
            onClick={() => {
              const next = new URLSearchParams(searchParams);
              next.delete('from');
              next.delete('to');
              setSearchParams(next, { replace: true });
            }}
            className="ml-auto rounded-md border border-steel-300 bg-white px-2 py-1 text-xs font-semibold text-steel-600 hover:bg-paper"
          >
            Clear dates
          </button>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search invoice no., container, PO, buyer…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="min-w-[18rem] flex-1 rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm focus:border-copper-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm focus:border-copper-500"
        >
          <option value="ACTIVE">Active only</option>
          <option value="ALL">Include voided</option>
          <option value="VOID">Voided only</option>
        </select>
      </div>

      <div className="mb-4 flex flex-wrap gap-6 rounded-xl border border-steel-200 bg-white px-5 py-3 shadow-ticket">
        <div>
          <div className="text-xs uppercase tracking-wider text-steel-400">Matching invoices</div>
          <div className="num text-lg font-semibold text-steel-900">{totalCount}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-steel-400">Total value</div>
          <div className="num text-lg font-semibold text-copper-600">
            {formatAud(filteredTotals.total)}
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wider text-steel-400">GST</div>
          <div className="num text-lg font-semibold text-steel-900">
            {formatAud(filteredTotals.gst)}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-steel-200 bg-white shadow-ticket">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-steel-100 bg-paper text-left text-xs uppercase tracking-wider text-steel-500">
              <th className="px-5 py-3 font-medium">Invoice</th>
              <th className="px-5 py-3 font-medium">Consignee</th>
              <th className="px-5 py-3 font-medium">Container</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 text-right font-medium">Total (AUD)</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-steel-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && invoices.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-steel-500">
                  No export invoices yet.
                </td>
              </tr>
            )}
            {invoices.map((inv) => {
              const isVoid = inv.status === 'VOID';
              return (
              <tr key={inv.id} className={`border-b border-steel-100 last:border-0 hover:bg-paper ${isVoid ? 'opacity-60' : ''}`}>
                <td className="px-5 py-3">
                  <Link
                    to={`/export-invoices/${inv.id}`}
                    className={`num font-medium text-steel-900 hover:text-copper-600 ${isVoid ? 'line-through' : ''}`}
                  >
                    {inv.invoiceNumber}
                  </Link>
                  {isVoid && (
                    <span className="ml-2 rounded bg-working-redDim px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-working-red">
                      Void
                    </span>
                  )}
                  {inv.applyGst && !isVoid && (
                    <span className="ml-2 rounded bg-steel-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-steel-600">
                      GST
                    </span>
                  )}
                </td>
                <td className="px-5 py-3 text-steel-700">
                  <Link to={`/buyers/${inv.consignee?.id}`} className="hover:text-copper-600">
                    {inv.consignee?.name}
                  </Link>
                </td>
                <td className="num px-5 py-3 text-steel-500">{inv.containerNo || '—'}</td>
                <td className="px-5 py-3 text-steel-500">
                  {format(new Date(inv.date), 'd MMM yyyy')}
                </td>
                <td className="num px-5 py-3 text-right font-medium text-steel-900">
                  {formatAud(inv.totalAud)}
                </td>
                <td className="px-5 py-3">
                  <RowActions
                    viewTo={`/export-invoices/${inv.id}`}
                    isVoid={isVoid}
                    isAdmin={isAdmin}
                    onEdit={() => navigate(`/export-invoices/${inv.id}/edit`)}
                    onVoid={() =>
                      setDialog({
                        kind: 'void',
                        id: inv.id,
                        title: `Void invoice ${inv.invoiceNumber}?`,
                        body: 'It stays in history for the audit trail and keeps its number, but drops out of every total and report. You can restore it later.',
                      })
                    }
                    onRestore={() =>
                      runAction(() => api.post(`/invoices/${inv.id}/restore`), 'Could not restore this invoice.')
                    }
                    onDelete={() =>
                      setDialog({
                        kind: 'delete',
                        id: inv.id,
                        title: `Permanently delete ${inv.invoiceNumber}?`,
                        body: 'This cannot be undone. Voiding is almost always the right choice — use this only for something like a test entry.',
                      })
                    }
                  />
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-steel-500">
          <span>
            Page {page} of {totalPages} — {totalCount} invoices
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="rounded-md border border-steel-200 bg-white px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-steel-200 bg-white px-3 py-1.5 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={Boolean(dialog)}
        title={dialog?.title}
        body={dialog?.body}
        busy={busy}
        requireReason={dialog?.kind === 'void'}
        reasonLabel="Why is this being voided?"
        confirmLabel={dialog?.kind === 'void' ? 'Void invoice' : 'Delete permanently'}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) =>
          dialog?.kind === 'void'
            ? runAction(() => api.post(`/invoices/${dialog.id}/void`, { reason }), 'Could not void this invoice.')
            : runAction(() => api.delete(`/invoices/${dialog.id}`), 'Could not delete this invoice.')
        }
      />
    </div>
  );
}
