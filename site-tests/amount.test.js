'use strict';
// amount.js — exact decimal string → BigInt parsing and BigInt → string display.
// These are the money-boundary helpers: every deposit/redeem amount passes through
// parseUnits, so the vectors here pin exactness (no float anywhere in the path).
const test = require('node:test');
const assert = require('node:assert');

const amount = require('../site/js/amount.js');

const E18 = 10n ** 18n;

test('parseUnits: whole and fractional values are exact', () => {
  assert.strictEqual(amount.parseUnits('1', 18).value, E18);
  assert.strictEqual(amount.parseUnits('0.1', 18).value, E18 / 10n);
  assert.strictEqual(amount.parseUnits('1.234567', 18).value, 1234567000000000000n);
  assert.strictEqual(amount.parseUnits('0.000000000000000001', 18).value, 1n);
  assert.strictEqual(amount.parseUnits('00.5', 18).value, E18 / 2n);
  assert.strictEqual(amount.parseUnits('.5', 18).value, E18 / 2n);
  assert.strictEqual(amount.parseUnits('5.', 18).value, 5n * E18);
  assert.strictEqual(amount.parseUnits('0', 18).value, 0n);
});

test('parseUnits: whitespace is trimmed, other junk is rejected with a usable reason', () => {
  assert.strictEqual(amount.parseUnits('  1.5  ', 18).value, 1500000000000000000n);
  assert.strictEqual(amount.parseUnits('', 18).ok, false);
  assert.match(amount.parseUnits('', 18).reason, /Enter an amount/);
  for (const bad of ['1e5', '-1', '+1', '1,000', 'abc', '1.2.3', '1 000', '1$']) {
    const r = amount.parseUnits(bad, 18);
    assert.strictEqual(r.ok, false, 'expected rejection: ' + bad);
    assert.ok(typeof r.reason === 'string' && r.reason.length > 0, 'reason for ' + bad);
  }
});

test('parseUnits: rejects more fractional digits than the token supports', () => {
  const r = amount.parseUnits('0.0000000000000000001', 18); // 19 decimals
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /18 decimal/);
});

test('parseUnits: 30-digit integer part accepted, 31 rejected (sanity cap)', () => {
  const ok = amount.parseUnits('123456789012345678901234567890', 18);
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.value, BigInt('123456789012345678901234567890' + '000000000000000000'));
  assert.strictEqual(amount.parseUnits('1234567890123456789012345678901', 18).ok, false);
});

test('parseUnits: zero is a VALID parse — the caller decides the >0 policy', () => {
  const r = amount.parseUnits('0.0', 18);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 0n);
});

test('parseUnits: honors non-18 decimals', () => {
  assert.strictEqual(amount.parseUnits('1.5', 6).value, 1500000n);
  assert.strictEqual(amount.parseUnits('0.000001', 6).value, 1n);
  assert.strictEqual(amount.parseUnits('0.0000001', 6).ok, false);
  assert.strictEqual(amount.parseUnits('1', 0).value, 1n);
  assert.strictEqual(amount.parseUnits('1.5', 0).ok, false);
});

test('formatUnits: exact integer rendering (no float precision loss) with grouping', () => {
  const huge = BigInt('1234567890123456789012345678' + '000000000000000000');
  assert.strictEqual(
    amount.formatUnits(huge, 18),
    '1,234,567,890,123,456,789,012,345,678'
  );
});

test('formatUnits: fraction is truncated to maxFrac and zero-trimmed', () => {
  assert.strictEqual(amount.formatUnits(1500000000000000000n, 18), '1.5');
  assert.strictEqual(amount.formatUnits(1234567000000000000n, 18), '1.2345');
  assert.strictEqual(amount.formatUnits(1234000000000000000n, 18), '1.234');
  assert.strictEqual(amount.formatUnits(1000000n, 18), '0');
  assert.strictEqual(amount.formatUnits(1234567000000000000n, 18, 6), '1.234567');
});

test('formatUnits: edge inputs', () => {
  assert.strictEqual(amount.formatUnits(null), '—');
  assert.strictEqual(amount.formatUnits(undefined), '—');
  assert.strictEqual(amount.formatUnits(0n, 18), '0');
  assert.strictEqual(amount.formatUnits(1500000n, 6), '1.5');
  assert.strictEqual(amount.formatUnits(1n, 0), '1');
  assert.strictEqual(amount.formatUnits(-1500000000000000000n, 18), '-1.5');
});
