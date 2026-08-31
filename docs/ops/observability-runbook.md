# Wellstreet — Daily Owner Observability Runbook

INTERNAL — this file lives under `docs/ops/` (gitignored). Never committed.

**Cadence:** once per day (cron example below). Takes ~5 minutes.
**Tool:** `scripts/observability.sh` (committed, public, zero-dependency bash — curl + python3 only, reads public chain state, holds no keys).

## Setup (once)

Export the addresses after the on-chain deploy (values land in
`site/js/config.js` and the deploy tx receipts). Until then the script runs
in degraded mode and lists every unconfigured check — that is its correct
pre-deploy behavior.

```bash
cat > $HOME/.wellstreet/observability.env <<'EOF'
export WELLSTREET_RPC_URL="https://rpc.mainnet.chain.robinhood.com"
export WELLSTREET_RPC_FALLBACK="https://robinhoodchain.blockscout.com/api/eth-rpc"
export WELLSTREET_CHAIN_ID="4663"
export WELLSTREET_VAULT_ADDRESS="PENDING_DEPLOY"
export WELLSTREET_HARVESTER_ADDRESS="PENDING_DEPLOY"
export WELLSTREET_TREASURY_ADDRESS="PENDING_DEPLOY"
export WELLSTREET_TIMELOCK_ADDRESS="PENDING_DEPLOY"
export WELLSTREET_POOL_ADDRESS="0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e"
export WELLSTREET_SPY_ADDRESS="0x117cc2133c37b721f49de2a7a74833232b3b4c0c"
export WELLSTREET_BLOCK_REGISTRY_ADDRESS="PENDING_DEPLOY"
export WELLSTREET_EXPECTED_FEE_BPS="1000"
export WELLSTREET_EXPECTED_FEE_PROTOCOL="0x44"
export WELLSTREET_SITE_URL="https://wellstreet.tech"
export WELLSTREET_GITHUB_REPO="wellstreettech/wellstreet"
EOF
```

## Daily check

```bash
. "$HOME/.wellstreet/observability.env" && bash scripts/observability.sh
echo "exit=$?"   # 0 = all green; nonzero = at least one check failed
```

Cron (daily 09:00 UTC), with output to a dated log:

```
0 9 * * * . "$HOME/.wellstreet/observability.env" && bash $HOME/Documents/wellstreet/scripts/observability.sh >> $HOME/.wellstreet/observability.log 2>&1
```

The dot-form `. "$HOME/..."` is POSIX and works under the default `sh` crontab; if your
crontab sets `SHELL=/bin/bash`, the bashism `source $HOME/.wellstreet/observability.env` works too.

## What each failure means, and what to do

| Check | Failure meaning | Action |
|---|---|---|
| Vault TVL / totalSupply / pricePerShare reads fail | RPC issue, or the vault is broken/unexpectedly self-destructed | Retry on `WELLSTREET_RPC_FALLBACK`; if both fail AND the site is down, treat as an incident |
| `pricePerShare` dropped vs yesterday | Withdrawals exceeded credited yield, or an accounting anomaly | STOP — recompute manually from `totalAssets`/`totalSupply`; check recent Withdrawal events before touching anything |
| Harvest stale (no `Harvested` event within `WELLSTREET_HARVEST_STALE_HOURS`) | No fees accrued (quiet market — benign), position out of range, or harvest blocked | Check the position via the NPM; call `harvest()` manually once (permissionless) and watch the revert reason if it fails |
| `protocolAccrued` growing large | Sweeps not happening | Call `sweepToTreasury()` (permissionless) or note for the timelock queue |
| SPY `paused() == 1` | **Issuer action** — outside our control; deposits/harvest will halt, withdrawals may still work | Disclose on the site immediately (honest voice); check whether transfers work at all before saying more |
| Pool `feeProtocol != 0x44` | **Factory owner changed the pool fee cut** (owner-settable — audit F-02/standing caveat) | Recompute the net-APR math with the new cut; update `WELLSTREET_EXPECTED_FEE_PROTOCOL`; if the site quotes APR, update the formula inputs |
| Timelock: unexpected queued call | Someone (the proposer) queued a parameter change | It is public by design — review the target+calldata, wait 48h, decide whether to let it execute (executor is open — anyone can execute or decline to) |
| Site `/` or `/api/health` down | Vercel/RPC issue | `vercel ls` from the repo (cd INSIDE the repo dir); check GitHub Actions CI |
| CI red on `wellstreettech/wellstreet` | Repo drift | Run `forge test` locally; fix before any deploy |

## Known transport caveats

- **RH public RPC Cloudflare-challenges heavy consumers** (403 "Just a moment…" at
  `createSelectFork` after sustained fork/getLogs use — hit 2026-08-31). The script's
  bounded scans (`WELLSTREET_SCAN_CHUNK`, `WELLSTREET_MAX_SCAN_CALLS`) are sized to stay
  under it; if challenged anyway, switch `WELLSTREET_RPC_URL` to the dedicated paid
  endpoint (`WELLSTREET_ROBINHOOD_RPC_URL` from the fresh Alchemy account — spec K).
- **Blockscout eth-rpc** rate-limits per IP — it is the fallback, not the primary.
- Blockscout REST (fleet/token pages) needs a **browser-like User-Agent** — plain UA gets 403.

## Soak-day criteria (v1.1 map W4)

A **soak day counts** ONLY when ALL of:
1. `scripts/observability.sh` exits 0 **AND** reports zero `[FAIL]` lines — bare exit 0
   pre-deploy is free (every unconfigured check reports `[MISS]`) and does NOT count;
2. the site-facing checks are green: (f) site `/` + `/api/health` probes AND
   (g) CI status **CONFIGURED and [PASS]**;
3. check (g)'s prerequisite holds: gh authenticated as the Wellstreet identity
   (`gh auth status` shows `wellstreettech`, never a shared account) — if it regresses,
   (g) reports MISS every day and the window silently degenerates to date-watching.

A red/incident day **extends** the window; the end is user-gated regardless of elapsed dates.

## Escalation

Anything in the STOP rows above: pause new deposits via the timelock or the pause-only
EOA (deposits only — redemptions are never pausable by design), post the honest state on
the site, and only then investigate further. The protocol's own controls can never trap
user funds; do not improvise mechanisms that could.
