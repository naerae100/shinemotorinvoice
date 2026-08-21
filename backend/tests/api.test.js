import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  api,
  fixtures,
  loginAdmin,
  serverAlive,
  startTestServer,
  stopTestServer,
  ADMIN_CREDENTIALS,
} from './helpers.js';

let token;
let fx;

before(async () => {
  await startTestServer();
  token = await loginAdmin();
  fx = await fixtures(token);
});

after(async () => {
  await stopTestServer();
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

describe('auth', () => {
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

describe('dockets — totals', () => {
  test('a purchase docket carries no GST', async () => {
    const res = await createDocket({ type: 'PURCHASE_DOCKET' });
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.docket.gst), 0);
    assert.equal(Number(res.body.docket.total), 1000);
  });

  test('a tax invoice carries 10% GST', async () => {
    const res = await createDocket({ type: 'TAX_INVOICE' });
    assert.equal(Number(res.body.docket.gst), 100);
    assert.equal(Number(res.body.docket.total), 1100);
  });

  test('GST cannot be forced on by a client-supplied flag', async () => {
    const res = await createDocket({ type: 'PURCHASE_DOCKET', applyGst: true });
    assert.equal(Number(res.body.docket.gst), 0, 'type decides GST, not the request body');
  });

  test('discount is applied and GST computed on the reduced amount', async () => {
    const res = await createDocket({
      type: 'TAX_INVOICE',
      discountType: 'PERCENT',
      discountValue: 10,
    });
    const d = res.body.docket;
    assert.equal(Number(d.discountAmount), 100);
    assert.equal(Number(d.gst), 90);
    assert.equal(Number(d.total), 990);
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
});

describe('dockets — numbering under concurrency', () => {
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

describe('dockets — void lifecycle', () => {
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
    const { body } = await createDocket({ lineItems: [line(fx.materials[0].id, 100, 10)] });
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

describe('invoices', () => {
  const invoiceLine = (materialId) => ({ materialId, weightTonnes: 10, pricePerMt: 1000 });

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

  test('an export invoice is GST-free by default', async () => {
    const res = await createInvoice();
    assert.equal(res.status, 201);
    assert.equal(Number(res.body.invoice.gstAud), 0);
    assert.equal(Number(res.body.invoice.totalAud), 10000);
  });

  test('a local sale applies 10% GST when the operator ticks it', async () => {
    const res = await createInvoice({ applyGst: true });
    assert.equal(Number(res.body.invoice.gstAud), 1000);
    assert.equal(Number(res.body.invoice.totalAud), 11000);
  });

  test('discount and GST combine in the right order', async () => {
    const res = await createInvoice({
      applyGst: true,
      discountType: 'PERCENT',
      discountValue: 5,
    });
    const i = res.body.invoice;
    assert.equal(Number(i.discountAmount), 500);
    assert.equal(Number(i.gstAud), 950);
    assert.equal(Number(i.totalAud), 10450);
  });

  test('bank details are snapshotted and returned as an object', async () => {
    const res = await createInvoice();
    assert.equal(typeof res.body.invoice.bankSnapshot, 'object');
    assert.ok(res.body.invoice.bankSnapshot.bankName);
  });

  test('editing an invoice does NOT change its bank snapshot', async () => {
    const created = await createInvoice();
    const original = created.body.invoice.bankSnapshot;
    await api('PATCH', '/settings', { token, body: { bankName: 'A DIFFERENT BANK' } });
    const edited = await api('PATCH', `/invoices/${created.body.invoice.id}`, {
      token,
      body: { poNumber: 'PO-123' },
    });
    assert.deepEqual(
      edited.body.invoice.bankSnapshot,
      original,
      'the buyer may already have paid against these details'
    );
  });

  test('a duplicate invoice number is rejected with 409, not a crash', async () => {
    const number = `DUP-${Date.now()}`;
    assert.equal((await createInvoice({ invoiceNumber: number })).status, 201);
    const second = await createInvoice({ invoiceNumber: number });
    assert.equal(second.status, 409);
    assert.ok(await serverAlive());
  });
});

describe('permissions', () => {
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

  test('staff cannot permanently delete a docket', async () => {
    const { body } = await createDocket();
    const res = await api('DELETE', `/dockets/${body.docket.id}`, { token: staffToken });
    assert.equal(res.status, 403);
  });

  test('an admin can permanently delete a docket', async () => {
    const { body } = await createDocket();
    const res = await api('DELETE', `/dockets/${body.docket.id}`, { token });
    assert.equal(res.status, 200);
    assert.equal((await api('GET', `/dockets/${body.docket.id}`, { token })).status, 404);
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

describe('error handling — bad input must never take the API down', () => {
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

describe('filters and reports', () => {
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
