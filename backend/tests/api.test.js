import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  fixtures,
  hasTestDatabase,
  loginAdmin,
  serverAlive,
  startTestServer,
  stopTestServer,
  ADMIN_CREDENTIALS,
} from './helpers.js';

// Without a scratch database these cannot run. Skipping loudly is the point:
// a suite that silently reports success while testing nothing is worse than
// no suite, because it will wave a regression straight through.
if (!hasTestDatabase) {
  console.warn(
    '\n  ! SKIPPING %d API integration tests — TEST_DATABASE_URL is not set.\n' +
      '    These need a scratch PostgreSQL database. See tests/helpers.js.\n',
    76
  );
}

// Every suite in this file needs the database; alias once rather than guarding
// each test individually.
const suite = hasTestDatabase ? describe : describe.skip;

// A skipped suite reports nothing, so the run would still read "fail 0" with a
// clean conscience. This sentinel puts a skip on the scoreboard.
if (!hasTestDatabase) {
  test(
    'API integration tests are configured',
    { skip: 'TEST_DATABASE_URL is not set — 76 API tests did NOT run' },
    () => {}
  );
}

let token;
let fx;

before(async () => {
  if (!hasTestDatabase) return;
  await startTestServer();
  token = await loginAdmin();
  fx = await fixtures(token);
});

after(async () => {
  if (hasTestDatabase) await stopTestServer();
});

const line = (materialId, netWeight = 100, price = 10) => ({ materialId, netWeight, price });

async function createDocket(overrides = {}) {
  const res = await api('POST', '/dockets', {
    token,
    body: {
      supplierId: fx.supplier.id,
      lineItems: [line(fx.materials[0].id)],
      ...overrides,
    },
  });
  return res;
}

suite('auth', () => {
  test('valid credentials return a token and the user', async () => {
    const res = await api('POST', '/auth/login', { body: ADMIN_CREDENTIALS });
    assert.equal(res.status, 200);
    assert.ok(res.body.token);
    assert.equal(res.body.user.role, 'ADMIN');
    assert.equal(res.body.user.passwordHash, undefined, 'must never return the hash');
  });

  test('wrong password is rejected without revealing which part was wrong', async () => {
    const res = await api('POST', '/auth/login', {
      body: { ...ADMIN_CREDENTIALS, password: 'wrong-password' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid credentials');
  });

  test('unknown email gives the same message as a wrong password', async () => {
    const res = await api('POST', '/auth/login', {
      body: { email: 'nobody@example.com', password: 'whatever123' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, 'Invalid credentials');
  });

  test('protected routes reject a missing or garbage token', async () => {
    assert.equal((await api('GET', '/dockets')).status, 401);
    assert.equal((await api('GET', '/dockets', { token: 'not-a-jwt' })).status, 401);
  });
});

suite('dockets — totals', () => {
  // GST used to be derived from the document type. It is now an explicit
  // taxMode on the docket, because a scrap purchase may be from a registered
  // supplier (GST applies) or not, and the operator is the one who knows.
  test('EXCLUSIVE adds 10% on top of the line prices', async () => {
    const res = await createDocket({ taxMode: 'EXCLUSIVE' });
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.docket.gst), 100);
    assert.equal(Number(res.body.docket.total), 1100);
  });

  test('INCLUSIVE treats the line prices as already containing GST', async () => {
    const res = await createDocket({ taxMode: 'INCLUSIVE' });
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.docket.gst), 90.91, 'one eleventh of 1000');
    assert.equal(Number(res.body.docket.total), 1000, 'the total must not grow');
  });

  test('NO_TAX records no GST at all', async () => {
    const res = await createDocket({ taxMode: 'NO_TAX' });
    assert.equal(Number(res.body.docket.gst), 0);
    assert.equal(Number(res.body.docket.total), 1000);
  });

  // The yard quotes a rate per kilo with GST already in it, so a new docket
  // assumes inclusive rather than adding 10% to the number the operator typed.
  test('taxMode defaults to INCLUSIVE when the client sends none', async () => {
    const res = await createDocket({});
    assert.equal(res.body.docket.taxMode, 'INCLUSIVE');
    assert.equal(Number(res.body.docket.total), 1000, 'the quoted price is the total');
    assert.equal(Number(res.body.docket.gst), 90.91, 'GST is inside it');
  });

  test('a one-off grade can be typed onto a docket without a material record', async () => {
    const res = await createDocket({
      lineItems: [{ description: 'Mixed brass turnings', netWeight: 12.345, price: 6.789 }],
    });
    assert.equal(res.status, 201);
    const li = res.body.docket.lineItems[0];
    assert.equal(li.materialId, null);
    assert.equal(li.description, 'Mixed brass turnings');
    assert.equal(Number(li.value), 83.81, '12.345 x 6.789 rounded to the cent');
  });

  test('a docket line with neither a material nor a description is rejected', async () => {
    const res = await createDocket({ lineItems: [{ netWeight: 5, price: 2 }] });
    assert.equal(res.status, 400);
  });

  test('prices carry more than two decimals', async () => {
    const res = await createDocket({
      lineItems: [{ description: 'Bright copper wire', netWeight: 19, price: 2.990988 }],
    });
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.docket.lineItems[0].price), 2.990988, 'the rate is kept as typed');
    assert.equal(Number(res.body.docket.lineItems[0].value), 56.83, 'only the value is rounded');
  });

  test('an unrecognised taxMode is rejected rather than silently defaulted', async () => {
    const res = await createDocket({ taxMode: 'SOMETIMES' });
    assert.equal(res.status, 400);
  });

  test('the document type no longer decides GST — taxMode does', async () => {
    const purchase = await createDocket({ type: 'PURCHASE_DOCKET', taxMode: 'EXCLUSIVE' });
    const invoice = await createDocket({ type: 'TAX_INVOICE', taxMode: 'NO_TAX' });
    assert.equal(Number(purchase.body.docket.gst), 100);
    assert.equal(Number(invoice.body.docket.gst), 0);
  });

  test('discount is applied and GST computed on the reduced amount', async () => {
    const res = await createDocket({
      taxMode: 'EXCLUSIVE',
      discountType: 'PERCENT',
      discountValue: 10,
    });
    const d = res.body.docket;
    assert.equal(Number(d.discountAmount), 100);
    assert.equal(Number(d.gst), 90);
    assert.equal(Number(d.total), 990);
  });

  test('an INCLUSIVE discount comes off a GST-inclusive price', async () => {
    const res = await createDocket({
      taxMode: 'INCLUSIVE',
      discountType: 'FIXED',
      discountValue: 340,
    });
    const d = res.body.docket;
    assert.equal(Number(d.gst), 60, 'one eleventh of the discounted 660');
    assert.equal(Number(d.total), 660);
  });

  test('an oversized discount cannot produce a negative total', async () => {
    const res = await createDocket({ discountType: 'FIXED', discountValue: 99999 });
    assert.equal(Number(res.body.docket.total), 0);
  });

  test('subtotal equals the sum of the stored line values', async () => {
    const res = await createDocket({
      lineItems: [line(fx.materials[0].id, 1, 0.125), line(fx.materials[0].id, 1, 0.125)],
    });
    const d = res.body.docket;
    const lineSum = d.lineItems.reduce((s, li) => s + Number(li.value), 0);
    assert.equal(Number(d.subtotal), lineSum);
    assert.equal(Number(d.subtotal), 0.26);
  });

  test('a docket with no line items is rejected', async () => {
    const res = await createDocket({ lineItems: [] });
    assert.equal(res.status, 400);
  });

  test('a negative weight is rejected', async () => {
    const res = await createDocket({ lineItems: [line(fx.materials[0].id, -5, 10)] });
    assert.equal(res.status, 400);
  });

  // A docket's tax treatment is part of the record. Editing the lines of an
  // untaxed docket must not quietly reinterpret it as taxable and inflate a
  // historical total by 10%.
  test('editing the lines does not change a stored NO_TAX docket to taxable', async () => {
    const created = await createDocket({ taxMode: 'NO_TAX' });
    assert.equal(Number(created.body.docket.gst), 0);

    const res = await api('PATCH', `/dockets/${created.body.docket.id}`, {
      token,
      body: { lineItems: [line(fx.materials[0].id, 1, 500)] },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.docket.taxMode, 'NO_TAX', 'the stored mode must survive the edit');
    assert.equal(Number(res.body.docket.gst), 0, 'no GST may appear out of nowhere');
    assert.equal(Number(res.body.docket.total), 500);
  });

  test('changing taxMode recomputes the totals', async () => {
    const created = await createDocket({ taxMode: 'NO_TAX' });
    const res = await api('PATCH', `/dockets/${created.body.docket.id}`, {
      token,
      body: { taxMode: 'EXCLUSIVE' },
    });
    assert.equal(res.status, 200);
    assert.equal(Number(res.body.docket.gst), 100);
    assert.equal(Number(res.body.docket.total), 1100);
  });
});

suite('dockets — numbering under concurrency', () => {
  test('12 simultaneous saves all succeed with distinct sequential numbers', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => createDocket()));
    assert.ok(
      results.every((r) => r.status === 201),
      `expected all 201, got ${results.map((r) => r.status).join(',')}`
    );
    const numbers = results.map((r) => r.body.docket.docketNumber);
    assert.equal(new Set(numbers).size, 12, 'docket numbers must be unique');
    assert.ok(await serverAlive(), 'server must survive the collision retries');
  });
});

suite('dockets — void lifecycle', () => {
  test('voiding requires a reason', async () => {
    const { body } = await createDocket();
    const res = await api('POST', `/dockets/${body.docket.id}/void`, { token, body: {} });
    assert.equal(res.status, 400);
  });

  test('a voided docket keeps its number, records who and why, and can be restored', async () => {
    const { body } = await createDocket();
    const id = body.docket.id;
    const number = body.docket.docketNumber;

    const voided = await api('POST', `/dockets/${id}/void`, {
      token,
      body: { reason: 'Weighbridge error' },
    });
    assert.equal(voided.status, 200);
    assert.equal(voided.body.docket.status, 'VOID');
    assert.equal(voided.body.docket.docketNumber, number, 'number is retained');
    assert.equal(voided.body.docket.voidReason, 'Weighbridge error');
    assert.ok(voided.body.docket.voidedBy?.name, 'records who voided it');

    const edit = await api('PATCH', `/dockets/${id}`, { token, body: { notes: 'nope' } });
    assert.equal(edit.status, 409, 'a voided docket cannot be edited');

    const restored = await api('POST', `/dockets/${id}/restore`, { token });
    assert.equal(restored.body.docket.status, 'ACTIVE');
    assert.equal(restored.body.docket.voidReason, null);
  });

  test('voided dockets are hidden by default and excluded from the filtered total', async () => {
    // NO_TAX keeps the arithmetic here about voiding rather than about GST.
    const { body } = await createDocket({
      taxMode: 'NO_TAX',
      lineItems: [line(fx.materials[0].id, 100, 10)],
    });
    const id = body.docket.id;

    const before = await api('GET', '/dockets?pageSize=100', { token });
    await api('POST', `/dockets/${id}/void`, { token, body: { reason: 'test' } });
    const after = await api('GET', '/dockets?pageSize=100', { token });

    assert.equal(after.body.totalCount, before.body.totalCount - 1);
    assert.ok(
      Math.abs(before.body.filteredTotals.total - after.body.filteredTotals.total - 1000) < 0.01,
      'the voided value leaves the total'
    );
    assert.ok(!after.body.dockets.some((d) => d.id === id));

    const all = await api('GET', '/dockets?status=ALL&pageSize=100', { token });
    assert.ok(all.body.dockets.some((d) => d.id === id), 'status=ALL still shows it');
  });

  test('voided dockets are excluded from dashboard analytics', async () => {
    const { body } = await createDocket({ lineItems: [line(fx.materials[0].id, 1000, 10)] });
    const before = await api('GET', '/reports/overview', { token });
    await api('POST', `/dockets/${body.docket.id}/void`, { token, body: { reason: 'test' } });
    const after = await api('GET', '/reports/overview', { token });
    assert.ok(
      before.body.purchases.total - after.body.purchases.total > 9000,
      'a voided docket must not sit in a reported total'
    );
  });
});

suite('invoices', () => {
  const invoiceLine = (materialId) => ({ materialId, netWeightMt: 10, pricePerMt: 1000 });

  async function createInvoice(overrides = {}) {
    return api('POST', '/invoices', {
      token,
      body: {
        invoiceNumber: `INV-${Math.random().toString(36).slice(2, 10)}`,
        consigneeId: fx.consignee.id,
        lineItems: [invoiceLine(fx.materials[0].id)],
        ...overrides,
      },
    });
  }

  test('export grades and purchase materials are separate vocabularies', async () => {
    const purchase = await api('GET', '/materials?kind=PURCHASE', { token });
    const exported = await api('GET', '/materials?kind=EXPORT', { token });
    assert.equal(purchase.status, 200);
    assert.equal(exported.status, 200);
    // The seeded price list is PURCHASE, so no purchase row may claim to be an
    // export grade and vice versa; a docket must never offer a selling name.
    assert.ok(purchase.body.materials.every((m) => m.kind === 'PURCHASE'));
    assert.ok(exported.body.materials.every((m) => m.kind === 'EXPORT'));

    const all = await api('GET', '/materials', { token });
    assert.ok(all.body.materials.length >= purchase.body.materials.length);
  });

  test('a new record is an invoice unless it says otherwise', async () => {
    const res = await createInvoice();
    assert.equal(res.body.invoice.stage, 'INVOICED');
  });

  test('a packing slip is saved at the packing-slip stage', async () => {
    const res = await createInvoice({
      stage: 'PACKING_SLIP',
      lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 23.298, pricePerMt: 0 }],
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.invoice.stage, 'PACKING_SLIP');
    assert.equal(Number(res.body.invoice.total), 0);
  });

  test('the sales list excludes packing slips, and the slip list excludes sales', async () => {
    const slip = await createInvoice({
      stage: 'PACKING_SLIP',
      lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 12, pricePerMt: 0 }],
    });
    const sale = await createInvoice();
    const slipNo = slip.body.invoice.invoiceNumber;
    const saleNo = sale.body.invoice.invoiceNumber;

    // An unpriced slip in the sales list would read as a sale worth nothing.
    const sales = await api('GET', '/invoices?pageSize=200', { token });
    const salesNumbers = sales.body.invoices.map((i) => i.invoiceNumber);
    assert.ok(salesNumbers.includes(saleNo));
    assert.ok(!salesNumbers.includes(slipNo));

    const slips = await api('GET', '/invoices?stage=PACKING_SLIP&pageSize=200', { token });
    const slipNumbers = slips.body.invoices.map((i) => i.invoiceNumber);
    assert.ok(slipNumbers.includes(slipNo));
    assert.ok(!slipNumbers.includes(saleNo));
  });

  test('pricing a packing slip turns it into an invoice, keeping its net weight', async () => {
    const slip = await createInvoice({
      stage: 'PACKING_SLIP',
      lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 23.298, pricePerMt: 0 }],
    });
    const id = slip.body.invoice.id;

    const priced = await api('PATCH', `/invoices/${id}`, {
      token,
      body: {
        stage: 'INVOICED',
        lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 23.298, pricePerMt: 1900 }],
      },
    });

    assert.equal(priced.status, 200);
    assert.equal(priced.body.invoice.stage, 'INVOICED');
    // The weight the packing list stated is the weight that gets billed.
    assert.equal(Number(priced.body.invoice.lineItems[0].netWeightMt), 23.298);
    assert.equal(Number(priced.body.invoice.total), 44266.2);
    // And it keeps the number it was created under, as the pair is filed together.
    assert.equal(priced.body.invoice.invoiceNumber, slip.body.invoice.invoiceNumber);
  });

  test('a priced shipment stays editable, and the invoice follows the weights', async () => {
    const slip = await createInvoice({
      stage: 'PACKING_SLIP',
      lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 20.5, pricePerMt: 0 }],
    });
    const id = slip.body.invoice.id;

    await api('PATCH', `/invoices/${id}`, {
      token,
      body: {
        stage: 'INVOICED',
        lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 20.5, pricePerMt: 900 }],
      },
    });

    // A weighbridge correction after pricing has to reach both documents: the
    // packing list and the invoice are one record, so the total must follow.
    const corrected = await api('PATCH', `/invoices/${id}`, {
      token,
      body: { lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 24.5, pricePerMt: 900 }] },
    });
    assert.equal(corrected.status, 200);
    assert.equal(corrected.body.invoice.stage, 'INVOICED', 'a plain edit does not change stage');
    assert.equal(Number(corrected.body.invoice.lineItems[0].netWeightMt), 24.5);
    assert.equal(Number(corrected.body.invoice.total), 22050);
  });

  test('stage only moves forward — a priced invoice cannot be demoted to a slip', async () => {
    const slip = await createInvoice({
      stage: 'PACKING_SLIP',
      lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 10, pricePerMt: 0 }],
    });
    const id = slip.body.invoice.id;
    await api('PATCH', `/invoices/${id}`, {
      token,
      body: {
        stage: 'INVOICED',
        lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 10, pricePerMt: 1000 }],
      },
    });

    // Opening a priced shipment through its packing-slip view and saving must
    // not push it back: that would drop a real sale out of every total, report
    // and buyer ranking with nothing said.
    const demoted = await api('PATCH', `/invoices/${id}`, {
      token,
      body: { stage: 'PACKING_SLIP' },
    });
    assert.equal(demoted.status, 409);

    const after = await api('GET', `/invoices/${id}`, { token });
    assert.equal(after.body.invoice.stage, 'INVOICED', 'still an invoice');
  });

  test('an export invoice is GST-free by default', async () => {
    const res = await createInvoice();
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.invoice.gst), 0);
    assert.equal(Number(res.body.invoice.total), 10000);
  });

  test('a local sale applies 10% GST when the operator ticks it', async () => {
    const res = await createInvoice({ applyGst: true });
    assert.equal(Number(res.body.invoice.gst), 1000);
    assert.equal(Number(res.body.invoice.total), 11000);
  });

  test('discount and GST combine in the right order', async () => {
    const res = await createInvoice({
      applyGst: true,
      discountType: 'PERCENT',
      discountValue: 5,
    });
    const i = res.body.invoice;
    assert.equal(Number(i.discountAmount), 500);
    assert.equal(Number(i.gst), 950);
    assert.equal(Number(i.total), 10450);
  });

  test('a duplicate invoice number is rejected with 409, not a crash', async () => {
    const number = `DUP-${Date.now()}`;
    assert.equal((await createInvoice({ invoiceNumber: number })).status, 201);
    const second = await createInvoice({ invoiceNumber: number });
    assert.equal(second.status, 409);
    assert.ok(await serverAlive());
  });

  // ── Currency ───────────────────────────────────────────────────────────────
  test('an invoice defaults to AUD and records amounts unconverted', async () => {
    const res = await createInvoice();
    assert.equal(res.body.invoice.currency, 'AUD');
  });

  test('a USD invoice keeps its figures in USD, with no AUD equivalent', async () => {
    const res = await createInvoice({ currency: 'USD' });
    assert.equal(res.status, 201);
    assert.equal(res.body.invoice.currency, 'USD');
    assert.equal(Number(res.body.invoice.total), 10000, 'the number is not converted');
  });

  test('an unsupported currency is rejected', async () => {
    assert.equal((await createInvoice({ currency: 'EUR' })).status, 400);
  });

  // ── Bank details follow the currency ───────────────────────────────────────
  test('an AUD invoice snapshots the AUD account, not the USD one', async () => {
    const res = await createInvoice({ currency: 'AUD' });
    const snap = res.body.invoice.bankSnapshot;
    assert.equal(typeof snap, 'object');
    assert.equal(snap.currency, 'AUD');
    assert.equal(snap.bankBsb, '111-111', 'the AUD account, not the USD one');
  });

  test('a USD invoice snapshots the USD account', async () => {
    const res = await createInvoice({ currency: 'USD' });
    const snap = res.body.invoice.bankSnapshot;
    assert.equal(snap.currency, 'USD');
    assert.equal(snap.bankBsb, '222-222', 'the USD account');
    assert.notEqual(snap.bankAccountNo, '1111111', 'must not be the AUD account');
  });

  test('editing an invoice does NOT change its bank snapshot', async () => {
    const created = await createInvoice();
    const original = created.body.invoice.bankSnapshot;
    await api('PUT', '/settings/bank-accounts/AUD', {
      token,
      body: { bankName: 'A DIFFERENT BANK', bsb: '999-999', accountNo: '111111' },
    });
    const edited = await api('PATCH', `/invoices/${created.body.invoice.id}`, {
      token,
      body: { poNumber: 'PO-123' },
    });
    assert.deepEqual(
      edited.body.invoice.bankSnapshot,
      original,
      'the buyer may already have paid against these details'
    );
    // Put it back so later tests see the seeded account.
    await api('PUT', '/settings/bank-accounts/AUD', {
      token,
      body: {
        bankName: 'TESTPAC',
        swift: 'TESTAU2S',
        accountNo: '1111111',
        bsb: '111-111',
        bankAddress: '1 Test Street, Sydney',
        beneficiary: 'TEST BENEFICIARY PTY LTD',
      },
    });
  });

  test('switching an invoice to USD re-snapshots the USD account', async () => {
    const created = await createInvoice({ currency: 'AUD' });
    assert.equal(created.body.invoice.bankSnapshot.currency, 'AUD');
    const edited = await api('PATCH', `/invoices/${created.body.invoice.id}`, {
      token,
      body: { currency: 'USD' },
    });
    assert.equal(
      edited.body.invoice.bankSnapshot.currency,
      'USD',
      'an AUD account on a USD invoice would misroute the wire'
    );
  });

  // ── Containers ─────────────────────────────────────────────────────────────
  test('an invoice can carry two containers, each with its own goods', async () => {
    const res = await createInvoice({
      containers: [
        { containerNo: 'TCLU2826920', seal: '163551', containerType: '1 x 20FT' },
        { containerNo: 'CMAU1910020', seal: '163552', containerType: '1 x 20FT' },
      ],
      lineItems: [
        { ...invoiceLine(fx.materials[0].id), containerIndex: 0 },
        { ...invoiceLine(fx.materials[0].id), containerIndex: 1 },
      ],
    });
    assert.equal(res.status, 201);
    const i = res.body.invoice;
    assert.equal(i.containers.length, 2);
    assert.equal(i.containers[0].containerNo, 'TCLU2826920');
    assert.equal(i.containers[1].seal, '163552');
    const linked = i.lineItems.map((li) => li.containerId);
    assert.equal(new Set(linked).size, 2, 'each line sits in its own container');
    assert.equal(Number(i.total), 20000);
  });

  test('a line pointing at a container that was not supplied is rejected', async () => {
    const res = await createInvoice({
      containers: [{ containerNo: 'ONE' }],
      lineItems: [{ ...invoiceLine(fx.materials[0].id), containerIndex: 3 }],
    });
    assert.equal(res.status, 400);
    assert.ok(await serverAlive());
  });

  test('containers are optional — a single-container shipment need not name one', async () => {
    const res = await createInvoice({ containers: [] });
    assert.equal(res.status, 201);
    assert.equal(res.body.invoice.containers.length, 0);
  });

  // ── Free-text products ─────────────────────────────────────────────────────
  test('a one-off product can be typed without being in the material list', async () => {
    const res = await createInvoice({
      lineItems: [
        { description: 'Millberry- Grade B', netWeightMt: 20.787, pricePerMt: 14058.89 },
      ],
    });
    assert.equal(res.status, 201);
    const li = res.body.invoice.lineItems[0];
    assert.equal(li.materialId, null);
    assert.equal(li.description, 'Millberry- Grade B');
    assert.equal(Number(li.total), 292242.15, 'rounded to the cent');
  });

  test('a line with neither a material nor a description is rejected', async () => {
    const res = await createInvoice({
      lineItems: [{ netWeightMt: 5, pricePerMt: 100 }],
    });
    assert.equal(res.status, 400);
  });

  // ── Packing-list weights ───────────────────────────────────────────────────
  test('gross and tare are stored alongside the net that gets billed', async () => {
    const res = await createInvoice({
      lineItems: [
        {
          description: 'COMPRESSORS- ANZ',
          packageCount: '16 IBC',
          grossWeightMt: 24.13,
          tareWeightMt: 0.832,
          netWeightMt: 23.298,
          pricePerMt: 1900,
        },
      ],
    });
    assert.equal(res.status, 201);
    const li = res.body.invoice.lineItems[0];
    assert.equal(Number(li.grossWeightMt), 24.13);
    assert.equal(Number(li.tareWeightMt), 0.832);
    assert.equal(li.packageCount, '16 IBC');
    assert.equal(Number(res.body.invoice.total), 44266.2, 'billed on the net weight');
  });

  test('a net weight that does not equal gross minus tare is rejected', async () => {
    const res = await createInvoice({
      lineItems: [
        {
          description: 'Mismatched',
          grossWeightMt: 24.13,
          tareWeightMt: 0.832,
          netWeightMt: 20,
          pricePerMt: 1900,
        },
      ],
    });
    assert.equal(res.status, 400, 'the packing list must add up');
  });
});

suite('authenticity — records cannot be erased or silently changed', () => {
  test('a docket cannot be deleted, only voided', async () => {
    const { body } = await createDocket();
    const res = await api('DELETE', `/dockets/${body.docket.id}`, { token });
    assert.equal(res.status, 405, 'a numbered docket must survive');

    const still = await api('GET', `/dockets/${body.docket.id}`, { token });
    assert.equal(still.status, 200, 'and it is still there afterwards');
    assert.ok(await serverAlive());
  });

  test('an invoice cannot be deleted either', async () => {
    const created = await api('POST', '/invoices', {
      token,
      body: {
        invoiceNumber: `NODEL-${Math.random().toString(36).slice(2, 9)}`,
        consigneeId: fx.consignee.id,
        lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 1, pricePerMt: 100 }],
      },
    });
    const res = await api('DELETE', `/invoices/${created.body.invoice.id}`, { token });
    assert.equal(res.status, 405);
  });

  test('creating, editing and voiding a docket each leave an audit event', async () => {
    const { body } = await createDocket({ taxMode: 'NO_TAX' });
    const id = body.docket.id;

    await api('PATCH', `/dockets/${id}`, { token, body: { taxMode: 'EXCLUSIVE' } });
    await api('POST', `/dockets/${id}/void`, { token, body: { reason: 'audit test' } });

    const res = await api('GET', `/audit?entity=Docket&entityId=${id}`, { token });
    assert.equal(res.status, 200);
    const actions = res.body.events.map((e) => e.action);
    for (const expected of ['CREATE', 'UPDATE', 'VOID']) {
      assert.ok(actions.includes(expected), `expected a ${expected} event, got ${actions}`);
    }

    const update = res.body.events.find((e) => e.action === 'UPDATE');
    assert.equal(update.before.taxMode, 'NO_TAX', 'records what it was');
    assert.equal(update.after.taxMode, 'EXCLUSIVE', 'and what it became');
    assert.ok(update.actorEmail, 'and who did it');
  });

  test('the audit trail is admin-only and read-only', async () => {
    const email = `auditstaff-${Date.now()}@example.com`;
    await api('POST', '/users', {
      token,
      body: { name: 'Audit Staff', email, password: 'StaffPass1234', role: 'STAFF' },
    });
    const staff = (await api('POST', '/auth/login', { body: { email, password: 'StaffPass1234' } }))
      .body.token;
    assert.equal((await api('GET', '/audit', { token: staff })).status, 403);
    // There is no write route at all — a POST must not be handled.
    const res = await api('POST', '/audit', { token, body: { action: 'FORGED' } });
    assert.ok(res.status === 404 || res.status === 405, `got ${res.status}`);
  });

  test('an issued docket can no longer be edited', async () => {
    const { body } = await createDocket();
    const id = body.docket.id;

    const issued = await api('POST', `/dockets/${id}/issue`, { token });
    assert.equal(issued.status, 200);
    assert.ok(issued.body.docket.issuedAt);

    const edit = await api('PATCH', `/dockets/${id}`, { token, body: { notes: 'changed' } });
    assert.equal(edit.status, 409, 'the supplier already has this document');

    // Voiding stays available — that is the correction path.
    const voided = await api('POST', `/dockets/${id}/void`, { token, body: { reason: 'wrong' } });
    assert.equal(voided.status, 200);
  });

  test('issuing is one-way', async () => {
    const { body } = await createDocket();
    await api('POST', `/dockets/${body.docket.id}/issue`, { token });
    const again = await api('POST', `/dockets/${body.docket.id}/issue`, { token });
    assert.equal(again.status, 409);
  });
});

suite('sessions can be withdrawn', () => {
  test('changing a password signs out other devices but not this one', async () => {
    const email = `rotate-${Date.now()}@example.com`;
    const created = await api('POST', '/users', {
      token,
      body: { name: 'Rotate', email, password: 'FirstPassword1', role: 'STAFF' },
    });
    assert.equal(created.status, 201);

    const first = await api('POST', '/auth/login', {
      body: { email, password: 'FirstPassword1' },
    });
    const oldToken = first.body.token;
    assert.equal((await api('GET', '/auth/me', { token: oldToken })).status, 200);

    const changed = await api('POST', '/users/me/password', {
      token: oldToken,
      body: { currentPassword: 'FirstPassword1', newPassword: 'SecondPassword2' },
    });
    assert.equal(changed.status, 200);
    assert.ok(changed.body.token, 'a replacement token is issued for this device');

    assert.equal(
      (await api('GET', '/auth/me', { token: oldToken })).status,
      401,
      'the old token is dead everywhere else'
    );
    assert.equal(
      (await api('GET', '/auth/me', { token: changed.body.token })).status,
      200,
      'but the caller stays signed in'
    );
  });

  test('sign out everywhere kills the token that asked for it', async () => {
    const email = `revoke-${Date.now()}@example.com`;
    await api('POST', '/users', {
      token,
      body: { name: 'Revoke', email, password: 'RevokeMe12345', role: 'STAFF' },
    });
    const login = await api('POST', '/auth/login', { body: { email, password: 'RevokeMe12345' } });
    const t = login.body.token;

    assert.equal((await api('POST', '/auth/sign-out-everywhere', { token: t })).status, 200);
    assert.equal((await api('GET', '/auth/me', { token: t })).status, 401);
  });

  test('deactivating a user ends their session immediately', async () => {
    const email = `deact-${Date.now()}@example.com`;
    const created = await api('POST', '/users', {
      token,
      body: { name: 'Deact', email, password: 'DeactivateM1', role: 'STAFF' },
    });
    const login = await api('POST', '/auth/login', { body: { email, password: 'DeactivateM1' } });
    const t = login.body.token;
    assert.equal((await api('GET', '/auth/me', { token: t })).status, 200);

    await api('PATCH', `/users/${created.body.user.id}`, { token, body: { active: false } });
    assert.equal(
      (await api('GET', '/auth/me', { token: t })).status,
      401,
      'a sacked employee must not keep working for 12 hours'
    );
  });
});

suite('permissions', () => {
  let staffToken;

  before(async () => {
    await api('POST', '/users', {
      token,
      body: {
        name: 'Yard Staff',
        email: 'staff@shinemotor.com.au',
        password: 'StaffPassword1',
        role: 'STAFF',
      },
    });
    const res = await api('POST', '/auth/login', {
      body: { email: 'staff@shinemotor.com.au', password: 'StaffPassword1' },
    });
    staffToken = res.body.token;
  });

  test('staff can write dockets', async () => {
    const res = await api('POST', '/dockets', {
      token: staffToken,
      body: { supplierId: fx.supplier.id, lineItems: [line(fx.materials[0].id)] },
    });
    assert.equal(res.status, 201);
  });

  test('staff cannot change material prices', async () => {
    const res = await api('PATCH', `/materials/${fx.materials[0].id}`, {
      token: staffToken,
      body: { currentPrice: 999 },
    });
    assert.equal(res.status, 403);
  });

  test('staff cannot list or create users', async () => {
    assert.equal((await api('GET', '/users', { token: staffToken })).status, 403);
    assert.equal(
      (
        await api('POST', '/users', {
          token: staffToken,
          body: { name: 'X', email: 'x@y.com', password: 'password123' },
        })
      ).status,
      403
    );
  });

  // Deleting a docket used to be an admin power. It is now refused for everyone,
  // including admins: a docket number is a legal reference and voiding is the
  // correction path. See the authenticity suite.
  test('not even an admin can permanently delete a docket', async () => {
    const { body } = await createDocket();
    const res = await api('DELETE', `/dockets/${body.docket.id}`, { token });
    assert.equal(res.status, 405);
    assert.equal(
      (await api('GET', `/dockets/${body.docket.id}`, { token })).status,
      200,
      'the record survives'
    );
  });

  test('the last active admin cannot be demoted or deactivated', async () => {
    const users = (await api('GET', '/users', { token })).body.users;
    const admin = users.find((u) => u.role === 'ADMIN');
    assert.equal(
      (await api('PATCH', `/users/${admin.id}`, { token, body: { role: 'STAFF' } })).status,
      409
    );
    assert.equal((await api('POST', `/users/${admin.id}/deactivate`, { token })).status, 409);
  });

  test('a deactivated user can no longer sign in', async () => {
    const created = await api('POST', '/users', {
      token,
      body: {
        name: 'Temp',
        email: `temp${Date.now()}@shinemotor.com.au`,
        password: 'TempPassword1',
        role: 'STAFF',
      },
    });
    const email = created.body.user.email;
    assert.equal(
      (await api('POST', '/auth/login', { body: { email, password: 'TempPassword1' } })).status,
      200
    );
    await api('POST', `/users/${created.body.user.id}/deactivate`, { token });
    assert.equal(
      (await api('POST', '/auth/login', { body: { email, password: 'TempPassword1' } })).status,
      401
    );
  });

  test('a password shorter than 8 characters is rejected', async () => {
    const res = await api('POST', '/users', {
      token,
      body: { name: 'X', email: 'short@shinemotor.com.au', password: 'abc' },
    });
    assert.equal(res.status, 400);
  });
});

suite('error handling — bad input must never take the API down', () => {
  test('a non-existent foreign key returns 400', async () => {
    const res = await createDocket({ supplierId: 'does-not-exist' });
    assert.equal(res.status, 400);
    assert.ok(await serverAlive());
  });

  test('a non-existent record returns 404', async () => {
    assert.equal((await api('GET', '/dockets/nope', { token })).status, 404);
    assert.equal((await api('GET', '/invoices/nope', { token })).status, 404);
    assert.ok(await serverAlive());
  });

  test('an unknown endpoint returns JSON 404, not an HTML page', async () => {
    const res = await api('GET', '/no-such-endpoint', { token });
    assert.equal(res.status, 404);
    assert.ok(res.body?.error, 'should be a JSON body');
  });

  test('junk filter values are ignored, not errored on', async () => {
    // A mistyped URL should behave as though the filter were absent. Passing
    // NaN or an Invalid Date through to Prisma makes it throw instead.
    for (const qs of [
      '?page=-5',
      '?pageSize=99999',
      '?pageSize=0',
      '?from=not-a-date',
      '?to=garbage',
      '?minTotal=abc',
      '?maxTotal=',
      '?minTotal=abc&maxTotal=xyz',
    ]) {
      const res = await api('GET', `/dockets${qs}`, { token });
      assert.equal(res.status, 200, `${qs} returned ${res.status}: ${res.raw?.slice(0, 120)}`);
      assert.ok(Array.isArray(res.body.dockets), `${qs} should still return a list`);
    }
    assert.ok(await serverAlive());
  });

  test('pagination is clamped to a sane range', async () => {
    const big = await api('GET', '/dockets?pageSize=99999', { token });
    assert.ok(big.body.pageSize <= 100, 'pageSize is capped');
    const negative = await api('GET', '/dockets?page=-5', { token });
    assert.equal(negative.body.page, 1, 'page never goes below 1');
  });

  test('junk filters on the invoice listing and reports are ignored too', async () => {
    assert.equal((await api('GET', '/invoices?from=nope&to=nope', { token })).status, 200);
    assert.equal(
      (await api('GET', '/reports/overview?from=rubbish&to=rubbish', { token })).status,
      200
    );
  });

  test('the server is still up after every error case above', async () => {
    assert.ok(await serverAlive());
  });
});

suite('filters and reports', () => {
  test('date range filtering excludes documents outside the window', async () => {
    const res = await api('GET', '/dockets?from=1999-01-01&to=1999-12-31', { token });
    assert.equal(res.body.totalCount, 0);
    assert.equal(res.body.filteredTotals.total, 0);
  });

  test('search matches a docket number', async () => {
    const { body } = await createDocket();
    const res = await api(`GET`, `/dockets?search=${body.docket.docketNumber}`, { token });
    assert.ok(res.body.dockets.some((d) => d.id === body.docket.id));
  });

  test('overview returns a continuous series including empty days', async () => {
    const res = await api(
      'GET',
      '/reports/overview?from=2026-08-01&to=2026-08-10&granularity=day',
      { token }
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.series.length, 10, 'every day in the range is present');
    assert.ok('purchases' in res.body.series[0] && 'sales' in res.body.series[0]);
  });

  test('per-supplier report returns in-range and lifetime figures', async () => {
    const res = await api('GET', `/reports/supplier/${fx.supplier.id}`, { token });
    assert.equal(res.status, 200);
    assert.ok(res.body.lifetime.count > 0);
    assert.ok(Array.isArray(res.body.materials));
  });
});

suite('permissions — reversing a financial record is admin-only', () => {
  let staffToken;

  before(async () => {
    if (!hasTestDatabase) return;
    const email = `staff-${Date.now()}@example.com`;
    const password = 'StaffPassword12345';
    const created = await api('POST', '/users', {
      token,
      body: { name: 'Yard Staff', email, password, role: 'STAFF' },
    });
    assert.equal(created.status, 201, 'staff fixture user was created');
    const login = await api('POST', '/auth/login', { body: { email, password } });
    staffToken = login.body.token;
    assert.ok(staffToken, 'staff fixture user can sign in');
  });

  // The boundary is deliberately narrow: buying scrap is the yard's job, so
  // STAFF must keep full use of the thing they do eighty times a day. Only the
  // reversal is held back.
  test('STAFF can still create and issue a docket', async () => {
    const created = await api('POST', '/dockets', {
      token: staffToken,
      body: { supplierId: fx.supplier.id, lineItems: [line(fx.materials[0].id)] },
    });
    assert.equal(created.status, 201, 'staff can buy');

    const issued = await api('POST', `/dockets/${created.body.docket.id}/issue`, {
      token: staffToken,
    });
    assert.equal(issued.status, 200, 'staff can hand the supplier their copy');
  });

  test('STAFF cannot void a docket, and the docket is untouched', async () => {
    const { body } = await createDocket();
    const id = body.docket.id;

    const refused = await api('POST', `/dockets/${id}/void`, {
      token: staffToken,
      body: { reason: 'should not be allowed' },
    });
    assert.equal(refused.status, 403);

    // A 403 that still performed the write would be the worst of both worlds.
    const after = await api('GET', `/dockets/${id}`, { token });
    assert.equal(after.body.docket.status, 'ACTIVE');
    assert.equal(after.body.docket.voidReason, null);
  });

  test('STAFF cannot restore a voided docket', async () => {
    const { body } = await createDocket();
    const id = body.docket.id;
    await api('POST', `/dockets/${id}/void`, { token, body: { reason: 'admin voided it' } });

    const refused = await api('POST', `/dockets/${id}/restore`, { token: staffToken });
    assert.equal(refused.status, 403);

    const after = await api('GET', `/dockets/${id}`, { token });
    assert.equal(after.body.docket.status, 'VOID', 'still void');
  });

  test('STAFF cannot void an export invoice', async () => {
    const created = await api('POST', '/invoices', {
      token,
      body: {
        invoiceNumber: `PERM-${Math.random().toString(36).slice(2, 10)}`,
        consigneeId: fx.consignee.id,
        lineItems: [{ materialId: fx.materials[0].id, netWeightMt: 10, pricePerMt: 1000 }],
      },
    });
    assert.equal(created.status, 201);

    const refused = await api('POST', `/invoices/${created.body.invoice.id}/void`, {
      token: staffToken,
      body: { reason: 'should not be allowed' },
    });
    assert.equal(refused.status, 403);
  });

  test('an ADMIN is still able to void and restore', async () => {
    const { body } = await createDocket();
    const id = body.docket.id;
    const voided = await api('POST', `/dockets/${id}/void`, {
      token,
      body: { reason: 'admin may' },
    });
    assert.equal(voided.status, 200);
    const restored = await api('POST', `/dockets/${id}/restore`, { token });
    assert.equal(restored.status, 200);
  });
});
