import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import SessionList from '../components/SessionList';
import ConfirmDialog from '../components/ConfirmDialog';

/**
 * Your own account: who you are signed in as, and on what.
 *
 * It exists mostly for the second half. Admins can see anyone's devices from
 * Staff & logins, but a contractor cannot open that page at all — and the
 * contractor is the one carrying a phone around driveways, so they are the
 * person most likely to notice a device they do not recognise. Detection is
 * worth more than the ability to act on it, and it only works if the list is
 * somewhere they can reach without asking anybody.
 */
export default function AccountPage() {
  const { user, logout } = useAuth();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const ROLE = { ADMIN: 'Administrator', CONTRACTOR: 'Field contractor' };

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <header className="mb-6">
        <h1 className="font-display text-[28px] font-semibold leading-tight text-steel-900">
          Your account
        </h1>
        <p className="mt-1 text-sm text-steel-500">
          Signed in as <span className="font-semibold text-steel-700">{user?.email}</span> ·{' '}
          {ROLE[user?.role] ?? 'Staff'}
        </p>
      </header>

      <h2 className="section-label">Devices signed in</h2>
      <div className="surface p-4">
        <SessionList basePath="/auth/sessions" emptyHint="No other devices." />
        <p className="mt-3 text-xs leading-relaxed text-steel-500">
          A sign-in lasts fourteen days on a device that keeps being used. If you lose a phone
          or see something here you do not recognise, sign it out — it stops working within
          about half a minute, and your other devices are untouched.
        </p>
      </div>

      <h2 className="section-label mt-8">Lost a device, or think someone has your password?</h2>
      <div className="surface p-4">
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="btn-secondary btn-sm"
        >
          Sign out everywhere
        </button>
        <p className="mt-2 text-xs leading-relaxed text-steel-500">
          Ends every session including this one, on every device, immediately. Use it when you
          do not know which device is the problem. You will need to sign in again.
        </p>
      </div>

      {confirming && (
        <ConfirmDialog
          open
          title="Sign out of everywhere?"
          body="Every device signed in as you will stop working immediately, including this one."
          confirmLabel="Sign out everywhere"
          busy={busy}
          onCancel={() => setConfirming(false)}
          onConfirm={async () => {
            setBusy(true);
            try {
              await api.post('/auth/sign-out-everywhere');
            } finally {
              // Whether or not the call succeeded, this device should stop
              // holding a token it may no longer be able to use.
              logout();
            }
          }}
        />
      )}
    </div>
  );
}
