import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { describeDevice } from '../src/lib/device.js';
import { sessionTtlMs, clientIp } from '../src/lib/session.js';

/**
 * The device list only does its job if a person recognises their own device
 * in it, and only stays honest if a session row lives exactly as long as the
 * token that names it.
 */
describe('naming a device from what the browser claims', () => {
  const UA = {
    iphone:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Safari/604.1',
    android:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0',
    macSafari:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
    shell:
      'Mozilla/5.0 (Linux; Android 14; SM-A356E Build/UP1A) AppleWebKit/537.36 Version/4.0 Chrome/126.0 Mobile Safari/537.36 wv)',
  };

  test('a phone reads as a phone', () => {
    assert.equal(describeDevice(UA.iphone), 'iPhone · Safari');
    assert.equal(describeDevice(UA.android), 'Android · Chrome');
  });

  test('an iPad is not a Mac, though its UA says Mac OS X', () => {
    assert.equal(describeDevice(UA.ipad), 'iPad · Safari');
  });

  test('Edge is not Chrome, and Chrome is not Safari', () => {
    // Every browser impersonates the one below it, so the order of the
    // checks is the whole of the logic. This is that order, pinned.
    assert.equal(describeDevice(UA.edge), 'Windows · Edge');
    assert.equal(describeDevice(UA.macSafari), 'Mac · Safari');
  });

  test('the installed app says so', () => {
    assert.equal(describeDevice(UA.shell), 'Android · Chrome app');
  });

  test('nothing useful is said when nothing useful was sent', () => {
    for (const bad of ['', '   ', undefined, null, 'curl/8.4.0']) {
      assert.equal(describeDevice(bad), 'Unrecognised device');
    }
  });
});

describe('a session row lives exactly as long as its token', () => {
  test('the units jsonwebtoken takes are the units this reads', () => {
    assert.equal(sessionTtlMs('14d'), 14 * 86400000);
    assert.equal(sessionTtlMs('12h'), 12 * 3600000);
    assert.equal(sessionTtlMs('30m'), 30 * 60000);
    assert.equal(sessionTtlMs('3600'), 3600 * 1000); // bare number is seconds
  });

  test('nonsense falls back to fourteen days, never to zero', () => {
    // Zero would expire every session on the request that created it.
    for (const bad of ['', null, undefined, 'banana', '14 days']) {
      assert.equal(sessionTtlMs(bad), 14 * 86400000, `${JSON.stringify(bad)} should fall back`);
    }
  });
});

describe('the address shown beside a device', () => {
  test('IPv6-mapped IPv4 is unwrapped, because nobody recognises the other form', () => {
    assert.equal(clientIp({ ip: '::ffff:203.0.113.4' }), '203.0.113.4');
  });

  test('loopback is dropped rather than displayed as ::1', () => {
    assert.equal(clientIp({ ip: '::1' }), null);
    assert.equal(clientIp({ ip: '127.0.0.1' }), null);
    assert.equal(clientIp({}), null);
  });

  test('a real address survives', () => {
    assert.equal(clientIp({ ip: '203.0.113.4' }), '203.0.113.4');
  });
});
