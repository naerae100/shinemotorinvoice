import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatAud as formatCurrency } from '../lib/format';
import DiscountField, { applyDiscount } from '../components/DiscountField';
import MaterialField from '../components/MaterialField';
import { apiErrorMessage } from '../lib/apiError';
import AbnField from '../components/AbnField';

const PAYG_OPTIONS = [
  { value: 'NOT_APPLICABLE', label: 'Business sale with valid ABN' },
  { value: 'PRIVATE_HOBBY', label: 'Private recreational pursuit or hobby' },
  { value: 'TAX_EXEMPT', label: 'Wholly exempt from income tax' },
  { value: 'SCRAP_CODE_NO_ABN', label: 'Scrap Metal Industry Code — no ABN required' },
];

const TAX_MODE_OPTIONS = [
  { value: 'EXCLUSIVE', label: 'Tax Exclusive' },
  { value: 'INCLUSIVE', label: 'Tax Inclusive' },
  { value: 'NO_TAX', label: 'No Tax' },
];

/**
 * The supplier fields this form owns, in one place.
 *
 * Two paths load a supplier into the form — picking one from the search, and
 * opening an existing docket to edit — and each used to list the fields by hand.
 * They drifted: the edit path never loaded `email` or any of the payment
 * details, and because saving PATCHes the supplier with whatever the form holds,
 * opening a docket and saving it wrote those back as null. Editing a docket was
 * quietly erasing the supplier's email and bank account.
 *
 * Listing them once means a field added to the form cannot be missed by one path
 * and blanked by the other.
 */
const BLANK_LINE = { materialId: '', description: '', netWeight: '', price: '' };
const BLANK_LINE_COUNT = 5;

/**
 * Australian numbers are the overwhelming default for suppliers — this is a
 * Sydney yard buying from people who drive in — so the field starts on the
 * country code rather than empty. It is a starting point, not a constraint: the
 * prefix is editable, and a field left untouched is saved as no phone at all
 * rather than as the bare prefix (see normalisePhone).
 *
 * Deliberately NOT applied to buyers, who are overseas mills and traders.
 */
const PHONE_PREFIX = '+61 ';

/** A phone that is still just the prefix is not a phone number. */
const normalisePhone = (v) => {
  const t = (v || '').trim();
  return t === '' || t === PHONE_PREFIX.trim() ? null : t;
};

const supplierFormValues = (s) => ({
  name: s?.name || '',
  saleType: s?.saleType || 'PRIVATE',
  address: s?.address || '',
  suburb: s?.suburb || '',
  phone: s?.phone || PHONE_PREFIX,
  email: s?.email || '',
  abn: s?.abn || '',
  licenceNo: s?.licenceNo || '',
  bankAccountName: s?.bankAccountName || '',
  bankBsb: s?.bankBsb || '',
  bankAccountNo: s?.bankAccountNo || '',
  payId: s?.payId || '',
});

export default function NewDocketPage({ defaultType = 'PURCHASE_DOCKET' }) {
  // A purchase docket is quoted to the supplier with GST already in the price —
  // that is the number said at the weighbridge. A tax invoice is the opposite:
  // it states a price and adds GST to it, so each document type opens on the
  // treatment it is actually written under.
  const defaultTaxMode = defaultType === 'TAX_INVOICE' ? 'EXCLUSIVE' : 'INCLUSIVE';
  const navigate = useNavigate();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);
  const [loadingDocket, setLoadingDocket] = useState(Boolean(editId));
  const [materials, setMaterials] = useState([]);
  const [supplierQuery, setSupplierQuery] = useState('');
  const [supplierResults, setSupplierResults] = useState([]);
  const [selectedSupplier, setSelectedSupplier] = useState(null);
  // Built from the same mapper as the picker and the edit path — a fourth
  // hand-written shape here is exactly how the phone prefix and, before it, the
  // bank details ended up missing from one path and not another.
  const [newSupplier, setNewSupplier] = useState(() => supplierFormValues());
  const [isNewSupplier, setIsNewSupplier] = useState(false);

  // A load is rarely one grade. Opening with a single row meant clicking "add
  // line" for every one of them before any figures could be entered; five rows
  // is the common case, and blank ones are simply ignored on save — only lines
  // with a material, a weight and a price are kept.
  const [lines, setLines] = useState(() =>
    Array.from({ length: BLANK_LINE_COUNT }, () => ({ ...BLANK_LINE }))
  );
  const [type, setType] = useState(defaultType);
  // Inclusive by default: the rate agreed at the weighbridge already has GST in it.
  const [taxMode, setTaxMode] = useState(defaultTaxMode);
  const [paygStatement, setPaygStatement] = useState('NOT_APPLICABLE');
  // Paid on the spot unless the operator says otherwise. The pay-later case is
  // real and common — the manager with bank access is not on site — but it is
  // still the exception, and defaulting to unpaid would fill the payment run
  // with dockets that were settled at the weighbridge.
  const [payLater, setPayLater] = useState(false);

  useEffect(() => {
    setType(defaultType);
    setTaxMode(defaultTaxMode);
  }, [defaultType, defaultTaxMode]);
  const [vehicle, setVehicle] = useState({ reg: '', model: '', vin: '' });
  const [showVehicle, setShowVehicle] = useState(false);

  const [discount, setDiscount] = useState({ discountType: 'NONE', discountValue: 0 });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const [successPath, setSuccessPath] = useState('purchases');

  useEffect(() => {
    // A docket is written in the names the yard buys under.
    api
      .get('/materials', { params: { kind: 'PURCHASE' } })
      .then((res) => setMaterials(res.data.materials));
  }, []);

  // Edit mode: hydrate the form from the stored docket.
  useEffect(() => {
    if (!editId) return;
    api
      .get(`/dockets/${editId}`)
      .then(({ data }) => {
        const d = data.docket;
        setType(d.type);
        setTaxMode(d.taxMode || defaultTaxMode);
        setPaygStatement(d.paygStatement || 'NOT_APPLICABLE');
        setSelectedSupplier(d.supplier);
        setSupplierQuery(d.supplier?.name || '');
        setNewSupplier(supplierFormValues(d.supplier));
        setLines(
          d.lineItems.map((li) => ({
            materialId: li.materialId || '',
            description: li.description || '',
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
    taxMode
  );

  function updateLine(idx, field, value) {
    setLines((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }

  /**
   * The picker reports a material or a typed one-off. Picking a material fills
   * the rate from the price list; a rate already typed is left alone, because
   * the operator may have agreed something different at the weighbridge.
   */
  function selectMaterial(idx, { materialId, description, price }) {
    setLines((prev) => {
      const next = [...prev];
      const line = { ...next[idx], materialId, description };
      if (price != null && Number(price) > 0 && !line.price) line.price = String(price);
      next[idx] = line;
      return next;
    });
  }

  function addLine() {
    setLines((prev) => [...prev, { ...BLANK_LINE }]);
  }

  function removeLine(idx) {
    setLines((prev) => prev.filter((_, i) => i !== idx));
  }

  function selectSupplier(s) {
    setSelectedSupplier(s);
    setSupplierQuery(s.name);
    setNewSupplier(supplierFormValues(s));
    setSupplierResults([]);
    setIsNewSupplier(false);
  }

  function startNewSupplier() {
    setIsNewSupplier(true);
    setSelectedSupplier(null);
    // A genuinely new supplier starts empty, but with every key present so the
    // inputs stay controlled and a later save cannot send `undefined`.
    setNewSupplier(supplierFormValues({ name: supplierQuery }));
    setSupplierResults([]);
  }

  // Set by "Save & print" so the submit handler knows to land on the receipt
  // with the print dialog already opening. A ref rather than state: the click
  // happens in the same tick as the submit, and a state update would not have
  // landed by the time handleSubmit reads it.
  const printAfterSave = useRef(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');

    const validLines = lines.filter(
      (l) => (l.materialId || l.description?.trim()) && l.netWeight && l.price
    );
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
        phone: normalisePhone(newSupplier.phone),
        email: newSupplier.email || null,
        abn: newSupplier.abn || null,
        licenceNo: newSupplier.licenceNo || null,
        bankAccountName: newSupplier.bankAccountName || null,
        bankBsb: newSupplier.bankBsb || null,
        bankAccountNo: newSupplier.bankAccountNo || null,
        payId: newSupplier.payId || null,
      };

      // A picked supplier whose name still matches is updated in place, so edits made
      // here (new phone number, licence, address) are saved instead of silently
      // dropped. If the name was changed it's a different person, so create a new
      // record rather than renaming an existing client's history out from under them.
      const isSameSupplier =
        selectedSupplier && supplierName.toLowerCase() === selectedSupplier.name.trim().toLowerCase();

      let supplierId;
      if (isSameSupplier) {
        // Only what actually changed.
        //
        // Sending the whole record back on every docket meant a supplier's own
        // stored values were re-submitted untouched — and anything entered
        // before the field checks existed, an ABN that fails the ATO check
        // digit among them, was then rejected. Saving a docket failed on data
        // nobody had touched and the form could not even name. Re-submitting
        // values nobody edited was the mistake; a docket should write a
        // supplier only where the operator actually typed something.
        const same = (a, b) => (a ?? '') === (b ?? '');
        const changed = Object.fromEntries(
          Object.entries(supplierDetails).filter(
            ([key, value]) => !same(value, selectedSupplier[key])
          )
        );
        supplierId = selectedSupplier.id;
        if (Object.keys(changed).length) {
          const res = await api.patch(`/suppliers/${selectedSupplier.id}`, changed);
          supplierId = res.data.supplier.id;
        }
      } else {
        const res = await api.post('/suppliers', supplierDetails);
        supplierId = res.data.supplier.id;
      }

      const payload = {
        type,
        taxMode,
        supplierId,
        paygStatement,
        paymentStatus: payLater ? 'UNPAID' : 'PAID',
        ...discount,
        lineItems: validLines.map((l) => ({
          materialId: l.materialId || null,
          description: l.description?.trim() || null,
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

      // The docket page opens on the receipt and prints itself when asked.
      const suffix = printAfterSave.current ? '?print=receipt' : '';

      if (isEdit) {
        await api.patch(`/dockets/${editId}`, payload);
        navigate(`/${pathPrefix}/${editId}${suffix}`);
        return;
      }

      const res = await api.post('/dockets', payload);
      const newDocket = res.data.docket;
      navigate(`/${pathPrefix}/${newDocket.id}${suffix}`);
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save docket.'));
    } finally {
      setSubmitting(false);
      printAfterSave.current = false;
    }
  }

  function resetForm() {
    setSuccess(null);
    setLines(Array.from({ length: BLANK_LINE_COUNT }, () => ({ ...BLANK_LINE })));
    setSelectedSupplier(null);
    setSupplierQuery('');
    setIsNewSupplier(false);
    setVehicle({ reg: '', model: '', vin: '' });
    setShowVehicle(false);
  }

  if (loadingDocket) {
    return <div className="px-4 py-6 sm:px-6 lg:px-8 lg:py-8 text-sm text-steel-500">Loading…</div>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
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
            <div>
              <div className="font-semibold text-paper">
                {type === 'TAX_INVOICE' ? 'Tax invoice' : 'Purchase docket'}
              </div>
              {!editId && <div className="text-xs text-steel-400">Docket # assigned on save</div>}
            </div>
            <div className="flex items-center gap-3">
              <label className="text-xs text-steel-400">Amounts are</label>
              <select
                value={taxMode}
                onChange={(e) => setTaxMode(e.target.value)}
                className="rounded-md border border-steel-600 bg-steel-800 px-3 py-1.5 text-sm text-paper focus:border-copper-500 focus:outline-none"
              >
                {TAX_MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
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

            {/* The name is not repeated here. It was: this panel opened with a
                "Client Name" box holding the same value as the search above it,
                and the results list dropped straight over that box — so the name
                being typed was hidden behind a list of other names, in a second
                field that already said it. One field, typed once. */}
            <div className="mt-4 grid grid-cols-1 gap-3 rounded-md border border-steel-100 bg-paper p-4 sm:grid-cols-2">
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
                  type="email"
                  placeholder="Email"
                  value={newSupplier.email || ''}
                  onChange={(e) => setNewSupplier({ ...newSupplier, email: e.target.value })}
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
                {/* The weighbridge is exactly where a wrong ABN gets written
                    down, so this is the form that most needs to say whose it
                    is — before the PAYG declaration is made on it. */}
                <AbnField
                  id="docket-supplier-abn"
                  placeholder="ABN (if business)"
                  value={newSupplier.abn}
                  onChange={(abn) => setNewSupplier({ ...newSupplier, abn })}
                  className="w-full rounded-md border border-steel-200 px-3 py-2 text-sm"
                />

                {/* Saved against the supplier, not the docket, so the next load
                    from the same seller arrives with these already filled in and
                    a docket left unpaid can be settled from its own page. */}
                <div className="sm:col-span-2 mt-1 border-t border-steel-200 pt-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-steel-500">
                    Payment details
                    <span className="ml-2 font-medium normal-case tracking-normal text-steel-400">
                      Saved to this supplier for next time
                    </span>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input
                      placeholder="Account name"
                      value={newSupplier.bankAccountName || ''}
                      onChange={(e) =>
                        setNewSupplier({ ...newSupplier, bankAccountName: e.target.value })
                      }
                      className="sm:col-span-2 rounded-md border border-steel-200 px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="BSB"
                      value={newSupplier.bankBsb || ''}
                      onChange={(e) => setNewSupplier({ ...newSupplier, bankBsb: e.target.value })}
                      className="num rounded-md border border-steel-200 px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="Account number"
                      value={newSupplier.bankAccountNo || ''}
                      onChange={(e) =>
                        setNewSupplier({ ...newSupplier, bankAccountNo: e.target.value })
                      }
                      className="num rounded-md border border-steel-200 px-3 py-2 text-sm"
                    />
                    <input
                      placeholder="or PayID (email or mobile)"
                      value={newSupplier.payId || ''}
                      onChange={(e) => setNewSupplier({ ...newSupplier, payId: e.target.value })}
                      className="sm:col-span-2 rounded-md border border-steel-200 px-3 py-2 text-sm"
                    />
                  </div>
                </div>
              </div>

            <button
              type="button"
              onClick={() => setShowVehicle((v) => !v)}
              className="mt-3 text-sm font-medium text-steel-500 hover:text-copper-600"
            >
              {/* Was "(cash for cars)". The yard does not pay cash — NSW scrap
                  metal law requires EFT — so the label described something the
                  business does not do, on the one form a supplier may be
                  looking at over the operator's shoulder. */}
              {showVehicle ? '− Hide' : '+ Add'} vehicle details (end-of-life vehicles)
            </button>
            {showVehicle && (
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
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
            {/* Column headings only make sense once the row is actually a row */}
            <div className="mb-2 hidden gap-2 text-xs font-medium uppercase tracking-wider text-steel-500 sm:grid sm:grid-cols-[1fr_110px_110px_120px_32px]">
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
                    className="grid grid-cols-2 items-center gap-2 rounded-lg border border-steel-200 bg-paper/60 p-3 sm:grid-cols-[1fr_110px_110px_120px_32px] sm:rounded-none sm:border-0 sm:bg-transparent sm:p-0"
                  >
                    <MaterialField
                      materials={materials}
                      value={line.materialId}
                      description={line.description}
                      onSelect={(picked) => selectMaterial(idx, picked)}
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      aria-label="Net weight"
                      step="0.001"
                      min="0"
                      placeholder="Weight"
                      value={line.netWeight}
                      onChange={(e) => updateLine(idx, 'netWeight', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm sm:bg-paper sm:focus:bg-white"
                    />
                    <input
                      type="number"
                      inputMode="decimal"
                      aria-label="Rate"
                      step="any"
                      min="0"
                      placeholder="Rate"
                      value={line.price}
                      onChange={(e) => updateLine(idx, 'price', e.target.value)}
                      className="num rounded-md border border-steel-200 bg-white px-2.5 py-2 text-sm sm:bg-paper sm:focus:bg-white"
                    />
                    <div className="num text-sm font-medium text-steel-900 sm:text-right">
                      <span className="text-xs text-steel-400 sm:hidden">Value </span>
                      {value > 0 ? formatCurrency(value) : '—'}
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
            <div className="mb-1.5 text-sm font-medium text-steel-700">Payment</div>
            <label
              className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                payLater
                  ? 'border-working-amber/40 bg-working-amberDim'
                  : 'border-steel-200 bg-paper'
              }`}
            >
              <input
                type="checkbox"
                checked={payLater}
                onChange={(e) => setPayLater(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-copper-500"
              />
              <span className="text-sm">
                <span className="font-semibold text-steel-900">Pay this supplier later</span>
                <span className="mt-0.5 block text-steel-600">
                  {payLater
                    ? 'Saved as an unpaid draft. It appears in the payment run with the supplier’s account details, and is issued when you mark it paid.'
                    : 'The supplier has been paid, so the docket is issued as soon as it is saved — the figures are frozen and it cannot be edited afterwards. Tick the box if the transfer still has to be made.'}
                </span>
              </span>
            </label>
          </div>

          <div className="border-t border-steel-100 px-6 py-5">
            <DiscountField value={discount} onChange={setDiscount} subtotal={subtotal} />
          </div>

          {/* Figures on the dark plate are near-white. They were a mid grey with
              the total in the accent colour, which measured 4.2:1 and 3.0:1 on
              this ground — the total, the one number the operator reads back to
              the supplier, was the least legible thing on the form. */}
          <div className="border-t border-steel-200 bg-steel-950 px-6 py-5">
            <div className="ml-auto max-w-xs space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-steel-300">Subtotal</span>
                <span className="num font-semibold text-white">{formatCurrency(subtotal)}</span>
              </div>
              {discountAmount > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-steel-300">
                    Discount
                    {discount.discountType === 'PERCENT' ? ` (${discount.discountValue}%)` : ''}
                  </span>
                  <span className="num font-semibold text-white">− {formatCurrency(discountAmount)}</span>
                </div>
              )}
              {/* Only when GST is being ADDED. On an inclusive docket the tax is
                  already inside the total, so the line states a number that is
                  not part of the sum — it invited adding it on again, and the
                  printed docket has never shown it either. */}
              {taxMode === 'EXCLUSIVE' && (
                <div className="flex justify-between text-sm">
                  <span className="text-steel-300">GST (10%)</span>
                  <span className="num font-semibold text-white">{formatCurrency(gst)}</span>
                </div>
              )}
              <div className="flex justify-between border-t border-steel-700 pt-2 text-xl font-bold text-white">
                <span>Total</span>
                <span className="num">{formatCurrency(total)}</span>
              </div>
            </div>
          </div>
        </div>

        {error && (
          <div className="mt-4 rounded-md bg-working-redDim px-4 py-3 text-sm text-working-red">
            {error}
          </div>
        )}

        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            type="submit"
            onClick={() => {
              printAfterSave.current = false;
            }}
            disabled={submitting}
            className="rounded-md border border-steel-300 bg-white px-6 py-3 text-sm font-semibold text-steel-800 transition-colors hover:bg-paper disabled:opacity-60"
          >
            {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Save docket'}
          </button>
          {/* The weighbridge case: the supplier is standing there waiting for
              their copy, so saving and printing is one action rather than a
              save followed by finding the record and choosing a format. */}
          <button
            type="submit"
            onClick={() => {
              printAfterSave.current = true;
            }}
            disabled={submitting}
            className="rounded-md bg-copper-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-copper-400 disabled:opacity-60"
          >
            {submitting ? 'Saving…' : 'Save & print receipt'}
          </button>
        </div>
      </form>
    </div>
  );
}
