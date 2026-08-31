# $WELL and protocol economics

Status first: **$WELL has not launched.** Nothing on this page is an offer. The numbers here describe the fee mechanics as configured at launch; where a value is fixed in code versus set at launch time, that is stated.

## The two fee streams, kept deliberately separate

There are exactly two fee streams in this protocol, and they flow to different places.

### 1. Vault protocol fee → treasury (not the token)

The vault takes a share of harvested yield — **10% initially** — and routes it to the treasury, which is controlled by a 48-hour timelock. The fee is settable by the timelock within a hard cap of **20%** (`MAX_FEE_BPS = 2000`, a compile-time constant).

This stream is **not** distributed to $WELL holders and is not routed to the token in any way. Vault revenue and the token are separate on purpose: no part of this documentation may imply that vault revenue flows to the token, and none does.

### 2. $WELL creator fee share → automated buybacks

$WELL launches on the pons launchpad (ponsfamily.com) on Robinhood Chain (chain ID 4663). With buybacks enabled at launch, the pad's fee split per unit of pool fees is:

- **35%** → the creator fee wallet,
- **35%** → an automated $WELL buyback leg (the pad diverts half of the pre-buyback creator stream to buy the token),
- **30%** → the pad's own protocol share (measured live at 30.0000% at probe time; the pad's owner can raise it to at most 50%).

$WELL carries no creator trade tax (`creatorTaxBps = 0`): the creator share comes from the fee split, not from a tax on trades.

## What $WELL holders actually receive

**Nothing is distributed to $WELL holders.** No dividends, no staking rewards, no fee routing to holder wallets. The buyback leg reduces circulating supply (buy-and-burn per the pad's launch parameters), so holders benefit — if at all — through scarcity and price. That is a market outcome, not a payment. A buyback is not a dividend and confers no entitlement of any kind.

The exact buyback mechanics (burn versus treasury custody, execution timing) are confirmed from the pad's verified hook source before launch and recorded in the launch transaction; this page is updated with the confirmed mechanics at that point.

## The vault fee split, concretely

Of every unit of yield the harvester pushes into the vault:

- **90%** accrues to depositors pro-rata (no shares are minted);
- **10%** accrues to the treasury (initially; timelock-settable within the 20% cap);
- the harvest caller receives a **0.1% tip** on the harvested proceeds, deducted from the protocol share — not from depositor yield.

## The treasury, and what it is for

The treasury is controlled by a 48-hour timelock: proposals are public on-chain, wait at least 48 hours, and can be executed by anyone after the delay. Its v1 purposes, fully disclosed:

1. **Custody of accrued protocol fees** (the vault's share of yield).
2. **Custody and removal control of the protocol-owned harvester LP principal** — the treasury's own liquidity-position capital, which bears impermanent loss and WETH price risk (see [not-guaranteed.md](not-guaranteed.md); it is excluded from depositor accounting).

Any use beyond those two requires a public 48-hour timelock proposal, visible on-chain, before funds move.

## Token parameters

| Parameter | Value |
|---|---|
| Name / symbol | Wellstreet / $WELL |
| Launch venue | pons launchpad (ponsfamily.com), Robinhood Chain (chain ID 4663) |
| Launch supply | 1,000,000,000 |
| Launch fee (paid to the pad) | 0.0005 ETH |
| Creator trade tax | 0 |
| Creator fee wallet | Published at launch |
| Contract address | `PENDING_DEPLOY` — not launched |

## What is promised

Nothing beyond what is written on this page. No staking program, no future buyback schedule, no dividend, no airdrop, no yield target, no price target. If a promise is not in this file, it does not exist.
