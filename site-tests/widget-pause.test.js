'use strict';
// WIDGET-PAUSE (WS-PRODUCT-GAPS P1, 2026-09-05) — the deposit-pause gate under a
// PAUSED vault. Same DOM stub as render.test.js but the mock's depositsPaused()
// serves TRUE and a fake injected wallet connects, so the pause gate's TEETH are
// assertable under an identical wallet+deployed state:
//   - the honest pause row renders in #widget-status (verbatim, never a duration),
//   - the deposit side (approve/deposit) is DISABLED,
//   - the redeem side (redeem/withdraw) stays ENABLED — redemptions are never
//     pausable, so a paused vault still renders live exits,
//   - the pause read is state-driven (the unpaused world in render.test.js
//     asserts the negative: no row when the read is false).
// House pattern: render-degrade.test.js (one alternate-world boot per file,
// dependency-free node:test + node:assert).
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

// ---------------- minimal DOM stub (same as render.test.js) ----------------
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

// pre-register the static ids (same list as render.test.js incl. the
// WS-PRODUCT-GAPS adds)
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
 'red-amount-label', 'redeem-preview'
].forEach(function (id) {
  if (!REGISTRY[id]) {
    const node = makeEl('div');
    node.setAttribute('id', id);
    global.document.body.appendChild(node);
  }
});

// ---------------- deterministic JSON-RPC mock — the PAUSED vault ----------------
const SPY = config.tokens.spy.address.toLowerCase();
const WETH = config.tokens.weth.address.toLowerCase();
const POOL = config.pools.spyWeth500.address.toLowerCase();
const FEED = config.priceFeeds.spyUsd.proxies[0].toLowerCase();
const VAULT = config.vaults[0].vault.toLowerCase();
const USER = '0x1111111111111111111111111111111111111111';

const LATEST = 50193408;
const BLOCK_TS_BASE = 1788000000;

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
      if (toL === WETH) { return '0x' + hexWord('120000000000000000000'); }
      if (toL === SPY) { return '0x' + hexWord('496000000000000000000'); }
    }
    // the holder's own ws-SPY position (P2): 12.4031 shares on the vault
    if (abi.sameAddress(holder, USER) && toL === VAULT) {
      return '0x' + hexWord('12403100000000000000');
    }
    return '0x' + hexWord(0);
  }
  if (sel === abi.selectorOf('allowance(address,address)')) { return '0x' + hexWord(0); }
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
    return '0x' + hexWord('1000000000000000000');
  }
  if (toL === VAULT && sel === abi.selectorOf('depositsPaused()')) {
    return '0x' + hexWord(1);   // PAUSED — the world under test
  }
  if (toL === VAULT && sel === abi.selectorOf('convertToAssets(uint256)')) {
    // the live share price: 1.245 SPY per share (1e18-scaled)
    return '0x' + hexWord('1245000000000000000');
  }
  return '0x';
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

global.fetch = async function (url, opts) {
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
  return { ok: false, status: 404, text: async function () { return 'nf'; } };
};

// ---------------- fake injected wallet (connects on the legacy window.ethereum path) ----
global.ethereum = {
  request: async function (req) {
    if (req.method === 'eth_requestAccounts' || req.method === 'eth_accounts') { return [USER]; }
    if (req.method === 'eth_chainId') { return '0x1237'; }
    throw Object.assign(new Error('mock wallet: unexpected ' + req.method), { code: -32601 });
  },
  on: function () { /* no events */ }
};

// ---------------- load the real bootstrap (runs init() inline) ----------------
require('../site/js/main.js');

function settle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('P1 paused vault: honest row renders, deposit side disabled, redeem side stays open (same wallet+deployed state)', async () => {
  await settle(150);
  // connect the fake wallet through the REAL button wiring
  const click = REGISTRY['btn-connect'].listeners.click[0];
  assert.ok(typeof click === 'function', 'btn-connect click wiring exists');
  await click();

  // wait for the connected read pass (position line proves refreshBalances ran)
  let balances = '';
  for (let i = 0; i < 100 && balances.indexOf('ws-SPY:') === -1; i++) {
    await settle(50);
    balances = allText(REGISTRY['wallet-balances']).join(' | ');
  }

  const status = allText(REGISTRY['widget-status']).join(' | ');
  assert.ok(status.indexOf('Deposits are paused on the vault. Redemptions are never pausable — exits stay open.') !== -1,
    'the honest pause row renders verbatim, got: ' + status);

  // the teeth: IDENTICAL wallet+deployed state on both sides — the pause closes
  // ONLY the deposit side
  assert.strictEqual(REGISTRY['btn-approve'].disabled, true, 'approve disabled under a verified pause');
  assert.strictEqual(REGISTRY['btn-deposit'].disabled, true, 'deposit disabled under a verified pause');
  assert.strictEqual(REGISTRY['btn-redeem'].disabled, false, 'redeem stays open — redemptions are never pausable');
  assert.strictEqual(REGISTRY['btn-withdraw'].disabled, false, 'withdraw stays open — exits stay live');
  const t = String(REGISTRY['btn-deposit'].title || '');
  assert.ok(t.indexOf('Deposits are paused on the vault.') !== -1,
    'the disabled deposit button names the pause, got: ' + t);

  // P2 rides the same connected pass: the holder's position truth renders with
  // the share-price qualifier (12.4031 shares x 1.245 live price, truncated —
  // never rounded up)
  assert.ok(balances.indexOf('Your ws-SPY: 12.4031') !== -1,
    'the share balance renders, got: ' + balances);
  assert.ok(balances.indexOf('≈ 15.4418 SPY at the current share price.') !== -1,
    'the ≈ assets figure renders truncated at the current share price, got: ' + balances);
});
