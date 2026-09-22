import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { useAuth } from '../context/AuthContext';
import { useUrlFilters } from '../lib/useUrlFilters';
import ConfirmDialog from '../components/ConfirmDialog';
import { apiErrorMessage } from '../lib/apiError';
import { collectionRef } from '../lib/collectionRef';

const PAGE_SIZE = 25;

const DEFAULTS = {
  search: '',
  from: '',
  to: '',
  localSupplierId: '',
  status: 'ACTIVE',
  sort: 'newest',
  page: '1',
};

const SORTS = [
  ['newest', 'Newest first'],
  ['oldest', 'Oldest first'],
  ['number', 'By number'],
  ['supplier', 'By supplier'],
];

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
  const narrowed =
    Boolean(filters.search || filters.from || filters.to || filters.localSupplierId) ||
    filters.status !== DEFAULTS.status ||
    filters.sort !== DEFAULTS.sort;

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

      {/* Search gets its own line at every width. It is the control people
          actually use, and sharing a row with two date pickers made it a
          third of the width on the screen where it matters most. */}
      <div className="surface mb-3 p-3">
        <div className="relative">
          <svg
            viewBox="0 0 24 24"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-steel-400"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            value={filters.search}
            onChange={(e) => setFilters({ search: e.target.value, page: '1' })}
            placeholder="SHINE01, a supplier, a grade or a note…"
            className="w-full rounded-md border border-steel-200 bg-white py-2.5 pl-9 pr-9 text-sm"
          />
          {filters.search && (
            <button
              type="button"
              onClick={() => setFilters({ search: '', page: '1' })}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-steel-400 hover:bg-steel-100 hover:text-steel-700"
            >
              ×
            </button>
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
          <select
            value={filters.sort}
            onChange={(e) => setFilters({ sort: e.target.value, page: '1' })}
            aria-label="Sort"
            className="rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
          >
            {SORTS.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {isAdmin && (
            <select
              value={filters.status}
              onChange={(e) => setFilters({ status: e.target.value, page: '1' })}
              aria-label="Status"
              className="rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
            >
              <option value="ACTIVE">Active only</option>
              <option value="ALL">Include voided</option>
              <option value="VOID">Voided only</option>
            </select>
          )}
          <input
            type="date"
            value={filters.from}
            onChange={(e) => setFilters({ from: e.target.value, page: '1' })}
            className="rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
            aria-label="From"
          />
          <input
            type="date"
            value={filters.to}
            onChange={(e) => setFilters({ to: e.target.value, page: '1' })}
            className="rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
            aria-label="To"
          />
          {narrowed && (
            <button
              type="button"
              onClick={() => setFilters(DEFAULTS)}
              className="col-span-2 text-xs font-semibold text-copper-600 hover:text-copper-700 sm:col-span-1 sm:ml-1"
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Tiles rather than three figures crowded onto one line, and not
          three across on a phone: a third of 390px cannot hold
          "5,042.986 kg" and it came out as "5,042.98…". Net weight is the
          number this page exists to give, so it gets the full width and the
          other two share the row underneath. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3">
        <Figure
          className="col-span-2 sm:col-span-1 sm:order-2"
          label="Net weight"
          value={formatNumber(totals.netWeight, 3)}
          unit="kg"
          accent
          big
        />
        <Figure className="sm:order-1" label="Collections" value={formatNumber(totalCount, 0)} />
        <Figure
          className="sm:order-3"
          label="Gross weight"
          value={formatNumber(totals.grossWeight, 3)}
          unit="kg"
        />
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
                  {collectionRef(c.collectionNumber)}
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
                        {collectionRef(c.collectionNumber)}
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
                            onClick={() => setDialog({ id: c.id, ref: collectionRef(c.collectionNumber) })}
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
          title={`Void ${dialog.ref}?`}
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

/**
 * One figure on its own tile.
 *
 * The unit is a separate, smaller span: "3,362.000 kg" set at one size is
 * eleven characters of the same weight, and the eye has to read all of it
 * before finding the number.
 */
function Figure({ label, value, unit, accent = false, big = false, className = '' }) {
  return (
    <div className={`surface px-3 py-2.5 sm:px-4 sm:py-3 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-steel-500 sm:text-[11px]">
        {label}
      </div>
      <div
        className={`num mt-0.5 truncate font-bold ${big ? 'text-xl' : 'text-[15px]'} sm:text-lg ${
          accent ? 'text-copper-600' : 'text-steel-900'
        }`}
      >
        {value}
        {unit && <span className="ml-0.5 text-[10px] font-semibold text-steel-400">{unit}</span>}
      </div>
    </div>
  );
}
