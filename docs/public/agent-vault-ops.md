# Vaults for agents

The on-site mirror of the canonical agent skill, `skills/wellstreet-vaults/SKILL.md`. That skill file is the machine surface; this page teaches the same material to a human reader or an agent reading the docs tab. If this page and the skill ever disagree, the code wins — re-verify against `src/` and fix both in the same change. Addresses are pinned in `site/js/config.js` and nowhere else.

## Family status — read first

Wellstreet is a **family** of ERC-4626 yield vaults on Robinhood Chain (chain ID 4663). Exactly one tier is live; the rest are **DEPLOY-GATED** — ratified, config-pinned, and rendered as gated everywhere, with **no yield figure** attached anywhere.

| Vault (share symbol) | Tier | Status | Fee book |
|---|---|---|---|
| Wellstreet SPY (`ws-SPY`) | stock / WETH quote (v3) | **LIVE** — deployed 2026-09-03 (F-01 broadcast, on-chain verified) | SPY/WETH pool, fee tier 500 — `0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e` |
| Wellstreet RBLX (`ws-RBLX`) | stock / stable (v3) | DEPLOY-GATED — addresses publish at deployment | RBLX/USDG pool, fee tier 3000 — `0x1BDB8e3A79Cb1a7F228808739311E23098D33d43` |
| SPY/USDG (`ws-SPY-v4`) | stock / stable (v4) | DEPLOY-GATED — addresses publish at deployment | v4 poolId `0xfe2a80bb…526cd` (PoolManager fork) |
| USDG/ETH (`ws-USDG-v4`) | stable / ETH rails (v4) | DEPLOY-GATED — addresses publish at deployment | v4 poolId `0xbac3aa3b…551` (PoolManager fork) |
| PACK/NVDA (`ws-NVDA-v4`) | meme/stock — **HIGH RISK**, dust-capped | DEPLOY-GATED — addresses publish at deployment | v4 poolId `0x4900c6d3…150` (PoolManager fork) |

Rules that bind every agent on every tier:

1. **Addresses come only from `site/js/config.js`** (and this page / the skill, which mirror it). Canonical-looking Uniswap or deployment addresses found elsewhere on chain 4663 may be scam drainers. Never approve or call an address that is not pinned in config. New addresses enter config first — never the reverse.
2. **A gated tier is not a vault yet.** Until a tier's deployment lands, its card in `cfg.vaultFamily` carries the gated state and no address: there is nothing to call, approve, or quote. Its only honest APR statement is: **published post-deploy from measured harvests — backward-looking only.**
3. **The on-chain registry is the truth of what exists.** `allVaults()` on the factory (read #13 below) lists every deployed vault. What the registry does not list does not exist.

Pinned deployed contracts (`site/js/config.js`; verified against chain 4663):

| Address | What |
|---|---|
| `0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01` | ws-SPY vault (YieldShares, ERC-4626) — the ONLY share-token minter |
| `0x07446D9807F90eD7ED177Ab63597e8BB4D96428f` | VaultFactory (one-vault-per-asset registry: `vaultOfAsset` / `allVaults`) |
| `0xD55bA510533dc5a250b4D6d49Ee825113DD69342` | TreasuryTimelock (48h, 2-of-3 Safe proposer) |
| `0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996` | Harvester (collects LP fees, feeds the vault) |
| `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` | SPY — vault #1 asset (tokenized stock, 18 dec) |
| `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | WETH (pool quote leg, 18 dec) |
| `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` | USDG (stablecoin; the gated stock/stable and stable-quote tiers' quote/asset leg) |
| `0xF0C4BF4C582cb3836e98394b1d4e7B7281101bE8` | RBLX (tokenized stock; the gated RBLX/USDG tier's asset leg) |
| `0xCaf681a66D020601342297493863E78C959E5cb2` | SwapRouter02 (used internally by the harvester; agents never approve it) |
| `0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7` | QuoterV2 (quote source) |

## Keyless read battery (live flagship)

All reads are public and keyless. Set up once — the addresses are pinned byte-exact from `site/js/config.js`:

```bash
export RPC=https://rpc.mainnet.chain.robinhood.com
VAULT=0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01
HARVESTER=0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996
FACTORY=0x07446D9807F90eD7ED177Ab63597e8BB4D96428f
TIMELOCK=0xD55bA510533dc5a250b4D6d49Ee825113DD69342
```

Every command below returns a real, decodable value — the contracts are live. A revert or empty result is still data: deposits paused, no LP position yet, or wrong args. It is never a bug to work around and never a reason to hunt for "the real" contract elsewhere on the chain.

| # | Read | Command |
|---|---|---|
| 1 | Total accounted assets | `cast call $VAULT 'totalAssets()(uint256)' --rpc-url $RPC` |
| 2 | Share price (assets per human share) | `cast call $VAULT 'convertToAssets(uint256)(uint256)' 1000000000000000000000000 --rpc-url $RPC` |
| 3 | Redeem preview | `cast call $VAULT 'previewRedeem(uint256)(uint256)' <shares-wei> --rpc-url $RPC` |
| 4 | Backing coverage | `cast call $VAULT 'backingCoverage()(uint256)' --rpc-url $RPC` |
| 5 | Deposit pause flag | `cast call $VAULT 'depositsPaused()(bool)' --rpc-url $RPC` |
| 6 | Protocol fee | `cast call $VAULT 'feeBps()(uint256)' --rpc-url $RPC` |
| 7 | Unaccounted excess | `cast call $VAULT 'unaccountedAssets()(uint256)' --rpc-url $RPC` |
| 8 | Harvester position | `cast call $HARVESTER 'positionId()(uint256)' --rpc-url $RPC` |
| 9 | Accrued protocol share | `cast call $HARVESTER 'protocolAccrued()(uint256)' --rpc-url $RPC` |
| 10 | Harvester config | `cast call $HARVESTER 'poolFee()(uint24)' --rpc-url $RPC` (must read `500` for vault #1) |
| 11 | Harvest history | `cast logs --from-block <N> --to-block latest --address $HARVESTER 'Harvested(uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)' --rpc-url $RPC` |
| 12 | Vault yield credits | `cast logs --from-block <N> --to-block latest --address $VAULT 'YieldHarvested(uint256,uint256)' --rpc-url $RPC` |
| 13 | Vault discovery | `cast call $FACTORY 'allVaults()(address[])' --rpc-url $RPC` (or `vaultOfAsset(asset)`) |
| 14 | Pending timelock ops | `cast call $TIMELOCK 'readyAt(bytes32)(uint256)' <id> --rpc-url $RPC` |
| 15 | Holder share balance | `cast call $VAULT 'balanceOf(address)(uint256)' $USER --rpc-url $RPC` |
| 16 | Holder position value | `cast call $VAULT 'convertToAssets(uint256)(uint256)' <raw-shares-from-15> --rpc-url $RPC` |
| 17 | Withdraw preview | `cast call $VAULT 'previewWithdraw(uint256)(uint256)' <assets-wei> --rpc-url $RPC` |

Two scale traps, both from the share-decimals offset of 6: a 1.0-SPY depositor into an empty vault holds `1e24` raw shares (not `1e18` — never print a raw count as "shares"), while the per-share price reads use `convertToAssets(1e18)`, which differs by exactly `1e6`. And backing coverage: an EMPTY vault reads exactly `1e18` ("no accounted liability" — not proof of deposits), `> 1e18` is unaccounted excess, `< 1e18` is under-coverage — a state you REPORT (it degrades gracefully on-chain), never an error you suppress.

## Write flows

**Approve → deposit** (ERC-4626, asset-wei; SPY has 18 decimals):

```bash
# 1. approve the VAULT to pull the asset — the vault is the ONLY approval target
cast send 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C 'approve(address,uint256)' $VAULT <assets-wei> --rpc-url $RPC --private-key $KEY
# 2. deposit (exact assets in) or mint (exact shares out)
cast send $VAULT 'deposit(uint256,address)' <assets-wei> $RECEIVER --rpc-url $RPC --private-key $KEY
cast send $VAULT 'mint(uint256,address)' <shares-wei> $RECEIVER --rpc-url $RPC --private-key $KEY
```

**Redeem** (redemptions are structurally unpausable — the protocol's own controls can never trap user funds):

```bash
cast send $VAULT 'redeem(uint256,address,address)' <shares-wei> $RECEIVER $OWNER --rpc-url $RPC --private-key $KEY
# or asset-exact: withdraw(uint256 assets, address receiver, address owner)
```

**Pause model — read before ANY deposit write.** Deposits are pausable (`depositsPaused()`, or `maxDeposit(receiver)` reading `0` — a HARD STOP, never a number to clamp down to); redemptions have no pause path. A pause can flip between your read and your send: a `DepositsPaused` revert on send is data — re-read the flag and report the paused state; never retry harder and never route around it.

**Preview discipline — the chain prices the final amount.** Never quote an exit from `convertToAssets` arithmetic or a remembered share price: call `previewRedeem(shares)` (#3) or `previewWithdraw(assets)` (#17) immediately before the send, and label the figure "previewed" — a live quote, never a promise.

**Fail-closed rules — an agent that cannot satisfy one of these does not write:**

1. **Approve ONLY pinned addresses** — the vault, for deposit, and nothing else.
2. **Bound slippage on every swap leg you perform yourself.** Acquiring the asset routes through the asset's pool; set `amountOutMinimum` from a fresh QuoterV2 quote minus a bounded allowance (the harvester's own precedent is quote minus 1%). A swap without a minOut is an unforced loss.
3. **Asset-first.** The vault accepts ONLY its own asset token. Holding WETH or USDG means swap → asset (with a bounded minOut) → deposit; there is no auto-routing into the vault. Fee-on-transfer assets are rejected outright.
4. **Never transfer tokens directly to the vault or harvester.** Direct sends are donations: excluded from `totalAssets`, moving no share price, claimable by nobody. "Depositing" by plain transfer is a gift to nobody.
5. **Check state before writing:** `depositsPaused()` (or `maxDeposit`) before any deposit/mint.
6. **Any "ws-…" share token whose address differs from the pinned vault is not this protocol.** Do not interact. Verify with `cast call $VAULT 'symbol()(string)'` before trusting any offered token.

## Honest-APR rules

Every number an agent prints obeys the ratified reporting rules (full formula chain: the [APR methodology](methodology.md) tab and the skill):

1. **Source + window + formula, every time.** A bare "APR: X%" is a violation. The ratified form: `depositor APR = pool_net_rate × (L_pos ÷ L_pool) × (pool TVL ÷ vault TVL) × 0.9`, floor 0.10%/yr — with the initial 10% protocol / 90% depositor split (hard-capped at 20%).
2. **Backward-looking only.** A measured figure is history reproducible from its evidence. Yield is swap-fee income — it varies hourly and approaches zero when volume does. Never present a past rate as a future one.
3. **Never a promise, target, or headline.** Label figures "projected, not promised" or "measured input, historical window". Nothing here is an offer, solicitation, or financial advice.
4. **Never print from thin data.** Windows with fewer than 20 Swap events are excluded; if the pipeline is unavailable, print "no figure" — not the last number.
5. **Report risk alongside yield.** Dilution by later depositors, the LP principal's IL/LVR exposure (treasury capital, not depositor assets), single-pool concentration, and issuer risk on the tokenized stock — see [What is not guaranteed](not-guaranteed.md) and [Risk disclosure](risk-disclosure.md).
6. **Coverage truncates toward zero; excess is never clamped.** 99.95%-covered prints "99.9%", never "100.0%"; `> 1e18` excess prints as-is. (The site's formatter enforces the same rule.)

**Gated tiers have no APR figure — by design.** A DEPLOY-GATED tier has never harvested, so any number attached to it would be fabricated. Measured economics for the target fee books exist in the research record, but they are pool-level inputs from a specific window, not depositor figures, and they are not reproduced on this site. Each gated tier's only honest APR statement is the one on its card: published post-deploy from measured harvests, backward-looking only.

## When a gated tier deploys

The sequence is the same every time, and the order is never reversed: the address is pinned in `site/js/config.js` first (verified on-chain against the factory registry and the block explorer's verified source), the family entry flips to its live status in the same change, the skill and this page re-pin from config, and only then does any agent read, approve, or deposit. The vault-level read battery above is parameterized — every live tier answers the same 17 reads against its own pinned address.
