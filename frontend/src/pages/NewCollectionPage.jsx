import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatNumber } from '../lib/format';
import { apiErrorMessage } from '../lib/apiError';
import MaterialField from '../components/MaterialField';

const BLANK_LINE = { materialId: '', description: '', grossWeight: '', tareWeight: '' };
// A name, and a suburb if they give one. Phone and street address were here
// and are not: a contractor is standing in a driveway with a load to weigh,
// and a field nobody fills in is a field that only slows the form down. The
// API still accepts both, so an admin can add them to a record later.
const BLANK_SELLER = { name: '', suburb: '' };

/** net = gross − tare, to three decimals, never below zero. */
function netOf(line) {
  const gross = parseFloat(line.grossWeight);
  const tare = parseFloat(line.tareWeight) || 0;
  if (!Number.isFinite(gross)) return null;
  return Math.max(0, Math.round((gross - tare + Number.EPSILON) * 1000) / 1000);
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
            materialId: l.materialId || '',
            description: l.description || '',
            grossWeight: String(l.grossWeight),
            tareWeight: String(l.tareWeight),
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

  const totalNet = useMemo(
    () => lines.reduce((a, l) => a + (netOf(l) ?? 0), 0),
    [lines]
  );
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
          materialId: l.materialId || null,
          description: l.materialId ? null : l.description.trim(),
          grossWeight: parseFloat(l.grossWeight),
          tareWeight: parseFloat(l.tareWeight) || 0,
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
            <div className="hidden gap-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-steel-500 sm:grid sm:grid-cols-[1fr_7rem_7rem_7rem_2rem]">
              <div>Grade</div>
              <div className="text-right">Gross kg</div>
              <div className="text-right">Tare kg</div>
              <div className="text-right">Net kg</div>
              <div />
            </div>

            <div className="space-y-4 sm:space-y-2">
              {lines.map((line, i) => {
                const net = netOf(line);
                const invalid =
                  net !== null && (parseFloat(line.tareWeight) || 0) > parseFloat(line.grossWeight);
                return (
                  <div
                    key={i}
                    /* On a phone this is one card per grade: the name across
                       the top, then gross / tare / net as a single row of
                       three underneath it. They read as one measurement of one
                       material, which is what they are — the earlier two-column
                       version split them so that net ended up beside nothing
                       and the remove button had a row to itself.

                       From sm up `sm:contents` dissolves the inner wrapper so
                       its three children become cells of the outer grid, and
                       the whole thing is the single table row it was before.
                       One piece of markup, both shapes. */
                    className="rounded-lg border border-steel-200 bg-white p-3 sm:grid sm:grid-cols-[1fr_7rem_7rem_7rem_2rem] sm:items-center sm:gap-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
                  >
                    <div className="mb-2 flex items-center justify-between sm:hidden">
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

                    <div>
                      <label className="field-label sm:hidden">Material</label>
                      {/* The same picker the weighbridge docket uses, so a
                          grade is named the same way in the field as it is at
                          the yard. It reports a price too, which is ignored
                          here — nothing on this screen has a price. */}
                      <MaterialField
                        materials={materials}
                        value={line.materialId}
                        description={line.description}
                        onSelect={({ materialId, description }) =>
                          setLines((prev) =>
                            prev.map((l, idx) =>
                              idx === i ? { ...l, materialId, description } : l
                            )
                          )
                        }
                      />
                    </div>

                    {/* Two inputs side by side, then net on its own line.
                        Three across did not fit: at 390px each column is 89px
                        and a realistic figure like "122,938.250" is about
                        106px of monospace, so gross, tare and net were all
                        being clipped — measured at 360, 390 and 412px. Net
                        gets the full width, which also puts the number that
                        matters where the eye lands last.

                        `sm:contents` on the pair dissolves the wrapper from
                        sm up, so gross, tare and net become three cells of the
                        outer grid and the row is the table row it was. */}
                    <div className="mt-3 grid grid-cols-2 gap-2 sm:contents">
                      <div>
                        <label className="field-label sm:hidden">Gross kg</label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.001"
                          min="0"
                          value={line.grossWeight}
                          onChange={(e) => updateLine(i, 'grossWeight', e.target.value)}
                          placeholder="Gross"
                          aria-label={`Gross weight, grade ${i + 1}`}
                          className="num w-full rounded-md border border-steel-200 bg-white px-2.5 py-2 text-right text-sm"
                        />
                      </div>

                      <div>
                        <label className="field-label sm:hidden">Tare kg</label>
                        <input
                          type="number"
                          inputMode="decimal"
                          step="0.001"
                          min="0"
                          value={line.tareWeight}
                          onChange={(e) => updateLine(i, 'tareWeight', e.target.value)}
                          placeholder="Tare"
                          aria-label={`Tare weight, grade ${i + 1}`}
                          className={`num w-full rounded-md border bg-white px-2.5 py-2 text-right text-sm ${
                            invalid ? 'border-working-red' : 'border-steel-200'
                          }`}
                        />
                      </div>
                    </div>

                    {/* Worked out, not typed. The contractor reads two numbers
                        off a scale; doing the subtraction on paper is where the
                        mistakes come from. */}
                    <div className="mt-2 flex items-center justify-between rounded-md bg-paper px-2.5 py-2 sm:mt-0 sm:block sm:rounded-none sm:bg-transparent">
                      <span className="text-[11px] font-bold uppercase tracking-wider text-steel-500 sm:hidden">
                        Net kg
                      </span>
                      <span
                        className={`num block text-right text-sm font-bold ${
                          invalid ? 'text-working-red' : 'text-steel-900'
                        }`}
                      >
                        {net === null ? '—' : formatNumber(net, 3)}
                      </span>
                    </div>

                    <div className="hidden justify-end sm:flex">
                      <button
                        type="button"
                        onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                        disabled={lines.length <= 1}
                        aria-label={`Remove grade ${i + 1}`}
                        className="btn-ghost btn-icon btn-sm text-steel-400 hover:bg-working-redDim hover:text-working-red"
                      >
                        ×
                      </button>
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
            <div className="flex min-w-0 items-baseline gap-2">
              <span className="num text-lg font-bold leading-none text-steel-900">
                {formatNumber(totalNet, 3)} kg
              </span>
              <span className="truncate text-xs font-medium text-steel-500">
                net over {filledLines.length} {filledLines.length === 1 ? 'grade' : 'grades'}
              </span>
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
