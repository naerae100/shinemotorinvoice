import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as v from '../src/lib/validators.js';

const ok = (schema, value) => schema.safeParse(value).success;

describe('field checks — reject what cannot be right, admit what is unusual', () => {
  test('a phone number may be written any way a person writes one', () => {
    for (const good of [
      '0413 222 171',
      '+852 8228 3234',      // Hong Kong
      '+91-98765-43210',     // India
      '(02) 8712 6909',
      '02 8712 6909 ext 4',
      '',                    // plenty of walk-in sellers give none
    ]) {
      assert.ok(ok(v.phone, good), `should accept ${good || '(blank)'}`);
    }
  });

  test('a phone number may not be words', () => {
    // The field took "call the office" and printed it on a docket.
    for (const bad of ['call the office', 'ask reception', 'n/a', '12345']) {
      assert.equal(ok(v.phone, bad), false, `should reject ${bad}`);
    }
  });

  test('an ABN is checked against the ATO check digit, not just its length', () => {
    // Shine Motor's own, off the letterhead.
    assert.ok(v.isValidAbn('96 167 579 179'));
    assert.ok(ok(v.abn, '96167579179'));

    // Eleven digits and still wrong: these are the mistakes made copying one
    // off a supplier's paperwork, and length alone waves both through.
    assert.equal(v.isValidAbn('96167579178'), false, 'one digit changed');
    assert.equal(v.isValidAbn('96176579179'), false, 'two digits transposed');
    assert.equal(ok(v.abn, '12345678901'), false);
  });

  test('a BSB is six digits, dash optional', () => {
    assert.ok(ok(v.bsb, '032-372'));
    assert.ok(ok(v.bsb, '032372'));
    assert.ok(ok(v.bsb, ''));
    // Half of where the money goes. A short one is worth stopping here rather
    // than when a transfer bounces.
    assert.equal(ok(v.bsb, '03237'), false);
    assert.equal(ok(v.bsb, '0323722'), false);
    assert.equal(ok(v.bsb, 'westpac'), false);
  });

  test('an account number is digits', () => {
    assert.ok(ok(v.accountNumber, '530914'));
    assert.ok(ok(v.accountNumber, '1234 5678'));
    assert.equal(ok(v.accountNumber, 'my account'), false);
    assert.equal(ok(v.accountNumber, '123'), false);
  });

  test('a PayID is an email or a mobile, because that is what the scheme takes', () => {
    assert.ok(ok(v.payId, 'gk@pantheonmetals.com.au'));
    assert.ok(ok(v.payId, '0413222171'));
    assert.equal(ok(v.payId, 'not-an-email'), false);
    assert.equal(ok(v.payId, 'pay me'), false);
  });

  test('blank always passes — these are optional details', () => {
    for (const schema of [v.phone, v.abn, v.bsb, v.accountNumber, v.payId, v.optionalEmail]) {
      assert.ok(ok(schema, ''), 'blank');
      assert.ok(ok(schema, undefined), 'absent');
      assert.ok(ok(schema, null), 'null');
    }
  });

  test('an Australian postcode is four digits; elsewhere is left alone', () => {
    assert.ok(v.postcodeMatchesCountry({ country: 'Australia', postcode: '2565' }));
    assert.equal(v.postcodeMatchesCountry({ country: 'Australia', postcode: 'NSW' }), false);
    // Hong Kong has no postcode at all; the UK's are alphanumeric.
    assert.ok(v.postcodeMatchesCountry({ country: 'Hong Kong', postcode: '' }));
    assert.ok(v.postcodeMatchesCountry({ country: 'United Kingdom', postcode: 'SW1A 1AA' }));
  });
});
