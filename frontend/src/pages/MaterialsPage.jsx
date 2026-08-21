import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

function formatCurrency(n) {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n || 0);
}

export default function MaterialsPage() {
  const { isAdmin } = useAuth();
  const [materials, setMaterials] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [draftPrice, setDraftPrice] = useState('');
  const [saving, setSaving] = useState(false);

  function load() {
    api.get('/materials').then((res) => setMaterials(res.data.materials));
  }

  useEffect(load, []);

  function startEdit(m) {
    setEditingId(m.id);
    setDraftPrice(String(m.currentPrice));
  }

  async function savePrice(id) {
    setSaving(true);
    try {
      await api.patch(`/materials/${id}`, { currentPrice: parseFloat(draftPrice) || 0 });
      setEditingId(null);
      load();
    } finally {
      setSaving(false);
    }
  }

  const grouped = materials.reduce((acc, m) => {
    const cat = m.category || 'Other';
    acc[cat] = acc[cat] || [];
    acc[cat].push(m);
    return acc;
  }, {});

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <div className="mb-1 flex items-center justify-between">
        <h1 className="font-display text-2xl font-semibold text-steel-900">Materials & pricing</h1>
      </div>
      <p className="mb-6 text-sm text-steel-500">
        {isAdmin
          ? 'Update rates here as the market moves. Changes apply to new dockets immediately.'
          : 'Current buy rates. Contact an admin to update pricing.'}
      </p>

      <div className="space-y-6">
        {Object.entries(grouped).map(([category, items]) => (
          <div key={category} className="overflow-hidden rounded-xl border border-steel-200 bg-white shadow-ticket">
            <div className="border-b border-steel-100 bg-paper px-5 py-3">
              <h2 className="text-sm font-semibold uppercase tracking-wider text-steel-600">
                {category}
              </h2>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-b border-steel-100 last:border-0">
                    <td className="px-5 py-3 text-steel-800">
                      {m.code && <span className="num mr-2 text-steel-400">{m.code}.</span>}
                      {m.description}
                    </td>
                    <td className="px-5 py-3 text-right text-xs uppercase tracking-wide text-steel-400">
                      per {m.unit.toLowerCase()}
                    </td>
                    <td className="w-32 px-5 py-3 text-right">
                      {editingId === m.id ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number"
                            step="0.01"
                            autoFocus
                            value={draftPrice}
                            onChange={(e) => setDraftPrice(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && savePrice(m.id)}
                            className="num w-20 rounded-md border border-copper-400 px-2 py-1 text-right text-sm"
                          />
                          <button
                            onClick={() => savePrice(m.id)}
                            disabled={saving}
                            className="text-xs font-semibold text-working-green"
                          >
                            Save
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => isAdmin && startEdit(m)}
                          disabled={!isAdmin}
                          className={`num font-medium ${
                            isAdmin ? 'text-steel-900 hover:text-copper-600' : 'text-steel-900'
                          }`}
                        >
                          {formatCurrency(m.currentPrice)}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
