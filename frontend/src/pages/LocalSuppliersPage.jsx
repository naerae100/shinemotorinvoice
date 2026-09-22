import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { apiErrorMessage } from '../lib/apiError';
import { useAuth } from '../context/AuthContext';
import ConfirmDialog from '../components/ConfirmDialog';

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
  const [doomed, setDoomed] = useState(null);
  const { isAdmin } = useAuth();

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
                <th className="px-5 py-3 text-right font-semibold">Collections</th>
                {isAdmin && <th className="px-5 py-3 text-right font-semibold">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 3 : 2} className="px-5 py-10 text-center text-sm text-steel-500">
                    Loading…
                  </td>
                </tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 3 : 2} className="px-5 py-10 text-center text-sm text-steel-500">
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
                  <td className="num px-5 py-3 text-right font-semibold text-steel-900">
                    {formatNumber(s._count?.collections ?? 0, 0)}
                  </td>
                  {isAdmin && (
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => setDoomed(s)}
                        className="btn-ghost btn-sm text-steel-400 hover:bg-working-redDim hover:text-working-red"
                      >
                        Delete
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {doomed && (
        <ConfirmDialog
          open
          title={`Delete ${doomed.name}?`}
          body="This removes the supplier from the book. It cannot be undone."
          confirmLabel="Delete"
          onCancel={() => setDoomed(null)}
          onConfirm={async () => {
            try {
              await api.delete(`/local-suppliers/${doomed.id}`);
              setDoomed(null);
              setError('');
              load();
            } catch (err) {
              // The usual refusal is "they have collections", and that
              // sentence is the whole answer — show it rather than a generic
              // failure the admin then has to go and investigate.
              setDoomed(null);
              setError(apiErrorMessage(err, 'Could not delete that supplier.'));
            }
          }}
        />
      )}
    </div>
  );
}

/**
 * Add somebody to the book. A name, and nothing else.
 *
 * The rest of what the yard learns about a seller — where they are, a phone
 * number — arrives over three visits, and a form that asks for it up front
 * gets filled with guesses. The record can be opened and filled in later;
 * this is the fastest possible way to get a name on file.
 */
function NewLocalSupplier({ onCancel, onSaved }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!name.trim()) return setError('A name is required.');
    setSaving(true);
    setError('');
    try {
      await api.post('/local-suppliers', { name: name.trim() });
      onSaved();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save that supplier.'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="surface mb-4 p-4">
      <label className="field-label" htmlFor="ls-name">
        New local supplier
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="ls-name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Business or person"
          className="w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm sm:flex-1"
        />
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost btn-sm flex-1 sm:flex-none">
            Cancel
          </button>
          <button type="submit" disabled={saving} className="btn-primary btn-sm flex-1 sm:flex-none">
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-working-red">{error}</p>}
    </form>
  );
}
