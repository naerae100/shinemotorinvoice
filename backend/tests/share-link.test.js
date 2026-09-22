import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

/**
 * A share token is a credential handed to somebody with no account.
 *
 * It is the only thing standing between a link in a text message and the
 * yard's weighbridge record, so the properties that matter are worth
 * pinning: it opens exactly one collection, a changed character opens
 * nothing, and it stops working when it expires. Signed rather than stored
 * (see lib/shareLink.js), which means every one of these is a property of
 * the maths, not of a row somebody could forget to delete.
 */
let signShareToken, readShareToken;

before(async () => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-for-share-links';
  ({ signShareToken, readShareToken } = await import('../src/lib/shareLink.js'));
});

describe('share links — the token is the credential', () => {
  test('a token opens the collection it was made for', () => {
    const { token } = signShareToken('abc123');
    assert.equal(readShareToken(token), 'abc123');
  });

  test('and not a different one', () => {
    const { token } = signShareToken('abc123');
    // Swap the id, keep the signature: the obvious attack, and the reason
    // the id is inside the signed material rather than beside it.
    const forged = token.replace('abc123', 'xyz789');
    assert.equal(readShareToken(forged), null);
  });

  test('a single changed character opens nothing', () => {
    const { token } = signShareToken('abc123');
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    assert.equal(readShareToken(token.slice(0, -1) + last), null);
  });

  test('rubbish is rejected rather than throwing', () => {
    for (const bad of ['', 'nope', 'a.b.c', 'a.b', undefined, null, 'a.b.c.d']) {
      assert.equal(readShareToken(bad), null, `should reject ${JSON.stringify(bad)}`);
    }
  });

  test('an expired token is dead even though the signature is genuine', () => {
    const { token } = signShareToken('abc123');
    const [id, , sig] = token.split('.');
    // Yesterday, signed correctly for yesterday — the check is the clock.
    const past = Math.floor(Date.now() / 1000) - 60;
    assert.equal(readShareToken(`${id}.${past}.${sig}`), null);
  });

  test('ninety days, not forever and not an afternoon', () => {
    const { expiresAt } = signShareToken('abc123');
    const days = (expiresAt.getTime() - Date.now()) / 86400000;
    assert.ok(days > 89 && days < 91, `expected ~90 days, got ${days.toFixed(1)}`);
  });

  test('a token made under a different secret is worthless', async () => {
    const { token } = signShareToken('abc123');
    const original = process.env.JWT_SECRET;
    try {
      // Rotating JWT_SECRET is the blanket revocation for every live link.
      process.env.JWT_SECRET = 'a-completely-different-secret';
      assert.equal(readShareToken(token), null);
    } finally {
      process.env.JWT_SECRET = original;
    }
  });
});
