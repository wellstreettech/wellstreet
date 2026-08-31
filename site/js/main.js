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
    if (raw === null || raw === undefined) { return '—'; }
    var d = decimals == null ? 18 : decimals;
    var v = Number(raw) / Math.pow(10, d);
    return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
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
    vaultDeployed: false
  };

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
    var n = el('span', 'flag ' + (ok ? 'flag-ok' : 'flag-warn'), (ok ? '● ' : '△ ') + text);
    return n;
  }

  function renderCardShell(vaultCfg) {
    var card = el('article', 'vault-card');
    card.setAttribute('data-vault-id', vaultCfg.id);
    var head = el('div', 'card-head');
    var title = el('h3', 'card-title', vaultCfg.displayName);
    var sym = el('span', 'share-symbol', vaultCfg.shareSymbol);
    head.appendChild(title);
    head.appendChild(sym);
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

  function aprRow(apr) {
    if (!apr) { return row('Projected depositor APR', 'computing…', 'card-row-strong'); }
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

  async function connectWallet() {
    try {
      var res = await WS.wallet.connect(cfg);
      state.wallet = res;
      widgetStatus('Connected ' + fmtAddr(res.account) + ' on chain ' + res.chainId + '.', false);
      renderWidgetState();
    } catch (err) {
      var d = WS.wallet.describeError(err);
      widgetStatus('Connect failed: ' + d.message, true);
    }
  }

  async function runFlow(kind) {
    var v = vaultCfg();
    if (!state.wallet) { widgetStatus('Connect a wallet first.', true); return; }
    if (!WS.vault.isDeployed(v.vault)) { widgetStatus('Vault pending deploy — this flow is intentionally disabled.', true); return; }
    var dec = 18;
    try {
      if (kind === 'approve') {
        var amtA = parseAmount($('dep-amount').value);
        if (!amtA) { widgetStatus('Enter an amount first.', true); return; }
        widgetStatus('Waiting for wallet confirmation (approve)…', false);
        var h1 = await WS.wallet.approve(cfg, v.asset, v.vault, amtA);
        widgetStatus('Approve sent: ' + h1, false);
        linkTx(h1);
      } else if (kind === 'deposit') {
        var amtD = parseAmount($('dep-amount').value);
        if (!amtD) { widgetStatus('Enter an amount first.', true); return; }
        widgetStatus('Waiting for wallet confirmation (deposit)…', false);
        var h2 = await WS.wallet.deposit(cfg, v.vault, amtD, state.wallet.account);
        widgetStatus('Deposit sent: ' + h2, false);
        linkTx(h2);
      } else if (kind === 'withdraw') {
        var amtW = parseAmount($('red-amount').value);
        if (!amtW) { widgetStatus('Enter an amount first.', true); return; }
        widgetStatus('Waiting for wallet confirmation (withdraw)…', false);
        var h3 = await WS.wallet.withdraw(cfg, v.vault, amtW, state.wallet.account, state.wallet.account);
        widgetStatus('Withdraw sent: ' + h3, false);
        linkTx(h3);
      } else if (kind === 'redeem') {
        var amtR = parseAmount($('red-amount').value);
        if (!amtR) { widgetStatus('Enter an amount first.', true); return; }
        widgetStatus('Waiting for wallet confirmation (redeem)…', false);
        var h4 = await WS.wallet.redeem(cfg, v.vault, amtR, state.wallet.account, state.wallet.account);
        widgetStatus('Redeem sent: ' + h4, false);
        linkTx(h4);
      }
    } catch (err) {
      var d = WS.wallet.describeError(err);
      widgetStatus('Failed: ' + d.message, true);
    }
    renderWidgetState();
  }

  function parseAmount(str) {
    var v = parseFloat(str);
    if (!isFinite(v) || v <= 0) { return null; }
    return BigInt(Math.round(v * 1e6)) * 1000000000000n; // 18-decimals safe parse
  }

  function linkTx(hash) {
    var box = $('widget-status');
    if (!box || !hash) { return; }
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
    WS.docs.buildTabs(cfg, tabMount, pane, null);
    var first = cfg.docs.index[0];
    if (first) { WS.docs.loadDoc(cfg, first, pane); }
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

    // vault cards
    var grid = $('vault-grid');
    if (grid) {
      cfg.vaults.forEach(function (v) {
        var mounts = renderCardShell(v);
        grid.appendChild(mounts.card);
        mounts.rows.appendChild(row('Status', 'connecting to public RPC…'));
        loadVaultData(v, mounts);
      });
    }

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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
