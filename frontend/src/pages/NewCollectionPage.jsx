import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { apiErrorMessage } from '../lib/apiError';
import MaterialField from '../components/MaterialField';

const BLANK_LINE = {
  // Carried on an existing line so an edit updates the row rather than
  // replacing it — the line's identity is what a photo will hang off.
  id: null,
  materialId: '',
  description: '',
  grossWeight: '',
  tareWeight: '',
  supplierGrossWeight: '',
  supplierTareWeight: '',
};
// A name, and a suburb if they give one. Phone and street address were here
// and are not: a contractor is standing in a driveway with a load to weigh,
// and a field nobody fills in is a field that only slows the form down. The
// API still accepts both, so an admin can add them to a record later.
const BLANK_SELLER = { name: '', suburb: '' };

const round3 = (n) => Math.round((n + Number.EPSILON) * 1000) / 1000;

/** net = gross − tare, to three decimals, never below zero. */
function net(gross, tare) {
  const g = parseFloat(gross);
  if (!Number.isFinite(g)) return null;
  return Math.max(0, round3(g - (parseFloat(tare) || 0)));
}

const ourNet = (l) => net(l.grossWeight, l.tareWeight);
const theirNet = (l) => net(l.supplierGrossWeight, l.supplierTareWeight);

/**
 * Ours minus theirs.
 *
 * That direction on purpose: a negative number means the supplier's scales
 * said more than ours did, which is the direction that costs the yard money.
 * Null when either side has not been weighed — there is nothing to compare,
 * and showing the whole of our net as a "difference" would be a lie.
 */
function difference(l) {
  const a = ourNet(l);
  const b = theirNet(l);
  if (a === null || b === null) return null;
  return round3(a - b);
}

/**
 * The contractor's screen.
 *
 * Everything a purchase docket asks for that cannot be answered honestly in
 * somebody's driveway is absent: no driver licence, no ABN, no sale type, no
 * bank details, no vehicle, no PAYG statement, and no price. What is left is
 * who it came from and what it weighed, which is all this record claims to be.
 *
 * Built to be used one-handed on a tablet, outdoors, next to a ute.
 */
export default function NewCollectionPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [sellerQuery, setSellerQuery] = useState('');
  const [sellerResults, setSellerResults] = useState([]);
  const [selectedSeller, setSelectedSeller] = useState(null);
  const [isNewSeller, setIsNewSeller] = useState(false);
  const [newSeller, setNewSeller] = useState(BLANK_SELLER);

  const [materials, setMaterials] = useState([]);
  const [lines, setLines] = useState([{ ...BLANK_LINE }, { ...BLANK_LINE }, { ...BLANK_LINE }]);
  const [notes, setNotes] = useState('');
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(isEdit);
  const skipSearch = useRef(false);

  // The grade list, without the price list — see GET /collections/materials.
  useEffect(() => {
    api
      .get('/collections/materials')
      .then((res) => setMaterials(res.data.materials))
      .catch(() => setError('Could not load the list of grades.'));
  }, []);

  useEffect(() => {
    if (!isEdit) return;
    setLoading(true);
    api
      .get(`/collections/${id}`)
      .then((res) => {
        const c = res.data.collection;
        skipSearch.current = true;
        setSelectedSeller(c.localSupplier);
        setSellerQuery(c.localSupplier.name);
        setNotes(c.notes || '');
        setExpectedUpdatedAt(c.updatedAt);
        setLines(
          c.lines.map((l) => ({
            id: l.id,
            materialId: l.materialId || '',
            description: l.description || '',
            grossWeight: String(l.grossWeight),
            tareWeight: String(l.tareWeight),
            supplierGrossWeight:
              l.supplierGrossWeight == null ? '' : String(l.supplierGrossWeight),
            supplierTareWeight:
              l.supplierTareWeight == null ? '' : String(l.supplierTareWeight),
          }))
        );
      })
      .catch(() => setError('Could not load that collection.'))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  useEffect(() => {
    if (skipSearch.current) {
      skipSearch.current = false;
      return undefined;
    }
    if (!sellerQuery || selectedSeller) {
      setSellerResults([]);
      return undefined;
    }
    const t = setTimeout(() => {
      api
        .get('/local-suppliers', { params: { search: sellerQuery } })
        .then((res) => setSellerResults(res.data.localSuppliers))
        .catch(() => setSellerResults([]));
    }, 250);
    return () => clearTimeout(t);
  }, [sellerQuery, selectedSeller]);

  const totals = useMemo(() => {
    let ours = 0;
    // Our net counted again over only the lines they also weighed. Comparing
    // our whole total against a supplier total that is missing half its lines
    // would report a difference that is really just the gaps — which is the
    // one number on this screen nobody could sanity-check by eye.
    let oursCompared = 0;
    let theirs = 0;
    let compared = 0;
    for (const l of lines) {
      const mine = ourNet(l) ?? 0;
      ours += mine;
      if (difference(l) !== null) {
        oursCompared += mine;
        theirs += theirNet(l);
        compared += 1;
      }
    }
    return {
      ours: round3(ours),
      difference: compared ? round3(oursCompared - theirs) : null,
      compared,
    };
  }, [lines]);
  const filledLines = lines.filter((l) => (l.materialId || l.description.trim()) && l.grossWeight);

  function updateLine(i, field, value) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, [field]: value } : l)));
  }

  function selectSeller(s) {
    setSelectedSeller(s);
    setSellerQuery(s.name);
    setSellerResults([]);
    setIsNewSeller(false);
  }

  function startNewSeller() {
    setSelectedSeller(null);
    setIsNewSeller(true);
    setNewSeller({ ...BLANK_SELLER, name: sellerQuery });
    setSellerResults([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (filledLines.length === 0) {
      setError('Add at least one grade with a weight.');
      return;
    }
    const overTare = filledLines.find(
      (l) => (parseFloat(l.tareWeight) || 0) > parseFloat(l.grossWeight)
    );
    if (overTare) {
      setError('A tare weight is heavier than its gross weight. Check the weights.');
      return;
    }

    setSubmitting(true);
    try {
      let localSupplierId = selectedSeller?.id;

      if (!localSupplierId) {
        const name = (isNewSeller ? newSeller.name : sellerQuery).trim();
        if (!name) {
          setError('Who did this come from?');
          setSubmitting(false);
          return;
        }
        const created = await api.post('/local-suppliers', {
          ...(isNewSeller ? newSeller : {}),
          name,
        });
        localSupplierId = created.data.localSupplier.id;
      }

      const payload = {
        localSupplierId,
        notes: notes.trim() || null,
        lines: filledLines.map((l) => ({
          ...(l.id ? { id: l.id } : {}),
          materialId: l.materialId || null,
          description: l.materialId ? null : l.description.trim(),
          grossWeight: parseFloat(l.grossWeight),
          tareWeight: parseFloat(l.tareWeight) || 0,
          // Left out entirely rather than sent as zero: a seller who did not
          // weigh is not a seller who weighed nothing.
          supplierGrossWeight:
            l.supplierGrossWeight === '' ? null : parseFloat(l.supplierGrossWeight),
          supplierTareWeight:
            l.supplierGrossWeight === '' ? null : parseFloat(l.supplierTareWeight) || 0,
        })),
        ...(isEdit && expectedUpdatedAt ? { expectedUpdatedAt } : {}),
      };

      const res = isEdit
        ? await api.patch(`/collections/${id}`, payload)
        : await api.post('/collections', payload);
      navigate(`/collections/${res.data.collection.id}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save this collection.'));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <div className="px-4 py-6 text-sm text-steel-500 sm:px-6 lg:px-8">Loading…</div>;
  }

  return (
    <div className="docket-form mx-auto max-w-5xl px-4 py-3 pb-24 sm:px-6 lg:px-8 lg:py-5 lg:pb-20">
      <form onSubmit={handleSubmit}>
        <div className="surface overflow-hidden">
          <div className="flex flex-col gap-3 bg-steel-900 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <h1 className="font-display text-base font-semibold text-paper">
                {isEdit ? 'Edit collection' : 'New collection'}
              </h1>
              <div className="text-xs text-steel-400">
                {isEdit ? 'Your change is recorded' : 'Weights only — no price is set here'}
              </div>
            </div>
          </div>

          {error && (
            <div className="border-b border-working-red/20 bg-working-redDim px-6 py-3 text-sm text-working-red">
              {error}
            </div>
          )}

          {/* ── Who it came from ─────────────────────────────────────── */}
          <div className="border-b border-steel-100 px-6 py-5">
            <label className="field-label" htmlFor="collection-seller">
              Collected from
            </label>
            <div className="relative">
              <input
                id="collection-seller"
                type="text"
                value={sellerQuery}
                onChange={(e) => {
                  setSellerQuery(e.target.value);
                  setSelectedSeller(null);
                  setIsNewSeller(false);
                }}
                placeholder="Search a name, or type a new one…"
                className="w-full rounded-md border border-steel-200 bg-paper px-3 py-2.5 text-sm focus:border-copper-500 focus:bg-white"
              />
              {/* Shown whenever something has been typed and nobody is picked
                  yet — not only when there are matches. Gating it on matches
                  meant a genuinely new name offered no way to add a suburb or
                  a phone number, which is exactly the case where those details
                  have to be captured, because the record does not exist yet. */}
              {sellerQuery.trim() && !selectedSeller && !isNewSeller && (
                <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-steel-200 bg-white shadow-lg">
                  {sellerResults.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => selectSeller(s)}
                        className="block w-full px-3 py-2.5 text-left text-sm hover:bg-paper"
                      >
                        <span className="font-semibold text-steel-900">{s.name}</span>
                        {s.suburb && <span className="text-steel-500"> — {s.suburb}</span>}
                        {s._count?.collections > 0 && (
                          <span className="text-steel-400">
                            {' '}
                            · {s._count.collections} previous
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                  <li className={sellerResults.length ? 'border-t border-steel-100' : ''}>
                    <button
                      type="button"
                      onClick={startNewSeller}
                      className="block w-full px-3 py-2.5 text-left text-sm font-semibold text-copper-600 hover:bg-paper"
                    >
                      + Add &quot;{sellerQuery.trim()}&quot; as a new local supplier
                    </button>
                  </li>
                </ul>
              )}
            </div>

            {/* Only asked for on somebody genuinely new, and only what can
                actually be answered standing in a yard. */}
            {isNewSeller && (
              <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-steel-100 bg-paper p-4">
                <div className="sm:col-span-2">
                  <label className="field-label" htmlFor="ls-name">
                    Name
                  </label>
                  <input
                    id="ls-name"
                    value={newSeller.name}
                    onChange={(e) => setNewSeller({ ...newSeller, name: e.target.value })}
                    className="w-full rounded-md border border-steel-200 px-3 py-2 text-sm"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="field-label" htmlFor="ls-suburb">
                    Suburb <span className="field-hint">optional</span>
                  </label>
                  <input
                    id="ls-suburb"
                    value={newSeller.suburb}
                    onChange={(e) => setNewSeller({ ...newSeller, suburb: e.target.value })}
                    placeholder="Riverstone"
                    className="w-full rounded-md border border-steel-200 px-3 py-2 text-sm"
                  />
                </div>
              </div>
            )}

            {selectedSeller && (
              <div className="mt-2 text-xs text-steel-500">
                {[selectedSeller.suburb, selectedSeller.phone].filter(Boolean).join(' · ') ||
                  'No other details on file'}
              </div>
            )}
          </div>

          {/* ── What was weighed ─────────────────────────────────────── */}
          <div className="px-6 py-5">
            <div className="field-legend">What was collected</div>

            {/* Column headings on a wide screen; each field labels itself on a
                narrow one, where a header row would scroll away from its
                inputs. */}
            {/* A card per grade at every width, not a table row.
                Seven figures now live on a line — our gross, tare and net,
                theirs, and the difference — and no row holds seven numbers
                legibly on a phone or a tablet. Two labelled columns, Ours and
                Theirs, is also how the comparison is actually read aloud. */}
            <div className="space-y-4">
              {lines.map((line, i) => {
                const mine = ourNet(line);
                const yours = theirNet(line);
                const diff = difference(line);
                const ourTareBad =
                  mine !== null && (parseFloat(line.tareWeight) || 0) > parseFloat(line.grossWeight);
                const theirTareBad =
                  yours !== null &&
                  (parseFloat(line.supplierTareWeight) || 0) > parseFloat(line.supplierGrossWeight);

                return (
                  <div
                    key={line.id ?? i}
                    className="rounded-xl border border-steel-200 bg-white p-3 shadow-sm sm:p-4"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-steel-400">
                        Grade {i + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={lines.length <= 1}
                        aria-label={`Remove grade ${i + 1}`}
                        className="btn-ghost btn-icon btn-sm -mr-1 text-steel-400 hover:bg-working-redDim hover:text-working-red"
                      >
                        ×
                      </button>
                    </div>

                    <MaterialField
                      materials={materials}
                      value={line.materialId}
                      description={line.description}
                      onSelect={({ materialId, description }) =>
                        setLines((prev) =>
                          prev.map((l, idx) => (idx === i ? { ...l, materialId, description } : l))
                        )
                      }
                    />

                    {/* Row label, ours, theirs. The label column is what lets
                        two sets of weights sit side by side without repeating
                        "gross" and "tare" four times. */}
                    <div className="mt-3 grid grid-cols-[3.2rem_1fr_1fr] items-center gap-x-2 gap-y-2 sm:grid-cols-[4.5rem_1fr_1fr] sm:gap-x-3">
                      <div />
                      <div className="text-center text-[11px] font-bold uppercase tracking-wider text-steel-500">
                        Ours
                      </div>
                      <div className="text-center text-[11px] font-bold uppercase tracking-wider text-steel-400">
                        Theirs
                      </div>

                      <label className="text-xs font-semibold text-steel-600" htmlFor={`g-${i}`}>
                        Gross
                      </label>
                      <input
                        id={`g-${i}`}
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        min="0"
                        value={line.grossWeight}
                        onChange={(e) => updateLine(i, 'grossWeight', e.target.value)}
                        placeholder="kg"
                        aria-label={`Our gross weight, grade ${i + 1}`}
                        className="num w-full rounded-md border border-steel-200 bg-white px-2 py-2 text-right text-sm"
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        min="0"
                        value={line.supplierGrossWeight}
                        onChange={(e) => updateLine(i, 'supplierGrossWeight', e.target.value)}
                        placeholder="kg"
                        aria-label={`Their gross weight, grade ${i + 1}`}
                        className="num w-full rounded-md border border-steel-200 bg-paper px-2 py-2 text-right text-sm"
                      />

                      <label className="text-xs font-semibold text-steel-600" htmlFor={`t-${i}`}>
                        Tare
                      </label>
                      <input
                        id={`t-${i}`}
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        min="0"
                        value={line.tareWeight}
                        onChange={(e) => updateLine(i, 'tareWeight', e.target.value)}
                        placeholder="kg"
                        aria-label={`Our tare weight, grade ${i + 1}`}
                        className={`num w-full rounded-md border bg-white px-2 py-2 text-right text-sm ${
                          ourTareBad ? 'border-working-red' : 'border-steel-200'
                        }`}
                      />
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.001"
                        min="0"
                        value={line.supplierTareWeight}
                        onChange={(e) => updateLine(i, 'supplierTareWeight', e.target.value)}
                        placeholder="kg"
                        aria-label={`Their tare weight, grade ${i + 1}`}
                        className={`num w-full rounded-md border bg-paper px-2 py-2 text-right text-sm ${
                          theirTareBad ? 'border-working-red' : 'border-steel-200'
                        }`}
                      />

                      <div className="text-xs font-semibold text-steel-600">Net</div>
                      <div className="num rounded-md bg-steel-100 px-2 py-2 text-right text-sm font-bold text-steel-900">
                        {mine === null ? '—' : formatNumber(mine, 3)}
                      </div>
                      <div className="num rounded-md bg-paper px-2 py-2 text-right text-sm font-bold text-steel-700">
                        {yours === null ? '—' : formatNumber(yours, 3)}
                      </div>
                    </div>

                    {/* Ours minus theirs, stated plainly. No threshold and no
                        colour: what counts as a real discrepancy is a judgement
                        about this seller and this load, and a number that turns
                        amber on its own would be making that call for you. */}
                    <div className="mt-2 flex items-baseline justify-between border-t border-steel-100 pt-2">
                      <span className="text-xs font-semibold text-steel-600">Difference</span>
                      <span className="num text-sm font-bold text-steel-900">
                        {diff === null ? (
                          <span className="text-xs font-medium text-steel-400">
                            they did not weigh
                          </span>
                        ) : (
                          `${diff > 0 ? '+' : ''}${formatNumber(diff, 3)} kg`
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setLines((prev) => [...prev, { ...BLANK_LINE }])}
              className="mt-3 text-sm font-semibold text-copper-600 hover:text-copper-700"
            >
              + Add another grade
            </button>

            <div className="mt-5">
              <label className="field-label" htmlFor="collection-notes">
                Notes <span className="field-hint">optional</span>
              </label>
              <textarea
                id="collection-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Anything the yard should know — where it was, what it looked like…"
                className="w-full rounded-md border border-steel-200 bg-white px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div
          className="pad-safe-bar fixed bottom-0 right-0 z-20 border-t border-steel-200 bg-white/95 px-4 pt-2 backdrop-blur supports-[backdrop-filter]:bg-white/85 sm:px-6 print:hidden"
          style={{ left: 'var(--app-sidebar-w, 0px)' }}
        >
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            {/* Our total, and the running difference beside it. The bar is
                the only thing on screen the whole time the form is open, so
                the comparison belongs here rather than only at the bottom of
                a long list of grades. */}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span className="num text-lg font-bold leading-none text-steel-900">
                {formatNumber(totals.ours, 3)} kg
              </span>
              <span className="truncate text-xs font-medium text-steel-500">
                net over {filledLines.length} {filledLines.length === 1 ? 'grade' : 'grades'}
              </span>
              {totals.difference !== null && (
                <span className="num w-full text-xs font-semibold text-steel-600 sm:w-auto">
                  {totals.difference > 0 ? '+' : ''}
                  {formatNumber(totals.difference, 3)} kg vs theirs
                  {totals.compared < filledLines.length && (
                    <span className="font-medium text-steel-400">
                      {' '}
                      ({totals.compared} of {filledLines.length})
                    </span>
                  )}
                </span>
              )}
            </div>
            <div className="btn-row flex-nowrap justify-stretch sm:justify-end">
              <button
                type="button"
                onClick={() => navigate('/collections')}
                className="btn-secondary flex-1 sm:flex-none"
              >
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary flex-1 sm:flex-none">
                {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save collection'}
              </button>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
}
