/*
 * Wellstreet — site configuration. THE single source of truth.
 *
 * Everything the static site reads/writes is declared here:
 *   - chain + RPC endpoints (with the duplicate-CORS-header mitigation policy)
 *   - verified contract addresses (phase-0 evidence: docs/ops/phase0/pool-apr.md, tokens-oracle-rpc.md)
 *   - PENDING_DEPLOY placeholders for not-yet-deployed contracts (vault factory, vault,
 *     harvester, treasury timelock) — every consumer MUST treat these as undeployed and
 *     render an honest pending state, never a fabricated number.
 *   - share naming convention (ws-SPY / "Wellstreet SPY")
 *   - ratified economics pins (GO/NO-GO gate 2026-08-30) used by the APR projection
 *   - docs tab path mapping (markdown files are fetched at RUNTIME from a relative path —
 *     IPFS-ready; for deploys, the docs/public tree is copied alongside site/)
 *
 * Zero dependencies. Loaded as a plain <script> before every other module.
 */
(function (root, factory) {
  var api = factory();
  root.WS = root.WS || {};
  root.WS.config = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  var PENDING_DEPLOY = 'PENDING_DEPLOY';

  var config = {

    branding: {
      name: 'Wellstreet',
      protocol: 'Wellstreet — open-source yield vaults for tokenized stocks',
      domain: 'wellstreet.tech',
      ensName: 'wellstreet.eth',
      license: 'MIT',
      repoUrl: 'PENDING_IDENTITY',   // fresh GitHub identity — wired at identity ops, never before
      // Trademark honesty note (rendered in the footer):
      trademarkNote: 'Wellstreet is not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc. ' +
        'or State Street Corporation (SPDR). On-chain asset names (for example the "Robinhood Token" suffix) are ' +
        'referenced strictly as asset identifiers.'
    },

    chain: {
      id: 4663,
      idHex: '0x1237',
      name: 'Robinhood Chain',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      blockTimeMs: 101.1,            // phase-0 measured: ~101.1 ms/block (3 span anchors)
      explorerBase: 'https://robinhoodchain.blockscout.com',
      explorerTx: function (hash) { return this.explorerBase + '/tx/' + hash; },
      explorerAddress: function (addr) { return this.explorerBase + '/address/' + addr; },
      addChainParams: {
        chainId: '0x1237',
        chainName: 'Robinhood Chain',
        nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
        rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
        blockExplorerUrls: ['https://robinhoodchain.blockscout.com']
      }
    },

    // ------------------------------------------------------------------
    // RPC endpoints, in failover order.
    //   primary   — the chain's public RPC. Phase-0 probe (e) found that Chromium
    //               intermittently rejects it with "The 'Access-Control-Allow-Origin'
    //               header contains multiple values '*,*'" (~47% of page loads,
    //               always mid-sequence; invisible to curl). The fetch layer MUST
    //               retry (the block is intermittent per response) and fail over.
    //   secondary — Blockscout eth-rpc. 429-limited under load in phase-0; browser
    //               CORS undetermined (masked by 429). Re-probe before relying on it.
    // The retry/failover policy lives in js/rpc.js and is unit-tested.
    // ------------------------------------------------------------------
    rpc: {
      endpoints: [
        'https://rpc.mainnet.chain.robinhood.com',
        'https://robinhoodchain.blockscout.com/api/eth-rpc'
      ],
      attemptsPerEndpoint: 3,       // fetch retry (3 attempts, exponential backoff) per endpoint
      backoffBaseMs: 250,           // 250ms -> 500ms -> 1000ms
      backoffCapMs: 4000,
      timeoutMs: 20000,
      batchMaxCalls: 16             // JSON-RPC batch size cap for batched eth_calls
    },

    // ------------------------------------------------------------------
    // Verified addresses (Blockscout-verified sources + on-chain re-verification,
    // docs/ops/phase0/*.md). Hex casing preserved as verified; comparisons in code
    // are case-insensitive.
    // ------------------------------------------------------------------
    contracts: {
      weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
      swapRouter02: '0xCaf681a66D020601342297493863E78C959E5cb2',   // verified live (exactInputSingle observed)
      quoterV2: '0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7',
      // NOT DEPLOYED YET — honest placeholders. Any UI consumer must render
      // "pending deploy" and disable write flows. Never substitute a real-looking hex.
      vaultFactory: PENDING_DEPLOY,
      treasuryTimelock: PENDING_DEPLOY,
      harvester: PENDING_DEPLOY
    },

    tokens: {
      weth: {
        address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
        symbol: 'WETH',
        decimals: 18,
        label: 'Wrapped Ether'
      },
      spy: {
        address: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c',
        symbol: 'SPY',
        decimals: 18,
        // Honest identifier framing (trademark note): asset identifier only.
        label: 'SPDR S&P 500 ETF Trust (on-chain stock token)'
      }
    },

    // Verified pool: SPY has exactly ONE pool on this chain — tier 500
    // (getPool across 10000/3000/500/100 → only 500 exists; docs/ops/phase0/pool-apr.md §2.1)
    pools: {
      spyWeth500: {
        id: 'spyWeth500',
        address: '0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e',
        feeTier: 500,
        token0: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',   // WETH (address-ordered)
        token1: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c',   // SPY
        label: 'SPY / WETH (0.05%)'
      }
    },

    // Chainlink equity feed (probe (f): readable, NOT permissioned, 8 decimals).
    // Both proxies front the SAME aggregator; record BOTH per the phase-0 evidence rule.
    // Feeds update 24/5 — weekend/holiday staleness is EXPECTED, not a fault.
    priceFeeds: {
      spyUsd: {
        label: 'RHSPY / USD',
        decimals: 8,
        proxies: [
          '0x319724394D3A0e3669269846abE664Cd621f9f6A',
          '0xa68CA83408bE3f78d1c58a82081c619e9d21486d'
        ]
      }
    },

    // ------------------------------------------------------------------
    // Vault registry (frontend view of the protocol). Vault #1 = SPY (ratified at the
    // GO/NO-GO gate). `vault` is PENDING_DEPLOY until the contracts package lands —
    // every consumer renders the honest pending state for it.
    // ------------------------------------------------------------------
    vaults: [
      {
        id: 'ws-spy',
        displayName: 'Wellstreet SPY',
        shareSymbol: 'ws-SPY',
        vault: PENDING_DEPLOY,
        asset: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c',
        pool: 'spyWeth500',
        chainlinkFeed: 'spyUsd'
      }
    ],

    // ------------------------------------------------------------------
    // Share naming convention (used identically in contract deploy args, docs, frontend):
    //   display name "Wellstreet <ASSET>", share symbol "ws-<ASSET>".
    // ------------------------------------------------------------------
    shareNaming: {
      pattern: 'ws-{ASSET}',
      displayNamePattern: 'Wellstreet {ASSET}',
      example: 'ws-SPY'
    },

    // ------------------------------------------------------------------
    // Economics (locked spec D + GATE AMENDMENT D12 context):
    //   protocol fee is TIMELOCK-SETTABLE within MAX_FEE_BPS=2000; INITIAL 1000 bps
    //   (10% protocol / 90% depositors). The deployed contract value is authoritative
    //   once live; these are the documented initial values until then.
    //   harvesterTipBps: 0.1% tip to the permissionless harvest caller, deducted from
    //   the protocol share (Decision E).
    // ------------------------------------------------------------------
    economics: {
      maxFeeBps: 2000,
      protocolFeeBpsInitial: 1000,
      harvesterTipBps: 10
    },

    // ------------------------------------------------------------------
    // APR projection pins — ratified at the USER GO/NO-GO gate (DECISIONS D11, 2026-08-30):
    //   LP seed 1.0% of pool TVL ≈ $6.9k (treasury-owned, bears IL, excluded from
    //   depositor accounting) · target vault TVL $50k · depositor-APR floor 2.0%.
    // The projection formula: pool_net_APR × (harvester_LP_TVL / target_vault_TVL)
    //   × (1 − protocol_fee). NEVER a hardcoded pool-level APR as "the yield".
    // ------------------------------------------------------------------
    aprPins: {
      lpSeedUsd: 6900,
      targetVaultTvlUsd: 50000,
      depositorAprFloorPct: 2.0,
      poolFloorNetAprPct: 2.0
    },

    // ------------------------------------------------------------------
    // Client-side APR methodology (js/apr.js).
    //   live sampling: ONE recent rolling window of Swap events fetched by the browser
    //   (chunked eth_getLogs), two-sided volume per the ratified formula, net of the
    //   protocol cut decoded LIVE from the pool's slot0 feeProtocol word.
    //   phase0Baseline: the ratified median-of-3-weekday-peak measurement
    //   (docs/ops/phase0/pool-apr.md §0/§4.2) used, clearly labeled, when live
    //   sampling is unavailable (RPC down / incomplete window retrieval = excluded).
    // ------------------------------------------------------------------
    aprMethodology: {
      windowSeconds: 3600,          // live sample window (1h)
      chunkBlocks: 7200,            // phase-0 proven chunk size (adaptive halving on failure)
      minSwapEvents: 20,            // ratified minimum observations per window; below = excluded
      maxLogs: 20000,
      yearSeconds: 365 * 86400,
      phase0Baseline: {
        source: 'docs/ops/phase0/pool-apr.md §4.2 (median of Tue–Thu 14:00–16:00 UTC windows, 2026-08-25..27)',
        pool: '0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e',
        feeTier: 500,
        netAprPct: 70.87,           // median net of the decoded 1/4-per-side cut
        protocolCutN: 4,
        measured: true
      }
    },

    // ------------------------------------------------------------------
    // Jurisdiction gate (F19 honest posture). Blocked countries on the canonical
    // domain; unknown/absent country code = allow with the disclosure banner
    // (the gate only ever acts on a KNOWN code). The F19 disclosure is carried
    // VERBATIM on the block page and in the mirror banner.
    // ------------------------------------------------------------------
    geo: {
      blockedCountries: ['US', 'GB', 'UK'],   // UK kept as a defensive alias of GB
      blockReason: 'Access from this jurisdiction is restricted on the canonical domain pending compliance review.',
      disclosure: 'geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure',
      mirrorBanner: 'This mirror cannot enforce jurisdiction restrictions. ' +
        'geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure'
    },

    // ------------------------------------------------------------------
    // Docs tab mapping. Markdown files live in the repo's docs/public/ tree and are
    // fetched AT RUNTIME over a RELATIVE path (IPFS-ready — no leading slash, no host).
    // For deploys, the docs/public tree is copied next to site/ (ops step, documented
    // in the repo README). Missing files render an honest "not published yet" state.
    // ------------------------------------------------------------------
    docs: {
      docsDir: '../docs/public',
      index: [
        { id: 'compliance',      title: 'Compliance posture',     file: 'compliance.md' },
        { id: 'guarantees',      title: 'Contract guarantees',    file: 'guarantees.md' },
        { id: 'not-guaranteed',  title: 'What is not guaranteed', file: 'not-guaranteed.md' },
        { id: 'risk-disclosure', title: 'Risk disclosure',        file: 'risk-disclosure.md' },
        { id: 'run-it-yourself', title: 'Run it yourself',        file: 'run-it-yourself.md' },
        { id: 'tokenomics',      title: 'Tokenomics',             file: 'tokenomics.md' }
      ]
    },

    // ------------------------------------------------------------------
    // Serving model (D8): serverless-clean. All vault reads are direct browser
    // eth_calls against the public RPC endpoints above. This static package makes
    // ZERO calls to any /api/* route of its own origin — caching functions may be
    // added later as pure enhancements, never a dependency, and this file must not
    // reference them.
    // ------------------------------------------------------------------
    serverless: {
      mode: 'static-only'
    },

    PENDING_DEPLOY: PENDING_DEPLOY
  };

  return config;
});
