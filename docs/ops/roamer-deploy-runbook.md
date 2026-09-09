# Roamer Deploy Runbook — RoamAllowlist + RoamingHarvester + RoamVault

**Date:** 2026-09-08 · **Status:** READY — script compiled 0 errors, constructor args verified against source · **Operator:** deployer keystore `wellstreet-deployer` (broadcast) + Safe 2-of-3 (wiring) · **Script:** `script/DeployRoamers.s.sol`

---

## 0. Env for the broadcast (export in the shell before forge)

```
TIMELOCK   0xD55bA510533dc5a250b4D6d49Ee825113DD69342
TREASURY   0x0Fd4B5495698b4EC04AeaC64567867083760ccea   (the Safe proxy — live-read from timelock.proposer(), RATIFIED 2026-09-08: immutable, junk+POL-take custody under 2-of-3)
PAUSER     <the pause-only EOA — the existing one from F-01>
USDG       0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168
DEPOSIT_CAP 25000000000   (= 25,000 USDG at 6 decimals — the ratified start)
```

## 1. Pre-flight battery (keyless, ALL GREEN before broadcast)

```bash
RPC=https://rpc.mainnet.chain.robinhood.com
# PF1 — the timelock is the real one:
cast call 0xD55bA510533dc5a250b4D6d49Ee825113DD69342 "timelock()(address)" --rpc-url $RPC  # n/a — check PROPOSER role instead:
cast call 0xD55bA510533dc5a250b4D6d49Ee825113DD69342 "proposer()(address)" --rpc-url $RPC   # == your Safe proxy
# PF2 — USDG alive:
cast call 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 "symbol()(string)" --rpc-url $RPC       # "USDG"
# PF3 — the deployer has gas:
cast balance <DEPLOYER_EOA> --rpc-url $RPC
# PF4 — the fork PoolManager is still the pin (bytecode present):
cast code 0x8366a39CC670B4001A1121B8F6A443A643e40951 --rpc-url $RPC | wc -c                  # > 1000
# PF5 — the RoamVault anchor book (USDG/ETH) still live:
cast call 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2 "getSlot0(bytes32)(uint160,int24,uint24,uint24)" 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551 --rpc-url $RPC  # nonzero sqrtPriceX96
```

## 2. The broadcast (your keys, one command)

```bash
forge script script/DeployRoamers.s.sol \
  --account wellstreet-deployer --interactive \
  --rpc-url robinhood --broadcast
```

Read the receipt — record the three addresses:
`DEPLOYED RoamAllowlist 0x…` · `DEPLOYED RoamingHarvester 0x…` · `DEPLOYED RoamVault 0x…`

**Post-broadcast verification (keyless):**
```bash
AL=<allowlist>; RH=<roamer>; RV=<vault>
cast call $AL "timelock()(address)" --rpc-url $RPC          # == TIMELOCK
cast call $RH "poolManager()(address)" --rpc-url $RPC       # == 0x8366a39C…40951 (THE pin)
cast call $RH "allowlist()(address)" --rpc-url $RPC         # == $AL
cast call $RH "minHoldSeconds()(uint32)" --rpc-url $RPC     # == 604800
cast call $RH "maxMigrationsPerPeriod()(uint16)" --rpc-url $RPC # == 4
cast call $RH "minExpectedGainBps()(uint32)" --rpc-url $RPC # == 3911
cast call $RH "migrationFeeBps()(uint24)" --rpc-url $RPC    # == 0
cast call $RV "asset()(address)" --rpc-url $RPC             # == USDG
cast call $RV "depositsPaused()(bool)" --rpc-url $RPC       # true (init-paused)
cast call $RV "DEPOSIT_CAP()(uint256)" --rpc-url $RPC       # == 25000000000
```

## 3. Safe wiring — ONE batched proposal, one 48-hour window

Queue all three in a single Safe batch (safe-ops.md CLI pattern; each is a timelock `queue` call signed 2-of-3):

| # | Call | Effect |
|---|---|---|
| P1 | `roamer.setVault(<RV>, 0x5fc5360D…d168)` — ONE-SHOT, irreversible | binds the vault ↔ roamer (deposit-custody path) |
| P2 | `vault.setDepositPaused(false)` | opens USDG deposits |
| P3 | *(after P2 + your seed deposit)* `vault.vaultDeploy(key, capitalUsdg)` — the key: USDG/ETH poolKey `bac3aa3b…` | deploys vault capital into the roamer's first position |

Execute each after its window (permissionless `timelock.execute`), verifying between.

## 4. Treasury address — RATIFIED 2026-09-08 (the Safe proxy)

`TREASURY = 0x0Fd4B5495698b4EC04AeaC64567867083760ccea` (the Safe proxy — live-read from `timelock.proposer()`, the coldest custody surface you hold). It receives: force-sent junk excess, POL-lane migration fees (if the Safe ever sets migrationFeeBps > 0 on POL positions), and rescue paths. It is NOT the holder fee stream (that's burn + Pons). **The address is IMMUTABLE** — recorded here as the permanent custody decision.

## 5. $WELL launch binding (post-launch, separate proposal)

```
P4: roamer.setWellToken(<$WELL from the Pons launch>) — ONE-SHOT
```
Until P4: `sweepToBurn` reverts NO_WELL_TOKEN — fees accumulate harmlessly. After P4: the 10% lane buys and burns live. Also at launch: tick the **holder fee share** checkbox (Pons native — the trading-fee lane; IRREVERSIBLE).

## 6. The test-deposit rehearsal (pre-$WELL, recommended)

After P1–P3: deposit 5,000–10,000 USDG from the dev wallet → `vaultDeploy` a slice → watch the first fees accrue → `harvest` (the 90% leg works pre-$WELL; the 10% leg waits for P4) → `redeem` a slice (idle-first proof live). Every number this produces is the site's first measured vault yield.
