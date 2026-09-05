# Wellstreet

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Wellstreet is an open-source yield-vault protocol on Robinhood Chain (chain ID 4663). Each vault is an ERC-4626 vault wrapping a tokenized stock token — for vault #1, the SPY token ("SPDR S&P 500 ETF Trust • Robinhood Token"). The yield does not come from the stock: a protocol-owned Harvester contract holds a liquidity position in the stock token's Uniswap V3 pool on the same chain, collects the swap fees that position earns, and pushes them into the vault without minting shares, so yield accrues pro-rata to existing depositors. A protocol fee on harvested yield (10% initially, hard-capped at 20% in code) flows to a treasury controlled by a 48-hour timelock.

This README is written to be checkable against the code, not to sell anything. Read [docs/public/not-guaranteed.md](docs/public/not-guaranteed.md) and [docs/public/risk-disclosure.md](docs/public/risk-disclosure.md) before using anything here.

## No company

There is no company and no foundation behind Wellstreet. The code is MIT-licensed and deploys from public source, and the admin surface is deliberately small: owner controls live behind a public 48-hour timelock — every proposal queued on-chain, readable by anyone for at least 48 hours before it can execute, executable by anyone after the delay — and the one other privileged key can only pause deposits and can be revoked by the timelock. No owner action takes effect immediately.

Running it yourself is a feature, not a fallback: fork the repository, deploy the same contracts from your own key, and you are running the same protocol — nothing on anyone's allowlist, no permission to ask. Walkthrough: [docs/public/run-it-yourself.md](docs/public/run-it-yourself.md).

## The contracts

| Contract | What it does |
|---|---|
| **Vault** (ERC-4626) | Wraps a tokenized stock token. Storage-based `totalAssets` (donations cannot move the share price), virtual share offset (first-depositor inflation defense), deposits pausable, withdrawals never pausable. Vault #1 share token: "Wellstreet SPY" (`ws-SPY`). |
| **Harvester** | Owns the protocol's LP position in the stock/WETH Uniswap V3 pool, collects swap fees, converts the non-stock leg to the stock token, and pushes the proceeds into the vault. `harvest()` is permissionless (0.1% caller tip, deducted from the protocol share). The LP principal is protocol capital, excluded from vault accounting. |
| **VaultFactory** | Permissionless creation of one canonical vault per asset, with an on-chain registry (`vaultOfAsset` / `allVaults()`) — no off-chain registry to trust. |
| **Treasury timelock** | 48-hour timelock controlling the treasury and the vault's owner parameters (fee within its cap, deposit pause, pause-role grants). Proposals are public on-chain; execution is permissionless after the delay. |

The repository also contains `HarvesterV4` (`src/HarvesterV4.sol`) and the factory's `createVaultV4` path — a second harvester implementation that manages liquidity directly against the chain's v4-fork PoolManager. It is in source and tests, not in the live deployment described below.

## Status

| Item | Status |
|---|---|
| Chain | Robinhood Chain (chain ID 4663) |
| Vault #1 asset | SPY — "SPDR S&P 500 ETF Trust • Robinhood Token" |
| Vaults live | 1 — ws-SPY (deployed 2026-09-03; the vault is currently empty, `totalAssets() == 0`) |
| Audited | NO. No third-party audit has been performed or scheduled. |
| $WELL (protocol token) | Not yet launched |
| License | MIT |

(Status reflects the repository as of 2026-09-05.)

## Contract addresses

Deployed on Robinhood Chain 4663 (broadcast 2026-09-03). Verify each on the block explorer at `robinhoodchain.blockscout.com` — these same addresses are pinned in [site/js/config.js](site/js/config.js) and in [skills/wellstreet-vaults/SKILL.md](skills/wellstreet-vaults/SKILL.md), and the factory registry lists exactly one vault:

| Contract | Address |
|---|---|
| Vault (ws-SPY) | `0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01` |
| Harvester | `0xe6c4502cfe17E99475a1B9C8511F47ea38a8A996` |
| VaultFactory | `0x07446D9807F90eD7ED177Ab63597e8BB4D96428f` |
| Treasury timelock | `0xD55bA510533dc5a250b4D6d49Ee825113DD69342` |
| $WELL token | Not launched — any token using the name is not this protocol |

## Repository layout

The Foundry project lives at the repository root (`foundry.toml`), not in a subdirectory.

```
src/            Contracts: YieldShares (the ERC-4626 vault), Harvester, HarvesterV4, VaultFactory, WellstreetTimelock
test/           Foundry test suite, including fork tests against live chain state
script/         Deployment script (Deploy.s.sol)
site/           Static frontend — zero dependencies, no build step; reads the chain directly from the browser
api/            Optional serverless caching/UX functions (the site never calls them; tests enforce this)
skills/         Agent surface: skills/wellstreet-vaults/SKILL.md — the machine-readable skill
site-tests/     Node test suite for the site
api-tests/      Node test suite for the api/ functions
docs/public/    The documentation (rendered by the site's docs tab)
.github/        CI: the forge suite and the node suite on every push and PR
```

## Running it yourself

Prerequisites: [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`), git, and Node (for the site/api test suites).

```bash
forge install
forge build    # expect: Compiler run successful
forge test     # expect: Suite result: ok

# Fork tests against real chain state (read-only, keyless public RPC):
WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
  forge test --match-path "test/**/*Fork*"

# Site and API test suites (quote the globs — on Node 23 the directory form fails):
node --test "site-tests/*.test.js" "api-tests/*.test.js"
```

Full walkthrough, including forking and deploying: [docs/public/run-it-yourself.md](docs/public/run-it-yourself.md).

## For AI agents

The canonical machine surface is the agent skill: [skills/wellstreet-vaults/SKILL.md](skills/wellstreet-vaults/SKILL.md) (the site mirrors it at `/skills/wellstreet-vaults.md`). It covers the keyless `cast` read battery for vault state, the approve/deposit/redeem flows with their fail-closed rules, the ratified backward-looking APR reporting rules, and the governance and risk facts. Two of its rules are absolute: treat the addresses pinned in the skill and in `site/js/config.js` as the only genuine contract addresses — any "ws-SPY" token at a different address is not this protocol — and never print a number that is not sourced from a contract read with its source and window attached. The vault is plain ERC-4626; the same contracts serve humans and agents.

## Domains and on-chain identity

- **wellstreet.tech** — the canonical web domain.
- **wellstreet.eth** — the canonical on-chain identity (ENS, Ethereum mainnet). The ENS text record `url` points to `https://wellstreet.tech`. The same site is mirrored to IPFS and reachable at `wellstreet.eth.limo` and natively in ENS-aware browsers.

Documentation cites `wellstreet.eth` as the canonical protocol identity.

## Risk

This is experimental software with no audit. The wrapped stock tokens are issued and administered by a third party that can pause transfers, upgrade the token fleet, and burn balances; those actions are outside this protocol's control. The protocol performs no jurisdictional blocking; you are responsible for complying with the law where you are. The full list is in [docs/public/risk-disclosure.md](docs/public/risk-disclosure.md).

Nothing here is investment advice.

## License

MIT — see [LICENSE](LICENSE).
