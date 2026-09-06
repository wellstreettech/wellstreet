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

// ---- WS-MULTI-VAULT-FRONTEND (2026-09-05): the vault family pins ----------------
// The family config is the frontend's source of truth for the multi-vault roster:
// exactly ONE live flagship + >= 4 DEPLOY-GATED tiers, every gated tier carrying
// the honest APR note VERBATIM and no yield figure anywhere.

const config = require('../site/js/config.js');
const FLAGSHIP_VAULT = '0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01';
const APR_NOTE = 'APR published post-deploy from measured harvests — backward-looking only';

test('vaultFamily: exists with the flagship + >= 4 gated entries', () => {
  assert.ok(Array.isArray(config.vaultFamily), 'vaultFamily is an array');
  assert.ok(config.vaultFamily.length >= 5, 'family carries >= 5 entries, got: ' + config.vaultFamily.length);
  const gated = config.vaultFamily.filter(function (f) { return f.vault === config.PENDING_DEPLOY; });
  assert.ok(gated.length >= 4, '>= 4 family entries are DEPLOY-GATED (vault === PENDING_DEPLOY), got: ' + gated.length);
});

test('vaultFamily: the flagship is LIVE and pins the deployed vault address', () => {
  const flagship = config.vaultFamily.filter(function (f) { return f.id === 'ws-spy'; })[0];
  assert.ok(flagship, 'flagship ws-spy entry exists');
  assert.strictEqual(flagship.status, 'LIVE');
  assert.strictEqual(flagship.vault, FLAGSHIP_VAULT, 'flagship pins the F-01 broadcast vault address');
  assert.match(flagship.vault, /^0x[0-9a-fA-F]{40}$/);
  assert.strictEqual(flagship.vault, config.vaults[0].vault, 'flagship family entry agrees with the single-vault array');
  assert.strictEqual(flagship.harvester, config.contracts.harvester, 'flagship harvester agrees with the contracts pin');
  assert.strictEqual(flagship.aprNote, null, 'the LIVE flagship has no canned APR note — its APR is the live methodology register');
});

test('vaultFamily: every gated entry carries the honest APR note verbatim and no tier label lie', () => {
  const gated = config.vaultFamily.filter(function (f) { return f.vault === config.PENDING_DEPLOY; });
  for (const f of gated) {
    assert.strictEqual(f.status, 'DEPLOY-GATED', f.id + ' is explicitly DEPLOY-GATED');
    assert.strictEqual(f.harvester, config.PENDING_DEPLOY, f.id + ' harvester is gated too');
    assert.strictEqual(f.aprNote, APR_NOTE, f.id + ' carries the honest APR note verbatim');
    assert.ok(typeof f.tierLabel === 'string' && f.tierLabel.length > 0, f.id + ' carries a tier label');
  }
});

test('vaultFamily: tier labels match the ratified roster', () => {
  const byId = {};
  config.vaultFamily.forEach(function (f) { byId[f.id] = f; });
  assert.ok(byId['rblx-usdg'], 'rblx-usdg entry exists (v3, vault #2)');
  assert.ok(byId['rblx-usdg'].tierLabel.indexOf('stock / stable') !== -1, 'rblx-usdg is the stock/stable tier');
  assert.strictEqual(byId['rblx-usdg'].pool, 'rblxUsdg3000');
  assert.ok(byId['spy-usdg-v4'].tierLabel.indexOf('stock / stable (v4)') !== -1, 'spy-usdg-v4 tier label');
  assert.ok(byId['usdg-eth-v4'].tierLabel.indexOf('stable / ETH rails (v4)') !== -1, 'usdg-eth-v4 tier label');
});

test('vaultFamily: v4 tiers pin the 05-fee-screen poolIds + the fork infrastructure', () => {
  const V4_POOL_IDS = {
    'spy-usdg-v4': '0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd',
    'usdg-eth-v4': '0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551',
    'pack-nvda-v4': '0x4900c6d3f31ff1e1545a487469c134cdbd9f1499f938054c0c77a14728b3f150'
  };
  for (const [id, poolId] of Object.entries(V4_POOL_IDS)) {
    const f = config.vaultFamily.filter(function (x) { return x.id === id; })[0];
    assert.ok(f, id + ' entry exists');
    assert.strictEqual(f.engine, 'harvesterv4', id + ' is a HarvesterV4-tier entry');
    assert.strictEqual(f.poolId, poolId, id + ' pins its 05 §5 poolId');
  }
  assert.match(config.uniswapV4.poolManager, /^0x[0-9a-fA-F]{40}$/, 'fork PoolManager pinned');
  assert.match(config.uniswapV4.stateView, /^0x[0-9a-fA-F]{40}$/, 'fork StateView pinned');
});

test('vaultFamily: the PACK tier is the explicit HIGH-RISK, dust-capped entry', () => {
  const pack = config.vaultFamily.filter(function (f) { return f.highRisk; })[0];
  assert.ok(pack, 'exactly the high-risk flag marks one entry');
  assert.ok(pack.tierLabel.indexOf('HIGH RISK') !== -1, 'tier label carries the HIGH-RISK marker');
  assert.ok(/dust/i.test(pack.riskLabel), 'risk label carries the dust-cap disclosure');
});

test('vaultFamily: the rblx fee book is pinned as a real v3 pool (3000 tier)', () => {
  const p = config.pools.rblxUsdg3000;
  assert.ok(p, 'rblxUsdg3000 pool pinned in cfg.pools');
  assert.strictEqual(p.feeTier, 3000);
  assert.strictEqual(p.address, '0x1BDB8e3A79Cb1a7F228808739311E23098D33d43');
  assert.strictEqual(p.token0, '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', 'USDG is token0 (address-ordered)');
  assert.strictEqual(p.token1, '0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8', 'RBLX is token1');
});

// ---- the family reader: harvest credits + family snapshots ----------------------

test('yieldHarvestedTopic: keccak256 of the vault YieldHarvested signature (drift-detecting pin)', () => {
  // event YieldHarvested(uint256 indexed assets, uint256 newTotalAssets) — src/YieldShares.sol:81
  assert.strictEqual(vault.yieldHarvestedTopic(),
    '0x3fb12fb590bb295327f3bfc48158ada0b1147f8f823e0c7a09b98b301d186774');
});

function mockClient() {
  const calls = [];
  const client = {
    calls: calls,
    logs: null,
    call: async function (method, params) {
      calls.push(method);
      if (method === 'eth_getLogs') {
        if (this.logs === 'fail') { throw new Error('mock: rpc down'); }
        return this.logs;
      }
      if (method === 'eth_call') { return word('1000000000000000000'); }
      throw new Error('mock: unmapped method ' + method);
    },
    batch: async function (batchCalls) {
      batchCalls.forEach(function (c) { calls.push(c.method); });
      return batchCalls.map(function () { return word('1000000000000000000'); });
    }
  };
  return client;
}

test('readHarvestCredits: a PENDING_DEPLOY vault issues ZERO rpc calls and returns null', async () => {
  const client = mockClient();
  const out = await vault.readHarvestCredits(client, config.PENDING_DEPLOY);
  assert.strictEqual(out, null, 'gated vault -> null (honest), never 0');
  assert.strictEqual(client.calls.length, 0, 'the gated branch never issues an eth call');
});

test('readHarvestCredits: counts the vault YieldHarvested logs', async () => {
  const client = mockClient();
  client.logs = ['0xa', '0xb', '0xc'];
  const out = await vault.readHarvestCredits(client, FLAGSHIP_VAULT);
  assert.strictEqual(out.count, 3);
  assert.strictEqual(out.topic0, vault.yieldHarvestedTopic());
  assert.deepStrictEqual(client.calls, ['eth_getLogs']);
});

test('readHarvestCredits: ZERO logs is a REAL state ({count: 0}), never null', async () => {
  const client = mockClient();
  client.logs = [];
  const out = await vault.readHarvestCredits(client, FLAGSHIP_VAULT);
  assert.deepStrictEqual(out, { count: 0, topic0: vault.yieldHarvestedTopic() },
    '"no harvests yet" is the honest pre-accrual state — a real zero, not an unavailable read');
});

test('readHarvestCredits: a failed getLogs stays null (unavailable, never 0)', async () => {
  const client = mockClient();
  client.logs = 'fail';
  assert.strictEqual(await vault.readHarvestCredits(client, FLAGSHIP_VAULT), null);
});

test('readFamilySnapshots: gated entries return the pending state untouched, zero calls', async () => {
  const client = mockClient();
  const gated = config.vaultFamily.filter(function (f) { return f.vault === config.PENDING_DEPLOY; });
  const snaps = await vault.readFamilySnapshots(client, gated);
  assert.strictEqual(snaps.length, gated.length);
  for (let i = 0; i < snaps.length; i++) {
    assert.strictEqual(snaps[i].deployed, false, snaps[i].entryId + ' is not deployed');
    assert.strictEqual(snaps[i].pending, true, snaps[i].entryId + ' keeps the pending:true path');
    assert.strictEqual(snaps[i].familyStatus, 'DEPLOY-GATED');
    assert.strictEqual(snaps[i].harvestCount, undefined, 'no harvest read for a gated vault');
    assert.strictEqual(snaps[i].backingCoverageRaw, undefined, 'no coverage read for a gated vault');
  }
  assert.strictEqual(client.calls.length, 0, 'a fully-gated family pass issues ZERO eth calls');
});

test('readFamilySnapshots: a live entry carries snapshot + coverage + harvest count', async () => {
  const client = mockClient();
  client.logs = ['0xa', '0xb'];
  const live = [{ id: 'live-test', vault: FLAGSHIP_VAULT, asset: config.tokens.spy.address, status: 'LIVE' }];
  const snaps = await vault.readFamilySnapshots(client, live);
  assert.strictEqual(snaps.length, 1);
  assert.strictEqual(snaps[0].deployed, true);
  assert.strictEqual(snaps[0].familyStatus, 'LIVE');
  assert.strictEqual(snaps[0].harvestCount, 2, 'harvest count rides the live snapshot');
  assert.strictEqual(snaps[0].backingCoverageRaw, word('1000000000000000000'), 'coverage word rides the live snapshot');
  assert.ok(client.calls.indexOf('eth_getLogs') !== -1, 'getLogs issued for the live entry');
});
