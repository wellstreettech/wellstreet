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
    lastUpdated: null    // timestamp of the last successful card refresh
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
    for (var i = 0; i < cards.length; i++) {
      await loadVaultData(cards[i].vaultCfg, cards[i].mounts);
    }
    state.lastUpdated = Date.now();
    updateStamp();
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
    if (pending) { head.appendChild(el('span', 'pending-tag', 'awaiting on-chain deploy')); }
    card.appendChild(head);
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
    rowsBox.appendChild(ledgerRow('SPY / WETH (pool slot0)',
      spyWeth ? el('strong', null, spyWeth.toFixed(4) + ' WETH')
              : el('span', 'state', 'unavailable (RPC)')));

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
    rowsBox.appendChild(ledgerRow('Pool TVL (live)', tvlNode));

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
    rowsBox.appendChild(ledgerRow('Pool protocol cut (live)', cutNode));

    // 4. The 90/10 fee split — static ratified economics (js/config.js is the
    //    single source of truth; matches the hero fact above the fold).
    var econ = cfg.economics;
    rowsBox.appendChild(ledgerRow('Vault fee split',
      (100 - econ.protocolFeeBpsInitial / 100) + '% depositors / ' + (econ.protocolFeeBpsInitial / 100) +
      '% protocol (timelock-settable, hard-capped at ' + (econ.maxFeeBps / 100) + '%)'));

    // 5. Vault state — the honest pending pipeline (never a fake number)
    rowsBox.appendChild(ledgerRow('Vault state',
      WS.vault.isDeployed(vaultCfg().vault)
        ? flagNode(true, 'deployed — yield phase live')
        : flagNode(false, 'awaiting on-chain deploy — yield phase not started'),
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
    setChipValue('chip-price',
      price && price.usd != null && isFinite(price.usd) ? '$' + price.usd.toFixed(2) : '');
    // Pool TVL in USD — the derivation deriveApr already computes and hands
    // to the ledger (tvlWeth x pool-derived WETH price); no recompute here.
    setChipValue('chip-tvl',
      tvlUsd !== null && tvlUsd !== undefined && isFinite(tvlUsd) ? fmtUsd(tvlUsd) : '');
  }

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
      // V10 chip: the published projection's depositor figure (label-only when absent)
      setChipValue('chip-apr',
        apr.depositorAprPct != null ? '~' + fmtPct(apr.depositorAprPct, 1) : '');
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

  // ------------------------------------------------------------------
  // init
  // ------------------------------------------------------------------

  function init() {
    // year stamp
    var y = $('footer-year');
    if (y) { y.textContent = String(new Date().getFullYear()); }

    // honesty lines
    var tm = $('trademark-note');
    if (tm) { tm.textContent = cfg.branding.trademarkNote; }
    var fn = $('apr-footnote-text');
    if (fn) { fn.textContent = WS.apr.METHODOLOGY_FOOTNOTE; }
    var wc = $('widget-chain');
    if (wc) { wc.textContent = 'expects chain ' + cfg.chain.id + ' (' + cfg.chain.name + ')'; }

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
