'use strict';
// RENDER + SERVERLESS-CLEAN GATE (D8) — integration test.
// Loads the REAL site modules in browser <script> order with a minimal DOM stub and
// a mock global.fetch serving deterministic JSON-RPC responses, then runs main.js's
// init() and asserts what actually rendered:
//   1. the page renders fully (hero facts, vault card rows, docs tab) with honest values,
//   2. APR derives end-to-end from the mocked LIVE pool data and is labeled
//      "projected, methodology-linked",
//   3. EVERY fetch URL is either one of the two configured public RPC endpoints or a
//      relative docs markdown path — i.e. the page makes ZERO calls to any /api/* route
//      of its own origin (the D8 serverless-clean verify gate, in executable form).
const test = require('node:test');
const assert = require('node:assert');

const config = require('../site/js/config.js');
const abi = require('../site/js/abi.js');
const amount = require('../site/js/amount.js');
const rpc = require('../site/js/rpc.js');
const geo = require('../site/js/geo.js');
const vault = require('../site/js/vault.js');
const apr = require('../site/js/apr.js');
const wallet = require('../site/js/wallet.js');
const docs = require('../site/js/docs.js');

// ---------------- minimal DOM stub ----------------
const REGISTRY = {};

function classTokens(el) { return String(el.className || '').split(/\s+/).filter(Boolean); }

function matchesSelector(el, sel) {
  if (sel.charAt(0) === '.') { return classTokens(el).indexOf(sel.slice(1)) !== -1; }
  const attr = sel.match(/^\[([^=\]]+)(?:="([^\"]*)")?\]$/);
  if (attr) {
    const v = el.attrs[attr[1]];
    return attr[2] === undefined ? v !== undefined : v === attr[2];
  }
}

function collect(root, sel, out) {
  for (const c of root.children) {
    if (matchesSelector(c, sel)) { out.push(c); }
    collect(c, sel, out);
  }
  return out;
}

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [], attrs: {}, listeners: {}, parentNode: null,
    className: '', _text: '', innerHTML: '', hidden: false, disabled: false,
    value: '', title: '', href: '', target: '', rel: '',
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    insertBefore(c, ref) {
      const idx = this.children.indexOf(ref);
      if (idx === -1) { this.children.push(c); } else { this.children.splice(idx, 0, c); }
      c.parentNode = this;
      return c;
    },
    remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter(function (x) { return x !== this; }.bind(this)); } },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { REGISTRY[v] = this; } },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    querySelector(sel) { return collect(this, sel, [])[0] || null; },
    querySelectorAll(sel) { return collect(this, sel, []); },
    classList: null
  };
  el.classList = {
    add(c) { const t = classTokens(el); if (t.indexOf(c) === -1) { el.className = t.concat(c).join(' '); } },
    remove(c) { el.className = classTokens(el).filter(function (x) { return x !== c; }).join(' '); },
    contains(c) { return classTokens(el).indexOf(c) !== -1; }
  };
  return el;
}

function allText(node, out) {
  out = out || [];
  if (node._text) { out.push(node._text); }
  for (const c of node.children) { allText(c, out); }
  return out;
}

global.window = global;
global.document = {
  readyState: 'complete',
  title: '',
  body: makeEl('body'),
  getElementById: function (id) { return REGISTRY[id] || null; },
  createElement: function (t) { return makeEl(t); },
  createDocumentFragment: function () { return makeEl('#document-fragment'); },
  addEventListener: function () { /* readyState complete: init runs inline */ }
};

// pre-register the static ids the page's HTML would provide (attached to body,
// exactly where they live in index.html) — 32 ids post-add (2026-09-02 rebaseline,
// was 31; the added entry is the wallet-picker static box, registered for the
// resource-gate.test.js REGISTRY RIDER — the queried-union delta vs this registry)
// + hero video entry (WSV-HERO-VIDEO-LOCK registry add) -> 33 ids; the array body
// stays comment-free: resource-gate.test.js JSON-parses the bracket span verbatim
// + stat-tvl / stat-price / stat-split entries (WSV-STATS-REAL-FOOTER registry add)
// -> 36 in-array ids; stat-apr is registered separately below (its cell carries a
// static 'projected' marker child, mirroring index.html's chip-apr + suffix
// structure — the registered node is the VALUE span, filled by main.js's
// setStatValue, whose textContent must mirror chip-apr exactly)
// + WS-WOW-BATCH (2026-09-03) registry add -> 50 in-array ids: stat-tape (the
// band's tape id), the two tape ticks, the money-flow figure + its four bound
// node ids, and the deposit-simulator block + its five control/region ids.
// + WS-ASSET-WIRE (2026-09-04) registry add -> 53 in-array ids: the agent-first
// section (agents + its skill link, queried by main.js's repoUrl upgrade seam)
// and the magnify-hand img (queried by the refresh-cycle sweep hook).
// + WS-SKILL-MIRROR (2026-09-04) registry add: agents-skill-mirror-link — the
// agent-first section's SITE mirror pointer (static page id, never JS-queried;
// its href stays relative forever — only the repo pointer is repoUrl-upgraded).
// + WS-PRODUCT-GAPS (2026-09-05) registry add -> 56 in-array ids: flow-deposit-state
// (the money-flow deposit node's sub-label, written by the setFlowVaultState seam),
// red-amount-label (the shared redeem input's unit-owning label) and redeem-preview
// (the live redeem/withdraw preview row) — all three are static page ids in
// index.html, queried by main.js's WS-PRODUCT-GAPS seams.
// + WS-A11Y-QUICK (2026-09-05) registry add -> 60 in-array ids (was 59): hero-ledger-summary
// (the visually-hidden aria-live=polite per-cycle summary span inside
// aside.hero-ledger — a real static node in index.html, written by main.js's
// refreshCards summary writer; the REGISTRY RIDER requires registration for
// every $-queried id).
['ws-jurisdiction-banner', 'ws-geo-block', 'chain-badge', 'vault-grid', 'vaults-updated',
 'widget-chain', 'btn-connect', 'dep-amount', 'red-amount', 'btn-approve', 'btn-deposit',
 'btn-withdraw', 'btn-redeem', 'widget-status', 'wallet-balances', 'acquire-note',
 'doc-tabs', 'doc-pane', 'footer-year', 'trademark-note', 'apr-footnote-text',
 'apr-footnote', 'vaults', 'deposit', 'docs',
 'hero-ledger', 'hero-ledger-state', 'hero-ledger-rows',
 'chip-price', 'chip-tvl', 'chip-apr',
 'wallet-picker',
 'stat-tvl', 'stat-price', 'stat-split',
 'stat-tape', 'stat-tick-tvl', 'stat-tick-price',
 'flow-diagram', 'flow-pool-tvl', 'flow-cut', 'flow-vault-state', 'flow-yield',
 'flow-deposit-state',
 'apr-sim', 'sim-slider', 'sim-size', 'sim-bar-fill', 'sim-share', 'sim-projection',
 'mint-backed', 'inv-stat', 'invariants',
 'agents', 'agents-skill-link', 'agents-skill-mirror-link', 'asset-magnify',
 'red-amount-label', 'redeem-preview', 'hero-ledger-summary'
].forEach(function (id) {
  if (!REGISTRY[id]) {
    const node = makeEl('div');
    node.setAttribute('id', id);
    global.document.body.appendChild(node);
  }
});

// stat-apr (WSV-STATS-REAL-FOOTER): registered as the VALUE span inside a cell
// that also carries the static 'projected' marker — index.html static markup this
// stub never loads, so the registration recreates the structure assertions need
// (same shape as the chip-apr value span + hero-chip-suffix pair at index.html).
if (!REGISTRY['stat-apr']) {
  const aprCell = makeEl('div');
  aprCell.className = 'stat-cell';
  const aprVal = makeEl('span');
  aprVal.className = 'stat-value';
  aprVal.setAttribute('id', 'stat-apr');
  aprCell.appendChild(aprVal);
  const aprMarker = makeEl('span');
  aprMarker.className = 'stat-marker';
  aprMarker.textContent = 'projected';
  aprCell.appendChild(aprMarker);
  global.document.body.appendChild(aprCell);
}

// ---------------- deterministic JSON-RPC mock (the "public RPC") ----------------
const SPY = config.tokens.spy.address.toLowerCase();
const WETH = config.tokens.weth.address.toLowerCase();
const POOL = config.pools.spyWeth500.address.toLowerCase();
const FEED = config.priceFeeds.spyUsd.proxies[0].toLowerCase();
const VAULT = config.vaults[0].vault.toLowerCase();

const LATEST = 50193408;
const BLOCK_TS_BASE = 1788000000;

// Pinned slot0 capture (docs/ops/phase0/pool-apr.md §1.2): 7 words, feeProtocol 0x44
const SLOT0 =
  '0x0000000000000000000000000000000000000001cc0529d7e357d439b6c69142' +
  '0000000000000000000000000000000000000000000000000000000000002dca' +
  '000000000000000000000000000000000000000000000000000000000000045c' +
  '0000000000000000000000000000000000000000000000000000000000000578' +
  '0000000000000000000000000000000000000000000000000000000000000578' +
  '0000000000000000000000000000000000000000000000000000000000000044' +
  '0000000000000000000000000000000000000000000000000000000000000001';

function hexWord(v) {
  const big = typeof v === 'bigint' ? v : BigInt(v);
  return big.toString(16).padStart(64, '0');
}

function strPayload(s) {
  const bytes = Buffer.from(s, 'utf8');
  return '0x' + hexWord(32) + hexWord(bytes.length) + bytes.toString('hex') +
    '0'.repeat((128 - (bytes.toString('hex').length % 128)) % 128);
}

function swapLogData(amount0, amount1, sqrt) {
  const enc = function (v) {
    const big = BigInt(v);
    return (big < 0n ? (1n << 256n) + big : big).toString(16).padStart(64, '0');
  };
  return '0x' + enc(amount0) + enc(amount1) + enc(sqrt) + '0'.repeat(32) + enc(0);
}

const SWAP_LOGS = [];
for (let i = 0; i < 25; i++) {
  SWAP_LOGS.push({ data: swapLogData(-1000000000000000000n, 3200000000000000000n,
    '0x01cc0529d7e357d439b6c69142') });
}

function ethCallResult(to, data) {
  const sel = ('0x' + data.replace(/^0x/i, '').slice(0, 8)).toLowerCase();
  const arg = data.replace(/^0x/i, '').slice(8);
  const toL = String(to).toLowerCase();

  if (toL === SPY) {
    if (sel === abi.selectorOf('symbol()')) { return strPayload('SPY'); }
    if (sel === abi.selectorOf('decimals()')) { return '0x' + hexWord(18); }
    if (sel === abi.selectorOf('paused()')) { return '0x' + hexWord(0); }
    if (sel === abi.selectorOf('totalSupply()')) { return '0x' + hexWord('7569927000000000000000'); }
  }
  if (toL === POOL) {
    if (sel === abi.selectorOf('slot0()')) { return SLOT0; }
    if (sel === abi.selectorOf('fee()')) { return '0x' + hexWord(500); }
    if (sel === abi.selectorOf('token0()')) { return '0x' + '0'.repeat(24) + WETH.replace(/^0x/i, ''); }
    if (sel === abi.selectorOf('token1()')) { return '0x' + '0'.repeat(24) + SPY.replace(/^0x/i, ''); }
  }
  if (sel === abi.selectorOf('balanceOf(address)')) {
    const holder = abi.decodeAddress('0x' + arg);
    if (abi.sameAddress(holder, POOL)) {
      if (toL === WETH) { return '0x' + hexWord('120000000000000000000'); }        // 120 WETH
      if (toL === SPY) { return '0x' + hexWord('496000000000000000000'); }         // 496 SPY
    }
    return '0x' + hexWord(0);
  }
  if (toL === FEED && sel === abi.selectorOf('latestRoundData()')) {
    const nowSec = Math.floor(Date.now() / 1000);
    return '0x' +
      hexWord('18446744073709551728') +
      hexWord(77026515000) +
      hexWord(nowSec - 7200) +
      hexWord(nowSec - 3600) +
      hexWord('18446744073709551728');
  }
  if (toL === VAULT && sel === abi.selectorOf('backingCoverage()')) {
    // re-pinned 2026-09-04: config flipped to deployed addresses — the coverage seam
    // now reads the REAL vault address; the mock serves 1e18 (an empty vault's exact
    // cover, the deployed-but-empty state).
    return '0x' + hexWord('1000000000000000000');
  }
  if (toL === VAULT && sel === abi.selectorOf('depositsPaused()')) {
    // WS-PRODUCT-GAPS P1: the real vault is unpaused — the pause gate reads
    // false, the widget renders no pause row (the paused world lives in
    // widget-pause.test.js).
    return '0x' + hexWord(0);
  }
  return '0x'; // empty result (honest "unavailable" path if hit)
}

function rpcReply(req) {
  if (req.method === 'eth_chainId') { return '0x1237'; }
  if (req.method === 'eth_blockNumber') { return '0x' + LATEST.toString(16); }
  if (req.method === 'eth_call') { return ethCallResult(req.params[0].to, req.params[0].data); }
  if (req.method === 'eth_getLogs') { return SWAP_LOGS; }
  if (req.method === 'eth_getBlockByNumber') {
    const n = Number(BigInt(req.params[0]));
    return { timestamp: '0x' + Math.round(BLOCK_TS_BASE + n * 0.1011).toString(16) };
  }
  return { error: { code: -32601, message: 'mock: method not mapped: ' + req.method } };
}

const FETCHED_URLS = [];
global.fetch = async function (url, opts) {
  FETCHED_URLS.push(String(url));
  const isRpc = config.rpc.endpoints.indexOf(String(url)) !== -1;
  if (isRpc && opts && opts.method === 'POST' && opts.body) {
    const req = JSON.parse(opts.body);
    if (Array.isArray(req)) {
      return {
        ok: true, status: 200,
        text: async function () {
          return JSON.stringify(req.map(function (r) {
            const out = rpcReply(r);
            return out && out.error ? { jsonrpc: '2.0', id: r.id, error: out.error }
              : { jsonrpc: '2.0', id: r.id, result: out };
          }));
        }
      };
    }
    const out = rpcReply(req);
    if (out && out.error) {
      return {
        ok: true, status: 200,
        text: async function () { return JSON.stringify({ jsonrpc: '2.0', id: req.id, error: out.error }); }
      };
    }
    return {
      ok: true, status: 200,
      text: async function () { return JSON.stringify({ jsonrpc: '2.0', id: req.id, result: out }); }
    };
  }
  // anything else (e.g. relative docs markdown): 404 -> honest "not published yet" path
  return { ok: false, status: 404, text: async function () { return 'nf'; } };
};

// ---------------- WS-VAULT-FAMILY-GRID: test-only second config entry ----------------
// The template contract under test: cfg.vaults[] is THE card source — adding an
// entry must render a second self-contained card with ZERO code change. This
// fixture invents NO vault data: it reuses the existing SPY asset/pool/feed
// config objects and carries the config's own PENDING_DEPLOY sentinel as its
// vault address (the honest undeployed state), so what gets exercised is the
// pending-card variant and the primary-surface gating (the shipped site bytes —
// site/js/config.js — are untouched; this mutation lives only in this test
// process's in-memory config module).
config.vaults.push({
  id: 'ws-family-fixture',
  displayName: 'Family Grid Fixture',
  shareSymbol: 'ws-FIXTURE',
  vault: config.PENDING_DEPLOY,
  asset: config.tokens.spy.address,
  pool: 'spyWeth500',
  chainlinkFeed: 'spyUsd'
});

// ---------------- load the real bootstrap (runs init() inline) ----------------
require('../site/js/main.js');

function settle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('page renders fully from mocked live RPC data (serverless-clean)', async () => {
  await settle(120);
  const text = allText(global.document.body).join(' | ');
  if (process.env.WS_DEBUG) { console.error('RENDERED TEXT:\n' + text); }

  // hero + card structure
  assert.ok(text.indexOf('Wellstreet SPY') !== -1, 'vault card title rendered');
  assert.ok(text.indexOf('ws-SPY') !== -1, 'share symbol rendered');
  assert.ok(text.indexOf('SPY') !== -1, 'underlying symbol rendered');

  // live values from the mock
  assert.ok(text.indexOf('chain 4663') !== -1, 'chain badge shows 4663');
  assert.ok(text.indexOf('$770.27') !== -1, 'Chainlink SPY price rendered, got: ' + text);
  assert.ok(text.indexOf('fee tier 0.05%') !== -1, 'pool fee tier (live) rendered');
  assert.ok(text.indexOf('TVL') !== -1, 'pool TVL rendered');
  assert.ok(text.indexOf('75%') !== -1, 'LP net multiplier (75%) from live slot0 rendered');
  // re-pinned 2026-09-04: config flipped to deployed addresses — the honest deployed
  // register renders (deployed flag + the real contract address), never a pending tag
  assert.ok(text.indexOf('deployed · ') !== -1, 'honest deployed vault state rendered');
  assert.ok(text.indexOf('not paused') !== -1, 'underlying pause state (live) rendered');

  // APR chain: live sample -> labeled projection
  assert.ok(text.indexOf('projected, methodology-linked') !== -1, 'APR label present');
  assert.ok(text.indexOf('live client-side sample') !== -1, 'live sample source labeled');
  // the fallback marker must NOT appear in the card's source label when live sampling works
  // (the methodology footnote legitimately MENTIONS the baseline — only the fallback's own
  //  source label reads "live sampling unavailable")
  assert.ok(text.indexOf('live sampling unavailable') === -1, 'baseline fallback NOT used when live sampling works');
  assert.ok(/\d+\.\d+%/.test(text), 'a percentage figure is rendered');
});

test('docs tab renders the honest not-yet-published state (relative fetch path)', async () => {
  await settle(60);
  // loadDoc writes via innerHTML (parsed into DOM in a real browser); the stub keeps
  // it as a string, so assert against the pane's innerHTML directly.
  const pane = REGISTRY['doc-pane'];
  assert.ok(pane.innerHTML.indexOf('Not published yet') !== -1, 'docs missing-state rendered');
  assert.ok(pane.innerHTML.indexOf(config.docs.index[0].file) !== -1, 'expected doc filename shown');
  const text = allText(global.document.body).join(' | ');
  assert.ok(text.indexOf(config.docs.index[0].title) !== -1, 'doc tab label rendered');
});

test('SERVERLESS-CLEAN GATE: every fetch is a configured public RPC endpoint or a relative docs path', async () => {
  await settle(60);
  assert.ok(FETCHED_URLS.length > 0, 'fetches happened');
  const offenders = FETCHED_URLS.filter(function (u) {
    const isRpc = config.rpc.endpoints.indexOf(u) !== -1;
    const isDocs = u.indexOf('../docs/public/') === 0;
    return !isRpc && !isDocs;
  });
  assert.deepStrictEqual(offenders, [], 'no origin /api/* or third-party URL fetched: ' + offenders.join(', '));
  // and explicitly: no app-origin /api path was ever contacted
  const apiCalls = FETCHED_URLS.filter(function (u) { return /\/api\//.test(u) && config.rpc.endpoints.indexOf(u) === -1; });
  assert.deepStrictEqual(apiCalls, []);
});

test('rpc failover fired only through the configured endpoints under mock transport errors', async () => {
  // determinism check of the client stats from the rendered session: retries/failovers
  // tracked on the client instance are internal, so verify via a fresh client that the
  // SAME mock transport exercises the failover path (secondary endpoint is used).
  const calls = [];
  const failPrimary = async function (url, opts) {
    calls.push(url);
    if (url === config.rpc.endpoints[0]) { throw new TypeError('Failed to fetch'); }
    const req = JSON.parse(opts.body);
    return {
      ok: true, status: 200,
      text: async function () { return JSON.stringify({ jsonrpc: '2.0', id: req.id, result: '0x1237' }); }
    };
  };
  const c = rpc.createRpcClient({
    endpoints: config.rpc.endpoints, attemptsPerEndpoint: 2,
    backoffBaseMs: 1, backoffCapMs: 2, fetchImpl: failPrimary,
    sleepFn: function () { return Promise.resolve(); }
  });
  const out = await c.call('eth_chainId', []);
  assert.strictEqual(out, '0x1237');
  assert.ok(calls.indexOf(config.rpc.endpoints[1]) !== -1, 'secondary endpoint used');
});


// -------- stats band riders (WSV-STATS-REAL-FOOTER: real figures, chip mirror, pure easing) --------

test('stats band renders real pipeline figures, mirroring the hero chips byte-for-byte', async () => {
  await settle(60);
  // stat-price: the Chainlink read the same pass already made (mock pins $770.27)
  assert.strictEqual(REGISTRY['stat-price'].textContent, '$770.27');
  // stat-tvl === chip-tvl (byte-for-byte mirror) and non-empty
  assert.ok(REGISTRY['chip-tvl'].textContent !== '', 'chip-tvl filled from live data');
  assert.strictEqual(REGISTRY['stat-tvl'].textContent, REGISTRY['chip-tvl'].textContent);
  assert.ok(REGISTRY['stat-tvl'].textContent !== '', 'stat-tvl non-empty');
  // stat-apr === chip-apr, carries '~' and '%'
  assert.strictEqual(REGISTRY['stat-apr'].textContent, REGISTRY['chip-apr'].textContent);
  assert.ok(REGISTRY['stat-apr'].textContent.indexOf('~') !== -1, 'apr carries ~');
  assert.ok(REGISTRY['stat-apr'].textContent.indexOf('%') !== -1, 'apr carries %');
  // the stat-apr cell keeps its static 'projected' marker child
  const marker = REGISTRY['stat-apr'].parentNode.querySelector('.stat-marker');
  assert.ok(marker, 'projected marker present in the stat-apr cell');
  assert.strictEqual(marker.textContent, 'projected');
  // stat-split: ratified constant rendered from config (depositor share + chain id)
  const split = REGISTRY['stat-split'].textContent;
  assert.ok(split.indexOf('90') !== -1 && split.indexOf(String(config.chain.id)) !== -1,
    'split cell shows depositor share + chain id, got: ' + split);
});

test('WS.stats.easeOutCubic: pure easing math (f(0)=0, f(1)=1, f(0.5)=0.875, monotone)', () => {
  const e = global.WS.stats.easeOutCubic;
  assert.strictEqual(e(0), 0);
  assert.strictEqual(e(1), 1);
  assert.ok(Math.abs(e(0.5) - 0.875) <= 1e-9, 'e(0.5) === 0.875 +/-1e-9, got ' + e(0.5));
  let prev = -Infinity;
  for (let i = 0; i <= 100; i++) {
    const v = e(i / 100);
    assert.ok(v >= prev, 'non-decreasing at sample ' + i);
    prev = v;
  }
});

// -------- WS-WOW-BATCH riders (2026-09-03: money-flow binding + sim projection verbatim) --------

test('WOW-2 money-flow: nodes bind the same published pipeline reads', async () => {
  await settle(120);
  // pool TVL node: the live figure the ledger already shows (WETH units)
  assert.ok(REGISTRY['flow-pool-tvl'].textContent.indexOf('WETH') !== -1,
    'flow pool TVL bound from the pool snapshot, got: ' + REGISTRY['flow-pool-tvl'].textContent);
  // cut node: the live-decoded slot0 cut
  assert.ok(REGISTRY['flow-cut'].textContent.indexOf('slot0') !== -1,
    'flow cut bound from the live slot0 decode, got: ' + REGISTRY['flow-cut'].textContent);
  // vault node: the site's own honest register (never a fake state).
  // (The node-class toggle is DOM-nesting-dependent and the registry stub holds
  // bare nodes — the honest-register TEXT is the assertable state here.)
  // re-pinned 2026-09-04: config flipped to deployed addresses — the node binds the
  // site's honest deployed register.
  assert.ok(REGISTRY['flow-vault-state'].textContent.indexOf('deployed — yield phase live') !== -1,
    'flow vault node renders the honest deployed register');
});

test('WOW-6 simulator: the projection region consumes the published string verbatim (never recomputed)', async () => {
  await settle(120);
  // byte-for-byte: sim-projection === chip-apr === stat-apr (the publish fan-out)
  assert.strictEqual(REGISTRY['sim-projection'].textContent, REGISTRY['chip-apr'].textContent,
    'sim projection is the published "~X% projected" string, verbatim');
  assert.ok(REGISTRY['sim-projection'].textContent.indexOf('~') === 0,
    'the projection carries the ~ register');
  // the default illustrative size renders
  assert.strictEqual(REGISTRY['sim-size'].textContent, '$5,000');
});

// -------- STRATTON-LEDGER-CARD (2026-09-04: mint ticket + invariants seam) --------

test('STRATTON-LEDGER-CARD: BACKED cell renders the live coverage read under the deployed config (one seam)', async () => {
  await settle(120);
  // re-pinned 2026-09-04: config flipped to deployed addresses — the seam now reads
  // the REAL vault address (the mock serves backingCoverage() = 1e18, an empty
  // vault's exact cover) and publishes the formatted percentage to BOTH cells.
  assert.strictEqual(REGISTRY['mint-backed'].textContent, '100.0%',
    'mint-backed shows the live coverage read, got: ' + REGISTRY['mint-backed'].textContent);
  // single seam: the invariants-section stat mirrors the mint-card cell byte-for-byte
  assert.strictEqual(REGISTRY['inv-stat'].textContent, REGISTRY['mint-backed'].textContent,
    'inv-stat === mint-backed (one published string, two cells)');
});

// -------- WS-ASSET-WIRE (2026-09-04: design-kit keepers + motion + agent-first) --------

test('WS-ASSET-WIRE: the vault card carries the certificate keeper (decorative, self-hosted)', async () => {
  await settle(120);
  // re-pinned 2026-09-04: config flipped to deployed addresses — the keeper rides the
  // live card too (the deployed vault is empty); the decorative attributes pin holds.
  const grid = REGISTRY['vault-grid'];
  assert.ok(grid, 'vault grid rendered');
  const cert = grid.querySelector('.asset-certificate');
  assert.ok(cert, 'the vault card carries the certificate img');
  assert.strictEqual(cert.getAttribute('src'), 'img/compressed/certificate.png',
    'certificate src is the relative self-hosted compressed path (WS-OG-PERF)');
  assert.strictEqual(cert.getAttribute('width'), '240',
    'certificate carries an explicit width (CLS discipline, JS-appended img)');
  assert.strictEqual(cert.getAttribute('height'), '129',
    'certificate carries an explicit height (CLS discipline, JS-appended img)');
  assert.strictEqual(cert.getAttribute('alt'), '', 'certificate is decorative (empty alt)');
  assert.strictEqual(cert.getAttribute('aria-hidden'), 'true', 'certificate is aria-hidden');
});

test('WS-ASSET-WIRE: agent-first section ships the honest skill pointer + the exact deadpan line (static source)', () => {
  const fs2 = require('node:fs');
  const path2 = require('node:path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.ok(html.indexOf('Operated by agents.') !== -1, 'two-tone headline line 2 present');
  assert.ok(html.indexOf('Same contracts. Same rules. Your agent reads the skill and runs the vault.') !== -1,
    'the exact honest agent-first line present');
  assert.ok(html.indexOf('skills/wellstreet-vaults/SKILL.md') !== -1, 'canonical skill path present');
  assert.ok(html.indexOf('id="agents"') !== -1, 'agents section present');
  assert.ok(html.indexOf('href="skills/wellstreet-vaults/SKILL.md"') !== -1,
    'the relative repo path is the shipped href');
  // WS-SKILL-MIRROR (2026-09-04): the SITE mirror pointer ships BESIDE the repo
  // pointer — relative href (IPFS-safe, docs-link precedent) to the byte-mirror
  // served at /skills/wellstreet-vaults.md; both pointers stay.
  assert.ok(html.indexOf('href="skills/wellstreet-vaults.md"') !== -1,
    'the local site mirror href ships beside the repo pointer');
  assert.ok(html.indexOf('id="agents-skill-mirror-link"') !== -1,
    'the mirror pointer is its own anchor (the repo pointer is untouched)');
  assert.ok(/https?:\/\/[^"']*skills\/wellstreet-vaults/.test(html) === false,
    'no fabricated absolute skill URL in static markup (repoUrl is PENDING_IDENTITY)');
  // the four statically-wired keepers (the certificate is JS-appended, pinned above)
  // WS-OG-PERF (2026-09-04): keepers serve the compressed variants and each img tag
  // carries explicit width/height (CLS discipline) + loading="lazy" — pinned per tag.
  ['img/compressed/hand-point.png', 'img/compressed/hand-press.png',
   'img/compressed/hand-magnify.png', 'img/compressed/curve-stroke.png']
    .forEach(function (src) {
      assert.ok(html.indexOf('src="' + src + '"') !== -1, 'keeper asset wired: ' + src);
      const tagRe = new RegExp('<img[^>]*src="' + src.replace(/\./g, '\\.') + '"[^>]*>');
      const tag = tagRe.exec(html);
      assert.ok(tag, 'keeper img tag found: ' + src);
      assert.ok(/\bwidth="\d+" /.test(tag[0]) && /\bheight="\d+"/.test(tag[0]),
        'keeper carries explicit width/height: ' + src);
      assert.ok(/loading="lazy"/.test(tag[0]), 'keeper is lazy-loaded: ' + src);
    });
  // the compressed variants exist on disk with the SAME intrinsic dimensions as the
  // uncompressed keepers (byte-different, same visual — spot-verified at display size)
  [['hand-point.png', 460, 259], ['hand-press.png', 220, 124],
   ['hand-magnify.png', 300, 166], ['curve-stroke.png', 1280, 720]]
    .forEach(function ([name, w, h]) {
      const p = path2.join(__dirname, '..', 'site', 'img', 'compressed', name);
      assert.ok(fs2.existsSync(p), 'compressed keeper exists on disk: img/compressed/' + name);
      const buf = fs2.readFileSync(p);
      // PNG IHDR: width @ offset 16, height @ offset 20 (big-endian)
      assert.strictEqual(buf.readUInt32BE(16), w, 'compressed ' + name + ' intrinsic width');
      assert.strictEqual(buf.readUInt32BE(20), h, 'compressed ' + name + ' intrinsic height');
    });
});

test('WS-ASSET-WIRE: the skill-link upgrade seam is state-agnostic (repoUrl-driven, never fabricated)', async () => {
  await settle(120);
  const link = REGISTRY['agents-skill-link'];
  assert.ok(link, 'skill link registered');
  const href = link.getAttribute('href');
  const repoUrl = config.branding && config.branding.repoUrl;
  if (typeof repoUrl === 'string' && repoUrl.indexOf('https://') === 0) {
    assert.ok(href && href.indexOf(repoUrl) === 0 && href.indexOf('/skills/wellstreet-vaults/SKILL.md') !== -1,
      'href upgraded to the published repository path, got: ' + href);
  } else {
    // The stub never loads index.html, so this node carries no static href —
    // the assertable contract under PENDING_IDENTITY is that the writer left
    // the link untouched (nothing fabricated). The static relative href itself
    // is pinned by the static-source test above.
    assert.ok(!href || href.indexOf('https://') !== 0,
      'no fabricated absolute href under a non-published repoUrl, got: ' + href);
  }
});

// -------- WS-PRODUCT-GAPS (2026-09-05: pause gate is read-driven; flow deposit node) --------

test('P1+P4: unpaused vault renders no pause row; the flow deposit node reads the deployed register', async () => {
  await settle(120);
  // P1 negative: the pause row is written ONLY from a VERIFIED paused=true read.
  // This mock serves depositsPaused() = false — the row must never appear and the
  // writer must not fabricate it from an unknown/false read.
  const status = allText(REGISTRY['widget-status']).join(' | ');
  assert.ok(status.indexOf('Deposits are paused on the vault.') === -1,
    'no pause row when depositsPaused() reads false, got: ' + status);
  // P4: the deposit node's sub-label rides the SAME isDeployed seam — the deployed
  // register is both the static first paint and the written state; the pending
  // sentence lives only in main.js's writer (never shipped statically).
  assert.strictEqual(REGISTRY['flow-deposit-state'].textContent,
    'open — approve the vault, then deposit',
    'flow deposit node carries the deployed register under the deployed config');
});

// -------- WS-VAULT-FAMILY-GRID (2026-09-04: the card is a repeatable template) --------

test('WS-VAULT-FAMILY-GRID: one card per cfg.vaults entry, each self-contained (template contract)', async () => {
  await settle(120);
  const grid = REGISTRY['vault-grid'];
  assert.ok(grid, 'vault grid rendered');
  const cardEls = grid.querySelectorAll('.vault-card');
  assert.strictEqual(cardEls.length, config.vaults.length,
    'exactly one card rendered per config entry (the test fixture entry included), got: ' + cardEls.length);
  for (let i = 0; i < config.vaults.length; i++) {
    const v = config.vaults[i];
    const cardEl = cardEls[i];
    assert.ok(cardEl, 'card ' + i + ' rendered');
    assert.strictEqual(cardEl.getAttribute('data-vault-id'), v.id,
      'card ' + i + ' carries its config entry id');
    const t = allText(cardEl).join(' | ');
    assert.ok(t.indexOf(v.displayName) !== -1, 'card ' + i + ' renders its display name');
    assert.ok(t.indexOf(v.shareSymbol) !== -1, 'card ' + i + ' renders its share symbol');
  }
  // the test-only fixture entry carries the config's own PENDING_DEPLOY sentinel:
  // the template must render the honest pending variant, never a deployed claim
  const fixture = cardEls.filter(function (c) { return c.getAttribute('data-vault-id') === 'ws-family-fixture'; })[0];
  assert.ok(fixture, 'the fixture entry rendered its card');
  assert.ok(fixture.classList.contains('vault-card--pending'),
    'a PENDING_DEPLOY entry renders the dashed pending variant');
  const ft = allText(fixture).join(' | ');
  assert.ok(ft.indexOf('pending deploy — deposits not open') !== -1,
    'the pending card carries the honest pending status row');
  assert.ok(ft.indexOf('deployed · ') === -1, 'the pending card never claims a deployed state');
});

test('WS-VAULT-FAMILY-GRID: hero-level surfaces stay primary-vault-scoped when a second card exists', async () => {
  // The fixture card is PENDING_DEPLOY: an UNGATED coverage writer would overwrite
  // the primary vault's live read with the wiring-truth string — this poll is the
  // primary-scoping gate's teeth (the STRATTON seam's published string survives).
  for (let i = 0; i < 100 && REGISTRY['mint-backed'].textContent !== '100.0%'; i++) { await settle(20); }
  assert.strictEqual(REGISTRY['mint-backed'].textContent, '100.0%',
    'the coverage seam keeps the PRIMARY vault\'s live read, got: ' + REGISTRY['mint-backed'].textContent);
  assert.strictEqual(REGISTRY['inv-stat'].textContent, '100.0%', 'single seam intact (invariants cell)');
  // the published projection fan-out is the primary card's, byte-for-byte
  assert.ok(REGISTRY['chip-apr'].textContent !== '', 'chip-apr filled from the primary derivation');
  assert.strictEqual(REGISTRY['stat-apr'].textContent, REGISTRY['chip-apr'].textContent, 'stat mirror intact');
  assert.strictEqual(REGISTRY['sim-projection'].textContent, REGISTRY['chip-apr'].textContent, 'sim consumes the fan-out');
  // the hero ledger stays the primary card's snapshot: still exactly the 4 pipeline rows
  assert.strictEqual(REGISTRY['hero-ledger-rows'].children.length, 4,
    'hero ledger renders the primary snapshot only');
});

test('WS-VAULT-FAMILY-GRID source gate: per-entry config resolution, single canonical primary accessor', () => {
  const fs2 = require('node:fs');
  const path2 = require('node:path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');
  // The first-vault entry is indexed in exactly TWO places, BOTH by contract:
  //   1. the canonical primary-vault accessor (vaultCfg) — the seam every
  //      primary-scoped surface (deposit widget, hero ledger/flow vault-state,
  //      coverage fill, APR fan-out gating, token decimals) reads through;
  //   2. the PROTECTED launch-fact writer — the goal pins the writer's form
  //      ("#vaults-launch-fact span + writer preserved") and the hardening
  //      batteries (wow.test.js + agent-first.test.js) pin it byte-exact.
  // The CARD path itself has ZERO direct occurrences: cards render from the
  // cfg.vaults[] loop with per-entry config resolution.
  assert.strictEqual((src.match(/cfg\.vaults\[0\]/g) || []).length, 2,
    'exactly the canonical accessor + the protected launch-fact writer index the first entry');
  // no card-path hardcode of vault #1's pool/feed/token anywhere in main.js
  assert.strictEqual((src.match(/cfg\.pools\.spyWeth500/g) || []).length, 0, 'no hardcoded SPY pool reference');
  assert.strictEqual((src.match(/cfg\.priceFeeds\.spyUsd/g) || []).length, 0, 'no hardcoded SPY feed reference');
  assert.strictEqual((src.match(/cfg\.tokens\.spy/g) || []).length, 0, 'no hardcoded SPY token reference');
  // the per-entry resolvers exist and the card path consumes them
  assert.ok(src.indexOf('function poolCfgFor(') !== -1, 'poolCfgFor exists');
  assert.ok(src.indexOf('function feedCfgFor(') !== -1, 'feedCfgFor exists');
  assert.ok(src.indexOf('function tokenCfgFor(') !== -1, 'tokenCfgFor exists');
  assert.ok(src.indexOf('poolCfgFor(vaultCfg)') !== -1, 'the card loader resolves the pool per entry');
  assert.ok(src.indexOf('feedCfgFor(vaultCfg)') !== -1, 'the card loader resolves the feed per entry');
  assert.ok(src.indexOf('underlyingRow(u, vaultCfg)') !== -1, 'the underlying row resolves per entry');
  // the template loop + per-card mounts remain the card source
  assert.ok(src.indexOf('cfg.vaults.forEach') !== -1, 'cards render from the vaults[] loop');
});
