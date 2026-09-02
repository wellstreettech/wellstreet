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

## Underlying-market risk — how alive is the token we wrap?

`redeem()` is 1:1 in the stock token and never pausable — but 1:1 redemption only
converts your deposit into MORE of the wrapped token. The exit to spendable value
runs through that token's own transfer market: for vault #1, a single
fee-tier SPY/WETH pool. A token can carry a large headline value while its
transfer market is thin, illiquid, or concentrated among a few holders — value at
rest says nothing about market health.

The protocol measures the underlying's transfer-market risk with an explainable
composite (after arXiv:2605.29689): a liquidity dimension (turnover, active-address
ratio, transfer intensity, average transfer size), a concentration dimension
(holder count, average value per holder, a wallet-level Herfindahl index), and a
market-quality dimension — computed over a 30-day window and min-max normalized
against a pinned peer universe, so the numbers are comparable only within that
universe and shift if it changes. Measured 2026-09-02: the concentration dimension
reads 0.00 for both vault candidates against the pinned universe (SPY 49,605
holders, wallet-level HHI 0.236; NVDA 90,964 holders, HHI 0.145 at 98–99% supply
coverage), and the 30-day transfer-market dimensions were NOT computable from
public keyless data at these tokens' transfer volumes — they are reported as not
computable, never filled with a placeholder.

Two things stay true regardless of any score: the score is informational only —
it gates nothing in the contracts (no deposit caps, no fee logic, no pause
conditions key on it) — and the structural exit-concentration point stands on its
own: whatever the holder statistics say, the swap leg of your redemption is one
pool on one chain.

## Incident response — what happens after something goes wrong

There is no emergency response that moves fast and also touches your funds — by
design, the two are in tension and this protocol resolves it toward you:

- **Detection** is the slow path by design: every owner action is visible on-chain
  for a full 48 hours before it can execute, and the daily operator check watches
  vault backing, harvest activity, treasury accrual, and the underlying token's
  pause state. There is no public mempool on this chain, so nothing can be seen
  before inclusion — detection is post-inclusion, and that limit is disclosed
  rather than papered over.
- **Response** to a live incident is a deposit pause (the treasury timelock, or the
  function-limited pause-only key in minutes). That is the entire fast-path
  authority. Redemptions cannot be paused by anyone — an incident cannot be
  answered by trapping your funds.
- **Recovery** of any misbehaving component (harvester custody, fee policy, pause
  role) goes through the public 48-hour timelock queue, executable by anyone after
  the delay.
- For context from the incident literature (arXiv:2208.13035 — 181 incidents,
  2018–2022): 47.5% of victims support an emergency pause, and of those only 58.6%
  actually paused within 48h — only one within the first hour. A protocol whose
  only fast lever is a deposit pause (and whose redemptions are structurally
  unpausable) does not depend on reacting faster than that record suggests anyone
  manages to.

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

## The harvester LP principal bears predictable loss (LVR) — on top of WETH price risk

An LP position loses value to arbitrageurs whenever the pool's price trails an
external reference price — the predictable loss (PL) sometimes called LVR. The
protocol's LP position is treasury capital (excluded from depositor accounting),
so this loss never touches depositor assets — but the treasury's own capital
bears it, on top of the impermanent loss and WETH price risk already disclosed.

The quantified form: for a full-range position the expected predictable-loss
rate is σ̂²/8 of position value per year, where σ̂ is the pool's annualized
volatility (arXiv:2309.08431, Eq. 9 full-range limit). The measured σ̂ of the
SPY/WETH pool's own marginal price is ≈53% annualized (measured 2026-09-02 over
the pool's swap-event stream), which puts the expected predictable loss at
**≈ σ̂²/8 ≈ 3.5%/yr** — a risk figure, not a yield figure, and not a promise
about any year's actual loss. The method (including what a reference price can
and cannot resolve for a tokenized-stock pair whose canonical feed updates only
a few times a day) is described in [methodology.md](methodology.md).

One directional point specific to this chain: Robinhood Chain blocks are
~100ms, and across the pools studied in arXiv:2404.05803, 100ms block times cut
arbitrage losses 20–70% relative to Ethereum's 12s — faster blocks give
arbitrageurs less stale price to harvest. Two honest caveats: the sub-1-second
regime is the weakest-evidence part of that paper's model, and a tokenized-stock
pool whose canonical price feed freezes off-hours sits outside that model
entirely. The 20–70% range is directional context from crypto pairs, not a
Wellstreet measurement.

## Token risk ($WELL)

$WELL is a launchpad token with automated buybacks funded by the creator fee share. A buyback is not a dividend and not a claim on revenue; holders benefit, if at all, through scarcity — a market outcome with no guarantee. See [tokenomics.md](tokenomics.md).
