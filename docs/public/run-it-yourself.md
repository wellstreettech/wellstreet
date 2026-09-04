# Run it yourself

Everything here runs from the repository. If the Foundry project lives in `contracts/`, run the forge commands from there; if it lives at the repository root, run them from there. If a file name in this document does not match the repository, the repository is authoritative — this document is corrected in the same change that renames anything.

## Prerequisites

- [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`):

  ```bash
  curl -L https://foundry.paradigm.xyz | bash && foundryup
  ```

- git. Nothing else — no API key is needed for tests (the public RPC is read-only and keyless).

## External on-chain facts used by the tests

These are public chain facts on Robinhood Chain (chain ID 4663), verifiable on the block explorer:

| Fact | Value |
|---|---|
| Chain ID | 4663 |
| Public RPC (read-only, keyless) | `https://rpc.mainnet.chain.robinhood.com` |
| Block explorer | `https://robinhoodchain.blockscout.com` |
| Wrapped asset (vault #1) | SPY — "SPDR S&P 500 ETF Trust • Robinhood Token" — `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` |
| SPY/WETH Uniswap V3 pool (fee tier 500) | `0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e` |

## 1. Build

```bash
forge install    # installs dependencies as git submodules
forge build
```

Expected: `Compiler run successful`.

## 2. Test (no network)

```bash
forge test
```

Expected: every test line reports `[PASS]`, ending with a `Suite result: ok` summary. The suite covers the protocol invariants — donation neutrality, first-depositor inflation defense, fee-on-transfer deposit rejection, skim protection, harvester-only yield, redemption never pausable, the fee cap, and the timelock behavior.

## 3. Fork tests (real chain state)

Fork tests read live state from chain 4663 through one environment variable, `WELLSTREET_ROBINHOOD_RPC_URL` — the same single name CI uses as its fork-RPC secret:

```bash
export WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
forge test --match-path "test/**/*Fork*"
```

Expected: the fork suites pass against live chain state (pool identity, token behavior, and price-feed reads are the live facts under test). Any equivalent read-only RPC for chain 4663 works.

Conventions the suite follows, so you can predict what tests touch:

- ERC-20 balances are obtained by `vm.prank` from a known on-chain holder — never by storage-slot writes (`deal()` on ERC-20 storage slots is banned in this suite as fragile).
- Native ETH for test addresses comes from `vm.deal`.

## 4. Deploy (local first)

Dry-run against a local node before touching a real key:

```bash
anvil    # terminal 1 — local chain on http://localhost:8545

forge script script/Deploy.s.sol \
  --rpc-url http://localhost:8545 \
  --broadcast    # terminal 2 — the deploy entry point is the Foundry script in script/
```

Expected: the script's logs list each deployed contract (vault, harvester, treasury timelock) and the share-token name and symbol. Sanity-check the results against the deploy parameters: the vault owner, the protocol fee (must be at or below the 20% cap), and the timelock delay (48 hours).

## 5. Deploy (real chain)

1. Fund a dedicated deployer EOA with a small amount of the chain's native token. Use a **fresh key dedicated to this protocol** — not a key that has ever signed anything else. Keep the key in an environment variable, never inline in shell history. Key-custody commitment: [compliance.md](compliance.md).
2. Simulate, then broadcast:

   ```bash
   export WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com
   forge script script/Deploy.s.sol \
     --rpc-url $WELLSTREET_ROBINHOOD_RPC_URL \
     --broadcast
   ```

3. Record the printed addresses. The canonical deployment's addresses are pinned in `site/js/config.js` (and in [guarantees.md](guarantees.md)); for your own fork, record your printed addresses in your repository's README before relying on them.
4. Verify the deployed sources on the block explorer and compare them against this repository at the deployed commit. If a deployed contract's source does not match the repository, stop and treat the deployment as untrusted.

## 6. Interacting (cast)

Read-side examples (after a real deploy, substitute the addresses from the README):

```bash
RPC=$WELLSTREET_ROBINHOOD_RPC_URL
cast call $VAULT 'totalAssets()(uint256)' --rpc-url $RPC
cast call $VAULT 'totalSupply()(uint256)' --rpc-url $RPC
cast call $VAULT 'convertToAssets(1000000000000000000)(uint256)' --rpc-url $RPC
cast call $VAULT 'paused()(bool)' --rpc-url $RPC
```

## CI

CI runs `forge test` (including the fork tests) with `WELLSTREET_ROBINHOOD_RPC_URL` as the single fork-RPC secret name. A green CI run and a green local `forge test` are the same suite.
