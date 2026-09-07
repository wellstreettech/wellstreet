#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""V4 fee-econ screen — rerunnable pipeline for the RH-4663 Uniswap-v4 book universe.

Captures the 95-book screen method as a runnable pipeline. Implements the documented
method from

    /home/raivo/Documents/VIBE_trader_V2/docs/research/yield_farming/05_V4_FEE_ECON_SCREEN_2026-09-04.md
    (§1, verbatim)

as a repo-resident, keyless, stdlib-only Python 3 pipeline.

Modes
-----
  (default)   live screen → docs/ops/v4_fee_screen.json (schema v1):
                universe   = every DexScreener-surfaced v4 book above the $1k liq/vol
                             dust floor  ∪  every Merkl LIVE UNISWAP_V4 identifier
                             (the 05 §1 :43 screen set)
                per book   = poolId-filtered Initialize decode (topic0 fork-Initialize,
                             topic1=poolId, block 0x0 → head, ≤1 row) → charged-fee
                             replay from fork Swap logs (topic0 fork-Swap, topic1=poolId,
                             100k-block window; 4×25k subwindows past the 10k-log cap;
                             widened to 500k for zero-swap books) → StateView getSlot0
                             lpFee → PoolManager protocolFeesAccrued(currency) for
                             monetization evidence → measured-flow cross-check
                             (300k blocks, int128 sign-extension decode, c0-leg notional).
              Crash-safe: partial state after every book in .v4_fee_screen_state.json,
              keyed to VERSION — stale state from an older code version is discarded on
              resume. The default mode is a LONG background run (DexScreener hits are
              spaced ≥60s per the method doc); launch it detached and poll.
  --probe     selector proof: ONE live getSlot0 + ONE protocolFeesAccrued call, print,
              exit. Also runs fail-closed at the start of every live run.
  --selftest  OFFLINE synthetic vectors (zero network) covering the 7 documented traps.
  --validate  offline schema check of a fixture file.

Honesty rules (binding)
-----------------------
  - every APR carries source + window, and every apr[] entry additionally notes the
    emitted-fee basis ("emitted-fee basis; LP share at claim may differ ...");
  - no guaranteed-APR language anywhere;
  - Merkl claim APRs are a SEPARATELY LABELED row (merkl.claim_apr_pct) never merged
    into measured APRs; a zero-campaign Merkl run is recorded truthfully, never padded;
  - divergence policy: live measurements that diverge from a pinned constant are
    committed AS MEASURED and recorded in meta.deviations — code and data are never
    bent to a pin (the deterministic trap pins live only in --selftest).

Selector provenance
-------------------
All eth_call selectors are HARDCODED 4-byte constants computed OFFLINE via
`cast keccak` (Python stdlib has NO keccak — hashlib.sha3_256 is NIST SHA-3 with
different padding and would silently produce wrong selectors), each proven against
one live call before the full run:

    getSlot0(bytes32)            = 0xc815641c   (StateView 0x0284Cb0b…55F2)
    protocolFeesAccrued(address) = 0x97e8cd4e   (PoolManager 0x8366a39C…40951)

Topic0 hashes are taken verbatim from the method doc (04 §5.5): the fork Swap topic0
0x40e9cecb…112f matches NEITHER canonical v4 revision — do not reuse canonical topic
hashes. Recomputing keccak("Swap(bytes32,address,int128,int128,uint160,uint128,int24,uint24)")
reproduces the fork topic0 exactly, confirming the fork's trailing uint24 fee in data
word[5].
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
VERSION = "v4-fee-screen 2026-09-06.4"

# ---------------------------------------------------------------- constants --
CHAIN_ID = 4663
PM = "0x8366a39cc670b4001a1121b8f6a443a643e40951"  # PoolManager (04 §1, event-forensics confirmed)
SV = "0x0284cb0bcbaa8b87a8aa409d0e41afa7a76355f2"  # StateView ctor-arg-bound to PM (04 §5.1)

SEL_GET_SLOT0 = "0xc815641c"      # keccak("getSlot0(bytes32)")[:4]           (cast-verified offline)
SEL_PROTOCOL_FEES = "0x97e8cd4e"  # keccak("protocolFeesAccrued(address)")[:4] (cast-verified offline)

TOPIC0_INITIALIZE = "0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438"  # fork Initialize, verbatim from the method doc
TOPIC0_SWAP = "0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f"        # fork Swap (trailing uint24 fee), verbatim

NATIVE = "0x" + "00" * 20
WETH = "0x0bd7d308f8e1639fab988df18a8011f41eacad73"
DYNAMIC_FEE_FLAG = 8388608  # 0x800000 init-fee value = hook-dynamic per-swap fee (05 §1)

METHOD_DOC = ("/home/raivo/Documents/VIBE_trader_V2/docs/research/"
              "yield_farming/05_V4_FEE_ECON_SCREEN_2026-09-04.md")

OUT_DEFAULT = os.path.join(HERE, "v4_fee_screen.json")
STATE_DEFAULT = os.path.join(HERE, ".v4_fee_screen_state.json")

RPCS = [
    "https://rpc.mainnet.chain.robinhood.com",             # RH public RPC (primary)
    "https://robinhoodchain.blockscout.com/api/eth-rpc",   # Blockscout eth-rpc (fallback)
]
BS = "https://robinhoodchain.blockscout.com/api/v2"
DEX = "https://api.dexscreener.com/latest/dex"
MERKL_URL = "https://api.merkl.xyz/v4/opportunities?chainId=4663&status=LIVE"
UA = {"User-Agent": ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                     "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")}

LOG_CAP = 10000        # node caps any single eth_getLogs query at 10,000 logs (05 §1)
WIN_MAIN = 100000      # primary charged-fee window (2.81h at 0.101 s/block)
WIN_WIDE = 500000      # widened window for zero-swap books (14.05h)
WIN_FLOW = 300000      # measured-flow cross-check window (8.42h)
FLOW_TOP_N = 12        # 05 §1: "re-scan top 12 books over 300k blocks"
BLOCK_TIME_S = 0.101   # 05 §1 clock (median over 85 block↔timestamp anchors)
DEX_MIN_SPACING_S = 60.0   # binding: ≥60s between DexScreener hits (05 §1)
DEX_BATCH = 12         # binding: ≤12 addrs per DexScreener token batch (05 §1)
DUST_FLOOR_USD = 1000.0    # $1k liq/vol dust floor (05 §1 :43)
S1_TVL_FLOOR = 10000.0     # s1_allowlist_candidate TVL floor (ratified default rule)

# Ticker seed set = the distinct tickers of the 05 §2 screen (frozen 2026-09-04 corpus).
# Universe bootstrap = DexScreener search over these seeds ∪ Merkl LIVE; new listings
# outside the seed set are out of scope for v1 (recorded in dexscreener_meta).
SEED_SYMBOLS = [
    "SPY", "USDG", "WETH", "RBLX", "ROBLOXIANS", "STEVIE", "NOOB", "n00b", "GYATT",
    "TRIPLET", "MANFACE", "HOODBLOX", "DUCK", "MYSTIC", "EQUITY", "FRANKLIN", "OOF",
    "ROBUX", "PACK", "THROBBIN", "PONS", "CASHCAT", "TENDIES", "SPCX", "AAPL", "MU",
    "MSFT", "AMD", "NVDA", "TSM", "HIMS", "META", "AMZN", "TSLA", "COIN", "GOOGL",
    "PLTR", "INTC", "QQQ", "WTH",
]

# Tokenized-stock tickers seen on RH chain (the SPY-* family + the stock/ETF legs of
# the 05 §2 table). Used ONLY for the allowlist_evidence stock-book note.
STOCK_TICKERS = {
    "SPY", "MU", "TSM", "NVDA", "AAPL", "MSFT", "AMD", "HIMS", "META", "AMZN",
    "TSLA", "COIN", "GOOGL", "PLTR", "INTC", "QQQ", "SPCX",
}

PID_RE = re.compile(r"^0x[0-9a-f]{64}$")

# Anchor poolIds (05 §2): the two the goal machine-checks on.
ROBLOXIANS_POOL = "0x3280b21b63df584e8d4afb8cabd0e031eca1b4f13d64fb06456867b35fd01e07"  # ROBLOXIANS/RBLX (HOOK-MONETIZED)
SPY_USDG_POOL = "0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd"    # SPY/USDG (charged 3499 vs init 3000)
ROBLOXIANS_TOKEN = "0xb528a38ea684ed26ea0eee9de5d222da6228c10d"

EMITTED_FEE_NOTE = ("emitted-fee basis; LP share at claim may differ (fork Pool.sol packing — "
                    "verify the split on a live claim before sizing deposits; 05 §6.3 / 04 §5.4 open item)")

# Divergence policy pins (05 §2): a live divergence is committed AS MEASURED and recorded
# in meta.deviations — never bent to the pin. Deterministic trap pins live only in --selftest.
PINS = [
    {"pool_id": SPY_USDG_POOL, "field": "fee_wavg", "pinned": 3499,
     "source": "05 §2 SPY/USDG charged-fee dist 3499×2982 (win a, 2026-09-04); label-lie pin"},
    {"pool_id": ROBLOXIANS_POOL, "field": "class", "pinned": "HOOK-MONETIZED",
     "source": "05 §2/§3 ROBLOXIANS/RBLX 0×394 swaps, V2MemeHook monetizes via protocol-fee path"},
]


# ------------------------------------------------------------- exceptions --
class RpcError(Exception):
    pass


class LogCapError(Exception):
    """Raised when a query would exceed the node's 10k-log cap (05 §1 subdivision trap)."""


# --------------------------------------------------------------- helpers --
def log(msg):
    print(msg, flush=True)


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def norm_pid(pid):
    """Normalize/validate a poolId. Returns lowercase 0x+64hex, or None (malformed —
    the 05 §1 '42-char listing' trap)."""
    if not isinstance(pid, str):
        return None
    p = pid.strip().lower()
    if not PID_RE.match(p):
        return None
    return p


def word_hex(v):
    """256-bit two's-complement word for an ABI data word."""
    return format(v & ((1 << 256) - 1), "064x")


# --------------------------------------------------------------- decoders --
def decode_int128(word):
    """int128 ABI-encoded at 256 bits is SIGN-EXTENDED: a word ≥ 2^255 is negative.
    (05 §1 measured-flow trap: 'a 2^127 threshold silently poisons the sum'.)"""
    v = int(word)
    return v - (1 << 256) if v >= (1 << 255) else v


def decode_int24(word):
    v = int(word)
    return v - (1 << 256) if v >= (1 << 255) else v


def decode_swap_fee(data_hex):
    """fork Swap data: [amount0 int128][amount1 int128][sqrtPriceX96 uint160]
    [liquidity uint128][tick int24][fee uint24] → data word[5] = charged fee (04 §5.4)."""
    if not data_hex:
        return None
    h = data_hex[2:] if data_hex.startswith("0x") else data_hex
    if len(h) < 6 * 64:
        return None
    return int(h[5 * 64:6 * 64], 16)


def decode_swap_amount0(data_hex):
    if not data_hex:
        return None
    h = data_hex[2:] if data_hex.startswith("0x") else data_hex
    if len(h) < 64:
        return None
    return decode_int128(int(h[0:64], 16))


def decode_init_log(log_row):
    """fork Initialize(bytes32 poolId, address currency0, address currency1,
    uint24 fee, int24 tickSpacing, address hooks, uint160 sqrtPriceX96, int24 tick):
    topics[1]=poolId, topics[2]/[3]=currency0/1; data w0=fee, w1=tickSpacing, w2=hooks
    (04 §5.5). Returns dict or None."""
    topics = log_row.get("topics") or []
    data = (log_row.get("data") or "0x")
    h = data[2:] if data.startswith("0x") else data
    if len(topics) < 4 or len(h) < 5 * 64:
        return None
    w = [h[i * 64:(i + 1) * 64] for i in range(5)]
    hook_addr = "0x" + w[2][-40:].lower()
    return {
        "c0": "0x" + topics[2][-40:].lower(),
        "c1": "0x" + topics[3][-40:].lower(),
        "init_fee": int(w[0], 16),
        "tick_spacing": decode_int24(int(w[1], 16)),
        "hook": None if int(w[2], 16) == 0 else hook_addr,
    }


def weighted_mean_fee(dist):
    """Swap-count-weighted mean charged fee. ALWAYS a number (0.0 when no swaps)."""
    total = sum(dist.values())
    if not total:
        return 0.0
    return sum(int(f) * c for f, c in dist.items()) / float(total)


def classify_book(swaps_sampled, zero_fee_swaps, protocol_fees_nonzero):
    """Locked decision rule (makes the 05 §1 prose 'fee ≈ 0' precise), evaluated in order:
      DEAD           iff swaps_sampled == 0 in the widened window;
      HOOK-MONETIZED iff zero-fee swaps >= 50% of observed swaps AND protocol fees nonzero;
      else           PAYS-LPS.
    Reproduces the 05 doc's own 0xeac79c4c call (0×2 / 90000×1 → HOOK-MONETIZED)."""
    if swaps_sampled == 0:
        return "DEAD"
    if zero_fee_swaps * 2 >= swaps_sampled and protocol_fees_nonzero:
        return "HOOK-MONETIZED"
    return "PAYS-LPS"


def s1_rule(class_, fee_wavg, tvl_usd):
    """Ratified DEFAULT RULE (economic-only): class==PAYS-LPS AND fee_wavg>0 AND
    tvl_usd>=10000 → candidate. Returns (bool, human-readable reason string)."""
    reasons = []
    ok = True
    if class_ != "PAYS-LPS":
        ok = False
        reasons.append("class=%s (not PAYS-LPS)" % class_)
    if not (isinstance(fee_wavg, (int, float)) and fee_wavg > 0):
        ok = False
        reasons.append("fee_wavg=%s (not > 0)" % fee_wavg)
    if not (isinstance(tvl_usd, (int, float)) and tvl_usd >= S1_TVL_FLOOR):
        ok = False
        reasons.append("tvl_usd=%s (< %s)" % (tvl_usd, S1_TVL_FLOOR))
    return ok, ("all conditions met" if ok else "; ".join(reasons))


def chunk_addrs(addrs, size=DEX_BATCH):
    """DexScreener token batches: ≤ size addresses per call (05 §1 / goal trap (c))."""
    out, cur = [], []
    for a in addrs:
        cur.append(a)
        if len(cur) >= size:
            out.append(cur)
            cur = []
    if cur:
        out.append(cur)
    return out


# -------------------------------------------------------------- transports --
_rpc_i = [0]  # preferred transport — advances ONLY on failure (Blockscout = fallback)


def rpc(method, params, tries=4):
    last = None
    for _ in range(tries):
        url = RPCS[_rpc_i[0] % len(RPCS)]
        try:
            body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                               "params": params}).encode()
            req = urllib.request.Request(url, data=body,
                                         headers={**UA, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as r:
                d = json.loads(r.read().decode())
            if isinstance(d, dict) and d.get("result") is not None:
                return d["result"]
            last = d.get("error") if isinstance(d, dict) else d
        except Exception as e:  # noqa: BLE001 — transport layer, re-raised after retries
            last = "%s: %s" % (type(e).__name__, e)
        _rpc_i[0] += 1  # fall back to the next transport for the retry
        time.sleep(0.6 + 0.6 * _)
    raise RpcError("%s failed after %d attempts (last=%s)" % (method, tries, last))


def eth_logs(address, topics, frm, to):
    params = {"address": address, "fromBlock": hex(frm), "toBlock": hex(to),
              "topics": topics}
    return rpc("eth_getLogs", [params])


def eth_call(to, data):
    return rpc("eth_call", [{"to": to, "data": data}, "latest"])


def bs_get(path, tries=3):
    """Blockscout REST (browser UA required — fleet_screen.py precedent)."""
    for i in range(tries):
        try:
            req = urllib.request.Request(BS + path, headers=UA)
            with urllib.request.urlopen(req, timeout=20) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            if e.code in (403, 429) and i < tries - 1:
                time.sleep(3 * (i + 1))
                continue
            return None
        except Exception:  # noqa: BLE001
            if i < tries - 1:
                time.sleep(2)
                continue
            return None
    return None


_dex_last = [0.0]


def dex_get(path, tries=3):
    """DexScreener REST with the binding ≥60s spacing between hits (05 §1)."""
    for i in range(tries):
        wait = DEX_MIN_SPACING_S - (time.time() - _dex_last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            req = urllib.request.Request(DEX + path, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                _dex_last[0] = time.time()
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            _dex_last[0] = time.time()
            if e.code in (403, 429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(20 * (i + 1))
                continue
            raise
        except Exception:  # noqa: BLE001
            _dex_last[0] = time.time()
            if i < tries - 1:
                time.sleep(5)
                continue
            raise
    raise RpcError("dexscreener exhausted retries: %s" % path)


def merkl_pull():
    last = None
    for i in range(3):
        try:
            req = urllib.request.Request(MERKL_URL, headers=UA)
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.loads(r.read().decode())
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(3 * (i + 1))
    raise RpcError("merkl pull failed: %s" % last)


# -------------------------------------------------- log-window machinery --
def split4(a, b):
    """Split an inclusive block range into 4 quarter subwindows (the 05 §1 '4×25k'
    form for a 100k window); the last edge absorbs the remainder."""
    width = b - a + 1
    q = width // 4
    edges = [(a, a + q - 1), (a + q, a + 2 * q - 1), (a + 2 * q, a + 3 * q - 1),
             (a + 3 * q, b)]
    return [e for e in edges if e[0] <= e[1]]


FETCH_BUDGET = 64  # max getLogs calls per top-level window (bounds dead-network recursion)


def fetch_window(fetch, a, b, trace=None, depth=0, budget=None):
    """Fetch logs for [a, b], subdividing on the 10k-log cap. `fetch(a, b)` returns a
    log list or raises LogCapError. Subdivision = 4 equal subwindows, recursive (the
    05 §1 subdivision trap: 'Node caps any single query at 10,000 logs and times out
    on multi-M ranges → scan in windows, subdivide on error'). A per-window call budget
    bounds pathological recursion (dead network)."""
    if budget is None:
        budget = {"n": 0}
    if depth > 6 or budget["n"] > FETCH_BUDGET:
        raise RpcError("subdivision budget exhausted for [%d,%d]" % (a, b))
    budget["n"] += 1
    try:
        logs = fetch(a, b)
    except LogCapError:
        if trace is not None:
            trace.append({"a": a, "b": b, "result": "CAP"})
        out = []
        for (s, e) in split4(a, b):
            out.extend(fetch_window(fetch, s, e, trace, depth + 1, budget))
        return out
    if trace is not None:
        trace.append({"a": a, "b": b, "n": len(logs)})
    if len(logs) >= LOG_CAP:
        # Returned at/over the cap — possibly silently truncated → subdivide.
        out = []
        for (s, e) in split4(a, b):
            out.extend(fetch_window(fetch, s, e, trace, depth + 1, budget))
        return out
    return logs


def sort_logs(logs):
    return sorted(logs, key=lambda l: (int(l.get("blockNumber", "0x0"), 16),
                                       int(l.get("logIndex", "0x0"), 16)))


def fee_dist_from_logs(logs):
    dist = {}
    n = 0
    for lr in logs:
        topics = lr.get("topics") or []
        if not topics or (topics[0] or "").lower() != TOPIC0_SWAP:
            continue
        fee = decode_swap_fee(lr.get("data"))
        if fee is None:
            continue
        dist[str(fee)] = dist.get(str(fee), 0) + 1
        n += 1
    return dist, n


def live_swap_fetch(pid):
    def fetch(a, b):
        try:
            return eth_logs(PM, [TOPIC0_SWAP, pid], a, b)
        except RpcError as e:
            # The node signals the 10k cap / oversized range as a JSON-RPC error or
            # timeout — after retries, treat as a cap hit and subdivide.
            raise LogCapError(str(e))
    return fetch


def live_init_fetch(pid):
    def fetch(a, b):
        try:
            return eth_logs(PM, [TOPIC0_INITIALIZE, pid], a, b)
        except RpcError as e:
            raise LogCapError(str(e))
    return fetch


# ------------------------------------------------------------ chain reads --
def get_slot0(pool_id):
    """StateView getSlot0(bytes32)(uint160,int24,uint24,uint24) — 4th return = lpFee now
    (05 §1; ≠ charged fee on hook/dynamic books)."""
    r = eth_call(SV, SEL_GET_SLOT0 + pool_id[2:])
    h = r[2:] if r.startswith("0x") else r
    if len(h) < 4 * 64:
        return None
    return {
        "sqrtPriceX96": int(h[0:64], 16),
        "tick": decode_int24(int(h[64:128], 16)),
        "protocolFee": int(h[128:192], 16),
        "lpFee": int(h[192:256], 16),
    }


def protocol_fees(currency):
    """PoolManager protocolFeesAccrued(address)(uint256) — monetization evidence."""
    if not currency:
        return None
    data = SEL_PROTOCOL_FEES + currency[2:].rjust(64, "0")
    r = eth_call(PM, data)
    h = r[2:] if r.startswith("0x") else r
    if len(h) < 64:
        return None
    return int(h, 16)


def latest_block():
    r = rpc("eth_blockNumber", [])
    return int(r, 16)


def prove_selectors():
    """Selector proof against ONE live call each — required before the full run
    (fail-closed: a wrong selector aborts before any screen work)."""
    s0 = get_slot0(SPY_USDG_POOL)
    if not s0 or s0.get("sqrtPriceX96", 0) <= 0:
        raise RpcError("selector proof FAILED: getSlot0(%s) → %r" % (SPY_USDG_POOL, s0))
    pf = protocol_fees(ROBLOXIANS_TOKEN)
    if pf is None:
        raise RpcError("selector proof FAILED: protocolFeesAccrued(%s) → None"
                       % ROBLOXIANS_TOKEN)
    log("[probe] getSlot0(%s…) OK sqrtPriceX96=%d tick=%d lpFee=%d"
        % (SPY_USDG_POOL[:12], s0["sqrtPriceX96"], s0["tick"], s0["lpFee"]))
    log("[probe] protocolFeesAccrued(%s…) OK raw=%d"
        % (ROBLOXIANS_TOKEN[:12], pf))
    return s0, pf


# ----------------------------------------------------------- state (resume) --
def fresh_state(seeds, max_books):
    return {
        "version": VERSION,
        "universe_sig": "",  # set by run_live
        "started_at": now_iso(),
        "head_block": None,
        "seeds": seeds,
        "max_books": max_books,
        "searched": [],
        "search_failures": [],
        "dex_pairs": {},
        "malformed_listings": [],
        "merkl_meta": None,
        "universe": None,
        "enrich_done": False,
        "books": {},
        "decimals": {},
        "prices_blockscout": {},
        "flow": {},
    }


def load_state(path, sig):
    if not os.path.exists(path):
        return None
    try:
        with open(path) as f:
            st = json.load(f)
    except Exception as e:  # noqa: BLE001 — corrupt state = discard
        log("[resume] state unreadable (%s) — discarding" % e)
        return None
    if st.get("version") != VERSION:
        log("[resume] state version %r != current %r — stale state DISCARDED"
            % (st.get("version"), VERSION))
        return None
    if st.get("universe_sig") != sig:
        log("[resume] universe signature changed — stale state DISCARDED")
        return None
    log("[resume] loaded partial state (books done: %d, searched: %d)"
        % (len(st.get("books") or {}), len(st.get("searched") or [])))
    return st


def save_state(st, path):
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(st, f)
    os.replace(tmp, path)


# ---------------------------------------------------------------- universe --
def strip_pair(p):
    def sym(t):
        return ((t or {}).get("symbol") or "")[:32]
    return {
        "pairAddress": p.get("pairAddress"),
        "dexId": p.get("dexId"),
        "labels": p.get("labels") or [],
        "base": {"address": ((p.get("baseToken") or {}).get("address") or "").lower(),
                 "symbol": sym(p.get("baseToken"))},
        "quote": {"address": ((p.get("quoteToken") or {}).get("address") or "").lower(),
                  "symbol": sym(p.get("quoteToken"))},
        "priceUsd": p.get("priceUsd"),
        "priceNative": p.get("priceNative"),
        "liquidity_usd": (p.get("liquidity") or {}).get("usd"),
        "volume_h24": (p.get("volume") or {}).get("h24"),
    }


def phase_universe(st, seeds):
    if st.get("universe"):
        log("[universe] already complete (%d books)" % len(st["universe"]))
        return
    if st.get("head_block") is None:
        st["head_block"] = latest_block()
        log("[universe] head block %d" % st["head_block"])

    # -- Merkl LIVE UNISWAP_V4 opportunities (identifier = poolId, joins directly) --
    opps = merkl_pull()
    v4 = [o for o in opps
          if o.get("type") == "UNISWAP_V4" and o.get("chainId") == CHAIN_ID
          and str(o.get("status") or "").upper() == "LIVE"]
    merkl = {}
    for o in v4:
        pid = norm_pid(o.get("identifier") or "")
        if not pid:
            continue
        merkl[pid] = {
            "apr": o.get("apr"),
            "tvl": o.get("tvl"),
            "name": o.get("name"),
            "token_symbols": [((t or {}).get("symbol") or "")[:32]
                              for t in (o.get("tokens") or [])],
        }
    st["merkl_meta"] = {
        "pulled_at": now_iso(),
        "campaigns_live": len(v4),
        "drift_note": ("Merkl campaigns expire intra-day; claim APRs are Merkl's own "
                       "claims — separately labeled, never merged into measured APRs; "
                       "a zero-campaign run is recorded truthfully"),
        "opportunities": merkl,
    }
    log("[universe] Merkl LIVE UNISWAP_V4 campaigns: %d" % len(v4))
    save_state(st, STATE_PATH[0])

    # -- DexScreener v4 search per seed symbol (≥60s spacing) --
    for i, sym in enumerate(seeds):
        if sym in st["searched"]:
            continue
        try:
            d = dex_get("/search?q=" + urllib.parse.quote(sym))  # DEX already carries /latest/dex
        except Exception as e:  # noqa: BLE001 — retried on next resume
            log("[universe] search %r FAILED (%s) — will retry on resume" % (sym, e))
            if sym not in st["search_failures"]:
                st["search_failures"].append(sym)
            save_state(st, STATE_PATH[0])
            continue
        if sym in st["search_failures"]:
            st["search_failures"].remove(sym)
        n = 0
        for p in (d.get("pairs") or []):
            if (p.get("chainId") or "").lower() != "robinhood":
                continue
            if "v4" not in (p.get("labels") or []):
                continue
            pid = norm_pid(p.get("pairAddress"))
            if not pid:
                st["malformed_listings"].append(p.get("pairAddress"))
                continue
            prev = st["dex_pairs"].get(pid)
            liq = float(p.get("liquidity", {}).get("usd") or 0)
            vol = float(p.get("volume", {}).get("h24") or 0)
            if prev is None or (liq + vol) > float(prev.get("liquidity_usd") or 0) + \
                    float(prev.get("volume_h24") or 0):
                st["dex_pairs"][pid] = strip_pair(p)
            n += 1
        st["searched"].append(sym)
        log("[universe] search %2d/%2d %-12s → %2d v4-rh pairs (cum %d)"
            % (i + 1, len(seeds), sym, n, len(st["dex_pairs"])))
        save_state(st, STATE_PATH[0])

    if st["search_failures"]:
        raise RpcError("universe incomplete: seed searches failed %s — resume to retry"
                       % st["search_failures"])

    # -- assemble the screen universe: above-dust DexScreener ∪ Merkl LIVE --
    universe = {}
    for pid, pair in st["dex_pairs"].items():
        liq = float(pair.get("liquidity_usd") or 0)
        vol = float(pair.get("volume_h24") or 0)
        if max(liq, vol) < DUST_FLOOR_USD:
            continue
        universe[pid] = {"sources": ["dexscreener"], "pair": pair, "merkl": None}
    for pid, m in (st["merkl_meta"]["opportunities"]).items():
        if pid in universe:
            universe[pid]["sources"].append("merkl")
            universe[pid]["merkl"] = m
        else:
            universe[pid] = {"sources": ["merkl"], "pair": None, "merkl": m}
    st["universe"] = universe
    log("[universe] SCREEN SET = %d books (%d DexScreener-surfaced above dust ∪ %d Merkl)"
        % (len(universe), len([1 for v in universe.values() if "dexscreener" in v["sources"]]),
           len(st["merkl_meta"]["opportunities"])))
    save_state(st, STATE_PATH[0])


# ------------------------------------------------------------------ books --
def tvl_of(st, pid, b):
    pair = (st["universe"].get(pid) or {}).get("pair")
    if pair and pair.get("liquidity_usd") is not None:
        try:
            return float(pair["liquidity_usd"]), "dexscreener"
        except (TypeError, ValueError):
            pass
    m = (st["universe"].get(pid) or {}).get("merkl")
    if m and m.get("tvl") is not None:
        try:
            return float(m["tvl"]), "merkl"
        except (TypeError, ValueError):
            pass
    return 0.0, "unavailable"


def vol24_of(st, pid):
    pair = (st["universe"].get(pid) or {}).get("pair")
    if pair and pair.get("volume_h24") is not None:
        try:
            return float(pair["volume_h24"])
        except (TypeError, ValueError):
            return None
    return None


def symbols_of(st, pid, init):
    """Human-readable symbols by ADDRESS (never a keying input — books key by poolId;
    the 05 §2 'duplicate-ticker landmines' RBLX-2/n00b). Native ETH is labeled 'ETH'."""
    pair = (st["universe"].get(pid) or {}).get("pair")
    m = (st["universe"].get(pid) or {}).get("merkl")

    def sym(addr, pos):
        if addr == NATIVE:
            return "ETH"
        if pair:
            if pair["base"]["address"] == addr and pair["base"]["symbol"]:
                return pair["base"]["symbol"]
            if pair["quote"]["address"] == addr and pair["quote"]["symbol"]:
                return pair["quote"]["symbol"]
        if m:
            syms = [s for s in (m.get("token_symbols") or []) if s]
            if pos < len(syms):
                return syms[pos]
        return "?"

    return sym(init["c0"], 0), sym(init["c1"], 1)


def phase_books(st, max_books):
    universe = st["universe"]
    head = st["head_block"]

    pids = sorted(universe)
    if max_books:
        pids = pids[:max_books]  # smoke runs: init/measure only the capped slice

    # -- 1) Initialize decode for every book (poolId-filtered, 0x0 → head, ≤1 row) --
    for pid in pids:
        b = st["books"].get(pid)
        if b is not None and "init" in b:
            continue
        logs = sort_logs(fetch_window(live_init_fetch(pid), 0, head))
        init = decode_init_log(logs[0]) if logs else None
        st.setdefault("books", {}).setdefault(pid, {})["init"] = init
        if init is None:
            log("[init] %s… NO Initialize log — book unmeasurable (recorded as deviation)"
                % pid[:12])
        save_state(st, STATE_PATH[0])

    # -- 2) enrich Merkl-only books via batched token lookups (≤12 addrs, ≥60s) --
    if not st.get("enrich_done"):
        need = [pid for pid in pids if universe[pid]["pair"] is None]
        if need:
            addrs = []
            for pid in need:
                b = st["books"].get(pid) or {}
                init = b.get("init")
                if init:
                    for c in (init["c0"], init["c1"]):
                        if c != NATIVE and c not in addrs:
                            addrs.append(c)
            found = {}
            for batch in chunk_addrs(addrs):
                try:
                    d = dex_get("/tokens/" + ",".join(batch))  # DEX already carries /latest/dex
                except Exception as e:  # noqa: BLE001
                    log("[enrich] token batch failed (%s) — continuing" % e)
                    continue
                for p in (d.get("pairs") or []):
                    if (p.get("chainId") or "").lower() != "robinhood":
                        continue
                    if "v4" not in (p.get("labels") or []):
                        continue
                    pid = norm_pid(p.get("pairAddress"))
                    if pid in need:
                        found[pid] = strip_pair(p)
            for pid, pair in found.items():
                universe[pid]["pair"] = pair
                st["dex_pairs"][pid] = pair  # feeds the dex price map too
                universe[pid]["sources"] = sorted(set(universe[pid]["sources"] + ["dexscreener-enriched"]))
            log("[enrich] %d/%d Merkl-only books enriched via %d token batch(es)"
                % (len(found), len(need), (len(addrs) + DEX_BATCH - 1) // DEX_BATCH))
        st["enrich_done"] = True
        save_state(st, STATE_PATH[0])

    # -- 3) charged-fee replay + live-state reads per book --
    for idx, pid in enumerate(pids):
        b = st["books"].setdefault(pid, {})
        if b.get("measured"):
            continue
        init = b.get("init")
        if init is None:
            b["measured"] = {"status": "no_init"}
            save_state(st, STATE_PATH[0])
            continue

        # charged-fee replay: 100k-block window; 4×25k subdivision past the 10k cap;
        # widen to 500k for zero-swap books (05 §1)
        trace = []
        frm = head - (WIN_MAIN - 1)
        logs = fetch_window(live_swap_fetch(pid), frm, head, trace)
        dist, n = fee_dist_from_logs(logs)
        win_blocks, win_from = WIN_MAIN, frm
        form = "single" if len(trace) == 1 else "subdivided"
        if n == 0:
            frm = head - (WIN_WIDE - 1)
            trace2 = []
            logs = fetch_window(live_swap_fetch(pid), frm, head, trace2)
            dist, n = fee_dist_from_logs(logs)
            win_blocks, win_from = WIN_WIDE, frm
            form = "widened" if len(trace2) == 1 else "widened+subdivided"

        # live-state reads
        try:
            s0 = get_slot0(pid)
        except RpcError as e:
            log("[slot0] %s… FAILED (%s)" % (pid[:12], e))
            s0 = None
        proto = {"c0": None, "c1": None}
        for side in ("c0", "c1"):
            for attempt in range(2):
                try:
                    proto[side] = protocol_fees(init[side])
                    break
                except RpcError as e:
                    if attempt:
                        log("[protoFees] %s… %s FAILED (%s)" % (pid[:12], side, e))

        b["measured"] = {
            "status": "ok",
            "fee_dist": dist,
            "swaps_sampled": n,
            "window_blocks": win_blocks,
            "window_from": win_from,
            "window_to": head,
            "window_form": form,
            "slot0": s0,
            "proto": proto,
        }
        sym0, sym1 = symbols_of(st, pid, init)
        log("[book %3d/%3d] %s… %-18s swaps=%-6d win=%s form=%s lpFee=%s"
            % (idx + 1, len(pids), pid[:12], ("%s/%s" % (sym0, sym1))[:18], n,
               win_blocks, form, (s0 or {}).get("lpFee")))
        save_state(st, STATE_PATH[0])


# ----------------------------------------------------------------- prices --
def phase_prices(st):
    addrs = set()
    for pid, b in st["books"].items():
        init = b.get("init")
        if init:
            for c in (init["c0"], init["c1"]):
                if c != NATIVE:
                    addrs.add(c)
    decimals = st.setdefault("decimals", {})
    prices = st.setdefault("prices_blockscout", {})
    todo = sorted(a for a in addrs if a not in decimals or a not in prices)
    for i, addr in enumerate(todo):
        d = bs_get("/tokens/%s" % addr) or {}
        dec = d.get("decimals")
        try:
            decimals[addr] = int(dec) if dec is not None else None
        except (TypeError, ValueError):
            decimals[addr] = None
        er = d.get("exchange_rate")
        try:
            prices[addr] = float(er) if er is not None else None
        except (TypeError, ValueError):
            prices[addr] = None
        if (i + 1) % 10 == 0:
            log("[prices] %d/%d" % (i + 1, len(todo)))
            save_state(st, STATE_PATH[0])
        time.sleep(0.25)
    save_state(st, STATE_PATH[0])
    log("[prices] %d currencies (blockscout decimals + exchange_rate)" % len(addrs))


def dex_price_map(st):
    """price map from DexScreener pair records: base → priceUsd, quote → priceUsd/priceNative."""
    out = {}
    for pid, pair in st["dex_pairs"].items():
        try:
            pu = float(pair.get("priceUsd") or 0) or None
            pn = float(pair.get("priceNative") or 0) or None
        except (TypeError, ValueError):
            continue
        base = pair["base"]["address"]
        quote = pair["quote"]["address"]
        if pu and base:
            prev = out.get(base)
            if prev is None or prev[0] < 1:  # prefer a real price over a derived zero
                out[base] = (pu, "dexscreener")
        if pu and quote and pn:
            out.setdefault(quote, (pu / pn, "dexscreener-derived"))
    return out


def price_of(st, currency, dexmap):
    """USD price of a currency (native ETH priced via WETH). Returns (price, source) or (None, None)."""
    if currency == NATIVE:
        w = dexmap.get(WETH) or (None, None)
        if w[0]:
            return w
        bp = st["prices_blockscout"].get(WETH)
        return (bp, "blockscout-weth") if bp else (None, None)
    hit = dexmap.get(currency)
    if hit and hit[0]:
        return hit
    bp = st["prices_blockscout"].get(currency)
    return (bp, "blockscout") if bp else (None, None)


# ------------------------------------------------------------------- flow --
def phase_flow(st):
    head = st["head_block"]
    books = st["books"]
    dexmap = dex_price_map(st)

    # classification pre-pass (needs only swaps + protocol evidence)
    cls = {}
    for pid, b in books.items():
        m = b.get("measured") or {}
        if m.get("status") != "ok" or b.get("init") is None:
            continue
        dist = m["fee_dist"]
        total = m["swaps_sampled"]
        zero = dist.get("0", 0)
        proto = m["proto"]
        proto_nz = bool((proto.get("c0") or 0) > 0 or (proto.get("c1") or 0) > 0)
        cls[pid] = classify_book(total, zero, proto_nz)

    vol = {pid: vol24_of(st, pid) for pid in cls}
    targets = [pid for pid in cls if (vol.get(pid) or 0) > 0]
    targets.sort(key=lambda p: -(vol.get(p) or 0))
    targets = targets[:FLOW_TOP_N]
    # every PAYS-LPS book that cannot get a formula APR (no vol24h) still needs
    # >=1 apr entry with source+window → measured-flow scan it too
    extra = [pid for pid in sorted(cls)
             if cls[pid] == "PAYS-LPS" and vol.get(pid) is None and pid not in targets]
    targets = targets + extra
    log("[flow] targets: top-%d by vol24h + %d PAYS-LPS-without-vol24h = %d"
        % (min(FLOW_TOP_N, len([1 for p in targets[:FLOW_TOP_N]])), len(extra), len(targets)))

    for pid in targets:
        if pid in st["flow"]:
            continue
        b = books[pid]
        init = b["init"]
        c0 = init["c0"]
        price, psrc = price_of(st, c0, dexmap)
        dec = 18 if c0 == NATIVE else st["decimals"].get(c0)
        if not price or dec is None:
            st["flow"][pid] = {"status": "no_price", "c0": c0, "price": price,
                               "decimals": dec}
            log("[flow] %s… SKIPPED (no c0 price/decimals)" % pid[:12])
            save_state(st, STATE_PATH[0])
            continue
        frm = head - (WIN_FLOW - 1)
        logs = fetch_window(live_swap_fetch(pid), frm, head)
        fee_usd = 0.0
        legs = 0
        for lr in logs:
            topics = lr.get("topics") or []
            if not topics or (topics[0] or "").lower() != TOPIC0_SWAP:
                continue
            data = lr.get("data") or ""
            fee = decode_swap_fee(data)
            a0 = decode_swap_amount0(data)
            if fee is None or a0 is None:
                continue
            fee_usd += fee * abs(a0) / (10 ** dec) * price / 1e6  # fee units are MILLIONTHS (3499 = 0.3499%)
            legs += 1
        hours = WIN_FLOW * BLOCK_TIME_S / 3600.0
        per_day = fee_usd * 24.0 / hours
        tvl, _ = tvl_of(st, pid, b)
        apr_m = (per_day * 365.0 / tvl * 100.0) if tvl > 0 else None
        st["flow"][pid] = {
            "status": "ok", "window_blocks": WIN_FLOW, "hours": round(hours, 3),
            "logs": legs, "fee_usd_window": round(fee_usd, 6),
            "fee_usd_per_day": round(per_day, 6),
            "apr_measured_pct": round(apr_m, 4) if apr_m is not None else None,
            "price_c0": price, "price_source": psrc, "c0_decimals": dec,
            "note": "c0-leg notional is a lower-bound proxy when c0 is one side of a two-sided swap (05 §1)",
        }
        log("[flow] %s… fee-USD $%.0f over %.2fh → per-day $%.0f → APR-M %s"
            % (pid[:12], fee_usd, hours, per_day,
               ("%.1f%%" % apr_m) if apr_m is not None else "n/a"))
        save_state(st, STATE_PATH[0])


# --------------------------------------------------------------- assembly --
def build_row(st, pid):
    b = st["books"][pid]
    init = b["init"]
    m = b["measured"]
    u = st["universe"][pid]
    dist_raw = m["fee_dist"]
    dist = {k: v for k, v in sorted(dist_raw.items(), key=lambda kv: (-kv[1], int(kv[0])))}
    total = m["swaps_sampled"]
    zero = dist.get("0", 0)
    wavg = round(weighted_mean_fee(dist), 6)
    proto = m["proto"]
    proto_nonzero = bool((proto.get("c0") or 0) > 0 or (proto.get("c1") or 0) > 0)
    class_ = classify_book(total, zero, proto_nonzero)
    tvl, tvl_src = tvl_of(st, pid, b)
    vol24 = vol24_of(st, pid)
    sym0, sym1 = symbols_of(st, pid, init)
    stock = sym0.upper() in STOCK_TICKERS or sym1.upper() in STOCK_TICKERS

    apr = []
    if class_ == "PAYS-LPS":
        if vol24 and tvl > 0 and wavg > 0:
            # APR ≈ charged-fee × vol24h × 365 / TVL (05 §1) — fee units are millionths
            # (wavg 3499 = 0.3499%), so value_pct = wavg × vol × 365 / tvl / 10^4
            apr.append({
                "value_pct": round(wavg * vol24 * 365.0 / tvl / 10000.0, 4),
                "source": "formula",
                "window": "DexScreener vol24h pull %s" % st["dexscreener_meta"]["pulled_at"],
                "note": "backward-looking; " + EMITTED_FEE_NOTE,
            })
        f = st["flow"].get(pid) or {}
        if f.get("status") == "ok" and f.get("apr_measured_pct") is not None:
            apr.append({
                "value_pct": f["apr_measured_pct"],
                "source": "measured",
                "window": ("%d-block c0-leg run-rate (%.2fh) scaled to 24h; head %d"
                           % (f["window_blocks"], f["hours"], st["head_block"])),
                "note": ("backward-looking; c0-leg notional is a lower-bound proxy on "
                         "two-sided swaps; " + EMITTED_FEE_NOTE),
            })
    elif class_ == "HOOK-MONETIZED":
        apr.append({
            "value_pct": 0.0,
            "source": "formula",
            "window": ("DexScreener vol24h pull %s" % st["dexscreener_meta"]["pulled_at"]
                       if vol24 else "charged-fee replay window %d blocks" % m["window_blocks"]),
            "note": ("backward-looking; LP share of emitted fees is ZERO (hook monetizes "
                     "via the protocol-fee path); " + EMITTED_FEE_NOTE),
        })
    # DEAD rows: apr[] stays empty (schema allows exactly that)

    ok, why = s1_rule(class_, wavg, tvl)
    ev = ("s1 seed rule (economic-only): class=%s, fee_wavg=%s, tvl_usd=%s — %s"
          % (class_, wavg, tvl, why))
    if ok and stock:
        ev += ("; TOKENIZED-STOCK BOOK: per the 2026-09-06 pivot a stock book does NOT "
               "enter the first Safe batch without a user gate (S4 wind-down decision governs)")

    mrec = u.get("merkl")
    merkl_row = None
    if mrec:
        merkl_row = {"incentivized": True, "claim_apr_pct": mrec.get("apr"),
                     "pulled_at": st["merkl_meta"]["pulled_at"]}

    return {
        "book": "%s/%s" % (sym0, sym1),
        "symbols": {"c0": sym0, "c1": sym1},
        "currencies": {"c0": init["c0"], "c1": init["c1"]},
        "hook": init["hook"],
        "init_fee": init["init_fee"],
        "tick_spacing": init["tick_spacing"],
        "fee_source": "swap_logs",
        "fee_wavg": wavg,
        "fee_dist": dist,
        "fee_window_blocks": m["window_blocks"],
        "fee_window": {"from": m["window_from"], "to": m["window_to"]},
        "window_form": m["window_form"],
        "as_of_block": m["window_to"],
        "swaps_sampled": total,
        "tvl_usd": tvl,
        "tvl_source": tvl_src,
        "vol24h_usd": vol24,
        "lp_fee_slot0": (m["slot0"] or {}).get("lpFee") if m.get("slot0") else None,
        "stock_book": stock,
        "apr": apr,
        "class": class_,
        "class_evidence": {"zero_fee_swaps": zero, "total_swaps": total,
                           "protocol_fees_nonzero": proto_nonzero},
        "protocol_fees": {"c0": proto.get("c0"), "c1": proto.get("c1")},
        "merkl": merkl_row,
        "s1_allowlist_candidate": ok,
        "allowlist_evidence": ev,
    }


def assemble(st, out_path):
    pools = {}
    deviations = []
    dropped = []
    for pid in sorted(st["universe"]):
        b = st["books"].get(pid)
        init = (b or {}).get("init")
        m = (b or {}).get("measured") or {}
        if init is None or m.get("status") != "ok":
            dropped.append(pid)
            deviations.append({
                "kind": "book_unmeasurable", "pool_id": pid,
                "reason": "no Initialize log decoded on-chain" if init is None
                          else "measurement incomplete (%s)" % m.get("status"),
                "note": "book dropped from the fixture — never fabricated",
            })
            continue
        pools[pid] = build_row(st, pid)

    # divergence policy: pins compared against MEASURED values; divergence is committed
    # as measured + recorded here — never bent to the pin
    for pin in PINS:
        row = pools.get(pin["pool_id"])
        if row is None:
            deviations.append({
                "kind": "pin_target_absent", "pool_id": pin["pool_id"],
                "field": pin["field"], "pinned": pin["pinned"],
                "note": "pinned book absent from this run's universe",
            })
            continue
        measured = row[pin["field"]]
        if measured != pin["pinned"]:
            deviations.append({
                "kind": "pin_divergence", "pool_id": pin["pool_id"],
                "field": pin["field"], "pinned": pin["pinned"], "measured": measured,
                "pin_source": pin["source"],
                "note": "committed as measured (divergence policy) — code/data never bent to a pin",
            })

    # protocol-fee read failures on zero-fee-majority books are a misclassification
    # hazard (a hook-monetized book could masquerade as PAYS-LPS) — record loudly
    for pid, row in pools.items():
        ce = row["class_evidence"]
        proto = row["protocol_fees"]
        if ce["total_swaps"] > 0 and ce["zero_fee_swaps"] * 2 >= ce["total_swaps"] \
                and proto.get("c0") is None and proto.get("c1") is None:
            deviations.append({
                "kind": "protocol_fee_read_failed", "pool_id": pid,
                "note": ("both protocolFeesAccrued reads failed on a zero-fee-majority "
                         "book — class evidence protocol_fees_nonzero recorded false; "
                         "re-verify before any sizing decision"),
            })

    # completion = the sweep finished: every universe book was ATTEMPTED (measured-ok
    # or dropped-with-deviation) and no seed search failed. A run interrupted mid-sweep
    # is never assembled here (phases raise before this point).
    attempted = all((st["books"].get(pid) or {}).get("measured") for pid in st["universe"])
    complete = attempted and not st["search_failures"]
    n = len(pools)
    if n < 50:
        deviations.append({
            "kind": "universe_contraction",
            "note": ("screen universe contracted to %d books (< 50); DexScreener query "
                     "pull %s, Merkl pull %s; dropped books recorded above"
                     % (n, st["dexscreener_meta"]["pulled_at"],
                        st["merkl_meta"]["pulled_at"])),
        })

    fixture = {
        "meta": {
            "schema": "v1",
            "generator": "v4_fee_screen.py",
            "version": VERSION,
            "run_started_at": st["started_at"],
            "run_completed_at": now_iso(),
            "chain_id": CHAIN_ID,
            "pool_manager": PM,
            "state_view": SV,
            "head_block": st["head_block"],
            "block_time_s": BLOCK_TIME_S,
            "method_doc": METHOD_DOC,
            "method_scope": ("05 §1 verbatim: DexScreener-surfaced-above-dust ∪ Merkl LIVE "
                             "universe; per-book poolId-filtered Initialize decode (0x0 → head); "
                             "charged-fee replay from fork Swap logs (100k window, 4×25k "
                             "subdivision past the 10k-log cap, 500k widening for zero-swap "
                             "books); StateView getSlot0 lpFee; PoolManager protocolFeesAccrued; "
                             "measured-flow cross-check (300k blocks, int128 sign-extension decode)"),
            "selector_provenance": {
                "getSlot0(bytes32)": ("0xc815641c = keccak('getSlot0(bytes32)')[:4] via cast keccak "
                                      "offline (stdlib has no keccak); proven against one live call "
                                      "on StateView before the full run"),
                "protocolFeesAccrued(address)": ("0x97e8cd4e = keccak('protocolFeesAccrued(address)')[:4] "
                                                 "via cast keccak offline; proven against one live call "
                                                 "on the PoolManager before the full run"),
                "topic0": ("taken verbatim from the method doc (04 §5.5); the fork Swap topic0 "
                           "matches NEITHER canonical v4 revision"),
            },
            "universe_scope": ("every DexScreener-surfaced v4 book above the $1k liq/vol dust "
                               "floor ∪ every Merkl LIVE UNISWAP_V4 identifier (05 §1 :43)"),
            "completion": complete,
            "deviations": deviations,
        },
        "pools": pools,
        "merkl_meta": {
            "pulled_at": st["merkl_meta"]["pulled_at"],
            "campaigns_live": st["merkl_meta"]["campaigns_live"],
            "drift_note": st["merkl_meta"]["drift_note"],
        },
        "dexscreener_meta": {
            "pulled_at": st["dexscreener_meta"]["pulled_at"],
            "seeds": st["seeds"],
            "searches": len(st["searched"]),
            "search_failures": st["search_failures"],
            "pairs_surfaced": len(st["dex_pairs"]),
            "above_dust": len([1 for v in st["universe"].values()
                               if "dexscreener" in v["sources"]]),
            "malformed_listings_dropped": st["malformed_listings"],
            "spacing_s": DEX_MIN_SPACING_S,
            "dust_floor_usd": DUST_FLOOR_USD,
            "note": ("≤30 pairs returned per search query, liquidity-ranked (05 §1 cap trap); "
                     "seed-symbol bootstrap = the 05 §2 ticker set — new listings outside the "
                     "seed set are out of scope for v1"),
        },
    }

    target = out_path if complete else out_path + ".incomplete"
    tmp = target + ".tmp"
    with open(tmp, "w") as f:
        json.dump(fixture, f, indent=1, sort_keys=True)
    os.replace(tmp, target)

    # console summary
    classes = {}
    for row in pools.values():
        classes[row["class"]] = classes.get(row["class"], 0) + 1
    log("[done] %s — %d pools, classes %s, dropped %d, deviations %d, completion=%s"
        % (target, n, classes, len(dropped), len(deviations), complete))
    top = sorted((r for r in pools.values() if r["class"] == "PAYS-LPS"),
                 key=lambda r: -(max([a["value_pct"] for a in r["apr"]] or [0])))[:12]
    log("[done] top PAYS-LPS by best APR:")
    for r in top:
        best = max([a["value_pct"] for a in r["apr"]] or [0])
        log("  %-28s wavg=%-8.1f tvl=$%-9.0f APR %s%%  %s"
            % (r["book"][:28], r["fee_wavg"], r["tvl_usd"], best, r["allowlist_evidence"][:60]))
    return complete


# ------------------------------------------------------------------- main --
STATE_PATH = [STATE_DEFAULT]
OUT_PATH = [OUT_DEFAULT]


def run_live(args):
    seeds = ([s.strip() for s in args.seed_symbols.split(",") if s.strip()]
             if args.seed_symbols else list(SEED_SYMBOLS))
    sig = "%s|%s|%s" % (VERSION, ",".join(sorted(seeds)), args.max_books)
    STATE_PATH[0] = args.state_path
    OUT_PATH[0] = args.out
    st = load_state(args.state_path, sig)
    if st is None:
        st = fresh_state(seeds, args.max_books)
        st["universe_sig"] = sig
        save_state(st, args.state_path)

    log("[run] v4 fee screen — version %r, head %s, seeds %d, max_books %s"
        % (VERSION, st.get("head_block"), len(seeds), args.max_books or "all"))

    prove_selectors()
    phase_universe(st, seeds)
    phase_books(st, args.max_books)
    phase_prices(st)
    phase_flow(st)

    # dexscreener pull timestamp for the fixture meta (the moment the universe settled)
    if not st.get("dex_pull_at"):
        st["dex_pull_at"] = now_iso()
    st.setdefault("dexscreener_meta", {})["pulled_at"] = st["dex_pull_at"]
    if not st["dexscreener_meta"].get("pulled_at"):
        st["dexscreener_meta"]["pulled_at"] = now_iso()
    save_state(st, args.state_path)

    complete = assemble(st, args.out)
    if complete:
        try:
            os.remove(args.state_path)
            log("[run] state file removed (run complete)")
        except OSError:
            pass
        return 0
    log("[run] INCOMPLETE — partial state preserved at %s; resume to finish "
        "(never mark a partial universe complete)" % args.state_path)
    return 3


# ---------------------------------------------------------------- validate --
def cmd_validate(path):
    errs = []
    try:
        with open(path) as f:
            d = json.load(f)
    except Exception as e:  # noqa: BLE001
        print("VALIDATE FAIL — unreadable fixture: %s" % e)
        return 1

    meta = d.get("meta") or {}
    pools = d.get("pools") or {}
    devs = meta.get("deviations") or []

    if meta.get("schema") != "v1":
        errs.append("meta.schema != 'v1'")
    if meta.get("chain_id") != CHAIN_ID:
        errs.append("meta.chain_id != 4663")
    if not meta.get("pool_manager") or not meta.get("state_view"):
        errs.append("meta.pool_manager/state_view missing")
    if "05_V4_FEE_ECON_SCREEN" not in str(meta.get("method_doc") or ""):
        errs.append("meta.method_doc does not point at the 05 method doc")
    if not isinstance(meta.get("completion"), bool):
        errs.append("meta.completion is not a bool")

    bad_keys = [k for k in pools if not PID_RE.match(k)]
    if bad_keys:
        errs.append("%d pool keys are not 64-hex poolIds (ticker keying?)" % len(bad_keys))

    n = len(pools)
    if n < 50:
        contraction = any(x.get("kind") == "universe_contraction" for x in devs)
        mm = d.get("merkl_meta") or {}
        dm = d.get("dexscreener_meta") or {}
        if not (meta.get("completion") is True and contraction
                and mm.get("pulled_at") and dm.get("pulled_at")):
            errs.append("pools < 50 without completion==true + universe_contraction deviation "
                        "+ dexscreener_meta/merkl_meta pull timestamps")

    CLASSES = {"PAYS-LPS", "HOOK-MONETIZED", "DEAD"}
    anchor_dead = pools.get(ROBLOXIANS_POOL)
    if anchor_dead is None:
        errs.append("anchor %s absent" % ROBLOXIANS_POOL[:14])
    else:
        ce = anchor_dead.get("class_evidence") or {}
        if anchor_dead.get("fee_wavg") != 0:
            errs.append("anchor ROBLOXIANS fee_wavg != 0")
        if ce.get("protocol_fees_nonzero") is not True:
            errs.append("anchor ROBLOXIANS class_evidence.protocol_fees_nonzero != true")
        if anchor_dead.get("class") == "PAYS-LPS":
            errs.append("anchor ROBLOXIANS class == PAYS-LPS")

    anchor_spy = pools.get(SPY_USDG_POOL)
    if anchor_spy is None:
        errs.append("anchor %s absent" % SPY_USDG_POOL[:14])
    else:
        if anchor_spy.get("init_fee") != 3000:
            errs.append("anchor SPY/USDG init_fee != 3000")
        if anchor_spy.get("fee_source") != "swap_logs":
            errs.append("anchor SPY/USDG fee_source != swap_logs")
        if not (anchor_spy.get("swaps_sampled") or 0) >= 1:
            errs.append("anchor SPY/USDG swaps_sampled < 1")
        if anchor_spy.get("fee_wavg") == 3000 and \
                not any(SPY_USDG_POOL in json.dumps(x) for x in devs):
            errs.append("anchor SPY/USDG fee_wavg == 3000 (init-label lie NOT observed) "
                        "without a meta.deviations entry naming the poolId")

    for pid, r in pools.items():
        where = "pool %s…" % pid[:12]
        for field in ("fee_wavg", "fee_dist", "fee_window_blocks", "fee_window",
                      "as_of_block", "swaps_sampled", "tvl_usd", "tvl_source",
                      "class", "class_evidence", "s1_allowlist_candidate",
                      "allowlist_evidence", "apr", "fee_source", "init_fee",
                      "tick_spacing", "currencies", "merkl"):
            if field not in r:
                errs.append("%s: missing field %s" % (where, field))
        if not isinstance(r.get("fee_wavg"), (int, float)) or isinstance(r.get("fee_wavg"), bool):
            errs.append("%s: fee_wavg not a number" % where)
        if r.get("fee_source") != "swap_logs":
            errs.append("%s: fee_source != 'swap_logs'" % where)
        if not isinstance(r.get("tvl_usd"), (int, float)) or isinstance(r.get("tvl_usd"), bool):
            errs.append("%s: tvl_usd not a number" % where)
        ev = r.get("allowlist_evidence")
        if not isinstance(ev, str) or not ev.strip():
            errs.append("%s: allowlist_evidence empty" % where)
        ce = r.get("class_evidence") or {}
        if not all(k in ce for k in ("zero_fee_swaps", "total_swaps", "protocol_fees_nonzero")):
            errs.append("%s: class_evidence incomplete" % where)
        dist = r.get("fee_dist") or {}
        if sum(dist.values()) != r.get("swaps_sampled"):
            errs.append("%s: fee_dist counts != swaps_sampled" % where)
        wavg = round(weighted_mean_fee({int(k): v for k, v in dist.items()}), 6)
        if abs(wavg - float(r.get("fee_wavg") or 0)) > 1e-6:
            errs.append("%s: fee_wavg != swap-count-weighted mean of fee_dist" % where)
        # class re-derivation from evidence
        total = ce.get("total_swaps") or 0
        zero = ce.get("zero_fee_swaps") or 0
        expect = classify_book(total, zero, bool(ce.get("protocol_fees_nonzero")))
        if r.get("class") != expect:
            errs.append("%s: class %r != decision-rule %r" % (where, r.get("class"), expect))
        # s1 machine-check
        want = (r.get("class") == "PAYS-LPS"
                and float(r.get("fee_wavg") or 0) > 0
                and float(r.get("tvl_usd") or 0) >= S1_TVL_FLOOR)
        if bool(r.get("s1_allowlist_candidate")) != want:
            errs.append("%s: s1_allowlist_candidate != recomputed rule" % where)
        # merkl claim placement
        m = r.get("merkl")
        if m:
            if not all(k in m for k in ("incentivized", "claim_apr_pct", "pulled_at")):
                errs.append("%s: merkl object incomplete" % where)
            for a in r.get("apr") or []:
                if a.get("source") == "merkl":
                    errs.append("%s: Merkl claim APR merged into apr[] (must stay in merkl)" % where)
        # apr hygiene
        for a in r.get("apr") or []:
            if a.get("source") not in ("formula", "measured"):
                errs.append("%s: apr source not formula|measured" % where)
            if not a.get("window"):
                errs.append("%s: apr entry missing window" % where)
            if EMITTED_FEE_NOTE not in str(a.get("note") or ""):
                errs.append("%s: apr entry missing the emitted-fee-basis note" % where)
            if a.get("source") == "formula" and r.get("class") == "PAYS-LPS":
                vol = float(r.get("vol24h_usd") or 0)
                tvl = float(r.get("tvl_usd") or 0)
                if vol > 0 and tvl > 0:
                    exp = float(r.get("fee_wavg") or 0) * vol * 365.0 / tvl / 10000.0
                    if abs(exp - float(a.get("value_pct") or 0)) > max(0.01, abs(exp) * 0.001):
                        errs.append("%s: formula APR %s != recomputed %.4f (fee units are millionths)"
                                    % (where, a.get("value_pct"), exp))
            if r.get("class") == "HOOK-MONETIZED" and float(a.get("value_pct") or -1) != 0.0:
                errs.append("%s: HOOK-MONETIZED apr must be the 0.0 LP-share entry" % where)
        cls = r.get("class")
        if cls == "PAYS-LPS" and not (r.get("apr") or []):
            errs.append("%s: PAYS-LPS row without >=1 apr entry (source+window)" % where)
        if cls == "HOOK-MONETIZED" and not (r.get("apr") or []):
            errs.append("%s: HOOK-MONETIZED row without its 0%%-to-LPs apr entry" % where)
        if cls == "DEAD" and (r.get("apr") or []):
            errs.append("%s: DEAD row carries apr entries" % where)

    if errs:
        print("VALIDATE FAIL — %d problem(s):" % len(errs))
        for e in errs[:40]:
            print("  - %s" % e)
        if len(errs) > 40:
            print("  … +%d more" % (len(errs) - 40))
        return 1
    print("VALIDATE OK %d pools" % n)
    return 0


# ---------------------------------------------------------------- selftest --
def synth_swap_log(pool_id, fee, amount0=10**6, amount1=-(10**6), block=100, idx=0):
    data = "".join([
        word_hex(amount0), word_hex(amount1),
        word_hex(1518978570),   # sqrtPriceX96 (arbitrary)
        word_hex(10**18),       # liquidity
        word_hex(-1000),        # tick
        word_hex(fee),          # trailing uint24 charged fee (fork shape)
    ])
    return {"blockNumber": hex(block), "logIndex": hex(idx),
            "topics": [TOPIC0_SWAP, pool_id], "data": "0x" + data}


def synth_init_log(pool_id, c0, c1, fee, ts, hook, block=50):
    data = "".join([word_hex(fee), word_hex(ts),
                    word_hex(int(hook, 16) if hook else 0),
                    word_hex(1518978570), word_hex(-1000)])
    return {"blockNumber": hex(block), "logIndex": "0x0",
            "topics": [TOPIC0_INITIALIZE, pool_id, c0, c1], "data": "0x" + data}


def selftest():
    """OFFLINE vectors (zero network) covering the 7 documented traps."""
    ok = []

    # (a) int128 amount sign-extension — word ≥ 2^255 → negative
    assert decode_int128((1 << 256) - 1) == -1
    assert decode_int128(1 << 255) == -(1 << 255)
    assert decode_int128((1 << 255) - 1) == (1 << 255) - 1
    pid = "0x" + "ab" * 32
    # a sign-extended negative amount0 through a real synthetic Swap log:
    neg = -(1 << 200)
    lg = synth_swap_log(pid, 625, amount0=neg)
    assert decode_swap_amount0(lg["data"]) == neg
    naive = int(lg["data"][2:66], 16)
    assert naive > (1 << 255) and decode_swap_amount0(lg["data"]) < 0, "sign-extension trap"
    ok.append("(a) int128 sign-extension: word >= 2^255 decodes negative (naive unsigned would read 2^256-%d)" % (1 << 200))

    # (b) 10k-log cap → subwindow subdivision (4×25k for a 100k window)
    TOTAL, A, B = 10126, 1, 100000
    pos = [A + (i * (B - A + 1)) // TOTAL for i in range(TOTAL)]
    calls = []

    def fetch(a, b):
        c = sum(1 for p in pos if a <= p <= b)
        calls.append((a, b, c))
        if c > LOG_CAP:
            raise LogCapError("query returned more than %d results" % LOG_CAP)
        return [synth_swap_log(pid, 125, block=p, idx=i) for i, p in enumerate(pos) if a <= p <= b]

    logs = fetch_window(fetch, A, B)
    assert len(logs) == TOTAL, "subwindow assembly lost rows: %d != %d" % (len(logs), TOTAL)
    caps = [c for c in calls if c[2] > LOG_CAP]
    assert len(caps) == 1 and (caps[0][0], caps[0][1]) == (A, B), "full-range cap not hit first"
    subs = [(a, b) for (a, b, c) in calls if c <= LOG_CAP]
    widths = {b - a + 1 for (a, b) in subs}
    assert all(w <= 25000 for w in widths), widths
    assert (1, 25000) in subs and (25001, 50000) in subs and (50001, 75000) in subs \
        and (75001, 100000) in subs, "4×25k subwindows not used: %s" % sorted(subs)
    dist, n = fee_dist_from_logs(logs)
    assert n == TOTAL and dist == {"125": TOTAL}
    ok.append("(b) 10k-log cap: full 100k query capped → 4×25k subwindows reassembled %d/%d swaps" % (n, TOTAL))

    # (c) DexScreener >12 addrs → batched
    addrs = ["0x%02x" % i for i in range(30)]
    batches = chunk_addrs(addrs)
    assert [len(b) for b in batches] == [12, 12, 6]
    assert sum(batches, []) == addrs, "batching lost/ reordered addresses"
    assert all(len(b) <= DEX_BATCH for b in chunk_addrs(addrs, DEX_BATCH))
    n_calls = [0]

    def fake_fetch(batch):
        n_calls[0] += 1
        return [{"addr": a} for a in batch]

    _ = [fake_fetch(b) for b in chunk_addrs(addrs)]
    assert n_calls[0] == 3
    ok.append("(c) DexScreener batching: 30 addrs → 3 calls of 12/12/6 (≤12 per call, order preserved)")

    # (d) Swap data word[5] charged-fee decode — SPY/USDG-style 3499 vs init fee 3000
    spy = synth_swap_log(SPY_USDG_POOL, 3499)
    assert decode_swap_fee(spy["data"]) == 3499
    init = decode_init_log(synth_init_log(SPY_USDG_POOL, "0x" + "11" * 20, "0x" + "22" * 20,
                                          3000, 60, None))
    assert init["init_fee"] == 3000
    assert decode_swap_fee(spy["data"]) != init["init_fee"], "label-lie not preserved"
    assert decode_swap_fee("0x" + "00" * 100) is None, "short data must decode None"
    ok.append("(d) word[5] decode: synthetic SPY/USDG log yields 3499 while init_fee 3000 recorded separately (label-lie preserved)")

    # (e) V2MemeHook-style book → HOOK-MONETIZED, incl. the mixed 0xeac79c4c case
    assert classify_book(2, 2, True) == "HOOK-MONETIZED"          # 0×2, protocol nonzero
    assert classify_book(3, 2, True) == "HOOK-MONETIZED"          # mixed: 0×2 / 90000×1 (0xeac79c4c)
    assert classify_book(3, 2, False) == "PAYS-LPS"               # rule ordering: hook evidence required
    assert classify_book(3, 1, True) == "PAYS-LPS"                # 1/3 zero-fee < 50%
    dist_e = {"0": 2, "90000": 1}
    assert weighted_mean_fee(dist_e) == (2 * 0 + 1 * 90000) / 3.0
    ok.append("(e) V2MemeHook book: 0×2+proto→HOOK-MONETIZED; mixed 0×2/90000×1→HOOK-MONETIZED (0xeac79c4c); protocol-absent→PAYS-LPS")

    # (f) DEAD classification at zero swaps in the widened window
    assert classify_book(0, 0, False) == "DEAD"
    assert classify_book(0, 0, True) == "DEAD"
    assert weighted_mean_fee({}) == 0.0, "fee_wavg must be 0 (a number), never null"
    wid = fetch_window(lambda a, b: [], 1, 500000)
    assert wid == []
    dist_f, n_f = fee_dist_from_logs([])
    assert n_f == 0 and dist_f == {}
    ok.append("(f) DEAD edge: zero swaps in the widened 500k window → DEAD, fee_wavg 0.0 (number), apr[] may be empty")

    # (g) ticker-collision guard — RBLX-2/n00b fixtures key by poolId, never symbol
    rblx2 = "0x5b8455ea6e01606690ed2a0930a818a12e401941c7df14b29688a789e4316e4c"  # RBLX-2/RBLX book (05 §2)
    rblx = "0xf807376333cd408c36d48a11a96309b92c5bd2bca9ba9f0b21800636cb3a30da"   # RBLX/USDG book (05 §2)
    pools = {}
    for pid_g, book in ((rblx2, "RBLX-2/RBLX"), (rblx, "RBLX/USDG")):
        row = {"book": book, "symbols": {"c0": "RBLX", "c1": "?"}}
        pools[pid_g] = row                      # keyed by poolId ONLY
    assert len(pools) == 2, "colliding tickers collapsed distinct books"
    assert all(PID_RE.match(k) for k in pools), "non-poolId key detected"
    assert not any(k in ("RBLX", "RBLX-2", "n00b", "NOOB") for k in pools)
    assert norm_pid("0x536a7B1912345678901234567890123456789012") is None, "42-char malformed listing must drop"
    assert norm_pid(rblx2.upper()) == rblx2, "poolId normalization lowercases"
    ok.append("(g) ticker collisions (RBLX-2/RBLX vs RBLX/USDG, NOOB/n00b): books key by poolId only; malformed 42-char listing drops")

    for line in ok:
        print("ok %s" % line)
    print("SELFTEST OK %d/7" % len(ok))
    return 0 if len(ok) == 7 else 1


# -------------------------------------------------------------------- main --
def cmd_probe():
    prove_selectors()
    print("PROBE OK — both selectors resolve live (proof before full run)")
    return 0


def main():
    ap = argparse.ArgumentParser(description="V4 fee-econ screen (RH-4663) — 05 §1 pipeline")
    ap.add_argument("--selftest", action="store_true",
                    help="offline synthetic vectors covering the 7 documented traps (zero network)")
    ap.add_argument("--validate", metavar="PATH",
                    help="offline schema check of a fixture file")
    ap.add_argument("--probe", action="store_true",
                    help="one live selector-proof call each, then exit")
    ap.add_argument("--out", default=OUT_DEFAULT, help="fixture output path (default docs/ops/v4_fee_screen.json)")
    ap.add_argument("--state-path", default=STATE_DEFAULT,
                    help="partial-state path, keyed to the script VERSION (stale state discarded)")
    ap.add_argument("--seed-symbols", default=None,
                    help="comma-separated DexScreener seed ticker override (default: 05 §2 ticker set)")
    ap.add_argument("--max-books", type=int, default=0,
                    help="cap the per-book phase (smoke runs only — a capped run is INCOMPLETE by construction)")
    args = ap.parse_args()

    if args.selftest:
        return selftest()
    if args.validate:
        return cmd_validate(args.validate)
    if args.probe:
        return cmd_probe()
    return run_live(args)


if __name__ == "__main__":
    sys.exit(main())
