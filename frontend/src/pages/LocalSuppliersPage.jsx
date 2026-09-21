import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';

/**
 * The people the contractor buys off in the field.
 *
 * Deliberately not the Suppliers page. These records carry no ABN, no licence
 * and no bank account — nothing is paid from here — and keeping them apart is
 * also what stops a contractor's search offering the yard's whole book when
 * they type three letters beside a ute.
 */
export default function LocalSuppliersPage() {
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get('/local-suppliers', { params: search ? { search } : {} })
      .then((res) => {
        setRows(res.data.localSuppliers);
        setError('');
      })
      .catch(() => setError('Could not load local suppliers.'))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight text-steel-900">
            Local suppliers
          </h1>
          <p className="mt-1 text-sm text-steel-500">
            Sellers visited in the field. Added as you go — there is no form to fill in first.
          </p>
        </div>
        <Link to="/collections/new" className="btn-primary">
          New collection
        </Link>
      </header>

      {error && (
        <div className="mb-4 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      <div className="surface mb-4 p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a name, suburb or phone number…"
          className="w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
        />
      </div>

      <div className="surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-steel-100 bg-paper text-left text-[11px] uppercase tracking-wider text-steel-500">
                <th className="px-5 py-3 font-semibold">Name</th>
                <th className="px-5 py-3 font-semibold">Where</th>
                <th className="px-5 py-3 font-semibold">Phone</th>
                <th className="px-5 py-3 text-right font-semibold">Collections</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-sm text-steel-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-5 py-10 text-center text-sm text-steel-500">
                    {search
                      ? 'Nobody by that name.'
                      : 'No local suppliers yet — the first one is added on your first collection.'}
                  </td>
                </tr>
              )}
              {rows.map((s) => (
                <tr key={s.id} className="data-row">
                  <td className="px-5 py-3">
                    <Link
                      to={`/local-suppliers/${s.id}`}
                      className="font-semibold text-steel-900 hover:text-copper-600"
                    >
                      {s.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-steel-600">
                    {[s.suburb, s.state].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="num px-5 py-3 text-steel-600">{s.phone || '—'}</td>
                  <td className="num px-5 py-3 text-right font-semibold text-steel-900">
                    {formatNumber(s._count?.collections ?? 0, 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
