import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import ExportButton from '../components/ExportButton';

const BLANK = {
  name: '',
  street: '',
  suburb: '',
  state: '',
  postcode: '',
  country: '',
  address: '',
  email: '',
  phone: '',
  abn: '',
  website: '',
  groupName: '',
  defaultCurrency: '',
  defaultShippingTerm: '',
  notes: '',
};

const L = 'mb-1 block text-xs font-medium text-steel-500';

/** A labelled field. The form was a wall of placeholder-only inputs, which lose
 *  their label the moment anything is typed into them. */
function Field({ label, className = '', children }) {
  return (
    <div className={className}>
      <label className={L}>{label}</label>
      {children}
    </div>
  );
}

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
        <div className="flex flex-wrap gap-2">
          <ExportButton endpoint="/consignees/export" />
          <button
            onClick={() => setForm({ ...BLANK })}
            className="rounded-lg bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
          >
            + Add buyer
          </button>
        </div>
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
          <div className="grid grid-cols-1 gap-x-3 gap-y-3 sm:grid-cols-6">
            <Field label="Registered company name" className="sm:col-span-4">
              <input required placeholder="e.g. Greenland Trading Pvt Ltd" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
            </Field>
            <Field label="Trades as / group" className="sm:col-span-2">
              <input placeholder="e.g. HANWA" value={form.groupName || ''}
                onChange={(e) => setForm({ ...form, groupName: e.target.value })} className={field} />
            </Field>

            <Field label="Street address" className="sm:col-span-6">
              <input placeholder="Unit G, 1/F., 16–18 Mau Lam Street" value={form.street || ''}
                onChange={(e) => setForm({ ...form, street: e.target.value })} className={field} />
            </Field>
            <Field label="Suburb / city" className="sm:col-span-2">
              <input placeholder="Jordan, Kowloon" value={form.suburb || ''}
                onChange={(e) => setForm({ ...form, suburb: e.target.value })} className={field} />
            </Field>
            <Field label="State / province" className="sm:col-span-2">
              <input placeholder="NSW" value={form.state || ''}
                onChange={(e) => setForm({ ...form, state: e.target.value })} className={field} />
            </Field>
            <Field label="Postcode" className="sm:col-span-1">
              <input placeholder="2565" value={form.postcode || ''}
                onChange={(e) => setForm({ ...form, postcode: e.target.value })} className={`num ${field}`} />
            </Field>
            <Field label="Country" className="sm:col-span-1">
              <input placeholder="Hong Kong" value={form.country || ''}
                onChange={(e) => setForm({ ...form, country: e.target.value })} className={field} />
            </Field>

            <Field label="Email" className="sm:col-span-3">
              <input type="email" placeholder="docs@buyer.com" value={form.email || ''}
                onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
            </Field>
            <Field label="Phone" className="sm:col-span-3">
              <input placeholder="+852 8228 3234" value={form.phone || ''}
                onChange={(e) => setForm({ ...form, phone: e.target.value })} className={`num ${field}`} />
            </Field>

            <Field label="ABN / company no." className="sm:col-span-2">
              <input placeholder="Registration number" value={form.abn || ''}
                onChange={(e) => setForm({ ...form, abn: e.target.value })} className={`num ${field}`} />
            </Field>
            <Field label="Website" className="sm:col-span-4">
              <input placeholder="www.buyer.com" value={form.website || ''}
                onChange={(e) => setForm({ ...form, website: e.target.value })} className={field} />
            </Field>

            {/* Prefilled onto each new invoice, because a buyer almost always
                trades on the same terms in the same currency. Both stay
                editable per invoice. */}
            <Field label="Usual currency" className="sm:col-span-2">
              <select value={form.defaultCurrency || ''}
                onChange={(e) => setForm({ ...form, defaultCurrency: e.target.value })} className={field}>
                <option value="">Not set</option>
                <option value="AUD">AUD</option>
                <option value="USD">USD</option>
              </select>
            </Field>
            <Field label="Usual shipping term" className="sm:col-span-4">
              <input placeholder="FAS Sydney" value={form.defaultShippingTerm || ''}
                onChange={(e) => setForm({ ...form, defaultShippingTerm: e.target.value })} className={field} />
            </Field>

            {/* The blob every imported buyer arrived with. Shown only when it is
                the address actually on file, so it can be read across into the
                fields above rather than silently disagreeing with them. */}
            {form.address && !form.street && (
              <Field label="Address as imported" className="sm:col-span-6">
                <input value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className={`${field} bg-working-amberDim`} />
                <p className="mt-1 text-[11px] text-steel-500">
                  Imported as one line. Copy it into the fields above and it will print properly.
                </p>
              </Field>
            )}

            <Field label="Notes" className="sm:col-span-6">
              <input placeholder="Anything worth knowing about this buyer" value={form.notes || ''}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} className={field} />
            </Field>
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
                {/* A <a> and a <button> are inline elements with different
                    line-heights, so side by side in a narrow cell they wrapped
                    and sat at different baselines. A flex row with matched
                    padding keeps them on one line and properly aligned. */}
                <td className="whitespace-nowrap px-5 py-3">
                  <div className="flex items-center justify-end gap-1.5">
                    <Link
                      to={`/buyers/${b.id}`}
                      className="inline-flex h-7 items-center rounded-md border border-steel-200 px-3 text-xs font-semibold text-steel-700 transition-colors hover:border-steel-300 hover:bg-paper"
                    >
                      View
                    </Link>
                    <button
                      type="button"
                      onClick={() => setForm(b)}
                      className="inline-flex h-7 items-center rounded-md border border-steel-200 px-3 text-xs font-semibold text-steel-700 transition-colors hover:border-steel-300 hover:bg-paper"
                    >
                      Edit
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
