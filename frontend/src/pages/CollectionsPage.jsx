import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiErrorMessage } from '../lib/apiError';

const PAGE_SIZE = 25;

const DEFAULTS = {
  search: '',
  from: '',
  to: '',
  localSupplierId: '',
  status: 'ACTIVE',
  page: '1',
};

/**
 * What the contractor brought back.
 *
 * Weights only. There is no money on this screen because there is no money in
 * the record — a collection is what was picked up, not what was paid for it,
 * and showing a blank or zero price column would invite somebody to fill it in
 * on the roadside.
 */
export default function CollectionsPage() {
  const { isAdmin, isContractor } = useAuth();
  const navigate = useNavigate();
  const { filters, setFilters } = useUrlFilters(DEFAULTS);

  const [collections, setCollections] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [totals, setTotals] = useState({ netWeight: 0, grossWeight: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);

  const page = Number(filters.page) || 1;

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get('/collections', {
        params: Object.fromEntries(
          Object.entries({ ...filters, pageSize: PAGE_SIZE }).filter(([, v]) => v !== '' && v != null)
        ),
      })
      .then((res) => {
        setCollections(res.data.collections);
        setTotalCount(res.data.totalCount);
        setTotals(res.data.filteredTotals ?? { netWeight: 0, grossWeight: 0 });
        setError('');
      })
      .catch(() => setError('Could not load collections.'))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function runVoid(reason) {
    setBusy(true);
    try {
      await api.post(`/collections/${dialog.id}/void`, { reason });
      setDialog(null);
      await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not void that collection.'));
    } finally {
      setBusy(false);
    }
  }

  const pages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight text-steel-900">
            Collections
          </h1>
          <p className="mt-1 text-sm text-steel-500">
            Scrap weighed in the field. No prices — these are picked up, not bought.
          </p>
        </div>
        {/* The top bar's button goes by role, not by page: a contractor gets
            "New collection", everyone else gets "New purchase". So for an
            admin standing here there was no way to start one at all. The
            action belongs to the page; it steps aside only for the
            contractor, whose bar is already offering exactly this. */}
        {!isContractor && (
          <Link to="/collections/new" className="btn-primary">
            <span aria-hidden="true">+</span> New collection
          </Link>
        )}
      </header>

      {error && (
        <div className="mb-4 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      <div className="surface mb-4 grid grid-cols-2 gap-2 p-3 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
        <input
          value={filters.search}
          onChange={(e) => setFilters({ search: e.target.value })}
          placeholder="Search a name, suburb, note or collection number…"
          className="col-span-2 w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm sm:w-auto sm:min-w-[16rem] sm:flex-1"
        />
        <input
          type="date"
          value={filters.from}
          onChange={(e) => setFilters({ from: e.target.value })}
          className="rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
          aria-label="From"
        />
        <input
          type="date"
          value={filters.to}
          onChange={(e) => setFilters({ to: e.target.value })}
          className="rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
          aria-label="To"
        />
        {isAdmin && (
          <select
            value={filters.status}
            onChange={(e) => setFilters({ status: e.target.value })}
            className="rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
          >
            <option value="ACTIVE">Active only</option>
            <option value="ALL">Include voided</option>
            <option value="VOID">Voided only</option>
          </select>
        )}
      </div>

      <div className="surface mb-4 flex flex-wrap gap-x-8 gap-y-3 px-5 py-3">
        <Figure label="Collections" value={formatNumber(totalCount, 0)} />
        <Figure label="Net weight" value={`${formatNumber(totals.netWeight, 3)} kg`} accent />
        <Figure label="Gross weight" value={`${formatNumber(totals.grossWeight, 3)} kg`} />
      </div>

      {/* Cards on a phone, a table from lg up.
          
          A six-column table at 390px meant the net weight and every action
          were off the right-hand edge behind a horizontal scroll nobody
          thinks to try on a list — so the two things you open this page for,
          the weight and the way in, were the two you could not see. */}
      <div className="space-y-3 lg:hidden">
        {loading && collections.length === 0 && (
          <div className="surface px-5 py-10 text-center text-sm text-steel-500">Loading…</div>
        )}
        {!loading && collections.length === 0 && (
          <div className="surface px-5 py-10 text-center text-sm text-steel-500">
            Nothing collected yet.{' '}
            <Link to="/collections/new" className="font-medium text-copper-600">
              Record a collection →
            </Link>
          </div>
        )}
        {collections.map((c) => {
          const isVoid = c.status === 'VOID';
          const net = c.lines.reduce((a, l) => a + Number(l.netWeight), 0);
          const photos =
            (c.photos?.length ?? 0) + c.lines.reduce((a, l) => a + (l.photos?.length ?? 0), 0);
          return (
            <Link
              key={c.id}
              to={`/collections/${c.id}`}
              className={`surface block px-4 py-3 ${isVoid ? 'opacity-60' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className={`num font-bold text-steel-900 ${isVoid ? 'line-through' : ''}`}>
                  #{c.collectionNumber}
                </span>
                <span className="num text-base font-bold text-steel-900">
                  {formatNumber(net, 3)}
                  <span className="ml-0.5 text-[11px] font-semibold text-steel-500">kg</span>
                </span>
              </div>
              <div className="mt-0.5 truncate font-semibold text-steel-800">
                {c.localSupplier?.name}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-steel-500">
                <span>{format(new Date(c.date), 'd MMM yyyy')}</span>
                <span aria-hidden="true">·</span>
                <span>
                  {c.lines.length} {c.lines.length === 1 ? 'grade' : 'grades'}
                </span>
                {photos > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>
                      {photos} {photos === 1 ? 'photo' : 'photos'}
                    </span>
                  </>
                )}
                {isVoid && (
                  <span className="rounded bg-working-redDim px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-working-red">
                    Voided
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="surface hidden overflow-hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-steel-100 bg-paper text-left text-[11px] uppercase tracking-wider text-steel-500">
                <th className="px-5 py-3 font-semibold">No.</th>
                <th className="px-5 py-3 font-semibold">Local supplier</th>
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Grades</th>
                <th className="px-5 py-3 text-right font-semibold">Net weight</th>
                <th className="px-5 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && collections.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-steel-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && collections.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-steel-500">
                    Nothing collected yet.{' '}
                    <Link to="/collections/new" className="font-medium text-copper-600">
                      Record a collection →
                    </Link>
                  </td>
                </tr>
              )}
              {collections.map((c) => {
                const isVoid = c.status === 'VOID';
                const net = c.lines.reduce((a, l) => a + Number(l.netWeight), 0);
                return (
                  <tr key={c.id} className={`data-row ${isVoid ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-3">
                      <Link
                        to={`/collections/${c.id}`}
                        className={`num font-semibold text-steel-900 hover:text-copper-600 ${
                          isVoid ? 'line-through' : ''
                        }`}
                      >
                        #{c.collectionNumber}
                      </Link>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-steel-800">{c.localSupplier?.name}</div>
                      {c.localSupplier?.suburb && (
                        <div className="text-xs text-steel-500">{c.localSupplier.suburb}</div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-steel-600">
                      {format(new Date(c.date), 'd MMM yyyy')}
                    </td>
                    <td className="px-5 py-3 text-steel-600">
                      {c.lines.length} {c.lines.length === 1 ? 'grade' : 'grades'}
                    </td>
                    <td className="num whitespace-nowrap px-5 py-3 text-right font-semibold text-steel-900">
                      {formatNumber(net, 3)} kg
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link to={`/collections/${c.id}`} className="btn-secondary btn-sm">
                          View
                        </Link>
                        {!isVoid && (
                          <button
                            type="button"
                            onClick={() => navigate(`/collections/${c.id}/edit`)}
                            className="btn-secondary btn-sm"
                          >
                            Edit
                          </button>
                        )}
                        {isAdmin && !isVoid && (
                          <button
                            type="button"
                            onClick={() => setDialog({ id: c.id, number: c.collectionNumber })}
                            className="btn-secondary btn-sm"
                          >
                            Void…
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {pages > 1 && (
        <div className="btn-row mt-4 justify-end">
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setFilters({ page: String(page - 1) }, { resetPage: false })}
            className="btn-secondary btn-sm"
          >
            Previous
          </button>
          <span className="num px-2 text-sm text-steel-500">
            {page} of {pages}
          </span>
          <button
            type="button"
            disabled={page >= pages}
            onClick={() => setFilters({ page: String(page + 1) }, { resetPage: false })}
            className="btn-secondary btn-sm"
          >
            Next
          </button>
        </div>
      )}

      {dialog && (
        <ConfirmDialog
          open
          title={`Void collection #${dialog.number}?`}
          body="It keeps its number and stays in the history, but is left out of every total."
          confirmLabel="Void it"
          tone="danger"
          reasonLabel="Why (optional)"
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={runVoid}
        />
      )}
    </div>
  );
}

function Figure({ label, value, accent = false }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-steel-500">
        {label}
      </div>
      <div className={`num text-lg font-semibold ${accent ? 'text-copper-600' : 'text-steel-900'}`}>
        {value}
      </div>
    </div>
  );
}
