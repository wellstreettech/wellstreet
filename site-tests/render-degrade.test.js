'use strict';
// RENDER-DEGRADE — the degraded world under TOTAL RPC failure. Same DOM stub as
// render.test.js but fetch ALWAYS fails. WS5-SKELETON re-pin (2026-09-07): the
// original subject (the WSV-STATS-REAL-FOOTER stats band and its chip mirrors)
// is DELETED outright in the three-movement rebuild — the surviving honesty
// teeth are the relocated coverage seam (#fleet-coverage), the labeled phase-0
// baseline fallback (flagship summary cell + sim projection, byte-for-byte
// mirrors) and the sim's no-invented-denominator rule.
// Labels are index.html static markup main.js never writes and this stub
// never loads — not assertable here. This file ships EXACTLY ONE test() node
// so the batch's +3 suite-delta accounting holds.
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

// pre-register the static ids (same list as render.test.js post-WS5-SKELETON —
// 2026-09-07: the three-movement rebuild deleted the hero ledger/chips, the stats
// band, the money-flow figure, the mint card + invariants and the #vaults
// section; their ids are OUT. ADDED: the fleet surfaces + the ONE live hero
// stat. The stat-apr special registration is retired with the band.)
['ws-jurisdiction-banner', 'ws-geo-block', 'chain-badge',
 'widget-chain', 'btn-connect', 'dep-amount', 'red-amount', 'btn-approve', 'btn-deposit',
 'btn-withdraw', 'btn-redeem', 'widget-status', 'wallet-balances', 'acquire-note',
 'doc-tabs', 'doc-pane', 'footer-year', 'trademark-note',
 'deposit', 'docs', 'fleet',
 'wallet-picker',
 'apr-sim', 'sim-slider', 'sim-size', 'sim-bar-fill', 'sim-share', 'sim-projection',
 'hero-stat', 'hero-stat-num', 'hero-stat-label', 'hero-stat-window',
 'fleet-books', 'fleet-flagship-apr', 'fleet-vault-reads', 'fleet-coverage'].forEach(function (id) {
  if (!REGISTRY[id]) {
    const node = makeEl('div');
    node.setAttribute('id', id);
    global.document.body.appendChild(node);
  }
});

// ---------------- every read fails ----------------
global.fetch = async function (url) {
  throw new TypeError('Failed to fetch (degrade stub: every read fails)');
};

// ---------------- load the real bootstrap (runs init() inline) ----------------
require('../site/js/main.js');

function settle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// RE-PINNED 2026-09-07 (WS5-SKELETON): the degrade world after the three-movement
// rebuild. RETIRED with their surfaces: the stat-tvl/stat-price '' pins and the
// stat-split ratified-constant pin (the #stat-tape band and the hero chips are
// deleted outright) and the stat-apr cell's 'projected' marker pin. SURVIVING
// teeth: the coverage seam (now the single relocated #fleet-coverage cell)
// degrades to the honest failure string, and the labeled phase-0 baseline
// fallback still renders through the flagship summary cell + the sim projection
// (byte-for-byte mirrors) — never empty, never a fabricated live figure.
test('degrade world: coverage + APR fallback fail honestly under total RPC failure (never 0-as-fake)', async () => {
  // With fetch always failing, the rpc client burns attemptsPerEndpoint 3 x 2
  // endpoints of backoff (250 -> 500 -> 1000ms) before the publish(projBase)
  // fallback and the coverage failure string land (~4-8s after init). A fixed
  // short settle would race — poll with a bounded deadline instead.
  for (let i = 0; i < 200 && REGISTRY['fleet-coverage'].textContent === ''; i++) {
    await settle(100);
  }
  // STRATTON-LEDGER-CARD: the coverage seam degrades to the honest failure string
  // (config pins the deployed addresses — the read IS attempted against the real
  // vault and reports the failure when the RPC is down; never a fabricated figure).
  for (let i = 0; i < 150 && REGISTRY['fleet-coverage'].textContent === ''; i++) { await settle(100); }
  const failedCoverage = 'unavailable (RPC)';
  assert.strictEqual(REGISTRY['fleet-coverage'].textContent, failedCoverage,
    'fleet-coverage degrades to the honest failure string, got: ' + REGISTRY['fleet-coverage'].textContent);
  // the APR fallback: the clearly-labeled phase-0 baseline projection renders
  // through BOTH surviving fan-out surfaces, byte-for-byte (never empty).
  const expectedBase = apr.projectDepositorApr(
    config.aprMethodology.phase0Baseline.netAprPct, config.aprPins, config.economics);
  assert.strictEqual(REGISTRY['fleet-flagship-apr'].textContent,
    '~' + expectedBase.depositorAprPct.toFixed(1) + '%',
    'flagship-apr carries the labeled baseline projection (never empty)');
  assert.strictEqual(REGISTRY['sim-projection'].textContent, REGISTRY['fleet-flagship-apr'].textContent,
    'the sim projection mirrors the flagship cell byte-for-byte');
  // the sim's dilution bar never invents a denominator when the live TVL is absent
  assert.strictEqual(REGISTRY['sim-share'].textContent,
    'pool TVL unavailable — the dilution bar will not invent a denominator',
    'the dilution input states the missing denominator honestly');
});

// SECTION-IMPROVE G1 #6 rider (2026-09-08): the degrade world re-pin — the
// unavailable register rides the JS-toggled class (WS.fleet is absent here, so
// renderHeroStat's null-summary path runs at boot) and the raw provenance
// window string never lands in #hero-stat-window.
test('degrade world: the hero stat unavailable register is the toggled class and the window stays empty', async () => {
  assert.strictEqual(REGISTRY['hero-stat-num'].textContent, '—',
    'the hero stat renders the honest em-dash under total RPC failure');
  assert.strictEqual(REGISTRY['hero-stat-label'].textContent, 'books measured — unavailable (feed)',
    'the unavailable label renders the honest feed-failure clause');
  assert.ok(REGISTRY['hero-stat'].classList.contains('hero-stat--unavailable'),
    'the unavailable register is stamped as a class on #hero-stat');
  assert.strictEqual(REGISTRY['hero-stat-window'].textContent, '',
    'the raw window string is never written into #hero-stat-window');
});
