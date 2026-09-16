'use strict';
// LIVE-STATE-TRUTH-PASS (2026-09-16) — the executed-state teeth for the roamer
// stack's LIVE operational surfaces (site/js/config.js + docs/ops/roam-ops.md).
//
// P0–P3 are ALL EXECUTED on chain 4663: the vault went LIVE 2026-09-13 (seeded
// 12.473590 USDG) and P3 executed 2026-09-15 (CallExecuted logs, blocks
// 63613942 / 63615327) — 9.504377 USDG deployed in the USDG/ETH anchor book,
// 2.969213 idle. These teeth fail loudly if the config prose ever regresses to
// the pre-execution "P3 queued / capital-inert" story, if a full execute-tx pin
// is lost, if a moved governance row is deleted or re-carries a stale readyAt,
// if the ops runbook header ever claims the capital is inert again, or if the
// renderer's status map drifts from the vault state machine.
//
// Live ground truth (keyless RPC, re-verified at goal time):
//   RoamVault.harvester()  = 0xC7a21Aa8…54dC68 (the roamer — bound by P3-A)
//   RoamVault.totalAssets()= 12473590 (12.473590 USDG at 6 decimals)
//   Timelock.readyAt(P3-A id) = 0 (executed rows carry NO readyAt — the live
//   readyAt(bytes32) read is the queue-state source)
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const configSrc = fs.readFileSync(path.join(ROOT, 'site', 'js', 'config.js'), 'utf8');
const vaultSrc = fs.readFileSync(path.join(ROOT, 'site', 'js', 'vault.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'site', 'js', 'main.js'), 'utf8');
const roamOpsSrc = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'roam-ops.md'), 'utf8');

// abi.js FIRST (house order — vault.test.js precedent): the UMD require
// populates globalThis.WS.abi before config.js loads.
require(path.join(ROOT, 'site', 'js', 'abi.js'));
const config = require(path.join(ROOT, 'site', 'js', 'config.js'));

const STALE_PHRASES = [
  'P3 deploy queued',
  'P3 pair QUEUED, NOT executed',
  'the P3 capital deploy is Safe-queued',
  'reads 0x0 until P3-A executes'
];
const P3A_ID = '0x7c982d3603b0c7e4ae3d57b609ddc0aef93e0444cc938ad52afff5058640f5ee';
const P3B_ID = '0x57fc2f0d3ff91ef752f442373bbc35e7d48e84066575adba91feb72084b876c6';
const P3A_EXECUTE_TX = '0x2baa06ed54446656db2f839032733c8cd3dfbb157c1e3a92be7760a7c8428922';
const P3B_EXECUTE_TX = '0xb2de3d0068876038d4f11b44103718b6a45af99ef1ca1a4993c0b2d49f0175cd';

// ---------------- (i) the four stale pre-execution phrases are GONE ----------

test('LIVE-STATE-TRUTH (i): config.js contains NONE of the four stale P3-queued phrases', () => {
  for (const phrase of STALE_PHRASES) {
    assert.strictEqual(configSrc.indexOf(phrase), -1,
      'stale phrase absent from config.js: "' + phrase + '"');
  }
});

// ---------------- (ii) the FULL execute-tx hashes are pinned -----------------

test('LIVE-STATE-TRUTH (ii): config.js pins BOTH full-length P3 execute-tx hashes', () => {
  assert.ok(configSrc.indexOf(P3A_EXECUTE_TX) !== -1,
    'P3-A execute tx pinned full-length: ' + P3A_EXECUTE_TX);
  assert.ok(configSrc.indexOf(P3B_EXECUTE_TX) !== -1,
    'P3-B execute tx pinned full-length: ' + P3B_EXECUTE_TX);
});

// ---------------- (iii) governance shape: queued empty, P3 in executed[] -----

test('LIVE-STATE-TRUTH (iii): governance.queued empty; executed >= 5 rows; BOTH P3 ids in executed[] with executedAt 2026-09-15', () => {
  const g = config.roamStack.governance;
  assert.ok(Array.isArray(g.queued) && g.queued.length === 0, 'queued[] is empty');
  assert.ok(Array.isArray(g.executed) && g.executed.length >= 5, 'executed[] carries >= 5 rows');
  const p3a = g.executed.find((r) => r.id === P3A_ID);
  const p3b = g.executed.find((r) => r.id === P3B_ID);
  assert.ok(p3a, 'P3-A id present in executed[] (never deleted)');
  assert.ok(p3b, 'P3-B id present in executed[] (never deleted)');
  assert.strictEqual(p3a.executedAt.slice(0, 10), '2026-09-15', 'P3-A executedAt 2026-09-15');
  assert.strictEqual(p3b.executedAt.slice(0, 10), '2026-09-15', 'P3-B executedAt 2026-09-15');
  assert.strictEqual(p3a.tx, P3A_EXECUTE_TX, 'P3-A row tx = the full execute tx');
  assert.strictEqual(p3b.tx, P3B_EXECUTE_TX, 'P3-B row tx = the full execute tx');
  assert.strictEqual('readyAt' in p3a, false, 'executed P3-A row carries NO stale readyAt');
  assert.strictEqual('readyAt' in p3b, false, 'executed P3-B row carries NO stale readyAt');
});

// ---------------- (iv) the ops runbook states the LIVE/deployed truth --------

test('LIVE-STATE-TRUTH (iv): docs/ops/roam-ops.md has zero CAPITAL-INERT and its header states the LIVE/deployed status', () => {
  assert.strictEqual(roamOpsSrc.indexOf('CAPITAL-INERT'), -1,
    'the CAPITAL-INERT claim is gone from the ops runbook');
  const header = roamOpsSrc.slice(0, roamOpsSrc.indexOf('\nTrust model'));
  assert.ok(/Status: LIVE/.test(header), 'header Status line states LIVE');
  assert.ok(/DEPLOYED/.test(header), 'header states the DEPLOYED status');
  assert.ok(/2026-09-15/.test(header), 'header carries the P3-executed date');
});

// ---------------- (v) renderer status map covers the vault state machine -----

test('LIVE-STATE-TRUTH (v): every governanceStatus return value in vault.js has a GOV_STATUS key in main.js', () => {
  const fnStart = vaultSrc.indexOf('function governanceStatus(');
  assert.ok(fnStart !== -1, 'governanceStatus found in vault.js');
  const fnBody = vaultSrc.slice(fnStart, vaultSrc.indexOf('\n  function ', fnStart + 1));
  const returns = new Set();
  for (const line of fnBody.split('\n')) {
    if (line.indexOf('return') === -1) { continue; }
    for (const m of line.matchAll(/'([a-z-]+)'/g)) { returns.add(m[1]); }
  }
  assert.deepStrictEqual(Array.from(returns).sort(),
    ['executable', 'not-queued', 'queued', 'unknown'],
    'the vault state machine returns exactly the four statuses');
  const block = mainSrc.match(/var GOV_STATUS = \{([\s\S]*?)\};/);
  assert.ok(block, 'GOV_STATUS map found in main.js');
  const keys = new Set();
  for (const m of block[1].matchAll(/^\s*('?)([A-Za-z-]+)\1\s*:/gm)) {
    keys.add(m[2]);
  }
  for (const r of returns) {
    assert.ok(keys.has(r), 'GOV_STATUS carries a key for governanceStatus return "' + r + '"');
  }
});
