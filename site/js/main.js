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
  var LAUNCH_FACT = { pendingShort: 'awaiting on-chain deploy', pending: 'awaiting on-chain deploy — yield phase not started', deployed: 'deployed — yield phase live', prosePending: 'The vault is not yet on-chain — factory, timelock, harvester and vault land on Robinhood Chain; these cards read the pending state until then.', proseDeployed: 'The vault is on-chain — four contracts on Robinhood Chain, verifiable at the exact addresses these cards read.' };

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
  function fmtUsd(v) {
    if (v === null || v === undefined || !isFinite(v)) { return '—'; }
    return '$' + v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
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
    lastUpdated: null,   // timestamp of the last successful card refresh
    snap: null,          // {priceUsd, tvlWeth} — this cycle's snapshot (diffed for the tape's tick glyphs)
    prevDeployed: undefined // previous isDeployed reading (WOW-3 launch-flip key)
  };

  var cards = [];        // {vaultCfg, mounts} — refreshed on the live-refresh loop

  // ------------------------------------------------------------------
  // Live refresh (A1): the page claims "live on-chain reads" — that must stay
  // true over time, not only at load. Data refreshes every 60s (public-RPC
  // polite, visibility-gated, paused while a wallet flow is in flight); the
  // age stamp updates every 5s. Timers are unref'd so node --test exits.
  // ------------------------------------------------------------------
  var REFRESH_MS = 60000;
  var STAMP_MS = 5000;
  var flowPending = false;

  function anyVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  function updateStamp() {
    var n = $('vaults-updated');
    if (!n) { return; }
    if (!state.lastUpdated) { n.textContent = 'live on-chain reads — first load…'; return; }
    n.textContent = 'live on-chain reads · updated ' +
      fmtAge(Math.max(0, Math.round((Date.now() - state.lastUpdated) / 1000)));
  }

  async function refreshCards() {
    if (flowPending || !anyVisible() || !state.client) { return; }
    // WS-ASSET-WIRE: the magnify-hand sweeps once while THIS re-read is in
    // flight (the same per-cycle trigger family as the WOW-8 ledger stamp).
    sweepMagnifier();
    var prevSnap = state.snap ? { priceUsd: state.snap.priceUsd, tvlWeth: state.snap.tvlWeth } : null;
    for (var i = 0; i < cards.length; i++) {
      await loadVaultData(cards[i].vaultCfg, cards[i].mounts);
    }
    state.lastUpdated = Date.now();
    updateStamp();
    // WOW-7 chain-pulse: the stamp pulses once per successful cycle and dims
    // when the cycle's pool read failed (a dimmed heartbeat reads "not live",
    // never broken). First cycle is a real cycle — the heartbeat may fire;
    // the DELTA flashes below are the path that must skip the first render.
    pulseStamp(!!state.pool);
  }

  function startTimers() {
    var stamp = setInterval(updateStamp, STAMP_MS);
    var refresh = setInterval(refreshCards, REFRESH_MS);
    if (stamp && typeof stamp.unref === 'function') { stamp.unref(); }
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
    // WS-ASSET-WIRE: the share-certificate keeper marks the pending/empty card
    // (decorative: aria-hidden; self-hosted relative path; styled in the
    // stylesheet against .vault-card--pending).
    // re-pinned 2026-09-04: config flipped to deployed addresses — the keeper rides
    // the live card too (the deployed vault is empty; the empty card is its state).
    var cert = el('img', 'asset-certificate');
    cert.setAttribute('src', 'img/certificate.png');
    cert.setAttribute('alt', '');
    cert.setAttribute('aria-hidden', 'true');
    cert.setAttribute('loading', 'lazy');
    card.appendChild(cert);
    var rows = el('div', 'card-rows');
    card.appendChild(rows);
    var note = el('p', 'card-note');
    card.appendChild(note);
    return { card: card, rows: rows, note: note };
  }

  function underlyingRow(u) {
    if (!u) { return row('Underlying', 'unavailable (RPC)'); }
    var label = (u.symbol || '?') + ' — ' + (cfg.tokens.spy.label);
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, label));
    frag.appendChild(el('span', 'muted', '  ·  ' + (u.state === 'active' ? 'not paused' : u.state === 'unknown' ? 'pause state unknown' : u.state)));
    return row('Underlying (live)', frag);
  }

  function priceRow(price) {
    if (!price) { return row('Underlying price', 'unavailable (feed)'); }
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, '$' + price.usd.toFixed(2)));
    frag.appendChild(el('span', 'muted', '  ·  ' + price.label + ' (Chainlink) · ' + fmtAge(price.ageSeconds) +
      (price.stale ? ' · equity feeds update 24/5 — weekend/holiday staleness is expected' : '')));
    return row('Underlying price (live)', frag);
  }

  function poolRow(pool) {
    if (!pool) { return row('Pool', 'unavailable (RPC)'); }
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, pool.label));
    frag.appendChild(el('span', 'muted', '  ·  TVL ' + (pool.tvlToken0 ? pool.tvlToken0.toFixed(2) + ' WETH' : '—') +
      '  ·  fee tier ' + (pool.feeTier != null ? pool.feeTier / 1e4 + '%' : '—') +
      '  ·  ' + fmtAddr(pool.address)));
    return row('Fee pool (live)', frag);
  }

  function cutRow(pool) {
    if (!pool || !pool.cut) { return row('Protocol cut (pool owner)', 'unavailable'); }
    var c = pool.cut;
    var frag = document.createDocumentFragment();
    frag.appendChild(el('span', null, (c.cutFraction * 100).toFixed(0) + '% of swap fees per side (live slot0: (' +
      c.token0N + ',' + c.token1N + ')) — LPs keep ' + (c.netMultiplier * 100).toFixed(0) + '%'));
    if (c.note) { frag.appendChild(el('span', 'muted', '  ·  ' + c.note)); }
    return row('Pool protocol cut (live)', frag);
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
  // Hero live ledger (WS-HERO-V9): a compact editorial-ledger panel under
  // the hero lede. It CONSUMES the vault-card pipeline's already-fetched
  // snapshots (pool slot0 / balances / Chainlink feed — the same
  // config.rpc.endpoints, batching and failover; no new RPC calls, no new
  // hosts, D8) and degrades row-by-row exactly like the cards: honest
  // "unavailable (RPC)" states, never fabricated numbers. The USD TVL
  // figure is the one deriveApr already derives — passed in, not recomputed.
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

  function renderLedger(pool, price, tvlUsd) {
    var rowsBox = $('hero-ledger-rows');
    if (!rowsBox) { return; }
    var chip = $('hero-ledger-state');
    if (chip) {
      chip.className = 'hero-ledger-state ' + (pool ? 'flag flag-ok' : 'flag flag-warn');
      chip.textContent = pool ? 'live · chain ' + cfg.chain.id
        : 'rpc unreachable — honest states shown, never estimates';
    }
    rowsBox.textContent = '';

    // 1. SPY / WETH price, live from the pool's own slot0 (token0 = WETH,
    //    token1 = SPY, so the decoded pool price is SPY-per-WETH; SPY quoted
    //    in WETH is its reciprocal).
    var spyWeth = pool && pool.priceToken1PerToken0 && pool.priceToken1PerToken0 > 0
      ? 1 / pool.priceToken1PerToken0 : null;
    var rPrice = ledgerRow('SPY / WETH (pool slot0)',
      spyWeth ? el('strong', null, spyWeth.toFixed(4) + ' WETH')
              : el('span', 'state', 'unavailable (RPC)'));
    rowsBox.appendChild(rPrice);
    if (spyWeth) { stampRow(rPrice, 'slot0'); }   // WOW-8: names the read that verified

    // 2. Pool TVL — the same live tvlToken0 figure the vault cards show
    //    (WETH units), with the pipeline's USD derivation when it has landed.
    var tvlNode = document.createDocumentFragment();
    if (pool && pool.tvlToken0) {
      tvlNode.appendChild(el('strong', null, pool.tvlToken0.toFixed(2) + ' WETH'));
      if (tvlUsd !== null && tvlUsd !== undefined && isFinite(tvlUsd)) {
        tvlNode.appendChild(el('span', 'muted', '  ·  ≈ ' + fmtUsd(tvlUsd)));
      }
    } else {
      tvlNode.appendChild(el('span', 'state', 'unavailable (RPC)'));
    }
    var rTvl = ledgerRow('Pool TVL (live)', tvlNode);
    rowsBox.appendChild(rTvl);
    if (pool && pool.tvlToken0) { stampRow(rTvl, 'balances'); }

    // 3. Protocol cut — decoded LIVE from slot0's feeProtocol word (the same
    //    decode the cards render; consumed, not re-fetched).
    var cutNode;
    if (pool && pool.cut) {
      var c = pool.cut;
      var cf = document.createDocumentFragment();
      cf.appendChild(el('span', null, (c.cutFraction * 100).toFixed(0) + '% of swap fees per side'));
      cf.appendChild(el('span', 'muted', '  ·  slot0 (' + c.token0N + ',' + c.token1N + ') — LPs keep ' + (c.netMultiplier * 100).toFixed(0) + '%'));
      cutNode = cf;
    } else {
      cutNode = el('span', 'state', 'unavailable (RPC)');
    }
    var rCut = ledgerRow('Pool protocol cut (live)', cutNode);
    rowsBox.appendChild(rCut);
    if (pool && pool.cut) { stampRow(rCut, 'slot0'); }

    // WOW-7 chain-pulse: one-beat delta flashes on rows whose published value
    // changed since the previous cycle (first render never flashes).
    applyLedgerDeltas(rowsBox, {
      spyWeth: spyWeth,
      tvl: pool && pool.tvlToken0 ? pool.tvlToken0 : null,
      cut: pool && pool.cut ? pool.cut.cutFraction : null
    });

    // WOW-2 money-flow: the figure's nodes consume the same snapshot (no new reads).
    setFlowPool(pool);
    setFlowVaultState(WS.vault.isDeployed(vaultCfg().vault));

    // 4. Vault state — the honest pending pipeline (never a fake number).
    //    (R3 IMP-4 fact dedup: the ledger's static fee-split row was removed —
    //    it duplicated the hero-fact pill verbatim. The split's canonical
    //    verbal statement lives in the hero-facts row; the stat band keeps
    //    its terse 90/10 + chain display cell.)
    rowsBox.appendChild(ledgerRow('Vault state',
      WS.vault.isDeployed(vaultCfg().vault)
        ? flagNode(true, LAUNCH_FACT.deployed)
        : flagNode(false, LAUNCH_FACT.pending),
      'ledger-row-strong'));

    // Hero chips (WS-HERO-CHIPS-V10): decorative duplicates of the rows above.
    renderChipsLive(price, tvlUsd);
  }

  // ------------------------------------------------------------------
  // Hero chips (WS-HERO-CHIPS-V10): ens.domains-style scatter around the
  // hero, carrying REAL figures from the same pipeline snapshots the
  // ledger consumes — no new RPC calls, no new fetch hosts (D8). Live
  // chips degrade to label-only form (value span left empty) when a read
  // fails; the static chips render unconditionally in index.html. The
  // container is aria-hidden there: every chip figure is a decorative
  // duplicate of a value the ledger/cards already expose. The value
  // spans carry static ids (chip-price / chip-tvl / chip-apr) registered
  // in the render test's static-ID registry.
  // ------------------------------------------------------------------
  function setChipValue(id, text) {
    var n = $(id);
    if (!n) { return; }
    n.textContent = text || '';
  }

  function renderChipsLive(price, tvlUsd) {
    // SPY USD price — the Chainlink feed read this same pass already made
    // (the pool's slot0 ratio itself stays in the ledger row above).
    // Each figure is computed ONCE and written to BOTH the chip and the stats
    // band (WSV-STATS-REAL-FOOTER) — the band's value spans mirror the chips
    // byte-for-byte, same fill semantics ('' when absent), same published value.
    var priceText = price && price.usd != null && isFinite(price.usd)
      ? '$' + price.usd.toFixed(2) : '';
    // Pool TVL in USD — the derivation deriveApr already computes and hands
    // to the ledger (tvlWeth x pool-derived WETH price); no recompute here.
    var tvlText = tvlUsd !== null && tvlUsd !== undefined && isFinite(tvlUsd)
      ? fmtUsd(tvlUsd) : '';
    setChipValue('chip-price', priceText);
    setChipValue('chip-tvl', tvlText);
    setStatValue('stat-price', priceText);
    setStatValue('stat-tvl', tvlText);
    // WOW-6 sim: the dilution bar's live-TV leg is this same published USD TVL
    // (consumed, never recomputed); the sim block re-renders its honest states.
    simState.tvlUsd = (tvlUsd !== null && tvlUsd !== undefined && isFinite(tvlUsd)) ? tvlUsd : null;
    renderSim();
  }

  // ------------------------------------------------------------------
  // Stats band (WSV-STATS-REAL-FOOTER): a 4-cell count-up band under the
  // hero carrying REAL pipeline figures. Three of the four cells are filled
  // through the SAME snapshot flow as the hero chips (renderChipsLive above
  // for SPY USD price + pool TVL in USD; publish() inside deriveApr for the
  // published depositor APR projection) — the stat-* value spans mirror the
  // chip-* spans byte-for-byte. The fourth cell (90/10 + chain) is a ratified
  // economic constant rendered ONCE at init from cfg.economics/cfg.chain.id
  // and never animated: counting it up would imply a live reading that does
  // not exist. Degrade honestly: when a read fails the value span stays ''
  // — never 0-as-fake. The reveal path needs IntersectionObserver +
  // requestAnimationFrame + matchMedia; when ANY of the three is unavailable
  // (the render-test stub ships none of them) or prefers-reduced-motion
  // matches, finals are written synchronously via textContent and the path
  // never throws. The easing fn is exposed pure as WS.stats.easeOutCubic
  // (same namespaced-seam pattern as WS.rpc / WS.wallet).
  // ------------------------------------------------------------------
  var STAT_IDS = ['stat-tvl', 'stat-price', 'stat-apr'];   // animated three ONLY
  var STAT_ANIM_BASE_MS = 1500;
  var STAT_ANIM_STEP_MS = 80;
  var STAT_STAGGER_BASE_MS = 480;
  var STAT_STAGGER_STEP_MS = 90;
  var statState = {};   // id -> { value, revealed }

  function statsCanAnimate() {
    if (typeof window === 'undefined') { return false; }
    if (typeof window.IntersectionObserver !== 'function') { return false; }
    if (typeof window.requestAnimationFrame !== 'function') { return false; }
    if (typeof window.matchMedia !== 'function') { return false; }
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { return false; }
    } catch (e) { return false; }
    return true;
  }

  function setStatValue(id, text) {
    var n = $(id);
    if (!n) { return; }
    var st = statState[id] || (statState[id] = { value: '', revealed: false });
    var prev = st.value;
    st.value = text || '';
    // Guard path (no IO/rAF/matchMedia, reduced motion, or already revealed):
    // write the final figure synchronously — the honest value or '', never 0.
    if (!statsCanAnimate() || st.revealed) { n.textContent = st.value; }
    // WOW-1 tape: on a REVEALED live cell whose published value CHANGED between
    // refreshes, re-roll the digits and blink a ▲/▼/– delta tick. The published
    // projection cell (stat-apr) and the ratified-constant split cell are NOT in
    // TAPE_TICK_IDS — excluded from the re-roll forever (a tick would imply a
    // live reading that does not exist).
    if (st.revealed && TAPE_TICK_IDS[id] && text !== prev && statsCanAnimate()) {
      animateStat(id, STAT_IDS.indexOf(id));
      showTapeTick(id, prev, text);
      pulseBandSettle();
    }
  }

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

  function fmtStatNumber(num, decimals) {
    return num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  }

  // ONE count-up reveal path. Runs once per stat (reveal marks all three
  // revealed, so later 60s refreshes write finals directly via setStatValue).
  function animateStat(id, idx) {
    var n = $(id);
    var st = statState[id];
    if (!n || !st) { return; }
    var fig = splitStatFigure(st.value);
    if (!fig) { n.textContent = st.value; return; }   // nothing countable: final as-is
    var dur = STAT_ANIM_BASE_MS + idx * STAT_ANIM_STEP_MS;
    var delay = STAT_STAGGER_BASE_MS + idx * STAT_STAGGER_STEP_MS;
    var start = null;
    function frame(now) {
      if (start === null) { start = now + delay; }
      var t = (now - start) / dur;
      if (t < 0) { t = 0; }
      if (t >= 1) { n.textContent = st.value; return; }   // final byte-for-byte
      n.textContent = fig.prefix + fmtStatNumber(fig.num * easeOutCubic(t), fig.decimals) + fig.suffix;
      window.requestAnimationFrame(frame);
    }
    window.requestAnimationFrame(frame);
  }

  function armStatsReveal() {
    if (!statsCanAnimate()) { return; }   // guard path: setStatValue already wrote finals
    var band = document.body.querySelector('.stat-band');
    if (!band) { return; }
    var fired = false;
    var io = new IntersectionObserver(function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (!entries[i].isIntersecting || fired) { continue; }
        fired = true;                    // once
        io.disconnect();
        for (var k = 0; k < STAT_IDS.length; k++) {
          var st = statState[STAT_IDS[k]] || (statState[STAT_IDS[k]] = { value: '', revealed: false });
          st.revealed = true;
        }
        for (var j = 0; j < STAT_IDS.length; j++) { animateStat(STAT_IDS[j], j); }
      }
    }, { threshold: 0.25 });
    io.observe(band);
  }

  // ==================================================================
  // WOW layer (WS-WOW-BATCH, WOW_UPGRADES_2026-09-03) — eight packages,
  // one diff-driven voice. Every effect consumes the EXISTING snapshot
  // fan-out (state.snap / statState / publish()) — zero new fetches,
  // zero new hosts (D8); zero quantities recomputed. Pure helpers are
  // exposed as WS.wow for the unit battery (same namespaced-seam
  // pattern as WS.stats).
  // ==================================================================

  // ---- WOW-1 tape: the two LIVE cells only (projection + split excluded) ----
  var TAPE_TICK_IDS = { 'stat-tvl': 'stat-tick-tvl', 'stat-price': 'stat-tick-price' };
  var tapeTimers = {};
  var bandSettleTimer = null;

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

  function showTapeTick(id, prev, next) {
    var tick = $(TAPE_TICK_IDS[id]);
    if (!tick) { return; }
    var glyph = tickGlyph(prev, next);
    tick.textContent = glyph;
    tick.className = 'stat-tick' + (glyph === '▲' ? ' stat-tick--up' : glyph === '▼' ? ' stat-tick--down' : glyph === '–' ? ' stat-tick--flat' : '');
    if (typeof setTimeout !== 'function') { return; }
    if (tapeTimers[id] && typeof clearTimeout === 'function') { clearTimeout(tapeTimers[id]); }
    tapeTimers[id] = setTimeout(function () { tick.textContent = ''; }, 1200);
    if (typeof tapeTimers[id].unref === 'function') { tapeTimers[id].unref(); }
  }

  // One soft settle-pulse of the band per changed cycle (class remove/re-add
  // restarts the CSS animation).
  function pulseBandSettle() {
    var band = document.body.querySelector('.stat-band');
    if (!band || !band.classList || typeof setTimeout !== 'function') { return; }
    band.classList.remove('stat-band--settle');
    if (bandSettleTimer && typeof clearTimeout === 'function') { clearTimeout(bandSettleTimer); }
    bandSettleTimer = setTimeout(function () { band.classList.add('stat-band--settle'); }, 30);
    if (typeof bandSettleTimer.unref === 'function') { bandSettleTimer.unref(); }
  }

  // ---- shared motion gate: the accepted matchMedia guard form (STUB RIDER) ----
  function motionAllowed() {
    if (typeof window === 'undefined') { return false; }
    if (typeof window.matchMedia === 'function') {
      try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches !== true;
      } catch (e) { return false; }
    }
    return false;   // no matchMedia (the render-test stub cohort): no motion
  }

  // ---- WOW-7 chain-pulse: delta classes on the ledger rows + stamp heartbeat ----
  var prevLedgerSnap = null;
  var stampTimer = null;

  // Diff-driven, first-render-safe: prevLedgerSnap === null on the first render
  // → no classes (no fake "change" on load). Rows are rebuilt every cycle, so
  // the one-shot animation plays on fresh elements only.
  function applyLedgerDeltas(rowsBox, snap) {
    var rows = rowsBox.children || [];
    var prev = prevLedgerSnap;
    prevLedgerSnap = { spyWeth: snap.spyWeth, tvl: snap.tvl, cut: snap.cut };
    if (!prev || !rows.length) { return; }
    var pairs = [['spyWeth', rows[0]], ['tvl', rows[1]], ['cut', rows[2]]];
    for (var i = 0; i < pairs.length; i++) {
      var rowEl = pairs[i][1];
      if (!rowEl || !rowEl.classList) { continue; }
      var p = prev[pairs[i][0]];
      var v = snap[pairs[i][0]];
      if (p === null || p === undefined || v === null || v === undefined) { continue; }
      rowEl.classList.remove('delta-up', 'delta-down');
      if (v > p) { rowEl.classList.add('delta-up'); }
      else if (v < p) { rowEl.classList.add('delta-down'); }
    }
  }

  function pulseStamp(ok) {
    var n = $('vaults-updated');
    if (!n || !n.classList || typeof setTimeout !== 'function') { return; }
    n.classList.remove('heartbeat', 'heartbeat-dim');
    if (stampTimer && typeof clearTimeout === 'function') { clearTimeout(stampTimer); }
    stampTimer = setTimeout(function () { n.classList.add(ok ? 'heartbeat' : 'heartbeat-dim'); }, 30);
    if (typeof stampTimer.unref === 'function') { stampTimer.unref(); }
  }

  // ---- WS-ASSET-WIRE: the magnify-hand sweeps once while a vault re-read is in
  // flight — hooked to the SAME per-cycle refresh trigger as the WOW-7 heartbeat,
  // never to a value: a sweep is a "checking" gesture, not a signal about the
  // data. Gated by the shared motionAllowed() matchMedia guard (reduced motion =
  // static asset) and null-safe under every DOM stub. Re-trigger pattern mirrors
  // pulseStamp (remove, re-add on a tick so the one-shot animation can replay). ----
  var sweepTimer = null;
  function sweepMagnifier() {
    var n = $('asset-magnify');
    if (!n || !n.classList || !motionAllowed() || typeof setTimeout !== 'function') { return; }
    n.classList.remove('asset-sweep');
    if (sweepTimer && typeof clearTimeout === 'function') { clearTimeout(sweepTimer); }
    sweepTimer = setTimeout(function () { n.classList.add('asset-sweep'); }, 30);
    if (typeof sweepTimer.unref === 'function') { sweepTimer.unref(); }
  }

  // ---- WOW-8 ledger stamp: the value cell names the read that verified ----
  function stampRow(rowEl, readName) {
    if (!rowEl) { return; }
    var v = rowEl.querySelector ? rowEl.querySelector('.ledger-v') : null;
    var t = v || rowEl;
    if (!t.setAttribute) { return; }
    t.setAttribute('data-stamp', readName);
    if (t.classList) { t.classList.add('ledger-stamp'); }
  }

  // ---- WOW-2 money-flow: HTML nodes bound to the published pipeline reads ----
  // PURE: flow-speed bucket from the PUBLISHED pool net rate (a ratio encoding
  // via class — never an APR rendered as a velocity number). Unknown → null
  // (paths render static: honest absence, never a fake pace).
  function flowRateClass(ratePct) {
    if (ratePct === null || ratePct === undefined || !isFinite(ratePct) || ratePct <= 0) { return null; }
    if (ratePct >= 40) { return 'flow-rate-fast'; }
    if (ratePct >= 10) { return 'flow-rate-mid'; }
    return 'flow-rate-slow';
  }

  function setFlowRate(ratePct) {
    var fig = document.body.querySelector('.flow-figure');
    if (!fig || !fig.classList) { return; }
    fig.classList.remove('flow-rate-fast', 'flow-rate-mid', 'flow-rate-slow');
    var cls = flowRateClass(ratePct);
    if (cls) { fig.classList.add(cls); }
  }

  function setFlowPool(pool) {
    var tvl = $('flow-pool-tvl');
    if (tvl) { tvl.textContent = pool && pool.tvlToken0 ? pool.tvlToken0.toFixed(2) + ' WETH' : 'unavailable (RPC)'; }
    var cut = $('flow-cut');
    if (cut) {
      cut.textContent = pool && pool.cut
        ? 'protocol cut ' + (pool.cut.cutFraction * 100).toFixed(0) + '% per side (live slot0 (' + pool.cut.token0N + ',' + pool.cut.token1N + '))'
        : 'protocol cut — unavailable (RPC)';
    }
  }

  function setFlowVaultState(deployed) {
    var node = document.body.querySelector('.flow-node--vault');
    if (node && node.classList) {
      node.classList.remove('flow-node--schematic', 'flow-node--live');
      node.classList.add(deployed ? 'flow-node--live' : 'flow-node--schematic');
    }
    var fig = document.body.querySelector('.flow-figure');
    if (fig && fig.classList) {
      if (deployed) { fig.classList.add('flow-live'); } else { fig.classList.remove('flow-live'); }
    }
    var v = $('flow-vault-state');
    if (v) {
      v.textContent = deployed
        ? LAUNCH_FACT.deployed
        : LAUNCH_FACT.pending;
    }
  }

  function setFlowYield(text) {
    var n = $('flow-yield');
    if (n) { n.textContent = text || ''; }
  }

  // ---- WOW-3 launch-flip: the one-time pending→live beat ----
  // PURE: fires ONLY on a real false→true transition, never pre-played, and
  // only when this browsing session has not seen the flip yet.
  function launchFlipShouldAnimate(prevDeployed, deployed, sessionSeen) {
    return deployed === true && prevDeployed === false && sessionSeen !== true;
  }

  var launchFlipPlayed = false;

  function maybeLaunchFlip(deployed) {
    var prev = state.prevDeployed;
    state.prevDeployed = deployed;
    if (launchFlipPlayed || prev === undefined) { return; }
    var seen = false;
    try {
      if (typeof sessionStorage !== 'undefined') {
        seen = sessionStorage.getItem('ws-launch-flip') === '1';
      }
    } catch (e) { seen = false; }   // sessionless browsers: the flag guard degrades, never throws
    if (!launchFlipShouldAnimate(prev, deployed, seen)) { return; }
    launchFlipPlayed = true;
    try {
      if (typeof sessionStorage !== 'undefined') { sessionStorage.setItem('ws-launch-flip', '1'); }
    } catch (e2) { /* storage refused: the flip still plays this page-view only */ }
    if (typeof document !== 'undefined' && document.body && document.body.classList) {
      document.body.classList.add('launch-flip');
    }
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
        ? 'pool TVL unavailable — the dilution input needs the live read'
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

  // Test seam: the honesty-critical helpers, pure and unit-battery-consumable.
  WS.wow = {
    tickGlyph: tickGlyph,
    flowRateClass: flowRateClass,
    simSharePct: simSharePct,
    launchFlipShouldAnimate: launchFlipShouldAnimate
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
    frag.appendChild(el('span', 'muted', '  ·  source: ' + (apr.sourceLabel || 'unknown')));
    return row('└ pool net fee APR (methodology input)', frag);
  }

  // STRATTON-LEDGER-CARD: the mint-card BACKED row and the invariants-section live
  // stat are ONE seam — this single fill point writes the IDENTICAL string into both
  // cells (mirroring the stat-apr===chip-apr precedent). The PENDING_DEPLOY branch
  // writes the wiring-truth string and NEVER issues the eth_call (isDeployed gate
  // inside WS.vault.readBackingCoverage); a failed/undecodable live read renders
  // "unavailable (RPC)" — never a fabricated figure, never a non-deployment claim.
  var PENDING_COVERAGE_TEXT = 'awaiting address wiring — coverage goes live when the vault address is published';

  function fillBackingCoverage(client, vCfg) {
    var cells = [$('mint-backed'), $('inv-stat')];
    function writeAll(t) {
      cells.forEach(function (c) { if (c) { c.textContent = t; } });
    }
    if (!WS.vault.isDeployed(vCfg.vault)) { writeAll(PENDING_COVERAGE_TEXT); return; }
    if (!client) { writeAll('unavailable (RPC)'); return; }
    WS.vault.readBackingCoverage(client, vCfg.vault).then(function (raw) {
      var pct = raw === null ? null : WS.vault.formatCoveragePct(raw);
      writeAll(pct === null ? 'unavailable (RPC)' : pct);
    }).catch(function () {
      writeAll('unavailable (RPC)');
    });
  }

  async function loadVaultData(vaultCfg, mounts) {
    var client = state.client;
    if (!client) { return; }

    // chain identity badge
    try {
      var chainIdHex = await client.call('eth_chainId', []);
      var okChain = Number.parseInt(chainIdHex, 16) === cfg.chain.id;
      var badge = $('chain-badge');
      if (badge) {
        badge.textContent = '';
        badge.appendChild(flagNode(okChain, 'chain ' + Number.parseInt(chainIdHex, 16) + (okChain ? ' (expected 4663)' : ' — UNEXPECTED, expected 4663')));
      }
    } catch (e) {
      var badge2 = $('chain-badge');
      if (badge2) { badge2.textContent = ''; badge2.appendChild(flagNode(false, 'RPC unreachable — values below show unavailable, never estimates')); }
    }

    // underlying + pool + feed in one batch-ish pass (independent → parallel)
    var underlyingP = WS.vault.readUnderlying(client, vaultCfg.asset).catch(function () { return null; });
    var poolP = WS.vault.readPoolSnapshot(client, cfg.pools.spyWeth500).catch(function () { return null; });
    var priceP = WS.vault.readPriceUsd(client, cfg.priceFeeds.spyUsd, Date.now()).catch(function () { return null; });
    var u = await underlyingP;
    var pool = await poolP;
    var price = await priceP;

    state.pool = pool;
    // diff snapshot: the live quantities the tape's tick glyphs react to (refreshCards prevSnap).
    state.snap = {
      priceUsd: price && price.usd != null && isFinite(price.usd) ? price.usd : null,
      tvlWeth: pool && pool.tvlToken0 ? pool.tvlToken0 : null
    };

    // STRATTON-LEDGER-CARD: single shared fill point for #mint-backed + #inv-stat —
    // placed BEFORE the renderLedger branch split so both the no-USD first paint and
    // the live branch leave the two cells identical.
    fillBackingCoverage(client, vaultCfg);

    // hero ledger (WS-HERO-V9): first paint from the same snapshot the cards
    // just rendered; the USD TVL lands via deriveApr below.
    renderLedger(pool, price, null);

    mounts.rows.textContent = '';
    mounts.rows.appendChild(vaultStatusRow(vaultCfg));
    mounts.rows.appendChild(underlyingRow(u));
    mounts.rows.appendChild(priceRow(price));
    mounts.rows.appendChild(poolRow(pool));
    mounts.rows.appendChild(cutRow(pool));
    mounts.rows.appendChild(aprRow(null)); // placeholder until derivation completes

    mounts.note.textContent = 'Everything above is read by your browser directly from public RPC nodes — no backend, no keys. ' +
      'Share tokens (' + vaultCfg.shareSymbol + ') are issued by the vault at deploy.';

    renderWidgetState();

    // APR derivation (non-blocking, after first paint of the card)
    deriveApr(mounts, pool, price);
  }

  async function deriveApr(mounts, pool, price) {
    var pins = cfg.aprPins;
    var econ = cfg.economics;

    function publish(apr) {
      state.apr = apr;
      // V10 chip + WSV-STATS-REAL-FOOTER band: the published projection's
      // depositor figure, computed once, mirrored byte-for-byte in both
      // (label-only '' when absent).
      var aprText = apr.depositorAprPct != null ? '~' + fmtPct(apr.depositorAprPct, 1) : '';
      setChipValue('chip-apr', aprText);
      setStatValue('stat-apr', aprText);
      // WOW-2/WOW-6: the flow diagram's terminal label and the sim's static
      // projection region consume the SAME published string byte-for-byte —
      // never recomputed, never spectacularized.
      setFlowYield(aprText);
      setSimProjection(aprText);
      // WOW-2: the dash-flow pace buckets from the PUBLISHED pool net rate.
      setFlowRate(apr.poolNetAprPct);
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
      renderWidgetState();
    }

    // TVL in WETH units; USD value via the pool's own price and the Chainlink feed
    var tvlWeth = pool && pool.tvlToken0 ? pool.tvlToken0 : null;
    var spyUsd = price && price.usd ? price.usd : null;
    var priceP = pool && pool.priceToken1PerToken0 ? pool.priceToken1PerToken0 : null;
    var wethUsd = (spyUsd && priceP) ? priceP * spyUsd : null;
    var tvlUsd = (tvlWeth && wethUsd) ? tvlWeth * wethUsd : null;
    renderLedger(pool, price, tvlUsd); // hero ledger consumes the pipeline's USD TVL

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
      publish(projLive);
      return;
    }

    // Fallback: the clearly-labeled phase-0 measured baseline feeds the SAME formula.
    var base = cfg.aprMethodology.phase0Baseline;
    var projBase = WS.apr.projectDepositorApr(base.netAprPct, pins, econ);
    projBase.sourceLabel = 'phase-0 measured baseline (' + base.source + ') — live sampling unavailable' +
      (live && live.reason ? ' [' + live.reason + ']' : '');
    projBase.inputs = { tvlWeth: tvlWeth, tvlUsd: tvlUsd };
    publish(projBase);
  }

  // ------------------------------------------------------------------
  // 3. Deposit / redeem widget
  // ------------------------------------------------------------------

  function widgetStatus(text, warn) {
    var box = $('widget-status');
    if (!box) { return; }
    box.textContent = '';
    box.appendChild(el('span', warn ? 'flag flag-warn' : 'flag', text));
  }

  function vaultCfg() { return cfg.vaults[0]; }

  function renderWidgetState() {
    var v = vaultCfg();
    var deployed = WS.vault.isDeployed(v.vault);
    state.vaultDeployed = deployed;
    // WOW-3 launch-flip: keyed STRICTLY off the real isDeployed seam — the
    // pending→live choreography fires only on a genuine false→true transition
    // observed while the page is open (never simulated, never pre-played).
    maybeLaunchFlip(deployed);

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

    [amountInput, sharesInput].forEach(function (n) { if (n) { n.disabled = !inputsReady; } });
    [approveBtn, depositBtn, withdrawBtn, redeemBtn].forEach(function (n) {
      if (n) {
        n.disabled = !inputsReady;
        n.title = !hasWallet ? 'Connect a wallet first.' : (!deployed ? 'Vault contract pending deploy.' : '');
      }
    });

    if (acquire) {
      acquire.textContent = deployed
        ? 'The vault accepts only ' + (cfg.tokens.spy.symbol || 'SPY') + '. Acquire it via the tier-500 ' + cfg.pools.spyWeth500.label +
          ' pool (SwapRouter02 ' + fmtAddr(cfg.contracts.swapRouter02) + ', quotes via QuoterV2) or bring your own.'
        : 'Deposit flows activate when the vault deploys. Until then nothing here takes money or approvals.';
    }

    if (!hasWallet) { widgetStatus('Not connected — connect a wallet to interact. Reads above still work without one.', false); }
    else if (!deployed) { widgetStatus('Vault contract is pending deploy — write flows stay disabled. This is not a claim screen; there is nothing to claim yet.', true); }
    else { widgetStatus('Connected on chain ' + state.wallet.chainId + '.', false); }

    if (hasWallet) { refreshBalances(); }
  }

  async function refreshBalances() {
    var v = vaultCfg();
    if (!state.wallet || !WS.vault.isDeployed(v.vault)) {
      var balBox = $('wallet-balances');
      if (balBox) { balBox.textContent = ''; }
      return;
    }
    try {
      var bal = await WS.wallet.balanceOf(state.client, v.asset, state.wallet.account);
      var allow = await WS.wallet.allowance(state.client, v.asset, state.wallet.account, v.vault);
      var box = $('wallet-balances');
      if (box) {
        box.textContent = '';
        box.appendChild(el('span', null, 'Your ' + (cfg.tokens.spy.symbol || 'SPY') + ' balance: ' + fmtToken(bal) +
          ' · allowance to vault: ' + fmtToken(allow)));
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
    var t = cfg.tokens && cfg.tokens.spy;
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
    var a = el('a', 'tx-link', 'view on explorer');
    a.href = cfg.chain.explorerTx(hash);
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    box.appendChild(a);
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

  // ---------------- header scrollspy (R2): one .active anchor max ----------------

  function initScrollSpy() {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) { return; }
    var sections = ['vaults', 'deposit', 'docs'].map(function (id) { return $(id); }).filter(Boolean);
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

  // ---------------- scroll reveal (R3 IMP-3) ----------------
  // One reveal primitive: static section heads + vault cards fade-up 12px once
  // at --t-slow when they enter the viewport. Armed ONLY here (the .ws-reveal
  // class is added by this function) — no-JS and no-IntersectionObserver
  // environments never see the hidden state, so the static page renders fully
  // visible exactly as before. Reduced motion is handled in CSS: the global
  // guard nullifies the transition, so the class swap is an instant appear.
  // Opacity/translate only — the reveal cannot restate or mask content.
  function initReveal() {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) { return; }
    var targets = [];
    var heads = document.body.querySelectorAll('.block-head');
    for (var i = 0; i < heads.length; i++) { targets.push(heads[i]); }
    for (var c = 0; c < cards.length; c++) { targets.push(cards[c].mounts.card); }
    // WOW-5 scroll choreography (ADDITIVE-ONLY): broaden the armed coverage to
    // the remaining panels — the band, the flow figure, the sim, the footnote.
    // No section restructure, no copy edits: the reveal only re-times what the
    // static page already shows, and the classes are added HERE (by JS) so
    // no-JS and no-IO environments never see a hidden state.
    var panels = document.body.querySelectorAll('.stat-band, .flow-figure, .apr-sim');
    for (var p = 0; p < panels.length; p++) { targets.push(panels[p]); }
    var footnote = $('apr-footnote');
    if (footnote) { targets.push(footnote); }
    // The hero ledger's rows settle in a top-to-bottom cascade on first view
    // (its own class + per-row stagger tokens in the stylesheet).
    var ledgerRows = $('hero-ledger-rows');
    if (ledgerRows && ledgerRows.classList) { ledgerRows.classList.add('scroll-reveal'); }
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

  // ---------------- asset draw-on (WS-ASSET-WIRE) ----------------
  // The curve-stroke divider reveals left-to-right on scroll-in (clip-path
  // transition — the ink-laid-down feel on real dither pixels). Armed ONLY here
  // (the .asset-draw-arm class is added by this function), so no-JS and
  // no-IntersectionObserver environments always see the full static stroke.
  // Reduced motion: the stylesheet's no-preference gating + reduce block make
  // the armed state a no-op — the asset stays static and fully visible.
  function initAssetDraw() {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) { return; }
    var curves = document.body.querySelectorAll('.asset-draw');
    if (!curves.length) { return; }
    var io = new IntersectionObserver(function (entries) {
      for (var k = 0; k < entries.length; k++) {
        if (entries[k].isIntersecting && entries[k].target.classList) {
          entries[k].target.classList.add('asset-draw-in');
          entries[k].target.classList.remove('asset-draw-arm');
          io.unobserve(entries[k].target);
        }
      }
    }, { threshold: 0.25 });
    for (var t = 0; t < curves.length; t++) {
      if (curves[t].classList) { curves[t].classList.add('asset-draw-arm'); io.observe(curves[t]); }
    }
  }

  // ------------------------------------------------------------------
  // init
  // ------------------------------------------------------------------

  function init() {
    // year stamp
    var y = $('footer-year');
    if (y) { y.textContent = String(new Date().getFullYear()); }

    // WOW-7: the ledger's state chip breathes while connecting; renderLedger's
    // first real state write replaces the class wholesale — the chip goes still.
    var chip = $('hero-ledger-state');
    if (chip && chip.classList) { chip.classList.add('is-connecting'); }

    // WOW-6 deposit simulator: static regions render once (the projection region
    // stays '—' until the publish fan-out fills it verbatim).
    initDepositSim();

    // honesty lines
    var tm = $('trademark-note');
    if (tm) { tm.textContent = cfg.branding.trademarkNote; }
    var fn = $('apr-footnote-text');
    if (fn) { fn.textContent = WS.apr.METHODOLOGY_FOOTNOTE; }
    var wc = $('widget-chain');
    if (wc) { wc.textContent = 'expects chain ' + cfg.chain.id + ' (' + cfg.chain.name + ')'; }

    // LAUNCH-FACT-RECONCILE: the launch-fact span is state-driven off the SAME
    // isDeployed seam the cards/ledger/flow read (the static first paint in
    // index.html carries the same prose for noscript users). NULL-GUARDED —
    // the wow-battery DOM stub returns null for every id; init() must not throw.
    var n = $('vaults-launch-fact');
    if (n) { n.textContent = WS.vault.isDeployed(cfg.vaults[0].vault) ? LAUNCH_FACT.proseDeployed : LAUNCH_FACT.prosePending; }

    // stats band (WSV-STATS-REAL-FOOTER): the 90/10 + chain cell is a ratified
    // economic constant — final value rendered ONCE from config (never
    // hardcoded), never animated; a count-up would imply a live reading that
    // does not exist. The animated three arm their reveal separately.
    var split = $('stat-split');
    if (split) {
      var econ = cfg.economics;
      split.textContent = (100 - econ.protocolFeeBpsInitial / 100) + '/' +
        (econ.protocolFeeBpsInitial / 100) + ' · chain ' + cfg.chain.id;
    }
    armStatsReveal();

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

    // vault cards
    var grid = $('vault-grid');
    if (grid) {
      cfg.vaults.forEach(function (v) {
        var mounts = renderCardShell(v);
        grid.appendChild(mounts.card);
        mounts.rows.appendChild(row('Status', el('span', 'state', 'connecting to public RPC…')));
        cards.push({ vaultCfg: v, mounts: mounts });
      });
      refreshCards();
    }
    startTimers();

    // widget wiring
    var connectBtn = $('btn-connect');
    if (connectBtn) { connectBtn.addEventListener('click', connectWallet); }
    var map = { 'btn-approve': 'approve', 'btn-deposit': 'deposit', 'btn-withdraw': 'withdraw', 'btn-redeem': 'redeem' };
    Object.keys(map).forEach(function (id) {
      var b = $(id);
      if (b) { b.addEventListener('click', function () { runFlow(map[id]); }); }
    });

    if (WS.wallet.isAvailable()) {
      WS.wallet.onAccountsChanged(function () { state.wallet = null; renderWidgetState(); });
      WS.wallet.onChainChanged(function () { state.wallet = null; renderWidgetState(); });
    }

    renderWidgetState();

    initDocs();
    initScrollSpy();
    initReveal();   // R3 IMP-3: after the cards render — arms .ws-reveal on section heads + vault cards
    initAssetDraw();  // WS-ASSET-WIRE: arms the curve divider's scroll-in draw-on

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
