import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { collectionRef } from '../lib/collectionRef';

/**
 * Everything one local seller has brought in.
 *
 * The admin's first question about a name on the list is not "what pickups
 * were there" but "what do we actually get from these people", so the grade
 * rollup sits above the list of pickups rather than under it.
 */
export default function LocalSupplierDetailPage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    api
      .get(`/local-suppliers/${id}`)
      .then((res) => {
        setData(res.data);
        setError('');
      })
      .catch(() => setError('Could not load that local supplier.'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return <div className="px-4 py-6 text-sm text-steel-500 sm:px-6 lg:px-8">Loading…</div>;
  }
  if (!data) {
    return (
      <div className="px-4 py-6 text-sm text-working-red sm:px-6 lg:px-8">
        {error || 'Not found.'}
      </div>
    );
  }

  const { localSupplier: s, totals } = data;
  const maxWeight = Math.max(1, ...totals.byMaterial.map((m) => m.netWeight));

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-4">
        <Link to="/local-suppliers" className="text-sm font-medium text-copper-600">
          ← All local suppliers
        </Link>
      </div>

      <header className="mb-6">
        <h1 className="font-display text-[28px] font-semibold leading-tight text-steel-900">
          {s.name}
        </h1>
        <p className="mt-1 text-sm text-steel-500">
          {[s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(', ') ||
            'No address on file'}
          {s.phone && <span className="num"> · {s.phone}</span>}
        </p>
        {s.notes && <p className="mt-2 max-w-2xl text-sm text-steel-600">{s.notes}</p>}
      </header>

      <div className="surface mb-6 flex flex-wrap gap-x-10 gap-y-3 px-5 py-4">
        <Figure label="Collections" value={formatNumber(totals.collections, 0)} />
        <Figure label="Net weight" value={`${formatNumber(totals.netWeight, 3)} kg`} accent />
        <Figure label="Added by" value={s.createdBy?.name ?? 'Unknown'} text />
      </div>

      <section className="surface mb-6 overflow-hidden">
        <header className="surface-header">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-steel-900">
              What comes off this seller
            </h2>
            <p className="mt-0.5 text-xs text-steel-500">By net weight, across every collection</p>
          </div>
        </header>
        <div className="surface-body">
          {totals.byMaterial.length === 0 ? (
            <p className="py-6 text-center text-sm text-steel-500">Nothing collected yet.</p>
          ) : (
            <div className="space-y-3">
              {totals.byMaterial.map((m) => (
                <div key={m.label}>
                  <div className="mb-1 flex items-baseline justify-between gap-4">
                    <span className="truncate text-sm font-medium text-steel-800">{m.label}</span>
                    <span className="num shrink-0 text-sm font-semibold text-steel-900">
                      {formatNumber(m.netWeight, 3)} kg
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-steel-100">
                    <div
                      className="h-full rounded-full bg-copper-500"
                      style={{ width: `${Math.max(2, (m.netWeight / maxWeight) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="surface overflow-hidden">
        <header className="surface-header">
          <div>
            <h2 className="font-display text-[15px] font-semibold text-steel-900">Collections</h2>
            <p className="mt-0.5 text-xs text-steel-500">Most recent first</p>
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-steel-100 bg-paper text-left text-[11px] uppercase tracking-wider text-steel-500">
                <th className="px-5 py-3 font-semibold">No.</th>
                <th className="px-5 py-3 font-semibold">Date</th>
                <th className="px-5 py-3 font-semibold">Grades</th>
                <th className="px-5 py-3 font-semibold">Recorded by</th>
                <th className="px-5 py-3 text-right font-semibold">Net kg</th>
              </tr>
            </thead>
            <tbody>
              {s.collections.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-sm text-steel-500">
                    Nothing collected from this seller yet.
                  </td>
                </tr>
              )}
              {s.collections.map((c) => (
                <tr key={c.id} className="data-row">
                  <td className="px-5 py-3">
                    <Link
                      to={`/collections/${c.id}`}
                      className="num font-semibold text-steel-900 hover:text-copper-600"
                    >
                      {collectionRef(c.collectionNumber)}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-5 py-3 text-steel-600">
                    {format(new Date(c.date), 'd MMM yyyy')}
                  </td>
                  <td className="px-5 py-3 text-steel-600">
                    {c.lines.map((l) => l.material?.description ?? l.description).join(', ')}
                  </td>
                  <td className="px-5 py-3 text-steel-600">{c.createdBy?.name ?? '—'}</td>
                  <td className="num px-5 py-3 text-right font-semibold text-steel-900">
                    {formatNumber(
                      c.lines.reduce((a, l) => a + Number(l.netWeight), 0),
                      3
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Figure({ label, value, accent = false, text = false }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-steel-500">
        {label}
      </div>
      <div
        className={`${text ? '' : 'num '}text-lg font-semibold ${
          accent ? 'text-copper-600' : 'text-steel-900'
        }`}
      >
        {value}
      </div>
    </div>
  );
}
