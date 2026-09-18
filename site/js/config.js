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
      // DEPLOYED 2026-09-03 (F-01 broadcast, tx-verified; see docs/ops/phase0 + the
      // audit record). Addresses verified on-chain vs Blockscout + live eth_call.
      vaultFactory: '0x07446D9807F90eD7ED177Ab63597e8BB4D96428f',
      treasuryTimelock: '0xD55bA510533dc5a250b4D6d49Ee825113DD69342',
      harvester: '0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996'
    },

    // ------------------------------------------------------------------
    // The ROAMER STACK (protocol v2 — the agent-native LP layer on chain 4663).
    // RoamVault DEPLOYED 2026-09-09 (16/16 keyless verification); vault LIVE
    // 2026-09-13 (P0/P1/P2 executed, seeded 12.473590 USDG, share price 1:1,
    // DEPOSIT_CAP 25,000). P3 executed 2026-09-15 — the roamer is fully live:
    // 12.473590 USDG total, 9.504377 deployed in the USDG/ETH anchor book,
    // 2.969213 idle. EVERY consumer must render BOTH states (deployed AND
    // idle shares) — zero hard-coded assumptions about the split.
    // Every id is the FULL 32-byte value read from on-chain WellstreetTimelock
    // CallQueued/CallExecuted logs + live eth_call verification 2026-09-13 —
    // never an ellipsis, never a truncated pin.
    // ------------------------------------------------------------------
    roamStack: {
      statusNote: 'vault LIVE 2026-09-13; P3 executed 2026-09-15 — roamer fully live: 12.473590 USDG total, 9.504377 deployed in the USDG/ETH anchor book, 2.969213 idle',
      vault: '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86',       // RoamVault — ERC-4626, USDG asset (src/RoamVault.sol)
      roamer: '0xC7a21Aa8C15C7032eE2e8352244a0f3D2154dC68',      // RoamingHarvester — the POL roamer (vault-authorized deploy/egress)
      allowlist: '0x6040bA3e356cb023C67002De45D2af56FED4e81A',   // RoamAllowlist — book registry (USDG/ETH anchor added P0)
      usdg: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',        // USDG — the vault asset (6 decimals)
      timelock: '0xD55bA510533dc5a250b4D6d49Ee825113DD69342',    // 48h treasury timelock, open executor (same timelock as contracts.treasuryTimelock)
      safe: '0x0Fd4B5495698b4EC04AeaC64567867083760ccea',        // 2-of-3 Safe — the timelock proposer
      // The vault's LP book: USDG/ETH (v4, anchor poolId from the 09-04 fee screen;
      // also carried by vaultFamily[usdg-eth-v4].poolId — the roamer band reads the
      // same pool). P3-B deploys idle vault capital into a range around this book.
      usdgEthPoolId: '0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551',
      // Governance tape (the "checkable" record — dates, full ids, tx links).
      // executedAt/queuedAt/readyAt are ISO UTC timestamps read from block/event
      // data (2026-09-13 queue, P3 executed 2026-09-15). Executed rows carry the
      // FULL execute tx (CallExecuted) plus the original queuedTx verbatim; a
      // live op's queue state is read via the timelock's readyAt(bytes32) mapping
      // getter (0 = not queued → treat as cancelled) — never from a stale row.
      governance: {
        executed: [
          {
            label: 'P0 · allowlist.addBook — USDG/ETH anchor book',
            id: '0x042974269e2756ca85e14309f796169a0632547e08f455162f87bb69b07aa937',
            tx: '0x808045abfa79ef306258783d1db625f583376d46f8f8de4d7feb9c337ebd8a03',
            executedAt: '2026-09-13T08:36:35Z'
          },
          {
            label: 'P1 · roamer.setVault(vault, USDG) — the one-shot custody binding',
            id: '0x40b1351e8a01250c99ef17ef82225407e868c176809c09ecdad9db986f6c4430',
            tx: '0x7062a7152ed7071e52b15efcdc73b9c1956f70653861e0c9d97db6afc1979b1f',
            executedAt: '2026-09-13T08:36:05Z'
          },
          {
            label: 'P2 · deposits unpaused (pause-only EOA, direct — not timelock-queued)',
            id: null,
            tx: '0x05b0ef19584b7efe16d83ccd3dd1d1d0102d6c0b87757437a768a7c206b92fe0',
            executedAt: '2026-09-13T08:36:56Z'
          },
          {
            label: 'P3-A · vault.setHarvester(roamer) — bind the roamer (until then ALL capital is idle)',
            id: '0x7c982d3603b0c7e4ae3d57b609ddc0aef93e0444cc938ad52afff5058640f5ee',
            tx: '0x2baa06ed54446656db2f839032733c8cd3dfbb157c1e3a92be7760a7c8428922',
            queuedAt: '2026-09-13T09:46:26Z',
            executedAt: '2026-09-15T11:12:58Z',
            queuedTx: '0xc341c565de203f383c98198f8d53cd4cc9eddf65017bf1eb7eeebc472d322bf3'
          },
          {
            label: 'P3-B · vault.vaultDeploy(USDG/ETH band −198210/−198010, 10 USDG) — first deploy',
            id: '0x57fc2f0d3ff91ef752f442373bbc35e7d48e84066575adba91feb72084b876c6',
            tx: '0xb2de3d0068876038d4f11b44103718b6a45af99ef1ca1a4993c0b2d49f0175cd',
            queuedAt: '2026-09-13T09:50:52Z',
            executedAt: '2026-09-15T11:15:19Z',
            queuedTx: '0xda1cfe8e9813b83577f661a16a5ecd9ec0db1ad19ccf938c583b523e88f961f0'
          }
        ],
        queued: []
      }
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
      },
      usdg: {
        address: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        symbol: 'USDG',
        decimals: 6,
        label: 'Global Dollar (RH chain)'
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
      },
      // RBLX/USDG — the vault-#2 fee book (v3, fee 3000; fee screen 05 §5, plan
      // WELLSTREET_V4_VAULT_FAMILY_PLAN_2026-09-04 §6e). Token0/1 are address-ordered:
      // USDG 0x5fc5… < RBLX 0xF0C4…. The pool is LIVE on chain 4663; the vault that
      // will LP into it is DEPLOY-GATED (see vaultFamily.rblx-usdg below).
      rblxUsdg3000: {
        id: 'rblxUsdg3000',
        address: '0x1BDB8e3A79Cb1a7F228808739311E23098D33d43',
        feeTier: 3000,
        token0: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',   // USDG (address-ordered)
        token1: '0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8',   // RBLX
        label: 'RBLX / USDG (0.3%)'
      }
    },

    // ------------------------------------------------------------------
    // Uniswap V4 fork infrastructure (WS-MULTI-VAULT-FRONTEND, 2026-09-05).
    // Pinned from the 2026-09-04 fee screen (05 §5) — READ-ONLY context for the
    // v4-tier vaultFamily entries. The site performs NO v4 pool reads today:
    // v4 fee/liquidity math runs through StateView against live pool state and is
    // a post-deploy reader, never a pending-card read. Addresses obey the same
    // pin-first gate as everything else in this file.
    // ------------------------------------------------------------------
    uniswapV4: {
      poolManager: '0x8366a39CC670B4001A1121B8F6A443A643e40951',
      stateView: '0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2',
      // positionManager evidence — live keyless probe 2026-09-15: name() = 'Uniswap v4 Positions NFT';
      // poolManager() = 0x8366a39CC670B4001A1121B8F6A443A643e40951 == the pinned poolManager key (ctor-arg-bound, verified);
      // nextTokenId is decodable and GROWING — never gate an exact value (22 at the 2026-09-04 04-doc, 28 at the 2026-09-15 re-verify);
      // dead sibling 0x588C683EcC450F8b2aAdb13D7f63792b840425DC reverts name() (probe exits 1 if it stops reverting);
      // v3-era harvester NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3 (comment-only negative context — NOT the fork PM, never a pin);
      // creator 0x9cec3041CFab96Ef36b0ed0504dC7A675673Edd2 per the 04-doc §5.2 (stack-location research 2026-09-04; CONTEXT-ONLY — never a pin source).
      positionManager: '0xe38A007e42d7aAb09b7ad5fE083293C2Cc3DE45b',
      // Fork Quoter (custom quoteSingle view) PIN — 0x076838736F90Cd1d30dED756A3B89E576BE972F8 (one of 6 identical PM-bound deploys, shared codehash 0x6f47a0e4…34fe8cb; QUOTER-PIN-FORK-TEST 2026-09-06; comment-only, no contracts key on purpose)
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
    // Vault registry (frontend view of the protocol). vaults[0] IS the
    // deposit-widget/money-path driver (WS5: "stays the primary-vault (hero
    // surfaces, deposit widget) driver").
    //
    // WS-VAULT-DEPOSIT RECONCILIATION (2026-09-13): vaults[0] is now the LIVE
    // RoamVault (config.roamStack.vault — P0/P1/P2 executed 2026-09-13, seeded
    // 12.473590 USDG, share price 1:1, deposits OPEN, cap 25,000 USDG; share
    // symbol read live from the contract: wsrUSDG). The money path targets a
    // vault that actually accepts deposits — pointing it at the empty,
    // wind-down-declared SPY flagship was the stale state. The SPY entry stays
    // (reads/family context); its deposit side is the one the wind-down
    // declaration retired. The RoamVault entry carries NO pool/chainlinkFeed
    // keys on purpose — the card's conditional reads degrade to their honest
    // unavailable rows, and the vault's own accounting is the number source.
    // ------------------------------------------------------------------
    vaults: [
      {
        id: 'roam-usdg',
        displayName: 'RoamVault',
        shareSymbol: 'wsrUSDG',
        vault: '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86',
        asset: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
      },
      {
        id: 'ws-spy',
        displayName: 'Wellstreet SPY',
        shareSymbol: 'ws-SPY',
        vault: '0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01',
        asset: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c',
        pool: 'spyWeth500',
        chainlinkFeed: 'spyUsd'
      }
    ],

    // ------------------------------------------------------------------
    // The vault FAMILY (WS-MULTI-VAULT-FRONTEND, 2026-09-05) — the frontend view
    // of the multi-vault roster. ADDITIVE: the single-vault `vaults[]` array above
    // is untouched and stays the primary-vault (hero surfaces, deposit widget)
    // driver; this array is the family renderer's input (js/main.js + js/vault.js).
    //
    //   status 'LIVE'           — the contract is on chain 4663 (F-01 broadcast,
    //                             2026-09-03); the card reads it live.
    //   status 'DEPLOY-GATED'   — the family tier is RATIFIED but NOT deployed:
    //                             vault/harvester are PENDING_DEPLOY, the card
    //                             renders the explicit gated state, and NO yield
    //                             figure exists for it anywhere. Each gated entry
    //                             carries the honest APR note verbatim —
    //                             "APR published post-deploy from measured
    //                             harvests — backward-looking only" — and nothing
    //                             on this site fabricates one.
    //
    // v4-tier entries carry poolId (64-hex) + the shared uniswapV4 fork
    // infrastructure pinned above; v3 entries carry a `pool` key into cfg.pools.
    // poolIds are pinned from the 2026-09-04 fee screen (05 §5): SPY/USDG
    // 0xfe2a80bb…526cd, USDG/ETH 0xbac3aa3b…551, PACK/NVDA 0x4900c6d3…150.
    // ------------------------------------------------------------------
    vaultFamily: [
      {
        id: 'roam-usdg',
        status: 'LIVE',
        statusNote: 'activated 2026-09-13 — P0/P1/P2 executed, seeded 12.473590 USDG at 1:1, deposits open, cap 25,000 USDG; P3 executed 2026-09-15 — 9.504377 USDG deployed in the USDG/ETH anchor book, 2.969213 idle',
        displayName: 'RoamVault',
        shareSymbol: 'wsrUSDG',
        tierLabel: 'USDG / ETH quote (v4 roamer)',
        riskLabel: null,
        highRisk: false,
        vault: '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86',
        harvester: '0xC7a21Aa8C15C7032eE2e8352244a0f3D2154dC68',   // the roamer — vault.harvester() = this roamer since 2026-09-15 (P3-A execute tx 0x2baa06ed54446656db2f839032733c8cd3dfbb157c1e3a92be7760a7c8428922, also pinned full-length in governance.executed)
        asset: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',
        quote: null,
        pool: null,
        poolId: '0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551',
        aprNote: null
      },
      {
        id: 'ws-spy',
        status: 'LIVE',
        statusNote: 'wind-down declared 2026-09-06; do not open new positions; redeems always open; the WOUND-DOWN card render is a future S2 renderer change — this note is config-truth only and is not rendered by today\'s card',   // S4 truth pass 2026-09-06 — ADDITIVE annotation, not rendered (main.js:365 hardcodes the gated note; renderer branch = S2)
        displayName: 'Wellstreet SPY',
        shareSymbol: 'ws-SPY',
        tierLabel: 'stock / WETH quote (v3)',
        riskLabel: null,
        highRisk: false,
        vault: '0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01',
        harvester: '0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996',
        asset: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c',
        quote: null,
        pool: 'spyWeth500',
        poolId: null,
        aprNote: null
      },
      {
        id: 'rblx-usdg',
        status: 'DEPLOY-GATED',
        statusNote: 'family-deploy plan superseded 2026-09-06 by the S1 roamer/factory story',   // S4 truth pass 2026-09-06 — ADDITIVE annotation, not rendered today
        displayName: 'Wellstreet RBLX',
        shareSymbol: 'ws-RBLX',
        tierLabel: 'stock / stable (v3)',
        riskLabel: null,
        highRisk: false,
        vault: 'PENDING_DEPLOY',
        harvester: 'PENDING_DEPLOY',
        asset: '0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8',   // RBLX (tokenized stock)
        quote: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',   // USDG
        pool: 'rblxUsdg3000',
        poolId: null,
        aprNote: 'APR published post-deploy from measured harvests — backward-looking only'
      },
      {
        id: 'spy-usdg-v4',
        status: 'DEPLOY-GATED',
        statusNote: 'config DEAD 2026-09-06 — SPY flagship dropped; superseded by the S1 roamer/factory story',   // S4 truth pass 2026-09-06 — ADDITIVE annotation, not rendered today
        displayName: 'Wellstreet SPY (v4)',
        shareSymbol: 'ws-SPY-v4',
        tierLabel: 'stock / stable (v4)',
        riskLabel: null,
        highRisk: false,
        engine: 'harvesterv4',
        vault: 'PENDING_DEPLOY',
        harvester: 'PENDING_DEPLOY',
        asset: '0x117cc2133c37b721f49de2a7a74833232b3b4c0c',   // SPY
        quote: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',   // USDG
        pool: null,
        poolId: '0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd',
        aprNote: 'APR published post-deploy from measured harvests — backward-looking only'
      },
      {
        id: 'usdg-eth-v4',
        status: 'DEPLOY-GATED',
        displayName: 'Wellstreet USDG (v4)',
        shareSymbol: 'ws-USDG-v4',
        tierLabel: 'stable / ETH rails (v4)',
        riskLabel: null,
        highRisk: false,
        engine: 'harvesterv4',
        vault: 'PENDING_DEPLOY',
        harvester: 'PENDING_DEPLOY',
        asset: '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168',   // USDG (stable)
        quote: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',   // WETH
        pool: null,
        poolId: '0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551',
        aprNote: 'APR published post-deploy from measured harvests — backward-looking only'
      },
      {
        id: 'pack-nvda-v4',
        status: 'DEPLOY-GATED',
        displayName: 'Wellstreet PACK/NVDA (v4)',
        shareSymbol: 'ws-NVDA-v4',
        tierLabel: 'meme/stock (v4) — HIGH RISK',
        riskLabel: 'HIGH RISK: meme-quote leg, tiny pool, dust capacity — ' +
          'per-pool deposit caps sized to ≤~10% of book TVL (a ~$16k pool cannot host a large vault)',
        highRisk: true,
        engine: 'harvesterv4',
        vault: 'PENDING_DEPLOY',
        harvester: 'PENDING_DEPLOY',
        asset: 'PENDING_DEPLOY',   // the stock leg (NVDA tokenized) publishes with its deploy
        quote: 'PENDING_DEPLOY',   // PACK — publishes with its deploy
        pool: null,
        poolId: '0x4900c6d3f31ff1e1545a487469c134cdbd9f1499f938054c0c77a14728b3f150',
        aprNote: 'APR published post-deploy from measured harvests — backward-looking only'
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
    // APR projection pins — RE-PINNED to the ratified 2026-09-03 GO/NO-GO gate
    // (docs/internal/GO_NO_GO_PACKET_2026-09-03.md §3 + GATE OUTCOME; supersedes
    // the 2026-08-30 D11 TVL-share pins). Ratified formula (liquidity-share form):
    //   depositor APR = pool_net_rate × (L_pos/L_pool) × (pool_TVL / vault_TVL) × 0.9
    //   lpSeedPctOfPool — LP seed 1% of pool TVL (pin 2; treasury-owned, bears IL,
    //     excluded from depositor accounting).
    //   poolTvlWethBasis + wethUsdContextAnchor — the 482.77 WETH 2026-09-02 pool-TVL
    //     basis and the $2,389.47 WETH/USD context anchor (GO packet §1, context only)
    //     → the ≈$1.154M pool-TVL input. A derivation input ONLY, never a rendered figure.
    //   liquidityShareFullRange — L_pos/L_pool at the 1% seed, full-range 0.0369%
    //     (fork probe lp-intervention.md; 0.0184% at the 0.5% seed).
    //   targetVaultTvlUsd — launch-era vault TVL expectation $58k: the ceiling at
    //     which the ratified floor clears at full-range (pin 3's own framing).
    //   depositorAprFloorPct — 0.10%/yr at full-range (pin 3; was 2.0 under D11).
    //   poolFloorNetAprPct — the derived pool floor 3.542%/yr
    //     = max(2.0%, σ̂²/8, LVR_sim) (GO packet §1/§2, pool-lvr.md §1.7; was 2.0).
    // NEVER a hardcoded pool-level APR as "the yield"; the depositor figure renders
    //   ONLY in the published "~X% projected, methodology-linked" register.
    // ------------------------------------------------------------------
    aprPins: {
      lpSeedPctOfPool: 1.0,
      poolTvlWethBasis: 482.77,
      wethUsdContextAnchor: 2389.47,
      liquidityShareFullRange: 0.000369,
      targetVaultTvlUsd: 58000,
      depositorAprFloorPct: 0.10,
      poolFloorNetAprPct: 3.542
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
        // Re-pinned 2026-09-03 to the ratified pool-net median 40.310%/yr
        // (GO/NO-GO packet §1, pool-lvr.md §1.4: windows 32.595 / 40.310 / 49.514 %/yr;
        // the MAX window is forbidden and never used — median-of-windows only).
        source: 'median of the ratified 2h weekday-peak windows, 2026-08-25..27 (pool-lvr.md §1.4; full methodology: docs tab, APR methodology)',
        pool: '0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e',
        feeTier: 500,
        netAprPct: 40.310,          // ratified median, net of the decoded 1/4-per-side cut
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
      // SECTION_IMPROVE G2 (2026-09-08): the first pane proves the thesis —
      // 'Vaults for agents' (the agent-native surface) leads, 'Run it yourself'
      // follows; the compliance/legal register moves behind the substance.
      index: [
        { id: 'agent-vault-ops', title: 'Vaults for agents',      file: 'agent-vault-ops.md' },
        { id: 'whitepaper',      title: 'Whitepaper',             file: 'whitepaper.md' },
        { id: 'run-it-yourself', title: 'Run it yourself',        file: 'run-it-yourself.md' },
        { id: 'methodology',     title: 'APR methodology',        file: 'methodology.md' },
        { id: 'risk-disclosure', title: 'Risk disclosure',        file: 'risk-disclosure.md' },
        { id: 'not-guaranteed',  title: 'What is not guaranteed', file: 'not-guaranteed.md' },
        { id: 'guarantees',      title: 'Contract guarantees',    file: 'guarantees.md' },
        { id: 'compliance',      title: 'Compliance posture',     file: 'compliance.md' },
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
