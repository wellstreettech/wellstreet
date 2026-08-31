# Wellstreet

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Wellstreet is an open-source yield-vault protocol on Robinhood Chain (chain ID 4663). Each vault is an ERC-4626 vault wrapping a tokenized stock token — for vault #1, the SPY token ("SPDR S&P 500 ETF Trust • Robinhood Token"). The yield does not come from the stock: a protocol-owned Harvester contract holds a liquidity position in the stock token's Uniswap V3 pool on the same chain, collects the swap fees that position earns, and pushes them into the vault without minting shares, so yield accrues pro-rata to existing depositors. A protocol fee on harvested yield (10% initially, hard-capped at 20% in code) flows to a treasury controlled by a 48-hour timelock.

This README is written to be checkable against the code, not to sell anything. Read [docs/public/not-guaranteed.md](docs/public/not-guaranteed.md) and [docs/public/risk-disclosure.md](docs/public/risk-disclosure.md) before using anything here.

## The three contracts

| Contract | What it does |
|---|---|
| **Vault** (ERC-4626) | Wraps a tokenized stock token. Storage-based `totalAssets` (donations cannot move the share price), virtual share offset (first-depositor inflation defense), deposits pausable, withdrawals never pausable. Vault #1 share token: "Wellstreet SPY" (`ws-SPY`). |
| **Harvester** | Owns the protocol's LP position in the stock/WETH Uniswap V3 pool, collects swap fees, converts the non-stock leg to the stock token, and pushes the proceeds into the vault. `harvest()` is permissionless (0.1% caller tip, deducted from the protocol share). The LP principal is protocol capital, excluded from vault accounting. |
| **Treasury timelock** | 48-hour timelock controlling the treasury and the vault's owner parameters (fee within its cap, deposit pause, pause-role grants). Proposals are public on-chain; execution is permissionless after the delay. |

## Status

| Item | Status |
|---|---|
| Chain | Robinhood Chain (chain ID 4663) |
| Vault #1 asset | SPY — "SPDR S&P 500 ETF Trust • Robinhood Token" |
| Vaults live | 0 — first deploy pending |
| Audited | NO. No third-party audit has been performed or scheduled. |
| $WELL (protocol token) | Not yet launched |
| License | MIT |

(Status reflects the repository as of 2026-08-30.)

## Contract addresses

All addresses below are `PENDING_DEPLOY` until the first broadcast; once deployed they are verifiable on the block explorer.

| Contract | Address |
|---|---|
| Vault (ws-SPY) | `PENDING_DEPLOY` |
| Harvester | `PENDING_DEPLOY` |
| Treasury timelock | `PENDING_DEPLOY` |
| $WELL token | `PENDING_DEPLOY` — not launched |

## Repository layout

```
contracts/    Foundry project: vault, harvester, treasury timelock + test suite
site/         Frontend (static-capable; reads the chain directly)
api/          Optional caching/UX serverless functions (never a dependency)
docs/public/  The documentation (rendered by the site's docs tab)
```

## Running it yourself

Prerequisites: [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`) and git.

```bash
cd contracts
forge install
forge build    # expect: Compiler run successful
forge test     # expect: Suite result: ok

# Fork tests against real chain state (read-only, keyless public RPC):
WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
  forge test --match-path "test/**/*Fork*"
```

If the Foundry project lives at the repository root instead of `contracts/`, run the forge commands from there. Full walkthrough, including forking and deploying: [docs/public/run-it-yourself.md](docs/public/run-it-yourself.md).

## Domains and on-chain identity

- **wellstreet.tech** — the canonical web domain.
- **wellstreet.eth** — the canonical on-chain identity (ENS, Ethereum mainnet). The ENS text record `url` points to `https://wellstreet.tech`. The same site is mirrored to IPFS and reachable at `wellstreet.eth.limo` and natively in ENS-aware browsers.

Documentation cites `wellstreet.eth` as the canonical protocol identity.

## Risk

This is experimental software with no audit. The wrapped stock tokens are issued and administered by a third party that can pause transfers, upgrade the token fleet, and burn balances; those actions are outside this protocol's control. Geographic access restrictions apply on the canonical domain. The full list is in [docs/public/risk-disclosure.md](docs/public/risk-disclosure.md).

Nothing here is investment advice.

## License

MIT — see [LICENSE](LICENSE).
