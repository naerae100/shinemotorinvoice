import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatAud } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import DateRangePicker, { toISODate } from '../components/DateRangePicker';
import RowActions from '../components/RowActions';
import ConfirmDialog from '../components/ConfirmDialog';

const PAGE_SIZE = 25;

// A purchase docket and a tax invoice are both money going out for scrap coming
// in — the only difference is whether GST applies. They belong in one history
// that can be narrowed, not two lists you have to check separately.
const TYPES = [
  { value: '', label: 'All purchases' },
  { value: 'PURCHASE_DOCKET', label: 'Purchase dockets' },
  { value: 'TAX_INVOICE', label: 'Tax invoices' },
];

const DEFAULTS = {
  type: '',
  search: '',
  from: '',
  to: '',
  materialId: '',
  supplierId: '',
  status: 'ACTIVE',
  page: '1',
};

const pathFor = (docket) =>
  `${docket.type === 'TAX_INVOICE' ? '/tax-invoices' : '/purchases'}/${docket.id}`;

export default function PurchasesPage() {
  const { isAdmin } = useAuth();
  const navigate = useNavigate();
  const { filters, setFilters, clearFilters, isFiltered } = useUrlFilters(DEFAULTS);

  const [dockets, setDockets] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filteredTotals, setFilteredTotals] = useState({ total: 0, gst: 0, subtotal: 0 });
  const [materials, setMaterials] = useState([]);
  const [supplier, setSupplier] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const page = Number(filters.page) || 1;

  useEffect(() => {
    api.get('/materials').then((r) => setMaterials(r.data.materials)).catch(() => {});
  }, []);

  // Show whose history this is when arriving from a client page.
  useEffect(() => {
    if (!filters.supplierId) return setSupplier(null);
    api
      .get(`/suppliers/${filters.supplierId}`)
      .then((r) => setSupplier(r.data.supplier))
      .catch(() => setSupplier(null));
  }, [filters.supplierId]);

  const load = useCallback(() => {
    setLoading(true);
    const params = Object.fromEntries(
      Object.entries({ ...filters, pageSize: PAGE_SIZE }).filter(([, v]) => v !== '' && v != null)
    );
    return api
      .get('/dockets', { params })
      .then((res) => {
        setDockets(res.data.dockets);
        setTotalCount(res.data.totalCount);
        setFilteredTotals(res.data.filteredTotals);
        setError('');
      })
      .catch(() => setError('Could not load records.'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

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

  const rangeDefaults = useMemo(() => {
    const today = new Date();
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    return { from: toISODate(monthStart), to: toISODate(today) };
  }, []);

  const field =
    'rounded-lg border border-steel-200 bg-white px-3 py-2 text-sm text-steel-900 focus:border-copper-500';

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">Purchases</h1>
          <p className="mt-0.5 text-sm text-steel-500">
            {supplier ? (
              <>
                Everything bought from{' '}
                <Link to={`/clients/${supplier.id}`} className="font-medium text-copper-600">
                  {supplier.name}
                </Link>
              </>
            ) : (
              'Purchase dockets and tax invoices together — scrap bought in'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/purchases/new"
            className="rounded-lg bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
          >
            + New docket
          </Link>
          <Link
            to="/tax-invoices/new"
            className="rounded-lg border border-steel-300 bg-white px-4 py-2.5 text-sm font-semibold text-steel-700 hover:bg-paper"
          >
            + Tax invoice
          </Link>
        </div>
      </div>

      <div className="mb-4 space-y-3 rounded-xl border border-steel-200 bg-white p-3 shadow-ticket">
        <DateRangePicker
          from={filters.from || rangeDefaults.from}
          to={filters.to || rangeDefaults.to}
          granularity="day"
          showGranularity={false}
          onChange={({ from, to }) => setFilters({ from, to })}
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* Document type as a segmented control rather than a second nav item */}
          <div className="flex rounded-lg border border-steel-200 bg-paper p-0.5">
            {TYPES.map((t) => (
              <button
                key={t.value || 'all'}
                onClick={() => setFilters({ type: t.value })}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  filters.type === t.value
                    ? 'bg-white text-steel-900 shadow-sm'
                    : 'text-steel-500 hover:text-steel-800'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <input
            type="text"
            placeholder="Search supplier, docket no., phone, notes…"
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value })}
            className={`${field} min-w-[14rem] flex-1`}
          />
          <select
            value={filters.materialId}
            onChange={(e) => setFilters({ materialId: e.target.value })}
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
            onChange={(e) => setFilters({ status: e.target.value })}
            className={field}
          >
            <option value="ACTIVE">Active only</option>
            <option value="ALL">Include voided</option>
            <option value="VOID">Voided only</option>
          </select>
          {isFiltered && (
            <button
              onClick={clearFilters}
              className="rounded-lg border border-steel-200 px-3 py-2 text-sm text-steel-600 hover:bg-paper"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-3 rounded-xl border border-steel-200 bg-white px-5 py-3 shadow-ticket">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-steel-400">Matching records</div>
          <div className="num text-lg font-semibold text-steel-900">{totalCount}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-steel-400">Total value</div>
          <div className="num text-lg font-semibold text-copper-600">
            {formatAud(filteredTotals.total)}
          </div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-steel-400">GST</div>
          <div className="num text-lg font-semibold text-steel-900">
            {formatAud(filteredTotals.gst)}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-steel-200 bg-white shadow-ticket">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-steel-100 bg-paper text-left text-xs uppercase tracking-wider text-steel-500">
              <th className="px-5 py-3 font-medium">Docket</th>
              <th className="px-5 py-3 font-medium">Type</th>
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
                <td colSpan={7} className="px-5 py-10 text-center text-steel-500">
                  Loading…
                </td>
              </tr>
            )}
            {!loading && dockets.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-12 text-center">
                  <p className="text-sm text-steel-500">No purchases match these filters.</p>
                  {isFiltered && (
                    <button
                      onClick={clearFilters}
                      className="mt-2 text-sm font-medium text-copper-600 hover:text-copper-700"
                    >
                      Clear filters
                    </button>
                  )}
                </td>
              </tr>
            )}
            {dockets.map((d) => {
              const isVoid = d.status === 'VOID';
              const isTax = d.type === 'TAX_INVOICE';
              return (
                <tr
                  key={d.id}
                  className={`border-b border-steel-100 last:border-0 hover:bg-paper/60 ${
                    isVoid ? 'opacity-60' : ''
                  }`}
                >
                  <td className="px-5 py-3">
                    <Link
                      to={pathFor(d)}
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
                  <td className="px-5 py-3">
                    <span
                      className={`whitespace-nowrap rounded px-2 py-0.5 text-[11px] font-medium ${
                        isTax ? 'bg-copper-100 text-copper-700' : 'bg-steel-100 text-steel-600'
                      }`}
                    >
                      {isTax ? 'Tax invoice' : 'Docket'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-steel-700">
                    <Link to={`/clients/${d.supplier?.id}`} className="hover:text-copper-600">
                      {d.supplier?.name}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-steel-500">
                    {format(new Date(d.date), 'd MMM yyyy')}
                  </td>
                  <td className="px-5 py-3 text-steel-500">
                    {d.lineItems?.length} {d.lineItems?.length === 1 ? 'line' : 'lines'}
                  </td>
                  <td className="num whitespace-nowrap px-5 py-3 text-right font-medium text-steel-900">
                    {formatAud(d.total)}
                  </td>
                  <td className="px-5 py-3">
                    <RowActions
                      viewTo={pathFor(d)}
                      isVoid={isVoid}
                      isAdmin={isAdmin}
                      onEdit={() => navigate(`${pathFor(d)}/edit`)}
                      onVoid={() =>
                        setDialog({
                          kind: 'void',
                          id: d.id,
                          title: `Void #${d.docketNumber}?`,
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
                          title: `Permanently delete #${d.docketNumber}?`,
                          body: 'This cannot be undone and leaves a gap in the numbering. Voiding is almost always the right choice.',
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
        <div className="mt-4 flex flex-col gap-3 text-sm text-steel-500 sm:flex-row sm:items-center sm:justify-between">
          <span>
            Page {page} of {totalPages} — {totalCount} records
          </span>
          <div className="flex gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setFilters({ page: page - 1 }, { resetPage: false })}
              className="rounded-lg border border-steel-200 bg-white px-3 py-1.5 disabled:opacity-40"
            >
              Previous
            </button>
            <button
              disabled={page >= totalPages}
              onClick={() => setFilters({ page: page + 1 }, { resetPage: false })}
              className="rounded-lg border border-steel-200 bg-white px-3 py-1.5 disabled:opacity-40"
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
        confirmLabel={dialog?.kind === 'void' ? 'Void record' : 'Delete permanently'}
        onCancel={() => setDialog(null)}
        onConfirm={(reason) =>
          dialog?.kind === 'void'
            ? runAction(
                () => api.post(`/dockets/${dialog.id}/void`, { reason }),
                'Could not void this record.'
              )
            : runAction(() => api.delete(`/dockets/${dialog.id}`), 'Could not delete this record.')
        }
      />
    </div>
  );
}
