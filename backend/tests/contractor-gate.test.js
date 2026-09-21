import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { contractorMayAccess } from '../src/middleware/auth.js';

/**
 * The contractor role is the first one in this system that is meant to see
 * less than everything.
 *
 * Until now "signed in" and "can read the whole business" were the same
 * thing: requireRole guards destroying and configuring, not reading, and
 * suppliers, consignees and reports carry no role check at all. So the gate
 * is an allowlist, and these tests are the list. A route that should be shut
 * and is not does not throw, log, or look wrong on screen — it just quietly
 * answers, which is why it is worth pinning every one of them.
 */
describe('a contractor can reach their own work and nothing else', () => {
  test('the screens they actually use are open', () => {
    for (const url of [
      '/api/collections',
      '/api/collections/',
      '/api/collections?page=2',
      '/api/collections/abc123',
      '/api/collections/materials',
      '/api/local-suppliers',
      '/api/local-suppliers?search=amin',
      '/api/local-suppliers/abc123',
      '/api/auth/me',
      '/api/auth/login',
    ]) {
      assert.equal(contractorMayAccess(url), true, `${url} should be open`);
    }
  });

  test('the rest of the business is shut', () => {
    for (const url of [
      // Bank details and ABNs live here.
      '/api/suppliers',
      '/api/suppliers/abc123',
      '/api/consignees',
      // Money.
      '/api/dockets',
      '/api/dockets/abc123',
      '/api/invoices',
      '/api/reports/overview',
      '/api/reports/dashboard',
      // The price list: what the yard pays is not a contractor's business.
      '/api/materials',
      // Accounts, configuration, the audit trail, the accounting link.
      '/api/users',
      '/api/settings',
      '/api/audit',
      '/api/xero',
      '/api/abn/96167579179',
      '/api/address/search?q=ingleburn',
    ]) {
      assert.equal(contractorMayAccess(url), false, `${url} should be shut`);
    }
  });

  test('a prefix that merely starts the same way is shut', () => {
    // The guard against a lazy startsWith: these are different endpoints that
    // happen to share an opening, and an allowlist that let them through
    // would be worse than no allowlist, because it would look correct.
    for (const url of [
      '/api/collections-export',
      '/api/local-suppliers-export',
      '/api/authorise',
      '/api/collectionsomething',
    ]) {
      assert.equal(contractorMayAccess(url), false, `${url} should be shut`);
    }
  });

  test('a query string cannot be used to slip past the check', () => {
    assert.equal(contractorMayAccess('/api/suppliers?x=/api/collections'), false);
    assert.equal(contractorMayAccess('/api/dockets?redirect=/api/collections/'), false);
  });

  test('nothing unexpected is treated as allowed', () => {
    for (const url of ['', null, undefined, '/', '/api', '/api/']) {
      assert.equal(contractorMayAccess(url), false, `${String(url)} should be shut`);
    }
  });
});
