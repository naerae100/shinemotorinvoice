import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import ExportButton from '../components/ExportButton';

const BLANK = { name: '', saleType: 'PRIVATE', address: '', suburb: '', postcode: '', phone: '', email: '', abn: '', licenceNo: '' };

export default function ClientsPage() {
  const [clients, setClients] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(
    () =>
      api
        .get('/suppliers', { params: { search } })
        .then((res) => setClients(res.data.suppliers))
        .catch(() => setError('Could not load clients.'))
        .finally(() => setLoading(false)),
    [search]
  );

  useEffect(() => {
    setLoading(true);
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (form.id) await api.patch(`/suppliers/${form.id}`, form);
      else await api.post('/suppliers', form);
      setForm(null);
      await load();
    } catch {
      setError('Could not save client.');
    } finally {
      setSaving(false);
    }
  }

  const field = 'w-full rounded-md border border-steel-200 px-3 py-2 text-sm focus:border-copper-500';

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">Clients</h1>
          <p className="mt-0.5 text-sm text-steel-500">People and businesses who sell scrap to us</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButton endpoint="/suppliers/export" params={search ? { search } : {}} />
          <button
            onClick={() => setForm({ ...BLANK })}
            className="rounded-lg bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
          >
            + Add client
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-working-redDim px-4 py-3 text-sm text-working-red">{error}</div>
      )}

      {form && (
        <form onSubmit={save} className="mb-5 rounded-xl border border-copper-300 bg-white p-5 shadow-ticket">
          <h2 className="mb-3 font-display text-base font-semibold text-steel-900">
            {form.id ? `Edit ${form.name}` : 'New client'}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <input required placeholder="Name" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} className={`sm:col-span-2 ${field}`} />
            <select value={form.saleType} onChange={(e) => setForm({ ...form, saleType: e.target.value })} className={field}>
              <option value="PRIVATE">Private seller</option>
              <option value="BUSINESS">Business</option>
            </select>
            <input placeholder="Address" value={form.address || ''}
              onChange={(e) => setForm({ ...form, address: e.target.value })} className={field} />
            <input placeholder="Suburb" value={form.suburb || ''}
              onChange={(e) => setForm({ ...form, suburb: e.target.value })} className={field} />
            <input placeholder="Postcode" value={form.postcode || ''}
              onChange={(e) => setForm({ ...form, postcode: e.target.value })} className={field} />
            <input placeholder="Phone" value={form.phone || ''}
              onChange={(e) => setForm({ ...form, phone: e.target.value })} className={field} />
            <input type="email" placeholder="Email" value={form.email || ''}
              onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
            <input placeholder="ABN (if business)" value={form.abn || ''}
              onChange={(e) => setForm({ ...form, abn: e.target.value })} className={field} />
            <input placeholder="Driver licence no." value={form.licenceNo || ''}
              onChange={(e) => setForm({ ...form, licenceNo: e.target.value })} className={field} />
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={saving}
              className="rounded-md bg-copper-500 px-4 py-2 text-sm font-semibold text-steel-950 hover:bg-copper-400 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save client'}
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="rounded-md border border-steel-300 px-4 py-2 text-sm font-semibold text-steel-700 hover:bg-paper">
              Cancel
            </button>
          </div>
        </form>
      )}

      <input
        type="text"
        placeholder="Search by name, ABN, or phone…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-4 w-full max-w-sm rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm focus:border-copper-500"
      />

      <div className="overflow-x-auto rounded-xl border border-steel-200 bg-white shadow-ticket">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-steel-100 bg-paper text-left text-xs uppercase tracking-wider text-steel-500">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Type</th>
              <th className="px-5 py-3 font-medium">Contact</th>
              <th className="px-5 py-3 font-medium">Address</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-steel-500">Loading…</td>
              </tr>
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-5 py-10 text-center text-steel-500">No clients found.</td>
              </tr>
            ) : (
              clients.map((c) => (
                <tr key={c.id} className="border-b border-steel-100 last:border-0 hover:bg-paper">
                  <td className="px-5 py-3">
                    <Link to={`/clients/${c.id}`} className="font-medium text-steel-900 hover:text-copper-600">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-steel-500">{c.saleType === 'BUSINESS' ? 'Business' : 'Private'}</td>
                  <td className="px-5 py-3 text-steel-500">
                    {c.phone || c.email ? (
                      <div className="leading-tight">
                        {c.phone && <div className="num">{c.phone}</div>}
                        {c.email && <div className="text-xs text-steel-400">{c.email}</div>}
                      </div>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="px-5 py-3 text-steel-500">
                    {[c.address, c.suburb].filter(Boolean).join(', ') || '—'}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link to={`/clients/${c.id}`}
                      className="mr-1 rounded-md border border-steel-200 px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper">
                      View
                    </Link>
                    <button onClick={() => setForm(c)}
                      className="rounded-md border border-steel-200 px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper">
                      Edit
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
