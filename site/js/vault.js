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
      { method: 'eth_call', params: [{ to: vaultAddr, data: abi.selectorOf('paused()') }, 'latest'] },
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
    decodeBackingCoverage: decodeBackingCoverage,
    formatCoveragePct: formatCoveragePct,
    readBackingCoverage: readBackingCoverage,
    readDepositsPaused: readDepositsPaused,
    readPosition: readPosition,
    previewRedeem: previewRedeem,
    previewWithdraw: previewWithdraw
  };
});
