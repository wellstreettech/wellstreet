'use strict';
// HOOKS-REGISTER (G1 HOOKS-REGISTER-SERVE, 2026-10-05) — permanent battery over the
// published hooks census: site/data/hooks_register.json (5,558 hooks) +
// site/data/hooks_by_pool.json (402 pools). This file holds the REBOOT-SURVIVABLE half
// of the G2 gate — every assert is derivable from the published bytes + the frozen
// fixture (docs/ops/v4_fee_screen.json, md5-pinned). The full-census cross-consistency
// vs the session-local raw banks stays in docs/ops/hooks_verify_g2.py (pre-reboot only;
// that script is the LOCAL-ONLY ops class, never committed).
//
// Provenance pins enforced here:
//   - zero session-scratch paths in published bytes (meta provenance is repo-relative)
//   - name fields are null everywhere (null-until-curated-alias policy) and no
//     hook-project alias words appear anywhere in the published bytes
//   - fixture md5 pin 92c54bd870d72fb4dc1d9a6b586ef650 matches file AND meta
//   - mask is the fork low-14-bit window of the hook address; the five danger flags
//     recompute exactly from the mask per the rule documented in meta
//   - selection rule: books >= 10 OR inFixture > 0 OR mask in the two known mask cohorts
//   - the sidecar's 402 pools cover the fixture poolIds exactly, and every sidecar row
//     agrees with the register's entry for the same hook
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const REG_PATH = path.join(ROOT, 'site', 'data', 'hooks_register.json');
const SIDE_PATH = path.join(ROOT, 'site', 'data', 'hooks_by_pool.json');
const FIX_PATH = path.join(ROOT, 'docs', 'ops', 'v4_fee_screen.json');

const MD5_PIN = '92c54bd870d72fb4dc1d9a6b586ef650';
const MASK_COHORTS = new Set(['0x14c0', '0x28cc']);
const FLAG_BITS = [
  ['returnsDeltas', 0x0c],
  ['touchesLiquidityRemoval', 0x300],
  ['setsDynamicFee', 0x80],
  ['touchesAddLiquidity', 0xc00],
  ['donate', 0x30],
];
const REG_META_KEYS = ['generatedAt', 'sourceFiles', 'fixtureMd5', 'namePolicy', 'coverage',
  'dangerFlagRule', 'labelTierRule', 'codePresence', 'sweepDoc', 'rawBankNote'];
const HOOK_KEYS = ['hook', 'mask', 'permissions', 'books', 'inFixture', 'newSinceFixtureHead',
  'codePresence', 'codeHexLen', 'dangerFlags', 'classes', 'labelTier', 'name'];

const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
const side = JSON.parse(fs.readFileSync(SIDE_PATH, 'utf8'));
const fixture = JSON.parse(fs.readFileSync(FIX_PATH, 'utf8'));
const regRaw = fs.readFileSync(REG_PATH);
const sideRaw = fs.readFileSync(SIDE_PATH);

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }
function flagsFromMask(maskHex) {
  const m = BigInt(maskHex);
  const out = {};
  for (const [k, bits] of FLAG_BITS) { out[k] = (m & BigInt(bits)) !== 0n; }
  return out;
}
function maskFromHook(hookHex) { return '0x' + (BigInt(hookHex) & 0x3fffn).toString(16); }

test('register: parses, non-empty, every hook carries the full schema key set', () => {
  assert.ok(Array.isArray(reg.hooks) && reg.hooks.length > 0);
  for (const h of reg.hooks) {
    for (const k of HOOK_KEYS) { assert.ok(k in h, `hook ${h.hook} missing key ${k}`); }
  }
});

test('register: hook and mask field formats (40-hex hook, 1-4 hex low-window mask)', () => {
  for (const h of reg.hooks) {
    assert.match(h.hook, /^0x[0-9a-f]{40}$/, h.hook);
    assert.match(h.mask, /^0x[0-9a-f]{1,4}$/, h.hook);
  }
});

test('register: mask is the fork low-14-bit window of the hook address', () => {
  for (const h of reg.hooks) {
    assert.strictEqual(maskFromHook(h.hook), h.mask, h.hook);
  }
});

test('register: dangerFlags shape — exactly the five documented keys, all boolean', () => {
  const keys = FLAG_BITS.map(([k]) => k).sort();
  for (const h of reg.hooks) {
    assert.deepStrictEqual(Object.keys(h.dangerFlags).sort(), keys, h.hook);
    for (const v of Object.values(h.dangerFlags)) { assert.strictEqual(typeof v, 'boolean', h.hook); }
  }
});

test('register: dangerFlags recompute exactly from the mask per the documented rule', () => {
  for (const h of reg.hooks) {
    assert.deepStrictEqual(h.dangerFlags, flagsFromMask(h.mask), h.hook);
  }
});

test('register: codePresence domain + codeHexLen coupling (unprobed iff null, coded iff positive, codeless iff zero)', () => {
  for (const h of reg.hooks) {
    assert.ok(['coded', 'codeless', 'unprobed'].includes(h.codePresence), h.hook);
    assert.strictEqual(h.codePresence === 'unprobed', h.codeHexLen === null, h.hook);
    if (h.codePresence === 'coded') {
      assert.ok(Number.isInteger(h.codeHexLen) && h.codeHexLen > 0, h.hook);
    } else if (h.codePresence === 'codeless') {
      assert.strictEqual(h.codeHexLen, 0, h.hook);
    }
  }
});

test('register: labelTier domain; LABEL-LIE hooks always carry a PAYS-LPS class', () => {
  for (const h of reg.hooks) {
    assert.ok(h.labelTier === null || h.labelTier === 'LABEL-LIE', h.hook);
    if (h.labelTier === 'LABEL-LIE') {
      assert.ok(h.classes.includes('PAYS-LPS'), h.hook);
    }
  }
});

test('register: classes are string arrays from the known domain; empty = census-only hook', () => {
  const domain = new Set(['PAYS-LPS', 'HOOK-MONETIZED', 'DEAD']);
  for (const h of reg.hooks) {
    assert.ok(Array.isArray(h.classes), h.hook);
    for (const c of h.classes) { assert.ok(domain.has(c), `${h.hook}: ${c}`); }
    if (h.classes.length > 0) { assert.ok(h.inFixture > 0, `${h.hook}: classes without fixture books`); }
  }
});

test('register: counters are non-negative integers; no duplicate hooks', () => {
  const seen = new Set();
  for (const h of reg.hooks) {
    for (const k of ['books', 'inFixture', 'newSinceFixtureHead']) {
      assert.ok(Number.isInteger(h[k]) && h[k] >= 0, `${h.hook}: ${k}`);
    }
    assert.ok(!seen.has(h.hook), `duplicate hook ${h.hook}`);
    seen.add(h.hook);
  }
});

test('register: selection rule — books >= 10 OR inFixture > 0 OR known mask cohort', () => {
  for (const h of reg.hooks) {
    const inRule = h.books >= 10 || h.inFixture > 0 || MASK_COHORTS.has(h.mask);
    assert.ok(inRule, `hook ${h.hook} outside selection rule`);
  }
});

test('register: name fields are null everywhere (null-until-curated-alias)', () => {
  for (const h of reg.hooks) { assert.strictEqual(h.name, null, h.hook); }
});

test('register: meta carries the full provenance key set with the pinned fixture md5', () => {
  for (const k of REG_META_KEYS) { assert.ok(k in reg.meta, `meta missing ${k}`); }
  assert.strictEqual(reg.meta.fixtureMd5, MD5_PIN);
  assert.match(reg.meta.sweepDoc, /^VIBE repo: docs\/research\//);
});

test('fixture: md5 matches the hard pin and the register meta pin', () => {
  const got = md5(fs.readFileSync(FIX_PATH));
  assert.strictEqual(got, MD5_PIN);
  assert.strictEqual(reg.meta.fixtureMd5, got);
});

test('sidecar: exactly 402 pools covering the fixture poolIds exactly', () => {
  assert.ok(side.meta && typeof side.meta === 'object');
  const pools = side.pools;
  assert.strictEqual(typeof pools, 'object');
  const fxIds = Object.keys(fixture.pools);
  assert.strictEqual(fxIds.length, 402);
  assert.strictEqual(Object.keys(pools).length, 402);
  const sideIds = new Set(Object.keys(pools));
  for (const pid of fxIds) { assert.ok(sideIds.has(pid), `fixture pool missing from sidecar: ${pid}`); }
});

test('sidecar: every row recomputes mask-from-hook and flags-from-mask', () => {
  for (const [pid, row] of Object.entries(side.pools)) {
    assert.match(row.hook, /^0x[0-9a-f]{40}$/, pid);
    assert.strictEqual(maskFromHook(row.hook), row.mask, pid);
    assert.deepStrictEqual(row.dangerFlags, flagsFromMask(row.mask), pid);
    assert.ok(['coded', 'codeless', 'unprobed'].includes(row.codePresence), pid);
  }
});

test('sidecar agrees with the register on every shared hook (mask, flags, codePresence)', () => {
  const byHook = new Map(reg.hooks.map((h) => [h.hook, h]));
  for (const [pid, row] of Object.entries(side.pools)) {
    const h = byHook.get(row.hook);
    assert.ok(h, `sidecar hook absent from register: ${pid}`);
    assert.strictEqual(h.mask, row.mask, pid);
    assert.deepStrictEqual(h.dangerFlags, row.dangerFlags, pid);
    assert.strictEqual(h.codePresence, row.codePresence, pid);
  }
});

test('published bytes: no session-scratch path markers anywhere', () => {
  for (const [label, raw] of [['register', regRaw], ['sidecar', sideRaw]]) {
    assert.ok(!raw.includes(Buffer.from('/tmp')), `${label}: scratch path in published bytes`);
    assert.ok(!raw.includes(Buffer.from('/home/')), `${label}: absolute machine path in published bytes`);
  }
});

test('published bytes: name-null parity — every name field is explicitly null', () => {
  const keyRe = /"name"\s*:/g;
  const nullRe = /"name"\s*:\s*null/g;
  for (const [label, raw] of [['register', regRaw], ['sidecar', sideRaw]]) {
    const text = raw.toString('utf8');
    assert.strictEqual((text.match(keyRe) || []).length, (text.match(nullRe) || []).length,
      `${label}: name key count differs from null count`);
  }
});

test('published bytes: no hook-project alias words anywhere', () => {
  for (const [label, raw] of [['register', regRaw], ['sidecar', sideRaw]]) {
    const text = raw.toString('utf8');
    assert.doesNotMatch(text, /\bwth\b/i, `${label}: alias word present`);
    assert.doesNotMatch(text, /hookr/i, `${label}: alias word present`);
  }
});
