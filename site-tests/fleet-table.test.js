'use strict';
// FLEET-TABLE BATTERY (FLEET-UI-V2 G1 renderer + G4 copy seam, 2026-09-07) —
// integration test over the §1 DOM/class contract of
// docs/internal/FLEET_UI_V2_WAVE_2026-09-07.md (byte-frozen across G1/G2/G4).
// Loads the REAL site modules in browser <script> order (fleet.js →
// fleet-table.js → copy-position.js) into a minimal DOM stub with a mocked
// fetch serving the real feed file, then asserts what actually rendered:
//   - row/card counts are DRIVEN from the feed file (and the generator
//     fixture behind it) — never any hardcoded universe figure (the
//     fee-screen 402-book universe is a DIFFERENT dataset; this feed is 95
//     books and the count always comes from the file);
//   - per-tier class badges (row / spine / card / badge) match each book's
//     tier, with the §2 HOOK rule: any hook-scope book (tier HOOK or
//     paysNothingToLps) displays fee APR 0.0% even when the feed figure is
//     nonzero — the nonzero is the hook's take, not LP earnings;
//   - the window suffix renders whenever the book's note carries a window
//     letter, derived from the provenance clause (never hardcoded hours);
//   - card anatomy: exactly ONE .fc-state sentence, at most 3 metrics,
//     attribute-only action buttons (no payload in the DOM);
//   - §delta-3 privacy: no 42-hex owner address renders in the table or the
//     cards — the pool key appears ONLY in the detail sheet;
//   - the §3 copy contract: build(book) is pure and byte-exact (the five
//     agent keys always present, nulls allowed), the delegated button copies
//     JSON.parse-able JSON and toasts honestly (success only after the
//     clipboard write resolves; a blocked clipboard and an unresolvable pool
//     each say so — never a false success).
// Harness idioms follow fleet.test.js (real feed file + fetch mock) and
// render.test.js (minimal DOM stub, listeners recorded for dispatch).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FEED_PATH = path.join(ROOT, 'site', 'data', 'fleet.json');
const FIXTURE_PATH = path.join(ROOT, 'docs', 'ops', 'roam_policy_fixture.json');
const FLEET_TABLE_JS_PATH = path.join(ROOT, 'site', 'js', 'fleet-table.js');
const COPY_POSITION_JS_PATH = path.join(ROOT, 'site', 'js', 'copy-position.js');

const COPY_OK = 'position params copied — paste into your agent';
const COPY_FAIL = 'copy failed — your browser blocked the clipboard';
const COPY_MISS = 'that pool is not in the feed right now — nothing copied';
const HONESTY = 'ticks/minOuts/expectedGain not in the fleet feed — null until measured; verify on-chain';
const CONTRACT_KEYS = ['v', 'protocol', 'chainId', 'action', 'poolKey', 'pair', 'feeTierBps',
  'tickLower', 'tickUpper', 'minOuts', 'expectedGainBps', 'measured', 'honesty'];
const MEASURED_KEYS = ['tvlUsd', 'vol24hUsd', 'feeAprPct', 'tier', 'window'];
const AGENT_KEYS = ['poolKey', 'tickLower', 'tickUpper', 'minOuts', 'expectedGainBps'];

function readFeed() { return JSON.parse(fs.readFileSync(FEED_PATH, 'utf8')); }
function readFixture() { return JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8')); }

// ---------------- minimal DOM stub (render.test.js idioms) ----------------
const REGISTRY = {};

function classTokens(el) { return String(el.className || '').split(/\s+/).filter(Boolean); }

function matchesSelector(el, sel) {
  if (sel.charAt(0) === '.') { return classTokens(el).indexOf(sel.slice(1)) !== -1; }
  const attr = sel.match(/^\[([^=\]]+)(?:="([^\"]*)")?\]$/);
  if (attr) {
    const v = el.attrs[attr[1]];
    return attr[2] === undefined ? v !== undefined : v === attr[2];
  }
  return false;
}

function collect(root, sel, out) {
  out = out || [];
  if (!root || !root.children) { return out; }
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
    value: '', title: '', href: '', target: '', rel: '', _scrolls: [],
    get textContent() { return this._text; },
    set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
    remove() {
      if (this.parentNode) {
        const p = this.parentNode;
        p.children = p.children.filter(function (x) { return x !== this; }.bind(this));
      }
    },
    get nextSibling() {
      if (!this.parentNode) { return null; }
      const i = this.parentNode.children.indexOf(this);
      return this.parentNode.children[i + 1] || null;
    },
    insertBefore(node, ref) {
      const idx = ref ? this.children.indexOf(ref) : -1;
      if (idx === -1) { return this.appendChild(node); }
      this.children.splice(idx, 0, node);
      node.parentNode = this;
      return node;
    },
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { REGISTRY[v] = this; } },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
    querySelector(sel) { return collect(this, sel, [])[0] || null; },
    querySelectorAll(sel) { return collect(this, sel, []); },
    // G4 #6 rider: the stub records scroll intents instead of scrolling —
    // real browsers run the minimal 'nearest' scroll on the visible surface.
    scrollIntoView(opts) { el._scrolls.push(opts || null); },
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

function settle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function click(target, from) {
  const el = from || global.document.body;
  (el.listeners.click || []).forEach(function (fn) { fn({ target: target }); });
}

global.window = global;
global.document = {
  readyState: 'complete',
  title: '',
  body: makeEl('body'),
  getElementById: function (id) { return REGISTRY[id] || null; },
  createElement: function (t) { return makeEl(t); },
  createDocumentFragment: function () { return makeEl('#document-fragment'); },
  addEventListener: function () { /* delegation attaches to body; tests dispatch recorded listeners */ }
};

// ---------------- the §1 surface skeleton (index.html's fleet-surface) --------
// Rebuilt per phase: clearing REGISTRY + replacing document.body gives each
// phase a clean render mount and a clean delegation target.
function installSurface() {
  for (const k of Object.keys(REGISTRY)) { delete REGISTRY[k]; }
  const body = makeEl('body');
  const surface = makeEl('div');
  surface.setAttribute('id', 'fleet-surface');
  surface.setAttribute('aria-live', 'polite');
  body.appendChild(surface);
  const filters = makeEl('div');
  filters.className = 'fleet-filters';
  surface.appendChild(filters);
  for (const f of ['all', 'PAYS', 'HOOK', 'DEAD']) {
    const b = makeEl('button');
    b.className = 'fleet-filter' + (f === 'all' ? ' is-active' : '');
    b.setAttribute('data-filter', f);
    b.setAttribute('type', 'button');
    b.textContent = f;
    filters.appendChild(b);
  }
  const table = makeEl('table');
  table.className = 'fleet-table';
  table.setAttribute('id', 'fleet-table');
  surface.appendChild(table);
  const thead = makeEl('thead');
  table.appendChild(thead);
  const hrow = makeEl('tr');
  thead.appendChild(hrow);
  for (const label of ['book', 'tvl', 'vol 24h', 'fee apr', 'il', 'age', '']) {
    const th = makeEl('th');
    th.className = 'ft-th';
    th.textContent = label;
    hrow.appendChild(th);
  }
  const tbody = makeEl('tbody');
  tbody.setAttribute('id', 'fleet-tbody');
  table.appendChild(tbody);
  const cards = makeEl('div');
  cards.className = 'fleet-cards';
  cards.setAttribute('id', 'fleet-cards');
  surface.appendChild(cards);
  const sheet = makeEl('aside');
  sheet.className = 'fleet-sheet';
  sheet.setAttribute('id', 'fleet-sheet');
  sheet.hidden = true;
  surface.appendChild(sheet);
  const unavailable = makeEl('div');
  unavailable.className = 'fleet-unavailable';
  unavailable.setAttribute('id', 'fleet-unavailable');
  unavailable.hidden = true;
  surface.appendChild(unavailable);
  global.document.body = body;
  return { body: body, surface: surface, tbody: tbody, cards: cards, sheet: sheet, unavailable: unavailable };
}

// ---------------- browser-order module load + feed mock ----------------
const fleet = require('../site/js/fleet.js');
const fleetTable = require('../site/js/fleet-table.js');
const copyPosition = require('../site/js/copy-position.js');

function serveFeed(payload) {
  global.fetch = function () {
    return Promise.resolve({ ok: true, json: function () { return Promise.resolve(payload); } });
  };
}

// ---- phase 1: the real feed file renders into surface #1 ----
const feed = readFeed();
const fixture = readFixture();
const PHASE1 = installSurface();
serveFeed(feed);
fleetTable.init();      // self-registers its own WS.fleet.load (the §1 renderer)
copyPosition.init();    // re-wire the delegation onto the phase-1 body

function renderedRows() {
  return collect(REGISTRY['fleet-tbody'], '.ft-row').filter(function (r) {
    return r.getAttribute('data-pool') !== null;
  });
}
function renderedCards() { return collect(REGISTRY['fleet-cards'], '.fleet-card'); }
function rowsByPool() {
  const map = new Map();
  for (const r of renderedRows()) { map.set(r.getAttribute('data-pool'), r); }
  return map;
}
function cardsByPool() {
  const map = new Map();
  for (const c of renderedCards()) { map.set(c.getAttribute('data-pool'), c); }
  return map;
}
function aprCell(row) { return collect(row, '.ft-apr')[0] || null; }
function cardAprMetric(card) {
  const metrics = collect(card, '.fc-metric');
  for (const m of metrics) {
    const label = collect(m, '.fc-metric-label')[0];
    if (label && /^FEE APR/.test(label.textContent)) { return m; }
  }
  return null;
}
function isHookBook(b) { return !!(b && (b.tier === 'HOOK' || b.paysNothingToLps === true)); }
function noteLetter(b) {
  const m = /window ([a-d])\b/.exec(String((b && b.note) || ''));
  return m ? m[1] : null;
}
// the provenance clause parsed INDEPENDENTLY (the test's own read of the
// feed's window clause — the renderer may not be trusted to test itself)
function clauseHours(clause) {
  const hours = {};
  if (!clause) { return hours; }
  for (const letter of ['a', 'b', 'c', 'd']) {
    const seg = new RegExp(letter + '\\s*=\\s*([^,;]*)').exec(String(clause));
    if (!seg) { continue; }
    const h = /\/(\d+(?:\.\d+)?)h/.exec(seg[1]);
    if (h) { hours[letter] = parseFloat(h[1]); }
  }
  return hours;
}
function fixed1(x) { return (Math.round(x * 10) / 10).toFixed(1); }
const NAV_DESC = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
function stubNavigator(value) {
  Object.defineProperty(globalThis, 'navigator', { value: value, configurable: true });
}
function restoreNavigator() {
  if (NAV_DESC) { Object.defineProperty(globalThis, 'navigator', NAV_DESC); }
  else { delete globalThis.navigator; }
}
function toastsOn(body) {
  return (body.children || []).filter(function (c) {
    return c.getAttribute && c.getAttribute('data-copy-toast') !== null;
  });
}

test('the §1 surface renders the real feed: every book renders once, driven by the file (never a hardcoded count)', async () => {
  await settle(150);
  assert.strictEqual(REGISTRY['fleet-unavailable'].hidden, true, 'a valid feed hides the unavailable panel');
  const rows = renderedRows();
  const cards = renderedCards();
  assert.strictEqual(rows.length, feed.books.length,
    'rendered rows must equal the feed file\'s book count (' + feed.books.length + ')');
  assert.strictEqual(cards.length, feed.books.length, 'the card stack renders the same books');
  assert.strictEqual(rows.length, fixture.books.length, 'the feed is the 1:1 join of the generator fixture');
  assert.strictEqual(rows.length, fleet.rows().length, 'the renderer shows exactly what the data layer returns');
  assert.strictEqual(collect(REGISTRY['fleet-tbody'], '.ft-empty').length, 0,
    'a populated feed renders no empty state');
});

test('per-tier class badges match each book (row, spine, card, badge — §1 contract)', () => {
  const rows = rowsByPool();
  const cards = cardsByPool();
  const badgeByTier = { PAYS: 'badge--pays', HOOK: 'badge--hook', DEAD: 'badge--dead' };
  const wordByTier = { PAYS: 'PAYS-LPS', HOOK: 'HOOK-MONETIZED', DEAD: 'DEAD' };
  let hookSeen = 0;
  for (const b of feed.books) {
    const row = rows.get(b.poolId);
    const card = cards.get(b.poolId);
    assert.ok(row, 'row rendered for ' + b.poolId.slice(0, 10) + '…');
    assert.ok(card, 'card rendered for ' + b.poolId.slice(0, 10) + '…');
    const lower = String(b.tier).toLowerCase();
    assert.strictEqual(row.getAttribute('data-tier'), b.tier, 'data-tier attribute is the tier');
    assert.ok(classTokens(row).indexOf('ft-row--' + lower) !== -1, 'row carries the tier modifier');
    assert.ok(collect(row, '.ft-spine--' + lower).length === 1, 'the spine carries the tier modifier');
    assert.ok(classTokens(card).indexOf('fleet-card--' + lower) !== -1, 'card carries the tier modifier');
    const badge = collect(card, '.fc-badge')[0];
    assert.ok(classTokens(badge).indexOf(badgeByTier[b.tier]) !== -1, 'badge class matches the tier');
    assert.ok(badge.textContent.indexOf(wordByTier[b.tier]) === 0, 'badge text names the tier classification');
    if (b.tier === 'HOOK') { hookSeen += 1; }
  }
  assert.ok(hookSeen > 0, 'the feed carries hook books (the badge rule is exercised, not vacuous)');
  // the OURS badge is data-driven and the feed carries zero of them today —
  // no protocol class may pre-exist the capital (WS5-OURS census is 0)
  assert.strictEqual(feed.summary.ours, 0);
  for (const r of renderedRows()) {
    assert.strictEqual(classTokens(r).indexOf('is-protocol'), -1, 'no protocol row pre-exists the capital');
    assert.strictEqual(collect(r, '.ft-spine--protocol').length, 0, 'no protocol spine pre-exists the capital');
  }
});

test('the §2 HOOK rule: hook-scope books show fee APR 0.0%; measured PAYS books show their own figure; figures the feed lacks stay —', () => {
  const rows = rowsByPool();
  const cards = cardsByPool();
  let hookScope = 0;
  let measuredSeen = 0;
  let nullSeen = 0;
  for (const b of feed.books) {
    const cell = aprCell(rows.get(b.poolId));
    const metric = cardAprMetric(cards.get(b.poolId));
    assert.ok(cell, 'APR cell rendered for ' + b.pair);
    assert.ok(metric, 'card FEE APR metric rendered for ' + b.pair);
    const metricValue = collect(metric, '.fc-metric-value')[0].textContent;
    if (isHookBook(b)) {
      hookScope += 1;
      assert.strictEqual(cell.textContent, '0.0%',
        'hook-scope book ' + b.pair + ' displays the LP truth: 0.0% (feed figure ' + b.feeAprPct + ' is the hook take)');
      assert.strictEqual(metricValue, '0.0%', 'the card shows the same 0.0%');
    } else if (typeof b.feeAprPct === 'number' && isFinite(b.feeAprPct)) {
      measuredSeen += 1;
      assert.strictEqual(cell.textContent, fleet.fmtPct(b.feeAprPct),
        'measured book ' + b.pair + ' shows its own measured figure');
      assert.strictEqual(metricValue, cell.textContent, 'card and cell agree');
    } else {
      nullSeen += 1;
      assert.strictEqual(cell.textContent, '—', 'a figure the feed lacks renders the unavailable glyph');
      assert.strictEqual(metricValue, '—');
    }
  }
  assert.ok(hookScope > 0 && measuredSeen > 0 && nullSeen > 0,
    'all three display branches exercised by the real feed (hook ' + hookScope + ' / measured ' + measuredSeen + ' / null ' + nullSeen + ')');
});

test('the window suffix renders whenever the note carries a window letter, derived from the provenance clause', () => {
  const rows = rowsByPool();
  const cards = cardsByPool();
  const hours = clauseHours(feed.provenance.window);
  assert.ok(Object.keys(hours).length > 0, 'the provenance clause carries window hours to derive');
  let windowed = 0;
  for (const b of feed.books) {
    const cell = aprCell(rows.get(b.poolId));
    const metric = cardAprMetric(cards.get(b.poolId));
    const letter = noteLetter(b);
    const expected = letter && typeof hours[letter] === 'number'
      ? '·' + fixed1(hours[letter]) + 'h' : null;
    const spans = collect(cell, '.ft-window');
    const label = collect(metric, '.fc-metric-label')[0].textContent;
    if (expected) {
      windowed += 1;
      assert.strictEqual(spans.length, 1, 'windowed book ' + b.pair + ' carries exactly one suffix span');
      assert.strictEqual(spans[0].textContent, expected,
        'suffix derived from the clause (' + letter + '): ' + expected);
      assert.ok(/^FEE APR \(\d+\.\dh\)$/.test(label), 'card label carries the window: ' + label);
    } else {
      assert.strictEqual(spans.length, 0, 'a note without a usable letter renders no suffix');
      assert.strictEqual(label, 'FEE APR', 'card label stays unwindowed');
    }
  }
  assert.ok(windowed > 0, 'the real feed carries windowed books (the rule is exercised)');
});

test('card anatomy: exactly ONE .fc-state sentence, at most 3 metrics, attribute-only action buttons', () => {
  const cards = cardsByPool();
  for (const b of feed.books) {
    const card = cards.get(b.poolId);
    const states = card.children.filter(function (c) {
      return classTokens(c).indexOf('fc-state') !== -1;
    });
    assert.strictEqual(states.length, 1, 'exactly one state sentence per card (' + b.pair + ')');
    const expectedState = isHookBook(b) ? 'zero fees reach LPs here — we measured'
      : (b.tier === 'DEAD' ? 'no swaps in the window — dead' : String(b.note));
    assert.strictEqual(states[0].textContent, expectedState, 'the §2 state line for ' + b.pair);
    const metrics = collect(card, '.fc-metric');
    assert.ok(metrics.length <= 3, 'at most 3 metrics per card (' + b.pair + ' has ' + metrics.length + ')');
    assert.ok(metrics.length === 3, 'the metric grid renders its three measured figures');
    const actions = collect(card, '.fc-actions')[0];
    const copies = collect(actions, '[data-copy-position]');
    const details = collect(actions, '[data-details]');
    assert.strictEqual(copies.length, 1, 'one copy button');
    assert.strictEqual(details.length, 1, 'one details button');
    assert.strictEqual(copies[0].getAttribute('data-pool'), b.poolId, 'the copy button resolves by data-pool only');
    assert.strictEqual(details[0].getAttribute('data-details'), b.poolId, 'the details button resolves by data-details only');
    assert.strictEqual(copies[0].getAttribute('type'), 'button', 'buttons are type=button');
    assert.strictEqual(copies[0].attrs.payload, undefined, 'buttons carry NO payload attributes');
  }
});

test('§delta-3 privacy: no 42-hex owner address renders in the table or the cards; the pool key appears only in the sheet', async () => {
  const surfaceText = allText(REGISTRY['fleet-tbody']).concat(allText(REGISTRY['fleet-cards'])).join(' | ');
  assert.strictEqual(/0x[0-9a-fA-F]{40}/.test(surfaceText), false,
    'no owner-address-shaped (0x + 40 hex) text renders in the public surfaces — the 66-char pool ids must not leak into cells');
  // DETAIL-INLINE: a known pool opens UNDER the clicked row/card — the
  // footer aside stays closed; the pool key lives only in the detail nodes.
  fleetTable.openDetail(feed.books[0].poolId);
  const inlines = collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline')
    .concat(collect(REGISTRY['fleet-cards'], '.fleet-sheet-inline'));
  assert.strictEqual(inlines.length, 2, 'one detail node after the row, one after the card');
  assert.strictEqual(REGISTRY['fleet-sheet'].hidden, true, 'a known pool never opens the footer aside');
  const target = REGISTRY['fleet-tbody'].children.find(function (c) {
    return c.getAttribute('data-pool') === feed.books[0].poolId;
  });
  assert.ok(target, 'the book row is findable by data-pool');
  assert.strictEqual(target.nextSibling.className, 'ft-detail-row', 'the detail opens directly under the clicked row');
  const sheetText = allText(inlines[0]).join(' | ');
  assert.ok(sheetText.indexOf(feed.books[0].poolId) !== -1, 'the pool key renders in the inline detail (permitted surface)');
  // and the detail mirrors the §3 JSON (pretty form) in its pre block
  const pre = collect(inlines[0], '.fleet-sheet-json')[0];
  assert.ok(pre, 'the detail carries the position-params pre block');
  const mirrored = JSON.parse(pre.textContent);
  for (const k of AGENT_KEYS) { assert.ok(k in mirrored, 'the mirrored JSON carries ' + k); }
  assert.strictEqual(mirrored.poolKey, feed.books[0].poolId, 'the mirror is the emitted object');
  fleetTable.closeSheet();
  assert.strictEqual(collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline').length, 0, 'Close removes the row detail');
  assert.strictEqual(collect(REGISTRY['fleet-cards'], '.fleet-sheet-inline').length, 0, 'Close removes the card detail');
  assert.strictEqual(REGISTRY['fleet-sheet'].hidden, true, 'the aside stays closed');
  await settle(0);
});

test('the copy contract: build(book) is pure and byte-exact — five agent keys always present, nulls allowed', () => {
  const pays = feed.books.find(function (b) { return b.tier === 'PAYS' && b.chargedFeeBps !== null && b.feeAprPct !== null; });
  const dead = feed.books.find(function (b) { return b.tier === 'DEAD'; });
  assert.ok(pays && dead, 'the feed exercises both the measured and the null sides of the contract');
  for (const b of [pays, dead]) {
    const obj = copyPosition.build(b);
    assert.deepStrictEqual(Object.keys(obj), CONTRACT_KEYS, '§3 key order is byte-exact (' + b.tier + ')');
    assert.deepStrictEqual(Object.keys(obj.measured), MEASURED_KEYS, 'measured key order is byte-exact');
    for (const k of AGENT_KEYS) {
      assert.ok(k in obj, 'the §4 agent key ' + k + ' is present even when the feed lacks it');
    }
    assert.strictEqual(obj.v, 1);
    assert.strictEqual(obj.protocol, 'wellstreet');
    assert.strictEqual(obj.chainId, 4663);
    assert.strictEqual(obj.action, 'mirror-position');
    assert.strictEqual(obj.poolKey, b.poolId);
    assert.strictEqual(obj.pair, b.pair);
    assert.strictEqual(obj.feeTierBps, (typeof b.chargedFeeBps === 'number' && isFinite(b.chargedFeeBps)) ? b.chargedFeeBps : null);
    assert.strictEqual(obj.tickLower, null);
    assert.strictEqual(obj.tickUpper, null);
    assert.strictEqual(obj.minOuts, null);
    assert.strictEqual(obj.expectedGainBps, null);
    assert.strictEqual(obj.measured.tier, b.tier);
    assert.strictEqual(obj.measured.window, noteLetter(b), 'the window letter parses from the book\'s own note');
    assert.strictEqual(obj.measured.tvlUsd, (typeof b.tvlUsd === 'number' && isFinite(b.tvlUsd)) ? b.tvlUsd : null);
    assert.strictEqual(obj.measured.vol24hUsd, (typeof b.vol24hUsd === 'number' && isFinite(b.vol24hUsd)) ? b.vol24hUsd : null);
    assert.strictEqual(obj.measured.feeAprPct, (typeof b.feeAprPct === 'number' && isFinite(b.feeAprPct)) ? b.feeAprPct : null);
    assert.strictEqual(obj.honesty, HONESTY, 'the honesty line is verbatim');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(obj)), obj, 'the object round-trips JSON verbatim');
    assert.deepStrictEqual(copyPosition.serialize(b), JSON.stringify(obj, null, 2), 'the serialization is the pretty form');
  }
  // purity: no mutation, no state, fail-closed on non-books
  const frozen = JSON.parse(JSON.stringify(pays));
  (function deepFreeze(o) {
    Object.freeze(o);
    for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === 'object') { deepFreeze(o[k]); } }
  })(frozen);
  const once = copyPosition.build(frozen);
  const twice = copyPosition.build(frozen);
  assert.deepStrictEqual(twice, once, 'build is deterministic');
  assert.deepStrictEqual(copyPosition.build(pays), once, 'build does not depend on the input being frozen or not');
  assert.strictEqual(copyPosition.build(null), null, 'no book, no object');
  assert.strictEqual(copyPosition.build(undefined), null);
  assert.strictEqual(copyPosition.build({}), null);
  assert.strictEqual(copyPosition.build({ poolId: 42 }), null, 'a non-string poolId is not a book');
  assert.strictEqual(copyPosition.build({ poolId: '' }), null);
});

test('copy end-to-end: the delegated button writes the §3 JSON to the clipboard and toasts success only after the write resolves', async () => {
  const b = feed.books.find(function (x) { return x.tier === 'PAYS'; });
  const row = rowsByPool().get(b.poolId);
  const btn = collect(row, '[data-copy-position]')[0];
  const written = [];
  stubNavigator({ clipboard: { writeText: function (text) { written.push(text); return Promise.resolve('ok'); } } });
  try {
    click(btn, PHASE1.body);
    await settle(20);
    assert.strictEqual(written.length, 1, 'exactly one clipboard write');
    const parsed = JSON.parse(written[0]);
    for (const k of AGENT_KEYS) { assert.ok(k in parsed, 'the copied JSON carries ' + k); }
    assert.strictEqual(parsed.poolKey, b.poolId, 'the copied JSON mirrors the resolved book');
    assert.deepStrictEqual(parsed, copyPosition.build(b), 'the clipboard bytes are the emitted object, pretty form');
    assert.strictEqual(written[0], JSON.stringify(copyPosition.build(b), null, 2));
    const toasts = toastsOn(PHASE1.body);
    assert.strictEqual(toasts.length, 1, 'one toast');
    assert.strictEqual(toasts[0].textContent, COPY_OK, 'the success line is the §3 contract line');
  } finally {
    restoreNavigator();
  }
});

test('copy honesty: a rejected clipboard, an absent clipboard and an unresolvable pool each say so — never a false success', async () => {
  const b = feed.books.find(function (x) { return x.tier === 'PAYS'; });
  const row = rowsByPool().get(b.poolId);
  const btn = collect(row, '[data-copy-position]')[0];

  // (1) the write rejects
  stubNavigator({ clipboard: { writeText: function () { return Promise.reject(new Error('denied')); } } });
  try {
    click(btn, PHASE1.body);
    await settle(20);
    let toasts = toastsOn(PHASE1.body);
    assert.strictEqual(toasts.length, 1);
    assert.strictEqual(toasts[0].textContent, COPY_FAIL, 'a rejected write is named, never claimed as success');
    assert.ok(allText(PHASE1.body).join(' ').indexOf(COPY_OK) === -1, 'no success line anywhere');
  } finally {
    restoreNavigator();
  }

  // (2) no clipboard API at all
  stubNavigator({});
  try {
    click(btn, PHASE1.body);
    await settle(20);
    const toasts = toastsOn(PHASE1.body);
    assert.strictEqual(toasts.length, 1);
    assert.strictEqual(toasts[0].textContent, COPY_FAIL, 'an absent clipboard API is the same honest failure');
  } finally {
    restoreNavigator();
  }

  // (3) the pool is not in the feed: nothing is written, the miss line is its own truth
  const written = [];
  const ghost = makeEl('button');
  ghost.setAttribute('type', 'button');
  ghost.setAttribute('data-copy-position', '');
  ghost.setAttribute('data-pool', '0x' + 'ff'.repeat(32));
  PHASE1.body.appendChild(ghost);
  stubNavigator({ clipboard: { writeText: function (t) { written.push(t); return Promise.resolve('ok'); } } });
  try {
    click(ghost, PHASE1.body);
    await settle(20);
    assert.strictEqual(written.length, 0, 'an unresolvable pool writes nothing');
    const toasts = toastsOn(PHASE1.body);
    assert.strictEqual(toasts.length, 1);
    assert.strictEqual(toasts[0].textContent, COPY_MISS, 'the miss line is its own honest text');
    assert.notStrictEqual(toasts[0].textContent, COPY_FAIL, 'the clipboard is not blamed for a data miss');
  } finally {
    ghost.remove();
    restoreNavigator();
  }
});

test('Details wiring: [data-details] opens the renderer\'s sheet (the §3 mirror); without the renderer the seam renders its own minimal sheet', async () => {
  const b = feed.books.find(function (x) { return x.tier === 'HOOK'; });
  const row = rowsByPool().get(b.poolId);
  const btn = collect(row, '[data-details]')[0];

  // (a) with the renderer loaded: G4's delegated handler calls WS.fleetTable.openDetail
  click(btn, PHASE1.body);
  const inl = collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline');
  assert.strictEqual(inl.length, 1, 'the renderer opens the detail inline under the clicked row');
  assert.strictEqual(REGISTRY['fleet-sheet'].hidden, true, 'the footer aside stays closed (DETAIL-INLINE)');
  let pre = collect(inl[0], '.fleet-sheet-json')[0];
  assert.ok(pre, 'the inline detail carries the mirror pre block');
  let mirrored = JSON.parse(pre.textContent);
  for (const k of AGENT_KEYS) { assert.ok(k in mirrored, 'the mirrored JSON carries ' + k); }
  assert.strictEqual(mirrored.poolKey, b.poolId);
  fleetTable.closeSheet();
  assert.strictEqual(collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline').length, 0, 'Close removes the inline detail');

  // (b) without the renderer: the seam's own minimal sheet (still the §3 JSON,
  //     still the only surface where the pool key renders)
  const saved = global.WS.fleetTable;
  delete global.WS.fleetTable;
  const ghost = makeEl('button');
  ghost.setAttribute('type', 'button');
  ghost.setAttribute('data-details', b.poolId);
  PHASE1.body.appendChild(ghost); // OUTSIDE the surface — only the body delegation fires
  try {
    click(ghost, PHASE1.body);
    assert.strictEqual(REGISTRY['fleet-sheet'].hidden, false, 'the fallback sheet opens');
    pre = collect(REGISTRY['fleet-sheet'], '.fleet-sheet-json')[0];
    assert.ok(pre, 'the fallback sheet carries the position-params pre block');
    mirrored = JSON.parse(pre.textContent);
    for (const k of AGENT_KEYS) { assert.ok(k in mirrored, 'the fallback JSON carries ' + k); }
    assert.strictEqual(mirrored.poolKey, b.poolId);

    // (c) fallback + unresolvable pool: the honest line, never a fabricated object
    ghost.setAttribute('data-details', '0x' + 'ee'.repeat(32));
    click(ghost, PHASE1.body);
    pre = collect(REGISTRY['fleet-sheet'], '.fleet-sheet-json')[0];
    assert.ok(pre.textContent.indexOf('not in the feed') !== -1, 'the fallback says the pool is not in the feed');
    let threw = false;
    try { JSON.parse(pre.textContent); } catch (e) { threw = true; }
    assert.ok(threw, 'no fabricated JSON for an unresolvable pool');
  } finally {
    ghost.remove();
    global.WS.fleetTable = saved;
  }
  await settle(0);
});

test('filters re-render through rows(tier): the HOOK chip shows exactly the feed\'s hook books (counts stay data-driven)', async () => {
  const chips = collect(PHASE1.surface, '.fleet-filter');
  const hookChip = chips.find(function (c) { return c.getAttribute('data-filter') === 'HOOK'; });
  const allChip = chips.find(function (c) { return c.getAttribute('data-filter') === 'all'; });
  assert.ok(hookChip && allChip, 'the §1 filter chips are wired');
  hookChip.listeners.click[0]();
  await settle(10);
  const hookRows = renderedRows();
  const expected = feed.books.filter(function (b) { return b.tier === 'HOOK'; }).length;
  assert.strictEqual(hookRows.length, expected, 'the HOOK view shows exactly the feed\'s hook books (' + expected + ')');
  for (const r of hookRows) { assert.strictEqual(r.getAttribute('data-tier'), 'HOOK'); }
  allChip.listeners.click[0]();
  await settle(10);
  assert.strictEqual(renderedRows().length, feed.books.length, 'the all view restores the full file-driven count');
});

// ---- phase 2: a mutated feed pins the rule SCOPES the real feed cannot ----
// (the real feed's hook books all carry feeAprPct 0 and every note carries a
// letter — the override and the no-suffix branches need a synthetic feed;
// tier counts stay untouched so the feed still validates)
test('the §2 rule scope (synthetic feed): a paysNothingToLps PAYS book and a nonzero-APR HOOK book both display 0.0%; a note without a letter renders no suffix', async () => {
  const mutated = JSON.parse(JSON.stringify(feed));
  const pays0 = mutated.books.find(function (b) { return b.tier === 'PAYS' && b.feeAprPct !== null; });
  pays0.paysNothingToLps = true;                 // the hook truth measured on a PAYS-tier book
  pays0.note = String(pays0.note).replace(/\s*\(window [a-d]\)/, ''); // and no window letter in the note
  const hook0 = mutated.books.find(function (b) { return b.tier === 'HOOK'; });
  hook0.feeAprPct = 447;                          // the hook take, nonzero in the feed
  installSurface();
  serveFeed(mutated);
  fleetTable.init();
  copyPosition.init();
  await settle(150);
  const rows = rowsByPool();
  const cards = cardsByPool();

  // the paysNothingToLps book: 0.0% APR + the hook badge + no window suffix
  const cell0 = aprCell(rows.get(pays0.poolId));
  assert.strictEqual(cell0.textContent, '0.0%', 'the LP truth is 0.0% whenever paysNothingToLps measures true');
  assert.strictEqual(collect(cell0, '.ft-window').length, 0, 'a note without a letter renders no suffix');
  const card0 = cards.get(pays0.poolId);
  assert.ok(classTokens(collect(card0, '.fc-badge')[0]).indexOf('badge--hook') !== -1,
    'the HOOK-MONETIZED badge follows the measured truth, not just the tier');
  assert.strictEqual(collect(card0, '.fc-metric-label')[2].textContent, 'FEE APR',
    'the unwindowed card label stays plain');
  const obj0 = copyPosition.build(pays0);
  assert.strictEqual(obj0.measured.window, null, 'the mirror records no window the note does not carry');
  assert.strictEqual(obj0.measured.feeAprPct, pays0.feeAprPct, 'the mirror keeps the feed measurement verbatim');

  // the nonzero-APR hook book: still 0.0% — the take is not LP earnings
  const cellH = aprCell(rows.get(hook0.poolId));
  assert.strictEqual(cell0.textContent, '0.0%');
  assert.strictEqual(cellH.textContent, '0.0%',
    'a HOOK book with a nonzero feed figure still displays 0.0% (the §2 override)');
  assert.strictEqual(collect(cardAprMetric(cards.get(hook0.poolId)), '.fc-metric-value')[0].textContent, '0.0%');
});

test('the seam is same-origin only, UMD-exported, and carries the §3 literals verbatim', () => {
  const src = fs.readFileSync(COPY_POSITION_JS_PATH, 'utf8');
  assert.strictEqual(src.indexOf('http://'), -1, 'copy-position.js must not reference an absolute origin');
  assert.strictEqual(src.indexOf('https://'), -1, 'copy-position.js must not reference an absolute origin');
  assert.ok(src.indexOf("'position params copied — paste into your agent'") !== -1, 'the success line is verbatim');
  assert.ok(src.indexOf("'copy failed — your browser blocked the clipboard'") !== -1, 'the failure line is verbatim');
  assert.ok(src.indexOf(HONESTY) !== -1, 'the honesty line is verbatim');
  assert.ok(src.indexOf("data-copy-position") !== -1, 'the delegation resolves the §1 attribute');
  assert.ok(src.indexOf('CHAIN_ID = 4663') !== -1, 'the contract chain id is pinned');
  assert.ok(src.indexOf("root.WS.copyPosition") !== -1, 'the UMD registration is the WS namespace');
  assert.strictEqual(typeof copyPosition.build, 'function', 'build is exported for tests');
  assert.strictEqual(typeof copyPosition.init, 'function', 'init is exported (idempotent wiring)');
  // and the renderer the seam integrates with is same-origin too (G1's file, read-only here)
  const src2 = fs.readFileSync(FLEET_TABLE_JS_PATH, 'utf8');
  assert.strictEqual(src2.indexOf('http://'), -1, 'fleet-table.js must not reference an absolute origin');
  assert.strictEqual(src2.indexOf('https://'), -1, 'fleet-table.js must not reference an absolute origin');
});

// ════════════════════════════════════════════════════════════════════════
// G4 SECTION-IMPROVE RIDERS (2026-09-08, docs/internal/SECTION_IMPROVE_
// 2026-09-08.md) — the surface defects the audit wave pins at unit level.
// The real-DOM probes (toast scrollWidth at 390, sticky thead, the 3-metric
// baseline screenshot) are MAIN-SESSION (post-wave re-crawl); these riders
// pin the contracts the units can see: the style string, the file-driven
// counts, the status word, the scroll intent, the source rules.
// ════════════════════════════════════════════════════════════════════════

test('G4 #1: the copy toast clamps to the viewport and wraps — the 427px-on-390 overflow stays dead', async () => {
  // source pins: the clamp and the wrap live IN the inline style string
  const src = fs.readFileSync(COPY_POSITION_JS_PATH, 'utf8');
  assert.ok(src.indexOf('max-width:calc(100vw - 32px)') !== -1, 'the toast clamps to the viewport minus 16px gutters');
  assert.ok(src.indexOf("white-space:normal;');") !== -1, 'the toast style ends in the wrap, not nowrap');
  // live: a real toast node carries both properties (the scrollWidth<=innerWidth
  // probe at 390 is MAIN-SESSION — here the unit contract is the style string)
  installSurface();
  serveFeed(feed);
  fleetTable.init();
  copyPosition.init();
  await settle(150);
  const b = feed.books.find(function (x) { return x.tier === 'PAYS'; });
  const btn = collect(rowsByPool().get(b.poolId), '[data-copy-position]')[0];
  stubNavigator({ clipboard: { writeText: function () { return Promise.resolve('ok'); } } });
  try {
    click(btn, global.document.body);
    await settle(20);
    const toasts = toastsOn(global.document.body);
    assert.strictEqual(toasts.length, 1, 'one toast');
    const style = toasts[0].getAttribute('style');
    assert.ok(style.indexOf('max-width:calc(100vw - 32px)') !== -1, 'the live toast carries the clamp');
    assert.ok(style.indexOf('white-space:normal') !== -1, 'the live toast carries the wrap');
    assert.strictEqual(style.indexOf('white-space:nowrap'), -1, 'the live toast carries no nowrap');
  } finally {
    restoreNavigator();
  }
});

test('G4 #4: the filter chips carry their counts from WS.fleet.summary() — fail-closed: no summary, no counts', async () => {
  // (a) a valid feed fills every chip from the file's own summary
  installSurface();
  serveFeed(feed);
  fleetTable.init();
  await settle(150);
  const chips = collect(REGISTRY['fleet-surface'], '.fleet-filter');
  assert.strictEqual(chips.length, 4, 'the §1 chips are present');
  const expected = {
    all: feed.summary.books,
    PAYS: feed.summary.paysLps,
    HOOK: feed.summary.hookMonetized,
    DEAD: feed.summary.dead
  };
  for (const chip of chips) {
    const key = chip.getAttribute('data-filter');
    const spans = collect(chip, '.fleet-filter-count');
    assert.strictEqual(spans.length, 1, 'chip ' + key + ' carries exactly one count span');
    assert.strictEqual(spans[0].textContent, String(expected[key]),
      'the ' + key + ' count is the file-driven summary figure');
  }
  // the counts are the books recount — never a hardcoded universe figure
  const recount = { all: feed.books.length, PAYS: 0, HOOK: 0, DEAD: 0 };
  for (const b of feed.books) { recount[b.tier] += 1; }
  assert.deepStrictEqual(expected, recount, 'the chip counts equal the books recount');

  // (b) an invalid payload → the unavailable state and NO counts anywhere
  installSurface();
  serveFeed({ books: 'garbage' });
  fleetTable.init();
  await settle(150);
  assert.strictEqual(REGISTRY['fleet-unavailable'].hidden, false, 'the unavailable state shows');
  assert.strictEqual(collect(REGISTRY['fleet-surface'], '.fleet-filter-count').length, 0,
    'no summary, no counts — a stale span would lie');
});

test('G4 #5: the detail\'s ours line renders the feed status WORD, never a boolean — both paths', async () => {
  const mutated = JSON.parse(JSON.stringify(feed));
  mutated.books[0].ours = { pair: mutated.books[0].pair, status: 'SEEDED' };
  mutated.summary.ours = 1; // keep the injected feed self-consistent
  installSurface();
  serveFeed(mutated);
  fleetTable.init();
  await settle(150);
  // (1) a tagged book: the status word renders
  fleetTable.openDetail(mutated.books[0].poolId);
  let inl = collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline');
  assert.strictEqual(inl.length, 1, 'the row detail opened');
  const text = allText(inl[0]).join(' | ');
  assert.ok(text.indexOf('ours status: SEEDED') !== -1, 'the status word renders');
  assert.strictEqual(text.indexOf('ours status: true'), -1, 'the boolean literal is dead');
  // (2) an untagged book: no ours line at all
  fleetTable.openDetail(mutated.books[1].poolId);
  inl = collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline');
  assert.strictEqual(allText(inl[0]).join(' | ').indexOf('ours status'), -1,
    'an untagged book renders no ours line');
});

test('G4 #6: opening an inline detail nudges it into view (scrollIntoView block:nearest); re-opening stays idempotent — never a toggle', async () => {
  installSurface();
  serveFeed(feed);
  fleetTable.init();
  await settle(150);
  const b = feed.books[0];
  fleetTable.openDetail(b.poolId);
  let inl = collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline')
    .concat(collect(REGISTRY['fleet-cards'], '.fleet-sheet-inline'));
  assert.strictEqual(inl.length, 2, 'both inline surfaces carry the detail');
  for (const node of inl) {
    assert.deepStrictEqual(node._scrolls, [{ block: 'nearest' }],
      'the inline detail scrolled minimally into view');
  }
  // re-open (the seam's delegated double-call is by design): an idempotent
  // rebuild — the same detail nodes return with the same scroll, nothing closes
  fleetTable.openDetail(b.poolId);
  inl = collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline')
    .concat(collect(REGISTRY['fleet-cards'], '.fleet-sheet-inline'));
  assert.strictEqual(inl.length, 2, 'a re-open rebuilds, never toggles');
  for (const node of inl) {
    assert.deepStrictEqual(node._scrolls, [{ block: 'nearest' }],
      'the rebuilt detail re-fires the minimal scroll');
  }
});

test('G4 #2/#3: the ≤640 metric-label rung holds the 3-metric baseline; the il/age diet is unbounded with its colophon', () => {
  const css = fs.readFileSync(path.join(ROOT, 'site', 'css', 'style.css'), 'utf8');
  assert.ok(css.indexOf('.fc-metric-label { font-size: var(--step-0); letter-spacing: .02em; white-space: nowrap; }') !== -1,
    'the ≤640 label rule exists (rung-down + tight tracking + one line)');
  assert.ok(css.indexOf('--step-0:') !== -1, 'the sub-micro rung is defined (written justification at the token block)');
  // DECISION-2: the column hide is unbounded — no max-width cap on the diet
  assert.ok(/@media \(min-width: 641px\) \{\n  \.fleet-table thead th:nth-child\(6\)/.test(css),
    'the il/age hide runs at every table width');
  const html = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
  assert.ok(html.indexOf('il + age render when the feed carries them') !== -1, 'the colophon renders under the table');
  assert.ok(html.indexOf('class="fleet-colophon"') !== -1, 'the colophon rides the honesty register');
});

test('G2 #2: setFilter closes an open detail BEFORE rebuilding — no silent focus loss into the void (UI_LOOP_2 W2, 2026-09-08)', async () => {
  // a FRESH module instance: wireOnce's `wired` flag is module-scoped and the
  // phase-1 init already consumed it, so a later installSurface() would leave
  // the new chips unwired (listeners.click undefined). The fresh require is
  // the same move a page reload makes; the click path below is the REAL chip
  // → setFilter path, not a direct internal call.
  delete require.cache[require.resolve(FLEET_TABLE_JS_PATH)];
  const ftFresh = require(FLEET_TABLE_JS_PATH);
  installSurface();
  serveFeed(feed);
  ftFresh.init();
  await settle(150);
  const chips = collect(REGISTRY['fleet-surface'], '.fleet-filter');
  const hookChip = chips.find(function (c) { return c.getAttribute('data-filter') === 'HOOK'; });
  const allChip = chips.find(function (c) { return c.getAttribute('data-filter') === 'all'; });
  assert.ok(hookChip && allChip, 'the filter chips are wired');

  // (1) an open INLINE detail dies with the filter change — deliberately:
  // the rebuild would destroy it anyway, so setFilter closes both detail
  // surfaces FIRST (removeInlines + the aside), then rebuilds. The observable
  // contract: after the chip click, no inline panel survives and the aside
  // stays closed — focus never sits in a node that silently vanished.
  const b = feed.books[0];
  ftFresh.openDetail(b.poolId);
  assert.strictEqual(
    collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline')
      .concat(collect(REGISTRY['fleet-cards'], '.fleet-sheet-inline')).length, 2,
    'precondition: the inline detail is open');
  hookChip.listeners.click[0]();
  await settle(10);
  assert.strictEqual(
    collect(REGISTRY['fleet-tbody'], '.fleet-sheet-inline')
      .concat(collect(REGISTRY['fleet-cards'], '.fleet-sheet-inline')).length, 0,
    'the filter change closes the inline detail (no silent destruction)');
  assert.strictEqual(REGISTRY['fleet-sheet'].hidden, true, 'the aside stays closed across the filter change');
  assert.strictEqual(renderedRows().length, feed.books.filter(function (x) { return x.tier === 'HOOK'; }).length,
    'the rebuild still happened — rows reflect the new filter AFTER the close');

  // (2) the legacy ASIDE surface (unknown-pool fallback) would keep stale
  // content and a live focus target through the rebuild without the close —
  // the same chip path must hide+clear it too.
  ftFresh.openDetail('not-a-pool-in-this-feed');
  assert.strictEqual(REGISTRY['fleet-sheet'].hidden, false, 'precondition: the aside opened for the unknown pool');
  assert.ok(allText(REGISTRY['fleet-sheet']).length > 0, 'precondition: the aside carries content');
  allChip.listeners.click[0]();
  await settle(10);
  assert.strictEqual(REGISTRY['fleet-sheet'].hidden, true, 'the filter change closes the aside before rebuilding');
  assert.strictEqual(allText(REGISTRY['fleet-sheet']).length, 0, 'the aside is CLEARED, not merely hidden — no stale detail text survives');
  assert.strictEqual(renderedRows().length, feed.books.length, 'the all view restores the full file-driven count after the close');
  await settle(0);
});
