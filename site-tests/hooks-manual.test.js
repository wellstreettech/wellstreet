'use strict';
// hooks-manual.test.js — the battery for the manual's eighth chapter
// (site/hooks/index.html, shipped 2026-10-10).
//
// Contract:
//   1. the page is zero-script static — the rot gate lives HERE, not on the page;
//   2. every count and mask on the page is lockstep-checked against
//      site/data/hooks_register.json + hooks_by_pool.json, so the prose cannot
//      drift from the data;
//   3. the flag windows are parsed from hooks-register.test.js's FLAG_BITS —
//      one source of truth for the bit layout;
//   4. every 40-hex literal on the page is either a chain pin or a register row;
//   5. voice + scanner hygiene identical in kind to manual-links.test.js.
// Row-landing rule: this page shipped together with its manual-index row and
// that battery's HREF_MAP entry, in the same commit.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'site', 'hooks', 'index.html');
const REG_PATH = path.join(ROOT, 'site', 'data', 'hooks_register.json');
const SIDE_PATH = path.join(ROOT, 'site', 'data', 'hooks_by_pool.json');
const CONFIG_PATH = path.join(ROOT, 'site', 'js', 'config.js');
const SKILL_PATH = path.join(ROOT, 'site', 'skills', 'wellstreet-vaults.md');
const REG_TEST_PATH = path.join(ROOT, 'site-tests', 'hooks-register.test.js');

// href as shipped on the page -> the repository file that must exist.
const HREF_MAP = {
  '../index.html': 'site/index.html',
  '../manual/index.html': 'site/manual/index.html',
  '../fonts/doto-var.woff2': 'site/fonts/doto-var.woff2',
  '../data/hooks_register.json': 'site/data/hooks_register.json',
  '../data/hooks_by_pool.json': 'site/data/hooks_by_pool.json',
  '../data/fleet.json': 'site/data/fleet.json',
  '../label-lie/index.html': 'site/label-lie/index.html',
  '../skills/wellstreet-vaults.md': 'site/skills/wellstreet-vaults.md',
  '../skills/registry.json': 'site/skills/registry.json',
};

// Chain pins (must byte-match site/js/config.js literals — test 6 proves it).
const PM = '0x8366a39CC670B4001A1121B8F6A443A643e40951';
const STATEVIEW = '0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2';
const RPC_HOST = 'https://rpc.mainnet.chain.robinhood.com';

// The three worked examples — real register rows, page table mirrors them.
const EXAMPLES = [
  '0x00000000000000000000000000000000000305a2',
  '0xfffffffffffffffffffffffffffffffffff9a8cc',
  '0x00000000000000000000000000000000000314c0',
];

const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
const side = JSON.parse(fs.readFileSync(SIDE_PATH, 'utf8'));
const raw = fs.readFileSync(PAGE_PATH, 'utf8');
const configSrc = fs.readFileSync(CONFIG_PATH, 'utf8');
const skillSrc = fs.readFileSync(SKILL_PATH, 'utf8');
const regTestSrc = fs.readFileSync(REG_TEST_PATH, 'utf8');

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}
function extractHrefs(html) {
  const out = [];
  const re = /\bhref\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) { out.push(m[1]); }
  return out;
}
function pageText(html) {
  return stripComments(html)
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ');
}
function extractComments(html) {
  const out = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m;
  while ((m = re.exec(html)) !== null) { out.push(m[1]); }
  return out;
}
function usd(n) { return n.toLocaleString('en-US'); }

test('hook manual: ships — doctype, head meta, zero scripts', () => {
  assert.ok(raw.startsWith('<!doctype html>'), 'doctype first');
  assert.ok(raw.includes('<meta charset="utf-8">'), 'charset ships');
  assert.ok(raw.includes('name="viewport"'), 'viewport ships');
  assert.match(raw, /<title>[^<]*hook manual[^<]*<\/title>/i, 'title names the chapter');
  assert.ok(raw.includes('name="description"'), 'meta description ships');
  assert.ok(raw.includes('og:title') && raw.includes('og:description'), 'og meta ships');
  assert.ok(raw.includes('twitter:card'), 'twitter meta ships');
  assert.ok(raw.includes('https://wellstreet.tech/hooks/'), 'og:url pins the surface');
  assert.ok(!/<script/i.test(raw), 'zero script tags — the rot gate lives in the battery');
});

test('hook manual: rot gate — every href declared, relative, live on disk', () => {
  const body = stripComments(raw);
  const hrefs = extractHrefs(body);
  assert.ok(hrefs.length >= 9, 'the page carries its link set');
  for (const h of hrefs) {
    assert.ok(Object.prototype.hasOwnProperty.call(HREF_MAP, h),
      'shipped href is not in the HREF_MAP: ' + h);
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(h), 'no scheme in href: ' + h);
    assert.ok(!h.startsWith('/'), 'no leading slash in href: ' + h);
    const target = path.join(ROOT, HREF_MAP[h]);
    assert.ok(fs.existsSync(target), 'mapped href does not resolve on disk: ' + h);
  }
  const shipped = new Set(hrefs);
  const declared = new Set(Object.keys(HREF_MAP));
  for (const d of declared) {
    assert.ok(shipped.has(d), 'declared target never linked on the page: ' + d);
  }
  assert.strictEqual(shipped.size, declared.size,
    'shipped href set must equal the declared set — no orphan links');
});

test('hook manual: identity — Doto face, dual-pole tokens, inline CSS only', () => {
  assert.match(raw, /@font-face/, 'the face is declared locally');
  assert.match(raw, /font-family:\s*"Doto"/, 'Doto is the display face');
  assert.ok(raw.includes("url('../fonts/doto-var.woff2')") || raw.includes('url("../fonts/doto-var.woff2")'),
    'the face loads from the shared fonts dir, relative');
  assert.match(raw, /font-weight:\s*100\s+900/, 'variable weight range declared');
  assert.ok(raw.includes('--font-display'), 'display token ships');
  for (const tok of ['#0A0E12', '#070B0E', '#EDE9DC', '#9A948A', '#262E36', '#E8A33D']) {
    assert.ok(raw.includes(tok), 'identity token missing: ' + tok);
  }
  assert.match(raw, /:root\s*\{[^}]*color-scheme:\s*dark/, 'dark pole is the root scope');
  assert.match(raw, /@media \(prefers-color-scheme: light\)/, 'the light pole ships as a media scope');
  assert.ok(raw.includes('--bg:#F2EFE6') || raw.includes('--bg: #F2EFE6'),
    'light-pole background token ships');
  assert.match(raw, /body\s*\{[^}]*background:\s*var\(--bg\)/, 'body paints an explicit background');
});

test('hook manual: data lockstep — every count on the page matches the data', () => {
  // register + sidecar counts
  assert.strictEqual(reg.hooks.length, 5558, 'register row count is the pinned 5,558');
  assert.ok(raw.includes('5,558'), 'page states the register count');
  assert.strictEqual(Object.keys(side.pools).length, 402, 'sidecar pool count is 402');
  assert.ok(raw.includes('402'), 'page states the sidecar pool count');
  // census-method receipts (frozen fixture facts — the sweep doc is the pointer)
  assert.ok(raw.includes('961,768'), 'the Initialize-log pass receipt ships');
  assert.ok(raw.includes('1,154'), 'the eth_getCode probe receipt ships');
  // label tier count, computed from the register
  const labelLie = reg.hooks.filter((r) => r.labelTier === 'LABEL-LIE').length;
  assert.strictEqual(labelLie, 270, 'LABEL-LIE row count is the pinned 270');
  assert.ok(raw.includes('270'), 'page states the LABEL-LIE row count');
  // cohort sizes, computed from the register
  const cohort = (mask) => reg.hooks.filter((r) => r.mask === mask).length;
  assert.strictEqual(cohort('0x14c0'), 19, 'the 0x14c0 cohort is nineteen rows');
  assert.strictEqual(cohort('0x28cc'), 16, 'the 0x28cc cohort is sixteen rows');
  const text = pageText(raw).toLowerCase();
  assert.ok(text.includes('nineteen'), 'the page words the 0x14c0 cohort size');
  assert.ok(text.includes('sixteen'), 'the page words the 0x28cc cohort size');
});

test('hook manual: mask decode — bit layout and flag windows match the register battery', () => {
  // parse FLAG_BITS from hooks-register.test.js — one source of truth
  const block = regTestSrc.match(/const FLAG_BITS = \[([\s\S]*?)\];/);
  assert.ok(block, 'FLAG_BITS found in the register battery');
  const pairs = [];
  const re = /\['([A-Za-z]+)',\s*(0x[0-9a-f]+)\]/g;
  let m;
  while ((m = re.exec(block[1])) !== null) { pairs.push([m[1], m[2]]); }
  assert.strictEqual(pairs.length, 5, 'five danger flags pinned');
  const low = raw.toLowerCase();
  for (const [name, hex] of pairs) {
    assert.ok(low.includes(name.toLowerCase()), 'flag missing on the page: ' + name);
    assert.ok(low.includes(hex), 'flag window missing on the page: ' + hex);
  }
  // the mask cohorts, also parsed from the register battery
  const cohorts = regTestSrc.match(/MASK_COHORTS = new Set\(\[([^\]]+)\]\)/);
  assert.ok(cohorts, 'MASK_COHORTS found in the register battery');
  for (const hex of cohorts[1].match(/0x[0-9a-f]+/g)) {
    assert.ok(low.includes(hex), 'cohort mask missing on the page: ' + hex);
  }
  // the decode window + the bit layout names
  assert.ok(low.includes('0x3fff'), 'the 0x3fff mask window ships');
  assert.ok(low.includes('fourteen bits'), 'the fourteen-bit window is stated');
  for (const perm of ['beforeInitialize', 'afterInitialize', 'beforeAddLiquidity',
    'afterAddLiquidity', 'beforeRemoveLiquidity', 'afterRemoveLiquidity',
    'beforeSwap', 'afterSwap', 'beforeDonate', 'afterDonate',
    'beforeSwapReturnsDelta', 'afterSwapReturnsDelta']) {
    assert.ok(raw.includes(perm), 'bit-layout callback missing: ' + perm);
  }
  assert.ok(low.includes('unobserved'), 'bits 1 and 0 are recorded as unobserved, never assumed');
});

test('hook manual: address rot gate — every 40-hex literal is pinned or a register row', () => {
  const body = stripComments(raw);
  const hexes = new Set();
  const re = /0x[0-9a-fA-F]{40}/g;
  let m;
  while ((m = re.exec(body)) !== null) { hexes.add(m[0]); }
  const regHooks = new Set(reg.hooks.map((r) => r.hook.toLowerCase()));
  const allowed = new Set([PM.toLowerCase(), STATEVIEW.toLowerCase()]);
  for (const h of hexes) {
    const low = h.toLowerCase();
    assert.ok(allowed.has(low) || regHooks.has(low),
      'unpinned 40-hex literal on the page: ' + h);
  }
  assert.ok(body.includes(PM), 'the PoolManager pin appears');
  assert.ok(body.includes(STATEVIEW), 'the StateView pin appears');
  assert.ok(configSrc.includes(PM), 'the PoolManager literal matches site/js/config.js');
  assert.ok(configSrc.includes(STATEVIEW), 'the StateView literal matches site/js/config.js');
});

test('hook manual: worked examples resolve against real register rows', () => {
  const body = stripComments(raw);
  for (const addr of EXAMPLES) {
    const row = reg.hooks.find((r) => r.hook === addr);
    assert.ok(row, 'example hook missing from the register: ' + addr);
    assert.ok(body.includes(addr), 'example hook missing from the page: ' + addr);
    assert.ok(body.includes(row.mask), 'example mask missing from the page: ' + addr);
    const perms = (row.permissions || []).filter((p) => p !== 'bit1_unknown');
    assert.ok(perms.some((p) => body.includes(p)),
      'at least one real permission name must appear for ' + addr);
    if (row.books >= 10000) {
      assert.ok(body.includes(usd(row.books)), 'books figure missing from the page: ' + usd(row.books));
    }
  }
  // the flagship example's row content, verbatim facts
  const flagship = reg.hooks.find((r) => r.hook === EXAMPLES[0]);
  for (const cls of flagship.classes) {
    assert.ok(body.includes(cls), 'flagship class missing on the page: ' + cls);
  }
  assert.strictEqual(flagship.codePresence, 'codeless', 'flagship is measured codeless');
});

test('hook manual: receipt discipline — the honest-state phrases ship', () => {
  const text = pageText(raw).toLowerCase();
  assert.ok(text.includes('inert label'), 'the inert-label doctrine ships');
  assert.ok(text.includes('unprobed'), 'the unprobed state is named');
  assert.ok(text.includes('never an inference'), 'codelessness is stated as a measurement, never an inference');
  assert.ok(text.includes('never codeless'), 'failed probes are never recorded as codeless');
  for (const cls of ['PAYS-LPS', 'HOOK-MONETIZED', 'DEAD']) {
    assert.ok(text.includes(cls.toLowerCase()), 'class vocabulary missing: ' + cls);
  }
  assert.ok(text.includes('label-lie'), 'the label tier vocabulary ships');
  assert.ok(text.includes('null name'), 'the null-name policy ships');
});

test('hook manual: safety rules ship', () => {
  const text = pageText(raw).toLowerCase();
  assert.ok(text.includes('never approve'), 'the approval rule ships');
  assert.ok(text.includes('poolmanager'), 'the PoolManager approval target is named');
  assert.ok(text.includes('re-derive'), 'the re-derive rule ships');
  assert.ok(text.includes('dynamic fee') || text.includes('dynamic-fee'), 'the dynamic-fee rule ships');
  assert.ok(text.includes('revert'), 'the revert rule ships');
  assert.ok(text.includes('executor adapters'), 'the composition rule ships');
  assert.ok(text.includes('slot0'), 'the live-state read is named');
});

test('hook manual: voice contract', () => {
  const text = pageText(raw);
  assert.match(text, /the manual/i, 'the page names its parent: the manual');
  const low = text.toLowerCase();
  for (const phrase of ['one stop shop', 'guaranteed', 'risk-free', 'passive income',
    'auto yield', 'buyback', 's&p vault']) {
    assert.ok(!low.includes(phrase), 'kill-list phrase present: ' + phrase);
  }
  assert.ok(!/vibe/i.test(stripComments(raw)), 'no vibe strings');
  assert.ok(!/\bwth\b/i.test(text), 'no alias names — hooks are addressed by mask and address');
  assert.ok(!/hookr/i.test(text), 'no alias names — hooks are addressed by mask and address');
  assert.ok(!text.includes('6,268'), 'no unrelated registry figures');
  assert.ok(!raw.includes('%'), 'zero percent signs anywhere in the file — rates are stated, never signed');
  assert.ok(!raw.includes('$('), 'no shell substitution syntax on the page');
});

test('hook manual: scanner hygiene — comments carry no guarded patterns', () => {
  const comments = extractComments(raw);
  for (const c of comments) {
    assert.ok(!/href=|src=|\$\(|#\w/.test(c), 'guarded pattern inside a comment: ' + c.slice(0, 60));
  }
  assert.ok(!/\ssrc\s*=/i.test(stripComments(raw)), 'zero src= attributes — no loaded resources beyond the font');
});

test('hook manual: transport hygiene — relative hrefs only, the rpc host cross-pinned', () => {
  for (const h of extractHrefs(stripComments(raw))) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(h)) {
      assert.ok(h.startsWith('https://wellstreet.tech'),
        'absolute href outside the site: ' + h);
    }
  }
  assert.ok(!raw.includes('http://'), 'no insecure scheme anywhere in the file');
  assert.ok(raw.includes(RPC_HOST), 'the keyless rpc host ships as text for the cast line');
  assert.ok(skillSrc.includes(RPC_HOST), 'the rpc host matches the skill file literal');
});
