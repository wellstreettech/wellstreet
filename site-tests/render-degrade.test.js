'use strict';
// RENDER-DEGRADE (WSV-STATS-REAL-FOOTER) — the stats band under TOTAL RPC
// failure. Same DOM stub as render.test.js (including the stat-apr cell with
// its static 'projected' marker child) but fetch ALWAYS fails. The band must
// degrade honestly: stat-tvl / stat-price stay '' (never '0', never a
// fabricated figure), stat-apr mirrors chip-apr and shows deriveApr's
// designed honest fallback — the clearly-labeled phase-0 baseline projection
// (config.js aprMethodology.phase0Baseline fed through the SAME formula),
// never empty — and stat-split stays static (filled at init from config).
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

// pre-register the static ids (same list + stat-apr special case as
// render.test.js — the stat-apr registered node is the VALUE span inside a
// cell carrying the static 'projected' marker child)
['ws-jurisdiction-banner', 'ws-geo-block', 'chain-badge', 'vault-grid', 'vaults-updated',
 'widget-chain', 'btn-connect', 'dep-amount', 'red-amount', 'btn-approve', 'btn-deposit',
 'btn-withdraw', 'btn-redeem', 'widget-status', 'wallet-balances', 'acquire-note',
 'doc-tabs', 'doc-pane', 'footer-year', 'trademark-note', 'apr-footnote-text',
 'apr-footnote', 'vaults', 'deposit', 'docs',
 'hero-ledger', 'hero-ledger-state', 'hero-ledger-rows',
 'chip-price', 'chip-tvl', 'chip-apr',
 'wallet-picker',
 'stat-tvl', 'stat-price', 'stat-split',
 'mint-backed', 'inv-stat', 'invariants'].forEach(function (id) {
  if (!REGISTRY[id]) {
    const node = makeEl('div');
    node.setAttribute('id', id);
    global.document.body.appendChild(node);
  }
});

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

// ---------------- every read fails ----------------
global.fetch = async function (url) {
  throw new TypeError('Failed to fetch (degrade stub: every read fails)');
};

// ---------------- load the real bootstrap (runs init() inline) ----------------
require('../site/js/main.js');

function settle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

test('stats band degrades honestly under total RPC failure (never 0-as-fake)', async () => {
  // With fetch always failing, the rpc client burns attemptsPerEndpoint 3 x 2
  // endpoints of backoff (250 -> 500 -> 1000ms) before renderChipsLive(null, null)
  // (via renderLedger) and publish(projBase) fire (~4-8s after init). A fixed
  // short settle would race — poll with a bounded deadline instead.
  for (let i = 0; i < 200 && !(REGISTRY['stat-apr'].textContent !== '' &&
        REGISTRY['stat-tvl'].textContent === ''); i++) {
    await settle(100);
  }
  // live figures absent — '' (never '0', never a fabricated number)
  assert.strictEqual(REGISTRY['stat-tvl'].textContent, '');
  assert.strictEqual(REGISTRY['stat-price'].textContent, '');
  // stat-apr mirrors chip-apr AND shows the phase-0 baseline projection
  assert.strictEqual(REGISTRY['stat-apr'].textContent, REGISTRY['chip-apr'].textContent);
  const expectedBase = apr.projectDepositorApr(
    config.aprMethodology.phase0Baseline.netAprPct, config.aprPins, config.economics);
  assert.strictEqual(REGISTRY['stat-apr'].textContent,
    '~' + expectedBase.depositorAprPct.toFixed(1) + '%');
  assert.ok(REGISTRY['stat-apr'].textContent !== '', 'baseline projection rendered (never empty)');
  // stat-split: static ratified constant, present regardless of RPC state
  const split = REGISTRY['stat-split'].textContent;
  assert.ok(split.indexOf('90') !== -1 && split.indexOf(String(config.chain.id)) !== -1,
    'split cell static from config, got: ' + split);
  // the stat-apr cell keeps its static 'projected' marker child
  const marker = REGISTRY['stat-apr'].parentNode.querySelector('.stat-marker');
  assert.ok(marker && marker.textContent === 'projected', 'projected marker present');
  // STRATTON-LEDGER-CARD: the coverage seam degrades to the honest failure string
  // (re-pinned 2026-09-04: config flipped to deployed addresses — the read IS
  // attempted against the real vault address and reports the failure when the RPC is
  // down; never a fabricated figure), identical in both cells (one seam).
  for (let i = 0; i < 150 && REGISTRY['mint-backed'].textContent === ''; i++) { await settle(100); }
  const failedCoverage = 'unavailable (RPC)';
  assert.strictEqual(REGISTRY['mint-backed'].textContent, failedCoverage,
    'mint-backed degrades to the honest failure string, got: ' + REGISTRY['mint-backed'].textContent);
  assert.strictEqual(REGISTRY['inv-stat'].textContent, failedCoverage,
    'inv-stat degrades to the honest failure string (single seam)');
});
