import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatAud } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import DateRangePicker, { PRESETS } from '../components/DateRangePicker';
import RowActions from '../components/RowActions';
import ConfirmDialog from '../components/ConfirmDialog';

const PAGE_SIZE = 25;

export default function DocketHistoryPage({ typeFilter }) {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const supplierId = searchParams.get('supplierId');

  const [dockets, setDockets] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredTotals, setFilteredTotals] = useState({ total: 0, gst: 0 });
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const [filters, setFilters] = useState({
    search: '',
    from: '',
    to: '',
    materialId: '',
    status: 'ACTIVE',
  });

  const isTaxInvoice = typeFilter === 'TAX_INVOICE';
  const basePath = isTaxInvoice ? '/tax-invoices' : '/purchases';

  useEffect(() => {
    api.get('/materials').then((r) => setMaterials(r.data.materials)).catch(() => {});
  }, []);

  useEffect(() => setPage(1), [typeFilter, supplierId, filters]);

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get('/dockets', {
        params: {
          type: typeFilter,
          supplierId,
          page,
          pageSize: PAGE_SIZE,
          ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
        },
      })
      .then((res) => {
        setDockets(res.data.dockets);
        setTotalCount(res.data.totalCount);
        setFilteredTotals(res.data.filteredTotals);
        setError('');
      })
      .catch(() => setError('Could not load records.'))
      .finally(() => setLoading(false));
  }, [typeFilter, supplierId, page, filters]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const setFilter = (patch) => setFilters((f) => ({ ...f, ...patch }));

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

  const field =
    'rounded-md border border-steel-200 bg-white px-3 py-2 text-sm focus:border-copper-500';

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">
            {isTaxInvoice ? 'Tax invoices' : 'Purchases'}
          </h1>
          <p className="mt-0.5 text-sm text-steel-500">
            {isTaxInvoice
              ? 'Purchases from ABN-registered businesses, with GST'
              : 'Scrap bought in, from the yard'}
          </p>
        </div>
        <Link
          to={`${basePath}/new`}
          className="rounded-md bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
        >
          {isTaxInvoice ? '+ New tax invoice' : '+ New purchase'}
        </Link>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-steel-200 bg-white p-3 shadow-ticket">
        <DateRangePicker
          from={filters.from || PRESETS.thisMonth().from}
          to={filters.to || PRESETS.thisMonth().to}
          granularity="day"
          showGranularity={false}
          onChange={({ from, to }) => setFilter({ from, to })}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            placeholder="Search supplier, docket no., phone, notes…"
            value={filters.search}
            onChange={(e) => setFilter({ search: e.target.value })}
            className={`${field} min-w-[16rem] flex-1`}
          />
          <select
            value={filters.materialId}
            onChange={(e) => setFilter({ materialId: e.target.value })}
            className={field}
          >
            <option value="">All materials</option>
            {materials.map((m) => (
              <option key={m.id} value={m.id}>
                {m.description}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilter({ status: e.target.value })}
            className={field}
          >
            <option value="ACTIVE">Active only</option>
            <option value="ALL">Include voided</option>
            <option value="VOID">Voided only</option>
          </select>
          {(filters.search || filters.materialId || filters.from || supplierId) && (
            <button
              onClick={() => {
                setFilters({ search: '', from: '', to: '', materialId: '', status: 'ACTIVE' });
                setSearchParams({});
              }}
              className="rounded-md border border-steel-200 px-3 py-2 text-sm text-steel-600 hover:bg-paper"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-6 rounded-xl border border-steel-200 bg-white px-5 py-3 shadow-ticket">
        <div>
          <div className="text-xs uppercase tracking-wider text-steel-400">Matching records</div>
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
              <th className="px-5 py-3 font-medium">Docket</th>
              <th className="px-5 py-3 font-medium">Supplier</th>
              <th className="px-5 py-3 font-medium">Date</th>
              <th className="px-5 py-3 font-medium">Materials</th>
              <th className="px-5 py-3 text-right font-medium">Total</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && dockets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-steel-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && dockets.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-10 text-center text-steel-500">
                  No records match these filters.
                </td>
              </tr>
            )}
            {dockets.map((d) => {
              const isVoid = d.status === 'VOID';
              return (
                <tr
                  key={d.id}
                  className={`border-b border-steel-100 last:border-0 hover:bg-paper ${
                    isVoid ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-5 py-3">
                    <Link
                      to={`${basePath}/${d.id}`}
                      className={`num font-medium text-steel-900 hover:text-copper-600 ${
                        isVoid ? 'line-through' : ''
                      }`}
                    >
                      #{d.docketNumber}
                    </Link>
                    {isVoid && (
                      <span className="ml-2 rounded bg-working-redDim px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-working-red">
                        Void
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-steel-700">
                    <Link
                      to={`/clients/${d.supplier?.id}`}
                      className="hover:text-copper-600"
                    >
                      {d.supplier?.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-steel-500">
                    {format(new Date(d.date), 'd MMM yyyy')}
                  </td>
                  <td className="px-5 py-3 text-steel-500">
                    {d.lineItems?.length} {d.lineItems?.length === 1 ? 'line' : 'lines'}
                  </td>
                  <td className="num px-5 py-3 text-right font-medium text-steel-900">
                    {formatAud(d.total)}
                  </td>
                  <td className="px-5 py-3">
                    <RowActions
                      viewTo={`${basePath}/${d.id}`}
                      isVoid={isVoid}
                      isAdmin={isAdmin}
                      onEdit={() => navigate(`${basePath}/${d.id}/edit`)}
                      onVoid={() =>
                        setDialog({
                          kind: 'void',
                          id: d.id,
                          title: `Void docket #${d.docketNumber}?`,
                          body: 'It stays in history for the audit trail and keeps its number, but drops out of every total and report. You can restore it later.',
                        })
                      }
                      onRestore={() =>
                        runAction(
                          () => api.post(`/dockets/${d.id}/restore`),
                          'Could not restore this docket.'
                        )
                      }
                      onDelete={() =>
                        setDialog({
                          kind: 'delete',
                          id: d.id,
                          title: `Permanently delete docket #${d.docketNumber}?`,
                          body: 'This cannot be undone and leaves a gap in the docket numbering. Voiding is almost always the right choice — use this only for something like a test entry.',
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
            Page {page} of {totalPages} — {totalCount} records
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
        confirmLabel={dialog?.kind === 'void' ? 'Void docket' : 'Delete permanently'}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) =>
          dialog?.kind === 'void'
            ? runAction(
                () => api.post(`/dockets/${dialog.id}/void`, { reason }),
                'Could not void this docket.'
              )
            : runAction(() => api.delete(`/dockets/${dialog.id}`), 'Could not delete this docket.')
        }
      />
    </div>
  );
}
