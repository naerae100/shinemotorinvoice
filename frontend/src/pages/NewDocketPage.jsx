import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatAud as formatCurrency } from '../lib/format';
import DiscountField, { applyDiscount } from '../components/DiscountField';

const PAYG_OPTIONS = [
  { value: 'NOT_APPLICABLE', label: 'Business sale with valid ABN' },
  { value: 'PRIVATE_HOBBY', label: 'Private recreational pursuit or hobby' },
  { value: 'TAX_EXEMPT', label: 'Wholly exempt from income tax' },
  { value: 'SCRAP_CODE_NO_ABN', label: 'Scrap Metal Industry Code — no ABN required' },
];

export default function NewDocketPage({ defaultType = 'PURCHASE_DOCKET' }) {
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);
  const [loadingDocket, setLoadingDocket] = useState(Boolean(editId));
  const [materials, setMaterials] = useState([]);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  const [newSupplier, setNewSupplier] = useState({ saleType: 'PRIVATE' });
  const [isNewSupplier, setIsNewSupplier] = useState(false);

  const [lines, setLines] = useState([{ materialId: '', netWeight: '', price: '' }]);
  const [type, setType] = useState(defaultType);
  const [paygStatement, setPaygStatement] = useState('NOT_APPLICABLE');

  useEffect(() => {
    setType(defaultType);
  }, [defaultType]);
  const [vehicle, setVehicle] = useState({ reg: '', model: '', vin: '' });
  const [showVehicle, setShowVehicle] = useState(false);

  const [discount, setDiscount] = useState({ discountType: 'NONE', discountValue: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [successPath, setSuccessPath] = useState('purchases');

  useEffect(() => {
    api.get('/materials').then((res) => setMaterials(res.data.materials));
  }, []);

  // Edit mode: hydrate the form from the stored docket.
  useEffect(() => {
    if (!editId) return;
    api
      .get(`/dockets/${editId}`)
      .then(({ data }) => {
        const d = data.docket;
        setType(d.type);
        setPaygStatement(d.paygStatement || 'NOT_APPLICABLE');
        setSelectedSupplier(d.supplier);
        setSupplierQuery(d.supplier?.name || '');
        setNewSupplier({
          name: d.supplier?.name || '',
          saleType: d.supplier?.saleType || 'PRIVATE',
          address: d.supplier?.address || '',
          suburb: d.supplier?.suburb || '',
          phone: d.supplier?.phone || '',
          abn: d.supplier?.abn || '',
          licenceNo: d.supplier?.licenceNo || '',
        });
        setLines(
          d.lineItems.map((li) => ({
            materialId: li.materialId,
            netWeight: String(li.netWeight),
            price: String(li.price),
          }))
        );
        setDiscount({
          discountType: d.discountType || 'NONE',
          discountValue: Number(d.discountValue) || 0,
        });
        if (d.vehicleModel || d.vehicleReg || d.vehicleVin) {
          setShowVehicle(true);
          setVehicle({ reg: d.vehicleReg || '', model: d.vehicleModel || '', vin: d.vehicleVin || '' });
        }
      })
      .catch(() => setError('Could not load this docket.'))
      .finally(() => setLoadingDocket(false));
  }, [editId]);

  useEffect(() => {
    if (!supplierQuery || selectedSupplier) {
      setSupplierResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.get('/suppliers', { params: { search: supplierQuery } }).then((res) => {
        setSupplierResults(res.data.suppliers);
      });
    }, 250);
    return () => clearTimeout(t);
  }, [supplierQuery, selectedSupplier]);

  const materialMap = useMemo(
    () => Object.fromEntries(materials.map((m) => [m.id, m])),
    [materials]
  );

  const subtotal = useMemo(
    () =>
      lines.reduce((sum, l) => {
        const w = parseFloat(l.netWeight) || 0;
        const p = parseFloat(l.price) || 0;
        return sum + w * p;
      }, 0),
    [lines]
  );
  const { discountAmount, taxable, gst, total } = applyDiscount(
    subtotal,
    discount,
    type === 'TAX_INVOICE'
  );

  function updateLine(idx, field, value) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      if (field === 'materialId') {
        const mat = materialMap[value];
        if (mat && Number(mat.currentPrice) > 0) {
          next[idx].price = String(mat.currentPrice);
        }
      }
      return next;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, { materialId: '', netWeight: '', price: '' }]);
  }

  function removeLine(idx) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function selectSupplier(s) {
    setSelectedSupplier(s);
    setSupplierQuery(s.name);
    setNewSupplier({
      name: s.name,
      saleType: s.saleType || 'PRIVATE',
      address: s.address || '',
      suburb: s.suburb || '',
      phone: s.phone || '',
      abn: s.abn || '',
      licenceNo: s.licenceNo || '',
    });
    setSupplierResults([]);
    setIsNewSupplier(false);
  }

  function startNewSupplier() {
    setIsNewSupplier(true);
    setSelectedSupplier(null);
    setNewSupplier({ name: supplierQuery, saleType: 'PRIVATE' });
    setSupplierResults([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const validLines = lines.filter((l) => l.materialId && l.netWeight && l.price);
    if (validLines.length === 0) {
      setError('Add at least one material line with weight and price.');
      return;
    }

    setSubmitting(true);
    try {
      const supplierName = (newSupplier.name || supplierQuery || '').trim();
      if (!supplierName) {
        setError('Supplier name is required.');
        setSubmitting(false);
        return;
      }

      const supplierDetails = {
        name: supplierName,
        saleType: newSupplier.saleType || 'PRIVATE',
        address: newSupplier.address || null,
        suburb: newSupplier.suburb || null,
        phone: newSupplier.phone || null,
        abn: newSupplier.abn || null,
        licenceNo: newSupplier.licenceNo || null,
      };

      // A picked supplier whose name still matches is updated in place, so edits made
      // here (new phone number, licence, address) are saved instead of silently
      // dropped. If the name was changed it's a different person, so create a new
      // record rather than renaming an existing client's history out from under them.
      const isSameSupplier =
        selectedSupplier && supplierName.toLowerCase() === selectedSupplier.name.trim().toLowerCase();

      const supplierRes = isSameSupplier
        ? await api.patch(`/suppliers/${selectedSupplier.id}`, supplierDetails)
        : await api.post('/suppliers', supplierDetails);
      const supplierId = supplierRes.data.supplier.id;

      const payload = {
        type,
        supplierId,
        paygStatement,
        ...discount,
        lineItems: validLines.map((l) => ({
          materialId: l.materialId,
          netWeight: parseFloat(l.netWeight),
          price: parseFloat(l.price),
        })),
        ...(showVehicle
          ? {
              vehicleReg: vehicle.reg || null,
              vehicleModel: vehicle.model || null,
              vehicleVin: vehicle.vin || null,
            }
          : {}),
      };

      const pathPrefix = type === 'TAX_INVOICE' ? 'tax-invoices' : 'purchases';

      if (isEdit) {
        await api.patch(`/dockets/${editId}`, payload);
        navigate(`/${pathPrefix}/${editId}`);
        return;
      }

      const res = await api.post('/dockets', payload);
      const newDocket = res.data.docket;
      navigate(`/${pathPrefix}/${newDocket.id}`);
    } catch (err) {
      const apiError = err.response?.data?.error;
      setError(
        (typeof apiError === 'string' ? apiError : apiError?.formErrors?.join(', ')) ||
          'Could not save docket.'
      );
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setSuccess(null);
    setLines([{ materialId: '', netWeight: '', price: '' }]);
    setSelectedSupplier(null);
    setSupplierQuery('');
    setIsNewSupplier(false);
    setVehicle({ reg: '', model: '', vin: '' });
    setShowVehicle(false);
  }

  if (loadingDocket) {
    return <div className="px-8 py-8 text-sm text-steel-500">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-4xl px-8 py-8">
      <h1 className="mb-6 font-display text-2xl font-semibold text-steel-900">
        {isEdit
          ? `Edit ${type === 'TAX_INVOICE' ? 'tax invoice' : 'docket'}`
          : type === 'TAX_INVOICE'
            ? 'New tax invoice'
            : 'New purchase docket'}
      </h1>

      <form onSubmit={handleSubmit}>
        <div className="overflow-hidden rounded-xl border border-steel-200 bg-white shadow-ticket">
          <div className="flex items-center justify-between bg-steel-900 px-6 py-4">
            <div className="font-semibold text-paper">
              {type === 'TAX_INVOICE' ? 'Tax invoice' : 'Purchase docket'}
            </div>
            <div className="text-xs text-steel-400">Docket # assigned on save</div>
          </div>

          <div className="border-b border-steel-100 px-6 py-5">
            <label className="mb-1.5 block text-sm font-medium text-steel-700">Supplier</label>
            <div className="relative">
              <input
                type="text"
                value={supplierQuery}
                onChange={(e) => {
                  setSupplierQuery(e.target.value);
                  setSelectedSupplier(null);
                  setIsNewSupplier(false);
                }}
                placeholder="Search or type a new supplier name…"
                className="w-full rounded-md border border-steel-200 bg-paper px-3 py-2.5 text-sm focus:border-copper-500 focus:bg-white"
              />
              {supplierResults.length > 0 && (
                <ul className="absolute z-10 mt-1 w-full rounded-md border border-steel-200 bg-white shadow-lg">
                  {supplierResults.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => selectSupplier(s)}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-paper"
                      >
                        {s.name}
                        {s.suburb && <span className="text-steel-400"> — {s.suburb}</span>}
                      </button>
                    </li>
                  ))}
                  <li>
                    <button
                      type="button"
                      onClick={startNewSupplier}
                      className="block w-full px-3 py-2 text-left text-sm font-medium text-copper-600 hover:bg-paper"
                    >
                      + Add "{supplierQuery}" as new supplier
                    </button>
                  </li>
                </ul>
              )}
              {supplierQuery && supplierResults.length === 0 && (
                <div className="mt-1.5 text-xs text-steel-500">
                  New supplier will be created.
                </div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-paper p-4 border border-steel-100">
              <input
                placeholder="Client Name"
                value={newSupplier.name || supplierQuery || ''}
                onChange={(e) => {
                  setSupplierQuery(e.target.value);
                  setNewSupplier({ ...newSupplier, name: e.target.value });
                }}
                className="col-span-2 rounded-md border border-steel-200 px-3 py-2 text-sm"
              />
                <input
                  placeholder="Address"
                  value={newSupplier.address || ''}
                  onChange={(e) => setNewSupplier({ ...newSupplier, address: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Suburb"
                  value={newSupplier.suburb || ''}
                  onChange={(e) => setNewSupplier({ ...newSupplier, suburb: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Phone"
                  value={newSupplier.phone || ''}
                  onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Driver Licence No."
                  value={newSupplier.licenceNo || ''}
                  onChange={(e) => setNewSupplier({ ...newSupplier, licenceNo: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                />
                <select
                  value={newSupplier.saleType}
                  onChange={(e) => setNewSupplier({ ...newSupplier, saleType: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                >
                  <option value="PRIVATE">Private sale</option>
                  <option value="BUSINESS">Business sale</option>
                </select>
                <input
                  placeholder="ABN (if business)"
                  value={newSupplier.abn || ''}
                  onChange={(e) => setNewSupplier({ ...newSupplier, abn: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                />
              </div>

            <button
              type="button"
              onClick={() => setShowVehicle((v) => !v)}
              className="mt-3 text-sm font-medium text-steel-500 hover:text-copper-600"
            >
              {showVehicle ? '− Hide' : '+ Add'} vehicle details (cash for cars)
            </button>
            {showVehicle && (
              <div className="mt-3 grid grid-cols-3 gap-3">
                <input
                  placeholder="Model"
                  value={vehicle.model}
                  onChange={(e) => setVehicle({ ...vehicle, model: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                />
                <input
                  placeholder="Vehicle reg"
                  value={vehicle.reg}
                  onChange={(e) => setVehicle({ ...vehicle, reg: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                />
                <input
                  placeholder="VIN"
                  value={vehicle.vin}
                  onChange={(e) => setVehicle({ ...vehicle, vin: e.target.value })}
                  className="rounded-md border border-steel-200 px-3 py-2 text-sm"
                />
              </div>
            )}
          </div>

          <div className="px-6 py-5">
            <div className="mb-2 grid grid-cols-[1fr_110px_110px_120px_32px] gap-2 text-xs font-medium uppercase tracking-wider text-steel-500">
              <div>Material</div>
              <div>Weight</div>
              <div>Price</div>
              <div className="text-right">Value</div>
              <div></div>
            </div>
            <div className="space-y-2">
              {lines.map((line, idx) => {
                const value = (parseFloat(line.netWeight) || 0) * (parseFloat(line.price) || 0);
                return (
                  <div
                    key={idx}
                    className="grid grid-cols-[1fr_110px_110px_120px_32px] items-center gap-2"
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
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="0.00"
                      value={line.netWeight}
                      onChange={(e) => updateLine(idx, 'netWeight', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-paper px-2.5 py-2 text-sm focus:bg-white"
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      value={line.price}
                      onChange={(e) => updateLine(idx, 'price', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-paper px-2.5 py-2 text-sm focus:bg-white"
                    />
                    <div className="num text-right text-sm font-medium text-steel-900">
                      {value > 0 ? formatCurrency(value) : '—'}
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
              + Add material line
            </button>
          </div>

          <div className="border-t border-steel-100 px-6 py-5">
            <label className="mb-1.5 block text-sm font-medium text-steel-700">
              Supplier statement (PAYG)
            </label>
            <select
              value={paygStatement}
              onChange={(e) => setPaygStatement(e.target.value)}
              className="w-full rounded-md border border-steel-200 bg-paper px-3 py-2.5 text-sm focus:bg-white"
            >
              {PAYG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="border-t border-steel-100 px-6 py-5">
            <DiscountField value={discount} onChange={setDiscount} subtotal={subtotal} />
          </div>

          <div className="border-t border-steel-200 bg-steel-950 px-6 py-5">
            <div className="ml-auto max-w-xs space-y-1.5">
              <div className="flex justify-between text-sm text-steel-400">
                <span>Subtotal</span>
                <span className="num">{formatCurrency(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm text-copper-300">
                  <span>
                    Discount
                    {discount.discountType === 'PERCENT' ? ` (${discount.discountValue}%)` : ''}
                  </span>
                  <span className="num">− {formatCurrency(discountAmount)}</span>
                </div>
              )}
              {type === 'TAX_INVOICE' && (
                <div className="flex justify-between text-sm text-steel-400">
                  <span>GST (10%)</span>
                  <span className="num">{formatCurrency(gst)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-steel-700 pt-2 text-lg font-semibold text-paper">
                <span>Total</span>
                <span className="num text-copper-400">{formatCurrency(total)}</span>
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
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save docket'}
          </button>
        </div>
      </form>
    </div>
  );
}
