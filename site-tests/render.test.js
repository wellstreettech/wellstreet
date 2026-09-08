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
// + WS3-DEGRADED (2026-09-06, UI_IMPROVE2_DEGRADED-STATES) registry add -> 63 in-array
// ids (was 60): stat-baseline-note + chip-baseline-note (the APR fallback-provenance
// markers on the band + chip, hidden/shipped by the publish fan-out's isBaseline flag)
// and deposit-panel-head (the deposit panel-head hook the verified-pause warn tag
// attaches to in appendWidgetTruthRows) — all three are static page ids in index.html
// queried by main.js's WS3-DEGRADED seams.
// + WS5-SKELETON (2026-09-07) registry rewrite: the three-movement rebuild deletes
// the hero ledger (hero-ledger/-state/-rows/-summary), the hero chips (chip-*), the
// stats band (stat-tape/ticks/tvl/price/split/apr + the baseline notes), the money-
// flow figure (flow-*), the mint card + invariants (mint-backed/inv-stat/
// invariants) and the #vaults section (vaults/vault-grid/vaults-updated/apr-footnote
// -text/apr-footnote) — all out of the registry. ADDED: the fleet surfaces (fleet,
// fleet-books, fleet-flagship-apr, fleet-vault-reads, fleet-coverage) and the ONE
// live hero stat (hero-stat + its num/label/window children). The sim ids stay (the
// simulator moved into the flagship fleet card with ids intact).
// + WS-DARK-DOTO (2026-09-07) registry rewrite: asset-magnify is OUT — the docs
// keeper img is deleted outright with the zero-image identity (no rule, no markup,
// no JS query), so the registry drops the id with its surface.
// + FLEET-UI-V2 G1 (2026-09-07) registry add -> the §1 fleet surface ids
// (fleet-surface + fleet-table + fleet-tbody + fleet-cards + fleet-sheet +
// fleet-unavailable; all six static in index.html, five queried by
// js/fleet-table.js); fleet-books is RETIRED outright with its v1 renderer
// and drops out of the registry with its surface (the WS5-SKELETON precedent).
// NOTE: the G3 stats ids are deliberately NOT here — js/stats.js routes every
// lookup through variable-mediated helpers (setCell/setSent/setBar + a
// SECTION_ID const), so the query-surface regexes extract nothing from it and
// no registry requirement arises; the registry rider belongs to G4 (brief §5).
['ws-jurisdiction-banner', 'ws-geo-block', 'chain-badge',
 'widget-chain', 'btn-connect', 'dep-amount', 'red-amount', 'btn-approve', 'btn-deposit',
 'btn-withdraw', 'btn-redeem', 'widget-status', 'wallet-balances', 'acquire-note',
 'doc-tabs', 'doc-pane', 'footer-year', 'trademark-note',
 'deposit', 'docs', 'fleet',
 'agents', 'agents-skill-link', 'agents-skill-mirror-link',
 'red-amount-label', 'redeem-preview', 'deposit-panel-head',
 'wallet-picker',
 'apr-sim', 'sim-slider', 'sim-size', 'sim-bar-fill', 'sim-share', 'sim-projection',
 'hero-stat', 'hero-stat-num', 'hero-stat-label', 'hero-stat-window',
 'fleet-flagship-apr', 'fleet-vault-reads', 'fleet-coverage',
 'fleet-surface', 'fleet-table', 'fleet-tbody', 'fleet-cards', 'fleet-sheet',
 'fleet-unavailable'
].forEach(function (id) {
  if (!REGISTRY[id]) {
    const node = makeEl('div');
    node.setAttribute('id', id);
    global.document.body.appendChild(node);
  }
});

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
// RETIRED 2026-09-07 (WS5-SKELETON): 'stats band renders real pipeline figures,
// mirroring the hero chips byte-for-byte' — the #stat-tape band and the hero
// chips are DELETED outright in the three-movement rebuild (the audit's
// redundancy finding); the band's value spans and the chip-* mirrors no longer
// exist in index.html or main.js. The published fan-out teeth live on in the
// rewritten WOW-6 test below (sim-projection === fleet-flagship-apr).

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
// RETIRED 2026-09-07 (WS5-SKELETON): 'WOW-2 money-flow: nodes bind the same
// published pipeline reads' — the #flow-diagram figure is DELETED outright in
// the three-movement rebuild; its node writers (setFlowPool/setFlowVaultState/
// setFlowYield/setFlowRate) are gone from main.js and the pure flowRateClass
// bucket stays pinned in wow.test.js.

test('WOW-6 simulator: the projection region consumes the published string verbatim (never recomputed)', async () => {
  await settle(120);
  // re-pinned 2026-09-07 (WS5-SKELETON): the fan-out's surviving surfaces after
  // the chip/stat-band/flow retirement are the flagship fleet card's summary
  // cell (#fleet-flagship-apr) and the sim's projection region — byte-for-byte
  // mirrors of ONE published string (never recomputed, never spectacularized).
  assert.strictEqual(REGISTRY['sim-projection'].textContent, REGISTRY['fleet-flagship-apr'].textContent,
    'sim projection is the published "~X% projected" string, verbatim (flagship summary mirror)');
  assert.ok(REGISTRY['sim-projection'].textContent.indexOf('~') === 0,
    'the projection carries the ~ register');
  // the default illustrative size renders
  assert.strictEqual(REGISTRY['sim-size'].textContent, '$5,000');
});

// -------- STRATTON-LEDGER-CARD (2026-09-04: mint ticket + invariants seam) --------
// RE-PINNED 2026-09-07 (WS5-SKELETON): the mint-ticket card and the invariants
// section are DELETED outright in the three-movement rebuild; the backingCoverage
// seam survives as ONE relocated line (#fleet-coverage) inside the flagship fleet
// card's detail. The old 'BACKED cell renders the live coverage read...' test
// (mint-backed === inv-stat, two cells) retired with those surfaces — the single
// cell carries the same fill contract below.

test('STRATTON-LEDGER-CARD: the coverage seam renders the live read under the deployed config (one relocated cell)', async () => {
  await settle(120);
  // the mock serves backingCoverage() = 1e18 (an empty vault's exact cover);
  // the single fill point publishes the formatted percentage to #fleet-coverage.
  assert.strictEqual(REGISTRY['fleet-coverage'].textContent, '100.0%',
    'fleet-coverage shows the live coverage read, got: ' + REGISTRY['fleet-coverage'].textContent);
});

// -------- WS5-SKELETON pass-2 (2026-09-07: fleet render wipe-safety) --------
// Pass-1 FATAL (caught in review, 2026-09-07): the static flagship fleet card —
// hosting the ENTIRE #deposit widget, the #fleet-coverage seam and
// #fleet-vault-reads — was nested INSIDE the fleet render mount, and the
// renderer wipes its mounts wholesale via mount.textContent='' on BOTH the
// success and the fail-closed path (WS.fleet.load fires its callback either
// way). The suite stayed green because this file's stub registry is FLAT (the
// real parent/child nesting is reproduced nowhere), so the wipe cleared an
// empty stub node while the real page lost the widget, the seam, the reads and
// the nav's #deposit anchor in every JS-enabled browser. The invariant below is
// pinned against the REAL index.html bytes — the flat stub cannot go blind to
// it again: the wipe target hosts NO static flagship content, ever.
// RE-PINNED 2026-09-07 (FLEET-UI-V2 G1): the render mount is the §1 surface
// skeleton now (the v1 mount is retired outright with its renderer); the
// mounts the v2 renderer wipes are #fleet-tbody + #fleet-cards, children of
// the surface — the same invariant, same real-bytes pin.

test('WS5-SKELETON wipe-safety: the flagship fleet card lives OUTSIDE the fleet render surface (real bytes, not the flat stub)', () => {
  const fs3 = require('node:fs');
  const path3 = require('node:path');
  const html3 = fs3.readFileSync(path3.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  const open = html3.indexOf('<div id="fleet-surface"');
  assert.ok(open !== -1, '#fleet-surface render target present');
  // balanced-div walk from the opening tag to its matching close (the surface
  // must stay free of static flagship content; the walk survives benign future
  // nesting)
  let depth = 0;
  let close = -1;
  const re = /<\/?div\b/g;
  re.lastIndex = open;
  let m;
  while ((m = re.exec(html3)) !== null) {
    depth += (m[0] === '</div') ? -1 : 1;
    if (depth === 0) { close = re.lastIndex; break; }
  }
  assert.ok(close !== -1, '#fleet-surface span closes');
  const span = html3.slice(open, close);
  const markers = [
    'id="deposit"', 'id="fleet-coverage"', 'id="fleet-vault-reads"',
    'id="fleet-flagship-apr"', 'fleet-card--flagship'
  ];
  for (const marker of markers) {
    assert.strictEqual(span.indexOf(marker), -1,
      'the wiped surface hosts no static ' + marker + ' (pass-1 FATAL regression pin)');
    assert.ok(html3.indexOf(marker) !== -1,
      marker + ' still present on the page (the pin must not be satisfiable by deletion)');
  }
  // document order: the static flagship precedes the render target it feeds
  const flagship = html3.indexOf('fleet-card--flagship');
  assert.ok(flagship !== -1 && flagship < open,
    'the flagship card precedes the fleet surface (static flagship first, client-rendered books after)');
});

// -------- WS-ASSET-WIRE (2026-09-04) — RETIRED WS-DARK-DOTO (2026-09-07) --------
// The zero-image identity retires the keeper set outright: no decorative imagery
// ships anywhere on the page (static markup, JS-appended, or stylesheet-painted
// bitmaps). These two test nodes survive as the NEGATIVE pins of that contract.

test('WS-DARK-DOTO zero-image: the vault card appends NO certificate keeper (retired surface)', async () => {
  await settle(120);
  const reads = REGISTRY['fleet-vault-reads'];
  assert.ok(reads, 'flagship reads mount rendered');
  assert.strictEqual(reads.querySelector('.asset-certificate'), null,
    'the vault card carries no certificate img (zero-image identity)');
});

test('WS-DARK-DOTO zero-image: agent-first ships the skill pointers and NOT ONE img tag (static source)', () => {
  const fs2 = require('node:fs');
  const path2 = require('node:path');
  const html = fs2.readFileSync(path2.join(__dirname, '..', 'site', 'index.html'), 'utf8');
  assert.ok(html.indexOf('OPERATED BY AGENTS.') !== -1, 'the banner headline line 2 present');
  assert.ok(html.indexOf('One skill file — any agent can operate this protocol.') !== -1,
    'the honest agent-first line present');
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
  // THE ZERO-IMAGE CONTRACT (WS-DARK-DOTO): not one img tag and not one img/
  // path reference ships in the static markup — the keepers, the canyon, the
  // motif and the brand mark are all retired; the favicon is an inline data-URI.
  assert.strictEqual(countImgTags(html), 0, 'index.html ships zero <img> tags');
  assert.strictEqual((html.match(/img\/[A-Za-z0-9._/-]+/g) || []).length, 0,
    'index.html carries zero img/ path references (comments included)');
  function countImgTags(src) { return (src.match(/<img\b/g) || []).length; }
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

test('P1: unpaused vault renders no pause row (the negative half of the widget-pause teeth)', async () => {
  await settle(120);
  // P1 negative: the pause row is written ONLY from a VERIFIED paused=true read.
  // This mock serves depositsPaused() = false — the row must never appear and the
  // writer must not fabricate it from an unknown/false read.
  // RE-PINNED 2026-09-07 (WS5-SKELETON): the P4 half (the flow deposit node's
  // deployed register) retired with the #flow-diagram figure — the node and its
  // writer are deleted outright in the three-movement rebuild.
  const status = allText(REGISTRY['widget-status']).join(' | ');
  assert.ok(status.indexOf('Deposits are paused on the vault.') === -1,
    'no pause row when depositsPaused() reads false, got: ' + status);
});

// -------- WS-VAULT-FAMILY-GRID (2026-09-04: the card is a repeatable template) --------
// RETIRED 2026-09-07 (WS5-SKELETON), two tests with the surfaces they pinned:
// 'WS-VAULT-FAMILY-GRID: one card per cfg.vaults entry, each self-contained
// (template contract)' and 'WS-MULTI-VAULT-FRONTEND: every gated family card
// renders the explicit DEPLOY-GATED state' — the #vaults family grid is DELETED
// outright in the three-movement rebuild ("no cards"): the flagship vault card
// renders into the fleet section and the DEPLOY-GATED family truth survives as
// the ONE intro line in the #fleet block. The gated roster stays in
// cfg.vaultFamily (pinned by vault-coverage.test.js; the header tape strip
// still renders it).

test('WS-VAULT-FAMILY-GRID: hero-level surfaces stay primary-vault-scoped when a second config entry exists', async () => {
  // The fixture entry (config.vaults[1]) is PENDING_DEPLOY: an UNGATED coverage
  // writer would overwrite the primary vault's live read with the wiring-truth
  // string — this poll is the primary-scoping gate's teeth (the STRATTON seam's
  // published string survives). RE-PINNED 2026-09-07 (WS5-SKELETON): the seam is
  // the single relocated #fleet-coverage cell and the fan-out mirrors are the
  // flagship summary cell + the sim projection (the chip/stat/ledger surfaces
  // are retired with their sections).
  for (let i = 0; i < 100 && REGISTRY['fleet-coverage'].textContent !== '100.0%'; i++) { await settle(20); }
  assert.strictEqual(REGISTRY['fleet-coverage'].textContent, '100.0%',
    'the coverage seam keeps the PRIMARY vault\'s live read, got: ' + REGISTRY['fleet-coverage'].textContent);
  // the published projection fan-out is the primary card's, byte-for-byte
  assert.ok(REGISTRY['fleet-flagship-apr'].textContent !== '', 'flagship-apr filled from the primary derivation');
  assert.strictEqual(REGISTRY['sim-projection'].textContent, REGISTRY['fleet-flagship-apr'].textContent, 'sim consumes the fan-out');
});

test('WS-VAULT-FAMILY-GRID source gate: per-entry config resolution, single canonical primary accessor', () => {
  const fs2 = require('node:fs');
  const path2 = require('node:path');
  const src = fs2.readFileSync(path2.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');
  // The first-vault entry is indexed in exactly TWO places, BOTH by contract:
  //   1. the canonical primary-vault accessor (vaultCfg) — the seam every
  //      primary-scoped surface (deposit widget, coverage fill, APR fan-out
  //      gating, token decimals, the flagship card mount) reads through;
  //   2. the PROTECTED launch-fact writer — the goal pins the writer's form
  //      ("#vaults-launch-fact span + writer preserved") and the hardening
  //      batteries (wow.test.js + agent-first.test.js) pin it byte-exact.
  // re-pinned 2026-09-07 (WS5-SKELETON): the per-entry CARD loop is retired with
  // the family grid — the flagship renders from vaultCfg() alone.
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
  // the flagship mounts through the canonical accessor (WS5-SKELETON re-pin)
  assert.ok(src.indexOf('renderCardShell(vaultCfg())') !== -1, 'the flagship card renders from the canonical accessor');
});

// -------- FLEET-UI-V2 G4 (2026-09-07: copy-position seam rider — ADDITIVE) --------
// §3 of docs/internal/FLEET_UI_V2_WAVE_2026-09-07.md: WS.copyPosition.build(book)
// is the ONE serializer for both the clipboard and the sheet mirror, byte-exact
// key order, the five §4 agent keys ALWAYS present (null when the feed lacks
// them — the consuming agent skill parses them by name), fail-closed null for
// anything that is not a book. The full renderer + delegation battery lives in
// site-tests/fleet-table.test.js; this rider pins the seam inside the loaded-page
// cohort. Update riders, never delete existing assertions (§0 rule 10).
const copyPosition = require('../site/js/copy-position.js');

test('FLEET-UI-V2 G4 rider: WS.copyPosition.build emits the §3 contract byte-exact (five agent keys always present, nulls allowed, fail-closed)', () => {
  assert.ok(global.WS.copyPosition && typeof global.WS.copyPosition.build === 'function',
    'the seam registers on the WS namespace beside the renderer');
  const book = {
    poolId: '0x' + 'ab'.repeat(32), pair: 'WELL/ETH', tier: 'PAYS',
    chargedFeeBps: 10990.0, feeAprPct: 128, tvlUsd: 12831, vol24hUsd: 4092,
    paysNothingToLps: false, ours: null,
    note: 'charged-fee wavg 10990.0 bps over 14 swaps (window a)'
  };
  const obj = global.WS.copyPosition.build(book);
  assert.deepStrictEqual(Object.keys(obj), [
    'v', 'protocol', 'chainId', 'action', 'poolKey', 'pair', 'feeTierBps',
    'tickLower', 'tickUpper', 'minOuts', 'expectedGainBps', 'measured', 'honesty'
  ], 'the §3 key order is byte-exact');
  for (const k of ['poolKey', 'tickLower', 'tickUpper', 'minOuts', 'expectedGainBps']) {
    assert.ok(k in obj, 'the §4 agent key ' + k + ' is present even when the feed lacks it');
  }
  assert.strictEqual(obj.v, 1);
  assert.strictEqual(obj.protocol, 'wellstreet');
  assert.strictEqual(obj.chainId, 4663);
  assert.strictEqual(obj.action, 'mirror-position');
  assert.strictEqual(obj.poolKey, book.poolId);
  assert.strictEqual(obj.feeTierBps, 10990.0);
  assert.strictEqual(obj.tickLower, null);
  assert.strictEqual(obj.tickUpper, null);
  assert.strictEqual(obj.minOuts, null);
  assert.strictEqual(obj.expectedGainBps, null);
  assert.deepStrictEqual(obj.measured, {
    tvlUsd: 12831, vol24hUsd: 4092, feeAprPct: 128, tier: 'PAYS', window: 'a'
  });
  assert.strictEqual(obj.honesty,
    'ticks/minOuts/expectedGain not in the fleet feed — null until measured; verify on-chain');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(obj)), obj, 'the object round-trips JSON verbatim');
  // a book with null figures keeps every null a null — never a fake zero
  const deadish = { poolId: '0x' + 'cd'.repeat(32), pair: 'X/Y', tier: 'DEAD', chargedFeeBps: null,
    feeAprPct: null, tvlUsd: null, vol24hUsd: null, note: 'no swaps in the measured window — no fee stream (window c)', ours: null };
  const empty = global.WS.copyPosition.build(deadish);
  assert.strictEqual(empty.feeTierBps, null);
  assert.strictEqual(empty.measured.feeAprPct, null);
  assert.strictEqual(empty.measured.tvlUsd, null);
  assert.strictEqual(empty.measured.window, 'c', 'the window letter parses from the note');
  // fail-closed: no book, no object — never a fabricated skeleton
  assert.strictEqual(global.WS.copyPosition.build(null), null);
  assert.strictEqual(global.WS.copyPosition.build(undefined), null);
  assert.strictEqual(global.WS.copyPosition.build({}), null);
});

test('FLEET-UI-V2 G4 rider: the copy seam is same-origin only (zero absolute origins in its source)', () => {
  const fs4 = require('node:fs');
  const path4 = require('node:path');
  const src4 = fs4.readFileSync(path4.join(__dirname, '..', 'site', 'js', 'copy-position.js'), 'utf8');
  assert.strictEqual(src4.indexOf('http://'), -1, 'copy-position.js must not reference an absolute origin');
  assert.strictEqual(src4.indexOf('https://'), -1, 'copy-position.js must not reference an absolute origin');
});
