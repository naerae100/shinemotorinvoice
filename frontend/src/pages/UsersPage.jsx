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

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-[28px] font-semibold leading-tight text-steel-900">
            Staff &amp; logins
          </h1>
          <p className="mt-1 text-sm text-steel-500">
            Each person gets their own login, so every document records who processed it.
          </p>
        </div>
        <button type="button" onClick={() => setForm({ ...BLANK })} className="btn-primary">
          <span aria-hidden="true">+</span> Add staff member
        </button>
      </header>

      {error && (
        <div className="mb-4 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-lg bg-working-greenDim px-4 py-3 text-sm text-working-green">
          {notice}
        </div>
      )}

      {form && (
        <form onSubmit={save} className="surface mb-4 p-4 sm:p-5">
          <div className="section-label mb-3">
            {form.id ? `Edit ${form.name}` : 'New staff member'}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="u-name">Full name</label>
              <input
                id="u-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={FIELD}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="u-email">Email — this is their login</label>
              <input
                id="u-email"
                required
                type="email"
                autoComplete="off"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className={FIELD}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="u-password">
                {form.id ? 'New password' : 'Password'}{' '}
                <span className="field-hint">
                  {form.id ? 'leave blank to keep the current one' : 'at least 8 characters'}
                </span>
              </label>
              <input
                id="u-password"
                required={!form.id}
                type="password"
                minLength={8}
                autoComplete="new-password"
                value={form.password || ''}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className={FIELD}
              />
            </div>
            <div>
              <label className="field-label" htmlFor="u-role">Role</label>
              <select
                id="u-role"
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className={FIELD}
              >
                <option value="STAFF">Staff</option>
                <option value="ADMIN">Admin</option>
                <option value="CONTRACTOR">Contractor</option>
              </select>
              {/* What the role actually grants, in the place where it is
                  chosen. It was three long option labels inside the select,
                  which a phone truncates to "Admin — also prices, sett…". */}
              <p className="mt-1.5 text-xs leading-relaxed text-steel-500">
                {ROLE_BLURB[form.role]}
              </p>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => setForm(null)} className="btn-ghost btn-sm">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="btn-primary btn-sm">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      )}

      {/* Cards on a phone, a table from md up — the same split the
          collections list uses. A five-column table at 390px put the
          actions behind a horizontal scroll nobody thinks to try. */}
      <div className="space-y-3 md:hidden">
        {users.map((u) => (
          <div key={u.id} className={`surface px-4 py-3 ${u.active ? '' : 'opacity-60'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate font-semibold text-steel-900">
                  {u.name}
                  {u.id === me?.id && <span className="ml-2 text-xs text-steel-400">(you)</span>}
                </div>
                <div className="truncate text-xs text-steel-500">{u.email}</div>
              </div>
              <RoleChip role={u.role} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-steel-500">
              <span className="num">{documentCount(u)}</span>
              <span>documents</span>
              <span aria-hidden="true">·</span>
              <span>added {format(new Date(u.createdAt), 'd MMM yyyy')}</span>
              {!u.active && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-semibold text-working-red">Deactivated</span>
                </>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...u, password: '' })}
                className="btn-secondary btn-sm flex-1"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => toggleActive(u)}
                className="btn-secondary btn-sm flex-1"
              >
                {u.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="surface hidden overflow-hidden md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-steel-100 bg-paper text-left text-[11px] uppercase tracking-wider text-steel-500">
              <th className="px-5 py-3 font-semibold">Name</th>
              <th className="px-5 py-3 font-semibold">Role</th>
              <th className="px-5 py-3 text-right font-semibold">Documents</th>
              <th className="px-5 py-3 font-semibold">Added</th>
              <th className="px-5 py-3 text-right font-semibold">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr
                key={u.id}
                className={`border-b border-steel-100 last:border-0 ${u.active ? '' : 'opacity-60'}`}
              >
                <td className="px-5 py-3">
                  <div className="font-semibold text-steel-900">
                    {u.name}
                    {u.id === me?.id && <span className="ml-2 text-xs text-steel-400">(you)</span>}
                  </div>
                  <div className="text-xs text-steel-500">{u.email}</div>
                </td>
                <td className="px-5 py-3">
                  <RoleChip role={u.role} />
                  {!u.active && (
                    <span className="ml-2 text-xs font-semibold text-working-red">Deactivated</span>
                  )}
                </td>
                <td className="num px-5 py-3 text-right text-steel-700">{documentCount(u)}</td>
                <td className="px-5 py-3 text-steel-500">
                  {format(new Date(u.createdAt), 'd MMM yyyy')}
                </td>
                <td className="whitespace-nowrap px-5 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => setForm({ ...u, password: '' })}
                      className="btn-secondary btn-sm"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => toggleActive(u)}
                      className="btn-secondary btn-sm"
                    >
                      {u.active ? 'Deactivate' : 'Reactivate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-steel-500">
        Staff are never deleted — documents reference them, so history stays intact. Deactivating
        blocks sign-in while keeping their name on past records.
      </p>
    </div>
  );
}

const FIELD =
  'w-full rounded-md border border-steel-200 bg-white px-3 py-2.5 text-sm focus:border-copper-500';

const ROLE_BLURB = {
  STAFF: 'Writes dockets and invoices. Cannot change prices, settings or staff.',
  ADMIN: 'Everything: prices, settings, staff, voiding and the audit trail.',
  CONTRACTOR: 'Field collections only. Cannot see purchases, sales, prices or reports.',
};

/** Everything this person has their name on. */
const documentCount = (u) =>
  (u._count?.docketsCreated ?? 0) +
  (u._count?.invoicesCreated ?? 0) +
  (u._count?.collectionsCreated ?? 0);

function RoleChip({ role }) {
  const tone =
    role === 'ADMIN'
      ? 'bg-copper-100 text-copper-700'
      : role === 'CONTRACTOR'
        ? 'bg-working-amberDim text-working-amber'
        : 'bg-steel-100 text-steel-600';
  const label = { ADMIN: 'Admin', CONTRACTOR: 'Contractor' }[role] ?? 'Staff';
  return (
    <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${tone}`}>{label}</span>
  );
}
