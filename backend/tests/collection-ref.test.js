import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { collectionRef, parseCollectionRef } from '../src/lib/collectionRef.js';

/**
 * The number on a collection is an integer in the database and a word in the
 * yard: SHINE01. Both directions are worth pinning, because search depends on
 * the second one — somebody reading "SHINE01" off a phone will type it four
 * different ways and every one of them has to find the same record.
 */
describe('collection references', () => {
  test('two digits is the floor, not the ceiling', () => {
    assert.equal(collectionRef(1), 'SHINE01');
    assert.equal(collectionRef(9), 'SHINE09');
    assert.equal(collectionRef(10), 'SHINE10');
    assert.equal(collectionRef(100), 'SHINE100');
    assert.equal(collectionRef(1000), 'SHINE1000');
  });

  test('every spelling somebody might type finds the same collection', () => {
    for (const s of ['SHINE01', 'shine01', 'SHINE1', 'shine 1', 'shine-1', '01', '1', ' 1 ']) {
      assert.equal(parseCollectionRef(s), 1, `"${s}" should mean 1`);
    }
  });

  test('what is not a reference is not guessed at', () => {
    for (const s of ['', ' ', 'abc', 'SHINE', 'SHINE1A', '1.5', '-1', null, undefined]) {
      assert.equal(parseCollectionRef(s), null, `"${s}" should not parse`);
    }
  });

  test('the round trip holds', () => {
    for (const n of [1, 7, 42, 99, 100, 5000]) {
      assert.equal(parseCollectionRef(collectionRef(n)), n);
    }
  });
});
