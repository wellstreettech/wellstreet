# Risk disclosure

A plain-language threat model. Read this before interacting with anything in this repository or its deployed contracts. What the contracts do guarantee: [guarantees.md](guarantees.md). The shorter honest list: [not-guaranteed.md](not-guaranteed.md).

## Experimental software

The contracts in this repository are experimental, unaudited software deployed to a production chain. They may contain bugs that lose funds irreversibly. No third-party audit has been performed. Interacting with them is entirely at your own risk.

## Not investment advice

Nothing in this repository — docs, frontend, or contracts — is investment advice, an offer, or a solicitation. Tokenized stock tokens are blockchain representations issued by a third party; they are not the underlying shares, carry their own risks, and may not track the referenced security. Depositing into a yield vault is a speculative activity.

## Issuer risk — the stock token is someone else's contract

Each vault wraps a tokenized stock token issued and administered by a third party (the issuer). The protocol cannot control, veto, or undo issuer actions. The capabilities below are in the deployed, verified token source today — they are not hypothetical:

- **Pause.** The token can be paused per-token or fleet-wide through a shared registry, which reverts every transfer, approval, and permit. During an issuer pause, vault deposits and redemptions cannot execute (the underlying transfer reverts) — even though the vault's own redemption path is never pausable.
- **Fleet-wide upgradeability.** Every stock token is a proxy behind one shared beacon and one shared implementation. The issuer can upgrade the implementation for the entire fleet in one transaction, changing any rule the tokens currently follow — transfer logic, fees, pause behavior, anything.
- **Admin burn.** The token exposes an admin burn (`adminBurn`) that removes tokens from any address and is not gated by the pause or the blocklist. A holder of the issuer's burn role can burn tokens held by the vault, the harvester, the treasury, or you.
- **Blocklist.** Transfers, approvals, and permits enforce an issuer-controlled address blocklist on both sides of every transfer. Addresses — including the deployed contracts — can be blocked by the issuer's registry.
- **Metadata control.** The issuer can rewrite a token's name and symbol.
- All issuer roles are held by issuer-operated addresses.

Depositing means accepting all of the above.

## Smart-contract risk

The vault, harvester, and timelock are new contracts with no operating history and no audit. Bugs in them can lose depositor funds irreversibly. The test suite and invariants (the repository's Foundry tests) reduce this risk; they do not eliminate it.

## Key risk — who can do what, with which keys

- The treasury timelock has **a single proposer key**: the Wellstreet deployer EOA. Only that key can schedule owner actions (fee changes within the cap, deposit pause, pause-role grants, treasury movements). Execution after the 48-hour delay is permissionless. That concentration is real, and the openness this project claims — open source, MIT, permissionlessly forkable — is a claim about the code, not about the keys.
- The same EOA holds a function-limited **pause-only authority** over deposits, revocable by the timelock.
- `MAX_FEE_BPS` (20%) is the **only structural bound** on fee escalation.
- That one EOA is therefore a total-compromise point: vault owner, treasury proposer, pause authority, token-launch creator wallet, LP seeder. The deployer key is required to be moved to a hardware wallet (or documented cold storage) before launch — until that happens and is documented, treat every privileged capability above as attached to a hot key. See [compliance.md](compliance.md).

## Jurisdictional posture

- **The protocol performs no jurisdictional blocking.** Nothing in the contracts, this repository, or its docs gates access by geography, IP address, or nationality, and nothing obliges a fork to add such a gate.
- **No lawful-anywhere representation.** The protocol makes no representation that access or use is lawful in any jurisdiction. Nothing here is directed at, or intended for access or use by, any person in a jurisdiction where distribution or use would be contrary to law or regulation. Knowing and following your own jurisdiction's rules is yours to do, not the protocol's to enforce.
- **Frontend operators set their own rules.** The canonical domain (**wellstreet.tech**), a mirror (reachable via **wellstreet.eth**, for example at wellstreet.eth.limo), or a fork's copy may each impose — or not impose — whatever access rules their operator chooses. Any such gate belongs to the operator serving it, not to the protocol or its contracts.
- **Geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure.** That line is carried here as pure disclosure, and it is the reason for the posture above: a block page does not settle the legal question, so the protocol makes no lawful-access claim rather than implying that a block line would.

## Yield risk

There is no yield certainty. Yield is swap-fee income, net of the pool's own protocol-fee cut and the vault's protocol fee; it scales with trading volume and with the harvester's share of pool liquidity, and it approaches zero when volume does. No figure anywhere in this project's docs is a projection, target, or promise. See [not-guaranteed.md](not-guaranteed.md) and [tokenomics.md](tokenomics.md).

## Token risk ($WELL)

$WELL is a launchpad token with automated buybacks funded by the creator fee share. A buyback is not a dividend and not a claim on revenue; holders benefit, if at all, through scarcity — a market outcome with no guarantee. See [tokenomics.md](tokenomics.md).
