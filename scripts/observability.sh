#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Wellstreet — daily owner observability check (read-only, zero dependencies)
#
# Runs checks (a)-(h) against Robinhood Chain 4663 and the deployed site:
#   (a) vault TVL / totalSupply / pricePerShare (storage-based accounting)
#   (b) harvester last-harvest (bounded Harvested event scan)
#   (c) treasury accrual (protocolAccrued + Swept events + treasury balance)
#   (d) underlying SPY issuer state (paused()/tokenPaused()/registry pause/blocks)
#   (e) pool feeProtocol word re-check (drift detector; expected 0x44 = (4,4))
#   (f) site + /api/health probes
#   (g) GitHub Actions CI status
#   (h) timelock queue visibility (CallQueued / CallExecuted / CallCancelled)
#
# Requirements: bash + curl + python3 ONLY (no jq, no cast, no npm, no foundry).
# Safety: READ-ONLY. The only JSON-RPC methods used are eth_chainId,
#         eth_blockNumber, eth_call, eth_getLogs, eth_getBlockByNumber.
#         This script never signs, sends, or estimates a transaction, and it
#         contains no keys, tokens, or secrets (it only reads public state).
#
# Cron (daily 09:00 UTC):
#   CRON_TZ=UTC 0 9 * * * . "$HOME/.wellstreet/observability.env" && \
#     /path/to/wellstreet/scripts/observability.sh >> "$HOME/.wellstreet/observability.log" 2>&1
#   (before deploy the env file is optional — every unconfigured check reports
#    [MISS] and the run still exits 0; see "Exit codes" below)
#
# Exit codes:
#   0 — no FAIL this run (checks PASSed, were WARNed, or were not configured)
#   1 — at least one check FAILED -> escalate the same day (see runbook:
#       docs/ops/observability-runbook.md, "Escalation")
#   2 — environment error (curl or python3 missing)
#
# Statuses: [PASS] healthy · [FAIL] act today · [WARN] investigate ·
#           [MISS] address not configured yet (PENDING_DEPLOY) · [INFO] context
#
# See docs/ops/observability-runbook.md (internal, local-only) for the full
# procedure, expected values, and per-check remediation steps.
# ---------------------------------------------------------------------------

set -u -o pipefail

# ----------------------------- configuration -------------------------------
# All knobs are environment variables with safe defaults. Addresses for the
# vault / harvester / timelock stay unset until the contracts are deployed
# (site/js/config.js carries the PENDING_DEPLOY placeholders until then).

RPC_PRIMARY="${WELLSTREET_RPC_URL:-https://rpc.mainnet.chain.robinhood.com}"
RPC_FALLBACK="${WELLSTREET_RPC_FALLBACK:-https://robinhoodchain.blockscout.com/api/eth-rpc}"
CHAIN_ID_EXPECTED="${WELLSTREET_CHAIN_ID:-4663}"
HTTP_TIMEOUT="${WELLSTREET_HTTP_TIMEOUT:-30}"

SPY_ADDRESS="${WELLSTREET_SPY_ADDRESS:-0x117cc2133c37B721F49dE2A7a74833232B3B4C0C}"
POOL_ADDRESS="${WELLSTREET_POOL_ADDRESS:-0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e}"
BLOCK_REGISTRY="${WELLSTREET_BLOCK_REGISTRY_ADDRESS:-0xe10b6f6b275de231345c20d14ab812db62151b00}"

VAULT_ADDRESS="${WELLSTREET_VAULT_ADDRESS:-}"
HARVESTER_ADDRESS="${WELLSTREET_HARVESTER_ADDRESS:-}"
TIMELOCK_ADDRESS="${WELLSTREET_TIMELOCK_ADDRESS:-}"
TREASURY_ADDRESS="${WELLSTREET_TREASURY_ADDRESS:-}"

SITE_URL="${WELLSTREET_SITE_URL:-https://www.wellstreet.tech}"
GITHUB_REPO="${WELLSTREET_GITHUB_REPO:-wellstreettech/wellstreet}"

LOOKBACK_HOURS="${WELLSTREET_LOOKBACK_HOURS:-24}"            # event-scan window
HARVEST_STALE_HOURS="${WELLSTREET_HARVEST_STALE_HOURS:-72}"  # (b) escalation threshold
SCAN_CHUNK="${WELLSTREET_SCAN_CHUNK:-50000}"                 # getLogs chunk (blocks)
MAX_SCAN_CALLS="${WELLSTREET_MAX_SCAN_CALLS:-40}"            # per-scan call budget
EXPECTED_FEE_PROTOCOL="${WELLSTREET_EXPECTED_FEE_PROTOCOL:-0x44}" # packed (4,4)
EXPECTED_FEE_BPS="${WELLSTREET_EXPECTED_FEE_BPS:-1000}"      # initial 10% (cap 2000)

# treat literal placeholders as unset
unset_placeholder() {
  local v="${!1:-}"
  case "$v" in "" | "PENDING_DEPLOY" | "PENDING_IDENTITY") return 1 ;; esac
  return 0
}

# ------------------------------- helpers -----------------------------------
PASS_COUNT=0; FAIL_COUNT=0; WARN_COUNT=0; MISS_COUNT=0
FALLBACK_USED=0

say() { printf '%s\n' "$*"; }
section() { say ""; say "== $* =="; }
record() { # record STATUS "id" "message"
  local st="$1" id="$2" msg="$3"
  say "[$st] $id $msg"
  case "$st" in
    PASS) PASS_COUNT=$((PASS_COUNT + 1)) ;;
    FAIL) FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    WARN) WARN_COUNT=$((WARN_COUNT + 1)) ;;
    MISS) MISS_COUNT=$((MISS_COUNT + 1)) ;;
  esac
}
miss_if_unset() { # miss_if_unset VARNAME id description -> rc 1 when unset
  if ! unset_placeholder "$1"; then
    record MISS "$2" "$3 — not configured yet (expected while addresses are PENDING_DEPLOY)"
    return 1
  fi
  return 0
}

hex_of() { printf '0x%x' "$1" 2>/dev/null || printf '0x0'; }

# reads the HTTP body on stdin (piped), not an argument
is_json_rpc() { python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
sys.exit(0 if isinstance(d, dict) and ("result" in d or "error" in d) else 1)'; }

# rpc_call METHOD PARAMS_JSON -> echoes raw body on stdout, rc 0 ok / 1 transport
rpc_call() {
  local method="$1" params="$2" body ep attempt
  local payload="{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$method\",\"params\":$params}"
  local endpoints="$RPC_PRIMARY"
  [ -n "$RPC_FALLBACK" ] && endpoints="$endpoints $RPC_FALLBACK"
  for ep in $endpoints; do
    for attempt in 1 2; do
      body=$(curl -sS -m "$HTTP_TIMEOUT" -X POST -H 'Content-Type: application/json' \
                   -d "$payload" "$ep" 2>/dev/null) || body=""
      if [ -n "$body" ] && printf '%s' "$body" | is_json_rpc; then
        printf '%s' "$body"
        [ "$ep" = "$RPC_PRIMARY" ] || FALLBACK_USED=$((FALLBACK_USED + 1))
        return 0
      fi
      sleep 1
    done
  done
  return 1
}

# ethcall TO DATA
#   rc 0 -> RET = result hex
#   rc 2 -> JSON-RPC error (revert / panic); ERR_MSG / ERR_DATA set
#   rc 1 -> transport failure (both endpoints)
RET=""; ERR_MSG=""; ERR_DATA=""
ethcall() {
  local to="$1" data="$2" body parsed kind
  RET=""; ERR_MSG=""; ERR_DATA=""
  if ! body=$(rpc_call eth_call "[{\"to\":\"$to\",\"data\":\"$data\"},\"latest\"]"); then
    return 1
  fi
  parsed=$(printf '%s' "$body" | python3 -c '
import sys, json
d = json.load(sys.stdin)
if "error" in d:
    e = d.get("error") or {}
    sys.stdout.write("E\t" + str(e.get("message", "")) + "\t" + str(e.get("data", "")))
else:
    sys.stdout.write("R\t" + str(d.get("result", "")))') || return 1
  kind="${parsed%%$'\t'*}"
  parsed="${parsed#*$'\t'}"
  if [ "$kind" = "R" ]; then RET="$parsed"; return 0; fi
  ERR_MSG="${parsed%%$'\t'*}"
  ERR_DATA="${parsed#*$'\t'}"
  [ "$ERR_DATA" = "$ERR_MSG" ] && ERR_DATA=""
  return 2
}

# word DEC_INDEX HEXRESULT -> decimal value of the 32-byte word at that index
word() { python3 -c '
import sys
h = sys.argv[2].lower().removeprefix("0x")
i = int(sys.argv[1])
w = h[i * 64:(i + 1) * 64]
print(int(w, 16) if w else 0)' "$1" "$2" 2>/dev/null || echo 0; }

# words_count HEXRESULT -> number of complete 32-byte words
words_count() { python3 -c '
import sys
h = sys.argv[1].lower().removeprefix("0x")
print(len(h) // 64)' "$1" 2>/dev/null || echo 0; }

# addr_of HEXRESULT -> last 40 hex chars of a single-address return value
addr_of() { printf '0x%s' "$(printf '%s' "$1" | tail -c 40)"; }

# to_units HEXORDEC DECIMALS -> decimal string (integer math, no floats)
to_units() { python3 -c '
import sys
s = str(sys.argv[1])
v = int(s, 16) if s.lower().startswith("0x") else int(s)
d = int(sys.argv[2])
t = str(v).rjust(d + 1, "0")
frac = t[-d:].rstrip("0") or "0"
print(t[:-d] + "." + frac)' "$1" "$2" 2>/dev/null || echo "?"; }

# block_ts_iso HEXBLOCK -> UTC timestamp of a block via eth_getBlockByNumber
block_ts_iso() {
  local body ts
  body=$(rpc_call eth_getBlockByNumber "[\"$1\",false]") || { echo "?"; return; }
  ts=$(printf '%s' "$body" | python3 -c '
import sys, json, time
try:
    d = json.load(sys.stdin)
    print(time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime(int(d["result"]["timestamp"], 16))))
except Exception:
    print("?")')
  echo "${ts:-?}"
}

# lookback_blocks HOURS -> block count at the phase-0 measured 101.1 ms/block
lookback_blocks() { python3 -c 'import sys; print(int(float(sys.argv[1]) * 3600 / 0.1011))' "$1"; }

# scan_logs ADDRESS TOPIC0 LOOKBACK_BLOCKS [STOP_ON_FIRST(0/1)]
# Bounded, newest-first eth_getLogs scan (chunked; halves the chunk on RPC
# timeout / error; backs off on rate limits; stops at a per-scan call budget).
# RH public RPC times out on wide ranges ("log query timed out" observed on a
# 6h window at ~101ms blocks) and rate-limits rapid-fire calls — never replace
# this with one wide getLogs call. NOTE the params ARRAY wrapping.
# STOP_ON_FIRST=1 stops at the newest chunk containing events (last-harvest).
# Sets: SCAN_HITS, SCAN_INCOMPLETE, SCAN_ERRMSG, LATEST_BLOCK_DEC, LATEST_TX,
#       LATEST_DATA
scan_logs() {
  local addr="$1" topic="$2" lookback="$3" stop_first="${4:-0}"
  local from_min=$((LATEST_DEC - lookback + 1)); [ "$from_min" -lt 1 ] && from_min=1
  local chunk="$SCAN_CHUNK" to="$LATEST_DEC" frm calls=0 halvings=0 body parsed
  local n bn tx dt tfilter pace="${SCAN_PACE_SEC:-1.5}"
  SCAN_HITS=0; SCAN_INCOMPLETE=0; SCAN_ERRMSG=""; LATEST_BLOCK_DEC=""; LATEST_TX=""; LATEST_DATA=""
  [ "$to" -lt "$from_min" ] && return 0
  while [ "$to" -ge "$from_min" ]; do
    frm=$((to - chunk + 1)); [ "$frm" -lt "$from_min" ] && frm="$from_min"
    tfilter="null"; [ -n "$topic" ] && tfilter="\"$topic\""
    [ "$calls" -gt 0 ] && sleep "$pace"
    local ok=0
    if body=$(rpc_call eth_getLogs "[{\"fromBlock\":\"$(hex_of "$frm")\",\"toBlock\":\"$(hex_of "$to")\",\"address\":\"$addr\",\"topics\":[$tfilter]}]"); then
      calls=$((calls + 1))
      parsed=$(printf '%s' "$body" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    print("PARSE_ERR\tunreadable response")
    sys.exit(0)
if "error" in d:
    e = d.get("error") or {}
    print("RPC_ERR\t" + str(e.get("message", "unknown RPC error")))
    sys.exit(0)
logs = d.get("result", [])
if not isinstance(logs, list):
    print("PARSE_ERR\tresult is not a log array")
    sys.exit(0)
n = len(logs)
if n == 0:
    print("OK\t0\t\t\t")
else:
    l = logs[-1]  # logs arrive in ascending block order; the last is the newest
    print("\t".join(["OK", str(n), str(int(l.get("blockNumber", "0x0"), 16)),
                     str(l.get("transactionHash", "")), str(l.get("data", ""))]))')
      case "$parsed" in
        OK*)
          n=0; bn=""; tx=""; dt=""
          IFS=$'\t' read -r _ n bn tx dt <<< "$parsed"
          SCAN_HITS=$((SCAN_HITS + n))
          if [ "$n" -gt 0 ] && [ -z "$LATEST_BLOCK_DEC" ]; then
            LATEST_BLOCK_DEC="$bn"; LATEST_TX="$tx"; LATEST_DATA="$dt"
            [ "$stop_first" = "1" ] && return 0
          fi
          if [ "$calls" -ge "$MAX_SCAN_CALLS" ]; then SCAN_INCOMPLETE=1; return 0; fi
          to=$((frm - 1))
          ok=1
          SCAN_ERRMSG="" ;;
        *)
          SCAN_ERRMSG="${parsed#*"$'\t'"}"
          ok=0 ;;
      esac
    fi
    if [ "$ok" != "1" ]; then
      # transport failure OR RPC error (-32000 "log query timed out" -> shrink;
      # 429 "Too Many Requests" -> the sleep below is the backoff)
      halvings=$((halvings + 1))
      if [ "$halvings" -ge 4 ] || [ "$chunk" -le 1200 ]; then SCAN_INCOMPLETE=1; return 0; fi
      chunk=$((chunk / 2))
      sleep 4
    fi
  done
  return 0
}

# classify_timelock_logs LOOKBACK_BLOCKS (all timelock events, no topic filter)
# Sets: TL_QUEUED TL_EXECUTED TL_CANCELLED TL_QUEUED_INFO TL_INCOMPLETE TL_ERRMSG
classify_timelock_logs() {
  local lookback="$1"
  local from_min=$((LATEST_DEC - lookback + 1)); [ "$from_min" -lt 1 ] && from_min=1
  local chunk="$SCAN_CHUNK" to="$LATEST_DEC" frm calls=0 halvings=0 body summary
  local pace="${SCAN_PACE_SEC:-1.5}"
  TL_QUEUED=0; TL_EXECUTED=0; TL_CANCELLED=0; TL_QUEUED_INFO=""; TL_INCOMPLETE=0; TL_ERRMSG=""
  while [ "$to" -ge "$from_min" ]; do
    frm=$((to - chunk + 1)); [ "$frm" -lt "$from_min" ] && frm="$from_min"
    [ "$calls" -gt 0 ] && sleep "$pace"
    local ok=0
    if body=$(rpc_call eth_getLogs "[{\"fromBlock\":\"$(hex_of "$frm")\",\"toBlock\":\"$(hex_of "$to")\",\"address\":\"$TIMELOCK_ADDRESS\"}]"); then
      calls=$((calls + 1))
      summary=$(printf '%s' "$body" | python3 -c '
import sys, json, time
T_Q = "0xf9cbc785b15aec605afb1157116c30a7fd607afac92ed56b6fba98d10966dbd5"
T_X = "0x84b56cdfbb19c7849da7ee873f7296e8b6457694348785267124335abd4e3f70"
T_C = "0xab2af3494bc00bd4aa34e08bd246e5c402d3ee4856c19f5461ce47a6d57423e1"
q = x = c = 0
newest = None
try:
    d = json.load(sys.stdin)
except Exception:
    print("PARSE_ERR\tunreadable response")
    sys.exit(0)
if "error" in d:
    e = d.get("error") or {}
    print("RPC_ERR\t" + str(e.get("message", "unknown RPC error")))
    sys.exit(0)
logs = d.get("result", [])
if not isinstance(logs, list):
    print("PARSE_ERR\tresult is not a log array")
    sys.exit(0)
for l in logs:
    t = (l.get("topics") or [""])[0]
    if t == T_Q:
        q += 1
        if newest is None:
            data = str(l.get("data", "")).lower().removeprefix("0x")
            words = [data[i * 64:(i + 1) * 64] for i in range(len(data) // 64)]
            ready = int(words[3], 16) if len(words) > 3 else 0
            newest = {
                "block": int(l.get("blockNumber", "0x0"), 16),
                "tx": str(l.get("transactionHash", "")),
                "target": "0x" + (l.get("topics") or ["", "", "0x0"])[2][-40:],
                "readyAt": time.strftime("%Y-%m-%d %H:%M:%SZ", time.gmtime(ready)) if ready else "?",
            }
    elif t == T_X:
        x += 1
    elif t == T_C:
        c += 1
info = "queued@{block} target={target} readyAt={readyAt} tx={tx}".format(**newest) if newest else ""
print("\t".join(["OK", str(q), str(x), str(c), info]))')
      case "$summary" in
        OK*)
          local q x c info
          q=0; x=0; c=0; info=""
          IFS=$'\t' read -r _ q x c info <<< "$summary"
          TL_QUEUED=$((TL_QUEUED + q)); TL_EXECUTED=$((TL_EXECUTED + x)); TL_CANCELLED=$((TL_CANCELLED + c))
          if [ -n "$info" ] && [ -z "$TL_QUEUED_INFO" ]; then TL_QUEUED_INFO="$info"; fi
          if [ "$calls" -ge "$MAX_SCAN_CALLS" ]; then TL_INCOMPLETE=1; return 0; fi
          to=$((frm - 1))
          ok=1
          TL_ERRMSG="" ;;
        *)
          TL_ERRMSG="${summary#*"$'\t'"}"
          ok=0 ;;
      esac
    fi
    if [ "$ok" != "1" ]; then
      halvings=$((halvings + 1))
      if [ "$halvings" -ge 4 ] || [ "$chunk" -le 1200 ]; then TL_INCOMPLETE=1; return 0; fi
      chunk=$((chunk / 2))
      sleep 4
    fi
  done
  return 0
}

http_code() { curl -sSL -o /dev/null -m "$HTTP_TIMEOUT" --max-redirs 5 -w '%{http_code}' "$1" 2>/dev/null || echo 000; }
http_get() { curl -sSL -m "$HTTP_TIMEOUT" --max-redirs 5 "$1" 2>/dev/null || true; }

# ------------------------------- preamble ----------------------------------
command -v curl >/dev/null 2>&1 || { say "FATAL: curl not found"; exit 2; }
command -v python3 >/dev/null 2>&1 || { say "FATAL: python3 not found"; exit 2; }

say "Wellstreet daily observability check — $(date -u '+%Y-%m-%d %H:%M:%SZ')"
say "RPC primary:   $RPC_PRIMARY"
say "RPC fallback:  ${RPC_FALLBACK:-none}"
say "Lookback:      ${LOOKBACK_HOURS}h (~$(lookback_blocks "$LOOKBACK_HOURS") blocks @ 101.1ms/block)"

section "0. chain sanity"
LATEST_DEC=0
chain_body=$(rpc_call eth_chainId "[]") || chain_body=""
if [ -z "$chain_body" ]; then
  record FAIL "(0)" "RPC unreachable on BOTH endpoints (primary + fallback). If the public RPC is down this is provider-wide: retry in 15 min, then check the Blockscout status page before escalating further."
else
  chainid=$(printf '%s' "$chain_body" | python3 -c 'import sys,json; print(int(json.load(sys.stdin)["result"], 16))' 2>/dev/null || echo 0)
  bn_body=$(rpc_call eth_blockNumber "[]") || bn_body=""
  LATEST_DEC=$(printf '%s' "$bn_body" | python3 -c 'import sys,json; print(int(json.load(sys.stdin)["result"], 16))' 2>/dev/null || echo 0)
  if [ "$chainid" != "$CHAIN_ID_EXPECTED" ]; then
    record FAIL "(0)" "chainId=$chainid expected=$CHAIN_ID_EXPECTED — wrong chain or a hijacked endpoint. Do not trust any other output; verify the RPC URL."
  elif [ "$LATEST_DEC" -le 0 ]; then
    record FAIL "(0)" "eth_blockNumber returned nothing — RPC degraded."
  else
    record PASS "(0)" "chainId=$chainid latest block=$(hex_of "$LATEST_DEC") ($LATEST_DEC)"
  fi
fi
[ "$FALLBACK_USED" -gt 0 ] && say "[INFO] (0) primary RPC failed for $FALLBACK_USED call(s); served by the Blockscout eth-rpc fallback (heavy use can hit its Cloudflare challenge / 429 — see runbook)."

# ------------------------------- (a) vault ---------------------------------
section "(a) vault — TVL / totalSupply / pricePerShare"
if miss_if_unset WELLSTREET_VAULT_ADDRESS "(a)" "vault address"; then
  TA=""
  if ethcall "$VAULT_ADDRESS" "0x01e1d114"; then
    TA="$RET"
    record PASS "(a1)" "totalAssets() = $(to_units "$TA" 18) SPY (storage-based accounting: deposits + credited harvest; donations excluded)"
  else
    record FAIL "(a1)" "totalAssets() eth_call failed (${ERR_MSG:-transport}) — vault unreachable/misconfigured at $VAULT_ADDRESS. Verify against the deploy runbook; a live vault reverting totalAssets() is a same-day escalate."
  fi
  if ethcall "$VAULT_ADDRESS" "0x18160ddd"; then
    record PASS "(a2)" "totalSupply() = $(to_units "$RET" 24) ws-SPY (share token is 24-decimals — audit F-10)"
  else
    record FAIL "(a2)" "totalSupply() eth_call failed — as (a1)."
  fi
  # price per share: convertToAssets(1e24) = SPY per 1 whole ws-SPY
  # (1e24 = 10^24 exceeds bash int64 — the calldata constant is a literal)
  if ethcall "$VAULT_ADDRESS" "0x07a2d13a00000000000000000000000000000000000000000000d3c21bcecceda1000000"; then
    record PASS "(a3)" "pricePerShare = $(to_units "$RET" 18) SPY per 1 ws-SPY (convertToAssets(1e24); 1.0 at inception, rises only via harvest)"
  else
    record WARN "(a3)" "convertToAssets() eth_call failed — non-fatal while the vault is empty; cross-check (a1)/(a2) by hand."
  fi
  # solvency: balanceOf(vault) >= totalAssetsStored — the audit F-04 detector
  if ethcall "$SPY_ADDRESS" "0x70a08231000000000000000000000000${VAULT_ADDRESS#0x}"; then
    BAL="$RET"
    if [ -z "$TA" ]; then
      record WARN "(a4)" "balanceOf(vault) = $(to_units "$BAL" 18) SPY but totalAssets unavailable — solvency not checkable this run."
    elif python3 -c "import sys; sys.exit(0 if int('$BAL', 16) >= int('$TA', 16) else 1)" 2>/dev/null; then
      EXCESS=$(python3 -c "print(int('$BAL', 16) - int('$TA', 16))")
      record PASS "(a4)" "solvency OK: balanceOf(vault) = $(to_units "$BAL" 18) >= totalAssetsStored; unaccounted excess = $(to_units "$EXCESS" 18) SPY"
    else
      record FAIL "(a4)" "ACCOUNTING DIVERGENCE: balanceOf(vault) = $(to_units "$BAL" 18) < totalAssetsStored = $(to_units "$TA" 18) — the audit F-04 issuer adminBurn signature. The shortfall wei can never be re-backed by protocol paths; treat as an incident and assess the redemption tail."
    fi
  else
    record FAIL "(a4)" "balanceOf(vault) on the SPY token failed — token or RPC problem; re-run before concluding."
  fi
  # unaccountedAssets(): a Panic(0x11) revert here is the same F-04 signature
  if ethcall "$VAULT_ADDRESS" "0x07ed6456"; then
    record INFO "(a4b)" "unaccountedAssets() = $(to_units "$RET" 18) SPY (donations + uncredited harvest; claimable by nobody)"
  else
    case "$ERR_DATA" in
      0x4e487b71*11)
        record FAIL "(a4b)" "unaccountedAssets() PANICS (arithmetic underflow) — balance < stored totalAssets. Confirms the F-04 divergence (issuer burned vault-backed tokens). Incident." ;;
      *)
        record WARN "(a4b)" "unaccountedAssets() reverted (${ERR_MSG:-transport}) — unexpected for a healthy vault; investigate." ;;
    esac
  fi
  if ethcall "$VAULT_ADDRESS" "0x60da3e83"; then
    if [ "$(word 0 "$RET")" = "1" ]; then
      record WARN "(a5)" "depositsPaused = TRUE — timelock or pause-only EOA paused deposits. Redemptions are never pausable (no checkpoint on _withdraw). If this was not an intentional owner action, check the DepositPauseSet event on Blockscout for who/when, then treat as an incident."
    else
      record PASS "(a5)" "depositsPaused = false"
    fi
  else
    record WARN "(a5)" "depositsPaused() eth_call failed — investigate."
  fi
  if ethcall "$VAULT_ADDRESS" "0x24a9d853"; then
    FEE=$(word 0 "$RET")
    if [ "$FEE" -gt 2000 ]; then
      record FAIL "(a6)" "feeBps=$FEE exceeds MAX_FEE_BPS=2000 — impossible through the contract; this address may not be a Wellstreet vault. Verify."
    elif [ "$FEE" != "$EXPECTED_FEE_BPS" ]; then
      record WARN "(a6)" "feeBps=$FEE (expected initial $EXPECTED_FEE_BPS) — the timelock changed the protocol fee (the FeeBpsSet event carries old/new). Confirm it was intentional and update site/js/config.js economics if permanent."
    else
      record PASS "(a6)" "feeBps=$FEE (protocol fee $(python3 -c "print($FEE / 100)")% of harvested yield; hard cap 2000 bps)"
    fi
  else
    record WARN "(a6)" "feeBps() eth_call failed — investigate."
  fi
  if ethcall "$VAULT_ADDRESS" "0x4bdaeac1"; then
    VH=$(addr_of "$RET")
    if [ -n "$HARVESTER_ADDRESS" ] && [ "${VH,,}" != "${HARVESTER_ADDRESS,,}" ]; then
      record FAIL "(a7)" "vault.harvester() = $VH != configured harvester $HARVESTER_ADDRESS — wiring drift; the yield path may be pointed elsewhere. Escalate."
    else
      record PASS "(a7)" "vault.harvester() = $VH"
    fi
  else
    record WARN "(a7)" "harvester() eth_call failed — investigate."
  fi
  if ethcall "$VAULT_ADDRESS" "0x38d52e0f"; then
    VA=$(addr_of "$RET")
    if [ "${VA,,}" != "${SPY_ADDRESS,,}" ]; then
      record WARN "(a8)" "vault.asset() = $VA != expected SPY $SPY_ADDRESS — unexpected configuration; verify what this vault wraps."
    else
      record PASS "(a8)" "vault.asset() = $VA (SPY)"
    fi
  fi
fi

# ----------------------------- (b) harvester -------------------------------
section "(b) harvester — last harvest (bounded Harvested event scan)"
H_EVENT=0x609646d1ef303046ba78f6d8ff245fd7cc20747e5c2c6bc2f2389b223ef02a6a
if miss_if_unset WELLSTREET_HARVESTER_ADDRESS "(b)" "harvester address"; then
  if ethcall "$HARVESTER_ADDRESS" "0x71640de3"; then
    PID=$(word 0 "$RET")
    if [ "$PID" = "0" ]; then
      record INFO "(b0)" "positionId = 0 — the protocol LP NFT has not been transferred to the harvester yet; harvest() cannot run, so the last-harvest scan is not applicable."
    else
      record INFO "(b0)" "positionId = $PID (LP NFT held by the harvester)"
      scan_logs "$HARVESTER_ADDRESS" "$H_EVENT" "$(lookback_blocks "$LOOKBACK_HOURS")" 1
      if [ -n "$LATEST_BLOCK_DEC" ]; then
        record PASS "(b1)" "last Harvested at block $LATEST_BLOCK_DEC ($(block_ts_iso "$(hex_of "$LATEST_BLOCK_DEC")")), tx ${LATEST_TX:-?} — proceeds split per feeBps, 0.1% tip to the caller"
      elif [ "$SCAN_INCOMPLETE" = "1" ]; then
        record WARN "(b1)" "Harvested scan incomplete (RPC refused/errors on wide eth_getLogs; last error: ${SCAN_ERRMSG:-transport}). Re-run with a smaller WELLSTREET_SCAN_CHUNK (e.g. 7200) or read the harvester's log page on Blockscout."
      else
        record WARN "(b1)" "no Harvested event in the last ${LOOKBACK_HOURS}h. harvest() is permissionless and proceeds are small at v1 sizes (~\$10-15/day at the ratified pins), so gaps are normal; escalate only if the gap exceeds ${HARVEST_STALE_HOURS}h while fees accrue in the LP — a failed swap leg reverts the whole harvest atomically and fees stay in the position (re-collectable by the next harvest)."
      fi
    fi
  else
    record FAIL "(b0)" "positionId() eth_call failed on $HARVESTER_ADDRESS — verify the harvester address."
  fi
fi

# ------------------------------ (c) treasury -------------------------------
section "(c) treasury — protocol accrual + Swept events"
TREASURY="${TREASURY_ADDRESS:-$TIMELOCK_ADDRESS}"
S_EVENT=0xbb3f74f3539ea7725781ff6810125a75c183f5c944318fc94873d1324f0482ae
if miss_if_unset WELLSTREET_HARVESTER_ADDRESS "(c1)" "protocolAccrued source"; then
  if ethcall "$HARVESTER_ADDRESS" "0x75ae6a42"; then
    ACC="$RET"
    record PASS "(c1)" "harvester.protocolAccrued = $(to_units "$ACC" 18) SPY awaiting sweepToTreasury()"
    [ "$(word 0 "$ACC")" != "0" ] && say "[INFO] (c1) accrual is non-zero: sweepToTreasury() is permissionless — anyone can sweep; consider sweeping once it is material."
  else
    record FAIL "(c1)" "protocolAccrued() eth_call failed — harvester misbehaving or wrong address."
  fi
  scan_logs "$HARVESTER_ADDRESS" "$S_EVENT" "$(lookback_blocks "$LOOKBACK_HOURS")"
  if [ -n "$LATEST_BLOCK_DEC" ]; then
    record PASS "(c2)" "latest Swept at block $LATEST_BLOCK_DEC ($(block_ts_iso "$(hex_of "$LATEST_BLOCK_DEC")")), $SCAN_HITS sweep(s) in ${LOOKBACK_HOURS}h — accrued fees moved to the treasury"
  elif [ "$SCAN_INCOMPLETE" = "1" ]; then
    record WARN "(c2)" "Swept scan incomplete (last error: ${SCAN_ERRMSG:-transport}) — verify on the harvester's Blockscout logs page."
  else
    record INFO "(c2)" "no Swept events in ${LOOKBACK_HOURS}h (nothing swept; accrual reported above)"
  fi
fi
if [ -n "$TREASURY" ] && [ "$TREASURY" != "PENDING_DEPLOY" ]; then
  if ethcall "$SPY_ADDRESS" "0x70a08231000000000000000000000000${TREASURY#0x}"; then
    record PASS "(c3)" "treasury SPY balanceOf($TREASURY) = $(to_units "$RET" 18) (custodied accrued fees + forwarded donations; the timelock can move it only through a public 48h queue)"
  else
    record WARN "(c3)" "balanceOf(treasury) eth_call failed."
  fi
else
  record MISS "(c3)" "treasury balance needs WELLSTREET_TIMELOCK_ADDRESS (or WELLSTREET_TREASURY_ADDRESS) — not configured yet"
fi

# ------------------------- (d) SPY issuer state ----------------------------
section "(d) underlying SPY — issuer pause / block state"
if ethcall "$SPY_ADDRESS" "0x5c975abb"; then
  if [ "$(word 0 "$RET")" = "1" ]; then
    record FAIL "(d1)" "SPY paused() = TRUE (composite: per-token flag OR global registry pause). Issuer pause is active: deposits revert, redemptions revert, price/oracle paths can freeze. Disclosed issuer risk (audit F-03 class) — confirm on Blockscout, check the issuer's status comms, prepare user comms; nothing in the protocol can fix it."
  else
    record PASS "(d1)" "SPY paused() = false"
  fi
else
  record FAIL "(d1)" "paused() eth_call failed on the SPY token — RPC or token problem; re-run."
fi
if ethcall "$SPY_ADDRESS" "0x86c75e74"; then
  if [ "$(word 0 "$RET")" = "1" ]; then
    record WARN "(d2)" "SPY tokenPaused() = TRUE (per-token pause flag set)"
  else
    record PASS "(d2)" "SPY tokenPaused() = false"
  fi
else
  record WARN "(d2)" "tokenPaused() eth_call failed."
fi
if ethcall "$BLOCK_REGISTRY" "0x5c975abb"; then
  if [ "$(word 0 "$RET")" = "1" ]; then
    record FAIL "(d3)" "registry paused() = TRUE — the GLOBAL pause for the whole tokenized-stock fleet is active (every stock token, not just SPY)."
  else
    record PASS "(d3)" "registry paused() = false (global fleet pause off)"
  fi
else
  record WARN "(d3)" "registry paused() eth_call failed."
fi
for pair in "vault:$VAULT_ADDRESS" "harvester:$HARVESTER_ADDRESS" "treasury:$TREASURY"; do
  name="${pair%%:*}"; addr="${pair#*:}"
  [ -z "$addr" ] && continue
  if ethcall "$BLOCK_REGISTRY" "0xfbac3951000000000000000000000000${addr#0x}"; then
    if [ "$(word 0 "$RET")" = "1" ]; then
      record FAIL "(d4)" "isBlocked($name = $addr) = TRUE — a protocol address is blacklisted on the stock token: its SPY transfers revert (deposits / harvest credit / sweep all die). Immediate escalate (this is the phase-0 B-3 posture check)."
    else
      record INFO "(d4)" "isBlocked($name) = false"
    fi
  else
    record WARN "(d4)" "isBlocked($name) eth_call failed."
  fi
done

# --------------------- (e) pool feeProtocol drift --------------------------
section "(e) SPY/WETH pool — feeProtocol word re-check (owner-settable drift)"
if ethcall "$POOL_ADDRESS" "0x3850c7bd"; then
  NW=$(words_count "$RET")
  FP=$(word 5 "$RET")
  UNLOCKED=$(word 6 "$RET")
  FPNIB=$(printf '%x' "$FP" 2>/dev/null || echo "?")
  if [ "$NW" != "7" ]; then
    record FAIL "(e1)" "slot0() returned $NW words (expected exactly 7) — ABI/word-boundary drift; do NOT hand-parse further. Re-run the phase-0 (b) decode against the Blockscout-verified pool ABI (word-count summaries are unreliable — docs/ops/phase0/pool-apr.md §1.5)."
  elif [ "0x$FPNIB" != "${EXPECTED_FEE_PROTOCOL,,}" ]; then
    CUT=$(python3 -c "n = int('$FPNIB'[-1], 16); print('1/%d' % n if n > 0 else '0 (off)')" 2>/dev/null || echo "?")
    record FAIL "(e1)" "feeProtocol DRIFTED: word = 0x$FPNIB (expected ${EXPECTED_FEE_PROTOCOL} = packed (4,4) = 1/4 per side; now ~$CUT per side). The external factory owner (0x05c420bc4823e039aa4da645edde743486daaa25) changed the protocol-fee cut — the pool APR chain, the depositor-APR projection, and any published yield figure are STALE until re-derived. Re-run phase-0 (b), check the SetFeeProtocol event for the old/new pair, and update the economics docs before any number is quoted."
  else
    record PASS "(e1)" "feeProtocol = 0x$FPNIB = packed (4,4) — factory-owner cut still 1/4 per side; LPs retain 75%"
  fi
  if [ "$UNLOCKED" = "1" ]; then
    record INFO "(e2)" "slot0.unlocked = true"
  else
    record WARN "(e2)" "slot0.unlocked = $UNLOCKED — pool was mid-swap/locked at read time (usually transient); re-check before worrying."
  fi
else
  record FAIL "(e1)" "slot0() eth_call failed on the pool $POOL_ADDRESS — RPC or pool problem; re-run."
fi

# ----------------------------- (f) site / api ------------------------------
section "(f) site + /api/health"
CODE=$(http_code "$SITE_URL/")
if [ "$CODE" = "200" ]; then
  record PASS "(f1)" "GET $SITE_URL/ -> 200 (expected from a non-blocked jurisdiction; the geo-gate answers 403 to US/UK by design)"
else
  record FAIL "(f1)" "GET $SITE_URL/ -> HTTP $CODE — site down, wrong deploy target, or the geo-gate is answering from this source IP. Verify the Vercel project + alias before touching DNS."
fi
HEALTH_CODE=$(http_code "$SITE_URL/api/health")
HEALTH_BODY=$(http_get "$SITE_URL/api/health")
if printf '%s' "$HEALTH_BODY" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
sys.exit(0 if (d.get("ok") is True and d.get("chainId") == 4663) else 2)' 2>/dev/null; then
  record PASS "(f2)" "GET $SITE_URL/api/health -> $HEALTH_CODE with ok=true, chainId=4663 (serverless RPC failover path alive)"
else
  record FAIL "(f2)" "GET $SITE_URL/api/health -> HTTP $HEALTH_CODE, body did not report ok=true/chainId=4663 — the /api/* enhancement path is degraded (the static site must still render serverless-clean; check the Vercel function logs)."
fi

# ------------------------------ (g) CI status ------------------------------
section "(g) GitHub Actions CI"
if command -v gh >/dev/null 2>&1; then
  CI_JSON=$(gh run list -R "$GITHUB_REPO" --limit 5 --json databaseId,workflowName,status,conclusion,createdAt 2>&1) && CI_RC=0 || CI_RC=1
  if [ "$CI_RC" -ne 0 ]; then
    record MISS "(g)" "gh run list failed: $(printf '%s' "$CI_JSON" | head -c 160). Expected while the public repo/identity is not live yet; once live, authenticate gh as the Wellstreet identity (never a shared account)."
  else
    VERDICT=$(printf '%s' "$CI_JSON" | python3 -c '
import sys, json
runs = json.load(sys.stdin)
done = [r for r in runs if r.get("status") == "completed" and r.get("conclusion")]
if not done:
    print("NONE|||")
    sys.exit(0)
r = done[0]
bad = {"failure", "startup_failure", "timed_out"}
warn = {"cancelled"}
v = "FAIL" if r["conclusion"] in bad else "WARN" if r["conclusion"] in warn else "PASS"
print("|".join([v, str(r.get("workflowName", "?")), str(r.get("conclusion")), str(r.get("createdAt", ""))]))' 2>/dev/null || echo "PARSE_ERR|||")
    case "$VERDICT" in
      PASS*) record PASS "(g)" "latest completed run: ${VERDICT#PASS|}" ;;
      WARN*) record WARN "(g)" "latest completed run: ${VERDICT#WARN|} — cancelled run; check whether that was intentional." ;;
      FAIL*) record FAIL "(g)" "latest completed run: ${VERDICT#FAIL|} — CI is red; fix before any deploy (CI carries the forge suite + fork tests)." ;;
      *) record WARN "(g)" "no completed runs found on $GITHUB_REPO yet." ;;
    esac
  fi
else
  record MISS "(g)" "gh CLI not installed on this host — install it or run this check from a host that has it."
fi

# --------------------------- (h) timelock queue ----------------------------
section "(h) timelock queue visibility (48h detection window)"
if miss_if_unset WELLSTREET_TIMELOCK_ADDRESS "(h)" "timelock address"; then
  classify_timelock_logs "$(lookback_blocks "$LOOKBACK_HOURS")"
  if [ "$TL_INCOMPLETE" = "1" ] && [ "$TL_QUEUED" = "0" ]; then
    record WARN "(h)" "timelock scan incomplete (last error: ${TL_ERRMSG:-transport}) — read the timelock's log page on Blockscout before signing anything new."
  else
    record INFO "(h)" "window (${LOOKBACK_HOURS}h): CallQueued=$TL_QUEUED CallExecuted=$TL_EXECUTED CallCancelled=$TL_CANCELLED"
    [ -n "$TL_QUEUED_INFO" ] && say "[INFO] (h) newest queue: $TL_QUEUED_INFO"
    if [ "$TL_QUEUED" -gt $((TL_EXECUTED + TL_CANCELLED)) ]; then
      record WARN "(h)" "queued call(s) not yet executed/cancelled — queued ops become executable after 48h and stay executable indefinitely (audit F-06: no expiry). Verify the queued target is intended; queue a cancel (proposer-only) if it is not."
    else
      record PASS "(h)" "no unexplained pending timelock ops in the window"
    fi
  fi
fi

# -------------------------------- summary ----------------------------------
section "summary"
say "PASS=$PASS_COUNT FAIL=$FAIL_COUNT WARN=$WARN_COUNT MISS=$MISS_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  say "RESULT: ATTENTION NEEDED — see docs/ops/observability-runbook.md (Escalation)."
  exit 1
fi
say "RESULT: no failures this run (WARNs: investigate; MISSes: expected while addresses are PENDING_DEPLOY)."
exit 0
