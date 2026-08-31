'use strict';
// wallet.js pure cores: eip-6963 provider-registry dedupe, receipt polling, and the
// receipt → honest-outcome mapping. The wallet EVENT wiring itself is browser-only;
// these tests pin the decision logic that money-flows depend on.
const test = require('node:test');
const assert = require('node:assert');

const wallet = require('../site/js/wallet.js');

function providerDetail(rdns, uuid, name) {
  return { info: { rdns: rdns, uuid: uuid, name: name || rdns }, provider: { fake: rdns } };
}

test('addProvider: keeps announced wallets, ignores malformed details', () => {
  let list = [];
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u1', 'MetaMask'));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].info.name, 'MetaMask');
  // malformed announcements are dropped, never crash
  assert.strictEqual(wallet.addProvider(list, null), list);
  assert.strictEqual(wallet.addProvider(list, {}), list);
  assert.strictEqual(wallet.addProvider(list, { info: { rdns: 'x' } }), list);
  assert.strictEqual(wallet.addProvider(list, { provider: {} }), list);
});

test('addProvider: dedupes by (rdns, uuid); same rdns with a new uuid is a distinct wallet', () => {
  let list = [];
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u1'));
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u1')); // dup
  assert.strictEqual(list.length, 1);
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u2')); // second install
  assert.strictEqual(list.length, 2);
  list = wallet.addProvider(list, providerDetail('com.rabby', 'u1')); // other vendor
  assert.strictEqual(list.length, 3);
  // returns a NEW list — the announced list is never mutated in place
  assert.notStrictEqual(list, wallet.addProvider(list, providerDetail('new', 'u3')));
});

test('receiptOutcome: maps receipt to confirmed / reverted / unknown / not-mined', () => {
  assert.strictEqual(wallet.receiptOutcome({ status: '0x1', blockNumber: '0x5' }), 'confirmed');
  assert.strictEqual(wallet.receiptOutcome({ status: '0x01', blockNumber: '0x5' }), 'confirmed');
  assert.strictEqual(wallet.receiptOutcome({ status: 1 }), 'confirmed');
  assert.strictEqual(wallet.receiptOutcome({ status: '0x0' }), 'reverted');
  assert.strictEqual(wallet.receiptOutcome({ status: 0 }), 'reverted');
  assert.strictEqual(wallet.receiptOutcome({ blockNumber: '0x9' }), 'included-unknown-status');
  assert.strictEqual(wallet.receiptOutcome({ blockHash: '0xabc' }), 'included-unknown-status');
  assert.strictEqual(wallet.receiptOutcome({}), null);
  assert.strictEqual(wallet.receiptOutcome(null), null);
  assert.strictEqual(wallet.receiptOutcome(undefined), null);
  assert.strictEqual(wallet.receiptOutcome('receipt'), null);
});

function fakeClient(script) {
  let i = 0;
  const calls = [];
  return {
    calls: calls,
    call: async function (method, params) {
      assert.strictEqual(method, 'eth_getTransactionReceipt');
      calls.push(params[0]);
      const step = script[Math.min(i++, script.length - 1)];
      return step;
    }
  };
}

test('waitForReceipt: returns the receipt as soon as it is mined', async () => {
  const receipt = { status: '0x1', blockNumber: '0x64', blockHash: '0xh' };
  const client = fakeClient([null, null, receipt]);
  let slept = 0;
  const out = await wallet.waitForReceipt(client, '0xHASH', {
    intervalMs: 1,
    sleepFn: function () { slept++; return Promise.resolve(); }
  });
  assert.deepStrictEqual(out, receipt);
  assert.strictEqual(client.calls.length, 3);
  assert.strictEqual(slept, 2);
  assert.ok(client.calls.every(function (h) { return h === '0xHASH'; }));
});

test('waitForReceipt: null after the attempt budget — never a fabricated success', async () => {
  const client = fakeClient([null]);
  const out = await wallet.waitForReceipt(client, '0xHASH', {
    intervalMs: 1, maxAttempts: 4,
    sleepFn: function () { return Promise.resolve(); }
  });
  assert.strictEqual(out, null);
  assert.strictEqual(client.calls.length, 4);
});

test('waitForReceipt: an empty-object "receipt" is treated as pending, not mined', async () => {
  const client = fakeClient([{}, { status: '0x0' }]);
  const out = await wallet.waitForReceipt(client, '0xHASH', {
    intervalMs: 1,
    sleepFn: function () { return Promise.resolve(); }
  });
  assert.deepStrictEqual(out, { status: '0x0' });
  assert.strictEqual(client.calls.length, 2);
});
