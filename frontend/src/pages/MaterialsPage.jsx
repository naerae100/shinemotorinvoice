import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { formatAud } from '../lib/format';
import ComboField from '../components/ComboField';
import ConfirmDialog from '../components/ConfirmDialog';
import ExportButton from '../components/ExportButton';

const UNITS = [
  { value: 'KG', label: 'per kg' },
  { value: 'TONNE', label: 'per tonne' },
  { value: 'UNIT', label: 'per unit' },
];

const BLANK = { code: '', description: '', category: '', unit: 'KG', currentPrice: '' };

/**
 * Two catalogues, not one list.
 *
 * The yard buys under one set of names and sells under another — the same metal
 * is paid for as "Copper Bright Wire" and shipped as "Mill Berry". Showing them
 * together would be 54 rows in two vocabularies with nothing to say which is
 * which, and an operator could price a docket off a grade that only exists on
 * an export invoice.
 */
const KINDS = {
  PURCHASE: {
    label: 'Buying',
    title: 'Materials & pricing',
    adminBlurb: 'Update rates as the market moves. Changes apply to new dockets immediately.',
    staffBlurb: 'Current buy rates. Contact an admin to update pricing.',
    addLabel: '+ Add material',
    exportLabel: 'Export price list',
    empty: 'No materials match.',
    // Bought by the kilo off a standing price list.
    defaultUnit: 'KG',
    showPrice: true,
  },
  EXPORT: {
    label: 'Export grades',
    title: 'Export grades',
    adminBlurb:
      'The trade grades the yard sells under, as named on packing lists and commercial invoices. Priced per contract, so no standing rate is held here.',
    staffBlurb: 'The trade grades the yard sells under on export documents.',
    addLabel: '+ Add grade',
    exportLabel: 'Export grade list',
    empty: 'No grades match.',
    defaultUnit: 'TONNE',
    showPrice: false,
  },
};

export default function MaterialsPage() {
  const { isAdmin } = useAuth();
  const [kind, setKind] = useState('PURCHASE');
  const cfg = KINDS[kind];
  const [materials, setMaterials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [editingPriceId, setEditingPriceId] = useState(null);
  const [draftPrice, setDraftPrice] = useState('');
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(
    () =>
      api
        .get('/materials', { params: { includeInactive: true, kind } })
        .then((res) => setMaterials(res.data.materials))
        .catch(() => setError('Could not load materials.'))
        .finally(() => setLoading(false)),
    [kind]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Categories are free text on each material, so the list of existing ones is
  // simply what is already in use — which is what the picker offers.
  const categories = useMemo(
    () => [...new Set(materials.map((m) => m.category).filter(Boolean))].sort(),
    [materials]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return materials
      .filter((m) => (showInactive ? true : m.active))
      .filter(
        (m) =>
          !q ||
          m.description.toLowerCase().includes(q) ||
          String(m.code ?? '').includes(q) ||
          (m.category || '').toLowerCase().includes(q)
      );
  }, [materials, search, showInactive]);

  const grouped = useMemo(() => {
    const out = {};
    for (const m of visible) {
      const cat = m.category || 'Uncategorised';
      (out[cat] ||= []).push(m);
    }
    return Object.entries(out).sort(([a], [b]) => a.localeCompare(b));
  }, [visible]);

  async function savePrice(id) {
    setSaving(true);
    try {
      await api.patch(`/materials/${id}`, { currentPrice: parseFloat(draftPrice) || 0 });
      setEditingPriceId(null);
      await load();
    } catch {
      setError('Could not update that price.');
    } finally {
      setSaving(false);
    }
  }

  async function saveMaterial(e) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = {
        // A grade added while looking at a catalogue belongs to that catalogue.
        kind,
        code: form.code === '' || form.code === null ? null : Number(form.code),
        description: form.description.trim(),
        category: form.category?.trim() || null,
        unit: form.unit,
        currentPrice: parseFloat(form.currentPrice) || 0,
      };
      if (form.id) await api.patch(`/materials/${form.id}`, payload);
      else await api.post('/materials', payload);
      setForm(null);
      await load();
    } catch (err) {
      const e2 = err.response?.data?.error;
      setError(
        (typeof e2 === 'string' ? e2 : e2?.fieldErrors?.code?.[0]) || 'Could not save that material.'
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(m) {
    setError('');
    try {
      if (m.active) await api.delete(`/materials/${m.id}`);
      else await api.patch(`/materials/${m.id}`, { active: true });
      setConfirm(null);
      await load();
    } catch {
      setError('Could not change that material.');
    }
  }

  const field =
    'w-full rounded-lg border border-steel-200 bg-paper px-3 py-2 text-sm text-steel-900 placeholder:text-steel-400 focus:border-copper-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-copper-500/20';

  /**
   * The add/edit form, as markup rather than a component.
   *
   * It is CALLED — `{materialForm()}` — never rendered as `<MaterialForm />`.
   * A component declared inside a render gets a new function identity on every
   * render, so React treats it as a different component type and remounts the
   * whole subtree: the inputs were torn down and rebuilt on each keystroke, so
   * only the first character landed and focus fell back to the body. Calling it
   * inlines the elements into this component's own tree, which reconciles
   * normally and keeps focus.
   *
   * One definition, used both at the top (adding) and inline under a row
   * (editing), so the two cannot drift apart.
   */
  const materialForm = () => (
        <form
          onSubmit={saveMaterial}
          className="mb-5 rounded-xl border border-copper-300 bg-white p-5 shadow-ticket"
        >
          <h2 className="mb-4 font-display text-base font-semibold text-steel-900">
            {form.id ? `Edit ${form.description}` : 'New material'}
          </h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
            <div className="md:col-span-1">
              <label className="field-label">Code</label>
              <input
                type="number"
                value={form.code ?? ''}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="34"
                className={`num ${field}`}
              />
            </div>
            <div className="sm:col-span-2 md:col-span-2">
              <label className="field-label">Description</label>
              <input
                required
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Lead Wheel Weights"
                className={field}
              />
            </div>
            {/* Typing a new name here creates the category — there is no separate
                list to maintain, categories are simply what materials say they are. */}
            <ComboField
              label="Category"
              value={form.category}
              onChange={(v) => setForm({ ...form, category: v })}
              options={categories}
              placeholder="Pick or type a new one"
              className="md:col-span-1"
            />
            <div>
              <label className="field-label">Unit</label>
              <select
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className={field}
              >
                {UNITS.map((u) => (
                  <option key={u.value} value={u.value}>
                    {u.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Rate (AUD)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.currentPrice}
                onChange={(e) => setForm({ ...form, currentPrice: e.target.value })}
                placeholder="0.00"
                className={`num ${field}`}
              />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="submit"
              disabled={saving}
              className="btn-primary"
            >
              {saving ? 'Saving…' : form.id ? 'Save changes' : 'Add material'}
            </button>
            <button
              type="button"
              onClick={() => setForm(null)}
              className="rounded-lg border border-steel-300 px-4 py-2 text-sm font-semibold text-steel-700 hover:bg-paper"
            >
              Cancel
            </button>
          </div>
        </form>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold text-steel-900">{cfg.title}</h1>
          <p className="mt-0.5 text-sm text-steel-500">
            {isAdmin ? cfg.adminBlurb : cfg.staffBlurb}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ExportButton
            endpoint="/materials/export"
            label={cfg.exportLabel}
            params={{ kind, ...(showInactive ? { includeInactive: 'true' } : {}) }}
          />
          {isAdmin && (
            <button
              onClick={() => setForm({ ...BLANK, unit: cfg.defaultUnit })}
              className="btn-primary"
            >
              {cfg.addLabel}
            </button>
          )}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Catalogue"
        className="mb-4 flex w-fit rounded-lg border border-steel-200 bg-white p-0.5"
      >
        {Object.entries(KINDS).map(([key, k]) => (
          <button
            key={key}
            role="tab"
            aria-selected={kind === key}
            onClick={() => {
              setKind(key);
              setForm(null);
              setSearch('');
            }}
            className={`rounded-md px-4 py-2 text-sm font-semibold transition ${
              kind === key ? 'bg-steel-900 text-paper' : 'text-steel-500 hover:text-steel-800'
            }`}
          >
            {k.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder={
            kind === 'EXPORT'
              ? 'Search grades or categories…'
              : 'Search materials, codes or categories…'
          }
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={`${field} max-w-sm flex-1 bg-white`}
        />
        <label className="flex cursor-pointer items-center gap-2 text-sm text-steel-600">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            className="h-4 w-4 accent-copper-500"
          />
          Show retired
        </label>
        <span className="num ml-auto text-xs text-steel-400">
          {visible.length} of {materials.length}
        </span>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-working-redDim px-4 py-3 text-sm text-working-red">
          {error}
        </div>
      )}

      {/* Adding something new has no row to sit under, so it opens here. An
          EDIT renders inline, in the list, directly beneath the row being
          edited — see MaterialRow. It used to open here too, which meant
          clicking Edit on a material near the bottom of 33 put the form two and
          a half thousand pixels above the viewport and looked like nothing had
          happened. */}
      {form && !form.id && materialForm()}

      {loading ? (
        <div className="py-12 text-center text-sm text-steel-500">Loading…</div>
      ) : grouped.length === 0 ? (
        <div className="rounded-xl border border-dashed border-steel-300 py-14 text-center">
          <p className="text-sm text-steel-500">{cfg.empty}</p>
        </div>
      ) : (
        <div className="space-y-5">
          {grouped.map(([category, items]) => (
            <div
              key={category}
              className="overflow-hidden rounded-xl border border-steel-200 bg-white shadow-ticket"
            >
              <div className="flex items-center justify-between border-b border-steel-100 bg-paper px-5 py-2.5">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-steel-600">
                  {category}
                </h2>
                <span className="num text-xs text-steel-400">{items.length}</span>
              </div>
              <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <tbody>
                  {items.map((m) => (
                    <Fragment key={m.id}>
                    <tr
                      className={`border-b border-steel-100 last:border-0 hover:bg-paper/60 ${
                        m.active ? '' : 'opacity-50'
                      } ${form?.id === m.id ? 'bg-copper-50' : ''}`}
                    >
                      <td className="w-12 py-2.5 pl-5 pr-2">
                        {m.code != null && (
                          <span className="num text-xs text-steel-400">{m.code}</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-2 text-steel-800">
                        {m.description}
                        {!m.active && (
                          <span className="ml-2 rounded bg-steel-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-steel-500">
                            Retired
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 pr-2 text-right text-xs uppercase tracking-wide text-steel-400">
                        {UNITS.find((u) => u.value === m.unit)?.label ?? m.unit}
                      </td>
                      <td className="w-32 py-2.5 pr-2 text-right">
                        {/* An export grade is priced per contract against the
                            market on the day, so it holds no standing rate. The
                            zero it stores is the absence of a price, and
                            printing it as "AUD 0.00" read as a grade worth
                            nothing rather than one priced elsewhere. */}
                        {!cfg.showPrice ? (
                          <span className="text-xs italic text-steel-400">Per contract</span>
                        ) : editingPriceId === m.id ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <input
                              type="number"
                              step="0.01"
                              autoFocus
                              value={draftPrice}
                              onChange={(e) => setDraftPrice(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') savePrice(m.id);
                                if (e.key === 'Escape') setEditingPriceId(null);
                              }}
                              className="num w-24 rounded-md border border-copper-400 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-copper-500/20"
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
                            onClick={() => {
                              if (!isAdmin) return;
                              setEditingPriceId(m.id);
                              setDraftPrice(String(m.currentPrice));
                            }}
                            disabled={!isAdmin}
                            title={isAdmin ? 'Click to edit the rate' : undefined}
                            className={`num rounded px-1.5 py-0.5 font-medium text-steel-900 ${
                              isAdmin ? 'hover:bg-copper-100 hover:text-copper-700' : ''
                            } ${Number(m.currentPrice) === 0 ? 'text-steel-400' : ''}`}
                          >
                            {formatAud(m.currentPrice)}
                          </button>
                        )}
                      </td>
                      {/* Action cell: wide enough for both buttons, and
                          whitespace-nowrap so they cannot wrap onto two lines as
                          they did in a 112px cell. Sized for a finger — this is
                          used on a tablet. */}
                      {isAdmin && (
                        <td className="w-44 whitespace-nowrap py-2.5 pr-5 text-right">
                          <div className="inline-flex gap-2">
                            <button
                              onClick={() =>
                                setForm(
                                  form?.id === m.id
                                    ? null
                                    : { ...m, currentPrice: String(m.currentPrice) }
                                )
                              }
                              className="min-h-[38px] rounded-md border border-steel-300 px-3 py-1.5 text-xs font-semibold text-steel-700 hover:bg-paper"
                            >
                              {form?.id === m.id ? 'Close' : 'Edit'}
                            </button>
                            <button
                              onClick={() =>
                                m.active
                                  ? setConfirm({
                                      material: m,
                                      title: `Retire ${m.description}?`,
                                      body: 'It disappears from new docket and invoice forms. Existing records keep it, and you can bring it back at any time — materials are never deleted, because dockets reference them.',
                                    })
                                  : toggleActive(m)
                              }
                              className="min-h-[38px] rounded-md border border-steel-300 px-3 py-1.5 text-xs font-semibold text-steel-700 hover:bg-paper"
                            >
                              {m.active ? 'Retire' : 'Restore'}
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>

                    {/* The form opens where the click happened. */}
                    {form?.id === m.id && (
                      <tr>
                        <td colSpan={isAdmin ? 5 : 4} className="border-b border-steel-100 bg-paper/60 p-0">
                          {materialForm()}
                        </td>
                      </tr>
                    )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm?.title}
        body={confirm?.body}
        confirmLabel="Retire material"
        tone="neutral"
        onCancel={() => setConfirm(null)}
        onConfirm={() => toggleActive(confirm.material)}
      />
    </div>
  );
}
