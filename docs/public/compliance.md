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

- The treasury timelock's proposer is a **2-of-3 Safe multisig**: two of the three owner keys must sign before anything can be scheduled. The three keys are held by **one operator** on separate devices — disclosed plainly, because multiple keys are NOT multiple parties. No single key can schedule an owner action alone, but a single person does control the operator set, and this project does not pretend otherwise. Execution after the 48-hour delay is open to anyone; scheduling is not.
- The **pause-only authority** is a separate key: it can pause deposits and do nothing else privileged, and the timelock can revoke it.
- `MAX_FEE_BPS` (20%) is the **only structural bound** on fee escalation. Keeping the fee at 10% is a governance commitment, not a code guarantee.
- Everything the timelock does is public and waits 48 hours: proposals are visible on-chain, and any address can execute them after the delay. If one of the three operator keys is compromised, the two uncompromised keys rotate owners through the Safe itself — a single compromised key never reaches the threshold.

The decentralization this project claims is about the code, not the keys: fully open source, MIT-licensed, permissionlessly forkable, and runnable by anyone from their own key ([run-it-yourself.md](run-it-yourself.md)). Control, by contrast, is concentrated in the keys described above — one operator — and that is disclosed here rather than dressed up, because a decentralization claim that contradicts the visible on-chain code would be worthless.

## Deployer key custody

At launch, two roles that would otherwise sit on the deployer key move to the 2-of-3 Safe: the treasury timelock proposer, and the $WELL creator fee wallet (the creator fee stream accrues to the multisig). The deployer EOA still embodies: the pause authority, the harvester LP seeding, the token-launch initial-buy wallet, and gas/ops duties — a single point of failure for those capabilities.

**Commitment: the deployer key moves to a hardware wallet (or an equivalent documented cold-storage procedure) before launch, and the three Safe operator keys live on three separate devices (hardware preferred).** Until those moves are done and documented, treat every privileged capability above as attached to hot keys, and act accordingly.

## Jurisdiction

The protocol performs no jurisdictional blocking: nothing in the contracts, this repository, or its docs gates access by geography, IP address, or nationality. Whoever serves a frontend — the canonical domain (wellstreet.tech), the IPFS mirror, or any fork's copy — may impose its own access rules; such a gate belongs to the operator serving it, not to the protocol. You are responsible for complying with the law where you are, and the protocol makes no representation that access or use is lawful anywhere. Geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure — which is part of why the protocol states no lawful-anywhere claim rather than implying a block line settles the question. See [risk-disclosure.md](risk-disclosure.md).
