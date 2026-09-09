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
const fs = require('node:fs');

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

// ---------------- BTN-MOTION riders (2026-09-08, docs/internal/BTN_MOTION_2026-09-08.md) ----------------
// CSS-register pins for the button shadow + fluid-motion amendment (user-authorized
// identity revision: the flat register is re-scoped to BUTTONS ONLY — theme.test.js
// (a-btn) owns the token decision record; these riders pin the MOTION contract):
//   - every in-scope button tweens transform (compositor-only) on the existing
//     --motion family and NEVER tweens its shadow (box-shadow swaps are instant
//     paint — one shared token pair, no blur tween);
//   - outline surfaces lift hover-only (translateY(-1px) + --shadow-btn-hover) and
//     stay flat at rest; filled primaries alone rest on --shadow-btn;
//   - every press settles under the finger: translateY(0) scale(0.985);
//   - every new transform pairs to none under prefers-reduced-motion (the EOF
//     button-register gate; selectors byte-identical to the rules they pair).
const btnCss = fs.readFileSync(path.join(__dirname, '..', 'site', 'css', 'style.css'), 'utf8');

function ruleSpanFor(cssText, head) {
  const at = cssText.indexOf(head);
  assert.ok(at !== -1, 'rule head resolvable: ' + head);
  return cssText.slice(at, cssText.indexOf('}', at));
}

const BTN_OUTLINE_BASES = ['button.btn {', '.fleet-filter {', '.ft-copy, .ft-details {', '.st-toggle-btn {', '.theme-toggle {', '.mwg-link, .mwg-copy {'];
const BTN_PRIMARY_BASES = ['button.btn-primary {', '.cta-solid {', '.site-nav a.nav-cta {'];
const BTN_HOVER_HEADS = [
  'button.btn:hover:not(:disabled)',
  'button.btn-primary:hover:not(:disabled)',
  '.cta-solid:hover:not(:disabled)',
  '.site-nav a.nav-cta:hover:not(:disabled)',
  '.fleet-filter:hover:not(:disabled)',
  '.ft-copy:hover:not(:disabled), .ft-details:hover:not(:disabled)',
  '.st-toggle-btn:hover:not(:disabled)',
  '.theme-toggle:hover:not(:disabled)',
  '.mwg-link:hover:not(:disabled), .mwg-copy:hover:not(:disabled)',
];
const BTN_ACTIVE_HEADS = [
  'button.btn:active:not(:disabled)',
  '.cta-solid:active:not(:disabled)',
  '.site-nav a.nav-cta:active:not(:disabled)',
  '.fleet-filter:active:not(:disabled)',
  '.ft-copy:active:not(:disabled), .ft-details:active:not(:disabled)',
  '.st-toggle-btn:active:not(:disabled)',
  '.theme-toggle:active:not(:disabled)',
  '.mwg-link:active:not(:disabled), .mwg-copy:active:not(:disabled)',
];
const BTN_EOF_GATE_SELECTORS = [
  'button.btn:hover:not(:disabled)', 'button.btn:active:not(:disabled)',
  'button.btn-primary:hover:not(:disabled)', 'button.btn-primary:active:not(:disabled)',
  '.cta-solid:hover:not(:disabled)', '.cta-solid:active:not(:disabled)',
  '.site-nav a.nav-cta:hover:not(:disabled)', '.site-nav a.nav-cta:active:not(:disabled)',
  '.fleet-filter:hover:not(:disabled)', '.fleet-filter:active:not(:disabled)',
  '.ft-copy:hover:not(:disabled)', '.ft-copy:active:not(:disabled)',
  '.ft-details:hover:not(:disabled)', '.ft-details:active:not(:disabled)',
  '.st-toggle-btn:hover:not(:disabled)', '.st-toggle-btn:active:not(:disabled)',
  '.theme-toggle:hover:not(:disabled)', '.theme-toggle:active:not(:disabled)',
  '.mwg-link:hover:not(:disabled)', '.mwg-link:active:not(:disabled)',
  '.mwg-copy:hover:not(:disabled)', '.mwg-copy:active:not(:disabled)',
];

test('btn-motion register: hover-only lift + shadow swap on every surface, resting shadow on the filled primaries alone, transform-only tweens', () => {
  // hover: every in-scope surface lifts 1px and swaps to the hover shadow token
  for (const head of BTN_HOVER_HEADS) {
    const span = ruleSpanFor(btnCss, head);
    assert.ok(span.includes('transform: translateY(-1px)'), head + ' lifts -1px on hover');
    assert.ok(span.includes('box-shadow: var(--shadow-btn-hover)'), head + ' swaps to --shadow-btn-hover on hover');
  }
  // press: every in-scope surface settles under the finger (0.985) and keeps the hover shadow
  for (const head of BTN_ACTIVE_HEADS) {
    const span = ruleSpanFor(btnCss, head);
    assert.ok(span.includes('transform: translateY(0) scale(0.985)'), head + ' presses at translateY(0) scale(0.985)');
    assert.ok(span.includes('box-shadow: var(--shadow-btn-hover)'), head + ' keeps the hover shadow while pressed');
  }
  // resting shadow: FILLED primaries only — the outline surfaces stay flat at rest
  for (const base of BTN_PRIMARY_BASES) {
    const span = ruleSpanFor(btnCss, base);
    assert.ok(span.includes('box-shadow: var(--shadow-btn);'), base + ' (filled primary) rests on --shadow-btn');
  }
  for (const base of BTN_OUTLINE_BASES) {
    const span = ruleSpanFor(btnCss, base);
    assert.ok(!span.includes('box-shadow'), base + ' (outline) carries NO resting shadow (lift without resting weight)');
  }
  // tween discipline: every base that DECLARES a transition carries the transform
  // component and NEVER tweens the shadow (box-shadow changes are instant paint).
  // button.btn-primary declares none BY DESIGN — the companion override rides
  // button.btn's extended list, so assert that inheritance explicitly.
  for (const base of BTN_OUTLINE_BASES.concat(BTN_PRIMARY_BASES)) {
    const span = ruleSpanFor(btnCss, base);
    const t = span.match(/transition:([^;]*);/);
    if (base === 'button.btn-primary {') {
      assert.strictEqual(t, null, 'button.btn-primary stays a companion override (rides button.btn\'s transition list)');
      continue;
    }
    assert.ok(t, base + ' carries a transition declaration');
    assert.ok(t[1].includes('transform'), base + ' transition list includes the transform component');
    assert.ok(!t[1].includes('box-shadow'), base + ' never tweens box-shadow (no blur tween — instant token swap)');
  }
});

test('btn-motion pairing: every new hover/press transform pairs to none under prefers-reduced-motion; reduce blocks carry no transform literals', () => {
  // the global page guard is intact (it kills every tween on the page)
  assert.ok(btnCss.includes('animation: none !important') && btnCss.includes('transition: none !important'),
    'the global prefers-reduced-motion page guard (animation/transition none) is intact');
  // collect EVERY reduce gate (balanced-brace spans) — none may carry a transform
  // literal, an individual-property literal, or a shadow declaration: reduced
  // motion means the transforms themselves are nullified, not merely untweened
  const gates = [];
  let gi = -1;
  while ((gi = btnCss.indexOf('@media (prefers-reduced-motion: reduce)', gi + 1)) !== -1) { gates.push(gi); }
  assert.ok(gates.length >= 6, 'the reduce belt is intact (>= 6 gates incl. the EOF button-register gate, got ' + gates.length + ')');
  for (const g of gates) {
    const open = btnCss.indexOf('{', g);
    let depth = 0, end = btnCss.length;
    for (let i = open; i < btnCss.length; i++) {
      if (btnCss[i] === '{') { depth++; }
      else if (btnCss[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    const blk = btnCss.slice(g, end);
    assert.ok(!blk.includes('translateY(') && !blk.includes('scale(') && !blk.includes('box-shadow'),
      'reduce gate at offset ' + g + ' stays free of transform/shadow literals');
  }
  // the EOF button-register gate pairs EVERY in-surface hover/active rule with
  // transform: none — selectors byte-identical to the rules they pair, so the
  // equal-specificity later-source restatement wins the cascade
  const btnGateStart = btnCss.indexOf('BTN-MOTION (2026-09-08) — scoped reduced-motion pairing');
  assert.ok(btnGateStart !== -1, 'the EOF button-register gate comment is present');
  const btnGate = btnCss.slice(btnGateStart, btnCss.indexOf('\n}', btnGateStart));
  for (const sel of BTN_EOF_GATE_SELECTORS) {
    assert.ok(btnGate.includes(sel), 'the EOF gate pairs: ' + sel);
  }
  assert.ok(btnGate.includes('transform: none;'), 'the EOF gate nullifies the transforms (transform: none)');
});

// ---------------- G2 #1 rider (2026-09-08, docs/internal/UI_LOOP_2_WAVE_2026-09-08.md — G2-MOTION-CONSISTENCY) ----------------
// The bug was ONE gesture at TWO speeds: the pill LIFT (hover) tweened transform
// at --t-base (200ms) while the chip register pressed at --motion (120ms). The
// three pill base lists (button.btn, .cta-solid, .site-nav a.nav-cta) now carry
// the transform component on var(--motion) — color/bg/outline components keep
// their existing durations. This rider pins UNIFORM transform speed across the
// 11-surface lift register (the same surfaces the BTN-MOTION riders scope):
//   button.btn · button.btn-primary (companion override — rides button.btn's
//   list) · .cta-solid · .site-nav a.nav-cta · .fleet-filter · .ft-copy ·
//   .ft-details · .st-toggle-btn · .theme-toggle · .mwg-link · .mwg-copy
// Out of register BY DESIGN: .doc-tab and .code-copy press DOWN
// (translateY(1px) — a different gesture), so their --t-base transform base is
// not this contract; .ws-reveal/--t-slow and .sim-bar-fill are entrances, not
// gestures.
const G2_REGISTER_BASES = [
  'button.btn {',
  'button.btn-primary {',
  '.cta-solid {',
  '.site-nav a.nav-cta {',
  '.fleet-filter {',
  '.ft-copy, .ft-details {',
  '.st-toggle-btn {',
  '.theme-toggle {',
  '.mwg-link, .mwg-copy {',
];
const G2_REGISTER_SURFACES = 11; // 9 base rules, 2 of them double-surface (ft-copy/ft-details, mwg-link/mwg-copy)

// resolves a transition declaration's transform component to its duration in ms
// via the token table (var(--motion) → var(--t-fast) → the --t-fast literal).
// Returns null when the rule declares no transition or no transform component.
function transformDurationMs(span) {
  const t = span.match(/transition:([^;]*);/);
  if (!t) { return null; }
  const comp = t[1].split(',').map(function (s) { return s.trim(); }).find(function (s) { return s.indexOf('transform ') === 0; });
  if (!comp) { return null; }
  const tok = comp.split(/\s+/)[1];
  if (tok === 'var(--motion)' || tok === 'var(--t-fast)') {
    const fast = btnCss.match(/--t-fast:\s*(\d+)ms/);
    return fast ? Number(fast[1]) : null;
  }
  if (tok === 'var(--t-base)') { const b = btnCss.match(/--t-base:\s*(\d+)ms/); return b ? Number(b[1]) : null; }
  if (tok === 'var(--t-slow)') { const s = btnCss.match(/--t-slow:\s*(\d+)ms/); return s ? Number(s[1]) : null; }
  const lit = tok.match(/^(\d+)ms$/);
  return lit ? Number(lit[1]) : null;
}

test('g2 motion consistency: the transform component tweens at var(--motion) on every lift-register base — one gesture, one speed across the 11 surfaces', () => {
  assert.strictEqual(G2_REGISTER_BASES.length, 9, 'the register enumerates 9 base rules');
  assert.strictEqual(btnCss.match(/--motion:\s*var\(--t-fast\)\s+var\(--ease-enter\);/) !== null, true,
    '--motion aliases --t-fast + the enter curve (the single transform speed)');
  const fast = btnCss.match(/--t-fast:\s*(\d+)ms/);
  assert.ok(fast, '--t-fast is defined');
  const speeds = [];
  for (const head of G2_REGISTER_BASES) {
    const span = ruleSpanFor(btnCss, head);
    const t = span.match(/transition:([^;]*);/);
    if (head === 'button.btn-primary {') {
      assert.strictEqual(t, null, 'button.btn-primary stays a companion override — its transform speed IS button.btn\'s (covered below via the button.btn base)');
      continue;
    }
    assert.ok(t, head + ' carries a transition declaration');
    assert.ok(/transform\s+var\(--motion\)(?![\w-])/.test(t[1]),
      head + ' tweens transform at var(--motion) — the chip speed, not --t-base');
    assert.ok(!/transform\s+var\(--t-base\)/.test(t[1]) && !/transform\s+var\(--t-slow\)/.test(t[1]),
      head + ' never tweens transform at a surface/slow speed');
    const ms = transformDurationMs(span);
    assert.strictEqual(ms, Number(fast[1]), head + ' transform duration resolves to --t-fast (' + fast[1] + 'ms)');
    speeds.push(ms);
  }
  // computed-duration equivalence: EVERY register transform duration (base +
  // press) resolves to ONE value — the "measured equal across 11 surfaces"
  // verify, at the token-resolution layer.
  assert.strictEqual(new Set(speeds).size, 1, 'one transform speed across the whole register');
  // the press side too: every :active rule settles transform at the same speed
  for (const head of BTN_ACTIVE_HEADS) {
    const ms = transformDurationMs(ruleSpanFor(btnCss, head));
    assert.strictEqual(ms, Number(fast[1]), head + ' press transform also resolves to ' + fast[1] + 'ms');
  }
});
