import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { addressLines, formatMoney, formatNumber, round2 } from '../lib/format';
import DiscountField, { applyDiscount } from '../components/DiscountField';
import ComboField from '../components/ComboField';

// Suggestions, not restrictions — every one of these fields accepts free text.
// The four the yard actually trades on lead; the rest of the Incoterms follow
// for the occasional buyer who asks for one. The field stays free text either
// way — a contract sometimes words the term in a way no list would hold.
const SHIPPING_TERMS = ['FAS', 'FOB', 'CIF', 'CNF', 'CFR', 'EXW', 'DAP', 'DDP', 'CPT', 'CIP', 'FCA'];
// Written the way the packing list prints them — "1 x 20FT" is what appears on
// the document and what the buyer's paperwork quotes back.
const CONTAINER_TYPES = [
  '1 x 20FT', '1 x 40FT', '1 x 40FT HC',
  '20ft GP', '40ft GP', '20ft HC', '40ft HC', '45ft HC',
  '20ft Reefer', '40ft Reefer', 'Flat rack', 'Open top', 'Bulk', 'Break bulk',
];
const TRANSPORT_MODES = ['Sea', 'Air', 'Road', 'Rail', 'Multimodal'];

const CURRENCIES = ['AUD', 'USD'];

// A line may name a material or just describe itself, so materialId starts empty
// and stays that way for a one-off product typed straight onto the invoice.
const emptyLine = {
  materialId: '',
  description: '',
  packageCount: '',
  containerIndex: '',
  grossWeightMt: '',
  tareWeightMt: '',
  netWeightMt: '',
  pricePerMt: '',
};

const emptyContainer = { containerNo: '', seal: '', containerType: '1 x 20FT' };

const emptyConsignee = {
  name: '',
  country: '',
  address: '',
  email: '',
  phone: '',
  abn: '',
  website: '',
  groupName: '',
  defaultCurrency: '',
  defaultShippingTerm: '',
};

/**
 * One form, two stages.
 *
 * A shipment is entered once as a packing slip — the goods and what they weigh —
 * and priced afterwards into the invoice. Both stages capture the same lines,
 * containers and references, so this is the same form with the money hidden
 * rather than a second screen: the net weight the packing slip establishes is
 * the number the invoice multiplies, and keeping one form is what stops the two
 * from being entered twice and disagreeing.
 */
export default function NewInvoicePage({ mode = 'invoice' }) {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);
  const isPacking = mode === 'packing';
  const basePath = isPacking ? '/packing-slips' : '/export-invoices';
  // Set when an existing record is loaded, so the invoice form can tell a plain
  // edit from the moment a packing slip is being priced into an invoice.
  const [loadedStage, setLoadedStage] = useState(null);
  const pricingUp = !isPacking && loadedStage === 'PACKING_SLIP';
  // Unpriced slips, offered when starting an invoice from scratch so the
  // shipment already recorded can be picked up rather than typed again.
  const [openSlips, setOpenSlips] = useState([]);
  const [loadingInvoice, setLoadingInvoice] = useState(Boolean(editId));

  const [materials, setMaterials] = useState([]);
  const [consignees, setConsignees] = useState([]);

  const [consigneeId, setConsigneeId] = useState('');
  const [newConsignee, setNewConsignee] = useState({ ...emptyConsignee });
  const [addingConsignee, setAddingConsignee] = useState(false);

  // Free text on purpose: the operator sometimes uses the contract number as the
  // invoice number, because two buyers must never share one.
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [currency, setCurrency] = useState('AUD');
  const [shipping, setShipping] = useState({
    shippingTerm: 'FAS',
    fasPort: '',
    contractNo: '',
    modeOfTransport: 'Sea',
  });
  // A container shipment always names at least one container, so the fields are
  // present from the start rather than behind "+ Add container". Starting empty
  // meant the operator never saw them and the document printed "—" where the
  // container number, seal and type should be. Editing loads whatever the
  // record actually has.
  const [containers, setContainers] = useState(() =>
    editId ? [] : [{ ...emptyContainer }]
  );

  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [discount, setDiscount] = useState({ discountType: 'NONE', discountValue: 0 });
  // Exports are GST-free; a local sale on the same document is not. The operator
  // chooses, rather than the system guessing from the shipping fields.
  const [applyGst, setApplyGst] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      // An export document is written in the trade grades the buyer's contract
      // names — "Mill Berry", not "Copper Bright Wire".
      api.get('/materials', { params: { kind: 'EXPORT' } }).then((res) => res.data.materials),
      api.get('/consignees').then((res) => res.data.consignees),
    ])
      .then(([mats, cons]) => {
        setMaterials(mats);
        setConsignees(cons);
      })
      .catch(() => setError('Could not load materials or consignees.'));
  }, []);

  // Only when starting a fresh invoice. Editing one, or pricing a slip, is
  // already working on a specific record.
  useEffect(() => {
    if (isPacking || isEdit) return;
    api
      .get('/invoices', { params: { stage: 'PACKING_SLIP', pageSize: 100 } })
      .then((res) => setOpenSlips(res.data.invoices ?? []))
      .catch(() => setOpenSlips([]));
  }, [isPacking, isEdit]);

  // Edit mode: hydrate from the stored invoice.
  useEffect(() => {
    if (!editId) return;
    api
      .get(`/invoices/${editId}`)
      .then(({ data }) => {
        const inv = data.invoice;
        setInvoiceNumber(inv.invoiceNumber);
        setConsigneeId(inv.consigneeId);
        setApplyGst(Boolean(inv.applyGst));
        setDiscount({
          discountType: inv.discountType || 'NONE',
          discountValue: Number(inv.discountValue) || 0,
        });
        setCurrency(inv.currency || 'AUD');
        setLoadedStage(inv.stage || 'INVOICED');
        setShipping({
          shippingTerm: inv.shippingTerm || '',
          fasPort: inv.fasPort || '',
          contractNo: inv.contractNo || '',
          modeOfTransport: inv.modeOfTransport || '',
        });
        const loaded = inv.containers ?? [];
        setContainers(
          loaded.map((c) => ({
            containerNo: c.containerNo || '',
            seal: c.seal || '',
            containerType: c.containerType || '',
          }))
        );
        const indexById = Object.fromEntries(loaded.map((c, i) => [c.id, i]));
        setLines(
          inv.lineItems.map((li) => ({
            materialId: li.materialId || '',
            description: li.description || '',
            packageCount: li.packageCount || '',
            containerIndex: li.containerId != null ? String(indexById[li.containerId] ?? '') : '',
            grossWeightMt: li.grossWeightMt == null ? '' : String(li.grossWeightMt),
            tareWeightMt: li.tareWeightMt == null ? '' : String(li.tareWeightMt),
            netWeightMt: String(li.netWeightMt),
            pricePerMt: String(li.pricePerMt),
          }))
        );
      })
      .catch(() => setError('Could not load this invoice.'))
      .finally(() => setLoadingInvoice(false));
  }, [editId]);

  const materialMap = useMemo(
    () => Object.fromEntries(materials.map((m) => [m.id, m])),
    [materials]
  );

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const w = parseFloat(l.netWeightMt) || 0;
        const p = parseFloat(l.pricePerMt) || 0;
        return sum + w * p;
      }, 0),
    [lines]
  );
  const { discountAmount, gst, total } = applyDiscount(subtotal, discount, applyGst ? 'EXCLUSIVE' : 'NO_TAX');
  // What a packing slip is for: the figure the invoice will later price.
  const totalNetWeight = lines.reduce((sum, l) => sum + (parseFloat(l.netWeightMt) || 0), 0);

  /**
   * Grades under their category, for the picker. Categories alphabetical, with
   * anything uncategorised collected last rather than dropped.
   */
  const materialGroups = useMemo(() => {
    const byCategory = new Map();
    for (const m of materials) {
      const key = m.category || 'Other';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(m);
    }
    return [...byCategory.entries()].sort(([a], [b]) => {
      if (a === 'Other') return 1;
      if (b === 'Other') return -1;
      return a.localeCompare(b);
    });
  }, [materials]);

  function updateLine(idx, field, value) {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[idx], [field]: value };

      if (field === 'materialId' && !line.description) {
        line.description = materialMap[value]?.description || '';
      }

      // The packing list weighs gross and tare; the invoice bills the difference.
      // Deriving it here is what stops the two documents disagreeing.
      if (field === 'grossWeightMt' || field === 'tareWeightMt') {
        const g = parseFloat(field === 'grossWeightMt' ? value : line.grossWeightMt);
        const t = parseFloat(field === 'tareWeightMt' ? value : line.tareWeightMt);
        if (Number.isFinite(g) && Number.isFinite(t)) {
          line.netWeightMt = String(round2(g - t));
        }
      }

      next[idx] = line;
      return next;
    });
  }

  const addLine = () => setLines((prev) => [...prev, { ...emptyLine }]);
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));

  const addContainer = () => setContainers((prev) => [...prev, { ...emptyContainer }]);
  const updateContainer = (idx, field, value) =>
    setContainers((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  const removeContainer = (idx) => {
    setContainers((prev) => prev.filter((_, i) => i !== idx));
    // Lines pointing past the removed container would otherwise dangle.
    setLines((prev) =>
      prev.map((l) => {
        if (l.containerIndex === '') return l;
        const at = Number(l.containerIndex);
        if (at === idx) return { ...l, containerIndex: '' };
        return at > idx ? { ...l, containerIndex: String(at - 1) } : l;
      })
    );
  };

  async function handleAddConsignee() {
    if (!newConsignee.name.trim()) return;
    try {
      const body = { name: newConsignee.name.trim() };
      for (const key of [
        'country', 'address', 'email', 'phone', 'abn', 'website',
        'groupName', 'defaultCurrency', 'defaultShippingTerm',
      ]) {
        const v = newConsignee[key]?.trim?.() ?? newConsignee[key];
        if (v) body[key] = v;
      }
      const res = await api.post('/consignees', body);
      const created = res.data.consignee;
      setConsignees((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      selectConsignee(created.id, [...consignees, created]);
      setAddingConsignee(false);
      setNewConsignee({ ...emptyConsignee });
    } catch (err) {
      const apiError = err.response?.data?.error;
      setError(
        (typeof apiError === 'string' ? apiError : apiError?.formErrors?.join(', ')) ||
          'Could not create consignee.'
      );
    }
  }

  /** Adopt the buyer's usual currency and terms — both stay editable. */
  function selectConsignee(id, list = consignees) {
    setConsigneeId(id);
    const c = list.find((x) => x.id === id);
    if (c?.defaultCurrency) setCurrency(c.defaultCurrency);
    if (c?.defaultShippingTerm) {
      setShipping((prev) => ({ ...prev, shippingTerm: c.defaultShippingTerm }));
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!invoiceNumber.trim()) return setError('Invoice number is required.');
    if (!consigneeId) return setError('Select or add a consignee.');

    const validLines = lines.filter(
      (l) => (l.materialId || l.description.trim()) && l.netWeightMt && (isPacking || l.pricePerMt)
    );
    if (validLines.length === 0) {
      return setError(
        isPacking
          ? 'Add at least one line with a product and a net weight.'
          : 'Add at least one line with a product, weight and price.'
      );
    }

    setSubmitting(true);
    try {
      const num = (v) => (v === '' || v == null ? null : parseFloat(v));
      const payload = {
        invoiceNumber: invoiceNumber.trim(),
        consigneeId,
        currency,
        // Saving the invoice form is what promotes a packing slip; there is no
        // separate "convert" step to forget. But stage only moves forward: a
        // shipment already priced stays INVOICED even when it is opened through
        // its packing-slip view, because the route someone happened to arrive
        // by must never demote a real sale.
        stage: loadedStage === 'INVOICED' ? 'INVOICED' : isPacking ? 'PACKING_SLIP' : 'INVOICED',
        ...shipping,
        // A packing slip states no money at all, so it carries no discount and
        // no GST — they would be decisions made before there is a price to
        // apply them to.
        ...(isPacking ? { discountType: 'NONE', discountValue: 0 } : discount),
        applyGst: isPacking ? false : applyGst,
        containers: containers.map((c) => ({
          containerNo: c.containerNo || null,
          seal: c.seal || null,
          containerType: c.containerType || null,
        })),
        lineItems: validLines.map((l) => ({
          materialId: l.materialId || null,
          description: l.description || null,
          packageCount: l.packageCount || null,
          containerIndex: l.containerIndex === '' ? null : Number(l.containerIndex),
          grossWeightMt: num(l.grossWeightMt),
          tareWeightMt: num(l.tareWeightMt),
          netWeightMt: parseFloat(l.netWeightMt),
          // Zero rather than null: the column is required, and a packing slip
          // is a statement about weight that says nothing about price yet.
          pricePerMt: isPacking ? 0 : parseFloat(l.pricePerMt),
        })),
      };

      if (isEdit) {
        await api.patch(`/invoices/${editId}`, payload);
        navigate(`${basePath}/${editId}`);
        return;
      }
      const res = await api.post('/invoices', payload);
      navigate(`${basePath}/${res.data.invoice.id}`);
    } catch (err) {
      const apiError = err.response?.data?.error;
      setError(
        (typeof apiError === 'string' ? apiError : apiError?.formErrors?.join(', ')) ||
          (isPacking ? 'Could not save packing slip.' : 'Could not save invoice.')
      );
    } finally {
      setSubmitting(false);
    }
  }

  const field = 'w-full rounded-md border border-steel-200 bg-paper px-3 py-2 text-sm focus:border-copper-500 focus:bg-white';
  const labelCls = 'mb-1 block text-xs font-medium text-steel-500';

  if (loadingInvoice) {
    return <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 text-sm text-steel-500">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="font-display text-2xl font-semibold text-steel-900">
        {isPacking
          ? isEdit
            ? 'Edit packing slip'
            : 'New packing slip'
          : pricingUp
            ? 'Price into a sales invoice'
            : isEdit
              ? 'Edit invoice'
              : 'New sales invoice'}
      </h1>
      {/* Pricing is the one moment the operator is looking at a document that
          already exists and is about to change kind, so it says so plainly. */}
      <p className="mb-6 mt-1 text-sm text-steel-500">
        {isPacking
          ? 'Record the goods and what they weigh. Prices come later, when this is priced into a sales invoice.'
          : pricingUp
            ? 'The weights below came from the packing slip and are the figures being billed. Add a price per tonne to each line; saving turns this into a sales invoice.'
            : 'A commercial invoice for a container shipment.'}
      </p>

      {/* A shipment is normally weighed onto a packing slip first, so an
          invoice typed from scratch is usually one that already exists as a
          slip. Picking it here goes to that record and prices it, rather than
          creating a second record for the same container — which would be two
          net weights for one shipment, free to disagree. */}
      {!isPacking && !isEdit && openSlips.length > 0 && (
        <div className="mb-5 rounded-xl border border-steel-200 bg-white p-4 shadow-ticket">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-steel-900">
                Start from a packing slip
              </div>
              <div className="mt-0.5 text-xs text-steel-500">
                {openSlips.length} shipment{openSlips.length === 1 ? ' is' : 's are'} weighed but not
                yet priced. Pick one to price it instead of entering it again.
              </div>
            </div>
            <select
              aria-label="Packing slip to price"
              defaultValue=""
              onChange={(e) => e.target.value && navigate(`/export-invoices/${e.target.value}/edit`)}
              className="w-full rounded-lg border border-steel-200 bg-paper px-3 py-2 text-sm focus:bg-white sm:w-72"
            >
              <option value="">Choose a packing slip…</option>
              {openSlips.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.invoiceNumber} — {s.consignee?.name ?? 'Unknown buyer'}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="overflow-hidden rounded-xl border border-steel-200 bg-white shadow-ticket">
          <div className="flex items-center justify-between bg-steel-900 px-6 py-4">
            <div className="font-semibold text-paper">
              {isPacking ? 'Packing slip' : 'Export invoice'}
            </div>
            <div className="text-xs text-steel-400">Container shipment</div>
          </div>

          {/* ── Header: reference numbers ─────────────────────────── */}
          <div className={`grid gap-4 border-b border-steel-100 px-4 py-5 sm:px-6 ${isPacking ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1 sm:grid-cols-3'}`}>
            <div>
              {/* One number, whichever stage it is at. The slip and its invoice
                  are the same record — the invoice is made from the slip, and
                  editing either edits both — so they are filed and paid against
                  a single reference. "Packing slip number" implied a second
                  series that does not exist. */}
              <label className={labelCls}>Invoice number</label>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="e.g. SMC-2026-018"
                className={`num ${field}`}
              />
            </div>
            <div>
              <label className={labelCls}>Contract number</label>
              <input
                value={shipping.contractNo}
                onChange={(e) => setShipping({ ...shipping, contractNo: e.target.value })}
                placeholder="e.g. SHINEAUS99"
                className={`num ${field}`}
              />
            </div>
            {!isPacking && (
              <div>
                <label className={labelCls}>Currency</label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className={field}
                >
                  {CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* ── Containers (above consignee — the physical shipment first) ── */}
          <div className="border-b border-steel-100 px-4 py-5 sm:px-6">
            <div className="mb-2 flex items-center justify-between">
              <label className={labelCls}>Containers</label>
              <button
                type="button"
                onClick={addContainer}
                className="text-sm font-medium text-copper-600 hover:text-copper-700"
              >
                + Add container
              </button>
            </div>

            {containers.length === 0 ? (
              <p className="text-sm text-steel-400">
                None yet — add one if this shipment names a container.
              </p>
            ) : (
              <div className="space-y-2">
                {containers.map((c, idx) => (
                  <div
                    key={idx}
                    className="grid grid-cols-2 items-end gap-2 rounded-lg border border-steel-200 bg-paper/60 p-3 md:grid-cols-[28px_1fr_1fr_1fr_32px] md:items-center md:rounded-none md:border-0 md:bg-transparent md:p-0"
                  >
                    <div className="num hidden text-xs text-steel-400 md:block">{idx + 1}</div>
                    <input
                      aria-label={`Container ${idx + 1} number`}
                      placeholder="Container no."
                      value={c.containerNo}
                      onChange={(e) => updateContainer(idx, 'containerNo', e.target.value)}
                      className={`num ${field}`}
                    />
                    <input
                      aria-label={`Container ${idx + 1} seal`}
                      placeholder="Seal"
                      value={c.seal}
                      onChange={(e) => updateContainer(idx, 'seal', e.target.value)}
                      className={`num ${field}`}
                    />
                    <input
                      aria-label={`Container ${idx + 1} type`}
                      placeholder="Type, e.g. 1 x 20FT"
                      list="container-types"
                      value={c.containerType}
                      onChange={(e) => updateContainer(idx, 'containerType', e.target.value)}
                      className={field}
                    />
                    <button
                      type="button"
                      onClick={() => removeContainer(idx)}
                      aria-label={`Remove container ${idx + 1}`}
                      className="justify-self-end text-steel-300 hover:text-working-red"
                    >
                      ×
                    </button>
                  </div>
                ))}
                <datalist id="container-types">
                  {CONTAINER_TYPES.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
            )}
          </div>

          {/* ── Consignee ────────────────────────────────────────── */}
          <div className="border-b border-steel-100 px-6 py-5">
            <label className={labelCls}>Consignee</label>
            {addingConsignee ? (
              <div className="rounded-lg border border-steel-200 bg-paper p-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[
                    ['name', 'Consignee name (as it should print)', true],
                    ['groupName', 'Buyer group (if they bill through several)'],
                    ['address', 'Address'],
                    ['country', 'Country'],
                    ['email', 'Email'],
                    ['phone', 'Phone'],
                    ['abn', 'ABN'],
                    ['website', 'Website'],
                  ].map(([key, placeholder, autoFocus]) => (
                    <input
                      key={key}
                      autoFocus={autoFocus}
                      placeholder={placeholder}
                      value={newConsignee[key]}
                      onChange={(e) => setNewConsignee({ ...newConsignee, [key]: e.target.value })}
                      className={field}
                    />
                  ))}
                  <select
                    value={newConsignee.defaultCurrency}
                    onChange={(e) =>
                      setNewConsignee({ ...newConsignee, defaultCurrency: e.target.value })
                    }
                    className={field}
                  >
                    <option value="">Usual currency (optional)</option>
                    {CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                  <input
                    placeholder="Usual shipping term (e.g. FAS)"
                    value={newConsignee.defaultShippingTerm}
                    onChange={(e) =>
                      setNewConsignee({ ...newConsignee, defaultShippingTerm: e.target.value })
                    }
                    className={field}
                  />
                </div>
                <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={handleAddConsignee}
                  className="whitespace-nowrap rounded-md bg-copper-500 px-3 py-2 text-sm font-semibold text-white hover:bg-copper-400"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => setAddingConsignee(false)}
                  className="whitespace-nowrap rounded-md border border-steel-200 px-3 py-2 text-sm text-steel-600"
                >
                  Cancel
                </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <select
                    value={consigneeId}
                    onChange={(e) => selectConsignee(e.target.value)}
                    className={field}
                  >
                    <option value="">Select consignee…</option>
                    {consignees.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.country ? ` — ${c.country}` : ''}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setAddingConsignee(true)}
                    className="whitespace-nowrap text-sm font-medium text-copper-600 hover:text-copper-700"
                  >
                    + New
                  </button>
                </div>
                {/* Detail card — shown when a consignee is selected so the
                    operator can confirm the address and contact details that
                    will print on the document, and jump to edit if wrong. */}
                {consigneeId && (() => {
                  const c = consignees.find((x) => x.id === consigneeId);
                  if (!c) return null;
                  const addr = addressLines(c);
                  const details = [c.email, c.phone].filter(Boolean);
                  return (
                    <div className="mt-3 rounded-lg border border-steel-200 bg-paper/60 px-4 py-3">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 text-sm text-steel-700">
                          <div className="font-semibold text-steel-900">{c.name}</div>
                          {addr.length > 0 && (
                            <div className="mt-1 text-steel-600">
                              {addr.join(', ')}
                            </div>
                          )}
                          {details.length > 0 && (
                            <div className="mt-1 text-steel-500">
                              {details.join(' · ')}
                            </div>
                          )}
                          {c.groupName && (
                            <div className="mt-1 text-xs text-steel-400">Group: {c.groupName}</div>
                          )}
                        </div>
                        <a
                          href="/buyers"
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-xs font-medium text-copper-600 hover:text-copper-700"
                        >
                          Edit buyer ↗
                        </a>
                      </div>
                    </div>
                  );
                })()}
              </>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 border-b border-steel-100 px-4 py-5 sm:grid-cols-2 lg:grid-cols-3 sm:px-6">
            <ComboField
              label="Shipping term"
              value={shipping.shippingTerm}
              onChange={(v) => setShipping({ ...shipping, shippingTerm: v })}
              options={SHIPPING_TERMS}
              placeholder="e.g. FOB — or type your own"
            />
            <ComboField
              label="Port"
              value={shipping.fasPort}
              onChange={(v) => setShipping({ ...shipping, fasPort: v })}
              options={['Port Botany, Sydney', 'Port of Melbourne', 'Port of Brisbane', 'Fremantle', 'Port Adelaide']}
              placeholder="e.g. Port Botany"
            />
            <ComboField
              label="Mode of transport"
              value={shipping.modeOfTransport}
              onChange={(v) => setShipping({ ...shipping, modeOfTransport: v })}
              options={TRANSPORT_MODES}
              placeholder="e.g. Sea"
            />
          </div>

          <div className="px-6 py-5">
            {/* One card per line rather than one row.

                The row was a fixed-pixel grid of up to eight columns, which
                could not fit the card it sat in: the Total heading was cut off
                and the amount printed past the right-hand edge. Widths that are
                declared in pixels cannot adapt, so the fix is to stop declaring
                them — each line is now a small card whose fields wrap, and the
                arithmetic is grouped the way it is actually read: gross minus
                tare gives net, and net times price gives the amount. */}
            <div className="space-y-3">
              {lines.map((line, idx) => {
                const value =
                  (parseFloat(line.netWeightMt) || 0) * (parseFloat(line.pricePerMt) || 0);
                return (
                  <div
                    key={idx}
                    className="rounded-xl border border-steel-200 bg-white p-4 shadow-sm transition-colors focus-within:border-copper-400"
                  >
                    <div className="flex items-center gap-3">
                      <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-steel-100 text-xs font-semibold text-steel-600">
                        {idx + 1}
                      </span>
                      <select
                        aria-label="Material"
                        value={line.materialId}
                        onChange={(e) => updateLine(idx, 'materialId', e.target.value)}
                        className="min-w-0 flex-1 rounded-lg border border-steel-200 bg-paper px-3 py-2 text-sm font-medium focus:bg-white"
                      >
                        <option value="">Select a grade…</option>
                        {/* Grouped by category. A flat list of 21 trade names —
                            Talk, Tense, Troma, Night, Druid — says nothing about
                            what each one is; under "Aluminium" and "Brass" they
                            are findable without knowing the vocabulary. */}
                        {materialGroups.map(([category, items]) => (
                          <optgroup key={category} label={category}>
                            {items.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.code ? `${m.code}. ` : ''}
                                {m.description}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                      {/* Only with more than one container. With a single one
                          there is nothing to choose — every line is in it — and
                          the control was just another thing to tab past on every
                          product. The document still groups by container when a
                          shipment fills several. */}
                      {containers.length > 1 && (
                        <select
                          aria-label="Container"
                          value={line.containerIndex}
                          onChange={(e) => updateLine(idx, 'containerIndex', e.target.value)}
                          className="num w-36 shrink-0 rounded-lg border border-steel-200 bg-paper px-2 py-2 text-xs focus:bg-white"
                        >
                          <option value="">No container</option>
                          {containers.map((c, i) => (
                            <option key={i} value={i}>
                              {c.containerNo || `Container ${i + 1}`}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={lines.length === 1}
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-lg text-steel-300 hover:bg-working-redDim hover:text-working-red disabled:opacity-30"
                        aria-label={`Remove line ${idx + 1}`}
                      >
                        ×
                      </button>
                    </div>

                    <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                      <div className="min-w-0 flex-1">
                        <label className={labelCls}>Description as printed</label>
                        <input
                          aria-label="Description"
                          placeholder={
                            line.materialId
                              ? 'Leave blank to use the grade name'
                              : 'e.g. Millberry — Grade B'
                          }
                          value={line.description}
                          onChange={(e) => updateLine(idx, 'description', e.target.value)}
                          className={field}
                        />
                      </div>
                      <div className="w-full sm:w-40">
                        <label className={labelCls}>Packages</label>
                        <input
                          aria-label="Packages"
                          placeholder="13 bags"
                          value={line.packageCount}
                          onChange={(e) => updateLine(idx, 'packageCount', e.target.value)}
                          className={field}
                        />
                      </div>
                    </div>

                    {/* Weights read as the sum they are, so a mistyped tare is
                        visible as a net that does not look right. */}
                    <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-paper/70 p-3">
                      <div className="min-w-[92px] flex-1">
                        <label className={labelCls}>Gross MT</label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          inputMode="decimal"
                          aria-label="Gross weight"
                          placeholder="0.000"
                          value={line.grossWeightMt}
                          onChange={(e) => updateLine(idx, 'grossWeightMt', e.target.value)}
                          className={`num ${field}`}
                        />
                      </div>
                      <span className="pb-2 text-lg font-medium text-steel-300">−</span>
                      <div className="min-w-[92px] flex-1">
                        <label className={labelCls}>Tare MT</label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          inputMode="decimal"
                          aria-label="Tare weight"
                          placeholder="0.000"
                          value={line.tareWeightMt}
                          onChange={(e) => updateLine(idx, 'tareWeightMt', e.target.value)}
                          className={`num ${field}`}
                        />
                      </div>
                      <span className="pb-2 text-lg font-medium text-steel-300">=</span>
                      <div className="min-w-[92px] flex-1">
                        <label className={`${labelCls} font-semibold text-steel-700`}>Net MT</label>
                        <input
                          type="number"
                          step="0.001"
                          min="0"
                          inputMode="decimal"
                          aria-label="Net weight"
                          placeholder="0.000"
                          value={line.netWeightMt}
                          onChange={(e) => updateLine(idx, 'netWeightMt', e.target.value)}
                          className={`num ${field} border-steel-300 font-semibold`}
                        />
                      </div>
                    </div>

                    {!isPacking && (
                      <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                        <div className="w-40">
                          <label className={labelCls}>Price / MT ({currency})</label>
                          {/* "any", not "0.01": a contract rate is agreed to
                              three decimals and the browser rejects anything
                              off a coarser step, so a real price could not be
                              typed. The docket form already allowed it. */}
                          <input
                            type="number"
                            step="any"
                            min="0"
                            inputMode="decimal"
                            aria-label="Price per MT"
                            placeholder="0.000"
                            value={line.pricePerMt}
                            onChange={(e) => updateLine(idx, 'pricePerMt', e.target.value)}
                            className={`num ${field}`}
                          />
                        </div>
                        <div className="text-right">
                          <div className={labelCls}>Line total</div>
                          <div className="num text-lg font-semibold text-steel-900">
                            {value > 0 ? formatMoney(value, currency) : '—'}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              type="button"
              onClick={addLine}
              className="mt-3 text-sm font-medium text-copper-600 hover:text-copper-700"
            >
              + Add line
            </button>
          </div>

          {!isPacking && (
          <div className="grid grid-cols-1 gap-6 border-t border-steel-100 px-4 py-5 sm:grid-cols-2 sm:px-6">
            <DiscountField value={discount} onChange={setDiscount} subtotal={subtotal} />
            <div>
              <label className="mb-1.5 block text-sm font-medium text-steel-700">GST</label>
              <label className="flex cursor-pointer items-center gap-2.5 rounded-md border border-steel-200 bg-paper px-3 py-2">
                <input
                  type="checkbox"
                  checked={applyGst}
                  onChange={(e) => setApplyGst(e.target.checked)}
                  className="h-4 w-4 accent-copper-500"
                />
                <span className="text-sm text-steel-800">Add 10% GST</span>
              </label>
              <p className="mt-1.5 text-xs text-steel-500">
                {applyGst
                  ? 'Treated as a local sale — GST applies.'
                  : 'Exports are GST-free. Tick this for a sale within Australia.'}
              </p>
            </div>
          </div>
          )}

          <div className="border-t border-steel-200 bg-steel-950 px-6 py-5">
            {isPacking ? (
              <div className="ml-auto flex max-w-xs items-baseline justify-between border-t border-steel-700 pt-2 text-lg font-semibold text-paper">
                <span>Total net weight</span>
                <span className="num text-white">{formatNumber(totalNetWeight, 3)} MT</span>
              </div>
            ) : (
            <div className="ml-auto max-w-xs space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-steel-300">Subtotal</span>
                <span className="num font-semibold text-white">{formatMoney(subtotal, currency)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-steel-300">
                    Discount
                    {discount.discountType === 'PERCENT' ? ` (${discount.discountValue}%)` : ''}
                  </span>
                  <span className="num font-semibold text-white">
                    − {formatMoney(discountAmount, currency)}
                  </span>
                </div>
              )}
              {/* Only when GST is being added on top — an export is GST-free and
                  a local sale adds it, so this line is always real arithmetic. */}
              {applyGst && (
                <div className="flex justify-between text-sm">
                  <span className="text-steel-300">GST (10%)</span>
                  <span className="num font-semibold text-white">{formatMoney(gst, currency)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-steel-700 pt-2 text-xl font-bold text-white">
                <span>Total {currency}</span>
                <span className="num">{formatMoney(total, currency)}</span>
              </div>
            </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-working-redDim px-4 py-3 text-sm text-working-red">
            {error}
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-copper-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-copper-400 disabled:opacity-60"
          >
            {submitting
              ? 'Saving…'
              : isPacking
                ? isEdit
                  ? 'Save packing slip'
                  : 'Create packing slip'
                : pricingUp
                  ? 'Create sales invoice'
                  : isEdit
                    ? 'Save changes'
                    : 'Save invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}
