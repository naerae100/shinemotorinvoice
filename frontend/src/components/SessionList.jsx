import { useCallback, useEffect, useState } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import { api } from '../lib/api';
import { apiErrorMessage } from '../lib/apiError';

/**
 * The devices one person is currently signed in on.
 *
 * A session lasts fourteen days, which is right for a weighbridge tablet
 * somebody picks up every morning and wrong for a phone left in a driveway.
 * Shortening it for everyone taxes every sign-in to defend against a rare
 * event; this handles the rare event directly — see the device, end it.
 *
 * `basePath` is what makes this work for both readers: a person looking at
 * their own devices reads /auth/sessions, an admin looking at somebody
 * else's reads /users/:id/sessions. Same list, same component, two
 * permissions enforced at the API.
 */
export default function SessionList({ basePath, emptyHint = 'No devices signed in.' }) {
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(
    () =>
      api
        .get(basePath)
        .then((res) => {
          setSessions(res.data.sessions);
          setError('');
        })
        .catch(() => setError('Could not load the device list.')),
    [basePath]
  );

  useEffect(() => {
    load();
  }, [load]);

  async function signOut(session) {
    setBusy(session.id);
    setError('');
    try {
      await api.delete(`${basePath}/${session.id}`);
      // Signing out the device you are reading this on ends the session the
      // page is using, so there is nothing to reload — the next request will
      // bounce to the login screen, which is the correct outcome.
      if (!session.current) await load();
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not sign that device out.'));
    } finally {
      setBusy('');
    }
  }

  if (error) return <p className="text-xs text-working-red">{error}</p>;
  if (!sessions) return <p className="text-xs text-steel-400">Loading devices…</p>;
  if (sessions.length === 0) return <p className="text-xs text-steel-400">{emptyHint}</p>;

  return (
    <ul className="space-y-2">
      {sessions.map((s) => (
        <li
          key={s.id}
          className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-lg border border-steel-200 bg-white px-3 py-2.5"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-steel-900">{s.device}</span>
              {s.current && (
                <span className="rounded bg-working-greenDim px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-working-green">
                  This device
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-steel-500">
              {/* "Last used" is written at most every five minutes, so it is
                  accurate to about that — near enough to answer "is this
                  still in use", and one database write per request cheaper. */}
              Last used {formatDistanceToNow(new Date(s.lastSeenAt), { addSuffix: true })}
              {' · signed in '}
              {format(new Date(s.createdAt), 'd MMM')}
              {s.ip && ` · ${s.ip}`}
            </div>
          </div>

          <button
            type="button"
            onClick={() => signOut(s)}
            disabled={busy === s.id}
            className="btn-secondary btn-sm shrink-0"
          >
            {busy === s.id ? 'Signing out…' : s.current ? 'Sign out here' : 'Sign out'}
          </button>
        </li>
      ))}
    </ul>
  );
}
