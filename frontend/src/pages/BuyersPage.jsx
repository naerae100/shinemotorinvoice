import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

const BLANK = { name: '', country: '', address: '', email: '', phone: '' };

export default function BuyersPage() {
  const [buyers, setBuyers] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    return api
      .get('/consignees', { params: { search } })
      .then((r) => setBuyers(r.data.consignees))
      .catch(() => setError('Could not load buyers.'))
      .finally(() => setLoading(false));
  }, [search]);

  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, email: form.email || null };
      if (form.id) await api.patch(`/consignees/${form.id}`, payload);
      else await api.post('/consignees', payload);
      setForm(null);
      await load();
    } catch (err) {
      setError(err.response?.data?.error?.fieldErrors?.email?.[0] || 'Could not save buyer.');
    } finally {
      setSaving(false);
    }
  }

  const field = 'w-full rounded-md border border-steel-200 px-3 py-2 text-sm focus:border-copper-500';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">Buyers</h1>
          <p className="mt-0.5 text-sm text-steel-500">Who we sell containers and scrap to</p>
        </div>
        <button
          onClick={() => setForm({ ...BLANK })}
          className="rounded-md bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
        >
          + Add buyer
        </button>
      </div>

      <input
        type="text"
        placeholder="Search buyers…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm focus:border-copper-500"
      />

      {error && (
        <div className="mb-4 rounded-md bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      {form && (
        <form onSubmit={save} className="mb-5 rounded-xl border border-copper-300 bg-white p-5 shadow-ticket">
          <h2 className="mb-3 font-display text-base font-semibold text-steel-900">
            {form.id ? 'Edit buyer' : 'New buyer'}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input required placeholder="Company name" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} className={`sm:col-span-2 ${field}`} />
            <input placeholder="Address" value={form.address || ''}
              onChange={(e) => setForm({ ...form, address: e.target.value })} className={field} />
            <input placeholder="Country" value={form.country || ''}
              onChange={(e) => setForm({ ...form, country: e.target.value })} className={field} />
            <input type="email" placeholder="Email" value={form.email || ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
            <input placeholder="Phone" value={form.phone || ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} className={field} />
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={saving}
              className="rounded-md bg-copper-500 px-4 py-2 text-sm font-semibold text-steel-950 hover:bg-copper-400 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save buyer'}
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="rounded-md border border-steel-300 px-4 py-2 text-sm font-semibold text-steel-700 hover:bg-paper">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-x-auto rounded-xl border border-steel-200 bg-white shadow-ticket">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-steel-100 bg-paper text-left text-xs uppercase tracking-wider text-steel-500">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Country</th>
              <th className="px-5 py-3 font-medium">Contact</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && buyers.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-steel-500">Loading…</td></tr>
            )}
            {!loading && buyers.length === 0 && (
              <tr><td colSpan={4} className="px-5 py-10 text-center text-steel-500">No buyers yet.</td></tr>
            )}
            {buyers.map((b) => (
              <tr key={b.id} className="border-b border-steel-100 last:border-0 hover:bg-paper">
                <td className="px-5 py-3">
                  <Link to={`/buyers/${b.id}`} className="font-medium text-steel-900 hover:text-copper-600">
                    {b.name}
                  </Link>
                </td>
                <td className="px-5 py-3 text-steel-500">{b.country || '—'}</td>
                <td className="px-5 py-3 text-steel-500">
                  {[b.email, b.phone].filter(Boolean).join(' · ') || '—'}
                </td>
                <td className="px-5 py-3 text-right">
                  <Link to={`/buyers/${b.id}`}
                    className="mr-1 rounded-md border border-steel-200 px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper">
                    View
                  </Link>
                  <button onClick={() => setForm(b)}
                    className="rounded-md border border-steel-200 px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper">
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
