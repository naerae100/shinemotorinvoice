import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * The OAuth callbacks are the only unauthenticated endpoints in this system
 * that write credentials. The provider redirects a browser to them with no
 * session attached, so they cannot sit behind requireAuth, and the state
 * parameter is the whole of what replaces it.
 *
 * Get this wrong and anyone who completes a consent flow against their own
 * Xero organisation can post the code here, and the yard's invoices start
 * syncing into their books. These tests are that boundary.
 */
let signState, verifyState;

before(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-oauth-state';
  ({ signState, verifyState } = await import('../src/lib/oauthState.js'));
});

describe('OAuth state — the callback has nothing else guarding it', () => {
  test('a state this server issued comes back good', () => {
    assert.equal(verifyState('xero', signState('xero')), true);
  });

  test('a state for one provider does not open another', () => {
    // Otherwise a Drive link, which any admin can generate, would also
    // authorise writing Xero's accounting tokens.
    assert.equal(verifyState('drive', signState('xero')), false);
    assert.equal(verifyState('xero', signState('drive')), false);
  });

  test('no state at all is refused', () => {
    for (const bad of [undefined, null, '', 'nope', '.', '123.', '.abc']) {
      assert.equal(verifyState('xero', bad), false, `should refuse ${JSON.stringify(bad)}`);
    }
  });

  test('a changed signature is refused', () => {
    const state = signState('xero');
    const last = state.at(-1) === 'A' ? 'B' : 'A';
    assert.equal(verifyState('xero', state.slice(0, -1) + last), false);
  });

  test('an expiry cannot simply be extended', () => {
    // The expiry is inside the signed material, so moving it invalidates it.
    const [, signature] = signState('xero').split('.');
    const far = Math.floor(Date.now() / 1000) + 99999;
    assert.equal(verifyState('xero', `${far}.${signature}`), false);
  });

  test('an expired state is dead', () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    const [, signature] = signState('xero').split('.');
    assert.equal(verifyState('xero', `${past}.${signature}`), false);
  });

  test('a non-numeric expiry does not throw', () => {
    assert.equal(verifyState('xero', 'abc.def'), false);
  });

  test('thirty minutes', () => {
    const [expires] = signState('xero').split('.');
    const minutes = (Number(expires) - Date.now() / 1000) / 60;
    assert.ok(minutes > 29 && minutes <= 30, `expected ~30 minutes, got ${minutes.toFixed(1)}`);
  });
});
