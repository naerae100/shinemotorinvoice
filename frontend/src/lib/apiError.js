/**
 * Turn an API error into something worth showing a person.
 *
 * The server validates with zod and returns `error.fieldErrors`, which already
 * says exactly what is wrong and why — "A BSB is six digits, like 032-372."
 * Every form was throwing that away and showing "Could not save supplier",
 * which tells the operator nothing except that their work did not save. One
 * page handled email and nothing else.
 */

// Field names as the person filling the form knows them, not as the schema
// spells them. Only the ones that are not obvious need an entry.
const LABELS = {
  bankBsb: 'BSB',
  bankAccountNo: 'Account number',
  bankAccountName: 'Account name',
  payId: 'PayID',
  abn: 'ABN',
  licenceNo: 'Licence no.',
  groupName: 'Group',
  defaultCurrency: 'Usual currency',
  defaultShippingTerm: 'Usual shipping term',
  consigneeId: 'Consignee',
  supplierId: 'Supplier',
  lineItems: 'Material lines',
  invoiceNumber: 'Invoice number',
  netWeightMt: 'Net weight',
  pricePerMt: 'Price per MT',
  paymentMethod: 'Payment method',
};

const label = (key) =>
  LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());

/**
 * @param {unknown} err       the thrown axios error
 * @param {string}  fallback  what to say when the server gave nothing useful
 */
export function apiErrorMessage(err, fallback = 'Something went wrong.') {
  const payload = err?.response?.data?.error;

  if (typeof payload === 'string') return payload;

  if (payload && typeof payload === 'object') {
    // A zod flatten(): field-level messages first, since they name the box to
    // go and fix.
    const fields = payload.fieldErrors || {};
    for (const [key, messages] of Object.entries(fields)) {
      const first = Array.isArray(messages) ? messages[0] : messages;
      if (first) {
        // The message often reads as a complete sentence on its own; only
        // prefix the field when it does not already name itself.
        return first.toLowerCase().includes(label(key).toLowerCase())
          ? first
          : `${label(key)}: ${first}`;
      }
    }
    const form = payload.formErrors;
    if (Array.isArray(form) && form[0]) return form[0];
  }

  return fallback;
}
