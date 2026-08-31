# What the contracts guarantee

Every claim on this page describes a property the v1 contracts are specified and tested to have. Each property is covered by the Foundry test suite in this repository — run `forge test` and watch them execute. If the code and this file ever disagree, the code wins and this file gets corrected.

What this page deliberately does not promise is in [not-guaranteed.md](not-guaranteed.md).

## 1. Donations cannot move the share price

`totalAssets` is a storage variable, updated only by the deposit, withdrawal, and harvest paths. Sending tokens directly to the vault (a "donation") does not change `totalAssets`, does not change the share supply, and does not change the price per share. No deposit path can book tokens it did not actually receive.

## 2. The first depositor cannot inflate shares

A virtual offset between the asset accounting and the share accounting makes the classic ERC-4626 first-depositor inflation attack unprofitable: rounding gains and price manipulation from being first cannot be extracted from later depositors.

## 3. Yield enters only through the harvester

The only path that adds yield is `harvest()` on the Harvester contract: it collects swap fees from the protocol's own liquidity position in the stock token's pool, converts the non-stock leg to the stock token, and pushes the proceeds into the vault. No shares are minted when yield is pushed, so it accrues pro-rata to existing depositors.

Two properties of that path worth stating precisely:

- **The harvest is atomic.** If the swap leg fails (stale price bound, router failure), the entire harvest reverts and the collected fees stay in the LP position, collectable by the next harvest. No harvest outcome can strand fees outside the position or mint shares on a failed harvest.
- **The harvester's own LP principal is protocol capital.** It is excluded from the vault's `totalAssets`: depositor accounting counts depositor assets and pushed fee income only, never the liquidity position itself.

## 4. The protocol fee is capped in code

The protocol fee starts at 10% of harvested yield (90% stays with depositors). The timelock can change it, but only within `MAX_FEE_BPS = 2000` — 20%. The cap is a compile-time constant; no owner action can raise it.

## 5. Skim and fee-on-transfer protection

Deposits verify that the vault's actual asset balance increased by the full deposited amount. A token that takes a fee on transfer — or any transfer that silently shortchanges the vault — causes the deposit to revert. The vault never books phantom assets.

Direct transfers to the vault sit unaccounted (see 1): nobody can claim them through the share price, and the next depositor cannot skim them.

## 6. Redemption is never pausable

Deposits can be paused. Withdrawals and redemptions cannot be — there is no pause path on them, available to any role. The protocol's own controls can never trap your funds.

One caveat that belongs in the same sentence: the underlying stock token can itself be paused by its issuer, which freezes all transfers for everyone, including the vault. During an issuer pause, redemption is permitted by our contracts but cannot execute, because the underlying token transfer reverts. Details: [risk-disclosure.md](risk-disclosure.md).

## 7. Harvest is permissionless

`harvest()` can be called by anyone. The caller receives a tip of 0.1% of the harvested proceeds, deducted from the protocol share — not from depositor yield, and not 0.1% of the protocol share. There is no keeper dependency: if nobody harvests, fees accrue in the LP position until someone does.

## 8. Owner controls wait 48 hours

Owner-controlled parameters go through a 48-hour timelock: the protocol fee (within its cap), the deposit pause, grants and revocations of the pause-only role, and any removal or rebalancing of the treasury's LP capital. A proposal is public on-chain, waits at least 48 hours, and can then be executed by anyone — execution is permissionless. No owner action takes effect immediately.

Sweeping already-accrued fees to the treasury is permissionless and needs no owner action.

### The pause model, precisely

- Deposits can be paused by (a) the treasury timelock and (b) a function-limited pause-only authority — an EOA whose only privileged capability is pausing deposits. The pause-only authority is revocable by the timelock, so a compromised pause key can be stripped.
- `redeem` / `withdraw` have no pause path at all.

## How to check these

Every numbered item maps to tests in the repository's Foundry suite. After deployment, the contract sources are verified on the block explorer, so the deployed bytecode can be compared against this repository at the deployed commit.
