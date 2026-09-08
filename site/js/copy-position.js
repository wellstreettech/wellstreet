/*
 * Wellstreet site — copy-position.js
 * WS.copyPosition — the agent-mirror copy seam (FLEET-UI-V2 G4, 2026-09-07).
 *
 * §3 of docs/internal/FLEET_UI_V2_WAVE_2026-09-07.md (contract = reference
 * §delta-4): one click on a [data-copy-position] button mirrors a fleet book
 * to the clipboard as the position-params JSON the agent skill parses. The
 * buttons carry NO payload — the book is resolved by data-pool through
 * WS.fleet.rows() (the data layer owns the list and its order), so the DOM
 * never becomes a second source of truth.
 *
 * Fail-closed contract (mirrors fleet.js's):
 *   - build(book) is PURE and returns null for anything that is not a book
 *     with a string poolId — never a fabricated skeleton, never a guessed
 *     figure; every value the feed lacks stays null;
 *   - the five §4 agent keys (poolKey, tickLower, tickUpper, minOuts,
 *     expectedGainBps) are ALWAYS present, null when the feed lacks them —
 *     the consuming agent skill parses them by name;
 *   - an unresolvable poolId copies nothing and says so (its own honest
 *     line — never the success toast, never the clipboard-failure text);
 *   - a blocked/absent clipboard says 'copy failed — your browser blocked
 *     the clipboard' — success is claimed only after writeText resolves.
 *
 * §2 boundary: the HOOK 0.0% rule is a DISPLAY rule owned by the renderer
 * (js/fleet-table.js). The mirror records the feed's measurement verbatim —
 * measured.feeAprPct is what the pool's fee replay measured, and the honesty
 * line states what is not in the feed. The window letter parses out of the
 * book's own note with the renderer's rule (/window ([a-d])\b/).
 *
 * §delta-3 (privacy): the emitted JSON carries the pool KEY (the mirror's
 * whole point — the §4 contract), never an owner address; this module reads
 * no owner field and renders no owner text anywhere.
 *
 * Toast: textContent only (never innerHTML), identity tokens inline with
 * var() fallbacks (this module owns no CSS file — the fleet-table sheet-pre
 * inline-style precedent). The toast carries NO motion: static show, static
 * hide after 2s — so the reduced-motion requirement ("instant hide") holds
 * everywhere by construction, with no JS media-query branch. One toast at a
 * time; a new copy replaces the standing one.
 *
 * ES5-style, UMD, same-origin only — no fetch of its own, no timers beyond
 * the one 2s toast lifetime, no DOM writes outside the toast node.
 */
(function (root, factory) {
  var api = factory(root);
  root.WS = root.WS || {};
  root.WS.copyPosition = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
  'use strict';

  var CHAIN_ID = 4663; // the §3 contract pins the RH chain id in the emitted JSON
  var TOAST_MS = 2000; // §3: the toast lives 2s (static hide — instant by construction)
  var COPY_OK = 'position params copied — paste into your agent';
  var COPY_FAIL = 'copy failed — your browser blocked the clipboard';
  var COPY_MISS = 'that pool is not in the feed right now — nothing copied';
  var HONESTY = 'ticks/minOuts/expectedGain not in the fleet feed — null until measured; verify on-chain';

  var wiredTarget = null;   // the delegation target already wired (init is idempotent per target)
  var currentNode = null;   // the standing toast node (one at a time)
  var pendingTimer = null;

  function doc() { return root.document; }
  function fleet() { return root.WS ? root.WS.fleet : null; }

  function numOrNull(v) {
    return (typeof v === 'number' && isFinite(v)) ? v : null;
  }

  function strOrNull(v) {
    return (typeof v === 'string' && v) ? v : null;
  }

  // the renderer's window-letter rule (§2): the letter lives in the book's
  // own measured note, nowhere else.
  function noteWindow(b) {
    var m = /window ([a-d])\b/.exec(String((b && b.note) || ''));
    return m ? m[1] : null;
  }

  // ------------------------------------------------------------------
  // build(book) — PURE: no DOM, no clipboard, no module state. §3's
  // byte-exact key order; the five §4 agent keys always present.
  // ------------------------------------------------------------------
  function build(book) {
    if (!book || typeof book !== 'object' || typeof book.poolId !== 'string' || !book.poolId) {
      return null; // fail-closed: no book, no object — never a fabricated skeleton
    }
    return {
      v: 1,
      protocol: 'wellstreet',
      chainId: CHAIN_ID,
      action: 'mirror-position',
      poolKey: book.poolId,
      pair: strOrNull(book.pair),
      feeTierBps: numOrNull(book.chargedFeeBps),
      tickLower: null,
      tickUpper: null,
      minOuts: null,
      expectedGainBps: null,
      measured: {
        tvlUsd: numOrNull(book.tvlUsd),
        vol24hUsd: numOrNull(book.vol24hUsd),
        feeAprPct: numOrNull(book.feeAprPct),
        tier: strOrNull(book.tier),
        window: noteWindow(book)
      },
      honesty: HONESTY
    };
  }

  // one canonical serialization — the same bytes on the clipboard and in the
  // sheet's pre block (§3: the sheet mirrors the emitted object, pretty form).
  function serialize(book) {
    var obj = build(book);
    return obj ? JSON.stringify(obj, null, 2) : null;
  }

  // ------------------------------------------------------------------
  // toast — textContent only; identity tokens inline with var() fallbacks
  // (substrate / ink / amber — the ONLY colors this surface may carry).
  // ------------------------------------------------------------------
  function toast(message) {
    var d = doc();
    if (!d || !d.body || typeof d.createElement !== 'function') { return; }
    if (currentNode && currentNode.parentNode && typeof currentNode.remove === 'function') {
      currentNode.remove(); // one toast at a time — the new copy replaces the standing one
    }
    currentNode = null;
    var node = d.createElement('div');
    node.className = 'copy-toast';
    node.setAttribute('data-copy-toast', '');
    node.textContent = message; // never innerHTML — toast text is composed, but the rule is the rule
    node.setAttribute('style',
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:200;' +
      'margin:0;padding:12px 18px;background:var(--paper, #0A0E12);color:var(--ink, #EDE9DC);' +
      'border:2px solid var(--accent, #E8A33D);font-family:var(--mono, monospace);font-size:13px;' +
      'letter-spacing:0.02em;white-space:nowrap;');
    d.body.appendChild(node);
    currentNode = node;
    if (pendingTimer) { clearTimeout(pendingTimer); }
    pendingTimer = setTimeout(function () {
      pendingTimer = null;
      if (currentNode === node) { currentNode = null; }
      if (node.parentNode && typeof node.remove === 'function') { node.remove(); }
    }, TOAST_MS);
  }

  function clipboard() {
    var nav = root.navigator;
    return (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') ? nav.clipboard : null;
  }

  // the buttons carry no payload — the lookup is the data layer's rows()
  function findBook(poolId) {
    var f = fleet();
    if (!f || typeof f.rows !== 'function') { return null; }
    var list = f.rows();
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].poolId === poolId) { return list[i]; }
    }
    return null;
  }

  function copyFrom(node) {
    var poolId = node.getAttribute('data-pool');
    var text = (typeof poolId === 'string' && poolId) ? serialize(findBook(poolId)) : null;
    if (!text) {
      // unresolvable pool: nothing copied, said plainly — never the success
      // toast, never the clipboard-failure text (neither would be true)
      toast(COPY_MISS);
      return;
    }
    var clip = clipboard();
    if (!clip) { toast(COPY_FAIL); return; }
    try {
      Promise.resolve(clip.writeText(text)).then(
        function () { toast(COPY_OK); },              // success ONLY after the write resolves
        function () { toast(COPY_FAIL); }
      );
    } catch (err) {
      toast(COPY_FAIL);
    }
  }

  // ------------------------------------------------------------------
  // §3 Details wiring: delegated on [data-details]. WS.fleetTable owns the
  // sheet when it is loaded — this module calls it (its openDetail already
  // mirrors the emitted JSON into the pre block). Only when the renderer is
  // absent does the minimal sheet render here: the §3 JSON (pool key inside
  // it — the one surface §delta-3 permits), wrap-safe at 390px, honest line
  // for an unresolvable pool.
  // ------------------------------------------------------------------
  function openDetailFallback(poolId) {
    var d = doc();
    var sheet = (d && typeof d.getElementById === 'function') ? d.getElementById('fleet-sheet') : null;
    if (!sheet) { return; }
    sheet.textContent = '';
    var book = findBook(poolId);
    var pre = d.createElement('pre');
    pre.className = 'fleet-sheet-json';
    pre.setAttribute('style', 'white-space: pre-wrap; overflow-wrap: anywhere; margin: 0;');
    pre.textContent = book ? (serialize(book) || '') :
      'that pool is not in the feed right now — nothing here is estimated.';
    sheet.appendChild(pre);
    sheet.hidden = false;
  }

  function onClick(ev) {
    var d = doc();
    var stop = (d && d.body) ? d.body : d;
    var t = ev && ev.target;
    while (t && t !== stop) {
      if (typeof t.getAttribute === 'function') {
        if (t.getAttribute('data-copy-position') !== null) { copyFrom(t); return; }
        if (t.getAttribute('data-details') !== null) {
          var poolId = t.getAttribute('data-details');
          var ft = root.WS && root.WS.fleetTable;
          if (ft && typeof ft.openDetail === 'function') { ft.openDetail(poolId); }
          else { openDetailFallback(poolId); }
          return;
        }
      }
      t = t.parentNode;
    }
  }

  // idempotent per target: the browser self-wires once at load (the script
  // tag sits at the end of <body>); a replaced body re-wires on the next
  // init() call (the render-stub cohorts rebuild their DOM between phases).
  function init() {
    var d = doc();
    var target = (d && d.body) ? d.body : d;
    if (!target || typeof target.addEventListener !== 'function' || target === wiredTarget) { return; }
    wiredTarget = target;
    target.addEventListener('click', onClick);
  }

  init(); // self-wiring at load

  return {
    build: build,
    serialize: serialize,
    init: init
  };
});
