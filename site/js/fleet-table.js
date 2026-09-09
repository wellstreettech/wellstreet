/*
 * Wellstreet site — fleet-table.js
 * WS.fleetTable — the Fleet v2 renderer (FLEET-UI-V2 G1, 2026-09-07).
 *
 * Renders the §1 DOM/class contract of docs/internal/FLEET_UI_V2_WAVE_2026-09-07.md
 * (byte-frozen across G1/G2/G4): the R1 terminal table (>=641px), the R2 Snowball
 * card stack (<=640px), the filter chips and the detail sheet — BOTH surface DOMs
 * on every load; which one is visible is CSS's decision (media queries only, no
 * resize JS). Data comes exclusively from WS.fleet (js/fleet.js — untouched):
 * rows() owns order, summary() owns counts, fmtPct/fmtUsd own every figure.
 * This module never re-sorts, never counts in markup, never invents a number.
 *
 * Fail-closed contract (mirrors fleet.js's):
 *   - missing fleet module / fetch failure / invalid payload -> the designed
 *     unavailable state (#fleet-unavailable) and empty mounts — never a fake
 *     zero, never a fabricated count;
 *   - figures the feed lacks render '—' through WS.fleet.fmtPct/fmtUsd;
 *   - unknown filter values do nothing (fail-closed, never the unfiltered list);
 *   - an unknown poolId opens the sheet with the honest not-in-the-feed line.
 *
 * §2 state lines (mandated, exactly ONE plain sentence per card):
 *   PAYS  -> the book's own measured note VERBATIM;
 *   HOOK / paysNothingToLps -> 'zero fees reach LPs here — we measured';
 *   DEAD  -> 'no swaps in the window — dead'.
 * §2 HOOK APR rule (the brand): any HOOK / paysNothingToLps book displays fee
 * APR 0.0% with the red HOOK-MONETIZED badge even when the feed's feeAprPct is
 * nonzero — the nonzero is the hook's take, not LP earnings (the tooltip may
 * name the original figure).
 *
 * §delta-3 (privacy): owner-free by construction — no owner field is read and
 * no owner text is rendered anywhere; the pool key renders ONLY inside the
 * detail sheet (the one surface the contract permits it) and travels in
 * data-* attributes for the delegated handlers (G4's copy/detail wiring),
 * never as rendered cell text.
 *
 * Every feed string renders through textContent — the JSON is self-generated;
 * escape anyway. No animation, no timers, no fetch of its own beyond the
 * self-registered WS.fleet.load.
 */
(function (root, factory) {
  var api = factory(root);
  root.WS = root.WS || {};
  root.WS.fleetTable = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
  'use strict';

  var FILTERS = { all: true, PAYS: true, HOOK: true, DEAD: true };
  var TIER_BADGE = { PAYS: 'PAYS-LPS', HOOK: 'HOOK-MONETIZED', DEAD: 'DEAD' };
  var TIER_BADGE_SUFFIX = { PAYS: ' · IN THE FLEET', HOOK: ' · LP EARNS 0', DEAD: ' · NO FEE STREAM' };
  var COLUMN_COUNT = 8; // spine / pair / TVL / vol 24h / fee APR / IL / age / actions (the DECISION-2 diet hides 6+7 at ≥641 — cells still emitted)

  var currentFilter = 'all';
  var wired = false;

  function doc() { return root.document; }
  function $(id) { return doc().getElementById(id); }
  function el(tag, cls, text) {
    var n = doc().createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }

  function fleet() { return root.WS ? root.WS.fleet : null; }

  // ------------------------------------------------------------------
  // classification helpers (§1 tier suffixes are the lower-case tier;
  // PROTOCOL = ours.status non-null via WS.fleet.isOurs — amber spine,
  // OURS badge, ranked within its tier because rows() owns the order).
  // ------------------------------------------------------------------
  function tierLower(b) {
    var t = String(b && b.tier ? b.tier : '').toLowerCase();
    return (t === 'pays' || t === 'hook' || t === 'dead') ? t : '';
  }
  function isOurs(b) {
    var f = fleet();
    return !!(f && typeof f.isOurs === 'function' && f.isOurs(b));
  }
  // §2 HOOK APR rule scope: the tier OR the measured paysNothingToLps truth.
  function isHookBook(b) {
    return !!(b && (b.tier === 'HOOK' || b.paysNothingToLps === true));
  }

  // ------------------------------------------------------------------
  // measurement window (§2): the letter parses out of the book's own note
  // (/window ([a-d])\b/); the hours come from provenance().window — parsed,
  // never hardcoded (the feed is the only source; a letter the clause does
  // not carry renders no suffix).
  // ------------------------------------------------------------------
  function noteWindow(b) {
    var m = /window ([a-d])\b/.exec(String((b && b.note) || ''));
    return m ? m[1] : null;
  }
  function windowHours(clause) {
    var map = {};
    if (!clause) { return map; }
    var re = /([a-d])\s*=\s*[^,;]*?\/(\d+(?:\.\d+)?)h/g;
    var m;
    while ((m = re.exec(String(clause))) !== null) {
      if (map[m[1]] === undefined) { map[m[1]] = parseFloat(m[2]); }
    }
    return map;
  }
  function windowSuffix(b, hours) {
    var letter = noteWindow(b);
    if (!letter) { return ''; }
    var h = hours ? hours[letter] : undefined;
    if (typeof h !== 'number' || !isFinite(h)) { return ''; }
    return (Math.round(h * 10) / 10).toFixed(1) + 'h';
  }

  // ------------------------------------------------------------------
  // figures (every number through the feed's own fail-closed formatters;
  // measured 0 renders 0, unavailable renders '—').
  // ------------------------------------------------------------------
  function aprText(b) {
    var f = fleet();
    if (isHookBook(b)) { return f ? f.fmtPct(0) : '—'; } // the §2 rule: LPs earn 0.0% here
    return f ? f.fmtPct(b && b.feeAprPct) : '—';
  }
  function feeChipText(b) {
    var v = b ? b.chargedFeeBps : null;
    if (typeof v !== 'number' || !isFinite(v)) { return '—'; }
    return String(Math.round((v / 100) * 100) / 100) + '%';
  }
  // the APR cell's title tooltip: the full provenance window clause + source
  // (+ method — §2: one measured-preferred figure per row, and the tooltip
  // carries the method clause). HOOK books name the original figure.
  function aprTitle(b, prov) {
    if (!prov) { return ''; }
    var parts = [];
    if (prov.window) { parts.push(String(prov.window)); }
    if (prov.source) { parts.push('source: ' + prov.source); }
    if (prov.method) { parts.push('method: ' + prov.method); }
    var t = parts.join(' — ');
    var v = b ? b.feeAprPct : null;
    if (isHookBook(b) && typeof v === 'number' && isFinite(v) && v !== 0) {
      var f = fleet();
      t += ' — the feed figures ' + (f ? f.fmtPct(v) : '—') +
        ' here: the hook take, not LP earnings; LPs are shown 0.0%';
    }
    return t;
  }

  // §2 state lines — exactly ONE plain sentence per card.
  function stateLine(b) {
    if (isHookBook(b)) { return 'zero fees reach LPs here — we measured'; }
    if (b && b.tier === 'DEAD') { return 'no swaps in the window — dead'; }
    var note = b ? b.note : null;
    return note ? String(note) : '—';
  }

  // the badge: class + plain text. PROTOCOL rows carry the amber OURS badge
  // (§1); the HOOK rule keeps the red HOOK-MONETIZED badge even for a
  // paysNothingToLps book whose tier is PAYS.
  function badgeInfo(b) {
    var tier = b ? String(b.tier || '') : '';
    if (isOurs(b)) {
      return { cls: 'badge--protocol', text: 'OURS · ' + (TIER_BADGE[tier] || '—') };
    }
    if (isHookBook(b)) {
      return { cls: 'badge--hook', text: TIER_BADGE.HOOK + TIER_BADGE_SUFFIX.HOOK };
    }
    if (tier === 'PAYS') { return { cls: 'badge--pays', text: TIER_BADGE.PAYS + TIER_BADGE_SUFFIX.PAYS }; }
    if (tier === 'DEAD') { return { cls: 'badge--dead', text: TIER_BADGE.DEAD + TIER_BADGE_SUFFIX.DEAD }; }
    return { cls: 'badge--dead', text: '—' }; // unreachable via a validated feed — fail honest
  }
  function spineClass(prefix, b) {
    if (isOurs(b)) { return prefix + '--protocol'; }
    var t = tierLower(b);
    return t ? prefix + '--' + t : prefix; // unknown tier: no modifier (transparent), never a borrowed flag
  }

  // ------------------------------------------------------------------
  // DOM builders. Both surfaces render from the same book list; the sheet
  // (openDetail) is the ONE surface where the pool key renders as text.
  // ------------------------------------------------------------------
  function appendChips(parent, b) {
    // the version chip: every book in this feed is a v4 pool (the feed is the
    // v4 fee screen — docs/ops/v4_fee_screen.py classifier, build_fleet_data.py).
    // Chips are DIRECT children of the pair cell/head, per the §1 anatomy.
    parent.appendChild(el('span', 'ft-chip', 'v4'));
    parent.appendChild(el('span', 'ft-chip ft-chip--fee', feeChipText(b)));
  }
  function appendActionButtons(parent, b) {
    // G4's delegated handlers resolve these by attribute — the buttons carry
    // NO payload, only data-copy-position/data-details + the pool id.
    var copy = el('button', 'ft-copy', 'Copy position');
    copy.setAttribute('type', 'button');
    copy.setAttribute('data-copy-position', '');
    copy.setAttribute('data-pool', String(b.poolId || ''));
    var details = el('button', 'ft-details', 'Details');
    details.setAttribute('type', 'button');
    details.setAttribute('data-details', String(b.poolId || ''));
    parent.appendChild(copy);
    parent.appendChild(details);
  }

  function buildRow(b, prov, hours) {
    var tr = el('tr', 'ft-row ft-row--' + tierLower(b) + (isOurs(b) ? ' is-protocol' : ''));
    tr.setAttribute('data-tier', String(b.tier || ''));
    tr.setAttribute('data-pool', String(b.poolId || ''));
    tr.appendChild(el('td', 'ft-spine ' + spineClass('ft-spine', b)));
    var pair = el('td', 'ft-pair');
    pair.textContent = String(b.pair || '—');
    appendChips(pair, b);
    tr.appendChild(pair);
    var f = fleet();
    tr.appendChild(el('td', 'ft-num', f ? f.fmtUsd(b.tvlUsd) : '—'));
    tr.appendChild(el('td', 'ft-num', f ? f.fmtUsd(b.vol24hUsd) : '—'));
    var apr = el('td', 'ft-num ft-apr');
    apr.textContent = aprText(b);
    var suffix = windowSuffix(b, hours);
    if (suffix) { apr.appendChild(el('span', 'ft-window', '·' + suffix)); }
    var tip = aprTitle(b, prov);
    if (tip) { apr.setAttribute('title', tip); }
    tr.appendChild(apr);
    // realized IL + age: the feed does not carry them today — the styled '—',
    // never an estimate, never a figure copied from anywhere (§0 rule 8)
    tr.appendChild(el('td', 'ft-num ft-il', '—'));
    tr.appendChild(el('td', 'ft-age', '—'));
    var actions = el('td', 'ft-actions');
    appendActionButtons(actions, b);
    tr.appendChild(actions);
    return tr;
  }

  function appendMetric(parent, label, value) {
    var m = el('div', 'fc-metric');
    m.appendChild(el('span', 'fc-metric-label', label));
    m.appendChild(el('span', 'fc-metric-value doto', value));
    parent.appendChild(m);
  }

  function buildCard(b, prov, hours) {
    var f = fleet();
    var card = el('article', 'fleet-card fleet-card--' + tierLower(b) + (isOurs(b) ? ' is-protocol' : ''));
    card.setAttribute('data-tier', String(b.tier || ''));
    card.setAttribute('data-pool', String(b.poolId || ''));
    var head = el('div', 'fc-head');
    head.appendChild(el('span', 'fc-spine ' + spineClass('fc-spine', b)));
    head.appendChild(el('span', 'fc-pair', String(b.pair || '—')));
    appendChips(head, b);
    card.appendChild(head);
    var badge = badgeInfo(b);
    card.appendChild(el('div', 'fc-badge ' + badge.cls, badge.text));
    var metrics = el('div', 'fc-metrics');
    appendMetric(metrics, 'TVL', f ? f.fmtUsd(b.tvlUsd) : '—');
    appendMetric(metrics, 'VOL 24H', f ? f.fmtUsd(b.vol24hUsd) : '—');
    var suffix = windowSuffix(b, hours);
    appendMetric(metrics, suffix ? 'FEE APR (' + suffix + ')' : 'FEE APR', aprText(b));
    card.appendChild(metrics);
    card.appendChild(el('p', 'fc-state', stateLine(b)));
    var actions = el('div', 'fc-actions');
    appendActionButtons(actions, b);
    card.appendChild(actions);
    return card;
  }

  // ------------------------------------------------------------------
  // render paths
  // ------------------------------------------------------------------
  function showUnavailable() {
    var box = $('fleet-unavailable');
    if (box) { box.hidden = false; }
    var tbody = $('fleet-tbody');
    if (tbody) { tbody.textContent = ''; }
    var cards = $('fleet-cards');
    if (cards) { cards.textContent = ''; }
  }
  function hideUnavailable() {
    var box = $('fleet-unavailable');
    if (box) { box.hidden = true; }
  }

  function appendEmptyState(tbody, cards) {
    var tr = el('tr', 'ft-row');
    var td = el('td', 'ft-empty', '0 books in this view — the feed file is the truth.');
    td.setAttribute('colspan', String(COLUMN_COUNT));
    tr.appendChild(td);
    tbody.appendChild(tr);
    cards.appendChild(el('p', 'fc-state', '0 books in this view — the feed file is the truth.'));
  }

  function renderRows(filter) {
    var f = fleet();
    var tbody = $('fleet-tbody');
    var cards = $('fleet-cards');
    if (!tbody || !cards || !f) { return; }
    var prov = typeof f.provenance === 'function' ? f.provenance() : null;
    var hours = windowHours(prov && prov.window);
    var list = filter === 'all' ? f.rows() : f.rows(filter);
    tbody.textContent = '';
    cards.textContent = '';
    for (var i = 0; i < list.length; i++) {
      tbody.appendChild(buildRow(list[i], prov, hours));
      cards.appendChild(buildCard(list[i], prov, hours));
    }
    if (!list.length) { appendEmptyState(tbody, cards); }
  }

  // G4 #4 (2026-09-08): the chip census. Every count comes from
  // WS.fleet.summary() — the same file-driven counts the page already
  // trusts — and renders into a .fleet-filter-count span inside each chip.
  // Fail-closed both ways: no summary → no counts (and any stale spans are
  // removed), and a key the summary does not carry gets no span. Never a
  // hardcoded universe figure.
  var SUMMARY_COUNTS = { all: 'books', PAYS: 'paysLps', HOOK: 'hookMonetized', DEAD: 'dead' };
  function renderCounts(summary) {
    var surface = $('fleet-surface');
    if (!surface || typeof surface.querySelectorAll !== 'function') { return; }
    var chips = surface.querySelectorAll('.fleet-filter');
    for (var i = 0; i < chips.length; i++) {
      var btn = chips[i];
      var stale = typeof btn.querySelector === 'function' ? btn.querySelector('.fleet-filter-count') : null;
      if (stale && typeof stale.remove === 'function') { stale.remove(); }
      var key = btn.getAttribute('data-filter');
      var field = key !== null ? SUMMARY_COUNTS[key] : null;
      var n = (summary && field && typeof summary[field] === 'number' && isFinite(summary[field]))
        ? summary[field] : null;
      if (n !== null) { btn.appendChild(el('span', 'fleet-filter-count', String(n))); }
    }
  }

  function renderAll() {
    var f = fleet();
    var summary = f && typeof f.summary === 'function' ? f.summary() : null;
    renderCounts(summary); // fail-closed: no summary, no counts (stale spans cleared)
    if (!summary) { showUnavailable(); return; } // fail-closed: no load, fetch failure or invalid payload
    hideUnavailable();
    renderRows(currentFilter);
  }

  function setFilter(filter) {
    if (typeof filter !== 'string' || !FILTERS[filter]) { return; } // unknown filter: fail-closed no-op
    currentFilter = filter;
    // G2 #2 (2026-09-08, UI_LOOP_2 W2): the rebuild below wipes the row/card
    // mounts — an open detail would be silently destroyed (the inline panels
    // are children of those mounts, and the legacy aside would keep stale
    // content while any focus inside it drops into the void). Close BOTH
    // detail surfaces FIRST: removeInlines() clears the inline row/card
    // panels, closeSheet() hides+clears the aside (its own removeInlines is
    // idempotent). No-op when nothing is open; an unknown filter above never
    // reaches this, so a failed filter change closes nothing.
    removeInlines();
    closeSheet();
    var surface = $('fleet-surface');
    if (surface) {
      var chips = surface.querySelectorAll('.fleet-filter');
      for (var i = 0; i < chips.length; i++) {
        var btn = chips[i];
        if (btn.getAttribute('data-filter') === filter) { btn.classList.add('is-active'); }
        else { btn.classList.remove('is-active'); }
      }
    }
    var f = fleet();
    if (f && typeof f.summary === 'function' && f.summary()) { renderRows(filter); }
  }

  // ------------------------------------------------------------------
  // the detail surfaces (§1 aside + DETAIL-INLINE 2026-09-08, user: the
  // panel must open UNDER the clicked position, not at the foot of the
  // mount). A known pool renders the SAME content into inline blocks: one
  // .ft-detail-row (colspan-8 cell) immediately after the table row and
  // one .fleet-sheet-inline block after the card — CSS decides which
  // viewport shows which; the legacy #fleet-sheet aside remains the
  // unknown-pool surface and the no-row fallback. The pool key renders in
  // the detail surfaces only (§delta-3). The §3 mirror: each detail's pre
  // block carries the copy-position JSON byte-for-byte once the copy seam
  // (G4) is loaded — before that, the honest not-loaded line, never a
  // fabricated object. Re-opening (the seam's delegated double-call is by
  // design) is idempotent: the mount is cleared and rebuilt, never toggled.
  // ------------------------------------------------------------------
  function closeButton() {
    var b = el('button', 'ft-copy fleet-sheet-close', 'Close');
    b.setAttribute('type', 'button');
    b.setAttribute('data-sheet-close', '');
    return b;
  }

  function buildDetail(book, f) {
    var node = el('div', 'fleet-sheet fleet-sheet-inline');
    var prov = f && typeof f.provenance === 'function' ? f.provenance() : null;
    var hours = windowHours(prov && prov.window);
    var head = el('div', 'fc-head');
    head.appendChild(el('span', 'fc-spine ' + spineClass('fc-spine', book)));
    head.appendChild(el('span', 'fc-pair', String(book.pair || '—')));
    appendChips(head, book);
    node.appendChild(head);
    var badge = badgeInfo(book);
    node.appendChild(el('div', 'fc-badge ' + badge.cls, badge.text));
    // §delta-3: the pool key, in the one surface the contract permits it
    node.appendChild(el('p', 'fleet-poolid', String(book.poolId || '—')));
    var metrics = el('div', 'fc-metrics');
    appendMetric(metrics, 'TVL', f.fmtUsd(book.tvlUsd));
    appendMetric(metrics, 'VOL 24H', f.fmtUsd(book.vol24hUsd));
    var suffix = windowSuffix(book, hours);
    appendMetric(metrics, suffix ? 'FEE APR (' + suffix + ')' : 'FEE APR', aprText(book));
    node.appendChild(metrics);
    node.appendChild(el('p', 'fc-state', stateLine(book)));
    if (book.note) {
      node.appendChild(el('h4', null, 'measured'));
      node.appendChild(el('p', 'fleet-note', String(book.note)));
    }
    if (prov) {
      node.appendChild(el('h4', null, 'provenance'));
      if (prov.window) { node.appendChild(el('p', 'fleet-note', String(prov.window))); }
      if (prov.method) { node.appendChild(el('p', 'fleet-note', String(prov.method))); }
      if (prov.source) { node.appendChild(el('p', 'fleet-note', 'source: ' + prov.source)); }
    }
    // G4 #5 (2026-09-08): the status WORD from the data layer (WS.fleet.isOurs
    // returns 'LIVE'|'SEEDED'|'WINDING-DOWN' or null) — the boolean helper
    // here rendered the literal 'ours status: true'. Dormant today (the
    // census is 0); rider-tested both paths.
    var fmod = fleet();
    var ours = (fmod && typeof fmod.isOurs === 'function') ? fmod.isOurs(book) : null;
    if (ours) { node.appendChild(el('p', 'fleet-note', 'ours status: ' + ours)); }
    node.appendChild(el('h4', null, 'position params'));
    var pre = doc().createElement('pre');
    pre.className = 'fleet-sheet-json';
    // the pre stays wrap-safe (no horizontal scroll at 390px, §0 rule 9)
    pre.setAttribute('style', 'white-space: pre-wrap; overflow-wrap: anywhere; margin: 0;');
    if (root.WS && root.WS.copyPosition && typeof root.WS.copyPosition.build === 'function') {
      try {
        pre.textContent = JSON.stringify(root.WS.copyPosition.build(book), null, 2);
      } catch (e) {
        pre.textContent = 'position params unavailable — the copy seam failed; nothing here is estimated.';
      }
    } else {
      pre.textContent = 'position params unavailable — the copy seam is not loaded; nothing here is estimated.';
    }
    node.appendChild(pre);
    node.appendChild(closeButton());
    return node;
  }

  function removeInlines() {
    var surface = $('fleet-surface');
    // queried from the SURFACE element, not document: every inline detail
    // lives inside it by construction, and this keeps the lookup element-
    // level on both sides of the seam (browsers + the test DOM stub)
    var nodes = surface && typeof surface.querySelectorAll === 'function'
      ? surface.querySelectorAll('.fleet-sheet-inline') : [];
    for (var i = nodes.length - 1; i >= 0; i--) {
      if (nodes[i] && typeof nodes[i].remove === 'function') { nodes[i].remove(); }
    }
  }

  function childByPool(parent, poolId) {
    if (!parent || !parent.children) { return null; }
    for (var i = 0; i < parent.children.length; i++) {
      var c = parent.children[i];
      if (c && typeof c.getAttribute === 'function' && c.getAttribute('data-pool') === poolId) { return c; }
    }
    return null;
  }

  function insertAfter(parent, node, ref) {
    if (typeof parent.insertBefore === 'function') {
      parent.insertBefore(node, ref.nextSibling || null);
      return;
    }
    parent.appendChild(node);
  }

  // G4 #6 (2026-09-08): the inline panel can open below the fold (the mobile
  // card surface) — nudge it into view with the minimal scroll ('nearest':
  // a visible panel does not move). Guarded — scroll is a nicety, never a
  // failure path, and the test DOM stub does not implement scrollIntoView.
  function scrollNearest(node) {
    if (node && typeof node.scrollIntoView === 'function') {
      try { node.scrollIntoView({ block: 'nearest' }); } catch (e) { /* no scroll, no harm */ }
    }
  }

  function openDetail(poolId) {
    var sheet = $('fleet-sheet');
    removeInlines();
    if (sheet) { sheet.textContent = ''; sheet.hidden = true; }
    var f = fleet();
    var list = f && typeof f.rows === 'function' ? f.rows() : [];
    var book = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].poolId === poolId) { book = list[i]; break; }
    }
    if (!book) {
      // the unknown pool keeps the legacy aside: honest not-in-the-feed line
      if (sheet) {
        sheet.appendChild(el('p', 'fc-state', 'that pool is not in the feed right now — the file is the truth.'));
        sheet.appendChild(closeButton());
        sheet.hidden = false;
      }
      return;
    }
    var row = childByPool($('fleet-tbody'), poolId);
    if (row && row.parentNode) {
      var tr = doc().createElement('tr');
      tr.className = 'ft-detail-row';
      var td = doc().createElement('td');
      td.setAttribute('colspan', '8'); // the §1 column count (spine..actions)
      var rowDetail = buildDetail(book, f);
      td.appendChild(rowDetail);
      tr.appendChild(td);
      insertAfter(row.parentNode, tr, row);
      scrollNearest(rowDetail); // the visible surface's panel (the other is display:none — a no-op)
    } else if (sheet) {
      // no row surface to attach to: keep the detail reachable via the aside
      sheet.appendChild(buildDetail(book, f));
      sheet.hidden = false;
    }
    var card = childByPool($('fleet-cards'), poolId);
    if (card && card.parentNode) {
      var cardDetail = buildDetail(book, f);
      insertAfter(card.parentNode, cardDetail, card);
      scrollNearest(cardDetail);
    }
  }

  function closeSheet() {
    var sheet = $('fleet-sheet');
    removeInlines();
    if (sheet) { sheet.hidden = true; sheet.textContent = ''; }
  }

  // ------------------------------------------------------------------
  // wiring: ONE delegated click listener on the §1 surface resolves both
  // [data-details] (the detail surfaces) and [data-sheet-close]; the copy buttons
  // ([data-copy-position]) stay for G4's delegated handler — this module
  // never touches the clipboard. Filters re-render rows(tier); 'all' is
  // rows(). init() self-registers its own WS.fleet.load (alongside main.js's
  // call — fleet.js is untouched) and is idempotent.
  // ------------------------------------------------------------------
  function wireOnce(surface) {
    if (wired) { return; }
    wired = true;
    surface.addEventListener('click', function (ev) {
      var t = ev && ev.target;
      while (t && t !== surface) {
        if (typeof t.getAttribute === 'function') {
          if (t.getAttribute('data-details') !== null) { openDetail(t.getAttribute('data-details')); return; }
          if (t.getAttribute('data-sheet-close') !== null) { closeSheet(); return; }
        }
        t = t.parentNode;
      }
    });
    var chips = surface.querySelectorAll('.fleet-filter');
    for (var i = 0; i < chips.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () { setFilter(btn.getAttribute('data-filter')); });
      })(chips[i]);
    }
  }

  // ------------------------------------------------------------------
  // W1 G1-BAND (2026-09-08): the band scroller's emulated sticky thead.
  // 641-892px: the table's min-content overflows the DOCUMENT, so the
  // #fleet-table-scroller div (index.html — around the table ONLY, outside
  // tbody) is the table's horizontal scrollport there. A scroll container
  // KILLS the CSS viewport-sticky thead — the nearest scrollport becomes the
  // scroller, which never scrolls vertically, so the base top:74 never
  // engages (measured, Playwright @768: the head slides away with the page).
  // The measured alternatives both lose: a pinned internally-scrolling panel
  // bounds the stick to ~30px of travel inside #fleet-surface AND makes rows
  // below the fold unreachable by page scroll. So inside the band this module
  // re-implements the stick: on scroll/resize it pins the head cells just
  // under the sticky site header — measured LIVE each frame, so the
  // wrapped-nav sub-band (114.14px header) needs no hardcoded offset — and
  // docks them at the table's bottom edge, exactly the native sticky
  // semantics. Outside the band the CSS rule owns the behavior and the inline
  // styles clear. SCROLLER_ID stays variable-mediated (the stats.js
  // SECTION_ID precedent) so no registry rider arises; the seam is skipped
  // entirely where window/matchMedia are absent (the node test stubs).
  // ------------------------------------------------------------------
  var SCROLLER_ID = 'fleet-table-scroller';
  var BAND_QUERY = '(min-width: 641px) and (max-width: 892px)';
  var bandMql = null;
  var bandWired = false;
  var bandTick = false;
  var bandActive = false;
  var bandLastY = null;

  function bandCells(scroller) {
    var head = scroller.querySelector('thead');
    if (!head) { return null; }
    var cells = head.querySelectorAll('th');
    return cells.length ? cells : null;
  }

  function bandApply(cells, y) {
    for (var i = 0; i < cells.length; i++) {
      cells[i].style.position = 'relative';
      cells[i].style.top = y;
    }
  }

  function bandClear(cells) {
    for (var i = 0; i < cells.length; i++) {
      cells[i].style.position = '';
      cells[i].style.top = '';
    }
  }

  function bandUpdate() {
    bandTick = false;
    var scroller = $(SCROLLER_ID);
    if (!scroller || typeof scroller.getBoundingClientRect !== 'function') { return; }
    var cells = bandCells(scroller);
    if (!cells) { return; }
    if (!bandMql || !bandMql.matches) {
      if (bandActive) { bandClear(cells); bandActive = false; bandLastY = null; }
      return;
    }
    var header = doc().querySelector('.site-header');
    var headerBottom = header && typeof header.getBoundingClientRect === 'function'
      ? header.getBoundingClientRect().bottom : 0;
    var rect = scroller.getBoundingClientRect();
    var head = cells[0].parentNode; // the thead's single head row shares the cells' shift
    var headH = head && typeof head.getBoundingClientRect === 'function'
      ? head.getBoundingClientRect().height : 0;
    var shift = headerBottom - rect.top; // >0 once the scroller's top passes the header line
    var maxShift = rect.height - headH;  // dock: the head stops at the table's bottom edge
    var y = Math.max(0, Math.min(shift, maxShift));
    if (bandActive && y === bandLastY) { return; }
    bandApply(cells, y + 'px');
    bandActive = true;
    bandLastY = y;
  }

  function bandOnScroll() {
    if (bandTick) { return; }
    bandTick = true;
    if (typeof root.requestAnimationFrame === 'function') { root.requestAnimationFrame(bandUpdate); }
    else { bandUpdate(); }
  }

  function wireBandSticky() {
    if (bandWired) { return; }
    // the STUB RIDER's accepted guard form (theme-toggle.js precedent): the
    // node stubs provide no matchMedia, so the seam stays test-silent.
    if (typeof window === 'undefined' || !window ||
      typeof window.addEventListener !== 'function' || !('matchMedia' in window)) { return; }
    bandMql = window.matchMedia(BAND_QUERY);
    if (!bandMql) { return; }
    bandWired = true;
    window.addEventListener('scroll', bandOnScroll, { passive: true });
    window.addEventListener('resize', bandOnScroll);
    bandOnScroll(); // the initial paint may already sit inside the band
  }

  function init() {
    var surface = $('fleet-surface');
    if (!surface) { return; }
    wireOnce(surface);
    wireBandSticky();
    var f = fleet();
    if (!f || typeof f.load !== 'function') {
      showUnavailable(); // the feed module is absent — the page states the gap
      return;
    }
    f.load(function () { renderAll(); });
  }

  return {
    init: init,
    openDetail: openDetail,
    closeSheet: closeSheet
  };
});
