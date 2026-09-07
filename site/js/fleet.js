/*
 * Wellstreet site — fleet.js
 * WS.fleet — the Fleet feed reader (WS5-FLEET-DATA, identity revision #5).
 *
 * Reads the STATIC same-origin feed site/data/fleet.json via a RELATIVE path
 * (IPFS-safe, zero new origins, zero /api dependency). The feed is generated
 * offline by scripts/build_fleet_data.py from docs/ops/roam_policy_fixture.json;
 * every figure in it is measured fixture data or null — null means the source
 * lacks the figure, NEVER zero. "Real data IS the decoration."
 *
 * Fail-closed contract:
 *   - fetch/parse/validation failure → rows() returns [] and load's cb receives
 *     {error:true}; the page then renders the designed unavailable panel ('—'),
 *     never a fake zero;
 *   - summary() before a successful load → null (provenance() likewise);
 *   - rows(unknownTier) → [] (never the unfiltered book list);
 *   - fmtPct/fmtUsd render '—' for anything that is not a finite number — a
 *     measured 0 renders as 0 (0.0% / $0), unavailable renders as '—'.
 *
 * No animation, no DOM writes here. Consumers MUST render feed text through
 * textContent or an escape pass — the JSON is self-generated; escape anyway.
 */
(function (root, factory) {
  var api = factory(root);
  root.WS = root.WS || {};
  root.WS.fleet = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
  'use strict';

  var FEED_URL = './data/fleet.json';
  var TIERS = { HOOK: true, PAYS: true, DEAD: true };
  var TIER_RANK = { HOOK: 0, PAYS: 1, DEAD: 2 }; // the hook-black-hole books render first-class

  var state = { loaded: false, failed: false, data: null };

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  function fixed1(x) {
    return (Math.round(x * 10) / 10).toFixed(1);
  }

  function groupThousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtPct(v) {
    if (!isNum(v)) return '—';
    return fixed1(v) + '%';
  }

  function fmtUsd(v) {
    if (!isNum(v)) return '—';
    if (v < 0) return '-$' + fmtUsd(-v).slice(1);
    if (v >= 1e9) return '$' + fixed1(v / 1e9) + 'B';
    if (v >= 1e6) return '$' + fixed1(v / 1e6) + 'M';
    if (v >= 1e4) return '$' + fixed1(v / 1e3) + 'K';
    return '$' + groupThousands(Math.round(v));
  }

  function validate(data) {
    if (!data || typeof data !== 'object') return false;
    if (!data.provenance || typeof data.provenance.source !== 'string') return false;
    if (!data.summary || typeof data.summary !== 'object') return false;
    if (!Array.isArray(data.books)) return false;
    var counts = { PAYS: 0, HOOK: 0, DEAD: 0 };
    for (var i = 0; i < data.books.length; i++) {
      var b = data.books[i];
      if (!b || typeof b !== 'object') return false;
      if (!TIERS[b.tier]) return false;
      if (typeof b.pair !== 'string' || typeof b.poolId !== 'string') return false;
      counts[b.tier] += 1;
    }
    if (counts.PAYS !== data.summary.paysLps) return false;
    if (counts.HOOK !== data.summary.hookMonetized) return false;
    if (counts.DEAD !== data.summary.dead) return false;
    if (counts.PAYS + counts.HOOK + counts.DEAD !== data.summary.books) return false;
    if (data.summary.books !== data.books.length) return false;
    return true;
  }

  function tierRank(t) {
    var r = TIER_RANK[t];
    return r === undefined ? 9 : r; // not `|| 9` — HOOK's rank 0 is falsy
  }

  function byTierThenApr(a, b) {
    var r = tierRank(a.tier) - tierRank(b.tier);
    if (r !== 0) return r;
    var fa = isNum(a.feeAprPct) ? a.feeAprPct : null;
    var fb = isNum(b.feeAprPct) ? b.feeAprPct : null;
    if (fa !== null || fb !== null) {
      if (fa === null) return 1;  // figures the source lacks sort last — never first
      if (fb === null) return -1;
      if (fb !== fa) return fb - fa;
    }
    if (a.poolId < b.poolId) return -1;
    if (a.poolId > b.poolId) return 1;
    return 0;
  }

  function load(cb) {
    var settled = false;
    function ok(data) {
      if (settled) return;
      if (!validate(data)) { fail(); return; }
      settled = true;
      state.data = data;
      state.loaded = true;
      state.failed = false;
      if (typeof cb === 'function') cb(data);
    }
    function fail() {
      if (settled) return;
      settled = true;
      state.data = null;
      state.loaded = false;
      state.failed = true;
      if (typeof cb === 'function') cb({ error: true });
    }
    try {
      root.fetch(FEED_URL).then(function (res) {
        if (!res || !res.ok) { fail(); return; }
        return res.json().then(ok, fail);
      }, fail).catch(fail);
    } catch (err) {
      fail();
    }
  }

  function summary() {
    if (!state.loaded || state.failed || !state.data) return null;
    var s = state.data.summary;
    return {
      books: s.books,
      paysLps: s.paysLps,
      hookMonetized: s.hookMonetized,
      dead: s.dead,
      ours: (typeof s.ours === 'number' ? s.ours : 0) // WS5-OURS: books with our capital
    };
  }

  // WS5-OURS (2026-09-07): is this book one where OUR capital sits? Returns the
  // status word ('LIVE'|'SEEDED'|'WINDING-DOWN') or null. Data-driven — empty
  // today ($WELL not yet deployed); the badge appears the day the poolId is
  // added to the builder's OURS map. Fail-closed: null before a successful load.
  function isOurs(book) {
    if (!state.loaded || state.failed) return null;
    return (book && book.ours && typeof book.ours.status === 'string') ? book.ours.status : null;
  }

  // WS5-SKELETON (2026-09-07): read-only provenance accessor — the skeleton goal
  // renders the measurement-window clause VERBATIM (hero-stat + the fleet cards'
  // provenance labels), and the window lives only here. Null before a successful
  // load (fail-closed, same contract as summary()): the page renders no window it
  // has not read from the feed.
  function provenance() {
    if (!state.loaded || state.failed || !state.data) return null;
    var p = state.data.provenance;
    return {
      source: p.source,
      method: p.method,
      window: p.window,
      generated: p.generated
    };
  }

  function rows(tier) {
    if (!state.loaded || state.failed || !state.data) return [];
    var books = state.data.books;
    if (tier === undefined || tier === null) {
      return books.slice().sort(byTierThenApr);
    }
    if (!TIERS[tier]) return []; // unknown tier → fail-closed empty, never everything
    return books.filter(function (b) { return b.tier === tier; }).sort(byTierThenApr);
  }

  return {
    load: load,
    summary: summary,
    provenance: provenance,
    rows: rows,
    isOurs: isOurs,
    fmtPct: fmtPct,
    fmtUsd: fmtUsd,
    unavailable: '—'
  };
});
