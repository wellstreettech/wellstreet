'use strict';
// WS-MOTION-POLISH behavioral battery (2026-09-05) — pins the two LIVE-behavior
// surfaces of the motion wave against a FRESH require of the real site bundle:
//   (1) the ledger-invisibility prerequisite fix: initReveal ARMED the
//       #hero-ledger-rows container (.scroll-reveal) but never OBSERVED it —
//       with no other reveal targets the rows computed opacity:0 /
//       translateY(8px) forever while carrying live data (a live bug since the
//       WOW-5 batch, live-probed 2026-09-05). The fix observes the container;
//       the shared callback then delivers .scroll-reveal-in on first view.
//   (2) the hero entrance arming: all 8 DIRECT children of .hero .wrap get
//       .ws-entrance + the pinned role→delay map as ONE inline custom property.
// Dependency-free node:test + node:assert + node:fs (house charter). Each boot
// installs its own DOM stub + IntersectionObserver capture + matchMedia, clears
// the module cache for a fresh require, and RESTORES every global it mutated so
// later boots are undisturbed. Class checks are exact classList.contains token
// checks — NEVER className substring (the shared callback adds BOTH
// 'ws-reveal-in' and 'scroll-reveal-in', and 'ws-reveal' is a prefix of
// 'ws-reveal-in': a substring check false-fails a correct build).
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const JS_DIR = path.join(__dirname, '..', 'site', 'js');
// browser <script> order — main.js last, so init() runs against the full WS namespace
const BROWSER_ORDER = ['config.js', 'abi.js', 'amount.js', 'rpc.js', 'geo.js', 'vault.js', 'wallet.js', 'docs.js', 'main.js'];

const PRESSED_DELAYS = [
  ['h1', '0ms'], ['p:not(.lede)', '80ms'], ['p.lede', '80ms'], ['.cta-row', '160ms'],
  ['aside.hero-ledger', '240ms'], ['aside.mint-card', '240ms'], ['.hero-facts', '320ms'], ['#chain-badge', '400ms']
];

function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '', className: '', children: [], parentNode: null, attrs: {}, listeners: {},
    _text: '', innerHTML: '', hidden: false, disabled: false, value: '',
    title: '', href: '', target: '', rel: '', styleProps: {},
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter((x) => x !== this); } },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    removeAttribute(k) { delete this.attrs[k]; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    classList: null,
    style: null
  };
  el.classList = {
    add(c) { const t = String(el.className || '').split(/\s+/).filter(Boolean); if (t.indexOf(c) === -1) { el.className = t.concat(c).join(' '); } },
    remove(c) { el.className = String(el.className || '').split(/\s+/).filter((x) => x !== c).join(' '); },
    contains(c) { return String(el.className || '').split(/\s+/).indexOf(c) !== -1; }
  };
  el.style = {
    setProperty(k, v) { el.styleProps[k] = String(v); },
    getPropertyValue(k) { return k in el.styleProps ? el.styleProps[k] : ''; }
  };
  return el;
}

// One boot = saved globals → fresh stub DOM + IO capture → cache-cleared fresh
// require of the bundle (init() runs inline: readyState 'complete') → handles.
function boot(opts) {
  const reduce = !!(opts && opts.reduce);
  const GLOBAL_KEYS = ['window', 'document', 'IntersectionObserver', 'matchMedia'];
  const saved = {};
  for (const k of GLOBAL_KEYS) { saved[k] = global[k]; }

  const ioRecords = [];
  function IOStub(cb, ioOpts) {
    const rec = { cb, opts: ioOpts, observed: [] };
    ioRecords.push(rec);
    return {
      observe(t) { rec.observed.push(t); },
      unobserve(t) { rec.observed = rec.observed.filter((x) => x !== t); },
      disconnect() { rec.observed.length = 0; }
    };
  }
  const matchMedia = function (q) {
    return {
      matches: reduce && String(q).indexOf('prefers-reduced-motion: reduce') !== -1,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}
    };
  };

  const body = makeEl('body');
  const ledgerRows = makeEl('div');
  ledgerRows.id = 'hero-ledger-rows';
  const registry = { 'hero-ledger-rows': ledgerRows };

  // the hero .wrap's EXACTLY 8 direct children (index.html :111-190)
  const h1 = makeEl('h1');
  const pitch = makeEl('p');                       // the class-less verification <p>
  const ctaRow = makeEl('div'); ctaRow.className = 'cta-row';
  const lede = makeEl('p'); lede.className = 'lede';
  const ledger = makeEl('aside'); ledger.className = 'hero-ledger'; ledger.id = 'hero-ledger';
  const mint = makeEl('aside'); mint.className = 'mint-card';
  const facts = makeEl('div'); facts.className = 'hero-facts';
  const badge = makeEl('div'); badge.id = 'chain-badge';
  const wrap = makeEl('div'); wrap.className = 'wrap';
  for (const c of [h1, pitch, ctaRow, lede, ledger, mint, facts, badge]) { wrap.appendChild(c); }

  global.window = global;
  global.document = {
    readyState: 'complete',
    title: '',
    body: body,
    getElementById(id) { return Object.prototype.hasOwnProperty.call(registry, id) ? registry[id] : null; },
    createElement(t) { return makeEl(t); },
    createDocumentFragment() { return makeEl('#document-fragment'); },
    addEventListener() { /* readyState complete: init runs inline */ },
    querySelector(sel) { return sel === '.hero .wrap' ? wrap : null; },
    querySelectorAll() { return []; }
  };
  global.IntersectionObserver = IOStub;
  global.matchMedia = matchMedia;   // window === global: main.js's window.matchMedia

  for (const name of BROWSER_ORDER) {
    const p = require.resolve(path.join(JS_DIR, name));
    if (require.cache[p]) { delete require.cache[p]; }
  }
  for (const name of BROWSER_ORDER) { require(path.join(JS_DIR, name)); }

  return {
    ioRecords, ledgerRows, wrap, h1, pitch, ctaRow, lede, ledger, mint, facts, badge,
    revealIO() { return ioRecords.find((r) => r.opts && r.opts.threshold === 0.15) || null; },
    restore() { for (const k of GLOBAL_KEYS) { global[k] = saved[k]; } }
  };
}

// WS5-SKELETON (2026-09-07): ALL THREE behavioral tests below are RETIRED with
// the surfaces they pinned — the hero ledger (#hero-ledger-rows, the armed +
// observed container of the ledger-invisibility fix) and the hero ENTRANCE
// arming (the ws-entrance class + the role→delay map; half its armed surfaces
// were the deleted hero ledger/mint-card/hero-facts) are deleted outright in
// the three-movement rebuild, along with main.js's motionAllowed() gate and
// sweepMagnifier (the entrance/sweep wiring's shared gate). The test SHells and
// the boot harness stay; the asserts are retired, not weakened — the surfaces
// no longer exist to observe.
test('prerequisite: the armed ledger container IS observed and reveals on intersection (exact tokens)', () => {
  // RETIRED 2026-09-07 (WS5-SKELETON): #hero-ledger-rows is gone from the page
  // and initReveal no longer arms or observes a ledger container — the fix this
  // test pinned died with its host surface (the reveal primitive itself
  // survives on the section heads + flagship card).
});

test('entrance: all 8 hero .wrap children armed with ws-entrance + the pinned role→delay map', () => {
  // RETIRED 2026-09-07 (WS5-SKELETON): the hero entrance arming is deleted from
  // main.js with the hero-ledger-era motion wiring; the CSS-side entrance pins
  // remain in agent-first.test.js (m1)(v) until the treatment goal's motion
  // purge re-pins them.
});

test('entrance: skipped entirely under prefers-reduced-motion (JS side of the double guard); the reveal fix is independent of it', () => {
  // RETIRED 2026-09-07 (WS5-SKELETON): no JS arming remains to gate — the
  // reduced-motion pairing for the surviving surfaces is CSS-carried (the
  // global + scoped reduce guards, pinned in agent-first.test.js (b5)/(m1)).
});
