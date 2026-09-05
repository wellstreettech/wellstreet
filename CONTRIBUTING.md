# Contributing

One rule here outranks everything else, so it comes first.

## The zero-marketing rule

Documentation and comments in this repository are written to be checkable against the code, not to sell anything.

- No promotional language anywhere: no superlatives, no "the future of", no projected returns, no yield targets, no price talk.
- Every claim in the docs must be verifiable from the code, the test suite, or on-chain state. If a sentence cannot be checked, delete it.
- Comments describe what the code does — including its limits and failure modes — not what it aspires to do. A comment that does not match the code is a bug.
- Measured numbers belong in a reproducible script plus its evidence file, never in copy. PRs that add performance or yield claims to docs are rejected.
- If you find a doc claim the code does not support, a PR correcting it is the most valuable contribution possible.

## Setup

The Foundry project lives at the repository root (`foundry.toml`), not in a subdirectory.

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup   # Foundry (forge, cast)
forge install
forge build
```

## Tests

There are two independent suites, and CI runs both on every push and PR (`.github/workflows/ci.yml`):

**Forge suite** — contracts, including fork tests against live chain state. Fork tests need `WELLSTREET_ROBINHOOD_RPC_URL` set to any read-only RPC for chain 4663 (the keyless public RPC works: `https://rpc.mainnet.chain.robinhood.com`). Locally the fork suites self-skip when the variable is unset; in CI a skip fails the job.

```bash
WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com forge test
```

**Node suite** — `site-tests/` (the static site) and `api-tests/` (the serverless functions). No `npm install`, no build step: the site is deliberately dependency-free, so plain `node --test` is the whole toolchain. Node 23 is what CI pins.

```bash
node --test "site-tests/*.test.js" "api-tests/*.test.js"
```

Quote the globs. On Node 23.3.0 the directory form (`node --test site-tests api-tests`) fails red before a single test runs — node treats each directory as a test file and reports `test failed` for both — and an unquoted glob depends on your shell expanding it (a shell that passes the literal pattern gets the same red). The quoted-glob form is the canonical command; CI runs exactly it.

Do not add a package manager, bundler, or build step to `site/`. Dependency-free and no-build is a stated property of this repository, not an accident.

## Pull-request flow

1. Fork the repository and create a branch.
2. Make the change.
3. **Both suites must pass green** — full `forge test` and the full node suite (commands above). CI runs the same commands; a PR that does not pass them will not be merged.
4. Open a PR stating: what changed, why, and how a reviewer can verify it (commands plus expected output).
5. Keep PRs scoped to one logical change.

## Style

- Solidity: run `forge fmt`; keep functions small and named after what they do.
- Honest comments: state what the code does and what it cannot do. Failure modes are documented, not hidden.
- Docs (`docs/public/`): plain language, no superlatives, honest about limits. The docs and the tests are two renderings of the same spec — if they disagree, fix both in the same PR.
- No secrets, keys, or private endpoints in any committed file.

## Licensing

By contributing, you agree that your contributions are licensed under the MIT License (see [LICENSE](LICENSE)).
