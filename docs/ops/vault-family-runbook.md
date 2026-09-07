# Vault Family Deployment Runbook — v4 tier via Safe + 48h Timelock

**Date:** 2026-09-06 · **Status:** WIND-DOWN DECLARED 2026-09-06 for the SPY flagship — §2.1 ws-SPY DEAD; §2.2 Vault 3 (USDG/ETH) is the only remaining READY config (sizing PROPOSED, pending the S5 user gate; deploy DEFERRED — see §9); §2.3 PACK BLOCKED · **Operator:** 2-of-3 Safe (three keys, one operator) · **Companion docs:** `safe-ops.md` (Safe CLI mechanics + rehearsal) · `deploy-prep-runbook.md` (F-01, completed)
**Contract state:** factory `0x07446D9807F90eD7ED177Ab63597e8BB4D96428f` carries `createVaultV4` (deployed `9380b4d`); flagship ws-SPY vault `0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01` LIVE since F-01 2026-09-03.
**Sequencing rule (binding):** ONE vault at a time — create → wire → seed → verify → soak ≥1 full harvest cycle → only then the next.

---

## 1. The one-time constants (pinned, verified on-chain 2026-09-06)

```
RPC                 https://rpc.mainnet.chain.robinhood.com   (keyless, reads only)
FACTORY             0x07446D9807F90eD7ED177Ab63597e8BB4D96428f
TIMELOCK            0xD55bA510533dc5a250b4D6d49Ee825113DD69342
FORK_POOL_MANAGER   0x8366a39CC670B4001A1121B8F6A443A643e40951   (custom fork — canonical v4 addrs on 4663 are SCAM DRAINERS)
STATEVIEW           0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2
SWAP_ROUTER_V3      0xCaf681a66D020601342297493863E78C959E5cb2   (SwapRouter02)
QUOTER_V3           0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7   (QuoterV2)
V3_FACTORY          0x1f7d7550B1b028f7571E69A784071F0205FD2EfA
WETH                0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73
USDG                0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168   (6 decimals)
SPY                 0x117cc2133c37B721F49dE2A7a74833232B3B4C0c
```

## 2. The three vault configs

### 2.1 VAULT 2 — ws-SPY/USDG (stock/stable, v4 book) — DEAD (wind-down declared 2026-09-06)

**WIND-DOWN NOTE (S4 truth pass, 2026-09-06):** the ws-SPY flagship is winding down — do NOT route new deposits into it. Live reads 2026-09-06 (keyless, rpc.mainnet.chain.robinhood.com): `totalSupply()=0`, `totalAssets()=0`, `depositsPaused()=false`, and flagship harvester `0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996` `positionId()==0` — the vault is empty and unseeded. **Demote-first ordering:** docs (this banner + §2.1) → agent skill (demotion banner) → `site/js/config.js` (additive statusNote annotations) are demoted BEFORE any on-chain step; the on-chain sequence (§8) is operator-gated and is NEVER executed by a docs pass. **Registry scar:** `vaultOfAsset(SPY)` is **PERMANENT** (one-vault-per-asset forever, VaultFactory) — no new SPY vault can ever be created; this config is retained as record only. **Drain-gate DROPPED as a false premise:** no supply exists, nothing to strand — redemptions-unpausable is the feature (holders can always exit; there is nothing to "drain" first).

| item | value |
|---|---|
| asset (yield denomination) | **SPY** |
| poolKey | c0=SPY, c1=USDG, fee=3000, tickSpacing=60, hooks=`0x0` |
| poolId (verify at pre-flight) | `0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd` |
| swapPath (v3, single hop) | `USDG → SPY` fee 3000 — pool `0xA43b424Bc609495AED4BCD88d654934b510B0aD9` (verified exists) |
RESEARCH NOTE 2026-09-06 — USDG→SPY liquidity probes: @3000 quoted 1286039232688385633 vs @500 pool 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 1291977900204907727 per 1e9 raw USDG (@500 better) — UNACTIONABLE: this §2.1 v4-book config was NEVER DEPLOYED; the live flagship vault 0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01 (F-01 2026-09-03, Harvester creation tx 0xb7b9e9ee4409ab3bfc9ab64df7f2a4a479dc782b1bc90606b18005135e3bccbe) runs the OLD Harvester.sol v3 architecture (SPY/WETH pool @500, no USDG leg, no baked swapPath; unseeded — totalAssets()=0 verified 2026-09-06); the vaultOfAsset(SPY) registry row is PERMANENT (no new SPY vault can ever be created) and the ws-SPY config is DEAD post-pivot (AGENT_FOCUS_SEQUENCE_2026-09-06.md:7, S4 wind-down) — probe evidence retained as route research for any future asset.
| path bytes | `abi.encodePacked(USDG, uint24(3000), SPY)` |
| book economics (05 §5, backward-looking) | 83% LP-fee APR, $6.42M TVL — capacity AND yield |
| seed pin | GO/NO-GO formula: 1% of book TVL ≈ **$64k equivalent** (operator sets the actual; IL leg = SPY volatility, quote is stable) |

### 2.2 VAULT 3 — ws-USDG/ETH (stable/ETH rails, v4 book, DYNAMIC fee) — READY
| item | value |
|---|---|
| asset (yield denomination) | **USDG** |
| poolKey | c0=native ETH (`0x0`), c1=USDG, fee=**0x800000** (dynamic flag), tickSpacing=10, hooks=**`0x06a889870c8f83640d6816319f72e2aa579b6080`** |
| poolId (verify at pre-flight) | `0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551` |
| swapPath (v3, single hop) | `WETH → USDG` fee 100 — pool `0x52e65B17fB6E5BA00Ed806f37Afcd2DaA50271Ca` (verified exists) CONFIRMED 2026-09-06 — liquidity probe @100 2479004637 vs @500 2478213161 per 1e18 raw WETH; re-probe before anchor-vault creation |
| path bytes | `abi.encodePacked(WETH, uint24(100), USDG)` |
| book economics (05 §5, backward-looking) | 165–169% APR, $7.72M TVL, $35k/day measured — the chain's biggest absolute fee pool; hook re-prices per swap |
| seed pin | GO/NO-GO formula: 1% of book TVL ≈ **$77k equivalent** (same formula as §2.1, replacing the old ≤10%/≤$770k cap; operator sets the actual; IL leg = ETH volatility) — PROPOSED — RATIFY AT THE S5 USER GATE (S4 is a docs truth pass and does not set Vault 3 sizing policy) |

### 2.3 VAULT 4 — PACK/NVDA (meme/stock, HIGH-RISK tier) — **⛔ CONFIG BLOCKED**
**Hard stop, recorded 2026-09-06:** the fork's swap leg is a **v3** path ending at the asset — and **no v3 NVDA pool exists at ANY fee tier** (factory sweep 100/500/3000/10000 → all `0x0`; NVDA's venues are v4-only). `swapPath` for asset=NVDA is therefore impossible → `HarvesterV4` cannot be configured for this book today. Options (user gate):
- (a) **Skip the PACK tier** (recommended — it is also the dust-capacity tier: $16k book TVL),
- (b) new contract work: a v4-native swap leg (fork Quoter `quoteSingle` route) in a HarvesterV4 follow-up,
- (c) re-target a meme/stock book whose ASSET has v3 depth (pre-flight sweep required per candidate).
Do NOT force a config — the harvester's constructor validates shape, but a path that reverts at harvest time would strand fees in the position.

## 3. Phase A — pre-flight battery (keyless, ALL GREEN required before B)

```bash
RPC=https://rpc.mainnet.chain.robinhood.com
SV=0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2

# A1 — pool live + direction (nonzero sqrtPriceX96):
cast call $SV "getSlot0(bytes32)(uint160,int24,uint24,uint24)" <POOLID> --rpc-url $RPC

# A2 — swap path quotes > 0 — 4-call BOTH-TIERS battery (QuoterV2 quoteExactInput; run all four for the target leg; every quote must be > 0 before Phase B — the pinned tier = the LARGER quote, decided at creation):
# leg USDG→SPY (1e9 raw USDG in) — @3000 then @500:
cast call 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 "quoteExactInput(bytes,uint256)(uint256)" 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168000bb8117cc2133c37B721F49dE2A7a74833232B3B4C0c 1000000000 --rpc-url $RPC
cast call 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 "quoteExactInput(bytes,uint256)(uint256)" 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d1680001f4117cc2133c37B721F49dE2A7a74833232B3B4C0c 1000000000 --rpc-url $RPC
# leg WETH→USDG (1e18 raw WETH in) — @100 then @500:
cast call 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 "quoteExactInput(bytes,uint256)(uint256)" 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD730000645fc5360D0400a0Fd4f2af552ADD042D716F1d168 1000000000000000000 --rpc-url $RPC
cast call 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7 "quoteExactInput(bytes,uint256)(uint256)" 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD730001f45fc5360D0400a0Fd4f2af552ADD042D716F1d168 1000000000000000000 --rpc-url $RPC

# A3 — one-vault-per-asset is free:
cast call 0x07446D9807F90eD7ED177Ab63597e8BB4D96428f "vaultOfAsset(address)(address)" <ASSET> --rpc-url $RPC   # → 0x0

# A4 — factory code carries createVaultV4 (bytecode grep):
cast code 0x07446D9807F90eD7ED177Ab63597e8BB4D96428f --rpc-url $RPC | grep -c "$(cast sig 'createVaultV4(((address,string,string,address,(address,address,uint24,int24,address),address,bytes,address,address))')" || true
```
A failed A1/A2 = STOP for that vault (re-verify poolKeys against `05_V4_FEE_ECON_SCREEN` §5 + the 04 §5.5 Initialize recipe — pools churn).

## 4. Phase B — create the vault+harvester pair (permissionless, gas only)

One call from the operator EOA — the factory deploys BOTH contracts atomically and validates the fork pin + poolKey shape (a bad config reverts with no registry row):

```bash
cast send 0x07446D9807F90eD7ED177Ab63597e8BB4D96428f \
  "createVaultV4((address,string,string,address,(address,address,uint24,int24,address),address,bytes,address,address))" \
  "<ASSET> \"Wellstreet <NAME>\" \"ws-<SYM>\"" \
  --rpc-url $RPC --interactive
```
(build the full struct calldata with `cast calldata` — V4Config fields in factory order: asset, name, symbol, poolManager, poolKey{c0,c1,fee,tickSpacing,hooks}, weth, swapPath, router, quoter.)
**Read the receipt:** `VaultCreated(asset, vault, …)` + `VaultV4Created(asset, vault, harvester, poolManager)` → record BOTH addresses.

## 5. Phase C — wire the harvester (Safe 2-of-3 → 48h timelock)

`YieldShares.setHarvester` is timelock-only and the harvester is NOT auto-wired — the vault yields nothing until this lands.

1. **Build the inner call:** `DATA=$(cast calldata 'setHarvester(address)' <HARVESTER>)`
2. **Queue via the Safe** (2-of-3 signatures, CLI pattern in `safe-ops.md` §rehearsal): the Safe `execTransaction` targets the timelock — `queue(address target, uint256 value, bytes calldata data, bytes32 salt)` with `target=<VAULT>, value=0, data=$DATA, salt=<random 32B>`; id = `hashCall(target,value,data,salt)`.
3. **48h public window** (detection-not-prevention — disclosed; anyone can watch the queued call; `cancel` is proposer-only).
4. **Execute (permissionless after the delay):** `cast send $TIMELOCK 'execute(address,uint256,bytes,bytes32)' <VAULT> 0 $DATA $SALT`
5. **Verify:** `cast call <VAULT> 'harvester()(address)' --rpc-url $RPC` → the harvester address.

## 6. Phase D — seed + open the position

1. **Size the seed** per the config table (§2) — both currencies at the pool's current price ratio for a full-range position.
2. **Fund the harvester:** `cast send <C0> 'transfer(address,uint256)' <HARVESTER> <AMT0>` + same for c1 (USDG vaults: approve/transfer norms; native-ETH legs: the harvester's `deposit()` accepts `msg.value`).
3. **Open:** compute liquidity for the full-range band (`cast call <HARVESTER> 'fullRangeTicks()(int24,int24)'` + slot0 price → standard full-range liquidity math), then
   `cast send <HARVESTER> 'openPosition(uint128)' <LIQUIDITY> --interactive`
4. **Verify:** `cast call <HARVESTER> 'poolId()(bytes32)'` == target poolId; StateView position liquidity > 0; harvester balances near-zero (all capital in the position — leftover dust is swept, never stuck).

## 7. Phase E — verify battery + soak gate

**Battery target: VAULT 3 (USDG/ETH) — the only remaining READY config (§2.2; sizing PROPOSED, S5 user gate).** The SPY flagship (§2.1, DEAD) keeps its own WIND-DOWN TRUTH BLOCK at the end of the battery — run it to confirm wind-down state before and after any §8 operator step.

```bash
# Vault truths:
cast call <VAULT> 'asset()(address)'            # == asset
cast call <VAULT> 'totalAssets()(uint256)'      # == 0 after open — storage-based: YieldShares.sol:122-124 returns _totalAssetsStored, incremented only on vault deposit (:260) and harvest push (:238); the LP seed funds the HARVESTER directly (Phase D step 2) and HarvesterV4.sol:517-524 pays principal from harvester balances, so vault storage never counts LP principal
# Seed truth lives on the harvester side (HarvesterV4.sol:355):
cast call <HARVESTER> 'positionLiquidity()(uint128)'  # == the opened liquidity
cast call <VAULT> 'backingCoverage()(uint256)'  # == 1e18 fresh
cast call <VAULT> 'depositsPaused()(bool)'      # false
# Harvester truths:
cast call <HARVESTER> 'poolId()(bytes32)'       # == target
cast call <HARVESTER> 'quote()(address)'; cast call <HARVESTER> 'fullRangeTicks()(int24,int24)'

# FLAGSHIP WIND-DOWN TRUTH BLOCK (ws-SPY vault 0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01 · harvester 0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996 · live 2026-09-06):
cast call 0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01 'totalSupply()(uint256)'   # == 0
cast call 0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01 'totalAssets()(uint256)'   # == 0 — storage-based: YieldShares.sol:122-124 returns _totalAssetsStored (rises only via vault deposit or harvester credit)
cast call 0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01 'depositsPaused()(bool)'   # false (live 2026-09-06)
cast call 0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996 'positionId()(uint256)'    # == 0 — the read that decides whether ANY unwind step applies (live 2026-09-06: 0 → §8 steps 2-3 are no-ops today)
```
Then: main-session flips the frontend (`config.js` vaultFamily entry `PENDING_DEPLOY` → real addresses, card goes LIVE), re-pins the agent skill's address table, suite + deploy + probe. **Soak ≥1 real harvest cycle** (fees accrue in the position; `harvest()` converts via the pinned v3 path) before touching the next vault.

## 8. Safety rails + rollback

- **Deposits pause:** pause-only EOA, instant, deposits only — `cast send <VAULT> 'setDepositPaused(bool)' true` (redemptions are STRUCTURALLY unpausable by design).
- **Position unwind:** `transferPosition(address to, uint256 tokenId)` (Harvester.sol:260 — **timelock-only**; reverts `NoPosition` at Harvester.sol:262 with no position). Authorization surface unit-tested at `test/Harvester.t.sol:383` (`test_transferPosition_onlyByTimelock`) + the Handler invariant attempt (test/invariants/Handler.t.sol) — NO fork test covers it (the old `T5` cite was a V4-fork close test ID, misapplied; the primitive it named — the V4-only close-and-take in the never-deployed HarvesterV4 — is removed from this runbook). **Ordering is POSITION-CONTINGENT:** setDepositPaused (pause-only EOA) → ONLY if `positionId != 0`: `harvest()` (permissionless, Harvester.sol:280) then `transferPosition` via the 48h timelock queue → `sweepToTreasury()` (permissionless, Harvester.sol:318). Live 2026-09-06: `positionId == 0` → the harvest/transfer steps are no-ops today. In a zero-totalSupply wind-down do NOT final-harvest into the vault: the 90% vault share would land in a zero-supply vault with deposits paused = permanently unclaimable (redeem requires shares; deposits blocked) — fees exit WITH the NFT via `transferPosition`.
- **Queued-call abort:** `timelock.cancel(id)` — proposer-only (Safe 2-of-3) during the 48h window.
- **Never** call canonical Uniswap v4 addresses on 4663 (scam drainers); every address in this runbook is the verified pin.
- **Honest APR:** once fees accrue, the site/skill print measured harvests only — backward-looking, windowed, never headlined (dynamic-fee books re-price; labels carry the window).

## 9. Execution order (reordered 2026-09-06 — wind-down first; NOT a live deploy order)

1. **SPY flagship wind-down (operator-gated, §8)** — the Vault 2 (SPY/USDG) config is **DEAD** (§2.1). Demote-first already landed 2026-09-06 (this runbook + agent-skill banner + config.js statusNote annotations); the on-chain steps (setDepositPaused → position-contingent harvest/transferPosition → sweepToTreasury) remain operator-gated and are documented, never auto-executed.
2. **Vault 3 (USDG/ETH) — DEFERRED behind the S5 user gate** (§2.2; seed sizing is PROPOSED there). Note: S1's roamer/factory may supersede the deploy vehicle — re-confirm the vehicle at the S5 gate before any Phase A run.
3. **PACK tier: BLOCKED** pending user gate on §2.3 options.
