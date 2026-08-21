import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatAud } from '../lib/format';
import DiscountField, { applyDiscount } from '../components/DiscountField';

const SHIPPING_TERMS = ['FAS', 'FOB', 'CFR', 'CIF', 'EXW', 'DAP'];
const CONTAINER_TYPES = ['20ft GP', '40ft GP', '20ft HC', '40ft HC', 'Bulk'];
const TRANSPORT_MODES = ['Sea', 'Air', 'Road', 'Rail'];

const emptyLine = { materialId: '', description: '', weightTonnes: '', pricePerMt: '' };

export default function NewInvoicePage() {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);
  const [loadingInvoice, setLoadingInvoice] = useState(Boolean(editId));

  const [materials, setMaterials] = useState([]);
  const [consignees, setConsignees] = useState([]);

  const [consigneeId, setConsigneeId] = useState('');
  const [newConsignee, setNewConsignee] = useState({ name: '', country: '' });
  const [addingConsignee, setAddingConsignee] = useState(false);

  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [shipping, setShipping] = useState({
    shippingTerm: 'FAS',
    fasPort: '',
    poNumber: '',
    containerNo: '',
    seal: '',
    modeOfTransport: 'Sea',
    containerType: '20ft GP',
  });

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
        setShipping({
          shippingTerm: inv.shippingTerm || '',
          fasPort: inv.fasPort || '',
          poNumber: inv.poNumber || '',
          containerNo: inv.containerNo || '',
          seal: inv.seal || '',
          modeOfTransport: inv.modeOfTransport || '',
          containerType: inv.containerType || '',
        });
        setLines(
          inv.lineItems.map((li) => ({
            materialId: li.materialId,
            description: li.description || '',
            weightTonnes: String(li.weightTonnes),
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
        const w = parseFloat(l.weightTonnes) || 0;
        const p = parseFloat(l.pricePerMt) || 0;
        return sum + w * p;
      }, 0),
    [lines]
  );
  const { discountAmount, gst, total } = applyDiscount(subtotal, discount, applyGst);

  function updateLine(idx, field, value) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'materialId' && !next[idx].description) {
        next[idx].description = materialMap[value]?.description || '';
      }
      return next;
    });
  }

  const addLine = () => setLines((prev) => [...prev, { ...emptyLine }]);
  const removeLine = (idx) => setLines((prev) => prev.filter((_, i) => i !== idx));

  async function handleAddConsignee() {
    if (!newConsignee.name.trim()) return;
    try {
      const res = await api.post('/consignees', {
        name: newConsignee.name.trim(),
        country: newConsignee.country || null,
      });
      const created = res.data.consignee;
      setConsignees((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      setConsigneeId(created.id);
      setAddingConsignee(false);
      setNewConsignee({ name: '', country: '' });
    } catch {
      setError('Could not create consignee.');
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    if (!invoiceNumber.trim()) return setError('Invoice number is required.');
    if (!consigneeId) return setError('Select or add a consignee.');

    const validLines = lines.filter((l) => l.materialId && l.weightTonnes && l.pricePerMt);
    if (validLines.length === 0) {
      return setError('Add at least one line with weight and price.');
    }

    setSubmitting(true);
    try {
      const payload = {
        invoiceNumber: invoiceNumber.trim(),
        consigneeId,
        ...shipping,
        ...discount,
        applyGst,
        lineItems: validLines.map((l) => ({
          materialId: l.materialId,
          description: l.description || null,
          weightTonnes: parseFloat(l.weightTonnes),
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
    return <div className="px-8 py-8 text-sm text-steel-500">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <h1 className="mb-6 font-display text-2xl font-semibold text-steel-900">
        {isEdit ? 'Edit invoice' : 'New sales invoice'}
      </h1>

      <form onSubmit={handleSubmit}>
        <div className="overflow-hidden rounded-xl border border-steel-200 bg-white shadow-ticket">
          <div className="flex items-center justify-between bg-steel-900 px-6 py-4">
            <div className="font-semibold text-paper">Export invoice</div>
            <div className="text-xs text-steel-400">Container shipment</div>
          </div>

          <div className="grid grid-cols-2 gap-4 border-b border-steel-100 px-6 py-5">
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
              <label className={labelCls}>PO number</label>
              <input
                value={shipping.poNumber}
                onChange={(e) => setShipping({ ...shipping, poNumber: e.target.value })}
                className={field}
              />
            </div>
          </div>

          <div className="border-b border-steel-100 px-6 py-5">
            <label className={labelCls}>Consignee</label>
            {addingConsignee ? (
              <div className="flex gap-2">
                <input
                  autoFocus
                  placeholder="Consignee name"
                  value={newConsignee.name}
                  onChange={(e) => setNewConsignee({ ...newConsignee, name: e.target.value })}
                  className={field}
                />
                <input
                  placeholder="Country"
                  value={newConsignee.country}
                  onChange={(e) => setNewConsignee({ ...newConsignee, country: e.target.value })}
                  className={field}
                />
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
            ) : (
              <div className="flex items-center gap-3">
                <select
                  value={consigneeId}
                  onChange={(e) => setConsigneeId(e.target.value)}
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

          <div className="grid grid-cols-3 gap-4 border-b border-steel-100 px-6 py-5">
            <div>
              <label className={labelCls}>Shipping term</label>
              <select
                value={shipping.shippingTerm}
                onChange={(e) => setShipping({ ...shipping, shippingTerm: e.target.value })}
                className={field}
              >
                {SHIPPING_TERMS.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Port</label>
              <input
                value={shipping.fasPort}
                onChange={(e) => setShipping({ ...shipping, fasPort: e.target.value })}
                placeholder="e.g. Port Botany"
                className={field}
              />
            </div>
            <div>
              <label className={labelCls}>Mode of transport</label>
              <select
                value={shipping.modeOfTransport}
                onChange={(e) => setShipping({ ...shipping, modeOfTransport: e.target.value })}
                className={field}
              >
                {TRANSPORT_MODES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Container type</label>
              <select
                value={shipping.containerType}
                onChange={(e) => setShipping({ ...shipping, containerType: e.target.value })}
                className={field}
              >
                {CONTAINER_TYPES.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>Container no.</label>
              <input
                value={shipping.containerNo}
                onChange={(e) => setShipping({ ...shipping, containerNo: e.target.value })}
                className={`num ${field}`}
              />
            </div>
            <div>
              <label className={labelCls}>Seal</label>
              <input
                value={shipping.seal}
                onChange={(e) => setShipping({ ...shipping, seal: e.target.value })}
                className={`num ${field}`}
              />
            </div>
          </div>

          <div className="px-6 py-5">
            <div className="mb-2 grid grid-cols-[1fr_1fr_100px_110px_120px_32px] gap-2 text-xs font-medium uppercase tracking-wider text-steel-500">
              <div>Material</div>
              <div>Description</div>
              <div>Tonnes</div>
              <div>Price / MT</div>
              <div className="text-right">Total</div>
              <div />
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => {
                const value =
                  (parseFloat(line.weightTonnes) || 0) * (parseFloat(line.pricePerMt) || 0);
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_1fr_100px_110px_120px_32px] items-center gap-2"
                  >
                    <select
                      value={line.materialId}
                      onChange={(e) => updateLine(idx, 'materialId', e.target.value)}
                      className="rounded-md border border-steel-200 bg-paper px-2.5 py-2 text-sm focus:bg-white"
                    >
                      <option value="">Select material…</option>
                      {materials.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.code ? `${m.code}. ` : ''}
                          {m.description}
                        </option>
                      ))}
                    </select>
                    <input
                      placeholder="As shown on invoice"
                      value={line.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      className="rounded-md border border-steel-200 bg-paper px-2.5 py-2 text-sm focus:bg-white"
                    />
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="0.000"
                      value={line.weightTonnes}
                      onChange={(e) => updateLine(idx, 'weightTonnes', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-paper px-2.5 py-2 text-sm focus:bg-white"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={line.pricePerMt}
                      onChange={(e) => updateLine(idx, 'pricePerMt', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-paper px-2.5 py-2 text-sm focus:bg-white"
                    />
                    <div className="num text-right text-sm font-medium text-steel-900">
                      {value > 0 ? formatAud(value) : '—'}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeLine(idx)}
                      disabled={lines.length === 1}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-steel-400 hover:bg-working-redDim hover:text-working-red disabled:opacity-30"
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

          <div className="grid grid-cols-2 gap-6 border-t border-steel-100 px-6 py-5">
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
                <span className="num">{formatAud(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-copper-300">
                  <span>
                    Discount
                    {discount.discountType === 'PERCENT' ? ` (${discount.discountValue}%)` : ''}
                  </span>
                  <span className="num">− {formatAud(discountAmount)}</span>
                </div>
              )}
              {applyGst && (
                <div className="flex justify-between text-sm text-steel-400">
                  <span>GST (10%)</span>
                  <span className="num">{formatAud(gst)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-steel-700 pt-2 text-lg font-semibold text-paper">
                <span>Total AUD</span>
                <span className="num text-copper-400">{formatAud(total)}</span>
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
