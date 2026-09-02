# What is NOT guaranteed

The honest list. For what the contracts do guarantee: [guarantees.md](guarantees.md). For the full threat model: [risk-disclosure.md](risk-disclosure.md).

## Not audited

No third-party audit has been performed or is scheduled. The contracts are new and unreviewed by any professional security firm. Treat everything here as experimental until an audit says otherwise.

## Not battle-tested

The protocol has no operating history. No depositors have ridden a full market cycle, no harvest has run in production, no edge case has been hit by real users at real size. Tests and invariants reduce risk; they do not remove it.

## The underlying stock token is issuer-controlled

The vault wraps a tokenized stock token the protocol does not control. The issuer can:

- **Pause the token** — freezing all transfers (deposits, redemptions, everything) until they unpause. Our contracts cannot pause your redemption, but during an issuer pause redemption cannot execute either, because the underlying token transfer reverts.
- **Upgrade the token fleet** — the stock tokens are proxies behind one shared beacon and one shared implementation. An upgrade applies to every token at once and could change any rule the tokens currently follow.
- **Burn balances from any address** — the token exposes an admin burn that is not gated by the pause or the blocklist. Balances held by the vault, the harvester, the treasury, or you can be removed by the holder of the issuer's burn role.
- **Blocklist addresses** — every money path (transfer, approval, permit) enforces an issuer-controlled address blocklist.
- **Rewrite token metadata** — the issuer can change a token's name and symbol.

All of this is outside the protocol's control. Depositing is accepting all of it.

## No yield certainty

Yield comes from swap fees on the stock token's liquidity pool. It varies with trading volume — hourly, daily, seasonally. There is no fixed rate, no floor, and no promised APR.

Pool-level fee APR is not depositor yield either. Depositor yield is roughly: pool fee income × the harvester's share of pool liquidity ÷ vault deposits × (1 − protocol fee). When volume dries up, yield approaches zero. No yield figure anywhere in this project's docs is a projection or a target; a measured figure is historical and reproducible only from the evidence it was computed from.

## Treasury capital bears real market risk — and why that never touches depositors

The protocol seeds the harvester's liquidity position with treasury-owned capital. That principal:

- bears **impermanent loss** between the stock token and WETH as their relative prices move, and
- bears **WETH price risk** (half the position is denominated in WETH).

These losses hit treasury capital only — never depositor assets. That is structural, not a policy: the LP principal is excluded from the vault's `totalAssets` (see guarantee 3 in [guarantees.md](guarantees.md)), so only fee income harvested from the position ever flows into the vault, never the position itself.

The cost of the design is real and disclosed: the protocol's own capital can shrink, and the treasury can remove or rebalance the position only through the 48-hour timelock.

## No peg defense — for $WELL or for ws-SPY

The protocol runs **no algorithmic peg defense and no market-intervention
mechanism, now or planned** — no protocol-owned trading operation, no price floor,
no buyback-against-decline program beyond the pad's automated buyback leg, and no
discretionary market ops behind the single proposer key. $WELL's only accrual is
the pons buyback stream (a market mechanism, not a defense policy); ws-SPY is
price-anchored by instant burn-for-underlying redemption arbitrage — anyone can
arbitrage a premium or discount, and the protocol itself will never trade to
defend a price. If a price moves, the protocol's only action is disclosure.

## Owner controls are single-keyed

- The treasury timelock has **a single proposer key** — the Wellstreet deployer EOA. Execution after the 48-hour delay is open to anyone, but only that key can start a proposal, and therefore only that key can schedule any owner action. The openness this project claims — open source, MIT, permissionlessly forkable — is a claim about the code, not the keys; the concentration above is real and disclosed.
- The same EOA holds a **function-limited pause-only authority** over deposits (it can pause deposits and do nothing else privileged). The timelock can revoke it.
- `MAX_FEE_BPS` (20%) is the **only structural bound** on fee escalation. Keeping the fee at 10% is a governance commitment, not a code guarantee — the code's job is only to keep it under 20%.

Key custody: [compliance.md](compliance.md).

## Also not guaranteed

- **Nothing here is investment advice**, an offer, or a solicitation.
- **No uptime guarantee.** The frontend and API are conveniences; the contracts are the product, and they can still fail.
- **No support SLA.** This is an open-source project; issues get attention when maintainers get to them.
