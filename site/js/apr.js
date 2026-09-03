/*
 * Wellstreet site — apr.js
 * Depositor APR derived CLIENT-SIDE from live pool data. Honest voice throughout:
 *
 *   projected depositor APR =                                    (RATIFIED 2026-09-03)
 *       pool_net_fee_APR × (L_pos / L_pool) × (pool_TVL / vault_TVL) × 0.9
 *
 *   — the liquidity-share form of the 2026-09-03 GO/NO-GO gate
 *   (docs/internal/GO_NO_GO_PACKET_2026-09-03.md §3; the 0.9 leg is the
 *   1 − protocol_fee with the initial 1000 bps). The superseded 2026-08-30
 *   TVL-share form (LP_TVL / vault_TVL) is retired.
 *
 *   pool_net_fee_APR = gross fee APR from the pool's OWN Swap events
 *                      × (1 − protocol cut), where the cut is decoded LIVE from the
 *                      pool's slot0 feeProtocol word (never assumed).
 *
 * NOTHING here is a hardcoded pool-level APR presented as the product's yield:
 *  - the live path samples the pool's recent Swap events by chunked eth_getLogs and
 *    computes the two-sided volume per the RATIFIED sampling protocol
 *    (docs/ops/phase0/pool-apr.md §0: Σ|amount0| + Σ|amount1| ÷ P_w, P_w from the
 *    FIRST swap in the window; median-of-windows aggregation; the MAX window is
 *    forbidden; windows with <20 Swap events or incomplete retrieval are EXCLUDED).
 *  - when live sampling is unavailable, the clearly-labeled phase-0 measured
 *    baseline (median of Tue–Thu 14:00–16:00 UTC windows, net of the decoded cut)
 *    feeds the SAME formula — labeled as an evidence-file input, not live data.
 *  - the pool-level figure is shown ONLY as a methodology input; the headline
 *    number is always depositor-side, labeled "projected, methodology-linked".
 *
 * Label (required): "projected, methodology-linked".
 */
(function (root, factory) {
  var api = factory(root);
  root.WS = root.WS || {};
  root.WS.apr = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function (root) {
  'use strict';

  var LABEL = 'projected, methodology-linked';

  var METHODOLOGY_FOOTNOTE =
    'Projected depositor APR = pool net fee APR × (L_pos ÷ L_pool) × (pool TVL ÷ vault TVL) × (1 − protocol fee) — ' +
    'the liquidity-share form ratified at the 2026-09-03 GO/NO-GO gate. ' +
    'The pool net fee APR input is derived client-side from the pool\'s own Swap events over a recent window ' +
    '(two-sided volume per the ratified sampling protocol; the protocol cut is read live from the pool\'s ' +
    'slot0 feeProtocol word). When live sampling is unavailable, the labeled phase-0 measured baseline ' +
    '(median of the ratified 2h weekday-peak windows, 2026-08-25..27, net of the decoded 1/4-per-side cut: ' +
    '40.310%/yr) feeds the same formula. The liquidity share (L_pos ÷ L_pool), the pool-TVL basis and the ' +
    'launch-era vault TVL expectation are the ratified GO/NO-GO pins: full-range at launch, LP seed 1% of ' +
    'pool TVL, vault TVL ≈ $58k launch expectation, depositor-APR floor 0.10%/yr at full-range. This is a ' +
    'projection, not a promise: fee income varies with swap activity, each depositor dilutes the same income, ' +
    'the harvester LP is not yet deployed (the ratified seed pin is used), the pool owner can change the ' +
    'protocol cut, and TVL is read at page-load time (the documented phase-0 approximation). At full-range ' +
    'with realistic vault TVL the projection is basis points — stated plainly, never spectacularized. ' +
    'Full methodology: the APR methodology doc in the docs tab (docs/public/methodology.md).';

  // ------------------------------------------------------------------
  // PURE: net multiplier / cut from slot0 feeProtocol nibbles.
  // ------------------------------------------------------------------
  function netMultiplierFromNibbles(n0, n1) {
    var cut0 = n0 > 0 ? 1 / n0 : 0;
    var cut1 = n1 > 0 ? 1 / n1 : 0;
    var equal = n0 === n1;
    var cut = equal ? cut0 : Math.max(cut0, cut1); // conservative if unequal
    return {
      cutFraction: cut,
      netMultiplier: 1 - cut,
      equal: equal,
      note: equal ? null : 'unequal feeProtocol nibbles — conservative (higher-cut) side used'
    };
  }

  // PURE: annualized gross fee APR (%) from window fee income, TVL, window length.
  // Matches the ratified formula chain: fee_weth / TVL × (365×86400 / windowSeconds).
  function annualizeGrossAprPct(feeToken0, tvlToken0, windowSeconds, yearSeconds) {
    var YEAR = yearSeconds || 365 * 86400;
    if (!(tvlToken0 > 0) || !(windowSeconds > 0) || feeToken0 === null || feeToken0 === undefined) {
      return null;
    }
    return (feeToken0 / tvlToken0) * (YEAR / windowSeconds) * 100;
  }

  // PURE: depositor APR (%) — the product figure. RATIFIED liquidity-share form
  // (2026-09-03 GO/NO-GO gate §3): pool_net × (L_pos/L_pool) × (pool_TVL/vault_TVL)
  // × (1 − protocol_fee). `liquidityShare` is L_pos/L_pool as a fraction; the
  // pool_TVL/vault_TVL leg arrives pre-derived (poolTvlOverVaultTvl) so this
  // function stays a pure multiplication of declared inputs.
  function depositorAprPct(poolNetAprPct, liquidityShare, poolTvlOverVaultTvl, protocolFeeBps) {
    if (poolNetAprPct === null || poolNetAprPct === undefined) { return null; }
    if (poolTvlOverVaultTvl === null || poolTvlOverVaultTvl === undefined || !(poolTvlOverVaultTvl > 0)) { return null; }
    var share = liquidityShare || 0;
    return poolNetAprPct * share * poolTvlOverVaultTvl * (1 - (protocolFeeBps || 0) / 10000);
  }

  // ------------------------------------------------------------------
  // PURE: compute a window's APR from decoded Swap logs.
  // opts: { feeTier, windowSeconds, tvlToken0, minEvents (default 20),
  //         netMultiplier (or n0/n1 nibbles), yearSeconds }
  // Each log.data = 5 words: int256 amount0, int256 amount1, uint160 sqrtPriceX96,
  // uint128 liquidity, int24 tick (verified Swap ABI). token0 = WETH, 18 decimals.
  // ------------------------------------------------------------------
  function computeWindowAprFromLogs(logs, opts) {
    var abi = root.WS.abi;
    var minEvents = opts.minEvents == null ? 20 : opts.minEvents;
    var events = Array.isArray(logs) ? logs.length : 0;

    if (events < minEvents) {
      return {
        excluded: true,
        reason: 'insufficient observations: ' + events + ' Swap events < ratified minimum ' + minEvents
      };
    }
    if (!(opts.windowSeconds > 0)) {
      return { excluded: true, reason: 'invalid window length' };
    }

    // Two's-complement decode of the two signed amount words; P_w from the FIRST log.
    function i256(word) {
      var v = BigInt(word);
      return v >= (1n << 255n) ? v - (1n << 256n) : v;
    }

    var sumAbsA0 = 0n;
    var sumAbsA1 = 0n;
    var pricePw = null;
    for (var i = 0; i < logs.length; i++) {
      var data = logs[i].data || '0x';
      var a0 = i256(abi.word(data, 0) || '0x0');
      var a1 = i256(abi.word(data, 1) || '0x0');
      sumAbsA0 += a0 < 0n ? -a0 : a0;
      sumAbsA1 += a1 < 0n ? -a1 : a1;
      if (i === 0) {
        var sqrt = BigInt(abi.word(data, 2) || '0x0');
        var vault = root.WS && root.WS.vault;
        pricePw = vault
          ? vault.priceFromSqrtPriceX96(sqrt)
          : Number(((sqrt * sqrt * 1000000000000000000n) / (1n << 192n))) / 1e18;
      }
    }
    if (!(pricePw > 0)) {
      return { excluded: true, reason: 'invalid window-start price P_w' };
    }

    // Two-sided volume in token0 units (stock leg converted at P_w — ratified protocol)
    var volumeToken0 = (Number(sumAbsA0) + Number(sumAbsA1) / pricePw) / 1e18;
    var feeToken0 = volumeToken0 * ((opts.feeTier || 0) / 1e6);
    var grossAprPct = annualizeGrossAprPct(feeToken0, opts.tvlToken0, opts.windowSeconds, opts.yearSeconds);
    if (grossAprPct === null) {
      return { excluded: true, reason: 'invalid TVL basis' };
    }

    var mult;
    if (opts.netMultiplier != null) {
      mult = { netMultiplier: opts.netMultiplier, cutFraction: 1 - opts.netMultiplier, equal: true, note: null };
    } else {
      mult = netMultiplierFromNibbles(opts.n0 || 0, opts.n1 || 0);
    }
    var netAprPct = grossAprPct * mult.netMultiplier;

    return {
      excluded: false,
      events: events,
      volumeToken0: volumeToken0,
      feeToken0: feeToken0,
      pricePw: pricePw,
      windowSeconds: opts.windowSeconds,
      grossAprPct: grossAprPct,
      cutFraction: mult.cutFraction,
      netAprPct: netAprPct,
      cutNote: mult.note
    };
  }

  // ------------------------------------------------------------------
  // LIVE SAMPLING (browser): recent rolling window of Swap events via chunked
  // eth_getLogs (adaptive halving on failure — the phase-0-proven pattern).
  // ANY chunk that fails irrecoverably excludes the WHOLE window (ratified rule:
  // incomplete log retrieval = exclusion). Window length is taken from the actual
  // first/last block timestamps, not a nominal value.
  // ------------------------------------------------------------------
  var SWAP_TOPIC0 = '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67';

  async function fetchWindowLogs(client, poolAddress, fromBlock, toBlock, o) {
    var chunk = o.chunkBlocks;
    var lo = fromBlock;
    var all = [];
    while (lo <= toBlock) {
      var hi = Math.min(lo + chunk - 1, toBlock);
      var done = false;
      var halvings = 0;
      while (!done) {
        try {
          var logs = await client.call('eth_getLogs', [{
            fromBlock: '0x' + lo.toString(16),
            toBlock: '0x' + hi.toString(16),
            address: poolAddress,
            topics: [SWAP_TOPIC0]
          }]);
          all = all.concat(logs || []);
          if (all.length > o.maxLogs) {
            return { ok: false, reason: 'too many Swap events in window (>' + o.maxLogs + ') — window excluded' };
          }
          done = true;
        } catch (err) {
          halvings++;
          if (chunk <= 200 || halvings > 4) {
            return { ok: false, reason: 'log retrieval incomplete — window excluded (ratified rule)' };
          }
          chunk = Math.floor(chunk / 2);
        }
      }
      lo = hi + 1;
    }
    return { ok: true, logs: all };
  }

  // Samples the most recent `windowSeconds` of pool activity and returns the full
  // derivation breakdown. Returns {ok:false, reason} on any exclusion.
  async function samplePoolApr(client, cfg, poolCfg, tvlToken0, opts) {
    opts = opts || {};
    var methodology = cfg.aprMethodology;
    var windowSeconds = opts.windowSeconds || methodology.windowSeconds;
    var blockTimeSec = cfg.chain.blockTimeMs / 1000;
    var windowBlocks = Math.max(2, Math.round(windowSeconds / blockTimeSec));

    var latestHex = await client.call('eth_blockNumber', []);
    var latest = Number(BigInt(latestHex));
    var fromBlock = Math.max(1, latest - windowBlocks + 1);

    var fetched = await fetchWindowLogs(client, poolCfg.address, fromBlock, latest, {
      chunkBlocks: opts.chunkBlocks || methodology.chunkBlocks,
      maxLogs: methodology.maxLogs
    });
    if (!fetched.ok) { return { ok: false, reason: fetched.reason }; }

    // Actual window length from block timestamps (two extra reads, more honest than
    // assuming the block-time constant).
    var firstBlock = await client.call('eth_getBlockByNumber', ['0x' + fromBlock.toString(16), false]);
    var lastBlock = await client.call('eth_getBlockByNumber', ['0x' + latest.toString(16), false]);
    var t0 = firstBlock && firstBlock.timestamp ? Number(BigInt(firstBlock.timestamp)) : null;
    var t1 = lastBlock && lastBlock.timestamp ? Number(BigInt(lastBlock.timestamp)) : null;
    if (!t0 || !t1 || t1 <= t0) {
      return { ok: false, reason: 'could not establish window timestamps — window excluded' };
    }
    var actualSeconds = t1 - t0;

    var tier = poolCfg.feeTier != null ? poolCfg.feeTier : methodology.phase0Baseline.feeTier;
    var result = computeWindowAprFromLogs(fetched.logs, {
      feeTier: tier,
      windowSeconds: actualSeconds,
      tvlToken0: tvlToken0,
      minEvents: methodology.minSwapEvents,
      yearSeconds: methodology.yearSeconds
    });
    if (result.excluded) { return { ok: false, reason: result.reason }; }

    // Live cut from the pool snapshot the caller supplies (poolCfg.cut), if present.
    if (poolCfg.cut) {
      result.cutFraction = poolCfg.cut.cutFraction;
      result.netAprPct = result.grossAprPct * poolCfg.cut.netMultiplier;
    }

    result.window = { fromBlock: fromBlock, toBlock: latest, fromTime: t0, toTime: t1 };
    result.source = 'live-sample';
    result.ok = true;
    return result;
  }

  // ------------------------------------------------------------------
  // The full depositor chain from any pool-net input (live or labeled baseline).
  // Consumes the ratified pins (config.aprPins): liquidityShareFullRange ×
  // (poolTvlWethBasis × wethUsdContextAnchor) / targetVaultTvlUsd — every leg a
  // declared pin, nothing derived here beyond the declared division.
  // ------------------------------------------------------------------
  function projectDepositorApr(poolNetAprPct, pins, economics) {
    var poolTvlUsdBasis = (pins.poolTvlWethBasis || 0) * (pins.wethUsdContextAnchor || 0);
    var poolTvlOverVaultTvl = (pins.targetVaultTvlUsd > 0) ? poolTvlUsdBasis / pins.targetVaultTvlUsd : null;
    var depositor = depositorAprPct(
      poolNetAprPct,
      pins.liquidityShareFullRange,
      poolTvlOverVaultTvl,
      economics.protocolFeeBpsInitial
    );
    return {
      label: LABEL,
      poolNetAprPct: poolNetAprPct,
      liquidityShare: pins.liquidityShareFullRange,
      lpSeedPctOfPool: pins.lpSeedPctOfPool,
      poolTvlUsdBasis: poolTvlUsdBasis,
      poolTvlOverVaultTvl: poolTvlOverVaultTvl,
      targetVaultTvlUsd: pins.targetVaultTvlUsd,
      protocolFeeBps: economics.protocolFeeBpsInitial,
      depositorAprPct: depositor
    };
  }

  return {
    LABEL: LABEL,
    METHODOLOGY_FOOTNOTE: METHODOLOGY_FOOTNOTE,
    SWAP_TOPIC0: SWAP_TOPIC0,
    netMultiplierFromNibbles: netMultiplierFromNibbles,
    annualizeGrossAprPct: annualizeGrossAprPct,
    depositorAprPct: depositorAprPct,
    computeWindowAprFromLogs: computeWindowAprFromLogs,
    fetchWindowLogs: fetchWindowLogs,
    samplePoolApr: samplePoolApr,
    projectDepositorApr: projectDepositorApr
  };
});
