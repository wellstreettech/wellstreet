'use strict';
// WS-WOW-BATCH unit battery (2026-09-03) — the honesty-critical wow helpers as
// pure units + the sim source-slice no-recompute gate. Dependency-free
// node:test + node:assert + node:fs (render.test.js convention).
//
// Loads the REAL site modules in browser <script> order under a minimal DOM
// stub with NO fetch — init() runs, every read degrades honestly, and the
// wow helpers land on WS.wow for direct unit probing. The launch-flip path is
// assertable here too: the vault is PENDING_DEPLOY under this stub, so the
// flip must NEVER fire (no body.launch-flip class — never simulated).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../site/js/config.js');
const apr = require('../site/js/apr.js');

// ---------------- minimal DOM stub (no fetch: reads degrade, nothing renders live) ----------------
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], attrs: {}, listeners: {}, parentNode: null,
    className: '', _text: '', innerHTML: '', hidden: false, disabled: false,
    value: '', title: '', href: '', target: '', rel: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter((x) => x !== this); } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: null
  };
  el.classList = {
    add(c) { const t = String(el.className || '').split(/\s+/).filter(Boolean); if (t.indexOf(c) === -1) { el.className = t.concat(c).join(' '); } },
    remove(c) { el.className = String(el.className || '').split(/\s+/).filter((x) => x !== c).join(' '); },
    contains(c) { return String(el.className || '').split(/\s+/).indexOf(c) !== -1; }
  };
  return el;
}

global.window = global;
global.document = {
  readyState: 'complete',
  title: '',
  body: makeEl('body'),
  getElementById: function () { return null; },
  createElement: function (t) { return makeEl(t); },
  createDocumentFragment: function () { return makeEl('#document-fragment'); },
  addEventListener: function () { /* readyState complete: init runs inline */ }
};

require('../site/js/abi.js');
require('../site/js/amount.js');
require('../site/js/rpc.js');
require('../site/js/geo.js');
require('../site/js/vault.js');
require('../site/js/wallet.js');
require('../site/js/docs.js');
require('../site/js/main.js');

const wow = global.WS.wow;
const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');

function near(a, b, eps) { assert.ok(Math.abs(a - b) <= eps, a + ' ≈ ' + b + ' +/- ' + eps); }

// ---------------- STEP 0 re-pin contract ----------------
test('re-pin: aprPins carry the ratified 2026-09-03 liquidity-share form', () => {
  assert.strictEqual(config.aprPins.lpSeedPctOfPool, 1.0, 'LP seed 1% of pool TVL (pin 2)');
  assert.strictEqual(config.aprPins.liquidityShareFullRange, 0.000369, 'L_pos/L_pool at the 1% seed, full-range');
  assert.strictEqual(config.aprPins.targetVaultTvlUsd, 58000, 'launch-era vault TVL expectation (the floor-clearing ceiling)');
  assert.strictEqual(config.aprPins.depositorAprFloorPct, 0.10, 'depositor-APR floor 0.10%/yr (pin 3)');
  assert.strictEqual(config.aprPins.poolFloorNetAprPct, 3.542, 'derived pool floor (GO packet §1/§2)');
  assert.strictEqual(config.aprMethodology.phase0Baseline.netAprPct, 40.310, 'ratified pool net median');
});

test('re-pin: the ratified projection clears the 0.10%/yr floor at the launch-era expectation', () => {
  const p = apr.projectDepositorApr(config.aprMethodology.phase0Baseline.netAprPct, config.aprPins, config.economics);
  near(p.depositorAprPct, 0.2663, 5e-4);
  assert.ok(p.depositorAprPct >= config.aprPins.depositorAprFloorPct,
    'full-range 1% seed at $58k clears the floor (GO packet §7 stop rule (ii))');
});

// ---------------- WOW-1 tape glyph ----------------
test('WOW-1 tickGlyph: ▲/▼/– by the sign of the published change; a first fill is not a change', () => {
  assert.strictEqual(wow.tickGlyph('~0.30%', '~0.40%'), '▲');
  assert.strictEqual(wow.tickGlyph('~0.40%', '~0.30%'), '▼');
  assert.strictEqual(wow.tickGlyph('$770.27', '$770.27'), '–');
  assert.strictEqual(wow.tickGlyph('', '~0.40%'), '', 'first fill (empty prev) → no glyph');
  assert.strictEqual(wow.tickGlyph('~0.30%', ''), '', 'a vanished figure → no glyph');
  assert.strictEqual(wow.tickGlyph('unavailable (RPC)', '~0.30%'), '', 'unparseable → no glyph');
});

// ---------------- WOW-2 flow rate buckets ----------------
test('WOW-2 flowRateClass: ratio buckets from the PUBLISHED rate; unknown → null (static, honest)', () => {
  assert.strictEqual(wow.flowRateClass(40.310), 'flow-rate-fast');
  assert.strictEqual(wow.flowRateClass(40), 'flow-rate-fast');
  assert.strictEqual(wow.flowRateClass(39.9), 'flow-rate-mid');
  assert.strictEqual(wow.flowRateClass(10), 'flow-rate-mid');
  assert.strictEqual(wow.flowRateClass(9.9), 'flow-rate-slow');
  assert.strictEqual(wow.flowRateClass(0.5), 'flow-rate-slow');
  assert.strictEqual(wow.flowRateClass(0), null);
  assert.strictEqual(wow.flowRateClass(null), null);
  assert.strictEqual(wow.flowRateClass(undefined), null);
  assert.strictEqual(wow.flowRateClass(-3), null);
  assert.strictEqual(wow.flowRateClass(NaN), null);
});

// ---------------- WOW-6 sim share ----------------
test('WOW-6 simSharePct: the dilution INPUT (size ÷ live pool TVL); absent live read → null', () => {
  near(wow.simSharePct(5000, 1153564.43), 0.4334, 1e-4);
  near(wow.simSharePct(50000, 1153564.43), 4.334, 1e-3);
  assert.strictEqual(wow.simSharePct(5000, 0), null);
  assert.strictEqual(wow.simSharePct(5000, null), null);
  assert.strictEqual(wow.simSharePct(5000, undefined), null);
  assert.strictEqual(wow.simSharePct(5000, NaN), null);
  assert.strictEqual(wow.simSharePct(0, 1153564.43), null);
  assert.strictEqual(wow.simSharePct(-100, 1153564.43), null);
});

// ---------------- WOW-3 launch-flip gate ----------------
test('WOW-3 launchFlipShouldAnimate: ONLY a real false→true transition, never pre-played', () => {
  assert.strictEqual(wow.launchFlipShouldAnimate(false, true, false), true, 'the flip itself');
  assert.strictEqual(wow.launchFlipShouldAnimate(true, true, false), false, 'already live at load → no flip');
  assert.strictEqual(wow.launchFlipShouldAnimate(false, false, false), false, 'still pending → no flip');
  assert.strictEqual(wow.launchFlipShouldAnimate(false, true, true), false, 'session already saw it → no replay');
  assert.strictEqual(wow.launchFlipShouldAnimate(false, false, true), false, 'pending + seen → no flip');
});

test('WOW-3 dormant under the stub: no body.launch-flip class ever appears pre-deploy', () => {
  // init() ran under the stub with vault = PENDING_DEPLOY; renderWidgetState ran
  // at least twice (init + async refreshes). The class must be absent.
  assert.strictEqual(global.document.body.classList.contains('launch-flip'), false,
    'the flip is keyed strictly off the real isDeployed seam — nothing simulated');
});

// ---------------- WOW-6 no-recompute source gate (enforced forever) ----------------
test('WOW-6 SIM source gate: the sim block references no APR pins / no yield recompute', () => {
  const begin = mainSrc.indexOf('WOW-6 SIM BEGIN');
  const end = mainSrc.indexOf('WOW-6 SIM END');
  assert.ok(begin !== -1 && end !== -1 && end > begin, 'sim source markers present');
  const slice = mainSrc.slice(begin, end);
  ['aprPins', 'WS.apr', 'liquidityShare', 'depositorAprPct', 'projectDepositorApr',
   'netAprPct', 'poolNetApr', 'METHODOLOGY_FOOTNOTE'].forEach(function (banned) {
    assert.strictEqual(slice.indexOf(banned), -1,
      'the sim block must not reference ' + banned + ' (no yield recompute, forever)');
  });
  // the ONLY math the sim block ships: a division of two displayed quantities
  assert.ok(slice.indexOf('sizeUsd / tvlUsd') !== -1, 'the sim share is the plain division');
  // the projection writer lives OUTSIDE the slice (publish fan-out, verbatim)
  const outside = mainSrc.slice(0, begin) + mainSrc.slice(end);
  assert.ok(outside.indexOf('setSimProjection') !== -1, 'setSimProjection consumes the fan-out');
  assert.strictEqual(slice.indexOf('setSimProjection'), -1, 'the sim block never writes the projection');
});

// ---------------- the projection is consumed verbatim, never spectacularized ----------------
test('yield-seam: the projection label register survives the re-pin untouched', () => {
  assert.strictEqual(apr.LABEL, 'projected, methodology-linked');
  const p = apr.projectDepositorApr(config.aprMethodology.phase0Baseline.netAprPct, config.aprPins, config.economics);
  assert.ok(String(p.depositorAprPct).length > 0 && isFinite(p.depositorAprPct));
  // the published register stays a tilde-projection, never an absolute promise
  assert.ok(apr.METHODOLOGY_FOOTNOTE.indexOf('projection, not a promise') !== -1);
  assert.ok(apr.METHODOLOGY_FOOTNOTE.indexOf('0.10%/yr') !== -1, 'the ratified floor is stated plainly');
  assert.ok(apr.METHODOLOGY_FOOTNOTE.indexOf('40.310%/yr') !== -1, 'the ratified pool median is stated plainly');
});
