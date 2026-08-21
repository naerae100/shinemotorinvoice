import { useCallback, useEffect, useState } from 'react';
import { format } from 'date-fns';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

const BLANK = { name: '', email: '', password: '', role: 'STAFF' };

export default function UsersPage() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(
    () =>
      api
        .get('/users')
        .then((r) => setUsers(r.data.users))
        .catch(() => setError('Could not load users.')),
    []
  );

  useEffect(() => {
    load();
  }, [load]);

  async function save(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (form.id) {
        const { id, password, ...rest } = form;
        await api.patch(`/users/${id}`, { ...rest, ...(password ? { password } : {}) });
        setNotice(`${form.name} updated.`);
      } else {
        await api.post('/users', form);
        setNotice(`${form.name} can now sign in with their email and password.`);
      }
      setForm(null);
      await load();
    } catch (err) {
      const e2 = err.response?.data?.error;
      setError(
        typeof e2 === 'string' ? e2 : e2?.fieldErrors?.password?.[0] || 'Could not save user.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(u) {
    setError('');
    try {
      if (u.active) await api.post(`/users/${u.id}/deactivate`);
      else await api.patch(`/users/${u.id}`, { active: true });
      await load();
    } catch (err) {
      setError(err.response?.data?.error || 'Could not change this user.');
    }
  }

  const field = 'w-full rounded-md border border-steel-200 px-3 py-2 text-sm focus:border-copper-500';

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">Staff &amp; logins</h1>
          <p className="mt-0.5 text-sm text-steel-500">
            Each person gets their own login, so every docket records who processed it
          </p>
        </div>
        <button
          onClick={() => setForm({ ...BLANK })}
          className="rounded-md bg-copper-500 px-4 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400"
        >
          + Add staff member
        </button>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-working-redDim px-4 py-3 text-sm text-working-red">{error}</div>
      )}
      {notice && (
        <div className="mb-4 rounded-md bg-working-greenDim px-4 py-3 text-sm text-working-green">
          {notice}
        </div>
      )}

      {form && (
        <form onSubmit={save} className="mb-5 rounded-xl border border-copper-300 bg-white p-5 shadow-ticket">
          <h2 className="mb-3 font-display text-base font-semibold text-steel-900">
            {form.id ? `Edit ${form.name}` : 'New staff member'}
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-steel-500">Full name</label>
              <input required value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} className={field} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-steel-500">Email (their login)</label>
              <input required type="email" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} className={field} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-steel-500">
                {form.id ? 'New password (leave blank to keep)' : 'Password'}
              </label>
              <input required={!form.id} type="password" minLength={8} value={form.password || ''}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="At least 8 characters" className={field} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-steel-500">Role</label>
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={field}>
                <option value="STAFF">Staff — write dockets and invoices</option>
                <option value="ADMIN">Admin — also prices, settings, staff, delete</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button type="submit" disabled={saving}
              className="rounded-md bg-copper-500 px-4 py-2 text-sm font-semibold text-steel-950 hover:bg-copper-400 disabled:opacity-60">
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setForm(null)}
              className="rounded-md border border-steel-300 px-4 py-2 text-sm font-semibold text-steel-700 hover:bg-paper">
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="overflow-hidden rounded-xl border border-steel-200 bg-white shadow-ticket">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-steel-100 bg-paper text-left text-xs uppercase tracking-wider text-steel-500">
              <th className="px-5 py-3 font-medium">Name</th>
              <th className="px-5 py-3 font-medium">Role</th>
              <th className="px-5 py-3 font-medium">Documents</th>
              <th className="px-5 py-3 font-medium">Added</th>
              <th className="px-5 py-3 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={`border-b border-steel-100 last:border-0 ${u.active ? '' : 'opacity-50'}`}>
                <td className="px-5 py-3">
                  <div className="font-medium text-steel-900">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 text-xs text-steel-400">(you)</span>}
                  </div>
                  <div className="text-xs text-steel-500">{u.email}</div>
                </td>
                <td className="px-5 py-3">
                  <span className={`rounded px-2 py-0.5 text-xs font-semibold ${
                    u.role === 'ADMIN' ? 'bg-copper-100 text-copper-700' : 'bg-steel-100 text-steel-600'
                  }`}>
                    {u.role === 'ADMIN' ? 'Admin' : 'Staff'}
                  </span>
                  {!u.active && <span className="ml-2 text-xs text-working-red">Deactivated</span>}
                </td>
                <td className="num px-5 py-3 text-steel-500">
                  {u._count.docketsCreated + u._count.invoicesCreated}
                </td>
                <td className="px-5 py-3 text-steel-500">{format(new Date(u.createdAt), 'd MMM yyyy')}</td>
                <td className="px-5 py-3 text-right">
                  <button onClick={() => setForm({ ...u, password: '' })}
                    className="mr-1 rounded-md border border-steel-200 px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper">
                    Edit
                  </button>
                  <button onClick={() => toggleActive(u)}
                    className="rounded-md border border-steel-200 px-2.5 py-1 text-xs font-semibold text-steel-700 hover:bg-paper">
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-steel-500">
        Staff are never deleted — dockets reference them so history stays intact. Deactivating
        blocks sign-in while keeping their name on past documents.
      </p>
    </div>
  );
}
