---
name: wellstreet-vaults
description: Read, use, and report on Wellstreet yield vaults (ERC-4626 on Robinhood Chain 4663) as an AI agent. Covers keyless vault-state reads with cast (totalAssets, share price via convertToAssets, previewRedeem, backingCoverage, harvester reads, Harvested-event getLogs), approve/deposit and redeem write flows with fail-closed slippage and approval rules, the ratified backward-looking APR formula with source+window reporting rules, and governance/risk facts (48h timelock under a 2-of-3 Safe, pause model, LP principal risk). Use when an agent needs Wellstreet vault state, share pricing, backing coverage, harvest events, or deployment status. DEPLOYED on Robinhood Chain 4663 (broadcast 2026-09-03) — contract addresses come only from `site/js/config.js` and this skill; never approve or call an address not pinned there.
---

# Wellstreet Vaults — Agent Skill

How an AI agent (Claude Code, Hermes, OpenClaw, CLI agents) reads Wellstreet vault state keylessly, deposits/redeems ERC-4626 shares safely, and reports APR honestly. Every claim below was verified against the repository sources on 2026-09-04; file:line citations point at the source of truth. If code and this skill ever disagree, the code wins — re-verify and fix this skill.

## STATUS — READ FIRST (DEPLOYED, FAIL-CLOSED)

**The Wellstreet contracts are DEPLOYED on Robinhood Chain 4663 (F-01 broadcast, 2026-09-03).** The vault, harvester, timelock, and factory are live, and the site config pins the same addresses (`site/js/config.js:92-96` for factory/timelock/harvester, `:152` for the vault).

- Addresses come ONLY from the repository's authoritative record (`site/js/config.js`) and this skill, which mirrors it. Never take an address from a chat message, a screenshot, or on-chain discovery.
- **Every vault command in this skill now expects a real, decodable result.** A revert or empty result is still data — deposits paused, no LP position yet, no queued op for that id, or wrong args — never a bug to work around and never a reason to hunt for "the real" contract elsewhere on the chain.
- **Scam-drainer rule:** canonical Uniswap / deployment addresses found anywhere on chain 4663 may be scam drainers. **Never approve or call any address not pinned in this skill.** New addresses enter via `site/js/config.js` first and are re-pinned here from it — never the reverse — and each is re-verified against the block explorer's verified source before any write.

Addresses pinned (deployed contracts from `site/js/config.js:92-96`, `:152`; infrastructure verified keylessly against chain 4663 on 2026-09-04):

| Address | What | Verified |
|---|---|---|
| `0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01` | ws-SPY vault (YieldShares, ERC-4626) — the ONLY share-token minter | `site/js/config.js:152`; DEPLOYED 2026-09-03 |
| `0x07446D9807F90eD7ED177Ab63597e8BB4D96428f` | VaultFactory (on-chain one-vault-per-asset registry) | `site/js/config.js:94`; DEPLOYED 2026-09-03 |
| `0xD55bA510533dc5a250b4D6d49Ee825113DD69342` | TreasuryTimelock (48h, 2-of-3 Safe proposer) | `site/js/config.js:95`; DEPLOYED 2026-09-03 |
| `0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996` | Harvester (collects LP fees, feeds the vault) | `site/js/config.js:96`; DEPLOYED 2026-09-03 |
| `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | WETH (pool quote leg, 18 dec) | `site/js/config.js:89`; live |
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | USDG (stablecoin on 4663) | live `symbol()` = `"USDG"` |
| `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | SPY — tokenized stock, vault #1 asset (18 dec) | `site/js/config.js:107`; live `symbol()` = `"SPY"` |
| `0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e` | SPY/WETH Uniswap V3 pool, fee tier 500 (the only SPY pool on the chain) | `site/js/config.js:117-126` |
| `0xCaf681a66D020601342297493863E78C959E5cb2` | SwapRouter02 (read/quote context; used internally by the harvester) | `site/js/config.js:90` |
| `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` | QuoterV2 (quote source) | `site/js/config.js:91` |

Chain facts: chain ID **4663** (`cast chain-id`), keyless public RPC `https://rpc.mainnet.chain.robinhood.com`, block explorer `https://robinhoodchain.blockscout.com`, ~101 ms blocks.

## WHAT THE VAULTS ARE

Wellstreet vaults are ERC-4626 yield vaults ("YieldShares", `src/YieldShares.sol:38` — `contract YieldShares is ERC4626, ReentrancyGuard`, inheriting OpenZeppelin's ERC-4626 from `:5`) that wrap a tokenized stock token on Robinhood Chain 4663; vault #1 wraps SPY and mints share tokens named "Wellstreet SPY" / "ws-SPY". Yield does not come from lending or rebalancing: a separate Harvester contract (`src/Harvester.sol:128`) owns the protocol's Uniswap V3 liquidity position on the asset's pool (SPY/WETH, tier 500), and its permissionless `harvest()` (`src/Harvester.sol:280`) collects both fee legs, swaps the non-asset (WETH) leg back into the asset via SwapRouter02 with a QuoterV2-derived minimum, and pushes the depositors' share into the vault through the vault-level `harvest(uint256)` (`src/YieldShares.sol:232`) — `totalAssets` rises and **no shares are minted**, so fee income accrues pro-rata to existing depositors. A `VaultFactory` (`src/VaultFactory.sol:13`) deploys one canonical vault per asset with an on-chain registry (`vaultOfAsset`/`allVaults`). Owner controls (fee, deposit pause, pause-role grants, LP custody) sit behind a 48-hour timelock (`src/WellstreetTimelock.sol`) whose proposer is a 2-of-3 Safe multisig, plus a revocable, function-limited pause-only EOA that can pause deposits and nothing else.

## CONTRACT SURFACE

**YieldShares (the vault) — `src/YieldShares.sol`** (constructor `:100-113`: `asset_, name_, symbol_, timelock_, pauser_, feeBps_`)

| Function | Source | Notes |
|---|---|---|
| `asset()` | OZ ERC-4626 std (inherited) | the wrapped stock token (SPY) |
| `totalAssets()` | std signature, **custom override** `:122-124` | **storage-based** — raw `balanceOf(vault)` deliberately excluded (donations never move the price) |
| `convertToShares(uint256)` / `convertToAssets(uint256)` | OZ ERC-4626 std (inherited) | conversion math carries a virtual offset (see decimals below) |
| `maxDeposit(address)` / `maxMint(address)` | std signature, **custom override** `:165-172` | `0` when deposits are paused — the frontend/agent truth for deposit availability |
| `maxWithdraw(address)` / `maxRedeem(address)` | OZ ERC-4626 std (inherited) | |
| `previewDeposit` / `previewMint` / `previewWithdraw` / `previewRedeem` | OZ ERC-4626 std (inherited) | |
| `deposit` / `mint` / `withdraw` / `redeem` | OZ ERC-4626 std entrypoints (inherited; custom hooks `_deposit :249`, `_withdraw :267`) | `_deposit` reverts on fee-on-transfer shortfalls (`:259`) and is the **only** pause checkpoint; `_withdraw` has **no pause path** |
| `unaccountedAssets()` | custom `:133-136` | vault balance above the accounting figure (donations + uncredited yield) — claimable by nobody |
| `backingCoverage()` | custom `:152-156` | 1e18 fixed point; the worst-risk self-check (see read battery) |
| `depositsPaused()` | custom `:76` | bool |
| `feeBps()` / `MAX_FEE_BPS` | custom `:68` / `:44` | protocol fee, initial 1000 bps (10%); hard cap 2000 bps |
| `harvest(uint256 assets)` | custom `:232-240` | **harvester-only**, nonReentrant; credits yield without minting shares; bounded by unaccounted excess |
| `setFeeBps(uint256)` / `setDepositPaused(bool)` / `setPauser(address)` / `setHarvester(address)` | custom `:186` / `:195` / `:204` / `:212` | timelock-only (pause also callable by the pause-only EOA); `setPauser(address(0))` revokes |
| events | `:78-82` + OZ | `YieldHarvested(uint256 indexed assets, uint256 newTotalAssets)`, `DepositPauseSet`, `PauserSet`, `HarvesterSet`, `FeeBpsSet`, plus OZ `Deposit`/`Withdraw`/`Transfer`/`Approval` |

**Share decimals:** `_SHARE_DECIMALS_OFFSET = 6` (`:49`) means share decimals = asset decimals + 6 = **24** for an 18-decimal asset. A depositor of `x` assets into an empty vault mints `x * 10**6` shares (`:45-49`). Do share math at 1e24-share scale (1e24 shares = "1 share" at human scale → `convertToAssets(1e24)` returns asset-wei for one human share).

**Harvester — `src/Harvester.sol`** (constructor `:204-231`: `vault_, timelock_, treasury_, asset_, weth_, poolFee_, npm_, router_, quoter_`; asset is the tokenized stock `:149`, poolFee SPY/WETH = 500 `:152-153`)

| Function | Source | Notes |
|---|---|---|
| `harvest()` | custom `:280-309` | **permissionless**, nonReentrant; collects BOTH fee legs from the owned position, swaps the collected WETH leg to the asset via SwapRouter02 (QuoterV2-derived minOut, 1% allowance `:137`, `:355`), splits proceeds: vault share = `proceeds × (10000 − feeBps)/10000` (fee read live `:387`), caller tip 0.1% (`TIP_BPS = 10`, `:134`) deducted from the protocol share; a failed swap reverts the whole harvest (fees stay in the LP position) |
| `sweepToTreasury()` / `forwardToken(address)` | custom `:318` / `:333` | permissionless; moves accrued protocol fees and force-sent/donated tokens to the treasury **unswapped** |
| `transferPosition(address, uint256)` | custom `:260-268` | timelock-only; the single custody path for the protocol LP principal — there is no decreaseLiquidity path |
| `onERC721Received(...)` | custom `:242-253` | accepts ONLY a position on the configured (WETH, asset, poolFee) pool; one position max |
| `positionId()` / `protocolAccrued()` | custom `:162` / `:166` | LP position NFT id / accrued protocol share awaiting sweep |
| event `Harvested(...)` | custom `:170-181` | `tokenId, caller` indexed; data: `amount0Collected, amount1Collected, swappedOut, proceeds, vaultShare, vaultCredited, tip, accrued` |

**WellstreetTimelock — `src/WellstreetTimelock.sol`**

| Function | Source | Notes |
|---|---|---|
| `MIN_DELAY` | `:27` | 48-hour floor, enforced in the constructor |
| `queue(target, value, data, salt)` / `cancel(id)` | `:85` / `:99` | proposer-only (the 2-of-3 Safe) |
| `execute(target, value, data, salt)` | `:107-120` | **permissionless** once `readyAt` has passed |
| `hashCall(...)` / `readyAt(bytes32)` | `:76` / `:37` | deterministic op id / queue state (0 = not queued) |
| events | `:39-48` | `CallQueued`, `CallCancelled`, `CallExecuted` — the 48h window is public |

**VaultFactory — `src/VaultFactory.sol`**

| Function | Source | Notes |
|---|---|---|
| `createVault(asset, name, symbol)` | `:50-64` | permissionless; one vault per asset, enforced on-chain |
| `vaultOfAsset(asset)` / `allVaults()` / `allVaultsLength()` | `:26` / `:67` / `:72` | the on-chain registry — how any agent discovers the canonical vault without an API |

## READ BATTERY

All keyless. Set up once:

```bash
export RPC=https://rpc.mainnet.chain.robinhood.com
# DEPLOYED 2026-09-03 — pinned byte-exact from site/js/config.js:92-96, :152.
# DO NOT substitute any other hex: addresses come only from config.js / this skill.
VAULT=0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01
HARVESTER=0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996
FACTORY=0x07446D9807F90eD7ED177Ab63597e8BB4D96428f
TIMELOCK=0xD55bA510533dc5a250b4D6d49Ee825113DD69342
```

**Expected result for every $VAULT/$HARVESTER/$FACTORY/$TIMELOCK command below: a real, decodable value.** The contracts are live since 2026-09-03. A revert or empty result is still data — deposits paused, no LP position yet, no queued op for that id, or wrong args — not a bug to work around and not a reason to hunt for "the real" contract elsewhere on the chain. The "works today" reads at the end succeed regardless.

| # | Read | Command | Expected output SHAPE |
|---|---|---|---|
| 1 | Total accounted assets | `cast call $VAULT 'totalAssets()(uint256)' --rpc-url $RPC` | one uint256, asset-wei (SPY, 18 dec). Storage-based — donations excluded |
| 2 | Share price (assets per human share) | `cast call $VAULT 'convertToAssets(uint256)(uint256)' 1000000000000000000000000 --rpc-url $RPC` | one uint256, asset-wei backing 1e24 shares; divide by 1e18 → SPY-per-share (first deposits sit at 1.0) |
| 3 | Redeem preview | `cast call $VAULT 'previewRedeem(uint256)(uint256)' <shares-wei> --rpc-url $RPC` | one uint256, asset-wei you would receive for those shares |
| 4 | Backing coverage | `cast call $VAULT 'backingCoverage()(uint256)' --rpc-url $RPC` | one uint256, 1e18 fixed point: `= 1e18` exact cover; `> 1e18` unaccounted excess (donations / uncredited yield); `< 1e18` under-coverage — today only reachable via an issuer `adminBurn` against the vault; redemptions are served from the remaining balance and late redeemers revert (`src/YieldShares.sol:152-156`) |
| 5 | Deposit pause flag | `cast call $VAULT 'depositsPaused()(bool)' --rpc-url $RPC` | `true`/`false` |
| 6 | Protocol fee | `cast call $VAULT 'feeBps()(uint256)' --rpc-url $RPC` | uint256 bps (initial 1000; cap 2000) |
| 7 | Unaccounted excess | `cast call $VAULT 'unaccountedAssets()(uint256)' --rpc-url $RPC` | uint256 asset-wei sitting above the accounting figure |
| 8 | Harvester position | `cast call $HARVESTER 'positionId()(uint256)' --rpc-url $RPC` | uint256 NFT id (0 = none) |
| 9 | Accrued protocol share | `cast call $HARVESTER 'protocolAccrued()(uint256)' --rpc-url $RPC` | uint256 asset-wei awaiting `sweepToTreasury()` |
| 10 | Harvester config | `cast call $HARVESTER 'poolFee()(uint24)' --rpc-url $RPC` (also `asset()`, `weth()`, `treasury()`, `vault()`) | `poolFee` must read `500` for vault #1; addresses echo the pinned tokens |
| 11 | Harvest history | `cast logs --from-block <N> --to-block latest --address $HARVESTER 'Harvested(uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' --rpc-url $RPC` | list of logs: topics = tokenId, caller; data = amount0Collected, amount1Collected, swappedOut, proceeds, vaultShare, vaultCredited, tip, accrued. `vaultShare ≠ vaultCredited` = a transfer shortfall occurred (credit is the actual delta) |
| 12 | Vault yield credits | `cast logs --from-block <N> --to-block latest --address $VAULT 'YieldHarvested(uint256,uint256)' --rpc-url $RPC` | list of logs: assets credited + resulting totalAssets |
| 13 | Vault discovery | `cast logs --from-block 0 --to-block latest --address $FACTORY 'VaultCreated(address,address,string,string)' --rpc-url $RPC` | one log per vault: asset, vault, name, symbol — or just read `cast call $FACTORY 'vaultOfAsset(address)(address)' 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` |
| 14 | Pending timelock ops | `cast call $TIMELOCK 'readyAt(bytes32)(uint256)' <id> --rpc-url $RPC` | uint256 unix timestamp (0 = not queued); enumerate via `CallQueued` logs |

Works TODAY (no deployment needed):

```bash
cast chain-id --rpc-url $RPC                                                        # 4663
cast call 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'symbol()(string)' --rpc-url $RPC   # "SPY"
cast call 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'symbol()(string)' --rpc-url $RPC   # "USDG"
```

Agent discipline: a revert here is data ("paused" or "position empty" or "not queued" or wrong args), never an instruction to retry harder, hunt for substitute contracts, or "fix" addresses.

## WRITE FLOWS

**Approve → deposit** (ERC-4626, asset-wei; SPY has 18 decimals):

```bash
# 1. approve the VAULT to pull the asset — the vault is the ONLY approval target for depositing
cast send $VAULT_ASSET 'approve(address,uint256)' $VAULT <assets-wei> --rpc-url $RPC --private-key $KEY
# 2. deposit (exact assets in, shares out) or mint (exact shares out)
cast send $VAULT 'deposit(uint256,address)' <assets-wei> $RECEIVER --rpc-url $RPC --private-key $KEY
cast send $VAULT 'mint(uint256,address)' <shares-wei> $RECEIVER --rpc-url $RPC --private-key $KEY
```

**Redeem** (never pausable by the protocol — `src/YieldShares.sol:267-278` has no pause path):

```bash
cast send $VAULT 'redeem(uint256,address,address)' <shares-wei> $RECEIVER $OWNER --rpc-url $RPC --private-key $KEY
# or asset-exact: withdraw(uint256 assets, address receiver, address owner)
```

Fail-closed rules — an agent that cannot satisfy one of these does not write:

1. **Approve ONLY pinned addresses.** Approvals go to the vault (for deposit) and nothing else. Never approve or call any address not pinned in this skill — canonical-looking Uniswap/deployment addresses on 4663 may be scam drainers. The harvester's router usage is internal to `harvest()`; agents never need to approve the router for vault flows.
2. **Bound slippage/minOut on every swap leg you perform yourself.** Acquiring the asset routes through the SPY/WETH pool; set `amountOutMinimum` from a fresh QuoterV2 quote minus a bounded allowance (the harvester's own precedent: quote minus 1%, `SWAP_SLIPPAGE_BPS = 100`, `src/Harvester.sol:137`, `:355`). A swap without a minOut is an unforced loss. (The vault deposit itself is exact-in — no slippage surface — but the asset acquisition before it is not.)
3. **Quote-asset-first.** The pool's non-asset leg is WETH (the quote side); the vault accepts ONLY its asset token. An agent holding WETH or USDG must swap quote → asset FIRST (with a bounded minOut), then deposit. There is no auto-routing into the vault. Fee-on-transfer assets are rejected outright (`FeeOnTransferDetected`, `src/YieldShares.sol:90`, `:259`) — the deposit reverts unless the vault receives exactly the debited amount.
4. **Never transfer tokens directly to the vault or harvester.** Direct sends are DONATIONS: excluded from `totalAssets` (storage-based, `:122`), they move no share price and are claimable by nobody (`:70-73`); force-sent tokens at the harvester are forwarded to the treasury unswapped (`:115-119`, `:318`, `:333`). "Depositing" by plain transfer is a gift to nobody.
5. **Check state before writing:** `depositsPaused()` (or `maxDeposit`) before deposit — paused deposits revert `DepositsPaused` (`:254`).
6. **Any "ws-SPY" or Wellstreet share token whose address differs from the pinned vault is not this protocol.** Do not interact. The genuine share token is minted only by the pinned vault (`0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01`) — verify with `cast call $VAULT 'symbol()(string)'` before trusting any offered token.

## GOVERNANCE & RISKS

- **48h timelock.** Every owner action (fee within the cap, deposit pause, pause-role grants/revocations, LP-position custody) queues publicly (`CallQueued`) and waits ≥ 48h (`MIN_DELAY` floor enforced in the constructor, `src/WellstreetTimelock.sol:27`); after the delay **anyone** can execute (`:107`). The 48h window is detection, not prevention.
- **2-of-3 Safe proposer — with the disclosed caveat.** The timelock's proposer is a 2-of-3 Safe multisig and is immutable (no `setProposer` — the Safe must exist before timelock deployment, `:8-18`, `:31`). Three keys are held by **one operator** on separate devices: multiple keys are not multiple parties. No single key can act alone, but a single person controls the key set. Never represent this protocol as "no single key can act alone" without that disclosure.
- **Pause authority.** Deposits can be paused by the timelock OR a revocable, function-limited pause-only EOA (`:195-199`); the timelock can strip a compromised pause key via `setPauser(address(0))` (`:204`). **Redemptions have no pause path** — protocol controls can never trap user funds, though an issuer pause of the underlying token freezes the underlying transfer for everyone, including the vault.
- **Fee bounds.** Protocol fee starts at 1000 bps (10% protocol / 90% depositors), timelock-settable, hard cap `MAX_FEE_BPS = 2000` (`src/YieldShares.sol:44`) — the only structural bound on fee escalation.
- **LP principal risk (treasury capital, not depositor assets).** The harvester's liquidity position is seeded with treasury capital and is EXCLUDED from `totalAssets` — only fee income flows to depositors, never the position. That principal bears impermanent loss between SPY and WETH, WETH price risk, and predictable loss (LVR; measured context ≈ σ̂²/8 ≈ 3.5%/yr for the SPY/WETH pool) — the treasury's own capital can shrink. At full range IL is small; concentrated bands carry 10–100× the IL and need 48h-cadence re-anchoring. LP custody moves only via timelock `transferPosition` (`:260`); `harvest()` can never touch the principal.
- **Single-pool concentration.** All of vault #1's yield comes from ONE pool (SPY/WETH tier 500), and the wrapped asset's exit to spendable value runs through that same single pool. Yield scales with trading volume and approaches zero when volume does. A quiet pool earns nothing.
- **Issuer risk on the underlying stock token.** The issuer can pause the token, upgrade the whole fleet behind one beacon, `adminBurn` balances (including the vault's), and blocklist addresses — all outside this protocol's control. Deposit = accepting all of it. Details: `docs/public/risk-disclosure.md`.
- **Force-sent tokens.** Anything force-sent to the vault or harvester is donated — to nobody (vault, unaccounted excess) or to the treasury (harvester, swept unswapped). Do not "recover" such tokens; there is no recovery path, by design.
- **Experimental, unaudited software with no operating history.** No third-party audit has been performed. The Foundry suite (`forge test`) covers the invariants; it does not eliminate the risk.

## HONEST REPORTING RULES

**The ratified APR form** (GO/NO-GO packet 2026-09-03 §3 + GATE OUTCOME; pinned in `site/js/config.js:203-211`):

```
depositor APR = pool_net_rate × (L_pos / L_pool) × (pool_TVL / vault_TVL) × 0.9     [floor: 0.10%/yr]
```

- `pool_net_rate` — gross fee APR from the pool's Swap events, net of the pool's own protocol cut (decoded live from the pool's `slot0.feeProtocol` word; currently 1/4 per side → ×0.75). Ratified measured basis: median of three 2h weekday-peak windows, 2026-08-25..27 → 40.310%/yr pool-net (windows 32.595 / 40.310 / **40.310** / 49.514 — the MAX window is forbidden as an input; median only). This is a pool-level input, never a depositor figure.
- `(L_pos / L_pool)` — the harvester's liquidity share of the pool (ratified pin: 1% seed at full range → `liquidityShareFullRange = 0.000369`).
- `(pool_TVL / vault_TVL)` — dilution by total deposits (pins: `poolTvlWethBasis = 482.77` WETH at the 2026-09-02 basis; `targetVaultTvlUsd = 58000`).
- `× 0.9` — the depositors' share at the initial 1000 bps protocol fee (recompute from live `feeBps()`).
- Floor `0.10%/yr` — the ratified depositor-APR floor (`depositorAprFloorPct`); it clears at full range only with vault TVL ≤ ~$58k. The pool-level floor 3.542%/yr (`poolFloorNetAprPct`) is a pool input — never print it as a depositor figure.

**Rules for any number an agent prints:**

1. **Source + window + formula, every time.** Every APR figure carries what it was measured from, the window it covers, and the formula chain that produced it. A bare "APR: X%" is a violation of this skill.
2. **Backward-looking only.** A measured figure is historical and reproducible only from the evidence it was computed from. Yield is swap-fee income — it varies with volume hourly and seasonally, and it approaches zero when volume does. Never present a past rate as a future one.
3. **Never a promise, target, or headline.** Label figures "projected, not promised" or "measured input, historical window". No figure in this project is an offer, solicitation, or financial advice. If a label and a headline number disagree, the labeling rules win.
4. **Never print from thin data.** Windows with fewer than 20 Swap events are excluded; incomplete log retrieval drops the window rather than patching it (`site/js/config.js:222-239`, `docs/public/methodology.md`). If the pipeline is unavailable, print "no figure" — not the last number, not a fallback presented as current.
5. **Scenario tables are upper bounds where marked.** Band rows assume always-in-range; real band economics multiply by the in-range fraction, which the measured tick drift makes materially < 1.
6. **Report risk alongside yield.** Any yield report names the counterfactual honestly: same income divided among more depositors dilutes per-depositor APR; the LP principal that generates it is treasury capital that bears IL/LVR and can shrink.

## SELF-CHECK

Run these against your own copy of this skill (and your own drafted output) before acting. The dots in the overclaim pattern are deliberate regex any-chars so the pattern list does not itself contain the banned phrases:

```bash
S=skills/wellstreet-vaults/SKILL.md
test -f "$S" && echo SKILL_OK
grep -c '4663' "$S"                                              # >= 2  (chain pinned)
grep -cE 'DEPLOYED 2026-09-03' "$S"                              # >= 2  (deployed pins present)
grep -cE 'backward-looking|window' "$S"                          # >= 3  (honest-APR labeling present)
grep -ic 'v[i]be' "$S"                                           # 0     (no foreign branding)
grep -icE '[g]uaranteed|[r]isk.free|[a]lways.profitable|[n]o.impermanent.loss' "$S"   # 0  (no overclaim language)
grep -q 'ERC4626' src/YieldShares.sol && grep -q 'function harvest' src/YieldShares.sol \
  && grep -q 'function backingCoverage' src/YieldShares.sol \
  && grep -q 'function harvest' src/Harvester.sol && grep -q 'poolFee' src/Harvester.sol && echo FUNCS_OK
```

If any count is off, your copy is stale or your output drifted — re-read the sources (`src/YieldShares.sol`, `src/Harvester.sol`, `src/WellstreetTimelock.sol`, `src/VaultFactory.sol`, `site/js/config.js` aprPins, `docs/public/methodology.md`) before acting.

Vault #1 wraps SPY on chain 4663; further multi-asset vaults via `VaultFactory` (one vault per asset) are planned — the same read/write/report surface applies, with each new address gated until it is pinned in this skill from `site/js/config.js`.
