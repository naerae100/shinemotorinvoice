import { useEffect, useState } from 'react';
import { api, uploadSettingsImage } from '../lib/api';
import { getSettings, setCachedSettings } from '../lib/settings';

const FIELD_GROUPS = [
  {
    title: 'Company details',
    fields: [
      ['companyName', 'Company name'],
      ['abn', 'ABN'],
      ['acn', 'ACN'],
      ['address', 'Address'],
      ['phone', 'Phone'],
      ['mobile', 'Mobile'],
      ['email', 'Email'],
      ['website', 'Website'],
    ],
  },
];

/**
 * One account per currency, because that is how the money actually arrives.
 *
 * An AUD invoice has to print the Ingleburn account and a USD invoice the
 * Parramatta one; printing the wrong set sends an international wire to an
 * account that cannot receive it. The invoice already picks the right one and
 * snapshots it at issue, so a later edit here cannot rewrite an invoice the
 * buyer has already been sent.
 *
 * These live in their own table and their own endpoint. The single bank block
 * that used to sit on this page wrote to CompanySettings, which nothing reads —
 * editing it changed no invoice at all.
 */
const BANK_FIELDS = [
  ['beneficiary', 'Beneficiary name'],
  ['bankName', 'Bank name'],
  ['bsb', 'BSB'],
  ['accountNo', 'Account number'],
  ['swift', 'SWIFT'],
  ['bankAddress', 'Bank address'],
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [xeroStatus, setXeroStatus] = useState(null);
  const [bankAccounts, setBankAccounts] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings().then(setSettings);
    api
      .get('/settings/bank-accounts')
      .then((res) => setBankAccounts(res.data.bankAccounts))
      .catch(() => setBankAccounts([]));
    api.get('/xero/status').then((res) => setXeroStatus(res.data)).catch(() => {});
    
    // Check if we just returned from Xero oauth
    if (window.location.search.includes('xero=success')) {
      window.history.replaceState({}, '', '/settings');
      setSaved(true);
    }
  }, []);

  function update(field, value) {
    setSettings((s) => ({ ...s, [field]: value }));
    setSaved(false);
  }

  function updateBank(currency, field, value) {
    setBankAccounts((rows) =>
      rows.map((r) => (r.currency === currency ? { ...r, [field]: value } : r))
    );
    setSaved(false);
  }

  async function handleSave() {
    setSaving(true);
    setError('');
    try {
      // logoUrl and stampUrl are base64 data URIs owned by the upload endpoint.
      // Sending them back here pushed the JSON body past the 2 MB limit and the
      // save failed with a bare "Internal server error".
      const { id, logoUrl, stampUrl, ...editable } = settings;
      const res = await api.patch('/settings', editable);
      setCachedSettings(res.data.settings);

      // Each account is its own record, so each is its own request.
      await Promise.all(
        (bankAccounts ?? []).map(({ currency, ...account }) =>
          api.put(`/settings/bank-accounts/${currency}`, {
            beneficiary: account.beneficiary || null,
            bankName: account.bankName || null,
            bsb: account.bsb || null,
            accountNo: account.accountNo || null,
            swift: account.swift || null,
            bankAddress: account.bankAddress || null,
          })
        )
      );
      setSaved(true);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpload(type, file) {
    if (!file) return;
    try {
      const data = await uploadSettingsImage(type, file);
      setSettings(data.settings);
      setCachedSettings(data.settings);
    } catch (err) {
      setError(err.response?.data?.error || 'Could not upload that image.');
    }
  }

  if (!settings) return <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 text-sm text-steel-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="mb-1 font-display text-2xl font-semibold text-steel-900">Settings</h1>
      <p className="mb-6 text-sm text-steel-500">
        Company info, logo, stamp, and bank details used on printed dockets and invoices.
      </p>

      <div className="mb-6 rounded-xl border border-steel-200 bg-white p-5 shadow-ticket">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-steel-600">
          Logo & stamp
        </h2>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Logo Upload */}
          <div>
            <label className="mb-2 block text-xs font-medium text-steel-500">Company Logo</label>
            <div className="flex flex-col items-start gap-3">
              {settings.logoUrl ? (
                <img src={settings.logoUrl} alt="Logo" className="h-16 rounded border bg-paper object-contain p-1" />
              ) : (
                <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed bg-paper text-xs text-steel-400">No Logo</div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleUpload('logo', e.target.files[0])}
                className="text-xs"
              />
            </div>
          </div>

          {/* Stamp Upload */}
          <div>
            <label className="mb-2 block text-xs font-medium text-steel-500">Official Stamp</label>
            <div className="flex flex-col items-start gap-3">
              {settings.stampUrl ? (
                <img src={settings.stampUrl} alt="Stamp" className="h-16 rounded border bg-paper object-contain p-1" />
              ) : (
                <div className="flex h-16 w-32 items-center justify-center rounded border border-dashed bg-paper text-xs text-steel-400">No Stamp</div>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(e) => handleUpload('stamp', e.target.files[0])}
                className="text-xs"
              />
            </div>
          </div>
        </div>
      </div>

      {FIELD_GROUPS.map((group) => (
        <div key={group.title} className="mb-6 rounded-xl border border-steel-200 bg-white p-5 shadow-ticket">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-steel-600">
            {group.title}
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.fields.map(([key, label]) => (
              <div key={key}>
                <label className="mb-1 block text-xs font-medium text-steel-500">{label}</label>
                <input
                  value={settings[key] || ''}
                  onChange={(e) => update(key, e.target.value)}
                  className="w-full rounded-md border border-steel-200 px-3 py-2 text-sm focus:border-copper-500"
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="mb-6 rounded-xl border border-steel-200 bg-white p-5 shadow-ticket">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-steel-600">
          Bank accounts for sales invoices
        </h2>
        <p className="mb-4 mt-0.5 text-sm text-steel-500">
          An invoice prints the account matching its own currency, and keeps a copy of
          it as issued — changing an account here never alters an invoice already sent.
        </p>
        {bankAccounts === null ? (
          <div className="text-sm text-steel-500">Loading…</div>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {bankAccounts.map((acct) => (
              <div key={acct.currency} className="rounded-lg border border-steel-200 bg-paper/50 p-4">
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="num rounded-md bg-steel-900 px-2 py-1 text-xs font-bold text-white">
                    {acct.currency}
                  </span>
                  <span className="text-sm font-medium text-steel-600">
                    paid into this account
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {BANK_FIELDS.map(([key, label]) => (
                    <div key={key} className={key === 'bankAddress' || key === 'beneficiary' ? 'sm:col-span-2' : ''}>
                      <label className="mb-1 block text-xs font-medium text-steel-500">{label}</label>
                      <input
                        value={acct[key] || ''}
                        onChange={(e) => updateBank(acct.currency, key, e.target.value)}
                        className={`w-full rounded-md border border-steel-200 px-3 py-2 text-sm focus:border-copper-500 ${
                          ['bsb', 'accountNo', 'swift'].includes(key) ? 'num' : ''
                        }`}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mb-6 rounded-xl border border-steel-200 bg-white p-5 shadow-ticket">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-steel-600">
          Integrations
        </h2>
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="text-sm font-medium text-steel-900">Xero Accounting</div>
            <div className="text-sm text-steel-500">
              Automatically sync purchases as Draft Bills and sales as Draft Invoices.
            </div>
            {xeroStatus?.connected && (
              <div className="mt-1 text-xs font-medium text-working-green">
                ✓ Connected (Tenant ID: {xeroStatus.tenantId})
              </div>
            )}
          </div>
          <a
            href={`${import.meta.env.VITE_API_URL || '/api'}/xero/connect`}
            className="rounded-md border border-steel-300 bg-white px-4 py-2 text-sm font-semibold text-steel-700 shadow-sm hover:bg-paper"
          >
            {xeroStatus?.connected ? 'Reconnect Xero' : 'Connect to Xero'}
          </a>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-copper-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-copper-400 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="text-sm text-working-green">Saved.</span>}
        {error && <span className="text-sm text-working-red">{error}</span>}
      </div>
    </div>
  );
}
