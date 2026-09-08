/*
 * Wellstreet site — main.js
 * Bootstrap: jurisdiction gate first, then render. Every dynamic value lands via
 * textContent (no innerHTML with data); every read is fail-soft — the page renders
 * fully even when the RPC is unreachable (honest "unavailable" states, never
 * fabricated numbers). No /api/* calls anywhere: the page is serverless-clean (D8).
 */
(function () {
  'use strict';

  var WS = (typeof globalThis !== 'undefined' ? globalThis : window).WS;
  if (!WS || !WS.config) { return; }
  var cfg = WS.config;

  // LAUNCH-FACT-RECONCILE (2026-09-04, Branch B): the launch fact is SINGLE-SOURCED.
  // Each state literal below is the only quoted occurrence in this file — every
  // consumer reads the constant, and the static span (#vaults-launch-fact in
  // index.html) stays byte-equal to proseDeployed (wow.test.js pins both sides).
  // Undated by design (a hard date in code goes stale) and carries no yield promise.
  var LAUNCH_FACT = { pendingShort: 'awaiting on-chain deploy', pending: 'awaiting on-chain deploy — yield phase not started', deployed: 'deployed — yield phase live', prosePending: 'The vault is not yet on-chain — factory, timelock, harvester and vault land on Robinhood Chain; these cards read the pending state until then.', proseDeployed: 'The vault is on-chain — four contracts, verifiable at the addresses these cards read.' };

  // WS5-SKELETON (2026-09-07): FLOW_DEPOSIT_SUB retired — the money-flow figure
  // (its only consumer) is deleted outright in the three-movement rebuild; the
  // wow.test.js pins that named the constant were retired dated in the same
  // change. The widget's pause/position/preview strings below are untouched.
  // P1: the pause row states the pause and the redeem guarantee — it never
  // guesses a duration, promises a date, or implies an un-pause.
  var PAUSE_ROW = 'Deposits are paused on the vault. Redemptions are never pausable — exits stay open.';

  // GLYPH REGISTER (G9, UI_IMPROVE2_GLYPHS 2026-09-05): the small-mark census —
  // '·' separates metadata fields (single spaces; HTML collapses doubles, so the
  // old two-space form was dead bytes) · '≈' marks a derived figure, never a
  // promise (the sim/preview/balance sites already obey) · '…' marks truncation
  // (fmtAddr) · '└' marks a methodology child row (the only box-drawing glyph).
  // No new separators ship ('—' stays the degraded-state em-dash per the
  // honest-state idiom).
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) { n.className = cls; }
    if (text !== undefined && text !== null) { n.textContent = text; }
    return n;
  }

  function fmtAddr(a) {
    return a && a.length > 14 ? a.slice(0, 8) + '…' + a.slice(-6) : String(a || '');
  }
  // WS5-SKELETON (2026-09-07): main.js's fmtUsd retired (its only consumers —
  // the hero ledger's USD TVL row and the chips — are deleted); USD figures on
  // the fleet column render through WS.fleet.fmtUsd (js/fleet.js), the feed's
  // own fail-closed formatter.
  function fmtPct(v, digits) {
    if (v === null || v === undefined || !isFinite(v)) { return '—'; }
    return v.toFixed(digits == null ? 2 : digits) + '%';
  }
  function fmtToken(raw, decimals) {
    return WS.amount.formatUnits(raw, decimals == null ? 18 : decimals, 4);
  }
  function fmtAge(seconds) {
    if (seconds === null || seconds === undefined) { return ''; }
    if (seconds < 90) { return seconds + 's ago'; }
    if (seconds < 7200) { return Math.round(seconds / 60) + 'm ago'; }
    if (seconds < 48 * 3600) { return Math.round(seconds / 3600) + 'h ago'; }
    return Math.round(seconds / 86400) + 'd ago';
  }

  // ------------------------------------------------------------------
  // Jurisdiction gate: DISABLED (decision D14, 2026-08-31) — the protocol
  // performs no jurisdictional blocking. js/geo.js + its unit tests remain
  // (pure, unwired, harmless) per D13's letter; nothing injects a country
  // and no gate runs anywhere in init().
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // 2. Vault cards + APR + widget
  // ------------------------------------------------------------------

  var state = {
    client: null,
    wallet: null,        // {account, chainId}
    pool: null,          // live pool snapshot
    apr: null,           // last APR derivation
    vaultDeployed: false,
    depositsPaused: null,     // P1: vault's own depositsPaused() — null = unknown (verified read only)
    underlyingState: null,    // P1: underlying token state ('active' | 'issuer-paused' | 'unknown')
    lastUpdated: null    // timestamp of the last successful refresh
    // WS5-SKELETON (2026-09-07): state.snap (the tape's diff input) and
    // state.prevDeployed (the launch-flip key) retired with the tape and the
    // flip wiring — the WOW-1 re-roll and WOW-3 beat had no other reader.
  };

  var cards = [];        // {vaultCfg, mounts} — refreshed on the live-refresh loop

  // ------------------------------------------------------------------
  // Live refresh (A1): the page claims "live on-chain reads" — that must stay
  // true over time, not only at load. Data refreshes every 60s (public-RPC
  // polite, visibility-gated, paused while a wallet flow is in flight). Timers
  // are unref'd so node --test exits.
  // WS5-SKELETON (2026-09-07): the 5s age stamp (the #vaults-updated surface is
  // retired with the #vaults section), the per-cycle magnify sweep, the WOW-7
  // heartbeat and the hero-ledger sr-only summary writer all retired with their
  // host surfaces — the loop is the reads, nothing else.
  // ------------------------------------------------------------------
  var REFRESH_MS = 60000;
  var flowPending = false;

  function anyVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  async function refreshCards() {
    if (flowPending || !anyVisible() || !state.client) { return; }
    for (var i = 0; i < cards.length; i++) {
      await loadVaultData(cards[i].vaultCfg, cards[i].mounts);
    }
    state.lastUpdated = Date.now();
  }

  function startTimers() {
    var refresh = setInterval(refreshCards, REFRESH_MS);
    if (refresh && typeof refresh.unref === 'function') { refresh.unref(); }
  }

  function row(label, valueNode, cls) {
    var r = el('div', 'card-row' + (cls ? ' ' + cls : ''));
    r.appendChild(el('span', 'row-label', label));
    var v = el('span', 'row-value');
    if (typeof valueNode === 'string' || typeof valueNode === 'number') { v.textContent = valueNode; }
    else if (valueNode) { v.appendChild(valueNode); }
    r.appendChild(v);
    return r;
  }

  function flagNode(ok, text) {
    // V2: the ●/△ glyph is its own element (aligned + colored via CSS) instead of a raw text prefix.
    var n = el('span', 'flag ' + (ok ? 'flag-ok' : 'flag-warn'));
    n.appendChild(el('span', 'flag-glyph', ok ? '●' : '△'));
    n.appendChild(el('span', null, ' ' + text));
    return n;
  }

  // ------------------------------------------------------------------
  // WS-VAULT-FAMILY-GRID (2026-09-04): the vault card is a REPEATABLE TEMPLATE
  // driven by cfg.vaults[] — one config entry = one card, zero code change per
  // entry. Every per-card read resolves through THE ENTRY'S OWN config keys
  // (vaultCfg.pool -> cfg.pools, vaultCfg.chainlinkFeed -> cfg.priceFeeds, the
  // asset label via an ADDRESS match against cfg.tokens); nothing in the card
  // path may hardcode a specific vault's pool/feed/token. Hero-level shared
  // surfaces (chain badge, chips, stat band, hero ledger, flow diagram, sim,
  // mint-ticket/invariant coverage cells, deposit widget, launch-fact writer)
  // are PRIMARY-VAULT-scoped via the canonical accessor below — with one entry
  // that is exactly today's rendering; a second entry adds a second
  // self-contained card without disturbing them.
  // ------------------------------------------------------------------
  function isPrimaryVault(vCfg) { return !!vCfg && vCfg === vaultCfg(); }

  // Per-entry resolvers. A missing/mis-keyed config entry resolves to null and
  // the card degrades to the honest "unavailable (RPC)" rows — never a
  // wrong-vault read, never a crash.
  function poolCfgFor(vCfg) {
    return (vCfg && vCfg.pool && cfg.pools) ? cfg.pools[vCfg.pool] : null;
  }
  function feedCfgFor(vCfg) {
    return (vCfg && vCfg.chainlinkFeed && cfg.priceFeeds) ? cfg.priceFeeds[vCfg.chainlinkFeed] : null;
  }
  // The asset's static label lives in cfg.tokens keyed by token name; resolve by
  // ADDRESS so a config entry needs no parallel token-name field. No match →
  // null (the card falls back to the LIVE-read symbol — never an invented label).
  function tokenCfgFor(addr) {
    if (!addr || !cfg.tokens) { return null; }
    var keys = Object.keys(cfg.tokens);
    for (var i = 0; i < keys.length; i++) {
      var t = cfg.tokens[keys[i]];
      if (t && typeof t.address === 'string' && t.address.toLowerCase() === String(addr).toLowerCase()) { return t; }
    }
    return null;
  }

  function renderCardShell(vaultCfg) {
    // V4: a PENDING_DEPLOY vault renders a designed pending card (dashed variant + tag),
    // not a finished-looking card with a warning row. The honest sentence in
    // vaultStatusRow() below is copy-frozen — the styling around it is what changes.
    var pending = !WS.vault.isDeployed(vaultCfg.vault);
    var card = el('article', 'vault-card' + (pending ? ' vault-card--pending' : ''));
    card.setAttribute('data-vault-id', vaultCfg.id);
    var head = el('div', 'card-head');
    var title = el('h3', 'card-title', vaultCfg.displayName);
    var sym = el('span', 'share-symbol', vaultCfg.shareSymbol);
    head.appendChild(title);
    head.appendChild(sym);
    if (pending) { head.appendChild(el('span', 'pending-tag', LAUNCH_FACT.pendingShort)); }
    card.appendChild(head);
    // WS-DARK-DOTO (2026-09-07): the certificate keeper is RETIRED with the
    // zero-image identity — the card is type, rules and measured numbers only.
    var rows = el('div', 'card-rows');
    card.appendChild(rows);
    var note = el('p', 'card-note');
    card.appendChild(note);
    return { card: card, rows: rows, note: note };
  }

  function underlyingRow(u, vCfg) {
    if (!u) { return row('Underlying', 'unavailable (RPC)'); }
    // WS-VAULT-FAMILY-GRID: the static label resolves per entry (address match
    // against cfg.tokens); no static entry → the live-read symbol alone.
    var t = tokenCfgFor(vCfg && vCfg.asset);
    var label = (u.symbol || '?') + (t && t.label ? ' — ' + t.label : '');
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, label));
    frag.appendChild(el('span', 'muted', ' · ' + (u.state === 'active' ? 'not paused' : u.state === 'unknown' ? 'pause state unknown' : u.state)));
    return row('Underlying (live)', frag);
  }

  function priceRow(price) {
    if (!price) { return row('Underlying price', 'unavailable (feed — no invented price)'); }
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, '$' + price.usd.toFixed(2)));
    frag.appendChild(el('span', 'muted', ' · ' + price.label + ' (Chainlink) · ' + fmtAge(price.ageSeconds) +
      (price.stale ? ' · equity feeds update 24/5 — weekend/holiday staleness is expected' : '')));
    return row('Underlying price (live)', frag);
  }

  function poolRow(pool) {
    if (!pool) { return row('Pool', 'unavailable (RPC)'); }
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, pool.label));
    frag.appendChild(el('span', 'muted', ' · TVL ' + (pool.tvlToken0 ? pool.tvlToken0.toFixed(2) + ' WETH' : '—') +
      ' · fee tier ' + (pool.feeTier != null ? pool.feeTier / 1e4 + '%' : '—') +
      ' · ' + fmtAddr(pool.address)));
    return row('Fee pool (live)', frag);
  }

  // WS-MULTI-VAULT-FRONTEND: the LIVE card's honest-APR source row — the vault's
  // own YieldHarvested log count (getLogs on the vault; readHarvestCredits in
  // js/vault.js). ZERO is a real, displayed state ("no harvests yet" — the honest
  // pre-accrual state of an empty, live vault); null renders "unavailable (RPC)".
  // A count never becomes an APR anywhere: the APR projection stays on its own
  // methodology-linked register.
  function harvestRow(h) {
    if (h === null || h === undefined) { return row('Harvests credited (live)', 'unavailable (RPC)'); }
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, h.count === 0 ? 'no harvests yet — the honest pre-accrual state' : String(h.count)));
    frag.appendChild(el('span', 'muted', ' · YieldHarvested log count (getLogs on the vault)'));
    return row('Harvests credited (live)', frag);
  }

  function cutRow(pool) {
    if (!pool || !pool.cut) { return row("The pool owner's cut", 'unavailable'); }
    var c = pool.cut;
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, (c.cutFraction * 100).toFixed(0) + '% of swap fees per side (live slot0: (' +
      c.token0N + ',' + c.token1N + ')) — LPs keep ' + (c.netMultiplier * 100).toFixed(0) + '%'));
    if (c.note) { frag.appendChild(el('span', 'muted', ' · ' + c.note)); }
    return row("The pool owner's cut (live)", frag);
  }

  function vaultStatusRow(vaultCfg) {
    var deployed = WS.vault.isDeployed(vaultCfg.vault);
    var frag = document.createDocumentFragment();
    if (deployed) {
      frag.appendChild(flagNode(true, 'deployed · ' + fmtAddr(vaultCfg.vault)));
    } else {
      frag.appendChild(flagNode(false, 'pending deploy — deposits not open; no numbers below pretend otherwise'));
    }
    return row('Vault contract', frag);
  }

  // ------------------------------------------------------------------
  // WS5-SKELETON (2026-09-07): the DEPLOY-GATED family card builders retired
  // outright (tierRow / riskRow / familyBookRow / aprNoteRow / renderFamilyCard
  // — the #vaults family grid is deleted; the DEPLOY-GATED family truth
  // survives as the ONE intro line in the #fleet section). The gated roster
  // itself stays in cfg.vaultFamily (js/vault.js's family reader still serves
  // it; the header tape strip still renders its roster rows).
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // WS5-SKELETON (2026-09-07): the hero live ledger (WS-HERO-V9) and the hero
  // chips (WS-HERO-CHIPS-V10) are RETIRED — deleted outright in the
  // three-movement rebuild (the audit's redundancy finding: the chips were
  // decorative duplicates of the ledger rows, the ledger a duplicate of the
  // card rows; the hero now carries ONE live stat — #hero-stat, the Fleet
  // count, rendered by initFleet below). renderLedger / setChipValue /
  // renderChipsLive are gone; the ledger-row ANATOMY helper stays (the
  // widget's position rows and the coverage line still speak it).
  // The WOW-6 sim's dilution leg keeps its live-TV supply through the one
  // seam the ledger used to own (the USD TVL deriveApr already derives —
  // passed in, never recomputed):
  // ------------------------------------------------------------------
  function ledgerRow(label, valueNode, cls) {
    var r = el('div', 'ledger-row' + (cls ? ' ' + cls : ''));
    r.appendChild(el('span', 'ledger-k', label));
    var v = el('span', 'ledger-v');
    if (typeof valueNode === 'string' || typeof valueNode === 'number') { v.textContent = valueNode; }
    else if (valueNode) { v.appendChild(valueNode); }
    r.appendChild(v);
    return r;
  }

  function setSimTvlUsd(tvlUsd) {
    simState.tvlUsd = (tvlUsd !== null && tvlUsd !== undefined && isFinite(tvlUsd)) ? tvlUsd : null;
    renderSim();
  }

  // ------------------------------------------------------------------
  // WS5-SKELETON (2026-09-07): the count-up stats band (WSV-STATS-REAL-FOOTER)
  // is RETIRED — the #stat-tape section is deleted outright in the
  // three-movement rebuild (its cells duplicated the hero chips, which are
  // retired too). setStatValue / statsCanAnimate / animateStat / armStatsReveal
  // / fmtStatNumber and their state are gone. KEPT: the two PURE helpers the
  // unit batteries pin — WS.stats.easeOutCubic (render.test.js easing math)
  // and splitStatFigure (tickGlyph's parser below) — same namespaced-seam
  // pattern as WS.rpc / WS.wallet.
  // ------------------------------------------------------------------

  // PURE: easeOutCubic — the count-up easing (no DOM, exposed for tests).
  function easeOutCubic(t) {
    var x = t < 0 ? 0 : (t > 1 ? 1 : t);
    return 1 - Math.pow(1 - x, 3);
  }
  WS.stats = { easeOutCubic: easeOutCubic };

  // Split a rendered figure into its countable parts ('~70.9%' -> '~' + 70.9
  // + '%' with 1 decimal). Anything unparseable counts as not-countable and
  // renders its final text as-is.
  function splitStatFigure(text) {
    var m = /^([^0-9]*)([0-9][0-9,]*(?:\.[0-9]+)?)([\s\S]*)$/.exec(text);
    if (!m) { return null; }
    var num = Number(m[2].replace(/,/g, ''));
    if (!isFinite(num)) { return null; }
    var decimals = m[2].indexOf('.') === -1 ? 0 : (m[2].length - m[2].indexOf('.') - 1);
    return { prefix: m[1], num: num, decimals: decimals, suffix: m[3] };
  }

  // ==================================================================
  // WOW layer (WS-WOW-BATCH, WOW_UPGRADES_2026-09-03) — WS5-SKELETON state
  // (2026-09-07): the DOM wiring for the deleted surfaces is RETIRED (the
  // tape re-roll + band settle with #stat-tape, the ledger delta flashes +
  // heartbeat + magnify sweep with the hero ledger, the flow-node writers
  // with #flow-diagram, the launch-flip beat). KEPT: the PURE helpers the
  // unit battery probes on WS.wow — tickGlyph / flowRateClass / simSharePct
  // / launchFlipShouldAnimate / depositsOpen — and the coverage stamp
  // (retargeted to the single relocated seam cell #fleet-coverage). Zero
  // new fetches, zero new hosts (D8); zero quantities recomputed.
  // ==================================================================

  // PURE: the sign glyph of a published-figure change ('▲' | '▼' | '–' | '').
  // Empty unless BOTH figures parse — a first fill is not a change.
  function tickGlyph(prev, next) {
    var a = splitStatFigure(prev || '');
    var b = splitStatFigure(next || '');
    if (!a || !b) { return ''; }
    if (b.num > a.num) { return '▲'; }
    if (b.num < a.num) { return '▼'; }
    return '–';
  }

  // G4 (UI_IMPROVE2_GLYPHS): the WOW-8 stamp grammar on the coverage seam —
  // the skeptic-facing cell names the read that verified it. Data-carrying
  // only (✓ + the read name), same .ledger-stamp anatomy. WS5-SKELETON
  // (2026-09-07): the seam is ONE relocated cell now (#fleet-coverage; the
  // #mint-backed / #inv-stat pair retired with the mint card + invariants).
  function stampCoverage() {
    [$('fleet-coverage')].forEach(function (c) {
      if (!c || !c.setAttribute) { return; }
      c.setAttribute('data-stamp', 'backingCoverage');
      if (c.classList) { c.classList.add('ledger-stamp'); }
    });
  }

  // PURE: flow-speed bucket from the PUBLISHED pool net rate (a ratio encoding
  // via class — never an APR rendered as a velocity number). Unknown → null
  // (paths render static: honest absence, never a fake pace). KEPT as a pinned
  // pure unit: its DOM consumer (the flow figure) is retired.
  function flowRateClass(ratePct) {
    if (ratePct === null || ratePct === undefined || !isFinite(ratePct) || ratePct <= 0) { return null; }
    if (ratePct >= 40) { return 'flow-rate-fast'; }
    if (ratePct >= 10) { return 'flow-rate-mid'; }
    return 'flow-rate-slow';
  }

  // ---- WOW-3 launch-flip: the one-time pending→live beat ----
  // PURE: fires ONLY on a real false→true transition, never pre-played, and
  // only when this browsing session has not seen the flip yet. KEPT as a
  // pinned pure unit: its DOM wiring (maybeLaunchFlip) is retired.
  function launchFlipShouldAnimate(prevDeployed, deployed, sessionSeen) {
    return deployed === true && prevDeployed === false && sessionSeen !== true;
  }

  /* WOW-6 SIM BEGIN — deposit simulator (WOW_UPGRADES_2026-09-03). Interaction-only
     path (no fetch): the ONLY math between these markers is the illustrative
     division of two quantities the page already displays — your size ÷ live pool
     TVL, the ratified formula's INPUT share. No APR pins, no yield recompute, no
     reference to the site's APR modules below this line — site-tests/wow.test.js
     enforces this source-slice gate forever. The projection region is filled
     OUTSIDE this block from the publish fan-out string verbatim (the writer
     function lives above) and never moves with the slider. */
  var simState = { size: 5000, tvlUsd: null };

  // PURE: the dilution INPUT as a percentage of live pool TVL (null when the
  // live read is absent — never a fabricated share).
  function simSharePct(sizeUsd, tvlUsd) {
    if (!(sizeUsd > 0) || tvlUsd === null || tvlUsd === undefined || !isFinite(tvlUsd) || !(tvlUsd > 0)) { return null; }
    return (sizeUsd / tvlUsd) * 100;
  }

  function renderSim() {
    var size = $('sim-size');
    if (size) { size.textContent = '$' + Math.round(simState.size).toLocaleString('en-US'); }
    var shareEl = $('sim-share');
    var bar = $('sim-bar-fill');
    var share = simSharePct(simState.size, simState.tvlUsd);
    if (shareEl) {
      shareEl.textContent = share === null
        ? 'pool TVL unavailable — the dilution bar will not invent a denominator'
        : (share < 0.01 ? '<0.01' : share.toFixed(2)) + '% of pool TVL';
    }
    if (bar) {
      bar.setAttribute('style', 'transform: scaleX(' + (share === null ? 0 : Math.min(1, share / 100)) + ')');
      if (share === null) { bar.setAttribute('data-empty', 'true'); }
      else if (bar.removeAttribute) { bar.removeAttribute('data-empty'); }
    }
  }

  function initDepositSim() {
    renderSim();
    var slider = $('sim-slider');
    if (!slider || typeof slider.addEventListener !== 'function') { return; }
    slider.addEventListener('input', function () {
      var v = Number(slider.value);
      simState.size = isFinite(v) && v > 0 ? v : simState.size;
      renderSim();
    });
  }
  /* WOW-6 SIM END */

  function setSimProjection(aprText) {
    var n = $('sim-projection');
    if (n && aprText) { n.textContent = aprText; }
  }

  // P1 (WS-PRODUCT-GAPS): PURE deposit-side gate — only a VERIFIED pause
  // (true) blocks the deposit side; an unknown read (null/undefined) never
  // does, and a disconnected wallet/pending deploy gates through inputsReady
  // as before. Redemptions never pass through this gate (never pausable).
  function depositsOpen(inputsReady, depositsPaused) {
    return !!inputsReady && depositsPaused !== true;
  }

  // Test seam: the honesty-critical helpers, pure and unit-battery-consumable.
  WS.wow = {
    tickGlyph: tickGlyph,
    flowRateClass: flowRateClass,
    simSharePct: simSharePct,
    launchFlipShouldAnimate: launchFlipShouldAnimate,
    depositsOpen: depositsOpen
  };

  function aprRow(apr) {
    if (!apr) { return row('Projected depositor APR', el('span', 'state', 'computing…'), 'card-row-strong'); }
    var frag = document.createDocumentFragment();
    frag.appendChild(el('strong', null, fmtPct(apr.depositorAprPct) + ' — ' + apr.label));
    return row('Projected depositor APR', frag, 'card-row-strong');
  }

  function aprInputRow(apr) {
    if (!apr || apr.poolNetAprPct == null) { return row('└ pool net fee APR (input, NOT the product yield)', '—'); }
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, fmtPct(apr.poolNetAprPct)));
    frag.appendChild(el('span', 'muted', ' · source: ' + (apr.sourceLabel || 'unknown')));
    return row('└ pool net fee APR (methodology input)', frag);
  }

  // STRATTON-LEDGER-CARD, WS5-SKELETON (2026-09-07): the coverage seam is now
  // ONE cell — #fleet-coverage, the single relocated line inside the flagship
  // fleet card's detail (the #mint-backed / #inv-stat pair retired with the
  // mint card and the invariants section). This is still the single fill point;
  // the PENDING_DEPLOY branch writes the wiring-truth string and NEVER issues
  // the eth_call (isDeployed gate inside WS.vault.readBackingCoverage); a
  // failed/undecodable live read renders "unavailable (RPC)" — never a
  // fabricated figure, never a non-deployment claim.
  var PENDING_COVERAGE_TEXT = 'awaiting address wiring — coverage goes live when the vault address is published';

  function fillBackingCoverage(client, vCfg) {
    var cells = [$('fleet-coverage')];
    // MONEY-GRAMMAR (2026-09-06, UI_IMPROVE2_MONEY-SURFACES #2): the verified
    // live decode is the ticket's one hot number — the coverage-live class
    // rides ONLY a successful read; pending wiring-truth and the unavailable
    // states keep the neutral cell. Stub-safe guard kept for the DOM stubs.
    function writeAll(t, live) {
      cells.forEach(function (c) {
        if (!c) { return; }
        c.textContent = t;
        if (c.classList && typeof c.classList.toggle === 'function') { c.classList.toggle('coverage-live', live === true); }
      });
    }
    if (!WS.vault.isDeployed(vCfg.vault)) { writeAll(PENDING_COVERAGE_TEXT); return; }
    if (!client) { writeAll('unavailable (RPC)'); return; }
    WS.vault.readBackingCoverage(client, vCfg.vault).then(function (raw) {
      var pct = raw === null ? null : WS.vault.formatCoveragePct(raw);
      if (pct === null) { writeAll('unavailable (RPC)'); } else { writeAll(pct, true); }
      // G4 (UI_IMPROVE2_GLYPHS): the stamp fires ONLY on a real successful read —
      // pending-wiring and unavailable states never wear the ✓.
      if (pct !== null) { stampCoverage(); }
    }).catch(function () {
      writeAll('unavailable (RPC)');
    });
  }

  // WS3-DEGRADED #1 (2026-09-06, UI_IMPROVE2_DEGRADED-STATES), rewired
  // WS5-SKELETON (2026-09-07): the vault's own share supply — 0n = no shares
  // minted = the empty state (isomorphic to the skill's pre-broadcast "returns
  // empty" rule) — now rides readVaultSnapshot's ONE-batch read (the goal's
  // named seam: the flagship fleet detail consumes WS.vault.readVaultSnapshot).
  // Honest null when the address is not deployed (the PENDING_DEPLOY branch
  // NEVER issues an eth_call — the gate is inside readVaultSnapshot) or the
  // decode is empty — never a claim.
  var EMPTY_VAULT_TAG = 'empty — 0 shares minted';

  async function readVaultSupply(client, vaultAddr) {
    var snap = await WS.vault.readVaultSnapshot(client, vaultAddr);
    return (snap && snap.deployed) ? (snap.totalSupply === undefined ? null : snap.totalSupply) : null;
  }

  async function loadVaultData(vaultCfg, mounts) {
    var client = state.client;
    if (!client) { return; }
    // WS-VAULT-FAMILY-GRID: the card loader is fully per-entry — the pool, the
    // Chainlink feed and the asset resolve through THIS config entry's keys, and
    // the hero-level shared surfaces (badge, state globals, coverage seam, hero
    // ledger, widget) are written only by the PRIMARY vault's pass.
    var primary = isPrimaryVault(vaultCfg);
    var poolCfg = poolCfgFor(vaultCfg);
    var feedCfg = feedCfgFor(vaultCfg);

    if (primary) {
      // chain identity badge (one page-level badge, primary-scoped)
      // SECTION-IMPROVE G1 #9 (2026-09-08): mismatch-only — fail-visible,
      // match-quiet. The old always-on match flag carried the page's chrome
      // amber dot (G1 #8 amber budget); a matching chain now renders nothing.
      // aria-live (markup) is kept: a mismatch announce still reaches AT.
      try {
        var chainIdHex = await client.call('eth_chainId', []);
        var okChain = Number.parseInt(chainIdHex, 16) === cfg.chain.id;
        var badge = $('chain-badge');
        if (badge) {
          badge.textContent = '';
          if (!okChain) {
            badge.appendChild(flagNode(false, 'chain ' + Number.parseInt(chainIdHex, 16) + ' — UNEXPECTED, expected 4663'));
          }
        }
      } catch (e) {
        var badge2 = $('chain-badge');
        if (badge2) { badge2.textContent = ''; badge2.appendChild(flagNode(false, 'RPC unreachable — values below show unavailable, never estimates')); }
      }
    }

    // underlying + pool + feed in one batch-ish pass (independent → parallel);
    // pool/feed resolve through the entry's own config keys. A missing key
    // degrades to the honest "unavailable (RPC)" rows — never a wrong-vault read.
    var underlyingP = WS.vault.readUnderlying(client, vaultCfg.asset).catch(function () { return null; });
    var poolP = poolCfg ? WS.vault.readPoolSnapshot(client, poolCfg).catch(function () { return null; }) : null;
    var priceP = feedCfg ? WS.vault.readPriceUsd(client, feedCfg, Date.now()).catch(function () { return null; }) : null;
    // P1 (WS-PRODUCT-GAPS): the deposit-pause read rides the SAME read pass —
    // an independent eth_call through the same client/failover, primary-scoped
    // (the widget speaks for the primary vault). Honest null on failure.
    var pauseP = primary ? WS.vault.readDepositsPaused(client, vaultCfg.vault).catch(function () { return null; }) : null;
    // WS-MULTI-VAULT-FRONTEND: the LIVE card's honest-APR source — the vault's own
    // YieldHarvested log count (no call at all for a PENDING_DEPLOY address).
    var harvestP = WS.vault.isDeployed(vaultCfg.vault)
      ? WS.vault.readHarvestCredits(client, vaultCfg.vault).catch(function () { return null; })
      : null;
    // WS3-DEGRADED #1: the share-supply read rides the SAME pass (independent
    // eth_call through the same client/failover). Honest null on failure.
    var supplyP = readVaultSupply(client, vaultCfg.vault).catch(function () { return null; });
    var u = await underlyingP;
    var pool = await poolP;
    var price = await priceP;
    var pause = pauseP ? await pauseP : null;
    // WS5-SKELETON (2026-09-07): the primary state fields land as soon as their
    // OWN reads resolve — never gated on the slowest read in the pass (the
    // snapshot-based supply read). The widget's pause gate renders from
    // state.depositsPaused the moment the read lands; holding it hostage to the
    // supply round-trip would race every connect-time widget render.
    if (primary) {
      state.pool = pool;
      state.depositsPaused = pause;
      state.underlyingState = u ? u.state : null;
    }
    var harvest = harvestP ? await harvestP : null;
    var supply = await supplyP;

    if (primary) {

      // STRATTON-LEDGER-CARD: the single shared fill point (#fleet-coverage) —
      // placed here so both the no-USD first paint and the live branch leave the
      // cell in the same state. Primary-scoped (the family fixture entry never
      // reaches this branch — the primary-scoping gate's teeth).
      fillBackingCoverage(client, vaultCfg);

      // WS5-SKELETON (2026-09-07): the hero ledger + chips are retired; the
      // sim's dilution leg takes the no-USD first paint here (the USD TVL lands
      // via deriveApr below).
      setSimTvlUsd(null);
    }

    mounts.rows.textContent = '';
    mounts.rows.appendChild(vaultStatusRow(vaultCfg));
    mounts.rows.appendChild(underlyingRow(u, vaultCfg));
    mounts.rows.appendChild(priceRow(price));
    mounts.rows.appendChild(poolRow(pool));
    mounts.rows.appendChild(cutRow(pool));
    // WS-MULTI-VAULT-FRONTEND: the honest-APR source row (live cards only —
    // a pending card never reaches this branch with a deployed read).
    mounts.rows.appendChild(harvestRow(harvest));
    mounts.rows.appendChild(aprRow(null)); // placeholder until derivation completes
    // WS3-DEGRADED #1: the verified share-supply row + the designed empty
    // register. totalSupply()==0n is a verified on-chain fact stated as
    // mechanism, not opportunity; a failed read renders the honest
    // "unavailable (RPC)" — never the claim. The empty tag + full-strength
    // keeper ride the vault-card--empty class, removed the moment shares exist.
    if (supply !== null && supply !== undefined) {
      mounts.rows.appendChild(row('Shares outstanding',
        supply === 0n ? '0 — the vault is empty; the first deposit mints the first shares'
                      : fmtToken(supply)));
    } else {
      mounts.rows.appendChild(row('Shares outstanding', 'unavailable (RPC)'));
    }
    if (mounts.card.classList) {
      if (supply === 0n) { mounts.card.classList.add('vault-card--empty'); }
      else { mounts.card.classList.remove('vault-card--empty'); }
    }
    var headEl = mounts.card.querySelector ? mounts.card.querySelector('.card-head') : null;
    if (headEl) {
      var emptyTag = headEl.querySelector ? headEl.querySelector('.card-empty-tag') : null;
      if (supply === 0n) {
        if (!emptyTag) { headEl.appendChild(el('span', 'card-empty-tag', EMPTY_VAULT_TAG)); }
      } else if (emptyTag && emptyTag.remove) { emptyTag.remove(); }
    }

    mounts.note.textContent = 'Everything above is read by your browser directly from public RPC nodes — no backend, no keys. ' +
      'The ' + vaultCfg.shareSymbol + ' token was created at deploy; shares are minted by the vault on deposit and burned on redeem.';

    // the deposit widget is the PRIMARY vault's surface (family-grid contract)
    if (primary) { renderWidgetState(); }

    // APR derivation (non-blocking, after first paint of the card)
    deriveApr(mounts, pool, price, vaultCfg);
  }

  async function deriveApr(mounts, pool, price, vCfg) {
    var pins = cfg.aprPins;
    var econ = cfg.economics;
    // WS-VAULT-FAMILY-GRID: each card derives from ITS OWN pool/price reads; the
    // published hero-level fan-out (chips, stat band, flow, sim, hero ledger) is
    // written only by the PRIMARY vault's derivation.
    var primary = isPrimaryVault(vCfg);

    function publish(apr, isBaseline) {
      if (primary) {
        state.apr = apr;
        // WS5-SKELETON (2026-09-07): the published projection's fan-out is now the
        // flagship fleet card's summary cell (#fleet-flagship-apr) + the sim's
        // static projection region — computed once, mirrored byte-for-byte,
        // label-only '' when absent. The chip / stat-band / flow surfaces are
        // retired with their sections; the fallback still labels itself through
        // the source row below (projBase.sourceLabel) — the WS3-DEGRADED #5
        // baseline-provenance markers rode the band + chip and are retired too.
        var aprText = apr.depositorAprPct != null ? '~' + fmtPct(apr.depositorAprPct, 1) : '';
        var fa = $('fleet-flagship-apr');
        if (fa) { fa.textContent = aprText; }
        setSimProjection(aprText);
      }
      var rows = mounts.rows;
      var strong = rows.querySelector('.card-row-strong');
      var prev = rows.querySelector('[data-apr-input]');
      if (prev) { prev.remove(); }
      var inputRow = aprInputRow(apr);
      inputRow.setAttribute('data-apr-input', 'true');
      if (strong) { rows.insertBefore(inputRow, strong); }
      else { rows.appendChild(inputRow); }
      if (strong) {
        strong.querySelector('.row-value').textContent = '';
        strong.querySelector('.row-value').appendChild(el('strong', null,
          (apr.depositorAprPct != null ? fmtPct(apr.depositorAprPct) : '—') + ' — ' + apr.label));
      }
      if (primary) { renderWidgetState(); }
    }

    // TVL in WETH units; USD value via the pool's own price and the Chainlink feed
    var tvlWeth = pool && pool.tvlToken0 ? pool.tvlToken0 : null;
    var spyUsd = price && price.usd ? price.usd : null;
    var priceP = pool && pool.priceToken1PerToken0 ? pool.priceToken1PerToken0 : null;
    var wethUsd = (spyUsd && priceP) ? priceP * spyUsd : null;
    var tvlUsd = (tvlWeth && wethUsd) ? tvlWeth * wethUsd : null;
    if (primary) {
      setSimTvlUsd(tvlUsd); // the sim's dilution leg consumes the pipeline's USD TVL (primary-scoped, WS5-SKELETON)
    }

    var live = null;
    if (tvlWeth && pool) {
      try {
        live = await WS.apr.samplePoolApr(state.client, cfg, pool, tvlWeth, {});
      } catch (e) {
        live = { ok: false, reason: 'sampling error: ' + (e && e.message ? e.message : 'unknown') };
      }
    }

    if (live && live.ok) {
      var projLive = WS.apr.projectDepositorApr(live.netAprPct, pins, econ);
      projLive.sourceLabel = 'live client-side sample of the last ' +
        Math.round((live.windowSeconds || 0) / 60) + 'min of Swap events (' + live.events + ' events), net of the live-decoded cut';
      projLive.inputs = { tvlWeth: tvlWeth, tvlUsd: tvlUsd, windowSeconds: live.windowSeconds, events: live.events };
      publish(projLive, false);
      return;
    }

    // Fallback: the clearly-labeled phase-0 measured baseline feeds the SAME formula.
    var base = cfg.aprMethodology.phase0Baseline;
    var projBase = WS.apr.projectDepositorApr(base.netAprPct, pins, econ);
    projBase.sourceLabel = 'phase-0 measured baseline (' + base.source + ') — live sampling unavailable' +
      (live && live.reason ? ' [' + live.reason + ']' : '');
    projBase.inputs = { tvlWeth: tvlWeth, tvlUsd: tvlUsd };
    publish(projBase, true);   // WS3-DEGRADED #5: the fallback reading labels itself on band + chip
  }

  // ------------------------------------------------------------------
  // 3. Deposit / redeem widget
  // ------------------------------------------------------------------

  // WS3-DEGRADED #8 (2026-09-06, UI_IMPROVE2_DEGRADED-STATES): optional third
  // class — the wallet-absent neutral register ('flag--info') renders muted,
  // distinct from the warn red; every other call site keeps the exact prior
  // classes (copy untouched).
  function widgetStatus(text, warn, cls) {
    var box = $('widget-status');
    if (!box) { return; }
    box.textContent = '';
    box.appendChild(el('span', warn ? 'flag flag-warn' : ('flag' + (cls ? ' ' + cls : '')), text));
  }

  // WS-VAULT-FAMILY-GRID: THE canonical primary-vault accessor — the primary-
  // vault-scoped surfaces (deposit widget, hero ledger/flow vault-state rows,
  // coverage fill, APR fan-out gating, token decimals) read the primary entry
  // through HERE. The launch-fact writer keeps its own goal-protected form
  // (pinned byte-exact by the wow + agent-first batteries); the CARDS render
  // from the full cfg.vaults[] loop with per-entry config resolution
  // (poolCfgFor / feedCfgFor / tokenCfgFor).
  function vaultCfg() { return cfg.vaults[0]; }

  function renderWidgetState() {
    var v = vaultCfg();
    var deployed = WS.vault.isDeployed(v.vault);
    state.vaultDeployed = deployed;
    // WS5-SKELETON (2026-09-07): the WOW-3 launch-flip wiring retired — the
    // beat had no reader after the ledger/tape surfaces died; the PURE gate
    // stays on WS.wow (pinned).

    var connectBtn = $('btn-connect');
    var amountInput = $('dep-amount');
    var approveBtn = $('btn-approve');
    var depositBtn = $('btn-deposit');
    var sharesInput = $('red-amount');
    var withdrawBtn = $('btn-withdraw');
    var redeemBtn = $('btn-redeem');
    var acquire = $('acquire-note');

    if (connectBtn) { connectBtn.textContent = state.wallet ? 'Connected: ' + fmtAddr(state.wallet.account) : 'Connect wallet'; }
    if (connectBtn) { connectBtn.disabled = !!state.wallet; }

    var hasWallet = !!state.wallet;
    var inputsReady = hasWallet && deployed;
    // P1 (WS-PRODUCT-GAPS): the vault's own pause flag closes ONLY the deposit
    // side (approve/deposit). Redemptions are never pausable — the redeem/
    // withdraw controls keep the wallet/deploy gates alone, so a paused vault
    // still renders live exits. Unknown pause (null) never blocks.
    var depositsReady = WS.wow.depositsOpen(inputsReady, state.depositsPaused);

    [amountInput, sharesInput].forEach(function (n) { if (n) { n.disabled = !inputsReady; } });
    [approveBtn, depositBtn].forEach(function (n) {
      if (n) {
        n.disabled = !depositsReady;
        n.title = !hasWallet ? 'Connect a wallet first.'
          : (!deployed ? 'Vault contract pending deploy.'
          : (state.depositsPaused === true ? 'Deposits are paused on the vault.' : ''));
      }
    });
    [withdrawBtn, redeemBtn].forEach(function (n) {
      if (n) {
        n.disabled = !inputsReady;
        n.title = !hasWallet ? 'Connect a wallet first.' : (!deployed ? 'Vault contract pending deploy.' : '');
      }
    });

    if (acquire) {
      // WS-VAULT-FAMILY-GRID: the widget speaks for the PRIMARY vault — token and
      // pool resolve through its config entry (never a hardcoded pool/token).
      var tCfg = tokenCfgFor(v.asset);
      var pCfg = poolCfgFor(v);
      acquire.textContent = deployed
        ? 'The vault accepts only ' + ((tCfg && tCfg.symbol) || 'the underlying token') + '. Acquire it via the tier-' +
          (pCfg && pCfg.feeTier != null ? pCfg.feeTier : '?') + ' ' + (pCfg ? pCfg.label : 'configured') +
          ' pool (SwapRouter02 ' + fmtAddr(cfg.contracts.swapRouter02) + ', quotes via QuoterV2) or bring your own.'
        : 'Deposit flows activate when the vault deploys. Until then nothing here takes money or approvals.';
    }

    if (!hasWallet) { widgetStatus('Not connected — connect a wallet to interact. Reads above still work without one.', false, 'flag--info'); }
    else if (!deployed) { widgetStatus('Vault contract is pending deploy — write flows stay disabled. This is not a claim screen; there is nothing to claim yet.', true); }
    else { widgetStatus('Connected on chain ' + state.wallet.chainId + '.', false); }
    appendWidgetTruthRows();

    if (hasWallet) { refreshBalances(); }
  }

  // P1 (WS-PRODUCT-GAPS): vault-state truth rows appended AFTER the base
  // status line — verified reads only (state.depositsPaused === true /
  // state.underlyingState === 'issuer-paused'); an unknown read renders no
  // row. The pause row states the pause and the redeem guarantee, never a
  // duration; the issuer row names the token's own on-chain pause flag.
  function appendWidgetTruthRows() {
    var box = $('widget-status');
    if (!box) { return; }
    if (state.depositsPaused === true) {
      box.appendChild(el('div', 'flag flag-warn', PAUSE_ROW));
      // WS3-DEGRADED #4 (2026-09-06, UI_IMPROVE2_DEGRADED-STATES): the pause
      // becomes a staged panel moment — a warn tag on the deposit panel head,
      // rendered ONLY on the verified pause and removed the moment the verified
      // read says otherwise (a stale pause tag would lie). The redeem side's
      // static no-pause guarantee tag lives in index.html (structural, not a
      // state read).
      var dh = $('deposit-panel-head');
      if (dh && !dh.querySelector('.panel-tag--warn')) {
        dh.appendChild(el('span', 'panel-tag panel-tag--warn', 'deposits paused'));
      }
    } else {
      var dh2 = $('deposit-panel-head');
      if (dh2) {
        var staleTag = dh2.querySelector('.panel-tag--warn');
        if (staleTag && staleTag.remove) { staleTag.remove(); }
      }
    }
    if (state.underlyingState === 'issuer-paused') {
      var tCfg = tokenCfgFor(vaultCfg().asset);
      box.appendChild(el('div', 'flag flag-warn',
        'The underlying token (' + ((tCfg && tCfg.symbol) || 'underlying') + ') is issuer-paused — token transfers may fail until the issuer lifts the pause.'));
    }
  }

  async function refreshBalances() {
    var v = vaultCfg();
    if (!state.wallet || !WS.vault.isDeployed(v.vault)) {
      var balBox = $('wallet-balances');
      if (balBox) { balBox.textContent = ''; }
      return;
    }
    try {
      var tBal = tokenCfgFor(v.asset);
      var bal = await WS.wallet.balanceOf(state.client, v.asset, state.wallet.account);
      var allow = await WS.wallet.allowance(state.client, v.asset, state.wallet.account, v.vault);
      // P2 (WS-PRODUCT-GAPS): the holder's own position — share balance + the
      // LIVE share price (convertToAssets(1e18)), one batched vault read. The
      // ≈ figure is the product of the two verified reads at the CURRENT share
      // price (BigInt floor division — never rounded up, never tied to the
      // projected APR); it renders only when the share decode landed.
      var pos = await WS.vault.readPosition(state.client, v.vault, state.wallet.account);
      var box = $('wallet-balances');
      if (box) {
        // MONEY-GRAMMAR (2026-09-06, UI_IMPROVE2_MONEY-SURFACES #3): the
        // holder's own money renders in the ledger-row anatomy — label
        // recedes, value leads. Same verified reads, re-chunked copy;
        // symbols resolve from the existing locals, never hardcoded; the
        // share-price qualifier keeps its verbatim form.
        box.textContent = '';
        box.appendChild(ledgerRow('Your ' + ((tBal && tBal.symbol) || 'underlying') + ' balance', fmtToken(bal)));
        box.appendChild(ledgerRow('Allowance to vault', fmtToken(allow)));
        if (pos && pos.sharesRaw !== null && pos.sharesRaw !== undefined) {
          box.appendChild(ledgerRow('Your ' + (v.shareSymbol || 'shares'),
            el('strong', null, fmtToken(pos.sharesRaw)),
            pos.assetsPerShareRaw ? 'ledger-row-strong' : ''));
          if (pos.assetsPerShareRaw !== null && pos.assetsPerShareRaw !== undefined) {
            var assetsRaw = (pos.sharesRaw * pos.assetsPerShareRaw) / 1000000000000000000n;
            box.appendChild(ledgerRow('≈ at the current share price.',
              fmtToken(assetsRaw) + ' ' + ((tBal && tBal.symbol) || 'underlying')));
          }
        }
      }
    } catch (e) {
      var box2 = $('wallet-balances');
      if (box2) { box2.textContent = 'Balance check failed (RPC): ' + (e && e.message ? e.message : 'unknown'); }
    }
  }

  // ---------------- wallet connect (eip-6963 aware) ----------------

  async function connectWallet() {
    var list = WS.wallet.discovered();
    if (list.length > 1) { showWalletPicker(list); return; }
    await connectUsing(list.length === 1 ? list[0] : null);
  }

  async function connectUsing(entry) {
    try {
      var res = await WS.wallet.connect(cfg, entry ? entry.provider : undefined);
      state.wallet = res;
      hideWalletPicker();
      widgetStatus('Connected ' + fmtAddr(res.account) +
        (entry && entry.info && entry.info.name ? ' via ' + entry.info.name : '') +
        ' on chain ' + res.chainId + '.', false);
      renderWidgetState();
    } catch (err) {
      var d = WS.wallet.describeError(err);
      widgetStatus('Connect failed: ' + d.message, true);
      renderWidgetState();
    }
  }

  function showWalletPicker(list) {
    var box = $('wallet-picker');
    if (!box) { connectUsing(list[0]); return; }
    box.hidden = false;
    box.textContent = '';
    box.appendChild(el('span', 'picker-label', 'Multiple wallets detected — choose one:'));
    list.forEach(function (entry) {
      var b = el('button', 'btn picker-btn', (entry.info && entry.info.name) || (entry.info && entry.info.rdns) || 'Wallet');
      b.type = 'button';
      b.addEventListener('click', function () { connectUsing(entry); });
      box.appendChild(b);
    });
  }

  function hideWalletPicker() {
    var box = $('wallet-picker');
    if (box) { box.hidden = true; box.textContent = ''; }
  }

  // ---------------- write flows ----------------

  function tokenDecimals() {
    // WS-VAULT-FAMILY-GRID: the PRIMARY vault's asset token resolves per entry;
    // no static entry (or no entry at all) → the chain-standard 18, never a crash.
    var v = vaultCfg();
    var t = v ? tokenCfgFor(v.asset) : null;
    return (t && t.decimals != null) ? t.decimals : 18;
  }

  // Exact string→BigInt parse (amount.js). Returns {ok, value, reason} — the
  // reason is written to be shown to the user as-is.
  function parseInput(id) {
    var n = $(id);
    return WS.amount.parseUnits(n ? n.value : '', tokenDecimals());
  }

  // A sent transaction is not a confirmed transaction. Polls for the receipt
  // through the site's own RPC client and reports the honest outcome.
  async function confirmTx(hash, label) {
    widgetStatus(label + ' sent — waiting for confirmation…', false);
    linkTx(hash);
    var receipt = null;
    try {
      receipt = await WS.wallet.waitForReceipt(state.client, hash, {});
    } catch (e) { /* polling failure falls through to the honest pending state */ }
    var outcome = WS.wallet.receiptOutcome(receipt);
    if (outcome === 'confirmed') {
      var block = receipt.blockNumber != null
        ? Number(BigInt(receipt.blockNumber)).toLocaleString('en-US') : '?';
      widgetStatus(label + ' confirmed in block ' + block + '.', false);
      linkTx(hash);
    } else if (outcome === 'reverted') {
      widgetStatus(label + ' REVERTED on-chain — no state changed. Do not retry blindly; check the reason in the explorer.', true);
      linkTx(hash);
    } else {
      widgetStatus(label + ' sent but not confirmed within the polling window — the explorer link shows the live status.', true);
      linkTx(hash);
    }
  }

  async function runFlow(kind) {
    var v = vaultCfg();
    if (!state.wallet) { widgetStatus('Connect a wallet first.', true); return; }
    if (!WS.vault.isDeployed(v.vault)) { widgetStatus('Vault pending deploy — this flow is intentionally disabled.', true); return; }
    flowPending = true;
    try {
      if (kind === 'approve') {
        var amtA = parseInput('dep-amount');
        if (!amtA.ok) { widgetStatus(amtA.reason, true); return; }
        if (amtA.value === 0n) { widgetStatus('Enter an amount greater than zero.', true); return; }
        widgetStatus('Waiting for wallet confirmation (approve)…', false);
        var h1 = await WS.wallet.approve(cfg, v.asset, v.vault, amtA.value);
        await confirmTx(h1, 'Approve');
      } else if (kind === 'deposit') {
        var amtD = parseInput('dep-amount');
        if (!amtD.ok) { widgetStatus(amtD.reason, true); return; }
        if (amtD.value === 0n) { widgetStatus('Enter an amount greater than zero.', true); return; }
        widgetStatus('Waiting for wallet confirmation (deposit)…', false);
        var h2 = await WS.wallet.deposit(cfg, v.vault, amtD.value, state.wallet.account);
        await confirmTx(h2, 'Deposit');
      } else if (kind === 'withdraw') {
        var amtW = parseInput('red-amount');
        if (!amtW.ok) { widgetStatus(amtW.reason, true); return; }
        if (amtW.value === 0n) { widgetStatus('Enter an amount greater than zero.', true); return; }
        widgetStatus('Waiting for wallet confirmation (withdraw)…', false);
        var h3 = await WS.wallet.withdraw(cfg, v.vault, amtW.value, state.wallet.account, state.wallet.account);
        await confirmTx(h3, 'Withdraw');
      } else if (kind === 'redeem') {
        var amtR = parseInput('red-amount');
        if (!amtR.ok) { widgetStatus(amtR.reason, true); return; }
        if (amtR.value === 0n) { widgetStatus('Enter an amount greater than zero.', true); return; }
        widgetStatus('Waiting for wallet confirmation (redeem)…', false);
        var h4 = await WS.wallet.redeem(cfg, v.vault, amtR.value, state.wallet.account, state.wallet.account);
        await confirmTx(h4, 'Redeem');
      }
    } catch (err) {
      var d = WS.wallet.describeError(err);
      widgetStatus('Failed: ' + d.message, true);
    } finally {
      flowPending = false;
      renderWidgetState();
    }
  }

  function linkTx(hash) {
    var box = $('widget-status');
    if (!box || !hash) { return; }
    var prev = box.querySelector('.tx-link');
    if (prev) { prev.remove(); }
    // G8 (UI_IMPROVE2_GLYPHS): ↗ marks the page's one off-site exit — the
    // explorer link — mirroring the → in-page forward grammar; glyph appended
    // AFTER the pinned string (the copy-goal pin is a substring and stays green).
    var a = el('a', 'tx-link', 'verify it on the explorer ↗');
    a.href = cfg.chain.explorerTx(hash);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    box.appendChild(a);
  }

  // ---------------- P3 (WS-PRODUCT-GAPS): redeem unit ownership + live preview ----------------
  // ERC-4626's classic trap: one shared input drives both redeem (shares) and
  // withdraw (underlying). The ACTIVE action's unit owns the label — the static
  // first paint carries the redeem default (the first button's unit); focusing
  // or pressing a redeem-side button hands the label to that action's unit and
  // re-prices the preview row for that action's semantics.
  var redeemAction = 'redeem';
  var previewTimer = null;
  var previewSeq = 0;

  function setRedeemAction(kind) {
    if (kind !== 'redeem' && kind !== 'withdraw') { return; }
    redeemAction = kind;
    var label = $('red-amount-label');
    if (label) {
      var sym = (tokenCfgFor(vaultCfg().asset) || {}).symbol || 'underlying';
      label.textContent = kind === 'withdraw' ? 'Amount (' + sym + ')' : 'Amount (shares)';
    }
    scheduleRedeemPreview();
  }

  function scheduleRedeemPreview() {
    if (typeof setTimeout !== 'function') { return; }
    if (previewTimer && typeof clearTimeout === 'function') { clearTimeout(previewTimer); }
    previewTimer = setTimeout(renderRedeemPreview, 350);
    if (typeof previewTimer.unref === 'function') { previewTimer.unref(); }
  }

  // ONE vault preview eth_call per debounced input, priced by the vault's own
  // view for the ACTIVE action's unit. The row states the current rate and the
  // chain's final pricing — never a receive-promise. Honest states:
  // cleared when the input is empty/invalid or the vault is undeployed, and
  // "unavailable (RPC)" when the read fails — never a fabricated figure. A
  // sequence guard keeps a slow stale response from overwriting a newer one.
  async function renderRedeemPreview() {
    var out = $('redeem-preview');
    if (!out) { return; }
    var v = vaultCfg();
    var parsed = parseInput('red-amount');
    if (!WS.vault.isDeployed(v.vault) || !parsed.ok || parsed.value === 0n) { out.textContent = ''; return; }
    var seq = ++previewSeq;
    var sym = (tokenCfgFor(v.asset) || {}).symbol || 'underlying';
    var shareSym = v.shareSymbol || 'shares';
    try {
      var text;
      if (redeemAction === 'withdraw') {
        var shares = await WS.vault.previewWithdraw(state.client, v.vault, parsed.value);
        if (seq !== previewSeq) { return; }
        text = shares === null ? 'Preview unavailable (RPC).'
          : '≈ ' + fmtToken(shares) + ' ' + shareSym + ' at the current rate — the chain prices the final amount.';
      } else {
        var assets = await WS.vault.previewRedeem(state.client, v.vault, parsed.value);
        if (seq !== previewSeq) { return; }
        text = assets === null ? 'Preview unavailable (RPC).'
          : '≈ ' + fmtToken(assets) + ' ' + sym + ' out at the current rate — the chain prices the final amount.';
      }
      out.textContent = text;
    } catch (e) {
      if (seq !== previewSeq) { return; }
      out.textContent = 'Preview unavailable (RPC).';
    }
  }

  // ------------------------------------------------------------------
  // 4. Docs tab
  // ------------------------------------------------------------------

  function initDocs() {
    var tabMount = $('doc-tabs');
    var pane = $('doc-pane');
    if (!tabMount || !pane) { return; }
    // deep link: '#doc-<docId>-<slug>' loads THAT doc (stub-safe hash read);
    // buildTabs' click handler stays the only writer of tab activation state —
    // we delegate by clicking the matched tab.
    var h = (typeof location !== 'undefined') ? location.hash : '';
    var target = WS.docs.docFromHash(cfg, h);
    var onLoaded = target ? function (doc) {
      if (doc && doc.id === target.id) {
        var t = document.getElementById(h.slice(1));
        if (t && typeof t.scrollIntoView === 'function') { t.scrollIntoView(); }
      }
    } : null;
    WS.docs.buildTabs(cfg, tabMount, pane, onLoaded);
    if (target) {
      var btn = tabMount.querySelector('.doc-tab[data-doc-id="' + target.id + '"]');
      if (btn && typeof btn.click === 'function') { btn.click(); return; }
    }
    var first = cfg.docs.index[0];
    if (first) { WS.docs.loadDoc(cfg, first, pane); }
  }

  // ---------------- flagship disclosure opener (G3 SECTION-IMPROVE, 2026-09-08) ----------------
  // #deposit lives INSIDE the flagship <details class="fleet-card--flagship"> —
  // while the card is closed the section has no box, so the nav 'Deposit' anchor
  // and a raw #deposit hash both dead-end (no scroll, and the scrollspy can never
  // see the section to highlight it). Every navigation path opens any closed
  // <details> ancestor FIRST, then lets the scroll happen: anchor clicks (capture
  // phase — before the browser's default fragment scroll), hashchange, and the
  // load-time hash. Widget ids and the summary's own toggle are untouched — this
  // only ever OPENS a closed ancestor, never closes an open one.
  function openAncestorDetails(node) {
    var opened = false;
    var d = node;
    while (d && d !== document.body) {
      if (d.nodeName === 'DETAILS' && !d.open) { d.open = true; opened = true; }
      d = d.parentNode;
    }
    return opened;
  }
  function initDisclosureNav() {
    if (typeof document === 'undefined' || !document.addEventListener) { return; }
    document.addEventListener('click', function (ev) {
      var a = ev.target && ev.target.closest ? ev.target.closest('a[href^="#"]') : null;
      if (!a) { return; }
      var id = (a.getAttribute('href') || '').slice(1);
      if (!id) { return; }
      var t = document.getElementById(id);
      if (t) { openAncestorDetails(t); } // opens BEFORE the default fragment scroll runs
    }, true);
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('hashchange', function () {
        var id = (location.hash || '').slice(1);
        var t = id && document.getElementById(id);
        // rescroll only when WE opened something — the browser's own fragment
        // scroll already ran (and missed the hidden box) before hashchange fired
        if (t && openAncestorDetails(t) && typeof t.scrollIntoView === 'function') { t.scrollIntoView(); }
      });
    }
    var h = (typeof location !== 'undefined') ? location.hash : '';
    if (h && h.length > 1) {
      var lt = document.getElementById(h.slice(1));
      if (lt && openAncestorDetails(lt) && typeof lt.scrollIntoView === 'function') {
        lt.scrollIntoView(); // the load-time fragment scroll already missed the hidden box — retarget now
      }
    }
  }

  // ---------------- header scrollspy (R2): one .active anchor max ----------------

  function initScrollSpy() {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) { return; }
    var sections = ['fleet', 'deposit', 'docs'].map(function (id) { return $(id); }).filter(Boolean);
    if (!sections.length) { return; }
    var io = new IntersectionObserver(function (entries) {
      // deepest section reached wins — adjacent sections co-intersect the band
      // during a ~40px scroll window, so entry order is never trusted
      var deepest = null;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].isIntersecting) {
          var sec = entries[i].target;
          if (!deepest || sec.offsetTop > deepest.offsetTop) { deepest = sec; }
        }
      }
      var anchors = document.body.querySelectorAll('.site-nav a:not(.nav-cta)');
      for (var a = 0; a < anchors.length; a++) { anchors[a].classList.remove('active'); }
      if (deepest) {
        for (var b = 0; b < anchors.length; b++) {
          if (anchors[b].getAttribute('href') === '#' + deepest.id) { anchors[b].classList.add('active'); }
        }
      }
    }, { rootMargin: '-40% 0px -55% 0px', threshold: 0 });
    sections.forEach(function (sec) { io.observe(sec); });
  }

  // ---------------- header tape strip (WS3-HEADER P4, 2026-09-06) ----------------
  // The identity band under the header. Rows are written from cfg.vaultFamily —
  // the SAME config array the family cards read — and each row's state rides the
  // SAME isDeployed seam those cards use: a live tier reads LAUNCH_FACT.deployed,
  // a gated tier reads LAUNCH_FACT.pendingShort (single-sourced launch facts —
  // no new literals, no figures, zero live reads, zero fetches). The static
  // first paint carries structural facts only; NULL-GUARDED so DOM stubs and
  // absent markup are a clean no-op.
  function initTapeStrip() {
    if (typeof document === 'undefined' || !document.querySelector) { return; }
    var host = document.querySelector('.tape-strip .wrap');
    if (!host || !Array.isArray(cfg.vaultFamily)) { return; }
    var meta = host.querySelector('.tape-strip-meta');
    function put(node) { if (meta) { host.insertBefore(node, meta); } else { host.appendChild(node); } }
    cfg.vaultFamily.forEach(function (f) {
      if (!f || !f.shareSymbol) { return; }
      var live = WS.vault.isDeployed(f.vault);
      var item = el('span', 'tape-strip-entry' + (live ? '' : ' tape-strip-entry--gated'));
      item.appendChild(el('span', 'tape-strip-sym', f.shareSymbol));
      if (f.tierLabel) { item.appendChild(el('span', 'tape-strip-tier', f.tierLabel)); }
      item.appendChild(el('span', 'tape-strip-state', live ? LAUNCH_FACT.deployed : LAUNCH_FACT.pendingShort));
      put(item);
    });
    var chainItem = el('span', 'tape-strip-entry tape-strip-meta');
    chainItem.appendChild(el('span', 'tape-strip-tier', cfg.chain.name + ' ' + cfg.chain.id));
    put(chainItem);
  }

  // ---------------- scroll reveal (R3 IMP-3) ----------------
  // One reveal primitive: static section heads + the flagship vault card
  // fade-up 12px once at --t-slow when they enter the viewport. Armed ONLY
  // here (the .ws-reveal class is added by this function) — no-JS and
  // no-IntersectionObserver environments never see the hidden state, so the
  // static page renders fully visible exactly as before. Reduced motion is
  // handled in CSS: the global guard nullifies the transition, so the class
  // swap is an instant appear. Opacity/translate only — the reveal cannot
  // restate or mask content.
  // WS5-SKELETON (2026-09-07): the hero ENTRANCE arming (the ws-entrance
  // class + the role→delay map — half its armed surfaces were the deleted
  // hero ledger/mint-card/facts), the hero-ledger rows cascade and the
  // apr-footnote/stat-band/flow-figure panel targets are retired with their
  // surfaces. The reveal itself stays.
  function initReveal() {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) { return; }
    var targets = [];
    var heads = document.body.querySelectorAll('.block-head');
    for (var i = 0; i < heads.length; i++) { targets.push(heads[i]); }
    for (var c = 0; c < cards.length; c++) { targets.push(cards[c].mounts.card); }
    // The sim survives inside the relocated deposit block — its reveal arms
    // with the section heads (it fires when the flagship card is opened).
    var panels = document.body.querySelectorAll('.apr-sim');
    for (var p = 0; p < panels.length; p++) { targets.push(panels[p]); }
    if (!targets.length) { return; }
    var io = new IntersectionObserver(function (entries) {
      for (var k = 0; k < entries.length; k++) {
        if (entries[k].isIntersecting && entries[k].target.classList) {
          entries[k].target.classList.add('ws-reveal-in');
          entries[k].target.classList.add('scroll-reveal-in');
          io.unobserve(entries[k].target);
        }
      }
    }, { threshold: 0.15 });
    for (var t = 0; t < targets.length; t++) {
      if (targets[t].classList) { targets[t].classList.add('ws-reveal'); io.observe(targets[t]); }
    }
  }

  // WS-DARK-DOTO (2026-09-07): the curve-divider draw-on (initAssetDraw) is
  // RETIRED with the zero-image identity — no asset surfaces remain to arm,
  // and the page's one-motion budget stays the ledger stamp alone.

  // ------------------------------------------------------------------
  // WS5-SKELETON (2026-09-07) / FLEET-UI-V2 G1 (2026-09-07): the Fleet feed
  // render — movement (a)'s ONE live hero stat stays here; movement (b)'s
  // book column renders through WS.fleetTable (js/fleet-table.js): the
  // FLEET_UI_V2_WAVE_2026-09-07.md §1 terminal table + mobile card stack +
  // detail sheet + filter chips. The v1 grouped-card renderer (its group
  // table, card node and wipe function) is RETIRED with its mount — the
  // wipe-safety invariant carries over UNCHANGED: the render mounts
  // (#fleet-tbody / #fleet-cards, children of the §1 surface) host NO static
  // content, ever; the flagship fleet card (the deposit widget, the coverage
  // seam, the vault reads) remains a SIBLING that precedes them. FAIL-CLOSED
  // everywhere: a missing module, fetch failure, invalid payload or absent
  // figures render the designed unavailable state ('—') — never a fake zero,
  // never a fabricated count. One-shot on load: no re-roll interval (the
  // tape's era ends here); the feed is a file. Guarded on WS.fleet /
  // WS.fleetTable so the render-stub cohorts (which load neither module)
  // boot cleanly into the unavailable state.
  // ------------------------------------------------------------------
  function renderHeroStat() {
    var num = $('hero-stat-num');
    var label = $('hero-stat-label');
    if (!num || !label) { return; }
    var win = $('hero-stat-window');
    // SECTION-IMPROVE G1 #6 (2026-09-08): the unavailable register rides a
    // JS-toggled class (index.html carries it statically for the no-JS paint) —
    // the old :has(:empty) detector would match forever now that the window
    // span is never written.
    var stat = $('hero-stat');
    var summary = WS.fleet ? WS.fleet.summary() : null;
    if (!summary) {
      num.textContent = '—';
      label.textContent = 'books measured — unavailable (feed)';
      if (win) { win.textContent = ''; } // NEVER written — the raw provenance window string stays in the fleet surface tooltip/detail
      if (stat && stat.classList) { stat.classList.add('hero-stat--unavailable'); }
      return;
    }
    if (stat && stat.classList) { stat.classList.remove('hero-stat--unavailable'); }
    num.textContent = String(summary.books);
    label.textContent = 'books measured — ' + summary.paysLps + ' pay LPs · ' +
      summary.hookMonetized + ' pay nothing';
    // SECTION-IMPROVE G1 #6: the raw provenance window ("05 win key …") retired
    // from this surface — it stays verbatim in the fleet surface tooltip/detail.
    if (win) { win.textContent = ''; }
  }

  function initFleet() {
    renderHeroStat();
    if (typeof WS.fleet === 'object' && WS.fleet && typeof WS.fleet.load === 'function') {
      WS.fleet.load(function () { renderHeroStat(); });
    }
    // FLEET-UI-V2 G1: the v2 surface self-registers its own WS.fleet.load
    // call (alongside this one — fleet.js is untouched) and renders the
    // table, cards, sheet and filters from rows(); with the module absent
    // it renders the designed unavailable state itself, never a gap.
    if (typeof WS.fleetTable === 'object' && WS.fleetTable && typeof WS.fleetTable.init === 'function') {
      WS.fleetTable.init();
    }
  }

  // ------------------------------------------------------------------
  // init
  // ------------------------------------------------------------------

  function init() {
    // year stamp
    var y = $('footer-year');
    if (y) { y.textContent = String(new Date().getFullYear()); }

    // WS5-SKELETON (2026-09-07): the connecting-state chip block retired with
    // the hero ledger; the apr-footnote fill retired with the #vaults section
    // (the methodology footnote's content survives in the APR source rows and
    // the docs).

    // WOW-6 deposit simulator: static regions render once (the projection region
    // stays '—' until the publish fan-out fills it verbatim).
    initDepositSim();

    // honesty lines
    var tm = $('trademark-note');
    if (tm) { tm.textContent = cfg.branding.trademarkNote; }
    var wc = $('widget-chain');
    if (wc) { wc.textContent = 'expects chain ' + cfg.chain.id + ' (' + cfg.chain.name + ')'; }

    // LAUNCH-FACT-RECONCILE: the launch-fact span is state-driven off the SAME
    // isDeployed seam the cards/ledger/flow read (the static first paint in
    // index.html carries the same prose for noscript users). NULL-GUARDED —
    // the wow-battery DOM stub returns null for every id; init() must not throw.
    // WS5-SKELETON (2026-09-07): the span RELOCATED into the #fleet intro line
    // (same id, byte-identical text, same writer form — the single-sourcing
    // guard stays green).
    var n = $('vaults-launch-fact');
    if (n) { n.textContent = WS.vault.isDeployed(cfg.vaults[0].vault) ? LAUNCH_FACT.proseDeployed : LAUNCH_FACT.prosePending; }

    // rpc client (retry + failover per the CORS-find mitigation)
    state.client = WS.rpc.createRpcClient({
      endpoints: cfg.rpc.endpoints,
      attemptsPerEndpoint: cfg.rpc.attemptsPerEndpoint,
      backoffBaseMs: cfg.rpc.backoffBaseMs,
      backoffCapMs: cfg.rpc.backoffCapMs,
      timeoutMs: cfg.rpc.timeoutMs,
      batchMaxCalls: cfg.rpc.batchMaxCalls
    });

    // eip-6963 multi-wallet discovery (best-effort; legacy window.ethereum fallback)
    WS.wallet.startDiscovery();

    // WS5-SKELETON (2026-09-07): the flagship vault card renders INTO the fleet
    // section — the static flagship fleet card's detail hosts it (#fleet-vault-
    // reads), alongside the deposit widget and the coverage line. The vault-grid
    // loop and the gated family cards are retired (the DEPLOY-GATED family
    // truth survives as the #fleet intro line; the header tape strip still
    // renders the family roster). One card, the primary, through THE canonical
    // accessor — no per-entry loop anymore. The READ CYCLE starts regardless of
    // the mount: the widget's state gates (depositsPaused, underlying state)
    // consume these reads even where the card shell has no mount (the
    // widget-pause stub cohort registers the widget ids, not the fleet ids).
    var mounts = renderCardShell(vaultCfg());
    mounts.rows.appendChild(row('Status', el('span', 'state', 'connecting to public RPC…')));
    var readsMount = $('fleet-vault-reads');
    if (readsMount) { readsMount.appendChild(mounts.card); }
    cards.push({ vaultCfg: vaultCfg(), mounts: mounts });
    refreshCards();
    startTimers();

    // widget wiring
    var connectBtn = $('btn-connect');
    if (connectBtn) { connectBtn.addEventListener('click', connectWallet); }
    var map = { 'btn-approve': 'approve', 'btn-deposit': 'deposit', 'btn-withdraw': 'withdraw', 'btn-redeem': 'redeem' };
    Object.keys(map).forEach(function (id) {
      var b = $(id);
      if (b) { b.addEventListener('click', function () { runFlow(map[id]); }); }
    });

    // P3 (WS-PRODUCT-GAPS): the shared redeem input's unit follows the active
    // action (focus or press on a redeem-side button), and the input re-prices
    // the live preview row as it is typed.
    var btnRedeem = $('btn-redeem');
    var btnWithdraw = $('btn-withdraw');
    if (btnRedeem && btnRedeem.addEventListener) {
      btnRedeem.addEventListener('focus', function () { setRedeemAction('redeem'); });
      btnRedeem.addEventListener('click', function () { setRedeemAction('redeem'); });
    }
    if (btnWithdraw && btnWithdraw.addEventListener) {
      btnWithdraw.addEventListener('focus', function () { setRedeemAction('withdraw'); });
      btnWithdraw.addEventListener('click', function () { setRedeemAction('withdraw'); });
    }
    var redInput = $('red-amount');
    if (redInput && redInput.addEventListener) { redInput.addEventListener('input', scheduleRedeemPreview); }

    if (WS.wallet.isAvailable()) {
      WS.wallet.onAccountsChanged(function () { state.wallet = null; renderWidgetState(); });
      WS.wallet.onChainChanged(function () { state.wallet = null; renderWidgetState(); });
    }

    renderWidgetState();

    initDocs();
    initDisclosureNav();  // G3 SECTION-IMPROVE: open the flagship disclosure before any #deposit navigation
    initScrollSpy();
    initTapeStrip();  // WS3-HEADER P4: writes the header tape strip's family rows from config
    initReveal();   // R3 IMP-3: after the cards render — arms .ws-reveal on section heads + the flagship card
    initFleet();  // WS5-SKELETON: the Fleet feed render (movement a's hero-stat + movement b's book column)

    // WS-ASSET-WIRE: the agent-first section's skill link ships pointing at the
    // relative repository path; it upgrades to the published repository URL the
    // moment cfg.branding.repoUrl lands (it is PENDING_IDENTITY until identity
    // ops — the static relative href is the honest placeholder, never a
    // fabricated URL, mirroring the pending-address convention).
    var skillLink = $('agents-skill-link');
    if (skillLink && skillLink.setAttribute) {
      var repoUrl = cfg.branding && cfg.branding.repoUrl;
      if (typeof repoUrl === 'string' && repoUrl.indexOf('https://') === 0) {
        skillLink.setAttribute('href', repoUrl.replace(/\/+$/, '') + '/skills/wellstreet-vaults/SKILL.md');
        skillLink.setAttribute('target', '_blank');
        skillLink.setAttribute('rel', 'noopener');
      }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
