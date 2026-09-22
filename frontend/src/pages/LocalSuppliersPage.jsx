import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { apiErrorMessage } from '../lib/apiError';

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
  const [adding, setAdding] = useState(false);

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
        {/* A local supplier could only ever be created by typing a new name
            into a collection — fine in the field, useless at a desk when
            somebody rings up and you want them on file before the truck
            goes out. */}
        <button type="button" onClick={() => setAdding(true)} className="btn-primary">
          <span aria-hidden="true">+</span> New local supplier
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      {adding && (
        <NewLocalSupplier
          onCancel={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            load();
          }}
        />
      )}

      <div className="surface mb-4 p-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search a name or suburb…"
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
                <th className="px-5 py-3 text-right font-semibold">Collections</th>
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-10 text-center text-sm text-steel-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-5 py-10 text-center text-sm text-steel-500">
                    {search
                      ? 'Nobody by that name.'
                      : 'No local suppliers yet — add one here, or let the first collection create it.'}
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

const BLANK = { name: '', phone: '', address: '', suburb: '', state: '', postcode: '' };

/**
 * Add somebody to the book without leaving for the collection form.
 *
 * Name is the only thing required, on purpose. The rest of what the yard
 * knows about a seller tends to arrive over three visits, and a form that
 * insists on all of it up front just gets filled with rubbish.
 */
function NewLocalSupplier({ onCancel, onSaved }) {
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  async function submit(e) {
    e.preventDefault();
    if (!form.name.trim()) return setError('A name is required.');
    setSaving(true);
    setError('');
    try {
      await api.post('/local-suppliers', {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        suburb: form.suburb.trim() || null,
        state: form.state.trim() || null,
        postcode: form.postcode.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save that supplier.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface mb-4 p-4">
      <div className="section-label mb-3">New local supplier</div>

      {error && (
        <div className="mb-3 rounded-lg bg-working-redDim px-3 py-2 text-sm text-working-red">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label" htmlFor="ls-name">Name</label>
          <input
            id="ls-name"
            autoFocus
            value={form.name}
            onChange={set('name')}
            placeholder="Business or person"
            className="w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="ls-phone">Phone</label>
          <input
            id="ls-phone"
            inputMode="tel"
            value={form.phone}
            onChange={set('phone')}
            className="w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="ls-address">Address</label>
          <input
            id="ls-address"
            value={form.address}
            onChange={set('address')}
            className="w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
          />
        </div>
        <div>
          <label className="field-label" htmlFor="ls-suburb">Suburb</label>
          <input
            id="ls-suburb"
            value={form.suburb}
            onChange={set('suburb')}
            className="w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="field-label" htmlFor="ls-state">State</label>
            <input
              id="ls-state"
              value={form.state}
              onChange={set('state')}
              placeholder="NSW"
              className="w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="ls-postcode">Postcode</label>
            <input
              id="ls-postcode"
              inputMode="numeric"
              value={form.postcode}
              onChange={set('postcode')}
              className="num w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="btn-ghost btn-sm">
          Cancel
        </button>
        <button type="submit" disabled={saving} className="btn-primary btn-sm">
          {saving ? 'Saving…' : 'Save supplier'}
        </button>
      </div>
    </form>
  );
}
