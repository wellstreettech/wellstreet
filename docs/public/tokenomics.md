# $WELL and protocol economics

Status first: **$WELL has not launched.** Nothing on this page is an offer. The vault and roamer contracts are deployed and live on Robinhood Chain (chain ID 4663) — addresses pinned in `site/js/config.js` — and the vault split below is fixed in code, not settable. The $WELL numbers describe the pad's fee mechanics as configured at the token's launch; where a value is fixed in code, set in the launch transaction, or confirmed only at launch, that is stated.

## The two fee streams, kept deliberately separate

There are exactly two fee streams in this protocol, and they flow to different places.

### 1. $WELL creator fee stream → $WELL holders

$WELL launches on the pons launchpad (ponsfamily.com) on Robinhood Chain (chain ID 4663), native ETH pair. The launch enables the pad's holder fee share: **every creator fee routes to $WELL holders** through the pad's fee distributor — opted in at launch, **permanent once routed**. Two components ride that stream:

- the **trading fees** — the creator's share of pool fees, and
- a **2.00% tax on every trade** (set in the launch configuration, 2026-09-21), which rides the same creator stream and reaches holders through the same distributor.

Nothing from this stream reaches a team wallet, and the routing is not revisitable: once the stream is routed to the distributor, it does not revert to the creator.

### 2. Vault LP fees → 90% depositors / 10% burn (not the token's fee stream)

The live vault, **RoamVault** (ERC-4626, USDG asset, live since 2026-09-13), splits the yield its roamer accounts for by **immutable constants**:

- **90%** (`DEPOSITOR_BPS = 9000`) accrues to depositors pro-rata through the share price — no shares are minted when yield is pushed;
- **10%** (`BURN_BPS = 1000`) buys $WELL and burns it through the roamer's `sweepToBurn` machinery — a protocol fee that burns, not team income.

There is no `feeBps`, no `setFeeBps`, and no treasury cut anywhere on this path — the dev take is **structurally zero**: enforced by the absence of the setter in the verified source, not by policy. The two constants sum to 10,000 and neither is settable by any role.

The burn leg is inert until $WELL exists and is wired: `setWellToken` is a one-shot call, queued through the 48-hour timelock after launch. Until then the burn lane's accrual sits harmlessly in the roamer — nothing is lost and nothing is distributed.

This stream is the only place vault revenue and the token touch, and it is one-directional: LP fees buy and burn $WELL. Vault yield is never paid to $WELL holders, and $WELL holders have no claim on vault assets.

## The legacy flagship vault (wind-down declared)

The protocol's first vault — broadcast 2026-09-03 — took a share of harvested yield: **10% initially**, routed to the treasury, settable by the timelock within a hard cap of **20%** (`MAX_FEE_BPS = 2000`, a compile-time constant), with a **0.1%** tip on harvested proceeds to the permissionless harvest caller, deducted from the protocol share. That vault is empty and **wind-down declared**: no new deposits are sought, no new capital is deployed to it. Its mechanics are stated here so the older fee model stays checkable instead of being rewritten out of history; its guarantees keep their own section in [guarantees.md](guarantees.md).

## What $WELL holders actually receive

The creator fee stream: a pro-rata share of the trading fees plus the 2.00% trade tax, routed through the pad's fee distributor. That is a payment stream whose size varies with volume — not a yield target, not a fixed rate, and not an entitlement to vault assets. The distribution mechanics (accrual versus claim, the distributor's exact payout shape) follow the pad's distributor as deployed at launch; this page is updated with the confirmed mechanics from the distributor's verified source once live.

**No peg defense.** No part of either stream is a price-defense policy: the protocol runs no algorithmic peg defense for $WELL (or for ws-SPY), holds no market-intervention mandate, and will not trade to defend any price — now or planned. See [not-guaranteed.md](not-guaranteed.md).

## The protocol pocket

The one-tx LP router charges a flat **0.0005 ETH** per position open — settable only through the 48-hour timelock, with a hard ceiling of 0.05 ETH in code. This fee is the protocol pocket's only income and it is **100% recycled into the roamer endowment** (protocol-owned liquidity): it is not taken as revenue and reaches no team wallet. The recipient is the treasury timelock itself, fixed at deployment.

## The treasury, and what it is for

The treasury is controlled by a 48-hour timelock: proposals are public on-chain, wait at least 48 hours, and can be executed by anyone after the delay. The timelock's only proposer is a 2-of-3 Safe multisig (three keys, one operator — see [compliance.md](compliance.md)). Its purposes, fully disclosed:

1. **Wiring the token** — the one-shot `setWellToken` call that activates the burn leg (a public 48-hour queue after launch).
2. **Governance parameters** — the router fee (within its ceiling), the roamer's guardrails, the deposit cap (within its immutable ceiling), and removal or rebalancing of the protocol's own LP capital.

Any use beyond those requires a public 48-hour timelock proposal, visible on-chain, before funds move.

## Allocations

No team allocation and no foundation treasury. The dev take is structurally zero on every stream: the creator fee stream routes to holders, the vault split has no treasury path in code, and the router fee recycles into the endowment. The only protocol-owned capital in the system is the roamer's LP seed, custodied by the treasury and removable only through the public 48-hour timelock.

## Token parameters

| Parameter | Value |
|---|---|
| Name / symbol | Wellstreet / $WELL |
| Launch venue | pons launchpad (ponsfamily.com), Robinhood Chain (chain ID 4663), native ETH pair |
| Launch supply | 1,000,000,000 (fixed supply — final value read from the verified token at launch) |
| Creator trade tax | 2.00%, shared with holders (rides the creator stream) |
| Creator fee routing | $WELL holders, via the pad's fee distributor — opted in at launch, permanent once routed |
| Launch fee (paid to the pad) | as charged by the pad — read from the launch transaction when it exists |
| Contract address | None yet — the token has not been created |

## What is promised

Nothing beyond what is written on this page. No staking program, no dividend, no airdrop, no yield target, no price target. If a promise is not in this file, it does not exist.
