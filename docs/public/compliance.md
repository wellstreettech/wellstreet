# Compliance posture

This page states, plainly, the association and securities postures this project commits to. It is written to be checkable: every commitment here is either a property of these docs or a property of the contracts.

## Trademark and association

The chain this protocol runs on and the tokens it wraps carry third-party names. The rules this project follows:

- **No endorsement, no affiliation.** Nothing in this repository, its docs, or its frontend implies endorsement, partnership, or approval by Robinhood Markets, Inc. or any of its subsidiaries. The protocol is not built, operated, or reviewed by them.
- **Chain and token names are identifiers, nothing more.** "Robinhood Chain" identifies the network (chain ID 4663). Stock token names as they appear on-chain (for example, "SPDR S&P 500 ETF Trust • Robinhood Token") identify the specific ERC-20 asset being wrapped. Both appear in these docs only as technical identifiers of things that exist on-chain.
- **No launchpad framing.** The $WELL launch venue is the pons launchpad (ponsfamily.com). These docs do not use any other company's name to describe the launch, the vaults, or the yield path.
- **No marks.** No third-party logos or brand assets are used anywhere in this repository.

## Buybacks are not distributions

$WELL holders receive no distributions. The automated buyback leg funded by the creator fee share reduces supply; it does not pay holders anything and confers no entitlement. A buyback is not a dividend, and scarcity is a market outcome, not a promised return. See [tokenomics.md](tokenomics.md).

## Trust model

Stated plainly, without the usual softening:

- The treasury timelock has **a single proposer key** — the Wellstreet deployer EOA. Only that key can schedule an owner action. Execution after the 48-hour delay is open to anyone, but scheduling is not. Any claim that "no single key can act alone" would be false, and none is made here.
- The same EOA holds a **function-limited pause-only authority** over deposits (it can pause deposits and do nothing else privileged). The timelock can revoke it.
- `MAX_FEE_BPS` (20%) is the **only structural bound** on fee escalation. Keeping the fee at 10% is a governance commitment, not a code guarantee.
- Everything the timelock does is public and waits 48 hours: proposals are visible on-chain, and any address can execute them after the delay.

## Deployer key custody

One key currently embodies: vault owner, treasury timelock proposer, pause authority, $WELL creator fee wallet, harvester LP seeder, and the token-launch initial-buy wallet. That is a single point of total failure.

**Commitment: the deployer key moves to a hardware wallet (or an equivalent documented cold-storage procedure) before launch.** Until that move is done and documented, treat every privileged capability above as attached to a hot key, and act accordingly.

## Jurisdiction

Access to the canonical domain (wellstreet.tech) is blocked from the United States and the United Kingdom; the IPFS mirror carries a disclosure banner because it cannot enforce a block. Geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure. See [risk-disclosure.md](risk-disclosure.md).
