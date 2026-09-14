/*
 * Wellstreet site — vault.js
 * Serverless-clean reads (D8): EVERY number about the protocol is fetched by the
 * browser as a direct eth_call against the public RPC endpoints — no /api/* route
 * of our own is ever contacted. If every fetch fails, the page renders honest
 * "unavailable" states; it never renders fabricated values.
 *
 * Views consumed (the spec's five real vault views + the live pool/feed context):
 *   factory registry (when deployed) · asset() · totalAssets() · totalSupply() ·
 *   pricePerShare() [fallback convertToAssets(1e18)] · paused()
 * Selector derivation is done at runtime from signatures (js/abi.js) — no hardcoded,
 * possibly-wrong selectors.
 *
 * NOTE ON THE FACTORY INTERFACE: the vault factory / vault / harvester / timelock
 * addresses are PENDING_DEPLOY (see js/config.js). The expected registry interface
 * below is a documented deploy-prep VERIFICATION ITEM, not an assumption to build on:
 * the first read attempt uses allVaults() -> address[], the second vaultList() ->
 * address[]; if both revert, the card shows the honest pending/verify state.
 */
(function (root, factory) {
  var api = factory(root);
  root.WS = root.WS || {};
  root.WS.vault = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
  'use strict';

  var PENDING = (root.WS && root.WS.config) ? root.WS.config.PENDING_DEPLOY : 'PENDING_DEPLOY';

  function isDeployed(addr) {
    return typeof addr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(addr) && addr !== PENDING;
  }

  // ---------------- pure decoders (unit-tested) ----------------

  // UniswapV3Pool slot0() returns EXACTLY SEVEN static words (verified ABI,
  // docs/ops/phase0/pool-apr.md §1.2 — never a word-count summary):
  //   uint160 sqrtPriceX96, int24 tick, uint16 observationIndex,
  //   uint16 observationCardinality, uint16 observationCardinalityNext,
  //   uint8 feeProtocol, bool unlocked
  function decodeSlot0(raw) {
    var abi = root.WS.abi;
    if (abi.wordCount(raw) < 7) { return null; }
    var feeProtocolWord = abi.decodeUint(raw, 5);
    var n0 = Number(feeProtocolWord & 0xfn);            // token0 side (WETH -> SPY)
    var n1 = Number((feeProtocolWord >> 4n) & 0xfn);    // token1 side
    return {
      sqrtPriceX96: abi.decodeUint(raw, 0),
      tick: abi.decodeInt(raw, 1),
      observationIndex: abi.decodeUint(raw, 2),
      observationCardinality: abi.decodeUint(raw, 3),
      observationCardinalityNext: abi.decodeUint(raw, 4),
      feeProtocolRaw: feeProtocolWord,
      feeProtocol: { token0: n0, token1: n1 },
      unlocked: abi.decodeBool(raw, 6)
    };
  }

  // Price of token1 denominated in token0 (token1 per token0): (sqrtPriceX96 / 2^96)^2.
  // Kept in BigInt at 1e18 scale to avoid precision loss, then narrowed to a Number.
  function priceFromSqrtPriceX96(sqrtPriceX96) {
    if (sqrtPriceX96 === null || sqrtPriceX96 === undefined) { return null; }
    var scaled = ((sqrtPriceX96 * sqrtPriceX96) * 1000000000000000000n) / (1n << 192n);
    return Number(scaled) / 1e18;
  }

  // Chainlink AggregatorV3.latestRoundData(): uint80 roundId, int256 answer,
  // uint256 startedAt, uint256 updatedAt, uint80 answeredInRound
  function decodeLatestRoundData(raw) {
    var abi = root.WS.abi;
    if (abi.wordCount(raw) < 5) { return null; }
    var answer = abi.decodeInt(raw, 1);
    if (answer !== null && answer < 0n) { return null; }
    return {
      roundId: abi.decodeUint(raw, 0),
      answer: answer,
      startedAt: abi.decodeUint(raw, 2),
      updatedAt: abi.decodeUint(raw, 3),
      answeredInRound: abi.decodeUint(raw, 4)
    };
  }

  // ---------------- backingCoverage (STRATTON-LEDGER-CARD) ----------------
  // YieldShares.backingCoverage() returns ONE 1e18-fixed-point word: the vault's raw
  // asset balance scaled against the accounted figure (deposits plus credited yield).
  // ==1e18 exact cover · >1e18 unaccounted excess · an empty vault reads 1e18 (no
  // accounted liability) · below 1.0 only after an issuer burn. Source of truth:
  // src/YieldShares.sol:152 (verified on-chain view; this is the frontend seam only).

  // PURE: decode the single return word. Honest null on empty/failed decode —
  // never 0, never a fabricated figure (vault.js null-guard convention).
  function decodeBackingCoverage(raw) {
    var abi = root.WS.abi;
    if (raw === null || raw === undefined) { return null; }
    if (abi.wordCount(raw) < 1) { return null; }
    return abi.decodeUint(raw, 0);
  }

  // PURE: 1e18-fixed-point word -> percentage string, one decimal, TRUNCATED toward
  // zero (BigInt division truncates) — a 99.95%-covered vault reads "99.9%", never
  // "100.0%". Never clamped, never rounded up: under-coverage is displayed honestly,
  // and excess above 1.0 is shown as-is (199.9%, not capped at 100).
  function formatCoveragePct(raw) {
    var cov = decodeBackingCoverage(raw);
    if (cov === null) { return null; }
    var tenths = cov / 1000000000000000n;   // 1e15: integer tenths of a percent
    var whole = tenths / 10n;
    var frac = tenths % 10n;
    return whole.toString() + '.' + frac.toString() + '%';
  }

  // ---------------- live reads ----------------

  async function ethCall(client, to, data) {
    return client.call('eth_call', [{ to: to, data: data }, 'latest']);
  }

  // Underlying stock token: symbol/decimals/paused/totalSupply (live today — SPY is deployed)
  async function readUnderlying(client, tokenAddr) {
    var abi = root.WS.abi;
    var results = await client.batch([
      { method: 'eth_call', params: [{ to: tokenAddr, data: abi.selectorOf('symbol()') }, 'latest'] },
      { method: 'eth_call', params: [{ to: tokenAddr, data: abi.selectorOf('decimals()') }, 'latest'] },
      { method: 'eth_call', params: [{ to: tokenAddr, data: abi.selectorOf('paused()') }, 'latest'] },
      { method: 'eth_call', params: [{ to: tokenAddr, data: abi.selectorOf('totalSupply()') }, 'latest'] }
    ]);
    var symbol = abi.decodeString(results[0]);
    var decimalsRaw = results[1] ? abi.decodeUint(results[1]) : null;
    var paused = results[2] ? abi.decodeBool(results[2]) : null;
    var totalSupply = results[3] ? abi.decodeUint(results[3]) : null;
    return {
      address: tokenAddr,
      symbol: symbol,
      // null-guard: an empty/failed decode must stay "unavailable", never 0
      decimals: decimalsRaw === null ? null : Number(decimalsRaw),
      paused: paused,
      totalSupply: totalSupply,
      // Issuer-risk disclosure: paused() is a composite (token-local OR global registry
      // pause) and the fleet is beacon-upgradeable — see the honest docs risk tab.
      state: (paused === null) ? 'unknown' : (paused ? 'issuer-paused' : 'active')
    };
  }

  // Chainlink feed with both proxies; returns the first readable, non-stale-fatal answer.
  async function readPriceUsd(client, feedCfg, nowMs) {
    var abi = root.WS.abi;
    var sel = abi.selectorOf('latestRoundData()');
    var selDec = abi.selectorOf('decimals()');
    for (var i = 0; i < feedCfg.proxies.length; i++) {
      try {
        var raw = await ethCall(client, feedCfg.proxies[i], sel);
        var decoded = decodeLatestRoundData(raw);
        if (!decoded || decoded.answer === null) { continue; }
        var decimals = feedCfg.decimals;
        var usd = Number(decoded.answer) / Math.pow(10, decimals);
        var updatedAtMs = decoded.updatedAt !== null ? Number(decoded.updatedAt) * 1000 : null;
        var ageSeconds = updatedAtMs && nowMs ? Math.max(0, Math.floor((nowMs - updatedAtMs) / 1000)) : null;
        return {
          proxy: feedCfg.proxies[i],
          label: feedCfg.label,
          answer: decoded.answer.toString(),
          decimals: decimals,
          usd: usd,
          updatedAt: updatedAtMs,
          ageSeconds: ageSeconds,
          // Equity feeds update 24/5: weekend/holiday staleness is EXPECTED (phase-0 §3.2).
          // Stale flag is informational; the value is still shown with its age.
          stale: ageSeconds !== null && ageSeconds > 100 * 3600
        };
      } catch (e) { /* try next proxy */ }
    }
    return null;
  }

  // Live pool snapshot: identity, slot0 (incl. the LIVE protocol-fee cut), balances, TVL.
  // TVL basis matches the ratified phase-0 protocol: token0 balance + token1 balance ÷ P
  // (stock leg converted at the current pool price, both tokens 18 decimals on this chain).
  async function readPoolSnapshot(client, poolCfg) {
    var abi = root.WS.abi;
    var selSlot0 = abi.selectorOf('slot0()');
    var selFee = abi.selectorOf('fee()');
    var selBalanceOf = abi.selectorOf('balanceOf(address)');
    var selToken0 = abi.selectorOf('token0()');
    var selToken1 = abi.selectorOf('token1()');

    var batch = [
      { method: 'eth_call', params: [{ to: poolCfg.address, data: selSlot0 }, 'latest'] },
      { method: 'eth_call', params: [{ to: poolCfg.address, data: selFee }, 'latest'] },
      { method: 'eth_call', params: [{ to: poolCfg.token0, data: selBalanceOf + abi.encodeAddress(poolCfg.address) }, 'latest'] },
      { method: 'eth_call', params: [{ to: poolCfg.token1, data: selBalanceOf + abi.encodeAddress(poolCfg.address) }, 'latest'] },
      { method: 'eth_call', params: [{ to: poolCfg.address, data: selToken0 }, 'latest'] },
      { method: 'eth_call', params: [{ to: poolCfg.address, data: selToken1 }, 'latest'] }
    ];
    var r = await client.batch(batch);
    var slot0 = decodeSlot0(r[0]);
    var feeRaw = r[1] ? abi.decodeUint(r[1]) : null;
    var fee = feeRaw === null ? null : Number(feeRaw);
    var b0 = r[2] ? abi.decodeUint(r[2]) : null;   // token0 raw (WETH, 18 dec)
    var b1 = r[3] ? abi.decodeUint(r[3]) : null;   // token1 raw (SPY, 18 dec)
    var token0 = r[4] ? abi.decodeAddress(r[4]) : poolCfg.token0;
    var token1 = r[5] ? abi.decodeAddress(r[5]) : poolCfg.token1;

    var price = slot0 ? priceFromSqrtPriceX96(slot0.sqrtPriceX96) : null; // token1 per token0
    var tvlToken0 = null;
    if (b0 !== null && b1 !== null && price && price > 0) {
      tvlToken0 = (Number(b0) + Number(b1) / price) / 1e18; // in WETH units
    }

    return {
      address: poolCfg.address,
      label: poolCfg.label,
      feeTier: fee,
      token0: token0,
      token1: token1,
      slot0: slot0,
      priceToken1PerToken0: price,
      balance0Raw: b0,
      balance1Raw: b1,
      tvlToken0: tvlToken0,   // WETH units (live)
      // feeProtocol nibbles -> per-side protocol cut of the swap fee (live from slot0)
      cut: slot0 ? feeCutFromNibbles(slot0.feeProtocol.token0, slot0.feeProtocol.token1) : null
    };
  }

  // PURE: packed feeProtocol nibbles -> LP net multiplier. (4,4) -> 0.75, (6,6) -> 5/6,
  // (0,0) -> 1 (no cut). Unequal nibbles: the ratified protocol requires a
  // direction-weighted blend; until volume-direction data exists, use the CONSERVATIVE
  // side (higher cut) and flag it.
  function feeCutFromNibbles(n0, n1) {
    var cut0 = n0 > 0 ? 1 / n0 : 0;
    var cut1 = n1 > 0 ? 1 / n1 : 0;
    var equal = n0 === n1;
    var cut = equal ? cut0 : Math.max(cut0, cut1);
    return {
      token0N: n0,
      token1N: n1,
      equal: equal,
      cutFraction: cut,
      netMultiplier: 1 - cut,
      note: equal ? null : 'feeProtocol nibbles differ — conservative (higher-cut) side shown; a direction-weighted blend requires swap-direction volumes'
    };
  }

  // Live backingCoverage read (STRATTON-LEDGER-CARD). Returns the RAW response word
  // (formatCoveragePct consumes it); honest null when the address is not deployed
  // (the PENDING_DEPLOY branch NEVER issues the eth_call), the call fails, or the
  // decode is empty — the caller renders "unavailable (RPC)", never a fabricated figure.
  async function readBackingCoverage(client, vaultAddr) {
    if (!isDeployed(vaultAddr)) { return null; }
    var abi = root.WS.abi;
    try {
      var raw = await ethCall(client, vaultAddr, abi.selectorOf('backingCoverage()'));
      return decodeBackingCoverage(raw) === null ? null : raw;
    } catch (e) {
      return null;
    }
  }

  // ---------------- WS-PRODUCT-GAPS (2026-09-05): deposit-widget reads ----------------
  // P1 DEPOSIT-PAUSE GATE: the vault's own deposit pause flag — depositsPaused()
  // is a custom public bool (src/YieldShares.sol:76; deposit reverts DepositsPaused
  // :254, and maxDeposit(address) encodes the same truth as 0 when paused :165-172).
  // Honest null when undeployed/failed: "unknown" renders no pause row and never
  // masquerades as paused or open (the null-guard convention above).
  async function readDepositsPaused(client, vaultAddr) {
    if (!isDeployed(vaultAddr)) { return null; }
    var abi = root.WS.abi;
    try {
      var raw = await ethCall(client, vaultAddr, abi.selectorOf('depositsPaused()'));
      return (raw && abi.wordCount(raw) >= 1) ? abi.decodeBool(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // P2 POSITION TRUTH: the holder's share balance + the LIVE share price in ONE
  // batch — balanceOf(user) on the vault + convertToAssets(1e18) (1e18-scaled
  // underlying per share, the same shape readVaultSnapshot reads). Honest nulls
  // per decode — never 0-as-fake; the caller renders only verified decodes.
  async function readPosition(client, vaultAddr, userAddr) {
    if (!isDeployed(vaultAddr) || !userAddr) { return null; }
    var abi = root.WS.abi;
    try {
      var r = await client.batch([
        { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('balanceOf(address)') + abi.encodeAddress(userAddr) }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('convertToAssets(uint256)') + abi.encodeUint256('1000000000000000000') }, 'latest'] }
      ]);
      return {
        sharesRaw: r[0] && abi.wordCount(r[0]) >= 1 ? abi.decodeUint(r[0]) : null,
        assetsPerShareRaw: r[1] && abi.wordCount(r[1]) >= 1 ? abi.decodeUint(r[1]) : null
      };
    } catch (e) {
      return null;
    }
  }

  // P3 REDEEM PREVIEWS: the OZ ERC-4626 std views (inherited, verified live in
  // skills/wellstreet-vaults/SKILL.md) — previewRedeem(shares) -> assets out,
  // previewWithdraw(assets) -> shares burned. Honest null on failure: the preview
  // row renders "unavailable (RPC)", never a fabricated figure.
  async function previewRedeem(client, vaultAddr, sharesRaw) {
    if (!isDeployed(vaultAddr) || sharesRaw === null || sharesRaw === undefined) { return null; }
    var abi = root.WS.abi;
    try {
      var raw = await ethCall(client, vaultAddr, abi.selectorOf('previewRedeem(uint256)') + abi.encodeUint256(sharesRaw.toString()));
      return (raw && abi.wordCount(raw) >= 1) ? abi.decodeUint(raw) : null;
    } catch (e) {
      return null;
    }
  }

  async function previewWithdraw(client, vaultAddr, assetsRaw) {
    if (!isDeployed(vaultAddr) || assetsRaw === null || assetsRaw === undefined) { return null; }
    var abi = root.WS.abi;
    try {
      var raw = await ethCall(client, vaultAddr, abi.selectorOf('previewWithdraw(uint256)') + abi.encodeUint256(assetsRaw.toString()));
      return (raw && abi.wordCount(raw) >= 1) ? abi.decodeUint(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // WS-VAULT-DEPOSIT G3 completion (2026-09-13): the deposit side of the same
  // OZ std view family — previewDeposit(assets) -> shares minted. Same honest
  // null contract: a failed read is null, the row renders "unavailable (RPC)",
  // never a fabricated figure.
  async function previewDeposit(client, vaultAddr, assetsRaw) {
    if (!isDeployed(vaultAddr) || assetsRaw === null || assetsRaw === undefined) { return null; }
    var abi = root.WS.abi;
    try {
      var raw = await ethCall(client, vaultAddr, abi.selectorOf('previewDeposit(uint256)') + abi.encodeUint256(assetsRaw.toString()));
      return (raw && abi.wordCount(raw) >= 1) ? abi.decodeUint(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // The share token's decimals() — an immutable contract constant the UI needs
  // to format share figures at their true scale (the RoamVault chassis is
  // 12 decimals, NOT the 18 the legacy formatter assumed). Honest null on
  // failure; the caller fails closed to an em-dash, never to a wrong scale.
  async function readShareDecimals(client, vaultAddr) {
    if (!isDeployed(vaultAddr)) { return null; }
    var abi = root.WS.abi;
    try {
      var raw = await ethCall(client, vaultAddr, abi.selectorOf('decimals()'));
      return (raw && abi.wordCount(raw) >= 1) ? Number(abi.decodeUint(raw)) : null;
    } catch (e) {
      return null;
    }
  }

  // maxDeposit(address) — the vault's own remaining deposit room (pause + cap
  // both read 0 through it; RoamVault.sol:290 ignores the address argument,
  // the zero address is the house convention from the snapshot reader). The
  // deposit flow guards on it; a failed read is null and the flow proceeds —
  // the chain, not the UI, is the final arbiter (a rejected deposit reverts
  // honestly).
  async function readMaxDeposit(client, vaultAddr, ownerAddr) {
    if (!isDeployed(vaultAddr)) { return null; }
    var abi = root.WS.abi;
    try {
      var raw = await ethCall(client, vaultAddr,
        abi.selectorOf('maxDeposit(address)') + abi.encodeAddress(ownerAddr || ZERO_ADDRESS));
      return (raw && abi.wordCount(raw) >= 1) ? abi.decodeUint(raw) : null;
    } catch (e) {
      return null;
    }
  }

  // Factory registry — PENDING_DEPLOY until identity/deploy. Interface candidates are
  // documented deploy-prep verification items (see file header).
  async function readFactoryVaults(client, factoryAddr) {
    if (!isDeployed(factoryAddr)) {
      return { deployed: false, vaults: [], pending: true };
    }
    var abi = root.WS.abi;
    var candidates = ['allVaults()', 'vaultList()'];
    for (var i = 0; i < candidates.length; i++) {
      try {
        var raw = await ethCall(client, factoryAddr, abi.selectorOf(candidates[i]));
        var list = abi.decodeAddressArray(raw);
        if (list) { return { deployed: true, vaults: list, pending: false, interface: candidates[i] }; }
      } catch (e) { /* try next candidate */ }
    }
    return { deployed: true, vaults: [], pending: false, error: 'registry interface not recognized — deploy-prep verification item' };
  }

  // Per-vault snapshot (works only once the vault address is real).
  async function readVaultSnapshot(client, vaultAddr, assetAddr) {
    var abi = root.WS.abi;
    if (!isDeployed(vaultAddr)) {
      return { deployed: false, pending: true, vault: vaultAddr };
    }
    var batch = [
      { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('asset()') }, 'latest'] },
      { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('totalAssets()') }, 'latest'] },
      { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('totalSupply()') }, 'latest'] },
      // depositsPaused() — deposits gate only; redemptions are structurally unpausable (no paused() exists on the vault)
      { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('depositsPaused()') }, 'latest'] },
      { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('pricePerShare()') }, 'latest'] },
      { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('convertToAssets(uint256)') + abi.encodeUint256('1000000000000000000') }, 'latest'] }
    ];
    var r = await client.batch(batch);
    var pps = r[4] && abi.wordCount(r[4]) >= 1 ? abi.decodeUint(r[4]) : null;
    var converted = r[5] && abi.wordCount(r[5]) >= 1 ? abi.decodeUint(r[5]) : null;
    return {
      deployed: true,
      pending: false,
      vault: vaultAddr,
      asset: r[0] ? abi.decodeAddress(r[0]) : assetAddr,
      totalAssets: r[1] ? abi.decodeUint(r[1]) : null,
      totalSupply: r[2] ? abi.decodeUint(r[2]) : null,
      paused: r[3] ? abi.decodeBool(r[3]) : null,
      pricePerShare: pps !== null ? pps : converted,   // 1e18-scaled underlying per share
      pricePerShareSource: pps !== null ? 'pricePerShare()' : (converted !== null ? 'convertToAssets(1e18)' : null)
    };
  }

  // ---------------- WS-MULTI-VAULT-FRONTEND (2026-09-05): the vault family ----------------
  // The site is a MULTI-vault frontend: cfg.vaultFamily carries the flagship (LIVE)
  // plus the DEPLOY-GATED family tiers, and this module reads them. Per-vault reads
  // stay the parameterized readVaultSnapshot above — nothing per-entry is invented
  // here; the family layer only sequences reads and attaches the honest-APR source.

  // The vault's OWN harvest-credit event: `event YieldHarvested(uint256 indexed
  // assets, uint256 newTotalAssets)` (src/YieldShares.sol:81) — emitted once per
  // successful vault-level harvest credit (Harvester.sol:280 -> YieldShares.sol:232).
  // Topic0 is the FULL keccak of the signature, derived at runtime from abi.js's
  // keccak256Hex — the same no-hardcoded-selector convention as every selector here.
  var YIELD_HARVESTED_SIGNATURE = 'YieldHarvested(uint256,uint256)';

  function yieldHarvestedTopic() {
    var abi = root.WS.abi;
    return abi.keccak256Hex(YIELD_HARVESTED_SIGNATURE, true);
  }

  // Honest-APR source #1 (LIVE vaults only): the number of YieldHarvested logs the
  // vault has ever emitted (eth_getLogs on the VAULT address, topic0-filtered —
  // OZ Deposit/Withdraw/Transfer traffic is excluded by the topic). "0" is a REAL
  // state — "no harvests yet", the honest pre-accrual state — while null means the
  // read itself is unavailable. The PENDING_DEPLOY branch NEVER issues the call.
  async function readHarvestCredits(client, vaultAddr) {
    if (!isDeployed(vaultAddr)) { return null; }
    var abi = root.WS.abi;
    try {
      var logs = await client.call('eth_getLogs', [{
        address: vaultAddr,
        topics: [yieldHarvestedTopic()],
        fromBlock: '0x0',
        toBlock: 'latest'
      }]);
      return (logs && typeof logs.length === 'number') ? { count: logs.length, topic0: yieldHarvestedTopic() } : null;
    } catch (e) {
      return null;
    }
  }

  // Read the whole family, one entry at a time. LIVE entries carry the full
  // snapshot PLUS backingCoverage() + the harvest count (the two honest-APR
  // sources); PENDING entries return readVaultSnapshot's { deployed:false,
  // pending:true } state untouched — the gated card renders exactly that, and
  // no eth_call is issued for a PENDING_DEPLOY address (the gates inside the
  // per-vault readers are the guarantee). A failed/unavailable live read stays
  // null — "unavailable (RPC)", never a fabricated figure.
  async function readFamilySnapshots(client, familyEntries) {
    var out = [];
    for (var i = 0; i < familyEntries.length; i++) {
      var entry = familyEntries[i];
      var snap = await readVaultSnapshot(client, entry.vault, entry.asset);
      snap.entryId = entry.id;
      snap.familyStatus = entry.status || (isDeployed(entry.vault) ? 'LIVE' : 'DEPLOY-GATED');
      if (snap.deployed) {
        snap.backingCoverageRaw = await readBackingCoverage(client, entry.vault);
        var credits = await readHarvestCredits(client, entry.vault);
        snap.harvestCount = credits ? credits.count : null;
      }
      out.push(snap);
    }
    return out;
  }

  // ---------------- WS-VAULT-DATA (2026-09-13): the live RoamVault ----------------
  // The protocol-v2 vault (config.roamStack.vault — src/RoamVault.sol, an ERC-4626
  // fork with a DEPLOYED-CAPITAL book). Reads are the SAME D8 pattern as every
  // reader in this file: direct browser eth_calls through the injected rpc client,
  // never an /api/* dependency (the same-origin /api/vault endpoint is the optional
  // enhancement carrying the identical payload — see api/vault.js).
  //
  // CHASSIS FACT (read, never assumed): share decimals = asset decimals + the
  // ERC-4626 virtual offset (RoamVault._decimalsOffset() = 6). With the 6-dec USDG
  // asset the share token reads decimals() = 12 — one whole share = 10^12 raw, and
  // at a 1:1 price raw shares = raw assets × 10^6 (verified live 2026-09-13:
  // totalSupply 12,473,590,000,000 at decimals 12 ↔ totalAssets 12,473,590). The
  // YieldShares flagship chassis (18-dec SPY asset) reads 24 — so NOTHING here
  // hardcodes a share-decimals figure: decimals() is read from the chain and every
  // normalization is parameterized on it.
  //
  // HONEST STATE MODEL: vault.harvester() is address(0) until P3-A executes and
  // deployedBook() is 0 until P3-B executes — BOTH are real on-chain states, not
  // errors. deploymentState() names them ('unbound' | 'idle' | 'deployed') and the
  // renderer must show the truthful state, never a fabricated yield figure.

  // PURE: exact decimal-shift normalization of a raw integer into a decimal string.
  // BigInt end-to-end (no float), trailing zeros trimmed, '0' preserved. Returns
  // { exact, value } or null for null/undefined/non-integer input — fail-closed,
  // never 0-as-fake.
  function normalizeRaw(raw, decimals) {
    if (raw === null || raw === undefined) { return null; }
    var v;
    try {
      v = typeof raw === 'bigint' ? raw : BigInt(String(raw));
    } catch (e) { return null; }
    if (v < 0n) { return null; }
    var d = (decimals === null || decimals === undefined) ? null : Number(decimals);
    if (d === null || !Number.isInteger(d) || d < 0) { return null; }
    var digits = v.toString();
    var exact;
    if (d === 0) {
      exact = digits;
    } else if (digits.length <= d) {
      exact = '0.' + new Array(d - digits.length + 1).join('0') + digits;
    } else {
      exact = digits.slice(0, digits.length - d) + '.' + digits.slice(digits.length - d);
    }
    if (d > 0) { exact = exact.replace(/0+$/, '').replace(/\.$/, ''); }
    if (exact === '') { exact = '0'; }
    return { exact: exact, value: Number(exact) };
  }

  // PURE: share price from the totals — asset BASE UNITS per ONE WHOLE share
  // (10^shareDecimals raw shares), floor-truncated BigInt division. This is the
  // assets/supply form; the LIVE snapshot prefers the contract's own
  // convertToAssets(10^shareDecimals) (same math, and the virtual offset makes an
  // EMPTY vault read 1:1 where this ratio is honestly undefined → null).
  // Verified: RoamVault live 2026-09-13 → 12,473,590 × 10^12 ÷ 12,473,590,000,000
  // = 1,000,000 asset base units per whole share = 1.0 USDG.
  function sharePriceFromTotals(totalAssetsRaw, totalSupplyRaw, shareDecimals) {
    if (totalAssetsRaw === null || totalAssetsRaw === undefined ||
        totalSupplyRaw === null || totalSupplyRaw === undefined) { return null; }
    var d = (shareDecimals === null || shareDecimals === undefined) ? null : Number(shareDecimals);
    if (d === null || !Number.isInteger(d) || d < 0) { return null; }
    var ta = typeof totalAssetsRaw === 'bigint' ? totalAssetsRaw : BigInt(String(totalAssetsRaw));
    var ts = typeof totalSupplyRaw === 'bigint' ? totalSupplyRaw : BigInt(String(totalSupplyRaw));
    if (ta < 0n || ts <= 0n) { return null; }   // empty vault: no honest ratio (use convertToAssets)
    var scale = 1n;
    for (var i = 0; i < d; i++) { scale *= 10n; }
    return (ta * scale) / ts;
  }

  // PURE: cap headroom from DEPOSIT_CAP and totalAssets — the exact _capHeadroom()
  // form (RoamVault.sol:302-305), floored at 0. Independent of the pause flag:
  // when deposits are paused maxDeposit() reads 0 while the HEADROOM is still a
  // real capacity fact — both are surfaced separately.
  function deriveCapHeadroom(depositCapRaw, totalAssetsRaw) {
    if (depositCapRaw === null || depositCapRaw === undefined ||
        totalAssetsRaw === null || totalAssetsRaw === undefined) { return null; }
    try {
      var cap = typeof depositCapRaw === 'bigint' ? depositCapRaw : BigInt(String(depositCapRaw));
      var ta = typeof totalAssetsRaw === 'bigint' ? totalAssetsRaw : BigInt(String(totalAssetsRaw));
      if (cap < 0n || ta < 0n) { return null; }
      return cap > ta ? cap - ta : 0n;
    } catch (e) { return null; }
  }

  // PURE: the honest capital state. 'unbound' — harvester() is address(0), P3-A
  // pending, ALL capital idle by construction. 'idle' — bound, nothing deployed
  // yet (P3-B pending). 'deployed' — the deployed book is non-zero. Any null read
  // → 'unknown' (renders as unavailable, never as a fabricated state).
  var ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  function deploymentState(harvesterAddr, deployedBookRaw) {
    if (typeof harvesterAddr !== 'string' || deployedBookRaw === null || deployedBookRaw === undefined) {
      return 'unknown';
    }
    var unbound = harvesterAddr === ZERO_ADDRESS;
    var deployed;
    try {
      deployed = (typeof deployedBookRaw === 'bigint' ? deployedBookRaw : BigInt(String(deployedBookRaw))) > 0n;
    } catch (e) { return 'unknown'; }
    if (unbound) return 'unbound';
    return deployed ? 'deployed' : 'idle';
  }

  // Selector set (derived from src/RoamVault.sol signatures at runtime via
  // abi.selectorOf — the no-hardcoded-selector convention; the derived values were
  // verified live 2026-09-13). maxDeposit(address) ignores its argument on this
  // contract — the zero address is passed (RoamVault.sol:290).
  function roamSelectors() {
    var abi = root.WS.abi;
    return {
      asset: abi.selectorOf('asset()'),
      decimals: abi.selectorOf('decimals()'),
      totalAssets: abi.selectorOf('totalAssets()'),
      totalSupply: abi.selectorOf('totalSupply()'),
      idleBook: abi.selectorOf('idleBook()'),
      deployedBook: abi.selectorOf('deployedBook()'),
      backingCoverage: abi.selectorOf('backingCoverage()'),
      depositsPaused: abi.selectorOf('depositsPaused()'),
      maxDeposit: abi.selectorOf('maxDeposit(address)'),
      depositCap: abi.selectorOf('DEPOSIT_CAP()'),
      harvester: abi.selectorOf('harvester()'),
      convertToAssets: abi.selectorOf('convertToAssets(uint256)')
    };
  }

  // One fail-closed word decode: a Uint only when the payload carries a full word.
  function wordUint(abi, raw) {
    return (raw && abi.wordCount(raw) >= 1) ? abi.decodeUint(raw, 0) : null;
  }
  function wordBool(abi, raw) {
    return (raw && abi.wordCount(raw) >= 1) ? abi.decodeBool(raw, 0) : null;
  }
  function wordAddress(abi, raw) {
    return (raw && abi.wordCount(raw) >= 1) ? abi.decodeAddress(raw, 0) : null;
  }

  // The live RoamVault snapshot. cfg: { vault, asset } (config.roamStack — the
  // vault address gates EVERY call: a PENDING/invalid address issues NO eth_call).
  // Round 1: eleven parallel views in ONE client.batch; round 2 (dependent): the
  // whole-share price convertToAssets(10^shareDecimals) + the asset token's own
  // VERIFIED decimals() (never an assumed shift — the vaults.js convention).
  // Fail-closed: a thrown batch → null (the caller renders "unavailable" — never
  // zeros); a per-field empty/short payload → null for that field only. harvester()
  // = address(0) is a FACT (unbound), preserved, not nulled.
  async function readRoamVaultSnapshot(client, cfg) {
    var abi = root.WS.abi;
    var vaultAddr = cfg && cfg.vault;
    if (!isDeployed(vaultAddr)) {
      return { deployed: false, pending: true, vault: vaultAddr };
    }
    var sel = roamSelectors();
    var ZERO_ARG = abi.encodeAddress(ZERO_ADDRESS);
    var r;
    try {
      r = await client.batch([
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.asset }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.decimals }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.totalAssets }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.totalSupply }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.idleBook }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.deployedBook }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.backingCoverage }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.depositsPaused }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.maxDeposit + ZERO_ARG }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.depositCap }, 'latest'] },
        { method: 'eth_call', params: [{ to: vaultAddr, data: sel.harvester }, 'latest'] }
      ]);
    } catch (e) {
      return null;   // the whole read failed — honest unavailability, never zeros
    }
    var shareDecimalsRaw = wordUint(abi, r[1]);
    var shareDecimals = shareDecimalsRaw === null ? null : Number(shareDecimalsRaw);
    var snap = {
      deployed: true,
      pending: false,
      vault: vaultAddr,
      asset: wordAddress(abi, r[0]) || (cfg.asset || null),
      shareDecimals: shareDecimals,
      totalAssetsRaw: wordUint(abi, r[2]),
      totalSupplyRaw: wordUint(abi, r[3]),
      idleRaw: wordUint(abi, r[4]),
      deployedRaw: wordUint(abi, r[5]),
      backingCoverageRaw: wordUint(abi, r[6]),
      depositsPaused: wordBool(abi, r[7]),
      maxDepositRaw: wordUint(abi, r[8]),
      depositCapRaw: wordUint(abi, r[9]),
      harvester: wordAddress(abi, r[10]),
      pricePerShareRaw: null,
      pricePerShareSource: null,
      assetDecimals: null,
      errors: []
    };
    snap.capHeadroomRaw = deriveCapHeadroom(snap.depositCapRaw, snap.totalAssetsRaw);
    snap.deploymentState = deploymentState(snap.harvester, snap.deployedRaw);

    // Dependent reads: the price input is 10^shareDecimals (unknown decimals → the
    // price stays null, honestly), and the asset's own decimals() is verified.
    if (Number.isInteger(shareDecimals) && shareDecimals > 0) {
      var scale = '1';
      for (var i = 0; i < shareDecimals; i++) { scale += '0'; }
      try {
        var r2 = await client.batch([
          { method: 'eth_call', params: [{ to: vaultAddr, data: sel.convertToAssets + abi.encodeUint256(scale) }, 'latest'] },
          { method: 'eth_call', params: [{ to: snap.asset, data: sel.decimals }, 'latest'] }
        ]);
        snap.pricePerShareRaw = wordUint(abi, r2[0]);
        snap.pricePerShareSource = snap.pricePerShareRaw !== null ? 'convertToAssets(10^shareDecimals)' : null;
        var assetDecRaw = wordUint(abi, r2[1]);
        snap.assetDecimals = assetDecRaw === null ? null : Number(assetDecRaw);
      } catch (e) {
        snap.errors.push({ field: 'pricePerShare', error: String((e && e.message) || e) });
      }
    } else {
      snap.errors.push({ field: 'pricePerShare', error: 'share decimals unavailable — the whole-share price input is unknown' });
    }
    return snap;
  }

  // PURE: the dashboard-normalized snapshot — exact decimal strings at each
  // figure's own denomination (assets/cap/headroom at the VERIFIED asset
  // decimals, shares at the VERIFIED share decimals, price normalized at the
  // asset decimals). Every field fail-closed to null when its input is null —
  // the renderer turns null into "—", never a zero.
  function normalizeRoamSnapshot(snap) {
    if (!snap || !snap.deployed) { return null; }
    var assetDec = Number.isInteger(snap.assetDecimals) ? snap.assetDecimals : null;
    var shareDec = Number.isInteger(snap.shareDecimals) ? snap.shareDecimals : null;
    function norm(raw, dec) {
      if (raw === null || raw === undefined || dec === null) { return null; }
      var n = normalizeRaw(raw, dec);
      return n === null ? null : n.exact;
    }
    return {
      vault: snap.vault,
      totalAssets: norm(snap.totalAssetsRaw, assetDec),
      totalShares: norm(snap.totalSupplyRaw, shareDec),
      sharePrice: norm(snap.pricePerShareRaw, assetDec),
      idle: norm(snap.idleRaw, assetDec),
      deployed: norm(snap.deployedRaw, assetDec),
      depositCap: norm(snap.depositCapRaw, assetDec),
      capHeadroom: norm(snap.capHeadroomRaw, assetDec),
      maxDeposit: norm(snap.maxDepositRaw, assetDec),
      coveragePct: formatCoveragePct(snap.backingCoverageRaw === null ? null : '0x' + snap.backingCoverageRaw.toString(16).padStart(64, '0')),
      depositsPaused: snap.depositsPaused === null ? null : !!snap.depositsPaused,
      deploymentState: snap.deploymentState || 'unknown',
      harvester: snap.harvester === undefined ? null : snap.harvester,
      shareDecimals: shareDec,
      assetDecimals: assetDec
    };
  }

  // ---------------- WS-VAULT-DASHBOARD (2026-09-13): the governance read ----
  // readyAt(bytes32) on the treasury timelock — the LIVE queue state of a
  // queued owner op (src/WellstreetTimelock.sol:37: mapping(bytes32 => uint256)
  // public readyAt; queue() sets it, cancel()/execute() DELETE it — so 0 means
  // "no longer queued", which is executed OR cancelled and is disambiguated
  // only by the public CallExecuted/CallCancelled events or by the op's own
  // effect state on the vault). Selector derived from the signature at runtime
  // (the no-hardcoded-selector convention); the id argument is a full 32-byte
  // hex (config.roamStack.governance.queued[].id — never an ellipsis).
  function timelockSelectors() {
    var abi = root.WS.abi;
    return { readyAt: abi.selectorOf('readyAt(bytes32)') };
  }

  // One fail-closed read: the readyAt word (bigint seconds) for a queued op id,
  // or null when the timelock address is not deployed, the id is not a full
  // 32-byte hex, the call fails, or the decode is empty — the caller renders
  // "unavailable", never a guessed state.
  async function readTimelockReadyAt(client, timelockAddr, id) {
    if (!isDeployed(timelockAddr)) { return null; }
    if (typeof id !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(id)) { return null; }
    var abi = root.WS.abi;
    try {
      var raw = await ethCall(client, timelockAddr, timelockSelectors().readyAt + abi.encodeUint256(id));
      return (raw && abi.wordCount(raw) >= 1) ? abi.decodeUint(raw, 0) : null;
    } catch (e) {
      return null;
    }
  }

  // PURE: the governance status of a queued op from its LIVE readyAt word.
  //   'queued'     — the 48h window is still open (readyAt > now)
  //   'executable' — the delay has passed; execute is PERMISSIONLESS
  //                  (WellstreetTimelock.sol:106 — anyone may land it)
  //   'not-queued' — readyAt deleted: executed or cancelled (the renderer
  //                  cross-checks the op's effect state to say which)
  //   'unknown'    — a null read renders unavailable, never a guess
  function governanceStatus(readyAtRaw, nowSec) {
    if (readyAtRaw === null || readyAtRaw === undefined ||
        nowSec === null || nowSec === undefined) { return 'unknown'; }
    var r;
    try { r = typeof readyAtRaw === 'bigint' ? readyAtRaw : BigInt(String(readyAtRaw)); }
    catch (e) { return 'unknown'; }
    if (r < 0n) { return 'unknown'; }
    if (r === 0n) { return 'not-queued'; }
    return nowSec >= Number(r) ? 'executable' : 'queued';
  }

  // PURE: a live readyAt word -> the honest UTC "YYYY-MM-DD HH:MM" string,
  // or null when the read is absent (the date row drops, never a guess).
  function formatReadyAt(readyAtRaw) {
    if (readyAtRaw === null || readyAtRaw === undefined) { return null; }
    var r;
    try { r = typeof readyAtRaw === 'bigint' ? readyAtRaw : BigInt(String(readyAtRaw)); }
    catch (e) { return null; }
    if (r <= 0n) { return null; }
    var ms = Number(r) * 1000;
    if (!isFinite(ms)) { return null; }
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }

  return {
    PENDING: PENDING,
    isDeployed: isDeployed,
    decodeSlot0: decodeSlot0,
    priceFromSqrtPriceX96: priceFromSqrtPriceX96,
    decodeLatestRoundData: decodeLatestRoundData,
    feeCutFromNibbles: feeCutFromNibbles,
    readUnderlying: readUnderlying,
    readPriceUsd: readPriceUsd,
    readPoolSnapshot: readPoolSnapshot,
    readFactoryVaults: readFactoryVaults,
    readVaultSnapshot: readVaultSnapshot,
    yieldHarvestedTopic: yieldHarvestedTopic,
    readHarvestCredits: readHarvestCredits,
    readFamilySnapshots: readFamilySnapshots,
    decodeBackingCoverage: decodeBackingCoverage,
    formatCoveragePct: formatCoveragePct,
    readBackingCoverage: readBackingCoverage,
    readDepositsPaused: readDepositsPaused,
    readPosition: readPosition,
    previewRedeem: previewRedeem,
    previewWithdraw: previewWithdraw,
    // WS-VAULT-DEPOSIT G3 completion (2026-09-13): the deposit-side preview +
    // the scale/room readers the money path formats and guards with
    previewDeposit: previewDeposit,
    readShareDecimals: readShareDecimals,
    readMaxDeposit: readMaxDeposit,
    // WS-VAULT-DATA (2026-09-13): the live RoamVault layer
    normalizeRaw: normalizeRaw,
    sharePriceFromTotals: sharePriceFromTotals,
    deriveCapHeadroom: deriveCapHeadroom,
    deploymentState: deploymentState,
    roamSelectors: roamSelectors,
    readRoamVaultSnapshot: readRoamVaultSnapshot,
    normalizeRoamSnapshot: normalizeRoamSnapshot,
    // WS-VAULT-DASHBOARD (2026-09-13): the governance read layer
    timelockSelectors: timelockSelectors,
    readTimelockReadyAt: readTimelockReadyAt,
    governanceStatus: governanceStatus,
    formatReadyAt: formatReadyAt
  };
});
