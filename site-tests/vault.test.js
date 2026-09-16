'use strict';
// WS-VAULT-DATA (2026-09-13) — unit pins for the live RoamVault read layer
// (site/js/vault.js roam section + the config.roamStack address pin).
//
// Fixtures are the LIVE chain-4663 readings from 2026-09-13 (batch eth_call
// provenance, keyless public RPC):
//   totalAssets()      = 12473590          (12.473590 USDG at 6 decimals)
//   totalSupply()      = 12473590000000    (share decimals() = 12 — asset 6 + offset 6;
//                                           raw shares = raw assets × 1e6 at the 1:1 price)
//   DEPOSIT_CAP()      = 25000000000       (25,000 USDG)
//   maxDeposit(0x0)    = 24987526410       (cap − totalAssets, deposits OPEN)
//   idleBook()         = 12473590, deployedBook() = 0  (P3-B queued, not executed)
//   harvester()        = 0x000…0           (P3-A queued, not executed → 'unbound')
//   backingCoverage()  = 1e18              (exact idle-book cover)
// The chassis generalization is pinned too: the YieldShares flagship (18-dec SPY
// asset) reads share decimals 24 — every helper here is parameterized on the
// decimals figure READ FROM THE CHAIN, never hardcoded.
const test = require('node:test');
const assert = require('node:assert/strict');

// abi.js FIRST (same order as render.test.js): vault.js's pure decoders read
// root.WS.abi at call time — the UMD require below populates globalThis.WS.abi.
require('../site/js/abi.js');
const vault = require('../site/js/vault.js');
const config = require('../site/js/config.js');

function word(v) { return '0x' + BigInt(v).toString(16).padStart(64, '0'); }
function addrWord(a) { return '0x' + '0'.repeat(24) + a.slice(2).toLowerCase(); }

// ---------------- normalizeRaw: 6-dec USDG + the share-chassis fixtures --------

test('normalizeRaw: 6-dec USDG — live totalAssets 12473590 reads "12.47359"', () => {
  const n = vault.normalizeRaw('12473590', 6);
  assert.strictEqual(n.exact, '12.47359');
  assert.strictEqual(n.value, 12.47359);
});

test('normalizeRaw: 6-dec USDG — DEPOSIT_CAP 25000000000 reads "25000"', () => {
  assert.strictEqual(vault.normalizeRaw('25000000000', 6).exact, '25000');
});

test('normalizeRaw: zero reads "0" (a real state, never null)', () => {
  assert.strictEqual(vault.normalizeRaw('0', 6).exact, '0');
  assert.strictEqual(vault.normalizeRaw(0n, 6).exact, '0');
});

test('normalizeRaw: trailing zeros trimmed, no float drift at scale', () => {
  assert.strictEqual(vault.normalizeRaw('1000000', 6).exact, '1');
  assert.strictEqual(vault.normalizeRaw('12473590000', 6).exact, '12473.59');
});

test('normalizeRaw: 24-dec share chassis fixture (YieldShares form) — parameterized, not hardcoded', () => {
  // one whole share on the 18-dec-asset chassis = 10^24 raw
  assert.strictEqual(vault.normalizeRaw('1000000000000000000000000', 24).exact, '1');
});

test('normalizeRaw: the live RoamVault share supply at its VERIFIED 12 decimals reads "12.47359"', () => {
  // raw shares = raw assets × 1e6 at 1:1 — 12,473,590,000,000 at 12 dec
  assert.strictEqual(vault.normalizeRaw('12473590000000', 12).exact, '12.47359');
});

test('normalizeRaw: fail-closed — null/negative/non-integer/bad-decimals return null (never 0)', () => {
  assert.strictEqual(vault.normalizeRaw(null, 6), null);
  assert.strictEqual(vault.normalizeRaw(undefined, 6), null);
  assert.strictEqual(vault.normalizeRaw('-5', 6), null);
  assert.strictEqual(vault.normalizeRaw('0xzz', 6), null);
  assert.strictEqual(vault.normalizeRaw('12.5', 6), null);
  assert.strictEqual(vault.normalizeRaw('5', -1), null);
  assert.strictEqual(vault.normalizeRaw('5', 1.5), null);
});

// ---------------- sharePriceFromTotals: assets/supply ---------------------------

test('sharePriceFromTotals: LIVE 1:1 figures → 1,000,000 asset base units per whole share', () => {
  // 12,473,590 × 10^12 ÷ 12,473,590,000,000 = 1,000,000 (one whole share = 1 USDG)
  assert.strictEqual(vault.sharePriceFromTotals(12473590n, 12473590000000n, 12), 1000000n);
});

test('sharePriceFromTotals: normalized at the asset decimals the live price reads "1"', () => {
  const raw = vault.sharePriceFromTotals(12473590n, 12473590000000n, 12);
  assert.strictEqual(raw, 1000000n);
  assert.strictEqual(vault.normalizeRaw(raw, 6).exact, '1');
});

test('sharePriceFromTotals: the 24-dec chassis (18-dec asset) — same math, parameterized', () => {
  // 1e18 asset raw ÷ 1e24 share raw at 24 share decimals → 1e18 asset base units
  // per whole share = "1.0" at the asset's 18 decimals (api-tests/vaults.test.js pin).
  const raw = vault.sharePriceFromTotals('1000000000000000000', '1000000000000000000000000', 24);
  assert.strictEqual(raw, 1000000000000000000n);
  assert.strictEqual(vault.normalizeRaw(raw, 18).exact, '1');
});

test('sharePriceFromTotals: a yield credit RAISES the price honestly (never clamped to 1.0)', () => {
  // 1000 USDG harvest-credited on the same supply → price rises by the credit.
  // Exact floor: 13,473,590 × 10^12 ÷ 12,473,590,000,000.
  const raw = vault.sharePriceFromTotals(13473590n, 12473590000000n, 12);
  assert.strictEqual(raw, (13473590n * 1000000000000n) / 12473590000000n);
  assert.ok(raw > 1000000n);
  assert.ok(vault.normalizeRaw(raw, 6).value > 1);
});

test('sharePriceFromTotals: empty supply → null (no honest ratio; the contract\'s virtual offset covers this live)', () => {
  assert.strictEqual(vault.sharePriceFromTotals(0n, 0n, 12), null);
  assert.strictEqual(vault.sharePriceFromTotals(100n, 0n, 12), null);
});

test('sharePriceFromTotals: fail-closed — null inputs / bad decimals return null', () => {
  assert.strictEqual(vault.sharePriceFromTotals(null, 100n, 12), null);
  assert.strictEqual(vault.sharePriceFromTotals(100n, null, 12), null);
  assert.strictEqual(vault.sharePriceFromTotals(100n, 100n, null), null);
  assert.strictEqual(vault.sharePriceFromTotals(100n, 100n, 1.5), null);
});

// ---------------- cap headroom + deployment state -------------------------------

test('deriveCapHeadroom: LIVE figures — 25,000 cap − 12.47359 used = 24,987.526410 raw', () => {
  assert.strictEqual(vault.deriveCapHeadroom(25000000000n, 12473590n), 24987526410n);
});

test('deriveCapHeadroom: cap reached / exceeded floors at 0n (never negative)', () => {
  assert.strictEqual(vault.deriveCapHeadroom(1000n, 1000n), 0n);
  assert.strictEqual(vault.deriveCapHeadroom(1000n, 2000n), 0n);
});

test('deriveCapHeadroom: fail-closed on nulls', () => {
  assert.strictEqual(vault.deriveCapHeadroom(null, 100n), null);
  assert.strictEqual(vault.deriveCapHeadroom(100n, null), null);
});

test('deploymentState: harvester 0x0 (LIVE today) → "unbound" — ALL capital idle, P3-A pending', () => {
  assert.strictEqual(vault.deploymentState('0x0000000000000000000000000000000000000000', 0n), 'unbound');
});

test('deploymentState: bound + empty book → "idle" (P3-B pending); bound + book > 0 → "deployed"', () => {
  const roamer = '0xc7a21aa8c15c7032ee2e8352244a0f3d2154dc68';
  assert.strictEqual(vault.deploymentState(roamer, 0n), 'idle');
  assert.strictEqual(vault.deploymentState(roamer, 1000000n), 'deployed');
});

test('deploymentState: null reads → "unknown" (renders unavailable, never a fabricated state)', () => {
  assert.strictEqual(vault.deploymentState(null, 0n), 'unknown');
  assert.strictEqual(vault.deploymentState('0xc7a21aa8c15c7032ee2e8352244a0f3d2154dc68', null), 'unknown');
});

// ---------------- the config.roamStack pin --------------------------------------

const ADDR = /^0x[0-9a-fA-F]{40}$/;
const TXHASH = /^0x[0-9a-fA-F]{64}$/;
const HEX32 = /^0x[0-9a-f]{64}$/;

test('config.roamStack: pinned, all addresses full 40-hex (never PENDING, never truncated)', () => {
  const rs = config.roamStack;
  assert.ok(rs, 'roamStack exists');
  for (const k of ['vault', 'roamer', 'allowlist', 'usdg', 'timelock', 'safe']) {
    assert.match(rs[k], ADDR, k + ' is a full address');
  }
  assert.match(rs.usdgEthPoolId, HEX32, 'poolId is a full 32-byte hex');
});

test('config.roamStack: the vault + roamer carry the verified 2026-09-13 addresses', () => {
  assert.strictEqual(config.roamStack.vault, '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86');
  assert.strictEqual(config.roamStack.roamer, '0xC7a21Aa8C15C7032eE2e8352244a0f3D2154dC68');
  assert.strictEqual(config.roamStack.timelock, config.contracts.treasuryTimelock);
});

test('config.roamStack.governance: queued EMPTY — the P3 pair EXECUTED 2026-09-15 (rows moved to executed[], never deleted)', () => {
  const g = config.roamStack.governance;
  assert.ok(Array.isArray(g.queued) && g.queued.length === 0,
    'queued[] ends empty — the live readyAt(bytes32) read is the queue-state source');
  // FULL ids pinned EXACTLY as read from the on-chain WellstreetTimelock
  // CallQueued logs (2026-09-13), EXECUTED 2026-09-15 (CallExecuted logs,
  // blocks 63613942 / 63615327). Note: the locked goal doc's truncated P3-A
  // form read "0x7c982d36…64f5ee" — the on-chain id ends "…8640f5ee"; the log
  // is authoritative over the doc's human-truncated suffix. P3-B matches the
  // doc exactly (0x57fc2f0d…b876c6).
  const p3a = g.executed.find((r) => r.id === '0x7c982d3603b0c7e4ae3d57b609ddc0aef93e0444cc938ad52afff5058640f5ee');
  const p3b = g.executed.find((r) => r.id === '0x57fc2f0d3ff91ef752f442373bbc35e7d48e84066575adba91feb72084b876c6');
  assert.ok(p3a, 'P3-A id lives in executed[]');
  assert.ok(p3b, 'P3-B id lives in executed[]');
  // tx REPOINTED to the FULL execute tx hashes (never truncated)
  assert.strictEqual(p3a.tx, '0x2baa06ed54446656db2f839032733c8cd3dfbb157c1e3a92be7760a7c8428922');
  assert.strictEqual(p3b.tx, '0xb2de3d0068876038d4f11b44103718b6a45af99ef1ca1a4993c0b2d49f0175cd');
  assert.strictEqual(p3a.executedAt.slice(0, 10), '2026-09-15', 'P3-A executed 2026-09-15');
  assert.strictEqual(p3b.executedAt.slice(0, 10), '2026-09-15', 'P3-B executed 2026-09-15');
  // queuedAt kept verbatim; the ORIGINAL queue txs preserved verbatim as queuedTx
  assert.strictEqual(p3a.queuedAt, '2026-09-13T09:46:26Z');
  assert.strictEqual(p3b.queuedAt, '2026-09-13T09:50:52Z');
  assert.strictEqual(p3a.queuedTx, '0xc341c565de203f383c98198f8d53cd4cc9eddf65017bf1eb7eeebc472d322bf3');
  assert.strictEqual(p3b.queuedTx, '0xda1cfe8e9813b83577f661a16a5ecd9ec0db1ad19ccf938c583b523e88f961f0');
  // readyAt DELETED on the moved rows — a stale readyAt string on an executed
  // row would be a future false-claim (on-chain readyAt(id) reads 0 for both)
  assert.strictEqual('readyAt' in p3a, false, 'moved P3-A row carries NO readyAt field');
  assert.strictEqual('readyAt' in p3b, false, 'moved P3-B row carries NO readyAt field');
  // appended in order: P0, P1, P2, P3-A, P3-B
  assert.strictEqual(g.executed.length, 5, 'five executed rows — P0 P1 P2 P3-A P3-B');
  assert.match(g.executed[3].id, HEX32);
  assert.match(g.executed[4].id, HEX32);
  assert.notStrictEqual(g.executed[3].id, g.executed[4].id);
});

test('config.roamStack.governance: P0/P1/P2 executed with dated tx links', () => {
  const ex = config.roamStack.governance.executed;
  assert.ok(Array.isArray(ex) && ex.length >= 3, 'P0/P1/P2 recorded');
  assert.strictEqual(ex[0].executedAt.slice(0, 10), '2026-09-13');
  for (const op of ex) assert.match(op.tx, TXHASH, 'executed tx link present');
});

test('config.roamStack: the dated status note is present', () => {
  assert.ok(/vault LIVE 2026-09-13/.test(config.roamStack.statusNote), 'LIVE date');
  assert.ok(/2026-09-15/.test(config.roamStack.statusNote), 'P3 executed date');
});

// ---------------- readRoamVaultSnapshot: live-shape decode + fail-closed --------

// Mock rpc client routing on (to, data-prefix) — mirrors the injected client
// contract of site/js/rpc.js createRpcClient (batch: calls → aligned results).
function mockClient(routes, opts) {
  const calls = [];
  return {
    calls,
    batch: async function (arr) {
      calls.push(arr.map(function (c) { return { to: c.params[0].to, data: c.params[0].data }; }));
      if (opts && opts.throwOnBatch) { throw new Error('All RPC endpoints failed'); }
      return arr.map(function (c) {
        const to = c.params[0].to.toLowerCase();
        const sel = c.params[0].data.slice(0, 10);
        const hit = routes.find(function (r) {
          return r.to.toLowerCase() === to && r.sel === sel &&
            (r.fullData === undefined || c.params[0].data === r.fullData);
        });
        if (!hit) { throw new Error('unrouted call ' + to + ' ' + sel); }
        return hit.raw;
      });
    },
    call: async function () { throw new Error('not used by the snapshot reader'); }
  };
}

const V = '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const ZERO = '0x0000000000000000000000000000000000000000';

// LIVE 2026-09-13 shapes: round 1 (11 views on the vault) + round 2 (price + asset decimals)
function liveRoutes() {
  const sel = vault.roamSelectors();
  const routes = [
    { to: V, sel: sel.asset, raw: addrWord(USDG) },
    { to: V, sel: sel.decimals, raw: word(12) },
    { to: V, sel: sel.totalAssets, raw: word(12473590) },
    { to: V, sel: sel.totalSupply, raw: word(12473590000000) },
    { to: V, sel: sel.idleBook, raw: word(12473590) },
    { to: V, sel: sel.deployedBook, raw: word(0) },
    { to: V, sel: sel.backingCoverage, raw: word('1000000000000000000') },
    { to: V, sel: sel.depositsPaused, raw: word(0) },
    { to: V, sel: sel.maxDeposit, raw: word(24987526410) },
    { to: V, sel: sel.depositCap, raw: word(25000000000) },
    { to: V, sel: sel.harvester, raw: addrWord(ZERO) }
  ];
  const scale12 = word(10n ** 12n).slice(2);   // 10^shareDecimals, 64-hex padded
  routes.push(
    { to: V, sel: sel.convertToAssets, raw: word(1000000), fullData: sel.convertToAssets + scale12 },
    { to: USDG.toLowerCase(), sel: sel.decimals, raw: word(6) }
  );
  return routes;
}

test('readRoamVaultSnapshot: LIVE-shape decode — every figure matches the 2026-09-13 chain readings', async () => {
  const client = mockClient(liveRoutes());
  const snap = await vault.readRoamVaultSnapshot(client, { vault: V, asset: USDG });
  assert.ok(snap && snap.deployed === true);
  assert.strictEqual(snap.shareDecimals, 12);
  assert.strictEqual(snap.assetDecimals, 6);
  assert.strictEqual(snap.totalAssetsRaw, 12473590n);
  assert.strictEqual(snap.totalSupplyRaw, 12473590000000n);
  assert.strictEqual(snap.idleRaw, 12473590n);
  assert.strictEqual(snap.deployedRaw, 0n);
  assert.strictEqual(snap.depositCapRaw, 25000000000n);
  assert.strictEqual(snap.capHeadroomRaw, 24987526410n);
  assert.strictEqual(snap.maxDepositRaw, 24987526410n);
  assert.strictEqual(snap.depositsPaused, false);
  assert.strictEqual(snap.pricePerShareRaw, 1000000n);
  assert.strictEqual(snap.pricePerShareSource, 'convertToAssets(10^shareDecimals)');
  // harvester 0x0 is a FACT (unbound) — preserved as the zero address, never nulled
  assert.strictEqual(snap.harvester, ZERO);
  assert.strictEqual(snap.deploymentState, 'unbound');
});

test('readRoamVaultSnapshot: PENDING/invalid address issues ZERO eth_calls (gate, not a guess)', async () => {
  const client = mockClient(liveRoutes());
  const snap = await vault.readRoamVaultSnapshot(client, { vault: 'PENDING_DEPLOY', asset: USDG });
  assert.deepStrictEqual(snap, { deployed: false, pending: true, vault: 'PENDING_DEPLOY' });
  assert.strictEqual(client.calls.length, 0);
});

test('readRoamVaultSnapshot: a thrown batch → null (fail-closed, NEVER zero-filled)', async () => {
  const client = mockClient(liveRoutes(), { throwOnBatch: true });
  const snap = await vault.readRoamVaultSnapshot(client, { vault: V, asset: USDG });
  assert.strictEqual(snap, null);
});

test('readRoamVaultSnapshot: a short/empty payload decodes to null for that field only', async () => {
  const routes = liveRoutes();
  const sel = vault.roamSelectors();
  const broken = routes.map(function (r) {
    return r.sel === sel.totalAssets ? { to: r.to, sel: r.sel, raw: '0x' } : r;   // empty payload
  });
  const client = mockClient(broken);
  const snap = await vault.readRoamVaultSnapshot(client, { vault: V, asset: USDG });
  assert.strictEqual(snap.totalAssetsRaw, null);   // honest unavailability
  assert.strictEqual(snap.totalSupplyRaw, 12473590000000n);   // the rest survive
  // headroom depends on the cap AND totalAssets → null when either is missing
  assert.strictEqual(snap.capHeadroomRaw, null);
});

test('readRoamVaultSnapshot: unknown share decimals → the price fails closed with a recorded reason', async () => {
  const routes = liveRoutes();
  const sel = vault.roamSelectors();
  const noDecimals = routes.map(function (r) {
    return (r.to === V && r.sel === sel.decimals) ? { to: r.to, sel: r.sel, raw: '0x' } : r;
  });
  const client = mockClient(noDecimals);
  const snap = await vault.readRoamVaultSnapshot(client, { vault: V, asset: USDG });
  assert.strictEqual(snap.shareDecimals, null);
  assert.strictEqual(snap.pricePerShareRaw, null);
  assert.ok(snap.errors.some(function (e) { return e.field === 'pricePerShare'; }));
});

// ---------------- normalizeRoamSnapshot: the dashboard-facing exact strings ------

test('normalizeRoamSnapshot: LIVE snapshot → exact strings at each figure\'s own denomination', async () => {
  const client = mockClient(liveRoutes());
  const snap = await vault.readRoamVaultSnapshot(client, { vault: V, asset: USDG });
  const n = vault.normalizeRoamSnapshot(snap);
  assert.strictEqual(n.totalAssets, '12.47359');
  assert.strictEqual(n.totalShares, '12.47359');
  assert.strictEqual(n.sharePrice, '1');
  assert.strictEqual(n.idle, '12.47359');
  assert.strictEqual(n.deployed, '0');
  assert.strictEqual(n.depositCap, '25000');
  assert.strictEqual(n.capHeadroom, '24987.52641');
  assert.strictEqual(n.maxDeposit, '24987.52641');
  assert.strictEqual(n.coveragePct, '100.0%');
  assert.strictEqual(n.depositsPaused, false);
  assert.strictEqual(n.deploymentState, 'unbound');
});

test('normalizeRoamSnapshot: null inputs stay null (the renderer shows "—", never a 0-fake)', async () => {
  const routes = liveRoutes();
  const sel = vault.roamSelectors();
  // kill the dependent price call: empty convertToAssets payload
  const noPrice = routes.map(function (r) {
    return r.sel === sel.convertToAssets ? { to: r.to, sel: r.sel, raw: '0x', fullData: r.fullData } : r;
  });
  const client = mockClient(noPrice);
  const snap = await vault.readRoamVaultSnapshot(client, { vault: V, asset: USDG });
  const n = vault.normalizeRoamSnapshot(snap);
  assert.strictEqual(n.sharePrice, null);
  assert.strictEqual(n.totalAssets, '12.47359');
});

test('normalizeRoamSnapshot: a pending/non-deployed snapshot → null (no dashboard numbers at all)', () => {
  assert.strictEqual(vault.normalizeRoamSnapshot(null), null);
  assert.strictEqual(vault.normalizeRoamSnapshot({ deployed: false, pending: true }), null);
});

// ---------------- the /api/vault enhancement stays pinned to the same vault ------

test('api/vault.js: exists, exports the handler, and pins the SAME RoamVault address as config', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const endpoint = fs.readFileSync(path.join(__dirname, '..', 'api', 'vault.js'), 'utf8');
  assert.ok(endpoint.indexOf(config.roamStack.vault) !== -1, 'endpoint default = config.roamStack.vault');
  const handler = require('../api/vault.js');
  assert.strictEqual(typeof handler, 'function');
});
