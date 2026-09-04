'use strict';
// VAULT-COVERAGE (STRATTON-LEDGER-CARD) — unit pins for the backingCoverage seam.
// Pure functions only (no DOM, no fetch): decodeBackingCoverage + formatCoveragePct
// consumed by main.js's single #mint-backed/#inv-stat fill point. The .9995 pins
// DISCRIMINATE rounding: a 99.95%-covered vault must display "99.9%" (truncate
// toward zero at one decimal) — never "100.0%", never clamped, never rounded up.
const test = require('node:test');
const assert = require('node:assert');

// abi.js FIRST (same order as render.test.js): vault.js's pure decoders read
// root.WS.abi at call time — the UMD require below populates globalThis.WS.abi.
require('../site/js/abi.js');
const vault = require('../site/js/vault.js');

// encode a uint256 as a single 32-byte hex word (the backingCoverage() return shape)
function word(v) { return '0x' + BigInt(v).toString(16).padStart(64, '0'); }

test('formatCoveragePct: 1e18 exact cover reads "100.0%"', () => {
  assert.strictEqual(vault.formatCoveragePct(word('1000000000000000000')), '100.0%');
});

test('formatCoveragePct: 1.05e18 unaccounted excess reads "105.0%" (never clamped)', () => {
  assert.strictEqual(vault.formatCoveragePct(word('1050000000000000000')), '105.0%');
});

test('formatCoveragePct: 0.97e18 under-coverage reads "97.0%" (shown honestly)', () => {
  assert.strictEqual(vault.formatCoveragePct(word('970000000000000000')), '97.0%');
});

test('formatCoveragePct: 0.9995e18 TRUNCATES to "99.9%" (never rounds up to 100.0%)', () => {
  assert.strictEqual(vault.formatCoveragePct(word('999500000000000000')), '99.9%');
});

test('formatCoveragePct: 1.9995e18 TRUNCATES to "199.9%" (excess shown, never capped)', () => {
  assert.strictEqual(vault.formatCoveragePct(word('1999500000000000000')), '199.9%');
});

test('formatCoveragePct: null input -> null (honest unavailable, never 0)', () => {
  assert.strictEqual(vault.formatCoveragePct(null), null);
});

test('formatCoveragePct: short word -> null (failed decode, never 0)', () => {
  assert.strictEqual(vault.formatCoveragePct('0x'), null);
});
