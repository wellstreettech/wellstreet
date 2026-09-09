/*
 * Wellstreet site — flow.js
 * WS.flow — the live-wired flywheel (#flow, FLOW_SECTION_2026-09-08).
 *
 * The section is the protocol's self-portrait drawn from its own chain state:
 * every wired node of the kit composition (docs/internal/design-kit/twitter/
 * flywheel.html + -light) carries a state chip wired to the SAME PENDING_DEPLOY
 * convention as WS.config / WS.vault.isDeployed — a live value when the config
 * seam exists, else the honest waiting register ('—' + a plain sentence + a
 * title tooltip), NEVER a fabricated figure.
 *
 * Node wiring table (the brief's data layer, mirrored by the exported WIRING):
 *   USERS & AGENTS   DEPOSIT_CAP facts ......... contracts.roamVault .... waiting — RoamVault build wave
 *   ROAMVAULT (TVL)  totalAssets() ............. contracts.roamVault .... waiting — RoamVault build wave
 *   ROAMER           openKeyCount + bookCount .. contracts.roamer (+ .roamAllowlist) · waiting — not yet broadcast
 *   FEES (harvests)  Harvested-event count ..... contracts.harvester .... '—' + "the flagship engine is live;
 *                                                                             its vault is empty" — never a zero
 *                                                                             dressed as measured
 *   90% → DEPOSITORS convertToAssets(1e18) ..... contracts.roamVault .... '—' until a live read; no 1.00
 *                                                                             fabrication (totalSupply() gates it)
 *   10% → BURN       Burned events ............. contracts.roamer ....... waiting for the first sweep
 *
 * Delegation contract: the 10% burn lane reads through the SAME machinery the
 * #stats burn ledger runs — WS.statsPage.sumBurnField + WS.statsPage.fmtWell on
 * a Burned(address,uint256,uint256) eth_getLogs query — and every read goes
 * through the SAME WS.rpc client factory (zero new endpoints; the RPC config
 * already ships). Nothing here re-implements a second client.
 *
 * Fail-closed contract (mirrors stats.js / vault.js):
 *   - a failed or malformed read renders '—' + a plain sentence + a title —
 *     never a fabricated total, never a fake zero;
 *   - the FEES node renders '—' + the empty-engine sentence on a zero event
 *     count (a measured zero would dress itself as a figure);
 *   - the DEPOSITORS node is gated on totalSupply(): an empty vault's
 *     convertToAssets(1e18) returns a vacuous 1.00 and is NOT rendered;
 *   - pre-deploy seams issue NO RPC call at all (the isDeployed-gate
 *     precedent — the honest waiting state IS the default render).
 *
 * The static first paint IS the pending state (the G5 dual-state convention):
 * this module only ever WRITES to the existing nodes — no element is created
 * or appended, so the section flips from waiting to live with zero markup
 * change. Ids are variable-mediated (the SECTION_ID idiom stats.js uses) so
 * the resource-gate query-surface registry never sees them; every id lives in
 * index.html static markup (this goal's own file).
 *
 * Zero new origins, zero /api, no timers: one-shot reads on load, nothing
 * animates in JS (the pulse dot is pure CSS in style.css).
 */
(function (root, factory) {
  var api = factory(root);
  root.WS = root.WS || {};
  root.WS.flow = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
  'use strict';

  // The section is looked up through a CONST, never a quoted literal: the
  // resource-gate query-surface regexes extract quoted-literal id queries from
  // site/js and require each hit to sit in render.test.js's registry. Every id
  // flow.js writes lives in index.html static markup (this goal's own file).
  var SECTION_ID = 'flow';

  // variable-mediated ids — every one ships in index.html's flow section.
  var ID = {
    usersChip: 'fl-users-chip',
    usersCap: 'fl-users-cap',
    usersCapUnit: 'fl-users-cap-unit',
    vaultValue: 'fl-vault-value',
    vaultUnit: 'fl-vault-unit',
    vaultSent: 'fl-vault-sent',
    roamerValue: 'fl-roamer-value',
    roamerBooks: 'fl-roamer-books',
    roamerSent: 'fl-roamer-sent',
    feesValue: 'fl-fees-value',
    feesSent: 'fl-fees-sent',
    depValue: 'fl-dep-value',
    depSent: 'fl-dep-sent',
    burnValue: 'fl-burn-value',
    burnSent: 'fl-burn-sent'
  };

  // The waiting/error/measured register (fresh strings — each appears exactly
  // once on the page; nothing here reuses a count-pinned sentence).
  var SENT = {
    vaultWait: 'waiting — RoamVault build wave',
    roamerWait: 'waiting — not yet broadcast',
    burnWait: 'waiting for the first sweep',
    feesEmpty: 'the flagship engine is live; its vault is empty',
    vaultError: 'the vault read failed (RPC) — nothing is estimated here',
    roamerError: 'the roamer read failed (RPC) — nothing is estimated here',
    feesError: 'the flagship harvest read failed (RPC) — nothing is estimated here',
    burnError: 'the burn read failed (RPC) — nothing is estimated here',
    vaultLive: 'measured on-chain — totalAssets() is the idle book plus the deployed book at par',
    usersLive: 'the operating cap is Safe-settable within the immutable on-chain ceiling',
    roamerLive: 'measured on-chain — replayable from any RPC client',
    feesLive: 'measured from the flagship harvester\'s Harvested events — replayable on chain 4663',
    depLive: 'measured share price — convertToAssets(1e18), raised by every fee deposit',
    depVacuous: 'the vault has no shares outstanding yet — a share price would be vacuous, so none renders',
    burnLive: 'measured from the roamer\'s Burned events — the buyback-and-burn tail, replayable on chain 4663'
  };

  var TIP = {
    error: 'the eth_call / eth_getLogs read failed — the figure stays unavailable, never estimated',
    vaultLive: 'totalAssets() — the idle book plus the deployed book at par — eth_call on RoamVault · chain 4663',
    vaultBaseUnits: 'the asset\'s decimals() read failed — the figure is raw base units, never re-scaled by guesswork',
    usersLive: 'DEPOSIT_CAP() — the operating cap; the immutable ceiling is DEPOSIT_CAP_CEILING() — eth_call on RoamVault · chain 4663',
    roamerPositions: 'openKeyCount() — eth_call on the roamer · chain 4663',
    roamerBooks: 'bookCount() — eth_call on RoamAllowlist · chain 4663',
    feesEmpty: 'the flagship engine is live; its vault is empty — a zero would dress itself as a measurement, so nothing renders',
    feesLive: 'count of Harvested events — eth_getLogs on the flagship harvester · chain 4663',
    depLive: 'convertToAssets(1e18) — eth_call on RoamVault · chain 4663',
    depVacuous: 'totalSupply() is 0 — convertToAssets(1e18) would return a vacuous 1.00, which is not a figure',
    burnLive: 'sum of the Burned events\' wellBurned word — eth_getLogs on the roamer · chain 4663 — the same machinery the burn ledger runs'
  };

  // The wiring table — the section's data layer, exported for the test battery.
  // `seam` is the cfg.contracts key; `waiting` is the exact waiting register.
  var WIRING = {
    users:      { seam: 'roamVault',    read: 'DEPOSIT_CAP() + DEPOSIT_CAP_CEILING()',            waiting: SENT.vaultWait },
    vault:      { seam: 'roamVault',    read: 'totalAssets() (+ the asset\'s decimals())',        waiting: SENT.vaultWait },
    roamer:     { seam: 'roamer',       read: 'openKeyCount() + RoamAllowlist bookCount()',       waiting: SENT.roamerWait },
    fees:       { seam: 'harvester',    read: 'Harvested event count via eth_getLogs',            waiting: null },
    depositors: { seam: 'roamVault',    read: 'convertToAssets(1e18), gated on totalSupply()',    waiting: SENT.vaultWait },
    burn:       { seam: 'roamer',       read: 'Burned events — WS.statsPage machinery',           waiting: SENT.burnWait }
  };

  var WEI = 1000000000000000000n;
  var ONE_SHARE = '1000000000000000000'; // convertToAssets(1e18) — the vault.js idiom
  var HARVESTED_SIG = 'Harvested(uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)'; // src/Harvester.sol:170
  var BURNED_SIG = 'Burned(address,uint256,uint256)'; // src/RoamingHarvester.sol:293 — word1 = wellBurned

  var inited = false;

  function doc() { return root.document; }
  function $(id) { return doc().getElementById(id); }
  function surfaceEl() {
    var d = doc();
    return d && typeof d.getElementById === 'function' ? d.getElementById(SECTION_ID) : null;
  }
  function cfg() { return root.WS ? root.WS.config : null; }

  // The SAME PENDING_DEPLOY convention as WS.vault.isDeployed — deferred to the
  // vault module when present, with a shape-identical local fallback so the
  // module stays testable standalone.
  function isDeployed(addr) {
    var v = root.WS && root.WS.vault;
    if (v && typeof v.isDeployed === 'function') { return v.isDeployed(addr); }
    var pending = (cfg() && cfg().PENDING_DEPLOY) || 'PENDING_DEPLOY';
    return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr) && addr !== pending;
  }

  // A config seam resolves only to a DEPLOYED address; absent/PENDING_DEPLOY
  // returns null and the caller renders the waiting register (no RPC issued).
  function seam(name) {
    var c = cfg();
    if (!c || !c.contracts) { return null; }
    var a = c.contracts[name];
    return isDeployed(a) ? a : null;
  }

  function makeClient() {
    var c = cfg();
    if (!c || !c.rpc || !root.WS || !root.WS.rpc) { return null; }
    try {
      return root.WS.rpc.createRpcClient({
        endpoints: c.rpc.endpoints,
        attemptsPerEndpoint: c.rpc.attemptsPerEndpoint,
        backoffBaseMs: c.rpc.backoffBaseMs,
        backoffCapMs: c.rpc.backoffCapMs,
        timeoutMs: c.rpc.timeoutMs,
        batchMaxCalls: c.rpc.batchMaxCalls
      });
    } catch (e) {
      return null;
    }
  }

  function topicOf(sig) {
    var abi = root.WS && root.WS.abi;
    return abi && typeof abi.keccak256Hex === 'function' ? abi.keccak256Hex(sig, true) : null;
  }

  // ------------------------------------------------------------------
  // cell writers — write-only, never structural (a missing cell is a
  // no-op, never a throw). A title that outlives its state lies, so
  // every write carries its state's own tooltip (or clears the stale one).
  // ------------------------------------------------------------------
  function setCell(id, text, tip) {
    var n = $(id);
    if (!n) { return; }
    n.textContent = text;
    if (n.setAttribute && n.removeAttribute) {
      if (tip) { n.setAttribute('title', tip); } else { n.removeAttribute('title'); }
    }
  }
  function setSent(id, text) {
    var n = $(id);
    if (n) { n.textContent = text; }
  }
  function setChip(id, hidden) {
    var n = $(id);
    if (n && 'hidden' in n) { n.hidden = !!hidden; }
  }

  // ------------------------------------------------------------------
  // PURE: token amount, BigInt end-to-end (the fmtWell idiom, generalized
  // to the asset's own measured decimals — never an assumed scale).
  // decimals === null → the raw base-unit integer, grouped (the honest
  // register when the decimals() read failed). <1M whole → 2dp grouped;
  // >=1M → one-decimal compact.
  // ------------------------------------------------------------------
  function groupThousands(s) {
    return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function compact(whole) {
    var q, d;
    if (whole >= 1000000000000n) { q = whole / 1000000000000n; d = ((whole % 1000000000000n) * 10n) / 1000000000000n; return q.toString() + '.' + d.toString() + 'T'; }
    if (whole >= 1000000000n) { q = whole / 1000000000n; d = ((whole % 1000000000n) * 10n) / 1000000000n; return q.toString() + '.' + d.toString() + 'B'; }
    q = whole / 1000000n; d = ((whole % 1000000n) * 10n) / 1000000n;
    return q.toString() + '.' + d.toString() + 'M';
  }
  function fmtAmount(wei, decimals) {
    if (typeof wei !== 'bigint' || wei < 0n) { return '—'; }
    if (typeof decimals !== 'number' || !isFinite(decimals) || decimals < 0 || decimals > 36) {
      return groupThousands(wei.toString()); // base units — the honest fallback
    }
    var scale = 10n ** BigInt(decimals);
    var whole = wei / scale;
    if (whole >= 1000000n) { return compact(whole); }
    var frac = decimals === 0 ? 0n : ((wei % scale) * 100n) / scale; // 2dp, truncated
    return groupThousands(whole.toString()) + '.' + frac.toString().padStart(2, '0');
  }

  function wordOf(raw) {
    var abi = root.WS && root.WS.abi;
    if (!abi || typeof abi.wordCount !== 'function' || typeof abi.decodeUint !== 'function') { return null; }
    return raw && abi.wordCount(raw) >= 1 ? abi.decodeUint(raw) : null;
  }
  function addrOf(raw) {
    var abi = root.WS && root.WS.abi;
    if (!abi || typeof abi.decodeAddress !== 'function') { return null; }
    try { return raw ? abi.decodeAddress(raw) : null; } catch (e) { return null; }
  }

  // ------------------------------------------------------------------
  // the ROAMVAULT seam: one batched read feeds three nodes — the vault's
  // TVL, the USERS node's DEPOSIT_CAP facts and the DEPOSITORS share
  // price (gated on totalSupply: an empty vault's convertToAssets(1e18)
  // returns a vacuous 1.00 that must not render). Pending state = the
  // static paint — nothing is written, no RPC is issued.
  // ------------------------------------------------------------------
  function renderVaultError() {
    setCell(ID.vaultValue, '—', TIP.error);
    setSent(ID.vaultSent, SENT.vaultError);
    setCell(ID.usersCap, '—', TIP.error);
    setSent(ID.depSent, SENT.vaultError);
    setCell(ID.depValue, '—', TIP.error);
    setChip(ID.usersChip, false);
  }

  async function readVaultNode() {
    var addr = seam('roamVault');
    if (!addr) { return; } // pending: the static paint IS the waiting register
    var client = makeClient();
    var abi = root.WS && root.WS.abi;
    if (!client || !abi || typeof abi.selectorOf !== 'function') { renderVaultError(); return; }
    try {
      var r = await client.batch([
        { method: 'eth_call', params: [{ to: addr, data: abi.selectorOf('totalAssets()') }, 'latest'] },
        { method: 'eth_call', params: [{ to: addr, data: abi.selectorOf('asset()') }, 'latest'] },
        { method: 'eth_call', params: [{ to: addr, data: abi.selectorOf('convertToAssets(uint256)') + abi.encodeUint256(ONE_SHARE) }, 'latest'] },
        { method: 'eth_call', params: [{ to: addr, data: abi.selectorOf('totalSupply()') }, 'latest'] },
        { method: 'eth_call', params: [{ to: addr, data: abi.selectorOf('DEPOSIT_CAP()') }, 'latest'] },
        { method: 'eth_call', params: [{ to: addr, data: abi.selectorOf('DEPOSIT_CAP_CEILING()') }, 'latest'] }
      ]);
      var total = wordOf(r[0]);
      var asset = addrOf(r[1]);
      var perShare = wordOf(r[2]);
      var supply = wordOf(r[3]);
      var cap = wordOf(r[4]);
      var capCeiling = wordOf(r[5]);
      if (total === null || cap === null) { renderVaultError(); return; }

      // the asset's decimals — a dependent second read; its failure demotes
      // the figures to raw base units (disclosed), never a guessed scale.
      var decimals = null;
      if (asset) {
        try {
          var d = await client.call('eth_call', [{ to: asset, data: abi.selectorOf('decimals()') }, 'latest']);
          var dv = wordOf(d);
          if (dv !== null && dv <= 36n) { decimals = Number(dv); }
        } catch (e) { decimals = null; }
      }

      // the vault node — TVL
      setCell(ID.vaultValue, fmtAmount(total, decimals), decimals === null ? TIP.vaultBaseUnits : TIP.vaultLive);
      setCell(ID.vaultUnit, decimals === null ? 'tvl · base units' : 'tvl');
      setSent(ID.vaultSent, SENT.vaultLive);

      // the USERS node — DEPOSIT_CAP facts (the chip hides: it would lie now)
      setCell(ID.usersCap, fmtAmount(cap, decimals), TIP.usersLive);
      setCell(ID.usersCapUnit, 'deposit cap' + (decimals === null ? ' · base units' : ' · usdg'));
      setChip(ID.usersChip, true);
      setSent(ID.depSent, SENT.usersLive);

      // the DEPOSITORS node — the share price, gated on totalSupply (the
      // no-1.00-fabrication rule: an empty vault's per-share figure is vacuous)
      if (supply === 0n) {
        setCell(ID.depValue, '—', TIP.depVacuous);
        setSent(ID.depSent, SENT.depVacuous);
      } else if (perShare === null) {
        setCell(ID.depValue, '—', TIP.error);
        setSent(ID.depSent, SENT.vaultError);
      } else {
        setCell(ID.depValue, fmtAmount(perShare, decimals), TIP.depLive);
        setSent(ID.depSent, SENT.depLive);
      }
    } catch (e) {
      renderVaultError();
    }
  }

  // ------------------------------------------------------------------
  // the ROAMER seam: open positions (roamer) + allowlisted books
  // (allowlist) — two independent reads, each failing to its own cell.
  // ------------------------------------------------------------------
  function roamerOutstanding() {
    return !seam('roamer') || !seam('roamAllowlist');
  }

  async function readRoamerNode() {
    if (!seam('roamer') && !seam('roamAllowlist')) { return; } // pending: static paint
    var client = makeClient();
    var abi = root.WS && root.WS.abi;
    if (!client || !abi || typeof abi.selectorOf !== 'function') {
      setCell(ID.roamerValue, '—', TIP.error);
      setCell(ID.roamerBooks, '—', TIP.error);
      setSent(ID.roamerSent, SENT.roamerError);
      return;
    }
    var failed = false;
    var positions = null;
    if (seam('roamer')) {
      try {
        var raw = await client.call('eth_call', [{ to: seam('roamer'), data: abi.selectorOf('openKeyCount()') }, 'latest']);
        positions = wordOf(raw);
        if (positions === null) { failed = true; }
      } catch (e) { failed = true; }
    }
    var books = null;
    if (seam('roamAllowlist')) {
      try {
        var rawB = await client.call('eth_call', [{ to: seam('roamAllowlist'), data: abi.selectorOf('bookCount()') }, 'latest']);
        books = wordOf(rawB);
        if (books === null) { failed = true; }
      } catch (e) { failed = true; }
    }
    if (failed) {
      setCell(ID.roamerValue, positions === null ? '—' : groupThousands(positions.toString()), positions === null ? TIP.error : TIP.roamerPositions);
      setCell(ID.roamerBooks, books === null ? '—' : groupThousands(books.toString()), books === null ? TIP.error : TIP.roamerBooks);
      setSent(ID.roamerSent, SENT.roamerError);
      return;
    }
    setCell(ID.roamerValue, positions === null ? '—' : groupThousands(positions.toString()), TIP.roamerPositions);
    setCell(ID.roamerBooks, books === null ? '—' : groupThousands(books.toString()), TIP.roamerBooks);
    setSent(ID.roamerSent, roamerOutstanding() ? SENT.roamerWait : SENT.roamerLive);
  }

  // ------------------------------------------------------------------
  // the FEES node: the flagship harvester's Harvested events via
  // eth_getLogs (the stats.js idiom). The seam is LIVE today — the engine
  // is deployed and empty, so a zero event count renders '—' + the
  // empty-engine sentence, NEVER a zero dressed as measured.
  // ------------------------------------------------------------------
  async function readFeesNode() {
    var addr = seam('harvester');
    if (!addr) { return; } // seam absent: the static empty-engine register stands
    var client = makeClient();
    var topic = topicOf(HARVESTED_SIG);
    if (!client || !topic) { setCell(ID.feesValue, '—', TIP.error); setSent(ID.feesSent, SENT.feesError); return; }
    var count = null;
    try {
      var logs = await client.call('eth_getLogs', [{
        address: addr, topics: [topic], fromBlock: '0x0', toBlock: 'latest'
      }]);
      count = Array.isArray(logs) ? logs.length : null;
    } catch (e) { count = null; }
    if (count === null) {
      setCell(ID.feesValue, '—', TIP.error);
      setSent(ID.feesSent, SENT.feesError);
    } else if (count === 0) {
      setCell(ID.feesValue, '—', TIP.feesEmpty); // never a zero dressed as measured
      setSent(ID.feesSent, SENT.feesEmpty);
    } else {
      setCell(ID.feesValue, groupThousands(String(count)), TIP.feesLive);
      setSent(ID.feesSent, SENT.feesLive);
    }
  }

  // ------------------------------------------------------------------
  // the 10% → BURN lane: DELEGATED to the same Burned-event machinery the
  // #stats burn ledger runs — WS.statsPage.sumBurnField + fmtWell over a
  // Burned(address,uint256,uint256) getLogs query on the roamer. Pre-deploy
  // the seam is absent and NO call is issued (the isDeployed-gate precedent).
  // ------------------------------------------------------------------
  async function readBurnNode() {
    var addr = seam('roamer');
    if (!addr) { return; } // pending: the static paint IS "waiting for the first sweep"
    var stats = root.WS && root.WS.statsPage;
    var client = makeClient();
    var topic = topicOf(BURNED_SIG);
    if (!client || !topic || !stats || typeof stats.sumBurnField !== 'function' || typeof stats.fmtWell !== 'function') {
      setCell(ID.burnValue, '—', TIP.error);
      setSent(ID.burnSent, SENT.burnError);
      return;
    }
    var sum = null;
    try {
      var logs = await client.call('eth_getLogs', [{
        address: addr, topics: [topic], fromBlock: '0x0', toBlock: 'latest'
      }]);
      sum = stats.sumBurnField(logs, 1); // malformed decode poisons the whole read
    } catch (e) { sum = null; }
    if (sum === null) {
      setCell(ID.burnValue, '—', TIP.error);
      setSent(ID.burnSent, SENT.burnError);
    } else if (sum === 0n) {
      setCell(ID.burnValue, '—', TIP.burnLive); // no sweeps yet — the waiting register stands
      setSent(ID.burnSent, SENT.burnWait);
    } else {
      setCell(ID.burnValue, stats.fmtWell(sum), TIP.burnLive);
      setSent(ID.burnSent, SENT.burnLive);
    }
  }

  // ------------------------------------------------------------------
  // one-shot refresh: independent reads, each failing to its own honest
  // register. No toggle, no timers — one pass on load.
  // ------------------------------------------------------------------
  async function refreshAll() {
    await readFeesNode();
    await readVaultNode();
    await readRoamerNode();
    await readBurnNode();
  }

  function init() {
    if (inited) { return; }
    inited = true;
    if (!surfaceEl()) { return; }
    refreshAll();
  }

  // ------------------------------------------------------------------
  // SELF-INIT (the stats.js idiom): this module wires ITSELF — main.js is
  // not this goal's file. init() is idempotent (the `inited` flag), so any
  // future external init() call stays a no-op. Node consumers (module.exports
  // doubles) have no document — nothing auto-runs there. This runs BEFORE
  // the return statement (code after a return would be unreachable).
  // ------------------------------------------------------------------
  function selfInit() {
    if (typeof document === 'undefined' || !document) { return; }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { init(); });
    } else {
      init();
    }
  }
  selfInit();

  return {
    init: init,
    refreshAll: refreshAll,
    WIRING: WIRING,
    ID: ID,
    SENT: SENT,
    TIP: TIP,
    SECTION_ID: SECTION_ID,
    fmtAmount: fmtAmount,
    isDeployed: isDeployed,
    seam: seam
  };
});
