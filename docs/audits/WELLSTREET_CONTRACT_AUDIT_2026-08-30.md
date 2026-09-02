# Wellstreet v1 — Adversarial Contract Security Audit

**Date:** 2026-08-30
**Scope:** all four source contracts + deploy script, line-by-line (`src/YieldShares.sol`, `src/Harvester.sol`, `src/VaultFactory.sol`, `src/WellstreetTimelock.sol`, `script/Deploy.s.sol`), the full test suite (`test/**`, 53 tests + 4 fork tests), the phase-0 ops evidence (`docs/ops/phase0/*.md`), and the public trust-model docs (`docs/public/*.md`, `README.md`) for the honesty audit.
**Method:** adversarial read (8 lenses: ERC-4626 accounting / Uniswap V3 integration / reentrancy / economics-governance / issuer-upgrade edges / factory surface / trust-model honesty / test gaps). Every finding cites code that was actually read. External on-chain facts were re-verified keylessly where load-bearing: the deployed NonfungiblePositionManager's verified source was fetched from Blockscout (`0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3`) and read, and the 4 fork tests were executed against live chain state during this audit.
**Constraint:** analysis-only. This document is the only file created. Zero code edits, zero transactions, zero spend.

---

## Executive summary

**DEPLOY VERDICT: GO-WITH-FIXES.**

No CRITICAL and no HIGH finding. The core user-facing guarantees hold under adversarial reading: storage-based `totalAssets` + virtual share offset + fee-on-transfer-rejecting deposits make the classic ERC-4622-class thefts (first-depositor inflation, donation laundering, skim) unprofitable to structurally impossible; a solvency invariant (`balanceOf(vault) >= _totalAssetsStored`) is maintained on every protocol path and is only breakable by issuer actions on the underlying token; redemption is structurally unpausable; the timelock disclosure (single proposer, open executor) matches the code exactly, and the public docs state it without the false "no single key can act alone" claim.

The GO-WITH-FIXES verdict is driven by **one procedural deploy blocker and a set of MEDIUM issuer-conditional degradation paths plus pre-deploy gates**:

1. **F-01 (deploy blocker, procedural):** `script/Deploy.s.sol` broadcasts factory-deploy and `createVault(SPY, …)` as separate transactions under `--slow`. On a permissionless factory with irreversible one-vault-per-asset semantics, a mempool observer can front-run `createVault` with the SPY asset and a junk name, permanently occupying the canonical SPY slot. Fix is operational (single-tx broadcast), not code.
2. **F-02/F-03/F-04 (MEDIUM, issuer-conditional):** the slippage bound on the harvest swap is circular (in-tx quote cannot protect against a sandwich); an issuer upgrade that adds fee-on-transfer kills the deposit path (by design) *and* the harvest-credit path (yield flow reverts until the upgrade behavior changes); an issuer `adminBurn` against the vault creates an accounting divergence that reverts `unaccountedAssets()`/`harvest()` and renders the tail of redemptions unpayable. All require issuer action; all are partially disclosed, and the report specifies the exact doc sentences to add.
3. **F-11 (pre-deploy gate):** the harvester's entire yield path depends on a **non-canonical, verified behavior of the deployed NPM** — its `collect()` internally pokes the pool and accrues current fees (`if (position.liquidity > 0) { pool.burn(…, 0); … }`, read in the fetched verified source). The canonical Uniswap v3-periphery NPM does NOT do this. The mock does not model pool-side fee growth at all, so the 53-test suite cannot detect a regression here. Verified correct today; pin it with a fork test before user deposits.

The most dangerous candidate concern examined — that a `collect()` with no poke would collect nothing and the yield pipe would be permanently silent — was **positively refuted against the live deployed NPM source** (see C9).

---

## Findings table

| ID | Severity | Location | One-line |
|---|---|---|---|
| F-01 | **LOW (deploy blocker — procedural)** | script/Deploy.s.sol:57-79 | `--slow` broadcast opens a front-run window on permissionless `createVault(SPY)`; one-vault-per-asset makes the loss of the canonical slot permanent |
| F-02 | **MEDIUM** | src/Harvester.sol:334-361 | `minOut` derived from an in-tx QuoterV2 quote is circular — it provides zero sandwich protection; unprofitable at v1 sizes, scales with proceeds |
| F-03 | **MEDIUM** | src/Harvester.sol:379-381, src/YieldShares.sol:204-211 | Issuer fee-on-transfer upgrade reverts `vault.harvest()` credit (`ExcessTooSmall`) — yield flow dies; deposits die by design; withdrawals survive (math walked in section) |
| F-04 | **MEDIUM** | src/YieldShares.sol:129-131, 204-211, 247 | Issuer `adminBurn` against vault balance breaks the `balance >= stored` invariant: `unaccountedAssets()`/`harvest()` revert by arithmetic underflow; the last `X` wei of redemptions are unpayable |
| F-05 | **LOW** | src/Harvester.sol:237-248 | Launch-time LP-slot occupation griefing: an attacker can donate a valid tier-500 position first, reverting the protocol's NFT transfer; ejectable via timelock |
| F-06 | **LOW** | src/WellstreetTimelock.sol:91-95, 99-112 | Queued operations never expire and only the proposer can cancel — a stale queued op remains executable by anyone, forever |
| F-07 | **LOW** | lib/openzeppelin-contracts/.../ERC4626.sol:153-158, 173-175 (inherited) | `withdraw(maxWithdraw(owner))` can revert on dust balances (OZ ceil-edge); `redeem()` is always safe — user-facing cosmetic |
| F-08 | **LOW** | src/VaultFactory.sol:50-64, site/js/vault.js:216-232 | `allVaults()` poisoning/brand-squatting affects only third-party UIs today; canonical site is config-allowlisted, but `readFactoryVaults()` is an unverified latent consumer |
| F-09 | **LOW** | src/VaultFactory.sol:19-23 | Immutable `initialFeeBps`: an over-cap factory config bricks all creation forever (cap enforced at vault construction; registry stays clean) |
| F-10 | **INFO** | src/YieldShares.sol:48, :135-137 | 24-decimal share token (18+6): displayed units are ~1:1 with the asset, but wallets/oracles/integrators must handle 24-dec |
| F-11 | **INFO (pre-deploy gate)** | src/Harvester.sol:279-281 vs deployed NPM verified source | Yield path depends on the deployed NPM's non-canonical internal auto-poke in `collect()`; verified present; mock does not model it — pin with a fork test |
| F-12 | **INFO** | src/WellstreetTimelock.sol:99-112 | `execute()` has no reentrancy guard: a malicious *queued* target could reenter `execute()` on other ready ids — proposer-gated queue makes this self-inflicted |
| F-13 | **INFO** | src/Harvester.sol:275-301 | QuoterV2's state-mutating quote inside `harvest()` is gas-bounded by the swap it simulates; no amplification, no block-gas DoS vector found |

No finding rated CRITICAL or HIGH. Severity rubric applied: CRITICAL = loss of user funds or solvency without external action; HIGH = exploitable value extraction or fund freeze without issuer action. F-03/F-04 degrade guarantees strictly behind issuer actions on the underlying token (the class the public docs disclose), hence MEDIUM.

---

## Per-finding detail

### F-01 — Deploy-time `createVault` front-run race (LOW; DEPLOY-BLOCKER? YES, procedural)

`script/Deploy.s.sol:57-79` performs, in one script run: deploy timelock → deploy factory → `factory.createVault(SPY, "Wellstreet SPY", "ws-SPY")` → deploy harvester → queue `setHarvester`. The documented broadcast mode is `--slow` (`script/Deploy.s.sol:33-34`), which sends each call as a separate transaction. `VaultFactory.createVault` is permissionless (`src/VaultFactory.sol:50-64`) and `vaultOfAsset` is write-once (`src/VaultFactory.sol:55` — `VaultAlreadyExists`). Between the factory-deployment tx and the vault-creation tx, anyone can call `createVault(SPY, <junk>, <junk>)` and permanently occupy the canonical SPY slot: the deploy script's own call then reverts (`VaultAlreadyExists`), and because the mapping is never deletable, `vaultOfAsset[SPY]` points at an attacker-named vault forever.

*Exploit sketch:* watch the mempool for the fresh factory's creation code; in the same block window, `createVault(SPY, "x", "x")` with higher priority fee. Attacker cost: gas only. Impact: brand/name confusion (the vault itself is still the timelock-governed `YieldShares` with correct parameters — the attacker cannot change the constructor args, which the factory pins from its own immutables, `src/VaultFactory.sol:57-59`) plus a permanently poisoned canonical slot.

*Note the honest limit:* the attacker's squatted vault is a REAL, correctly-governed vault (factory-pinned timelock/pauser/fee) with a junk name — the damage is the registry/name, not the vault logic.

*Fix:* broadcast without `--slow` so factory deploy + `createVault` land in one transaction (foundry sends them atomically in a single script run), or move the canonical vault into the factory constructor, or create the vault before any public announcement of the factory address. **DEPLOY-BLOCKER? YES as a broadcast procedure: do not broadcast with `--slow`.**

### F-02 — Circular slippage bound: in-tx quote gives no sandwich protection (MEDIUM)

`Harvester._swapWethToAsset` (`src/Harvester.sol:334-361`) quotes with QuoterV2 and sets `minOut = quoted * (10000 - 100) / 10000` (`src/Harvester.sol:347`), then swaps immediately in the same transaction. Because the quote is taken at the *current* post-front-run state, the minOut is self-consistent with the manipulated pool: an attacker who front-runs the harvest (buys SPY, pushing the price up) causes the harvest to quote and execute at the inflated price with no revert; the attacker back-runs and captures the round trip. The 1% allowance (`src/Harvester.sol:133`) guards only execution-vs-quote divergence inside the transaction (which the router already enforces) — it provides **no** protection against pre-trade state manipulation.

*Quantification (honest):* max attacker extraction is bounded by the harvest's own price impact and proceeds. At the ratified v1 pins (LP seed ~1% of a $690k-TVL pool, pool net APR ~70% measured median, `docs/ops/phase0/pool-apr.md` §4.2/§5.2), proceeds are on the order of $10-15 per daily harvest. Making the round trip profitable requires moving the price more than 2× the 0.05% pool fee plus gas — the profit ceiling is a fraction of the proceeds. **At v1 sizes this is economically marginal.** It scales linearly with proceeds; if the LP position or pool volume grows, revisit before proceeds make sandwiches profitable. One material mitigating factor, UNVERIFIED: Robinhood Chain is a fast-block L2-style chain (~101 ms blocks, `docs/ops/phase0/tokens-oracle-rpc.md`); if the sequencer provides first-come-first-served ordering with no public mempool, classic sandwiching is largely impractical. The existence of a public mempool on this chain was not verified in this audit.

*Fix options:* a TWAP- or block-age-bounded `minOut` (accepting the revert cost), or harvesting at randomized intervals, or accepting the risk with size limits. Not a deploy blocker.

### F-03 — Issuer fee-on-transfer upgrade: yield flow and deposits die, withdrawals survive (MEDIUM)

Walk requested by the audit brief, explicit. Assume the issuer's fleet upgrade makes SPY fee-on-transfer with fraction `f` taken from the transferred amount (sender-side debit, receiver credited `value*(1-f)`).

**Withdraw path (retrievability — PRESERVED, with issuer tax):** `_withdraw` (`src/YieldShares.sol:238-249`) burns shares, debits `_totalAssetsStored -= assets` (`src/YieldShares.sol:247`), then `safeTransfer(receiver, assets)` (`src/YieldShares.sol:248`). Under FOT the vault pays exactly `assets` out of its balance and the receiver gets `assets*(1-f)` — the fee is the issuer's tax on exit, not a vault debit. Every downstream subtraction stays valid: if `B = TA` pre-upgrade, after any withdrawal `B' = B - a` and `TA' = TA - a`, so `B' >= TA'` holds. `unaccountedAssets()` (`src/YieldShares.sol:129-131`) never underflows. The last withdrawer can still be paid their full accounted claim. **User-fund retrievability is preserved; the issuer taxes each exit by `f`.**

**Deposit path (DEAD, by design):** `_deposit` reverts via `FeeOnTransferDetected` (`src/YieldShares.sol:230`) whenever `received != assets`. New deposits become impossible for as long as the upgrade is active. This is the intended accounting guard, and it also means the vault cannot drift.

**Harvest credit path (DEAD — the non-obvious casualty):** `_split` transfers `vaultShare` to the vault and then calls `vault.harvest(vaultShare)` declaring the same number (`src/Harvester.sol:380-381`). Under FOT the vault receives `vaultShare*(1-f)`, so at the credit check `excess = balance - _totalAssetsStored` has grown by only `vaultShare*(1-f) + priorExcess`. If `priorExcess < vaultShare*f`, `assets > excess` and `harvest` reverts with `ExcessTooSmall` (`src/YieldShares.sol:208`). The revert propagates through `_split` and the whole `harvest()` — by the atomicity design the collect rolls back and fees remain in the LP position (`src/Harvester.sol:107-110` natspec, proven by `test/harvestAtomicRevert_*`). Net effect: **while a FOT upgrade is live, no harvest can ever succeed** — yield accrual is frozen (fees accumulate unclaimed in the LP position, still recoverable if the issuer ever reverts the behavior, or via `transferPosition` to an operator that can poke+collect+return). Principal and already-accrued yield remain redeemable, taxed by `f`.

*Severity:* MEDIUM — strictly behind an issuer upgrade, which the docs disclose as possible in general. The specific consequence (harvest-credit death) is **not** documented anywhere. *Fix options:* (a) document it (one sentence in `docs/public/not-guaranteed.md` issuer section); (b) harden `_split` to measure the vault's actual balance delta and credit the received amount instead of the declared one (small change, restores yield flow under FOT at the cost of a balance read). (b) is recommended but not blocking. **DEPLOY-BLOCKER? NO.**

### F-04 — Issuer `adminBurn` against the vault: accounting divergence and tail insolvency (MEDIUM)

`adminBurn(any-address, amount)` is pause- and block-exempt in the deployed token (`docs/ops/phase0/tokens-oracle-rpc.md` §1.3). If the issuer burns `X` wei from the vault while `balance = TA = _totalAssetsStored`:

- `unaccountedAssets()` computes `balance - _totalAssetsStored` (`src/YieldShares.sol:130`) and `harvest()` computes the same difference (`src/YieldShares.sol:207`): both now **revert with arithmetic underflow (Panic 0x11)**, not a graceful error. Yield flow is dead until cumulative withdrawals shrink `_totalAssetsStored` to or below the new balance.
- Withdrawals continue to work while `balance` covers them, because `redeem` pays `assets` pro-rata of *accounted* assets — but only `TA - X` wei of backing physically exists. Once cumulative redemptions reach `TA - X`, the remaining claimants' `safeTransfer` reverts: **the final `X` wei of accounting is unpayable.** Redemption freezes for the tail of redeemers (order-independent — collectively `X` of backing is gone) until the issuer restores funds or donations cover the gap. If the issuer never does, that tail is a real loss.

*Severity:* MEDIUM — requires deliberate issuer action against the vault specifically (an attack on the protocol by the issuer, not a random event), and `docs/public/risk-disclosure.md` (lines 19, 15-24) already discloses `adminBurn` against "the vault, the harvester, the treasury, or you". The *accounting-divergence consequences* (underflow reverts, harvest death, tail insolvency) are not spelled out. *Fix:* (a) document precisely; (b) optionally make `unaccountedAssets()` and the `harvest()` excess computation underflow-safe (`balance > stored ? balance - stored : 0`) so a burned vault degrades to "no yield, graceful" instead of panicking — cosmetic, the insolvency tail remains regardless. **DEPLOY-BLOCKER? NO.**

### F-05 — LP-slot occupation griefing at launch (LOW)

`onERC721Received` (`src/Harvester.sol:237-248`) validates NPM identity and position shape, then sets `_hasPosition = true` / `positionId = tokenId`. Anyone holding a legitimate tier-500 SPY/WETH position on the configured NPM can `safeTransferFrom` it to the harvester *before* the protocol's launch-prep transfer; the protocol's own transfer then reverts with `AlreadyHasPosition` (`src/Harvester.sol:243`). The attacker's cost is minting a minimal-liquidity position plus gas; the impact is a launch-prep delay only. Recovery exists and is permissionless-adjacent: the timelock calls `transferPosition(attacker, attackerTokenId)` (`src/Harvester.sol:255-263`, tested in `test_transferPosition_onlyByTimelock`), after which the protocol transfer can be retried. No fund loss is possible — the attacker's position is real LP principal held in protocol custody, not a theft vector. **DEPLOY-BLOCKER? NO** (transfer the LP NFT promptly after the harvester deploy; monitor).

### F-06 — Timelock operations never expire (LOW)

`WellstreetTimelock.execute` (`src/WellstreetTimelock.sol:99-112`) becomes callable at `readyAt` and remains callable **indefinitely** until executed or cancelled; `cancel` is proposer-only (`src/WellstreetTimelock.sol:91-95`). There is no grace period. Consequence: a queued-but-forgotten (or proposer-abandoned) operation — e.g. a `setHarvester` or fee change queued and never cancelled — can be executed by *anyone* years later if its precondition silently becomes harmful (e.g. after a harvester replacement makes an old wiring call meaningful). The 48h window is a detection window; there is no expiry safety net. *Fix:* optional `execute` deadline (`readyAt + GRACE`), or an operational commitment to cancel stale ops. **DEPLOY-BLOCKER? NO.**

### F-07 — Inherited `withdraw()` dust edge (LOW)

With OZ 5.7.0 (`lib/openzeppelin-contracts`, version verified from `package.json`), `maxWithdraw(owner) = previewRedeem(maxRedeem(owner))` (Floor, `ERC4626.sol:153-158,178-179`) while `withdraw` burns `previewWithdraw(assets)` (Ceil, `ERC4626.sol:173-175`). The ceil-inverse of a floor conversion can exceed the owner's balance for dust positions, so `withdraw(vault.maxWithdraw(owner))` can revert `ERC4626ExceededMaxWithdraw` while `redeem(balanceOf(owner))` always succeeds. Inherited OZ behavior, not introduced by this repo; vault overrides do not change the conversion functions (`src/YieldShares.sol:220-249` only replace the transfer/accounting bodies). *Fix:* none needed; document "use redeem" in user docs if it ever surfaces. **DEPLOY-BLOCKER? NO.**

### F-08 — Factory registry poisoning; canonical site is allowlisted, one latent consumer (LOW)

Anyone can create vaults for any asset with any name (brand-squatting "Wellstreet X" on copycat tokens — the phase-0 NVDA copycat warning, `docs/ops/phase0/tokens-oracle-rpc.md` §0, shows name-collision tokens exist on this chain). One-vault-per-asset (`src/VaultFactory.sol:55`) prevents squatting the *canonical SPY asset slot* but not the name space on other assets, and `allVaults()` (`src/VaultFactory.sol:67-69`) returns everything. **Verified:** the canonical site renders only config-pinned vaults (`site/js/main.js:288, 470` read `cfg.vaults`, never the on-chain list) — so squatters cannot appear on wellstreet.tech today. However `site/js/vault.js:216-232` (`readFactoryVaults`) fetches `allVaults()` and returns the raw list without any name/asset/timelock verification; it currently has **no caller** (grepped the whole `site/` tree), but it is a latent hazard: if wired up later, it would render attacker-created vaults as if canonical. *Fix:* before ever calling `readFactoryVaults`, cross-check each returned address against `vaultOfAsset(<known asset>)` and `vault.timelock() == <pinned timelock>`; or delete the function. **DEPLOY-BLOCKER? NO.**

### F-09 — Immutable over-cap factory fee bricks creation (LOW)

`VaultFactory.initialFeeBps` is immutable (`src/VaultFactory.sol:19-23,38-43`) and an over-cap value passes the factory but reverts at vault construction (`YieldShares.FeeTooHigh`, `src/YieldShares.sol:108`) on every `createVault` forever. This is correctly disclosed in the factory natspec, the registry stays clean on failed creation (proven by `test_factory_overCapFeeFailsAtVaultConstruction`), and the reference deploy pins 1000 (`script/Deploy.s.sol:49`). A mis-set factory is dead but harmless (no funds at risk). **DEPLOY-BLOCKER? NO.**

### F-10 — 24-decimal share token (INFO)

`_decimalsOffset() = 6` over an 18-decimal asset → 24-decimal shares (`src/YieldShares.sol:48,135-137`; proven `assertEq(vault.decimals(), 24)` in `test_metadata`). Economics: the offset is the second layer of first-depositor defense (see C2). UX: at inception 1 SPY displays as 1.0 ws-SPY (raw 1e24 / 1e24), so displayed units track the asset 1:1. Integration risk: 24-dec tokens are outside the common 6/8/18 grid — wallets, aggregators, price oracles, and any future AMM listing of ws-SPY must not truncate. Gas: negligible. **DEPLOY-BLOCKER? NO.**

### F-11 — The yield path depends on a non-canonical NPM behavior (INFO; pre-deploy gate)

The canonical Uniswap v3-periphery NonfungiblePositionManager only pays out `tokensOwed`, which are updated by `decreaseLiquidity`/`burn` — integrators must "poke" (`decreaseLiquidity(liquidity=0)`) before `collect`, and this harvester deliberately has no decreaseLiquidity path (`src/Harvester.sol:117-120` natspec). If the deployed NPM behaved canonically, `harvest()` would collect `(0,0)` forever and the protocol would produce no yield while looking healthy.

**Verified against the live deployment:** the verified source of `0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3` (fetched from Blockscout during this audit, `NonfungiblePositionManager`, `is_verified: true`) contains, inside `collect()`:

```solidity
// trigger an update of the position fees owed and fee growth snapshots if it has any liquidity
if (position.liquidity > 0) {
    pool.burn(position.tickLower, position.tickUpper, 0);
    (, uint256 feeGrowthInside0LastX128, ...) = pool.positions(...);
    tokensOwed0 += uint128(FullMath.mulDiv(feeGrowthInside0LastX128 - position.feeGrowthInside0LastX128, position.liquidity, FixedPoint128.Q128));
    ...
}
```

i.e. the deployed NPM **auto-pokes inside `collect()`** — `harvest()`'s `collect(MAX, MAX)` (`src/Harvester.sol:279-281`) does accrue and pay current fees on this chain. The `MockPositionManager` (`test/mocks/MockPositionManager.sol:75-87`) collects from directly-seeded `tokensOwed` and models neither pool-side fee growth nor the internal poke, so the unit suite is blind to any change in this behavior. *Fix:* pin with a fork test the moment an LP position exists (see test gap G1); optionally add a `decreaseLiquidity(0)` poke before collect (a no-op under the deployed NPM, a fix under a canonical one). **DEPLOY-BLOCKER? GATE — run the real-NPM fork harvest test before accepting user deposits.**

### F-12 — Timelock `execute()` reentrancy surface (INFO)

`execute` deletes `readyAt` before the external call (`src/WellstreetTimelock.sol:107`) — replay-safe. It has no reentrancy guard, so a *queued* malicious target can, during its own execution frame, reenter `execute()` on a different ready id and force early nested execution (ordering assumptions of other queued ops could be broken inside that frame). Every queued call originates from the single proposer (`src/WellstreetTimelock.sol:60-63`), so this surface is reachable only by queueing a malicious contract — a self-inflicted or proposer-compromise scenario already covered by the "single key is a total-compromise point" disclosure (`docs/public/risk-disclosure.md:32-35`). No action needed beyond awareness. **DEPLOY-BLOCKER? NO.**

### F-13 — QuoterV2 gas inside harvest (INFO)

QuoterV2's `quoteExactInputSingle` is state-mutating (simulates the swap and unwinds). Inside `harvest()` it costs at most the gas of the swap it simulates on the same pool — the subsequent real swap pays the same magnitude, so no amplification exists and no path lets an attacker inflate the quote's gas without paying for their own swap. `quoted == 0` reverts the harvest (`src/Harvester.sol:346`). Block-gas-limit DoS: not found. **DEPLOY-BLOCKER? NO.**

---

## Explicitly CLEAN areas (with the reasoning)

**C1 — ERC-4626 rounding directions (all four entries user-adverse).** Verified in OZ 5.7.0 source: `previewDeposit` Floor (`ERC4626.sol:163-165`), `previewMint` Ceil (`:168-170`), `previewWithdraw` Ceil (`:173-175`), `previewRedeem` Floor (`:178-179`); conversions `assets.mulDiv(totalSupply + 10**offset, totalAssets + 1, rounding)` / `shares.mulDiv(totalAssets + 1, totalSupply + 10**offset, rounding)` (`:237-245`) with `Math.mulDiv` full-precision intermediates. The vault's overrides replace only the transfer/accounting bodies (`src/YieldShares.sol:220-249`) and do not touch conversions. deposit/mint/withdraw/redeem are mutually consistent through the shared previews. `Math.mulDiv` prevents the classic 512-bit overflow class.

**C2 — First-depositor inflation and donation laundering (both structurally dead).** Two independent defenses. (1) Storage accounting (`totalAssets()` returns `_totalAssetsStored`, `src/YieldShares.sol:121-123`) means donations never enter the price — the classic "deposit 1 wei, donate, mint dust" attack cannot even start (proven by `test_firstDepositorInflationFails`, `test/YieldShares.t.sol:54-83`: the attacker ends with their 1 wei and eats the whole donation). (2) The virtual offset (`src/YieldShares.sol:48`, `+1` virtual asset in the OZ formula) makes the first depositor mint `assets * 10**6` shares, so any residual rate manipulation through *deposits* requires ~10**6× the victim's deposit — and that capital is itself locked at the storage price, unrecoverable (donation-loss asymmetry). Laundering donations INTO yield via the harvester's excess-credit bound: `vault.harvest(assets)` requires `assets <= balance - stored` (`src/YieldShares.sol:207-208`) and the real harvester always transfers exactly what it declares (`src/Harvester.sol:380-381`), so excess can only be converted to accounting 1:1 with physically arriving tokens; even a timelock-installed malicious harvester could at most credit pre-existing excess (raising backing toward the physical balance — depositor-favorable, never a theft), and can never overstate backing beyond physical balance.

**C3 — Solvency invariant `balanceOf(vault) >= _totalAssetsStored` holds on every protocol path.** Deposit: accounting and balance both `+assets`, with FOT drift impossible (revert, `src/YieldShares.sol:227-230`); same-tx pre-deposit donations land in `balanceBefore` and become excess, not accounting. Withdraw: both `-assets` (`src/YieldShares.sol:247-248`). Harvest credit: the harvester transfers first, credits second, and the credit is bounded by the physical delta (`src/Harvester.sol:380-381` + `src/YieldShares.sol:207-209`). Donations: balance-only. Therefore `maxWithdraw` is always physically covered and no protocol action can strand a depositor's accounted claim. The only invariant breakers are issuer actions — `adminBurn` (F-04) or an exotic upgrade; both are outside the contracts' control and disclosed as a class.

**C4 — Reentrancy / external-call surface.** The vault's `_deposit`, `_withdraw`, and `harvest` all share one `ReentrancyGuard` (`src/YieldShares.sol:204,222,241`), so a callback arriving during any of them (ERC-777-style hook introduced by an issuer upgrade) hits the guard on every reentrant entry; `_withdraw` is checks-effects-interactions ordered (burn + debit before transfer, `src/YieldShares.sol:246-248`); `_deposit` transfers before minting (OZ 5.7 ordering retained). The harvester's external call into `vault.harvest` occurs after the asset transfer (`src/Harvester.sol:380-381`), the vault side is `nonReentrant` and amount-bounded, and `vault.harvest` performs no external calls. The timelock deletes state before its call (`src/WellstreetTimelock.sol:107`). No unguarded external call was found on any state-mutating path. The issuer-upgrade hook scenario degrades to "revert" (guard) rather than state corruption; a hook that *requires* success could brick transfers, but that is the disclosed "upgrade can change any rule" class.

**C5 — `feeBps` read once per harvest; no mid-harvest fee flip.** `_split` reads `feeBps()` once (`src/Harvester.sol:372`) before any state change; the only writer is the timelock (`src/YieldShares.sol:161-165`), which is not in the harvest call chain and cannot be reentered mid-harvest (see C4). A fee change lands strictly between harvests (proven by `test_feeChangeByTimelock_reflectedInNextHarvest`).

**C6 — Tip and split math at all extremes.** `tip = proceeds * 10 / 10000` deducted from the protocol share with a clamp `if (tip > protocolShare) tip = protocolShare` (`src/Harvester.sol:375-376`) — at `feeBps = 0` the protocol share is 0, the tip clamps to 0, and 100% goes to the vault; at dust proceeds (1 wei) `vaultShare = 0` (floored), both transfers skip on the `> 0` guards, `accrued = 1`, and nothing reverts. The `feeBps < TIP_BPS` underflow the clamp guards against is unreachable through `setFeeBps` alone (min fee 0) but correctly handled regardless. Split fractions verified at 1000 and the 2000 cap by tests.

**C7 — LP position custody validation has no bypass found.** `onERC721Received` requires `msg.sender == positionManager` (`src/Harvester.sol:241`) — an immutable, address-checked identity, so no clone/spoof path — then validates the position's own token pair and fee tier by reading the NPM (`src/Harvester.sol:393-403`), order-irrelevant (`test_positionGuard_tokenOrderIrrelevant`), single-slot (`AlreadyHasPosition`), and validation-before-slot-check ordering means a wrong NFT reports its own error. Any NFT that passes validation is by construction a real tier-500 SPY/WETH position on the configured NPM — the only "bypass" is donating genuine LP principal (F-05). `harvest()` re-validates the pool identity before collecting (`src/Harvester.sol:278`). `transferPosition` is timelock-only and resets the slot before the transfer (`src/Harvester.sol:255-263`); uncollected fees travel with the NFT to the timelock-chosen recipient — a governance action, custody disclosed.

**C8 — Timelock correctness.** 48h floor enforced at construction (`src/WellstreetTimelock.sol:55`), `delay` immutable; deterministic id `keccak256(abi.encode(target, value, keccak256(data), salt))` is padding-independent; duplicate-queue, not-queued, and not-ready reverts; a reverting target leaves the op queued and retryable (proven `test_execute_failingCallStaysQueuedAndRetryable`); no replay after execution; `queue`/`cancel` proposer-only, `execute` open — exactly matching the disclosure.

**C9 — VERIFIED: the deployed NPM's `collect()` auto-accrues fees (the "silent yield pipe" concern is refuted).** See F-11 for the fetched verified source block. `collect(MAX, MAX)` on a position with liquidity pokes the pool internally, accrues `feeGrowthInside` deltas into `tokensOwed`, and pays them out in the same call. The harvester's no-decreaseLiquidity design is therefore correct on this deployment. Residual dependency is pinned as F-11.

**C10 — Donation handling in the harvester is consistent.** Harvest forwards all WETH beyond the collected leg to the treasury UNSWAPPED (`src/Harvester.sol:296-298`), swaps only the freshly collected amount (balance-derived amounts never enter the swap size, `src/Harvester.sol:287-291`), and `sweepToTreasury` zeroes `protocolAccrued` before forwarding asset donations relative to the zeroed value (`src/Harvester.sol:311-320`) — the post-zeroing read at line 318 is load-bearing and correct (donations = balance - 0 after the accrual was paid out); a future edit passing the local `accrued` instead would strand small donations. Junk tokens forward via `forwardToken` with the pool-token guard (`src/Harvester.sol:325-328`). Donations to the vault sit unaccounted forever, claimable by nobody (`src/YieldShares.sol:69-72,125-131`) — including during the pre-wiring window: tokens force-sent to the vault before `setHarvester` lands are excess, and the harvester can never credit what it did not itself transfer.

**C11 — Deploy wiring matches the tested sequence.** `script/Deploy.s.sol:57-79` order and constructor args (timelock(delay=172800, proposer=deployer) → factory(timelock, deployer-as-initial-pauser, 1000) → `createVault(SPY, "Wellstreet SPY", "ws-SPY")` → harvester(vault, timelock, timelock-as-treasury, SPY, WETH, 500, NPM, router, quoter) → queued `setHarvester`) are replicated step-for-step by `test_deployWiring_endToEnd` (`test/Deploy.t.sol:25-86`) including the end-state proof. Chain-id guard present (`script/Deploy.s.sol:52`); deployer key read from env only (`script/Deploy.s.sol:30,54`). No secret material anywhere in the repo.

**C12 — Pause semantics match the claims.** `setDepositPaused` is the only pause flag and is consulted ONLY in `_deposit` (`src/YieldShares.sol:225`) — `redeem`/`withdraw` have no checkpoint (`src/YieldShares.sol:238-249`); `maxDeposit`/`maxMint` report 0 while paused for frontend truth (`src/YieldShares.sol:140-147`); the pause EOA is function-limited by construction (its only reachable privileged entry is `setDepositPaused`) and revocable (`setPauser(0)`, `src/YieldShares.sol:179-182`); all proven by tests.

**C13 — Trust-model honesty audit: docs match code.** Checked claim-by-claim: single proposer + open executor (`src/WellstreetTimelock.sol:60-63,97-98` vs `docs/public/not-guaranteed.md` "Owner controls are single-keyed" and `docs/public/risk-disclosure.md:32-35`) — accurate; the phrase "no single key can act alone" appears NOWHERE and is explicitly disclaimed ("that claim would be false") — accurate; `MAX_FEE_BPS` stated as "the only structural bound" (code constant `src/YieldShares.sol:43`, docs statement) — accurate; "redemption is never pausable" with the issuer-pause caveat in the same breath (`docs/public/guarantees.md:36-38`) — accurate; `adminBurn`, fleet upgradeability, blocklist, metadata rewrite all disclosed with the correct capability descriptions matching the phase-0 evidence; "Audited: NO" stated in README. No overclaim found. The two doc gaps worth closing are the F-03 and F-04 consequence sentences (see those findings).

---

## Test-gap list (deploy-gating: what the 53-test suite does NOT cover)

Counted: 53 non-fork tests + 4 fork tests, all passing at audit time (including a live re-run against the public RPC, see Verification). Gaps, each with a one-line forge sketch:

- **G1 (gates deploy):** Real-NPM collect fidelity — the mock collects from directly-seeded `tokensOwed` and models neither pool-side fee growth nor the deployed NPM's internal auto-poke (F-11). Sketch: `testFork_harvestOnRealNpm() // fork 4663; create a minimal tier-500 SPY/WETH position via the real NPM from a funded fork address; transfer to a test harvester; harvest(); assertGt(vault.totalAssets(), 0)`.
- **G2:** `mint()` / `previewMint` path is untested (every test deposits or redeems). Sketch: `test_mint_exactAssetsCharged() // mint(1e24, alice); assertEq(spy.balanceChange, vault.previewMint(1e24))`.
- **G3:** `withdraw(assets)` path and `maxWithdraw` consistency untested (only `redeem` exercised). Sketch: `test_withdraw_exactAssets_andDustEdge() // withdraw(maxWithdraw(owner)) round trip; document the F-07 ceil-edge revert shape and that redeem() succeeds where withdraw() reverts`.
- **G4:** Allowance / `_spendAllowance` untested — no caller != owner redemption anywhere. Sketch: `test_redeem_withAllowance() // vm.prank(owner) approve(spender, shares); vm.prank(spender) redeem(shares, receiver, owner); assertEq allowance consumed`.
- **G5:** Multi-depositor pro-rata harvest distribution untested (single depositor only). Sketch: `test_harvest_proRataTwoDepositors() // depositors 60/40; harvest; assertApproxEqAbs of each previewRedeem gain to 0.6/0.4 of vaultShare within rounding dust`.
- **G6:** Fee-on-transfer on the WITHDRAW path (the retrievability claim this audit walked in F-03) is untested — the mock suite only proves deposit rejection. Sketch: `test_fot_withdrawRetrievabilityAfterUpgrade() // toggle FOT on after deposit; redeem; assert receiver == assets*(1-fee) && vault balance >= totalAssetsStored`.
- **G7:** Issuer `adminBurn` divergence untested (F-04). Sketch: `test_adminBurn_accountingDivergence() // burn half the vault balance; expectRevert on unaccountedAssets()/harvest(); redeem until balance exhaustion; assert final redeem reverts`.
- **G8:** Issuer pause shape untested. Sketch: `test_issuerPause_freezesTemporarily() // pausable mock asset; deposit/withdraw revert while paused; recover after unpause`.
- **G9:** Timelock reentrancy / malicious queued target untested (F-12). Sketch: `test_timelock_maliciousTargetReentry() // target reenters execute() on a second ready id; assert nested execution and no replay of either id`.
- **G10:** LP-slot occupation griefing + ejection untested (F-05). Sketch: `test_positionSlotDonation_griefAndEject() // attacker donates a valid tier-500 position first; expectRevert AlreadyHasPosition on protocol transfer; timelock transferPosition ejects; resend succeeds`.
- **G11:** Asset-only proceeds (wethCollected == 0, swap skipped) untested. Sketch: `test_harvest_assetLegOnly() // seed only the SPY leg; harvest; assert proceeds split with no router interaction`.
- **G12:** No stateful invariant suite for `balanceOf(vault) >= totalAssetsStored` (C3 is only implicitly covered). Sketch: invariant handler with random deposit/redeem/harvest/forceSend/donate sequences asserting the invariant plus `totalSupply > 0 => pricePerShare > 0`.
- **G13:** Fork suite covers only quote positivity — no end-to-end real-router shape test. Sketch: `testFork_exactInputSingleShape() // funded fork address approves the real router and simulates the harvest swap on the tier-500 pool`.
- **G14:** The no-expiry timelock behavior (F-06) is unpinned. Sketch: `test_timelock_queuedOpNeverExpires() // queue; warp 1 year; execute succeeds — pins current semantics until a grace period is added`.

---

## What this audit does NOT cover

- **Frontend** beyond the single registry-allowlist check (F-08): no review of `site/` rendering, wallet flows, geo-gate, or XSS. `api/` and `api-tests/` were not audited.
- **ops/ procedures**: key custody operationally (the docs require the deployer key move to cold storage before launch — compliance.md — but the key itself, its current custody, and any hardware-wallet plan are out of scope).
- **APR / economic modeling**: pool-level vs depositor-level APR, impermanent loss on the LP principal, volume seasonality, the GO/NO-GO depositor floor math. The phase-0 evidence (`docs/ops/phase0/pool-apr.md`) was used only as input to threat reasoning (feeProtocol cut, proceeds sizing), not re-validated numerically.
- **$WELL / launchpad mechanics** (pons): tokenomics.md claims about the pad's fee split were not re-verified.
- **Live-state token behaviors** that phase-0 itself marks BLOCKED-ON-USER-STEP (B-1..B-4): purchase path, behavioral fee-on-transfer detection, blacklist runtime shape, permit end-to-end. This audit relies on the verified source reads in `docs/ops/phase0/tokens-oracle-rpc.md`.
- **UNVERIFIED items flagged honestly:** (1) whether Robinhood Chain's sequencer exposes a public mempool (materially affects F-02 exploitability); (2) the WETH contract source (`0x0Bd7D308…`) was not read — `forceApprove` and `transferFrom` are assumed standard (USDT-style non-standard approvals are already handled by `forceApprove`'s 0-reset, `src/Harvester.sol:349,361`); (3) SwapRouter02/QuoterV2 full sources were not re-read in this audit (phase-0 verified them and observed `exactInputSingle` live; the fork test proves the QuoterV2 shape); (4) the harvester's gas profile on the real stack (no estimate run).

---

## Verification record (commands + exit codes + key output)

| Command | Exit | Key output |
|---|---|---|
| `forge test` (from `/home/raivo/Documents/wellstreet`) | 0 | `53 tests passed, 0 failed, 1 skipped (54 total tests)` — zero code drift during the audit (the skip is the fork suite without RPC env) |
| `WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test --match-contract SPYPoolFork` | 0 | `4 passed; 0 failed; 0 skipped` — live chain identity + positive QuoterV2 quote re-proven during this audit |
| Blockscout fetch of NPM `0x73991a25…` verified source | 0 | `NonfungiblePositionManager True solidity` (400-line source read; collect() auto-poke block confirmed) |
| `grep -rn "allVaults" site/js/` | 0 | `vault.js:222` candidates list; no `readFactoryVaults` caller anywhere in `site/` (allowlist claim of F-08) |
| OZ `lib/openzeppelin-contracts/package.json` | 0 | `openzeppelin-solidity 5.7.0` (rounding analysis pinned to that version) |

This file is the only artifact created by this audit; no source, test, script, doc, or config file was modified.

---

## Addendum — 2026-08-31 pre-deploy hardens applied (F-03b, F-04b; tests G6/G7)

**What this section is:** the pre-deploy code-state record. The findings above describe the audit-time (pre-harden) bytecode; **the bytecode that will actually deploy is the one described HERE.** Both hardens are fix option (b) of their findings (F-03b = the "(b) is recommended" option of F-03; F-04b = the "optionally make ... underflow-safe" option of F-04). Applied 2026-08-31, before any deployment, while every contract was still changeable. No other behavior was changed; no transactions were broadcast.

### F-03b — `Harvester._split` credits the vault's actual balance delta (IMPLEMENTED)

`src/Harvester.sol` (`_split`): the vault's asset balance is measured immediately before and immediately after the `safeTransfer(vault, vaultShare)`, and the credit call is now `vault.harvest(<actual delta>)` instead of `vault.harvest(vaultShare)`. The split arithmetic is unchanged (the intended `vaultShare`, the tip and the protocol accrual are still derived from `proceeds` exactly as audited — C6); only the credited amount became empirical. Consequences, per the F-03 fix intent: a fee-on-transfer surprise or any transfer loss can never create an accounting divergence between what arrived and what was credited, and the F-03 "harvest-credit death" (every harvest reverting `ExcessTooSmall` while an FOT upgrade is live) is resolved — yield flow continues at the received rate. If nothing arrives (pathological 100% loss), the credit call reverts `ZeroHarvest` and the atomicity design still rolls the whole harvest back (fees stay in the LP position). A credit above the intended share remains impossible to abuse: the credit is bounded by the vault's physical excess (C2/C3 unchanged), and after an F-04-style burn it can revert `ExcessTooSmall` gracefully (see F-04b).

**Event ABI change:** `Harvested` gained one field — `vaultCredited` (inserted after `vaultShare`; data is now 8 words, topics unchanged). It carries the amount actually credited, so the discrepancy against the intended `vaultShare` is observable on-chain. The repo's only in-tree consumer (the G1 fork test decoder) was updated in the same change; a repo-wide grep found no other consumer.

### F-04b — underflow-safe `unaccountedAssets()` and harvest excess (IMPLEMENTED)

`src/YieldShares.sol`: `unaccountedAssets()` returns 0 when the vault's token balance is at or below `_totalAssetsStored` (was: arithmetic underflow → Panic 0x11 after an issuer `adminBurn` below the accounting figure). `harvest()` clamps the excess the same way, so with no excess it reverts with the existing `ExcessTooSmall(assets, 0)` domain error instead of a panic. A burned vault now degrades to graceful no-yield. **Withdrawal math (`_withdraw`) is byte-for-byte unchanged** — the F-04 tail-insolvency residual (the final `X` wei of accounting unpayable after a burn) remains exactly as documented, and is now pinned by test rather than left implicit.

### G6/G7 tests added (audit sketches, updated for the hardened behavior)

New mocks in `test/mocks/MockERC20.sol`: `MockLossyTransferToken` (under-delivers transfers INTO one configured recipient — isolates the harvester→vault credit-leg loss) and `MockToggleableFeeOnTransferToken` (clean until `setFot(true)` — models the issuer fleet upgrade).

- G6 (F-03b), `test/Harvester.t.sol`:
  - `test_fotHarvest_creditsVaultActualBalanceDelta_notDeclaredShare` — end-to-end harvest over the lossy mock (10% loss on the credit leg only): intended share 1.8e18 vs credited 1.62e18; `totalAssets` == physical balance (no divergence), `unaccountedAssets()` == 0, tip/accrual unaffected (still proceeds-derived), and a second harvest credits its own delta on top — yield flow survives the lossy upgrade (the F-03 fix's point).
  - `test_fotHarvest_eventEmitsIntendedShare_andCreditedDelta` — pins the `vaultShare` (intended) vs `vaultCredited` (empirical) fields of the `Harvested` event via `vm.expectEmit`.
  - `test_fot_withdrawRetrievabilityAfterUpgrade` (the audit's literal G6 sketch — the F-03 withdraw-path walk), `test/YieldShares.t.sol` — a token that becomes fee-on-transfer after deposit: redeem pays the full accounted assets out (receiver gets assets×(1−f)), `balance >= _totalAssetsStored` holds through every exit, and the last withdrawer still gets out.
- G7 (F-04b), `test/YieldShares.t.sol`:
  - `test_adminBurn_belowStored_degradesGracefully_notPanic` — issuer burn below stored: `unaccountedAssets()` reads 0 (no Panic), a pushed-then-credited harvest reverts `ExcessTooSmall(1e18, 0)` (exact selector+args — proves the domain error, not a panic), and once the gap is covered the harvester credits again, still bounded by physical arrival.
  - `test_adminBurn_belowStored_withdrawalsStillWork_tailRecoversAfterBackingRestored` — withdrawals work while the balance covers the claim; the final-tail revert is pinned AS-IS (untouched withdrawal math); full recovery after backing is restored.
- `test/fork/HarvestFork.t.sol`: the Harvested decoder was updated for the new field (signature now 10 typed words, `uint256[8]` data), and both fork tests additionally assert `vaultCredited == vaultShare` on the clean chain (delta == declared when the token is not fee-on-transfer). Fork suite remains env-gated (`WELLSTREET_ROBINHOOD_RPC_URL`).

### backingCoverage() (IMPLEMENTED 2026-09-02)

`src/YieldShares.sol` gains one read-only view, `backingCoverage()`, beside `unaccountedAssets()` — the arXiv:2608.25269 adoption (BCR as an on-chain observable metric; the paper's five-role EIP-712 attestation machinery and its redemption-queue disposition remain REJECTED). It returns the vault's raw asset balance scaled against the accounted figure in 1e18 fixed point: `== 1e18` exact cover, `> 1e18` unaccounted excess (donations, uncredited yield), `< 1e18` the F-04b issuer-burn under-coverage state that previously read as a silent `unaccountedAssets() == 0`. The view adds no state, no auth surface, and no storage-layout change (a pure read of the existing balance/`_totalAssetsStored` pair); it is DEGENERATE-SAFE — `totalAssets() == 0` returns the 1e18 fully-covered sentinel instead of dividing by zero (mirroring `unaccountedAssets()`'s F-04b graceful form; `_totalAssetsStored` starts at 0, so the empty vault is a reachable state) — and its scaling uses OpenZeppelin `Math.mulDiv` full-precision intermediates rather than a raw `balance * 1e18`, so a hostile huge-balance state cannot overflow-revert the view. Consumers: the stateful invariant battery asserts the view equals the pinned definition (never coverage >= 1 — under-coverage is exactly the honest state it must be able to report), the daily observability runbook, and optionally the frontend. Test evidence: `test/invariants/YieldSharesInvariants.t.sol` `invariant_Solvency` (definition equality over arbitrary sequences, with the handler's donation action making the check non-vacuous; revert→fail→restore teeth recorded in `docs/ops/phase0/lp-intervention.md`), and the pre-existing F-04b unit tests still pass unchanged.

### Suite re-run (2026-08-31, `forge test -vvv` from the repo root)

Two runs were executed (the first run caught two bugs in the NEW tests themselves — a nested `balanceOf` in a call's argument list consumed the `vm.prank`/`vm.expectRevert`, the exact arg-evaluation trap this suite already documents in `test_firstDepositorInflationFails`; the tests were fixed, no contract code changed between runs):

- Run 1: `56 passed; 2 failed; 2 skipped (60 total tests)` — both failures in the new YieldShares tests described above.
- Run 2 (final): `58 passed; 0 failed; 2 skipped (60 total tests)` — 7 suites: `WellstreetTimelockTest` 16 passed · `VaultFactoryTest` 6 passed · `DeployWiringTest` 1 passed · `YieldSharesTest` 15 passed (12 prior + 3 new) · `HarvesterTest` 20 passed (18 prior + 2 new) · `SPYPoolForkTest` 1 skipped (env-gated) · `HarvestForkTest` 1 skipped (env-gated). The 2 skipped entries are the two env-gated fork contracts collapsing to one entry each (forge behavior when `setUp` skips — the audit-time baseline's "1 skipped" is the same collapse for the single fork file that existed then; the second fork file was added post-audit by the G1-gate session). Zero failures, zero attributable regressions in the pre-existing 53-test suite.

Note: a standalone `forge build` invocation was blocked by the operator session's command-permission gate; `forge test` performs the full compile before running and the final run completed with zero compile errors — the build is proven by the passing run itself.
