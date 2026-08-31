'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeDecimal,
  marketStaleness,
  wordToSignedInt,
  decodeAbiString,
  decodeAddressArray,
  PRICE_STALE_AFTER_SEC,
} = require('../api/lib/shared.js');

// ------------------------------------------------------------------ price normalization

test('normalizeDecimal: known Chainlink raw answer 77026515000 @ 8 decimals → 770.26515', () => {
  const r = normalizeDecimal('77026515000', 8);
  assert.equal(r.exact, '770.26515');
  assert.equal(r.value, 770.26515);
  assert.equal(r.negative, false);
});

test('normalizeDecimal: NVDA-class raw answer 21815545000 @ 8 decimals → 218.15545', () => {
  const r = normalizeDecimal('21815545000', 8);
  assert.equal(r.exact, '218.15545');
  assert.equal(r.value, 218.15545);
});

test('normalizeDecimal: zero raw → 0', () => {
  const r = normalizeDecimal('0', 8);
  assert.equal(r.exact, '0');
  assert.equal(r.value, 0);
});

test('normalizeDecimal: raw smaller than one unit pads leading zeros (12345 @ 8 → 0.00012345)', () => {
  const r = normalizeDecimal('12345', 8);
  assert.equal(r.exact, '0.00012345');
  assert.equal(r.value, 0.00012345);
});

test('normalizeDecimal: 18-decimal whole amount → 1', () => {
  const r = normalizeDecimal('1000000000000000000', 18);
  assert.equal(r.exact, '1');
  assert.equal(r.value, 1);
});

test('normalizeDecimal: 18-decimal fractional amount keeps full precision in exact string', () => {
  const r = normalizeDecimal('1234567890123456789', 18);
  assert.equal(r.exact, '1.234567890123456789'); // lossless, unlike a float divide
  assert.equal(r.value, 1.2345678901234568); // JSON Number form
});

test('normalizeDecimal: zero-decimals amount passes through', () => {
  assert.equal(normalizeDecimal('42', 0).exact, '42');
});

test('normalizeDecimal: rejects non-integer input', () => {
  assert.throws(() => normalizeDecimal('12.5', 8), TypeError);
  assert.throws(() => normalizeDecimal('abc', 8), TypeError);
});

// ------------------------------------------------------------------ staleness (market-hours aware)

// Anchors: 2026-08-28 = Friday, 2026-08-29 = Saturday, 2026-08-30 = Sunday,
// 2026-08-31 = Monday (matches the phase-0 probe window).
const FRI_2359 = Date.UTC(2026, 7, 28, 23, 59, 0) / 1000; // last weekday moment
const SAT_NOON = Date.UTC(2026, 7, 29, 12, 0, 0) / 1000;
const SUN_ANCHOR = Date.UTC(2026, 7, 30, 17, 20, 7) / 1000; // phase-0 probe timestamp
const MON_OPEN = Date.UTC(2026, 7, 31, 14, 0, 0) / 1000; // Monday, US session under way

test('staleness: fresh feed is never flagged', () => {
  const r = marketStaleness(FRI_2359 - 60, FRI_2359);
  assert.equal(r.stale, false);
  assert.equal(r.expected, false);
  assert.equal(r.ageSeconds, 60);
});

test('staleness: Fri 23:59 UTC with an 8h-old update is flagged stale (weekday, 24/5 feed)', () => {
  const r = marketStaleness(FRI_2359 - 8 * 3600, FRI_2359);
  assert.equal(r.stale, true);
  assert.equal(r.expected, false);
  assert.equal(r.ageSeconds, 8 * 3600);
});

test('staleness: Sat noon is never flagged, whatever the age (weekend gap is expected)', () => {
  const r = marketStaleness(SAT_NOON - 16 * 3600, SAT_NOON);
  assert.equal(r.stale, false);
  assert.equal(r.expected, true);
  assert.equal(r.ageSeconds, 16 * 3600);
});

test('staleness: the phase-0 observation (49h stale on Sunday) is expected, not flagged', () => {
  // SPY feed updatedAt 2026-08-28T16:18:39Z probed Sunday 17:20:07Z — 49h old.
  const updatedAt = Date.UTC(2026, 7, 28, 16, 18, 39) / 1000;
  const r = marketStaleness(updatedAt, SUN_ANCHOR);
  assert.equal(r.stale, false);
  assert.equal(r.expected, true);
  assert.equal(r.ageSeconds, 176_488);
});

test('staleness: Monday during the session re-arms the guard (5h-old update flagged)', () => {
  const r = marketStaleness(MON_OPEN - 5 * 3600, MON_OPEN);
  assert.equal(r.stale, true);
  assert.equal(r.expected, false);
});

test('staleness: Monday 00:00 UTC is already a weekday (strict 24/5 interpretation)', () => {
  const r = marketStaleness(Date.UTC(2026, 7, 31, 0, 0, 0) / 1000 - 5 * 3600, Date.UTC(2026, 7, 31, 0, 0, 0) / 1000);
  assert.equal(r.stale, true);
});

test('staleness: Sunday 23:59 stays within the weekend grace', () => {
  const r = marketStaleness(Date.UTC(2026, 7, 30, 23, 59, 0) / 1000 - 8 * 3600, Date.UTC(2026, 7, 30, 23, 59, 0) / 1000);
  assert.equal(r.stale, false);
  assert.equal(r.expected, true);
});

test('staleness: threshold is 4h and an age just below it stays fresh on a weekday', () => {
  assert.equal(PRICE_STALE_AFTER_SEC, 4 * 3600);
  const r = marketStaleness(FRI_2359 - (4 * 3600 - 1), FRI_2359);
  assert.equal(r.stale, false);
});

// ------------------------------------------------------------------ decoding helpers

test('wordToSignedInt: positive word stays positive', () => {
  assert.equal(wordToSignedInt('0x' + (77026515000n).toString(16).padStart(64, '0')), 77026515000n);
});

test('wordToSignedInt: top-bit-set word decodes as negative int256', () => {
  const neg5 = 2n ** 256n - 5n;
  assert.equal(wordToSignedInt('0x' + neg5.toString(16).padStart(64, '0')), -5n);
});

test('decodeAbiString: decodes an ABI string payload', () => {
  const raw =
    '0x' +
    (32n).toString(16).padStart(64, '0') +
    (3n).toString(16).padStart(64, '0') +
    Buffer.from('SPY').toString('hex').padEnd(64, '0');
  assert.equal(decodeAbiString(raw), 'SPY');
});

test('decodeAddressArray: decodes offset/length/address words and drops zero addresses', () => {
  const a = '0x' + '1111111111111111111111111111111111111111';
  const b = '0x' + '2222222222222222222222222222222222222222';
  const raw =
    '0x' +
    (32n).toString(16).padStart(64, '0') +
    (3n).toString(16).padStart(64, '0') +
    '0'.repeat(24) + '1111111111111111111111111111111111111111' +
    '0'.repeat(24) + '2222222222222222222222222222222222222222' +
    '0'.repeat(64);
  assert.deepEqual(decodeAddressArray(raw), [a, b]);
});
