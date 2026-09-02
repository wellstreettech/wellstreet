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
  // bare tag selector (e.g. source): a real DOM matches by tag name — the hero
  // video error rider needs el.querySelector('source') to find the stub child
  return el.tagName === String(sel).toUpperCase();
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
['ws-jurisdiction-banner', 'ws-geo-block', 'chain-badge', 'vault-grid', 'vaults-updated',
 'widget-chain', 'btn-connect', 'dep-amount', 'red-amount', 'btn-approve', 'btn-deposit',
 'btn-withdraw', 'btn-redeem', 'widget-status', 'wallet-balances', 'acquire-note',
 'doc-tabs', 'doc-pane', 'footer-year', 'trademark-note', 'apr-footnote-text',
 'apr-footnote', 'vaults', 'deposit', 'docs',
 'hero-ledger', 'hero-ledger-state', 'hero-ledger-rows',
 'chip-price', 'chip-tvl', 'chip-apr',
 'wallet-picker', 'hero-video',
 'stat-tvl', 'stat-price', 'stat-split'].forEach(function (id) {
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
  assert.ok(text.indexOf('pending deploy') !== -1, 'honest pending-deploy state rendered');
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

// -------- hero background video riders (WSV-HERO-VIDEO-LOCK: registry-stub driven, no network) --------

test('hero video: reduced motion hides it to the static composition (pause + no autoplay)', () => {
  const stub = global.document.getElementById('hero-video');
  const originalMatchMedia = global.window.matchMedia;
  let paused = false;
  stub.pause = function () { paused = true; };
  stub.autoplay = true;
  stub.classList.remove('is-dead');
  global.window.matchMedia = function (query) {
    return { matches: String(query).indexOf('prefers-reduced-motion') !== -1 };
  };
  try {
    global.WS.heroVideo.init(stub);
  } finally {
    if (originalMatchMedia === undefined) { delete global.window.matchMedia; }
    else { global.window.matchMedia = originalMatchMedia; }
  }
  assert.ok(paused, 'pause() called on the video element (CSS cannot pause video)');
  assert.strictEqual(stub.autoplay, false, 'autoplay disabled');
  assert.ok(stub.classList.contains('is-dead'), 'is-dead added — hide-to-static');
});

test('hero video: a failed source child marks it dead with no matchMedia stub needed', () => {
  const stub = global.document.getElementById('hero-video');
  stub.classList.remove('is-dead');
  const sourceStub = makeEl('source');
  stub.appendChild(sourceStub);
  global.WS.heroVideo.init(stub); // the error attach is unconditional
  const handlers = sourceStub.listeners.error;
  assert.ok(Array.isArray(handlers) && handlers.length > 0, 'error listener attached to the source child');
  handlers[0](); // source-element errors do not bubble to <video>
  assert.ok(stub.classList.contains('is-dead'), 'is-dead added on source error');
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
