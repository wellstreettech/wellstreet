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

// ---------------- LAUNCH-FACT-RECONCILE: the launch fact is single-sourced ----------------
// BYTE-ONLY source gate: fs-reads the site files, never evaluates live config/vault
// state (a committed isDeployed assert would red CI the day the on-chain state
// changes — the state check lives in the dispatch-time STATE PROBE instead).
// QUOTED-LITERAL counting is mandatory: the short literal is a strict SUBSTRING of
// the long one, so naive substring counting miscounts a CORRECT build.
test('launch fact single-sourced: one quoted literal per state, statics byte-equal to the constant', () => {
  const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');

  // (a) each state literal occurs exactly once in main.js as a QUOTED literal
  assert.strictEqual((mainSrc.match(/'awaiting on-chain deploy'/g) || []).length, 1,
    'pendingShort quoted exactly once (it is a strict substring of the long form — quote-counting is mandatory)');
  assert.strictEqual((mainSrc.match(/'awaiting on-chain deploy — yield phase not started'/g) || []).length, 1,
    'the long pending literal quoted exactly once (inside LAUNCH_FACT)');
  assert.strictEqual((mainSrc.match(/'deployed — yield phase live'/g) || []).length, 1,
    'the deployed literal quoted exactly once (inside LAUNCH_FACT)');
  assert.strictEqual((mainSrc.match(/'The vault is not yet on-chain[^']*'/g) || []).length, 1,
    'prosePending quoted exactly once');
  assert.strictEqual((mainSrc.match(/'The vault is on-chain[^']*'/g) || []).length, 1,
    'proseDeployed quoted exactly once');

  // (b) BYTE-ONLY index.html pins (re-pinned 2026-09-04: Branch B in force — the
  // config carries the deployed addresses, so the statics carry the deployed
  // register and the superseded dated prose is gone)
  assert.strictEqual((indexSrc.match(/deploy\(ed|s\) 20\d\d/g) || []).length, 0,
    'index.html never hard-dates the deploy fact');
  assert.strictEqual((indexSrc.match(/awaiting on-chain deploy — yield phase not started/g) || []).length, 0,
    'the pending long string occurs 0 times in the statics (Branch B)');
  assert.strictEqual((indexSrc.match(/deployed — yield phase live/g) || []).length, 2,
    'exactly the two statics (hero-ledger vault row + flow node) carry the deployed register');

  // (c) the writer + its NULL-GUARD exist in main.js (this battery's DOM stub
  // returns null for EVERY id — init() must not throw)
  assert.ok(mainSrc.indexOf('vaults-launch-fact') !== -1, 'the launch-fact writer is wired');
  assert.ok(/var n = \$\('vaults-launch-fact'\);\s*if \(n\)/.test(mainSrc),
    'the writer is NULL-guarded (if (n) adjacent to the vaults-launch-fact lookup)');

  // (d) the ACTUAL single-source invariant: the static span text is byte-equal to the
  // proseDeployed value parsed out of the LAUNCH_FACT constant — the two necessary
  // copies (static first paint/noscript + JS constant) must never re-split.
  const constMatch = mainSrc.match(/proseDeployed:\s*'([^']*)'/);
  assert.ok(constMatch, 'proseDeployed parsed out of LAUNCH_FACT in main.js');
  const spanMatch = indexSrc.match(/id="vaults-launch-fact">([^<]*)<\/span>/);
  assert.ok(spanMatch, 'the static launch-fact span is present in index.html');
  assert.strictEqual(spanMatch[1], constMatch[1],
    'the static span text is byte-equal to proseDeployed');
});

// ---------------- WS-PRODUCT-GAPS (2026-09-05) ----------------
// P1 pause gate: only a VERIFIED paused=true blocks the deposit side; an
// unknown read (null/undefined) never does — and never fabricates a row.
test('P1 depositsOpen: a verified pause blocks the deposit side; unknown never does', () => {
  const wow2 = global.WS.wow;
  assert.strictEqual(wow2.depositsOpen(true, false), true, 'unpaused + ready → deposit side open');
  assert.strictEqual(wow2.depositsOpen(true, true), false, 'verified pause → deposit side closed');
  assert.strictEqual(wow2.depositsOpen(false, true), false, 'no wallet gates regardless');
  assert.strictEqual(wow2.depositsOpen(true, null), true, 'unknown read (null) → gate stays as inputsReady');
  assert.strictEqual(wow2.depositsOpen(true, undefined), true, 'unknown read (undefined) → same');
});

// Honesty-string pins for the five WS-PRODUCT-GAPS strings (verbatim, one home
// each): the pause row states the pause + the redeem guarantee and never a
// duration; the position line carries the share-price qualifier; the preview
// names the chain as the final pricer (never "you will receive"); the flow
// deposit node's pending sentence lives ONLY in main.js's writer (Branch B:
// the deployed register is the static first paint); the stale pre-deploy
// coverage claim is gone from the statics, replaced by the self-verify truth.
test('WS-PRODUCT-GAPS honesty strings: verbatim single-source pins, no overclaim', () => {
  assert.strictEqual((mainSrc.match(/Deposits are paused on the vault\. Redemptions are never pausable — exits stay open\./g) || []).length, 1,
    'the pause row is quoted exactly once in main.js');
  assert.ok(mainSrc.indexOf('at the current share price.') !== -1, 'the position ≈ carries the share-price qualifier');
  assert.ok(mainSrc.indexOf('the chain prices the final amount.') !== -1, 'the preview names the chain as the final pricer');
  assert.strictEqual(mainSrc.indexOf('you will receive'), -1, 'never a receive-promise in the JS');

  const indexSrc2 = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.strictEqual(indexSrc2.indexOf('you will receive'), -1, 'never a receive-promise in the statics');
  assert.strictEqual((indexSrc2.match(/open — approve the vault, then deposit/g) || []).length, 1,
    'the flow deposit node ships the deployed register statically, exactly once');
  assert.strictEqual(indexSrc2.indexOf('deposits activate when the vault deploys'), -1,
    'the pending sentence never ships statically (Branch B)');
  assert.ok(mainSrc.indexOf('deposits activate when the vault deploys') !== -1,
    'the pending sentence lives in main.js\'s FLOW_DEPOSIT_SUB writer');
  assert.strictEqual((indexSrc2.match(/verify it yourself with any RPC client/g) || []).length, 2,
    'the noscript coverage truth is exactly the two static seam cells');
  assert.strictEqual(indexSrc2.indexOf('awaiting address wiring'), -1,
    'the stale pre-deploy coverage claim is gone from the statics');
  // the new strings carry no yield figure, no owner language, no VIBE
  // (verified absent from BOTH files before pinning — byte-presence greps)
  for (const s of ['APY', 'guaranteed', 'risk-free', 'no owner', 'ownerless', 'VIBE']) {
    assert.strictEqual(mainSrc.indexOf(s), -1, 'main.js hygiene: ' + s);
    assert.strictEqual(indexSrc2.indexOf(s), -1, 'index.html hygiene: ' + s);
  }
});
