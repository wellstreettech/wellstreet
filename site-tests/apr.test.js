'use strict';
// APR derivation tests — every published number must be recomputable from known
// inputs (spec J(a): an evaluator must be able to recompute the published number).
// The phase-0 anchors below are verbatim from docs/ops/phase0/pool-apr.md §4.2/§5/§7.
const test = require('node:test');
const assert = require('node:assert');

// Load order mirrors the browser's <script> order: modules resolve each other
// lazily off the shared WS namespace, so prerequisites must be loaded first.
const config = require('../site/js/config.js');
const abi = require('../site/js/abi.js');
const rpc = require('../site/js/rpc.js');
const geo = require('../site/js/geo.js');
const vault = require('../site/js/vault.js');
const apr = require('../site/js/apr.js');

const EPS = 1e-9;
function near(a, b, tol) {
  assert.ok(Math.abs(a - b) <= (tol || 1e-6), 'expected ' + a + ' ~ ' + b);
}

// ---------------- net multiplier from feeProtocol nibbles ----------------
test('netMultiplierFromNibbles: (4,4) -> 1/4 cut, LPs keep 75% (live SPY/500 value)', () => {
  const m = apr.netMultiplierFromNibbles(4, 4);
  near(m.cutFraction, 0.25);
  near(m.netMultiplier, 0.75);
  assert.strictEqual(m.equal, true);
  assert.strictEqual(m.note, null);
});

test('netMultiplierFromNibbles: (6,6) -> 1/6 cut (NVDA/3000 value); (0,0) -> no cut', () => {
  const m6 = apr.netMultiplierFromNibbles(6, 6);
  near(m6.netMultiplier, 5 / 6);
  const m0 = apr.netMultiplierFromNibbles(0, 0);
  near(m0.netMultiplier, 1);
  near(m0.cutFraction, 0);
});

test('netMultiplierFromNibbles: unequal nibbles take the conservative side and flag it', () => {
  const m = apr.netMultiplierFromNibbles(4, 6);
  near(m.netMultiplier, 0.75); // min(0.75, 5/6)
  assert.strictEqual(m.equal, false);
  assert.ok(m.note && m.note.length > 0);
});

// ---------------- annualization (ratified formula chain) ----------------
test('annualizeGrossAprPct reproduces the phase-0 Tue window hand-check (§7 step: 94.49%)', () => {
  // §4.2 Tue: gross fee 0.059240 WETH, TVL 274.6003 WETH, 2h window
  const gross = apr.annualizeGrossAprPct(0.059240, 274.6003, 7200);
  near(gross, 94.490, 0.001);
});

test('annualizeGrossAprPct: full chain Tue window -> net 70.87% (median-of-windows reported value)', () => {
  const gross = apr.annualizeGrossAprPct(0.059240, 274.6003, 7200);
  const net = gross * apr.netMultiplierFromNibbles(4, 4).netMultiplier;
  near(net, 70.868, 0.001); // §4.2 reported 70.868%
});

test('annualizeGrossAprPct rejects degenerate inputs', () => {
  assert.strictEqual(apr.annualizeGrossAprPct(1, 0, 7200), null);
  assert.strictEqual(apr.annualizeGrossAprPct(1, 100, 0), null);
  assert.strictEqual(apr.annualizeGrossAprPct(null, 100, 7200), null);
});

// ---------------- window computation from Swap logs ----------------
// Synthetic Swap logs: data = 5 words (int256 amount0, int256 amount1,
// uint160 sqrtPriceX96, uint128 liquidity, int24 tick). P_w = (sqrt/2^96)^2.
function swapData(amount0, amount1, sqrtPriceX96) {
  const enc = function (v) {
    const big = BigInt(v);
    const two = big < 0n ? (1n << 256n) + big : big;
    return two.toString(16).padStart(64, '0');
  };
  return '0x' + enc(amount0) + enc(amount1) + enc(sqrtPriceX96) + '00'.repeat(16) + enc(0);
}

const SQRT_P4 = 1n << 97n; // (2^97 / 2^96)^2 = 4 SPY per WETH

test('computeWindowAprFromLogs: known synthetic inputs -> exact expected output', () => {
  // window-start price P_w = 4 SPY/WETH (from the FIRST log only)
  // volumes: |a0| = 10 + 5 = 15 WETH ; |a1| = 800 + 20 = 820 SPY -> 820/4 = 205 WETH
  // volume = 220 WETH ; fee = 220 * 500/1e6 = 0.11 WETH
  // gross = 0.11/100 * (365*86400/7200) = 0.11/100 * 4380 = 4.818 -> 481.8%
  // net at cut 1/4 -> 361.35%
  const logs = [
    { data: swapData(-10000000000000000000n, 800000000000000000000n, SQRT_P4) },
    { data: swapData(5000000000000000000n, -20000000000000000000n, SQRT_P4) }
  ];
  const r = apr.computeWindowAprFromLogs(logs, {
    feeTier: 500,
    windowSeconds: 7200,
    tvlToken0: 100,
    minEvents: 2,
    n0: 4,
    n1: 4
  });
  assert.strictEqual(r.excluded, false);
  near(r.pricePw, 4.0, 1e-9);
  near(r.volumeToken0, 220.0, 1e-6);
  near(r.feeToken0, 0.11, 1e-9);
  near(r.grossAprPct, 481.8, 1e-6);
  near(r.netAprPct, 361.35, 1e-6);
  near(r.cutFraction, 0.25, EPS);
});

test('computeWindowAprFromLogs: two-sided volume takes ABSOLUTE values of signed amounts', () => {
  // both legs negative (WETH -> SPY direction) still count both sides
  const logs = [
    { data: swapData(-1000000000000000000n, -4000000000000000000n, SQRT_P4) } // 1 WETH + 4 SPY (=1 WETH at P=4)
  ];
  const r = apr.computeWindowAprFromLogs(logs, { feeTier: 500, windowSeconds: 7200, tvlToken0: 100, minEvents: 1 });
  near(r.volumeToken0, 2.0, 1e-9);
});

test('computeWindowAprFromLogs: windows under the ratified 20-event minimum are EXCLUDED', () => {
  const logs = [];
  for (let i = 0; i < 19; i++) {
    logs.push({ data: swapData(-1000000000000000000n, 4000000000000000000n, SQRT_P4) });
  }
  const r = apr.computeWindowAprFromLogs(logs, { feeTier: 500, windowSeconds: 7200, tvlToken0: 100 });
  assert.strictEqual(r.excluded, true);
  assert.ok(r.reason.indexOf('ratified minimum 20') !== -1);
});

test('computeWindowAprFromLogs: incomplete retrieval / bad price excludes the window', () => {
  const bad = apr.computeWindowAprFromLogs([{ data: '0x' }], { feeTier: 500, windowSeconds: 7200, tvlToken0: 100, minEvents: 1 });
  assert.strictEqual(bad.excluded, true);
  const badTvl = apr.computeWindowAprFromLogs(
    [{ data: swapData(-1n, 1n, SQRT_P4) }],
    { feeTier: 500, windowSeconds: 7200, tvlToken0: 0, minEvents: 1 });
  assert.strictEqual(badTvl.excluded, true);
});

// ---------------- depositor chain (the PRODUCT figure) ----------------
test('depositorAprPct at the ratified GO/NO-GO pins reproduces the recorded ~8.8% projection', () => {
  // D11: pool_net 70.87% x (LP seed $6.9k / target vault TVL $50k) x (1 - 10%) ~ 8.8%
  // Exact: 70.87 x 0.138 x 0.9 = 8.802054% (the D11 record rounds to ~8.8%).
  const d = apr.depositorAprPct(70.87, config.aprPins.lpSeedUsd, config.aprPins.targetVaultTvlUsd, config.economics.protocolFeeBpsInitial);
  near(d, 70.87 * 0.138 * 0.9, 1e-9);
  near(d, 8.802054, 1e-4);
});

test('depositorAprPct: zero LP seed -> zero projection (honest, never fabricated)', () => {
  assert.strictEqual(apr.depositorAprPct(70.87, 0, 50000, 1000), 0);
  assert.strictEqual(apr.depositorAprPct(70.87, null, 50000, 1000), 0);
  assert.strictEqual(apr.depositorAprPct(null, 6900, 50000, 1000), null);
});

test('projectDepositorApr carries the required label and the methodology-linked inputs', () => {
  const p = apr.projectDepositorApr(70.87, config.aprPins, config.economics);
  assert.strictEqual(p.label, 'projected, methodology-linked');
  assert.strictEqual(p.poolNetAprPct, 70.87);
  assert.strictEqual(p.lpTvlUsd, 6900);
  assert.strictEqual(p.targetVaultTvlUsd, 50000);
  assert.strictEqual(p.protocolFeeBps, 1000);
  near(p.lpShareOfVaultTvl, 0.138, 1e-12);
});

test('METHODOLOGY_FOOTNOTE exists and points at the public methodology doc', () => {
  assert.ok(apr.METHODOLOGY_FOOTNOTE.indexOf('docs/ops') === -1,
    'rendered footnote must not cite a private evidence path');
  assert.ok(apr.METHODOLOGY_FOOTNOTE.indexOf('methodology') !== -1,
    'rendered footnote must reference the public methodology doc');
  assert.ok(apr.METHODOLOGY_FOOTNOTE.length > 200);
});

// ---------------- pool snapshot decoders (live-data plumbing) ----------------
test('decodeSlot0 parses the pinned phase-0 capture (block 50,230,281): 7 words, feeProtocol 0x44', () => {
  const raw =
    '0x0000000000000000000000000000000000000001cc0529d7e357d439b6c69142' +
    '0000000000000000000000000000000000000000000000000000000000002dca' +
    '000000000000000000000000000000000000000000000000000000000000045c' +
    '0000000000000000000000000000000000000000000000000000000000000578' +
    '0000000000000000000000000000000000000000000000000000000000000578' +
    '0000000000000000000000000000000000000000000000000000000000000044' +
    '0000000000000000000000000000000000000000000000000000000000000001';
  const s = vault.decodeSlot0(raw);
  assert.ok(s, '7-word blob must decode');
  assert.strictEqual(Number(s.tick), 11722);
  assert.strictEqual(Number(s.observationIndex), 1116);
  assert.strictEqual(Number(s.observationCardinality), 1400);
  assert.strictEqual(Number(s.observationCardinalityNext), 1400);
  assert.strictEqual(s.unlocked, true);
  assert.strictEqual(s.feeProtocol.token0, 4);
  assert.strictEqual(s.feeProtocol.token1, 4);
  // price at capture: ~3.20 SPY per WETH (corroborates §4.2's P~3.21 at nearby blocks)
  const p = vault.priceFromSqrtPriceX96(s.sqrtPriceX96);
  assert.ok(p > 3.0 && p < 3.4, 'SPY per WETH ~3.2, got ' + p);
});

test('priceFromSqrtPriceX96: sqrt=2^97 -> price exactly 4', () => {
  near(vault.priceFromSqrtPriceX96(1n << 97n), 4.0, 1e-9);
});

test('decodeLatestRoundData parses the phase-0 RHSPY/USD capture (77026515000 @ 8 dec)', () => {
  const raw =
    '0x' +
    BigInt('18446744073709551728').toString(16).padStart(64, '0') +  // roundId
    BigInt(77026515000).toString(16).padStart(64, '0') +             // answer
    BigInt(1787933907).toString(16).padStart(64, '0') +              // startedAt
    BigInt(1787933919).toString(16).padStart(64, '0') +              // updatedAt
    BigInt('18446744073709551728').toString(16).padStart(64, '0');   // answeredInRound
  const d = vault.decodeLatestRoundData(raw);
  assert.ok(d);
  assert.strictEqual(d.answer.toString(), '77026515000');
  assert.strictEqual(d.updatedAt.toString(), '1787933919');
  assert.strictEqual(d.roundId.toString(), d.answeredInRound.toString());
});

test('feeCutFromNibbles agrees with the APR module multiplier', () => {
  const cut = vault.feeCutFromNibbles(4, 4);
  const m = apr.netMultiplierFromNibbles(4, 4);
  near(cut.netMultiplier, m.netMultiplier, EPS);
});
