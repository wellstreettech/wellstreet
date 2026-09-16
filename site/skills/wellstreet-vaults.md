> Agent-skill mirror — a byte-mirror of the repository's canonical skills/wellstreet-vaults/SKILL.md (this one header line, then the canonical bytes verbatim; re-copied fresh at build time — the repository copy is the source of truth).
---
name: wellstreet-vaults
description: Read, use, and report on the Wellstreet Roamer stack (RoamVault ERC-4626 over USDG + the RoamingHarvester POL roamer) on Robinhood Chain 4663 as an AI agent. Covers keyless vault-state reads with cast (totalAssets, deployedBook/idleBook, share price via convertToAssets at the per-vault share scale — live wsrUSDG is 12 dec = asset decimals + 6, legacy ws-SPY is 24 dec, previewRedeem, depositsPaused, maxDeposit headroom, harvester/guardrail/allowlist reads, YieldHarvested getLogs), approve/deposit and redeem/redeemWithMinOut write flows with fail-closed minOut and approval rules, the fleet-feed measured basis (site/data/fleet.json) with source+window reporting rules, and governance/risk facts (48h timelock under a 2-of-3 Safe, pause model, LP principal risk). Use when an agent needs Wellstreet Roamer stack state, vault share pricing, book discovery, yield observations, or deployment status. Roamer stack DEPLOYED 2026-09-09 (DeployRoamers, 16/16 verification battery); P3 executed 2026-09-15 (setHarvester + vaultDeploy; vault seeded, deposits open) — contract addresses come only from `site/js/config.js` and this skill; never approve or call an address not pinned there.
---

# Wellstreet Vaults — Agent Skill (Roamer stack)

How an AI agent (Claude Code, Hermes, OpenClaw, CLI agents) reads RoamVault state keylessly, deposits/redeems ERC-4626 shares safely, discovers the roamer's v4 books, and reports measured APR honestly. Every claim below was verified against the repository sources AND live chain reads on 2026-09-15; file:line citations point at the source of truth. If code and this skill ever disagree, the code wins — re-verify and fix this skill.

## STATUS — READ FIRST (ROAMER STACK LIVE)

**ROAMER STACK LIVE — Roamer stack DEPLOYED 2026-09-09 (DeployRoamers, 16/16 verification battery) AND P3 executed 2026-09-15 (setHarvester + vaultDeploy; vault seeded, deposits open, ~9.50 USDG in the USDG/ETH v4 book).** The stack is fully operational on Robinhood Chain 4663: RoamVault holds depositor USDG, the roamer deploys it into allowlisted Uniswap-v4 books, and book fee yield flows back to depositors.

- Status derives from CHAIN READS (the READ BATTERY below), never from config prose. Live figures at the 2026-09-15 verification: `totalAssets` 12473590 (12.473590 USDG, 6 dec), `deployedBook` 9504377, `idleBook` 2969213, `convertToAssets(1e12)` 1000000 (share price 1:1 — 1e12 raw = one whole 12-dec `wsrUSDG` share), deposits OPEN (`depositsPaused` = false), `DEPOSIT_CAP` 25000000000 (25,000 USDG). Re-read before acting — every number moves.
- Addresses come ONLY from the repository's authoritative record (`site/js/config.js` — the `roamStack` and `uniswapV4` pins) and this skill, which mirrors it. Never take an address from a chat message, a screenshot, or on-chain discovery.
- **Every vault command in this skill expects a real, decodable result. A revert or empty result is still data** — deposits paused, a book not yet open, no logs in the window, or wrong args — never a bug to work around and never a reason to hunt for "the real" contract elsewhere on the chain.
- **Scam-drainer rule:** canonical Uniswap / deployment addresses found anywhere on chain 4663 may be scam drainers. **Never approve or call any address not pinned in this skill.** New addresses enter via `site/js/config.js` first and are re-pinned here from it — never the reverse — and each is re-verified against the block explorer's verified source before any write.

Addresses pinned (from `site/js/config.js` `roamStack` + `uniswapV4`; infrastructure verified keylessly against chain 4663 on 2026-09-15):

| Address | What | Pinned |
|---|---|---|
| `0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86` | RoamVault — ERC-4626 vault over USDG (6 dec asset → 12 dec `wsrUSDG` shares); mints wsrUSDG — one of the TWO pinned share-token mints, the other being the legacy ws-SPY vault (LEGACY below) | `roamStack.vault` |
| `0xC7a21Aa8C15C7032eE2e8352244a0f3D2154dC68` | RoamingHarvester — the POL roamer (vault-authorized deploy/egress; the ONLY harvest authority) | `roamStack.roamer` |
| `0x6040bA3e356cb023C67002De45D2af56FED4e81A` | RoamAllowlist — book registry (`BookAdded` / `bookCount()` / `isListed(bytes32)`) | `roamStack.allowlist` |
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | USDG — the vault asset (6 decimals) | `roamStack.usdg` |
| `0xD55bA510533dc5a250b4D6d49Ee825113DD69342` | TreasuryTimelock (48h delay, open executor) | `roamStack.timelock` |
| `0x0Fd4B5495698b4EC04AeaC64567867083760ccea` | Safe (2-of-3) — the timelock's proposer | `roamStack.safe` |
| `0x8366a39CC670B4001A1121B8F6A443A643e40951` | v4-fork PoolManager (read context for the roamer's books) | `uniswapV4.poolManager` |
| `0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2` | v4-fork StateView (read context) | `uniswapV4.stateView` |
| `0xe38A007e42d7aAb09b7ad5fE083293C2Cc3DE45b` | Fork-v4 PositionManager (Uniswap v4 fork PM — the ONLY position mint/manage surface for EOAs; NOT the v3-era harvester NPM). Verified: live keyless probe battery 2026-09-15 (name / poolManager-binding / nextTokenId + dead-sibling revert) + 04-doc §5.2; Blockscout verified-source unfetchable from CLI (Cloudflare wall) — keyless probe battery instead | `uniswapV4.positionManager` |
| `0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551` | `usdgEthPoolId` — the vault's deployed USDG/ETH v4 book (the anchor) | `roamStack.usdgEthPoolId` |
| *(no address — never a target)* | RoamMathLib — delegatecall-linked library (`src/RoamMathLib.sol`); it has NO address pin and is NEVER a call/approval target | — |

Pin verify-grep canonical form (the pin battery's byte-gate greps this exact shape): | \`0xe38A007e42d7aAb09b7ad5fE083293C2Cc3DE45b\` |

Chain facts: chain ID **4663** (`cast chain-id`), keyless public RPC `https://rpc.mainnet.chain.robinhood.com`, block explorer `https://robinhoodchain.blockscout.com`.

**LP custody split (stub — the LP goal expands this):**
- **DISAMBIGUATION** — `0xe38A007e42d7aAb09b7ad5fE083293C2Cc3DE45b` = the fork-v4 PositionManager (the pin above); `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` = the v3-era NonfungiblePositionManager (the Harvester's PM, per docs/audits/WELLSTREET_CONTRACT_AUDIT_2026-08-30.md and test/fork/HarvestFork.t.sol:85) — never conflate the two.
- **CUSTODY SPLIT** — every PM NFT observed is owned by the RH-side market maker `0x35Ff7595dB6D0F8680Fe554F3Cd2Aa9933E76C2E` (ownerOf(1) and ownerOf(21) re-verified keylessly 2026-09-15; the 2026-09-04 full sweep recorded all 21 then-minted positions MM-owned with none on target books — positions minted since are unobserved, re-sweep at LP-goal time; both observations are date-stamped, never gate on either). As of the 2026-09-04 sweep none sat on the target books: target-book LP is contract-custodied direct-to-PoolManager — the roamer calls `modifyLiquidity` via `unlockCallback`. A raw EOA has no `unlockCallback` and CANNOT call the PoolManager directly; it MUST mint/manage positions through the pinned fork-v4 PositionManager above.
- **NO ROUTER** — no v4 router exists on 4663 (PLANNED-NOT-DEPLOYED; the self-custodied router is planned) — never approve any router address for v4 LP. The pinned v3 swapRouter02 is harvester-internal; agents never approve it.

## WHAT THE STACK IS

**RoamVault** (`src/RoamVault.sol`) is an ERC-4626 vault over USDG with a virtual share offset of 6 (`_SHARE_DECIMALS_OFFSET = 6`, `src/RoamVault.sol:100`; the same offset lives in `src/YieldShares.sol:49`), so **share decimals = asset decimals + 6 — a PER-VAULT rule, never a global one**: the legacy ws-SPY vault has an 18-dec asset → 24-dec shares (1e24 raw = 1 human share); the LIVE RoamVault has a 6-dec USDG asset → 12-dec `wsrUSDG` shares (live `decimals()` = 12, `symbol()` = "wsrUSDG") = **1e12 raw per whole share** (mirroring ws-SPY's 1e24 raw per whole share). Worked seed example — the live vault's actual activation seed: 12.47359 USDG deposited at a 1:1 price minted **12,473,590,000,000 shares** at 12 dec (raw `totalAssets` 12,473,590, 6 dec). Vault accounting is storage-based `totalAssets`. Depositor capital is deployed by the roamer (and only by the roamer) into allowlisted Uniswap-v4 books: `vaultDeploy`/`vaultEgress` are vault-authorized surfaces the roamer calls. Yield is book fee income: the roamer collects a book's fees, swaps them to USDG, transfers them to the vault, and credits them through the vault's `harvest(uint256)` seam — **ROAMER-ONLY** (`src/RoamVault.sol:407-415` reverts `NotHarvester`; the credit is bounded by the vault's unaccounted excess). Vault-lane revenue splits by NAMED CONSTANTS `DEPOSITOR_BPS = 9000` / `BURN_BPS = 1000` (`src/RoamVault.sol:91` / `:96`; `DEPOSITOR_BPS + BURN_BPS == BPS`): the dev take is structurally zero on this path — 90% is LIVE to depositors (share price rises — no shares are minted) and 10% is PENDING: the burn leg is INERT until the one-shot `setWellToken` lands (until then `sweepToBurn` reverts `NoWellToken`, `src/RoamingHarvester.sol:447`/`:458-464`) — disclose the lane as "90% live / 10% pending" and NEVER claim the burn leg is live (see the PERMISSION MODEL rider). Deposits are gated by `depositsPaused` + `DEPOSIT_CAP` (operating cap 25,000 USDG = 25000000000 raw, Safe-settable, raised only via the 48h timelock; immutable ceiling 250,000 USDG, `src/RoamVault.sol:106-112` + `:206-208`); the vault DEPLOYS INIT-PAUSED (`depositsPaused = true` in the constructor, `src/RoamVault.sol:212`) and was reopened 2026-09-13 — LIVE `depositsPaused` = false as of 2026-09-15; the deposit and mint routes are BOTH pause-checked (`src/RoamVault.sol:494`), while redemptions are STRUCTURALLY UNPAUSABLE (`_withdraw` has no pause check, `src/YieldShares.sol:266-278`; `_redeem` likewise, `src/RoamVault.sol:537-580`). The roamer's migrations between books are guardrailed (`MIN_HOLD` / `MAX_MIGRATIONS_PER_PERIOD` / `MIN_EXPECTED_GAIN_BPS`, Safe-settable) and are operator-run — see the PERMISSION MODEL section.

## CONTRACT SURFACE (ROAMER STACK)

**RoamVault — `src/RoamVault.sol`**

| Function | Source | Notes |
|---|---|---|
| `asset()` / `totalAssets()` | ERC-4626 std / custom | USDG (6 dec); storage-based total |
| `deployedBook()` / `idleBook()` | public state | capital deployed into books vs idle; invariant `deployedBook + idleBook == totalAssets` |
| `convertToShares(uint256)` / `convertToAssets(uint256)` | ERC-4626 + offset | offset 6 (`:100`) → 12-dec shares; `convertToAssets(1e12)` ≈ 1.0 USDG at 1:1 |
| `maxDeposit(address)` / `maxMint(address)` | custom `:290` | `0` when paused; else `DEPOSIT_CAP − totalAssets` |
| `depositsPaused()` / `DEPOSIT_CAP()` / `DEPOSIT_CAP_CEILING()` | public state | pause flag; operating cap; immutable 250,000e6 ceiling |
| `decimals()` / `symbol()` | ERC-20 std (offset-shifted) | `12` / `"wsrUSDG"` (live 2026-09-15) — 6-dec USDG asset + offset 6 = asset decimals + 6 |
| `backingCoverage()` | custom `:265-268` | 1e18 fixed point; denominator is the STORED IDLE book (`idleBook()`), NOT `totalAssets()`; an EMPTY vault reads exactly 1e18 (READ BATTERY #14) |
| `deposit(uint256,address)` / `mint(uint256,address)` | ERC-4626 entries | pause-checked on BOTH routes (`src/RoamVault.sol:494`, error `DepositsPaused` `:169`) |
| `withdraw(uint256,address,address)` / `redeem(uint256,address,address)` | ERC-4626 entries | structurally unpausable — `_redeem` has no pause check (`src/RoamVault.sol:537-580`); settle through `_redeem` (`src/RoamVault.sol:523-556`) |
| `redeemWithMinOut(uint256,address,address,uint256)` | custom `:337-344` | fail-closed exit: reverts `PayoutBelowMin` (`:578`) when the payout lands below `minPayout` — the DEFAULT exit (see WRITE FLOWS) |
| `previewDeposit/Mint/Withdraw/Redeem` | ERC-4626 std | preview before send, always |
| `harvest(uint256 assets)` | custom `:407-415` | **ROAMER-ONLY** (`NotHarvester`); excess-bounded credit; agents OBSERVE, never call |
| `wellToken()` | public state | `0x0` until the one-shot `setWellToken` — the burn lane stays BURN-PENDING |
| events | `:160` + OZ | `YieldHarvested(uint256 indexed assets, uint256 newIdleBook)` + OZ `Deposit`/`Withdraw`/`Transfer`/`Approval` |

**RoamingHarvester — `src/RoamingHarvester.sol`** (reads only — the write surfaces are tiered in the PERMISSION MODEL section)

| Surface | Source | Notes |
|---|---|---|
| `minHoldSeconds` / `maxMigrationsPerPeriod` / `minExpectedGainBps` / `migrationFeeBps` | `:239-242` | public state; the compiler auto-getters ARE the read surface; Safe-settable within immutable ceilings |
| `positionRecord(bytes32)` / `migrationsThisPeriod()` / `openKeyCount()` / `isVaultPosition(bytes32)` | `:384-394`, `:1412-1414` | book/position state reads |
| `vaultAccrued(token)` | `:1367` | the 90% vault bucket awaiting `sweepVaultYield()` |
| `sweepVaultYield()` | `:1435-1441` | AGENT-SAFE (operator instruction only) — fills the vault's 90% bucket |
| `sweepToBurn()` | `:671-678` | AGENT-SAFE but INERT until `setWellToken` (revert `NoWellToken` = data) |
| events | `:267-273` | `BookOpened`, `FeesCollected(bytes32 indexed keyHash, bytes32 indexed poolId, uint256 amount0, uint256 amount1)`, `MigrationExecuted` |
| `migrate(...)` / `exitBook(...)` | `:579` / `:634` | OPERATOR-SCOPED — never fired by an agent (PERMISSION MODEL) |

**RoamAllowlist — `src/RoamAllowlist.sol`**: `bookCount()` (`:114`), `isListed(bytes32)` (`:109`), `BookAdded(bytes32 indexed poolId, PoolKey key, BookMeta bookMeta)` (`:48`); `addBook` is onlyTimelock (`:80`).

## READ BATTERY

All keyless, every command live-verified 2026-09-15. Set up once:

```bash
export RPC=https://rpc.mainnet.chain.robinhood.com
# Pinned byte-exact from site/js/config.js roamStack / uniswapV4 (live verification 2026-09-15).
# DO NOT substitute any other hex: addresses come only from config.js / this skill.
VAULT=0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86        # RoamVault
ROAMER=0xC7a21Aa8C15C7032eE2e8352244a0f3D2154dC68       # RoamingHarvester
ALLOWLIST=0x6040bA3e356cb023C67002De45D2af56FED4e81A    # RoamAllowlist
USDG=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168         # vault asset (6 dec)
TIMELOCK=0xD55bA510533dc5a250b4D6d49Ee825113DD69342
POOL_ID=0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551  # USDG/ETH anchor book
```

**Expected result for every command below: a real, decodable value.** The stack is live. A revert or empty result is still data — deposits paused, a book not listed, no logs in the window, or wrong args — not a bug to work around and not a reason to hunt for "the real" contract elsewhere on the chain.

| # | Read | Command | Expected output SHAPE |
|---|---|---|---|
| 1 | Harvester binding | `cast call $VAULT 'harvester()(address)' --rpc-url $RPC` | the roamer pin — the one-shot `setVault` binding; any other value = do not interact, re-pin from config first |
| 2 | Total accounted assets | `cast call $VAULT 'totalAssets()(uint256)' --rpc-url $RPC` | one uint256, USDG-wei (6 dec). Scale basis: RoamVault shares are 1e12 raw per whole share (12-dec `wsrUSDG` = asset decimals + 6) — never print raw share counts without that scale |
| 3 | Book split | `cast call $VAULT 'deployedBook()(uint256)' --rpc-url $RPC` and `cast call $VAULT 'idleBook()(uint256)' --rpc-url $RPC` | two uint256, USDG-wei; invariant `deployedBook + idleBook == totalAssets` — a mismatch is a mid-settlement state: re-read and report, never patch |
| 4 | Deposit headroom | `cast call $VAULT 'maxDeposit(address)(uint256)' 0x0000000000000000000000000000000000000000 --rpc-url $RPC` | uint256 USDG-wei; while `depositsPaused == false`, `maxDeposit + totalAssets == DEPOSIT_CAP` (operating 25_000e6 = 25000000000 raw — a different `DEPOSIT_CAP()` read is data, report it; immutable ceiling 250_000e6, `src/RoamVault.sol:106-112` + `:206-208`); `0` = HARD STOP |
| 5 | Deposit pause flag | `cast call $VAULT 'depositsPaused()(bool)' --rpc-url $RPC` | `true`/`false` |
| 6 | Share price | `cast call $VAULT 'convertToAssets(uint256)(uint256)' 1000000000000 --rpc-url $RPC` | uint256 USDG-wei backing 1e12 shares (= 1.0 USDG at 1:1). Share scale is **12 decimals** (USDG 6 + offset 6, `src/RoamVault.sol:100`) — the RoamVault basis is 1e12 raw per whole share; the legacy ws-SPY basis is 1e24 (LEGACY) — never print a raw share count without the per-vault scale |
| 7 | Redeem preview | `cast call $VAULT 'previewRedeem(uint256)(uint256)' <shares-wei> --rpc-url $RPC` | uint256 USDG-wei you would receive — the input to `redeemWithMinOut`'s `minPayout` |
| 8 | Roamer guardrails | `cast call $ROAMER 'minHoldSeconds()(uint32)' --rpc-url $RPC` / `cast call $ROAMER 'maxMigrationsPerPeriod()(uint16)' --rpc-url $RPC` / `cast call $ROAMER 'minExpectedGainBps()(uint32)' --rpc-url $RPC` | as-of 2026-09-15: 604800 (7d) / 4 / 3911. **EVALUATOR RULE:** these are timelock-settable (`src/RoamingHarvester.sol:239-241`) — on a mismatch, check pending/executed timelock ops FIRST (battery #12); only an unexplained change is a stop |
| 9 | Allowlist | `cast call $ALLOWLIST 'bookCount()(uint256)' --rpc-url $RPC` and `cast call $ALLOWLIST 'isListed(bytes32)(bool)' $POOL_ID --rpc-url $RPC` | `bookCount >= 1`; the USDG/ETH anchor reads `true` |
| 10 | Vault yield history | `cast logs --from-block <N> --to-block latest --address $VAULT 'YieldHarvested(uint256,uint256)' --rpc-url $RPC` | one log per credit: assets credited + new idle book. Empty before the first harvest = data, not error |
| 11 | Roamer activity | `cast logs --from-block <N> --to-block latest --address $ROAMER 'FeesCollected(bytes32,bytes32,uint256,uint256)' --rpc-url $RPC` (also `BookOpened(...)` / `MigrationExecuted(...)`) | per-book fee collections, book opens, migrations. Empty windows = data (the book has not paid fees yet) |
| 12 | Pending timelock ops | `cast call $TIMELOCK 'readyAt(bytes32)(uint256)' <id> --rpc-url $RPC` | uint256 unix timestamp (0 = not queued); enumerate via `CallQueued` logs — the input to battery #8's EVALUATOR RULE |
| 13 | Share-token identity | `cast call $VAULT 'decimals()(uint8)' --rpc-url $RPC` and `cast call $VAULT 'symbol()(string)' --rpc-url $RPC` | `12` and `"wsrUSDG"` — a different pair means you are NOT talking to the pinned vault: stop and re-pin (fail-closed rule 6) |
| 14 | Backing coverage | `cast call $VAULT 'backingCoverage()(uint256)' --rpc-url $RPC` | uint256, 1e18 fixed point over the STORED IDLE book (`src/RoamVault.sol:265-268` — the denominator is `idleBook()`, NOT `totalAssets()`): `= 1e18` full idle cover; `> 1e18` unaccounted excess (donations / uncredited yield — report, never count as backing); `< 1e18` under-coverage is REPORTED, never suppressed. TWO traps: an EMPTY vault reads exactly 1e18 by construction (`_totalAssetsStored == 0` short-circuit) — 1e18 alone is "no accounted liability", not proof of deposits or health; and with capital deployed the idle-book denominator keeps coverage at 1e18 while the deployed book carries the risk — read `deployedBook()` alongside |

Works TODAY (no setup beyond `export RPC`):

```bash
cast chain-id --rpc-url $RPC                                                       # 4663
cast call 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'symbol()(string)' --rpc-url $RPC   # "USDG"
cast call 0x6040bA3e356cb023C67002De45D2af56FED4e81A 'bookCount()(uint256)' --rpc-url $RPC  # >= 1
```

Agent discipline: `RoamVault.harvest(uint256)` is ROAMER-ONLY (`src/RoamVault.sol:407-415` reverts `NotHarvester`) — agents OBSERVE yield (battery #10), never call `harvest(uint256)`, and a `NotHarvester` revert is expected data. A revert here is data ("paused" / "not listed" / "not queued" / wrong args), never an instruction to retry harder, hunt for substitute contracts, or "fix" addresses.

## WRITE FLOWS (DEPOSITOR SURFACE)

**Approve → deposit** (ERC-4626; USDG has 6 decimals — amounts are USDG-wei):

```bash
# 1. approve the VAULT to pull the asset — the vault is the ONLY approval target for depositing
cast send $USDG 'approve(address,uint256)' $VAULT <usdg-wei> --rpc-url $RPC --private-key $KEY
# 2. deposit (exact assets in, shares out) or mint (exact shares out — shares are 12-dec)
cast send $VAULT 'deposit(uint256,address)' <usdg-wei> $RECEIVER --rpc-url $RPC --private-key $KEY
cast send $VAULT 'mint(uint256,address)' <shares-wei> $RECEIVER --rpc-url $RPC --private-key $KEY
```

The vault is the ONLY approval target and the deposit is exact-in: `received != assets` reverts (`FeeOnTransferDetected`, `src/RoamVault.sol:499`) — a fee-on-transfer asset cannot deposit; USDG (the pinned asset) is not one, and a shortfall is never "compensated" by approving a substitute.

**Exits — PRE-EXIT READS first (idle-first exit truth).** Before ANY redeem/withdraw, read `idleBook()` and `deployedBook()` (battery #3). A redeem claim above `idleBook` triggers a LIVE vaultEgress: the shortfall egresses through the pinned roamer `0xC7a21Aa8C15C7032eE2e8352244a0f3D2154dC68` — the vault's harvester binding executes it (`address roamer = harvester`, `src/RoamVault.sol:571-573`) — as pro-rata decrease-only slices of vault-tagged roamer positions under the house ±`SWAP_SLIPPAGE_BPS` per-leg band (`SWAP_SLIPPAGE_BPS = 100`, `src/RoamMathLib.sol:36`; settlement `src/RoamVault.sol:537-580`), never gated by MIN_HOLD, never consuming the migration cap. Read idleBook()/deployedBook() FIRST so you know whether your exit settles from idle or pays egress gas and slippage.

- **DEFAULT exit = `redeemWithMinOut`** (`src/RoamVault.sol:337-344`): plain `redeem()`/`withdraw()` default their payout floor to the roamer's house ±`SWAP_SLIPPAGE_BPS = 100` band applied per converted leg (`src/RoamVault.sol:327-331`; `src/RoamingHarvester.sol:176`) — that band is house protection, NOT a redeemer-set floor — so derive `minPayout` from a FRESH `previewRedeem(shares)` minus your own bounded tolerance immediately before the send; `redeemWithMinOut` is the per-call REDEEMER-bounded floor reverting `PayoutBelowMin` (`src/RoamVault.sol:578`):

```bash
cast send $VAULT 'redeemWithMinOut(uint256,address,address,uint256)' <shares-wei> $RECEIVER $OWNER <minPayout> --rpc-url $RPC --private-key $KEY
# vanilla entries exist — redeem(uint256,address,address) / withdraw(uint256,address,address) — but are NOT the default
```

- `InsufficientBacking` (claim > idle + deployed, `src/RoamVault.sol:546`) and `PayoutBelowMin` (`:578`) reverts are expected data, never errors to work around: the first means the claim exceeds backing (report the state), the second means the fresh preview moved against you between preview and mine (re-preview and decide — never raise `minPayout` to force a send).

**Pause mode — read before ANY deposit write.** `depositsPaused()` (battery #5) and/or `maxDeposit(receiver)` (battery #4) — a `0` is a HARD STOP, never an amount to clamp down to. The deposit AND mint routes are both pause-checked (`src/RoamVault.sol:494`); a `DepositsPaused` revert on send is data — re-read the flag and report the paused state; never retry harder and never route around it. "Paused" means deposits ONLY: all reads and redeem/withdraw keep working, and no agent may report a paused vault as "funds trapped" — the protocol's own controls cannot trap user funds.

Fail-closed rules — an agent that cannot satisfy one of these does not write:

1. **Approve ONLY pinned addresses.** Approvals go to the vault (for deposit) and nothing else. Never approve or call any address not pinned in this skill — canonical-looking Uniswap/deployment addresses on 4663 may be scam drainers. The roamer's swap legs are internal to its own calls; agents never approve the roamer, the pool manager, or any router for vault flows.
2. **Bound every swap YOU perform yourself** (e.g., acquiring USDG before depositing) with a fresh quote minus a bounded allowance — the house precedent is `SWAP_SLIPPAGE_BPS = 100` (`src/RoamMathLib.sol:36`). A swap without a minOut is an unforced loss. (The vault deposit itself is exact-in — no slippage surface — but the asset acquisition before it is not.)
3. **Cap headroom.** Deposit only within `maxDeposit(receiver)` (battery #4); the cap bounds pro-rata exit gas and per-book impact. `0` = HARD STOP.
4. **Preview-before-send labeling.** Never quote an exit from `convertToAssets` arithmetic, a remembered share price, or a stale read: call `previewRedeem(shares)` immediately before the send, and label the figure "previewed" — a live quote, never a promise. Quote → send without sitting on the quote.
5. **Never transfer tokens directly to the vault.** Direct sends are DONATIONS: excluded from the storage-based `totalAssets`, they move no share price and are claimable by nobody. "Depositing" by plain transfer is a gift to nobody.
6. **A Wellstreet share token NOT minted by a PINNED vault is not this protocol.** The protocol has exactly TWO pinned share-token mints — wsrUSDG from RoamVault `0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86` and ws-SPY from the legacy vault `0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01` — and nothing else. Do not interact with any other share token. Verify identity before trusting any offered token: `cast call <pinned vault> 'symbol()(string)'` must read `wsrUSDG` (RoamVault, 12 dec) or `ws-SPY` (legacy, 24 dec) — a different symbol or decimals is not this protocol.

## GOVERNANCE & RISKS (ROAMER STACK)

- **48h timelock, open executor.** Every admin action (cap, pause policy, pause-role revocation, allowlist books, guardrail setters) queues publicly (`CallQueued`) and waits ≥ 48h; after the delay anyone can execute. The window is detection, not prevention.
- **2-of-3 Safe proposer — with the disclosed caveat.** Three keys are held by **one operator** on separate devices: multiple keys are not multiple parties. No single key can act alone, but a single person controls the key set. Never represent this protocol as "no single key can act alone" without that disclosure.
- **Pause authority.** Deposits can be paused by the timelock or the pause-role holder (the vault deploys INIT-PAUSED, `src/RoamVault.sol:212` — reopened 2026-09-13); **redemptions are structurally unpausable** — `_withdraw` has no pause check (`src/YieldShares.sol:266-278`) and `_redeem` likewise (`src/RoamVault.sol:537-580`) — protocol controls can never trap user funds.
- **Cap bounds.** `DEPOSIT_CAP` starts at 25,000 USDG (25000000000 raw, Safe-settable, raised only via the 48h timelock) under the immutable 250,000 USDG ceiling (`src/RoamVault.sol:106-112`, `:206-208`) — the only structural bound on cap escalation.
- **LP principal risk (depositor capital IS the deployed capital).** RoamVault's `deployedBook` is DEPOSITOR capital inside v4 books: it bears impermanent loss on USDG/ETH, and an exit that exceeds `idleBook` realizes the marked shortfall through the book exit (proceeds vs the mark are the redeemer's slice). Books are guardrailed (MIN_HOLD / migration cap / min-gain floor), but guardrails bound migration frequency — they do not remove IL.
- **Single-book concentration.** The vault's deployed capital sits in the USDG/ETH anchor book; yield scales with that book's trading volume and approaches zero when volume does. A quiet book earns nothing.
- **USDG issuer risk.** The vault asset is a third-party stablecoin; issuer pause/blocklist/upgrade risk sits outside this protocol's control. Details: `docs/public/risk-disclosure.md`.
- **Force-sent tokens.** Anything force-sent to the vault is donated — to nobody. Do not "recover" such tokens; there is no recovery path, by design.
- **Experimental, unaudited software with no operating history.** No third-party audit has been performed. The Foundry suite (`forge test`) covers the invariants; it does not eliminate the risk.

## HONEST REPORTING

**The measured basis is the fleet feed — `site/data/fleet.json`.** Its `provenance.method` is the labeling contract: "feeAprPct prefers the fixture's measured APR-M run-rate, else its formula APR-F (locked formula on DexScreener vol24h); chargedFeeBps is the fixture's swap-count-weighted mean of the charged-fee dist; zero-swap books are never estimated." Match the vault's anchor book by poolId `0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551` and cite the file's `generated` date with every figure (at the 2026-09-16 generation the anchor row read: `feeAprPct` 165, `chargedFeeBps` 1057.0 wavg over 1488 swaps, window a, tier PAYS). That figure is a BOOK-level measured fee APR — never print it as a depositor figure.

- **Vault-lane split as NAMED CONSTANTS.** Vault-lane revenue splits `DEPOSITOR_BPS = 9000` / `BURN_BPS = 1000` (`src/RoamVault.sol:91-96`); the burn tail is inert while `wellToken() == 0x0` (BURN-PENDING accrual — see the PERMISSION MODEL rider). A depositor-realization chain labels EVERY input: book fee APR (fleet feed, source+window) × the vault's in-book LP share (chain reads: `deployedBook` vs the book's TVL) × 9000/10000. Skip any input you cannot measure — print "no figure", not a guess.
- **Historical note (retired formula).** The pre-roamer ws-SPY flagship used `pool_net_rate × (L_pos / L_pool) × (pool_TVL / vault_TVL) × 0.9` — RETIRED with the wind-down; kept for history only, never computed again.

**Rules for any number an agent prints:**

1. **Source + window + formula, every time.** Every APR figure carries what it was measured from, the window it covers, and the chain that produced it. A bare "APR: X%" is a violation of this skill.
2. **Backward-looking only.** A measured figure is historical and reproducible only from the evidence it was computed from. Yield is swap-fee income — it varies with volume hourly and seasonally, and it approaches zero when volume does. Never present a past rate as a future one.
3. **Never a promise, target, or headline.** Label figures "projected, not promised" or "measured input, historical window". No figure in this project is an offer, solicitation, or financial advice. If a label and a headline number disagree, the labeling rules win.
4. **Never print from thin data.** Zero-swap books are never estimated; incomplete feeds drop the window rather than patching it. If the fleet feed is unavailable, print "no figure" — not the last number, not a fallback presented as current.
5. **Report risk alongside yield.** Any yield report names the counterfactual honestly: the same book income divided among more depositors dilutes per-depositor APR, and the deployed book capital that generates it bears IL and can shrink.
6. **Scales are part of the figure — and per-vault.** USDG amounts are 6-dec wei; share amounts follow asset decimals + 6: wsrUSDG is 12-dec (RoamVault, 1e12 raw per whole share; `convertToAssets(1e12)` ≈ 1.0 USDG), legacy ws-SPY is 24-dec (1e24 raw per whole share). Never print a raw wei count as a human figure without naming the vault and its scale.

## LP ROUTING — DEFAULT AND DISCOVERY

Default routing: vault/roamer = safe default; direct LP = you're-on-your-own. The roamer enforces the guardrails below on every migration. If you LP directly, YOU own these checks — the protocol will not stop you, and nothing here is a promise of any particular APR; every figure you see is measured-only and backward-looking with its source and window attached.

Before ANY direct-LP choice, evaluate the roamer guardrails from the READ BATTERY (#8: `minHoldSeconds` / `maxMigrationsPerPeriod` / `minExpectedGainBps` — timelock-settable; re-verify on mismatch via pending timelock ops). Book discovery: RoamAllowlist `BookAdded` logs + `bookCount()`/`isListed(bytes32)` + the live book table `site/data/fleet.json`. Position mint/manage on the fork-v4 PositionManager and the self-custodied router are owned by the companion LP-PATH-TEACHING goal of this same batch — this pointer is its landing pad; no mint/manage mechanics are taught here.

## LEGACY — the ws-SPY flagship (wound down)

The pre-roamer ws-SPY vault is WOUND DOWN: no new deposits. The vault is still live on-chain with real share holders, so its reads and redeem remain valid — a fail-closed skill tells an agent holding ws-SPY how to exit. Old pinned addresses are unchanged. Share scale is PER-VAULT: the 18-dec SPY asset mints 24-dec shares (1e24 raw = 1 human share; offset 6, `src/YieldShares.sol:49`).

| Address | What |
|---|---|
| `0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01` | ws-SPY vault (YieldShares, ERC-4626) — old pinned address, unchanged |
| `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | SPY — the wrapped stock token (18 dec) |

Valid keyless reads: `totalAssets()`, `convertToAssets(uint256)` (1e24 raw per whole share), `previewRedeem(uint256)`, `depositsPaused()`, `backingCoverage()` — 1e18 fixed point (`src/YieldShares.sol:152-156`): an EMPTY vault reads exactly 1e18 by construction ("no accounted liability", not proof of backing); `> 1e18` = unaccounted excess (donations raise the physical balance, never the accounting — report it, never count it as backing); `< 1e18` under-coverage is REPORTED, never suppressed.

Exit is structurally unpausable (`_withdraw` has no pause check, `src/YieldShares.sol:266-278`); preview immediately before send:
`cast send 0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01 'redeem(uint256,address,address)' <shares-wei> $RECEIVER $OWNER --rpc-url $RPC --private-key $KEY`

Any "ws-SPY" token whose address differs from the pinned vault is not this protocol — do not interact. The full old-world surface lives in this file's git history; nothing there is a routing recommendation.

## SELF-CHECK

Run these against your own copy of this skill (and your own drafted output) before acting. The dots in the overclaim pattern and the bracket-trick patterns are deliberate regex constructions so the pattern list never matches its own banned/pinned phrases:

```bash
S=skills/wellstreet-vaults/SKILL.md
test -f "$S" && echo SKILL_OK
grep -c '4663' "$S"                                              # >= 2  (chain pinned)
grep -cE 'DEPLOYED 2026-09-0[3]' "$S"                            # 0     (old-world deploy pins gone — frontmatter included)
grep -c '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86' "$S"        # >= 2  (RoamVault address count)
grep -c 'wsrUSDG' "$S"                                           # >= 2  (live share-token symbol pinned)
grep -c 'redeemWithMinOut' "$S"                                  # >= 1  (fail-closed exit present)
grep -cE 'structurally unpausable' "$S"                          # >= 1  (redemption liveness — both vaults)
grep -cF '12,473,590,000,000' "$S"                               # >= 1  (worked seed example at the 12-dec scale)
grep -cF 'asset decimals + 6' "$S"                               # >= 1  (per-vault share-scale rule present)
grep -cE 'DEPLOYED 2026-09-09' "$S"                              # >= 1  (satisfied by construction — the STATUS banner carries it verbatim)
grep -c 'ws-SP[Y]' "$S"                                          # <= 25 (legacy flagship mentions bounded)
grep -c 'pool_net_rat[e]' "$S"                                   # <= 1  (retired formula — the single historical note)
grep -cE 'backward-looking|window' "$S"                          # >= 3  (honest-APR labeling present)
grep -q 'Scam-drainer' "$S" && grep -q 'Never a promise' "$S" \
  && grep -qi 'risk alongside' "$S" && grep -q 'empty result is' "$S" && echo RULES_PRESENT
grep -ic 'v[i]be' "$S"                                           # 0     (no foreign branding)
grep -icE '[g]uaranteed|[r]isk.free|[a]lways.profitable|[n]o.impermanent.loss' "$S"   # 0  (no overclaim language)
awk '/^## LEGACY/{f=1;n=0;next} f&&/^## /{print n; exit} f{n++}' "$S"   # <= 15 (LEGACY block bound, heading-to-next-'## ')
grep -q 'DEPOSITOR_BPS' src/RoamVault.sol && grep -q 'minHoldSeconds' src/RoamingHarvester.sol \
  && grep -q 'function addBook' src/RoamAllowlist.sol && echo FUNCS_OK
```

If any count is off, your copy is stale or your output drifted — re-read the sources (`src/RoamVault.sol`, `src/YieldShares.sol`, `src/RoamingHarvester.sol`, `src/RoamAllowlist.sol`, `src/RoamMathLib.sol`, `site/js/config.js` roamStack, `site/data/fleet.json`, `docs/ops/roamer-deploy-runbook.md`) before acting.

## PERMISSION MODEL — WHO FIRES WHAT (ROAMER STACK)

Every roamer-stack surface is classified into exactly two tiers. **Fail-closed default: any roamer-surface function not listed AGENT-SAFE is treated OPERATOR-SCOPED by default.** Live-stack addresses come ONLY from `site/js/config.js:110-119` (`roamStack`) per the skill's pin-first rule — never approve or call an address not pinned there. This section governs every write flow in this skill — where any other region shows a capital-moving roamer call, this section's tier overrides.

### AGENT-SAFE (the complete sanctioned set — nothing outside this list is agent-safe)

1. **Keyless reads.** `positionRecord(bytes32)` / `migrationsThisPeriod()` / `openKeyCount()` (`src/RoamingHarvester.sol:384-394`), `isVaultPosition(bytes32)` (`RoamingHarvester.sol:1412-1414`), and `vaultAccrued(token)` (`:1367`, public mapping auto-getter). The guardrail getters are the PUBLIC state declarations `minHoldSeconds` / `maxMigrationsPerPeriod` / `minExpectedGainBps` / `migrationFeeBps` (`RoamingHarvester.sol:239-242`) whose compiler auto-getters ARE the read surface — there are NO explicit getter functions (`:410-425` is the onlyTimelock SETTER region and belongs to the OPERATOR-SCOPED tier below). Agents READ the live values (Safe-settable within immutable ceilings) and never write them.
2. **sweepVaultYield()** (`RoamingHarvester.sol:1435-1441`) — permissionless no-tip public good that fills the vault's 90% bucket (split constants DEPOSITOR_BPS 9000 / BURN_BPS 1000, declared `src/RoamVault.sol:91`/`:96`; the roamer's split docstring `RoamingHarvester.sol:1194-1201` cites them).
3. **sweepToBurn()** (`RoamingHarvester.sol:671-678`) — permissionless no-tip, but FAIL-CLOSED INERT until the one-shot setWellToken fires (revert NoWellToken `:672-673`). A NoWellToken revert is DATA — the burn lane is dormant — never a bug to work around and never a reason to hunt for another burn path.
4. **Vault ERC-4626 read/deposit/redeem flows.** RoamVault ERC-4626 read/deposit/redeem (user-own-capital flows; approvals to the pinned vaults only — RoamVault for wsrUSDG deposit/redeem, the legacy ws-SPY vault for its redeem) is PRE-CLASSIFIED AGENT-SAFE here and IS the skill's WRITE FLOWS region as of the 2026-09-15 S2 rewrite (deposits + redeemWithMinOut exits); the legacy ws-SPY redeem (LEGACY region) is likewise user-own-capital and stays agent-safe. Deposit/redeem moves the caller's OWN position capital, never depositor capital — that distinction is what separates this tier from migrate().

**SEAM CORRECTION:** there is NO agent-callable harvest() on the roamer — collectOnePosition (`RoamingHarvester.sol:798`) and sweepOneToken (`:808`) are guarded self-calls (CallbackNotActive revert), and RoamVault.harvest(uint256) (`src/RoamVault.sol:407-416`) is harvester-gated (NotHarvester) — the internal credit seam the roamer's own sweep drives (`RoamingHarvester.sol:1663`). The 90% leg's agent action IS sweepVaultYield().

### OPERATOR-SCOPED — NEVER FIRE

1. **migrate(bytes fromKey, bytes toKey, uint256[2] minOuts, uint32 expectedGainBps)** (`RoamingHarvester.sol:579`) — the function IS contract-permissionless (anyone can fire it, which is exactly why the skill gates it), and `expectedGainBps` is a caller-supplied ATTESTATION — the source line says it plainly: "It is NOT a proof" (`RoamingHarvester.sol:100`). An agent firing migrate() with guessed minOuts / expected-gain gambles DEPOSITOR capital (position capital is protocol/vault capital; the caller's only stake is gas). Contract backstops, as context and never as a recipe: MIN_HOLD 604800 seconds (`:239`), MAX_MIGRATIONS_PER_PERIOD 4 rolling-365d with re-ranges counting (`:240`), MIN_EXPECTED_GAIN_BPS 3911 attestation floor (`:241`) — live-verified 604800/4/3911 (`docs/ops/roamer-deploy-runbook.md`, DEPLOYED ADDRESSES "Verified:" block) — plus per-currency MinOutBreached floors (`:956-957`), and the toKey is allowlist-railed + salt-0 (`:606-609`: _validateBand `:606`, SaltMustBeZero `:607`, allowlist.isListed `:609`).

   **POLICY RULE: migrate() is NEVER FIRED by an agent — observe and report ONLY.** Migrations are executed OFF-CHAIN by the operator from the fleet screen per the ratified on-chain/off-chain split (`docs/ops/roam-ops.md`, BINDING: "the operator runs migrations off-chain (feed → candidates → guardrail pre-checks …)"). The agent's report IS the operator's feed row: candidate from-book → to-book, measured fee-APR spread, and expectedGainBps recorded verbatim as an unbounded claim sanity-bound off-chain per roam-ops.md's reporting rules — never a fire command.

2. **exitBook(bytes fromKey, address to)** (`RoamingHarvester.sol:634`) — onlyTimelock (NotTimelock revert; contract-enforced impossible for an agent), vault-tagged positions additionally VaultPositionProtected (`:639`) — observe and report ONLY.

3. All onlyTimelock surfaces — the setters (`:410-461`), seedBook (`:532`), rescueToTreasury (`:475`), and the one-shot setWellToken (`:461`) — and the vault-only surfaces vaultDeploy / vaultEgress (NotVault `:1456`/`:1487`) are OPERATOR/CONTRACT-ONLY, each one line here: named for completeness, never taught, never provisioned with a command.

4. **Fail-closed REVERT MAP** — every revert is data, none is a bug to work around: HoldLocked · MigrationCapReached · GainAttestationMissing · GainAttestationBelowFloor · MinOutBreached · UnknownPosition (toKey not allowlisted) · SaltMustBeZero · BooksShareNoCurrency · NoWellToken · NotTimelock · NotHarvester (RoamVault.harvest(uint256) is harvester-only — data, not a bug to work around) · ExcessTooSmall (RoamVault) · CallbackNotActive.

### The two tier markers — safe has a recipe, gated never does

The AGENT-SAFE sweeps are no-tip public goods and are the ONLY two send recipes this skill carries:

```bash
# sweepVaultYield — fills the vault's 90% bucket (DEPOSITOR_BPS 9000). Fire on explicit operator instruction only; no self-scheduled keeper cadence in this skill.
cast send $ROAMER 'sweepVaultYield()' --rpc-url $RPC --private-key $KEY
# sweepToBurn — moves the BURN-PENDING accrual toward the burn lane (NoWellToken revert until setWellToken fires). Fire on explicit operator instruction only; no self-scheduled keeper cadence in this skill.
cast send $ROAMER 'sweepToBurn()' --rpc-url $RPC --private-key $KEY
```

The prohibition on the OPERATOR-SCOPED tier is absolute and stated in prose only: that tier carries no command string anywhere in this skill — not as an example, not negated, not disguised — and nothing in this skill self-schedules any send; the two recipes above fire on explicit operator instruction only.

### BURN-PENDING DISCLOSURE RIDER

Every RoamVault yield report the agent produces carries this line: vault-lane revenue splits 90/10 (DEPOSITOR_BPS / BURN_BPS), and the 10% accrues for burn — burn activates when $WELL launches. Until then the 10% sits BURN-PENDING as accounted accrual (conserved, never treasury, never junk-forwarded) until the ONE-SHOT setWellToken fires, after which the next sweep burns it. Source: `docs/ops/roam-ops.md` §6a "RoamVault provenance split + the BURN-PENDING dormant lane" (cite by heading only — that doc is live-edited and its line numbers move).

### Section self-check

The dots in the overclaim pattern are deliberate regex any-chars and the gated-call sentinels use the house bracket trick, so the pattern list never matches its own banned phrases:

```bash
S=skills/wellstreet-vaults/SKILL.md
grep -c '^## PERMISSION MODEL' "$S"                        # >= 1  (gate section present)
grep -c 'AGENT-SAFE' "$S"                                  # >= 2  (tier named)
grep -c 'OPERATOR-SCOPED' "$S"                             # >= 2  (tier named)
grep -c 'It is NOT a proof' "$S"                           # >= 1  (attestation quote)
grep -c 'NEVER FIRE' "$S"                                  # >= 1  (policy rule)
grep -c 'sweepVaultYield' "$S"                             # >= 2  (tier entry + recipe)
grep -cE '\b604800\b' "$S"                                 # >= 1  (MIN_HOLD pin)
grep -cE '\b3911\b' "$S"                                   # >= 1  (attestation floor pin)
grep -c 'MAX_MIGRATIONS_PER_PERIOD' "$S"                   # >= 1  (cap pin)
grep -c 'NoWellToken' "$S"                                 # >= 1  (inert-until-setWellToken)
grep -c 'harvest(uint256)' "$S"                            # >= 2  (SEAM CORRECTION + NotHarvester revert-map row)
grep -c '10% accrues for burn' "$S"                        # >= 1  (disclosure rider)
grep -cE 'cast send.*sweepVaultYield' "$S"                 # >= 1  (safe-sweep recipe present)
grep -cE 'cast send.*sweepToBurn' "$S"                     # >= 1  (safe-sweep recipe present)
grep -cE 'cast send.*[m]igrate' "$S"                       # 0     (no fire recipe for the gated roam surface)
grep -cE 'cast send.*[e]xitBook' "$S"                      # 0     (no fire recipe for the gated exit surface)
grep -icE '[a]uto-rebalance|[s]afe.to.migrate' "$S"        # 0     (overclaim guard)
```
