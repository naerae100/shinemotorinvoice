import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatMoney, round2 } from '../lib/format';
import DiscountField, { applyDiscount } from '../components/DiscountField';
import ComboField from '../components/ComboField';

// Suggestions, not restrictions — every one of these fields accepts free text.
const SHIPPING_TERMS = ['FAS', 'FOB', 'CFR', 'CIF', 'EXW', 'DAP', 'DDP', 'CPT', 'CIP', 'FCA'];
const CONTAINER_TYPES = [
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

export default function NewInvoicePage() {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);
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
    poNumber: '',
    contractNo: '',
    modeOfTransport: 'Sea',
  });
  const [containers, setContainers] = useState([]);

  const [lines, setLines] = useState([{ ...emptyLine }]);
  const [discount, setDiscount] = useState({ discountType: 'NONE', discountValue: 0 });
  // Exports are GST-free; a local sale on the same document is not. The operator
  // chooses, rather than the system guessing from the shipping fields.
  const [applyGst, setApplyGst] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/materials').then((res) => res.data.materials),
      api.get('/consignees').then((res) => res.data.consignees),
    ])
      .then(([mats, cons]) => {
        setMaterials(mats);
        setConsignees(cons);
      })
      .catch(() => setError('Could not load materials or consignees.'));
  }, []);

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
        setShipping({
          shippingTerm: inv.shippingTerm || '',
          fasPort: inv.fasPort || '',
          poNumber: inv.poNumber || '',
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
      (l) => (l.materialId || l.description.trim()) && l.netWeightMt && l.pricePerMt
    );
    if (validLines.length === 0) {
      return setError('Add at least one line with a product, weight and price.');
    }

    setSubmitting(true);
    try {
      const num = (v) => (v === '' || v == null ? null : parseFloat(v));
      const payload = {
        invoiceNumber: invoiceNumber.trim(),
        consigneeId,
        currency,
        ...shipping,
        ...discount,
        applyGst,
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
          pricePerMt: parseFloat(l.pricePerMt),
        })),
      };

      if (isEdit) {
        await api.patch(`/invoices/${editId}`, payload);
        navigate(`/export-invoices/${editId}`);
        return;
      }
      const res = await api.post('/invoices', payload);
      navigate(`/export-invoices/${res.data.invoice.id}`);
    } catch (err) {
      const apiError = err.response?.data?.error;
      setError(
        (typeof apiError === 'string' ? apiError : apiError?.formErrors?.join(', ')) ||
          'Could not save invoice.'
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
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <h1 className="mb-6 font-display text-2xl font-semibold text-steel-900">
        {isEdit ? 'Edit invoice' : 'New sales invoice'}
      </h1>

      <form onSubmit={handleSubmit}>
        <div className="overflow-hidden rounded-xl border border-steel-200 bg-white shadow-ticket">
          <div className="flex items-center justify-between bg-steel-900 px-6 py-4">
            <div className="font-semibold text-paper">Export invoice</div>
            <div className="text-xs text-steel-400">Container shipment</div>
          </div>

          <div className="grid grid-cols-1 gap-4 border-b border-steel-100 px-4 py-5 sm:grid-cols-2 sm:px-6">
            <div>
              <label className={labelCls}>Invoice number</label>
              <input
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
                placeholder="e.g. SMC-2026-018"
                className={`num ${field}`}
              />
            </div>
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
              <p className="mt-1 text-[11px] text-steel-400">
                Sets the payment account printed on the invoice.
              </p>
            </div>
            <div>
              <label className={labelCls}>PO number</label>
              <input
                value={shipping.poNumber}
                onChange={(e) => setShipping({ ...shipping, poNumber: e.target.value })}
                className={field}
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
          </div>

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
                  className="whitespace-nowrap rounded-md bg-copper-500 px-3 py-2 text-sm font-semibold text-steel-950 hover:bg-copper-400"
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

          {/* A shipment can fill more than one container, and each carries its
              own goods — which is why the container number used to end up typed
              into the description. */}
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

          <div className="px-6 py-5">
            <div className="mb-2 hidden gap-2 text-xs font-medium uppercase tracking-wider text-steel-500 md:grid md:grid-cols-[1fr_1fr_90px_90px_90px_100px_110px_32px]">
              <div>Material (optional)</div>
              <div>Description</div>
              <div>Gross MT</div>
              <div>Tare MT</div>
              <div>Net MT</div>
              <div>Price / MT</div>
              <div className="text-right">Total</div>
              <div />
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => {
                const value =
                  (parseFloat(line.netWeightMt) || 0) * (parseFloat(line.pricePerMt) || 0);
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-2 items-center gap-2 rounded-lg border border-steel-200 bg-paper/60 p-3 md:grid-cols-[1fr_1fr_90px_90px_90px_100px_110px_32px] md:rounded-none md:border-0 md:bg-transparent md:p-0"
                  >
                    <select
                      aria-label="Material"
                      value={line.materialId}
                      onChange={(e) => updateLine(idx, 'materialId', e.target.value)}
                      className="col-span-2 rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm md:col-span-1 md:bg-paper md:focus:bg-white"
                    >
                      <option value="">One-off — type below</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code ? `${m.code}. ` : ''}
                          {m.description}
                        </option>
                      ))}
                    </select>
                    <div className="col-span-2 md:col-span-1">
                      <input
                        aria-label="Description"
                        placeholder="As printed on the invoice"
                        value={line.description}
                        onChange={(e) => updateLine(idx, 'description', e.target.value)}
                        className="w-full rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm md:bg-paper md:focus:bg-white"
                      />
                      <div className="mt-1 flex gap-1">
                        <input
                          aria-label="Packages"
                          placeholder="13 bags"
                          value={line.packageCount}
                          onChange={(e) => updateLine(idx, 'packageCount', e.target.value)}
                          className="w-1/2 rounded-md border border-steel-200 bg-white px-2 py-1 text-[11px] md:bg-paper"
                        />
                        {containers.length > 0 && (
                          <select
                            aria-label="Container"
                            value={line.containerIndex}
                            onChange={(e) => updateLine(idx, 'containerIndex', e.target.value)}
                            className="w-1/2 rounded-md border border-steel-200 bg-white px-2 py-1 text-[11px] md:bg-paper"
                          >
                            <option value="">No container</option>
                            {containers.map((c, i) => (
                              <option key={i} value={String(i)}>
                                {c.containerNo || `Container ${i + 1}`}
                              </option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      inputMode="decimal"
                      aria-label="Gross weight"
                      placeholder="Gross"
                      value={line.grossWeightMt}
                      onChange={(e) => updateLine(idx, 'grossWeightMt', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm md:bg-paper md:focus:bg-white"
                    />
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      inputMode="decimal"
                      aria-label="Tare weight"
                      placeholder="Tare"
                      value={line.tareWeightMt}
                      onChange={(e) => updateLine(idx, 'tareWeightMt', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm md:bg-paper md:focus:bg-white"
                    />
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      inputMode="decimal"
                      aria-label="Net weight"
                      placeholder="Net"
                      value={line.netWeightMt}
                      onChange={(e) => updateLine(idx, 'netWeightMt', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm md:bg-paper md:focus:bg-white"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      inputMode="decimal"
                      aria-label="Price per MT"
                      placeholder="Price / MT"
                      value={line.pricePerMt}
                      onChange={(e) => updateLine(idx, 'pricePerMt', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm md:bg-paper md:focus:bg-white"
                    />
                    <div className="num text-sm font-medium text-steel-900 md:text-right">
                      <span className="text-xs text-steel-400 md:hidden">Total </span>
                      {value > 0 ? formatMoney(value, currency) : '—'}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                      className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-steel-400 hover:bg-working-redDim hover:text-working-red disabled:opacity-30"
                      aria-label="Remove line"
                    >
                      ×
                    </button>
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

          <div className="border-t border-steel-200 bg-steel-950 px-6 py-5">
            <div className="ml-auto max-w-xs space-y-1.5">
              <div className="flex justify-between text-sm text-steel-400">
                <span>Subtotal</span>
                <span className="num">{formatMoney(subtotal, currency)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-copper-300">
                  <span>
                    Discount
                    {discount.discountType === 'PERCENT' ? ` (${discount.discountValue}%)` : ''}
                  </span>
                  <span className="num">− {formatMoney(discountAmount, currency)}</span>
                </div>
              )}
              {applyGst && (
                <div className="flex justify-between text-sm text-steel-400">
                  <span>GST (10%)</span>
                  <span className="num">{formatMoney(gst, currency)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-steel-700 pt-2 text-lg font-semibold text-paper">
                <span>Total AUD</span>
                <span className="num text-copper-400">{formatMoney(total, currency)}</span>
              </div>
            </div>
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
            className="rounded-md bg-copper-500 px-6 py-3 text-sm font-semibold text-steel-950 shadow-sm transition-colors hover:bg-copper-400 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save invoice'}
          </button>
        </div>
      </form>
    </div>
  );
}
