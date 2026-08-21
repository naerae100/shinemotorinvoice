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
  {
    title: 'Bank details (for export invoices)',
    fields: [
      ['bankName', 'Bank name'],
      ['bankSwift', 'SWIFT'],
      ['bankAccountNo', 'Account number'],
      ['bankBsb', 'BSB'],
      ['bankAddress', 'Bank address'],
      ['beneficiary', 'Beneficiary name'],
    ],
  },
];

export default function SettingsPage() {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings().then(setSettings);
  }, []);

  function update(field, value) {
    setSettings((s) => ({ ...s, [field]: value }));
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

  if (!settings) return <div className="px-8 py-8 text-sm text-steel-500">Loading…</div>;

  return (
    <div className="mx-auto max-w-2xl px-8 py-8">
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
          <div className="grid grid-cols-2 gap-3">
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

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-md bg-copper-500 px-5 py-2.5 text-sm font-semibold text-steel-950 hover:bg-copper-400 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
        {saved && <span className="text-sm text-working-green">Saved.</span>}
        {error && <span className="text-sm text-working-red">{error}</span>}
      </div>
    </div>
  );
}
