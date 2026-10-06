#!/usr/bin/env python3
"""BUILD-BURN-TAPE (G5 BURN-TAPE-SKELETON, 2026-10-06) -- LOCAL-ONLY ops tool.

Pulls the burn lane's event tape from chain 4663 over the keyless RPC and
writes site/data/burn_tape.json -- the file the Burn Tape page and the manual
chapter ship as data. This script is an OPERATOR TOOL and is never wired into
the site: the page reads its figures LIVE from the chain (shared rpc seam) and
loads this committed JSON only for the tape rows. Zero rows is the honest
state (the W2 learned rule): before the first sweepToBurn the tape is empty,
and that emptiness ships with an as-of meta block -- it is the truth, not a
stale marker to purge.

Sources (all keyless, read-only, eth_getLogs on the roamer):
  - event Burned(address indexed sourceToken, uint256 wellBought,
                 uint256 wellBurned)   (src/RoamingHarvester.sol:293)
    wellBurned is the exact amount transferred to the dEaD address; it becomes
    the row's amountWELL as an exact decimal string (never a float).
  - event SweepSkipped(address indexed token, bytes32 reason)
                                       (src/RoamingHarvester.sol:298)
    F-3 per-token liveness telemetry: one unrouteable token never bricks the
    rest of the burn tail. Recorded in the meta block -- a skip is never
    rendered as a burn.

Fail-closed discipline: every address pin is cross-checked against
site/js/config.js (THE single address source) and the dEaD constant against
src/RoamingHarvester.sol BEFORE any network call; a chain-id mismatch or a
malformed log aborts the whole write (never a partial tape).

Range discipline: the keyless RPC caps eth_getLogs at 10,000,000 blocks per
request (observed 2026-10-06: "query spans 81454808 blocks, but only 10000000
are allowed"). A bare fromBlock 0x0 full-range pull is refused, so the scan
resolves the head first and walks fixed 9M-block windows; any window that
fails or returns a non-list aborts the whole write -- never a partial tape.

Usage: python3 docs/ops/build_burn_tape.py [--rpc URL] [--out PATH]
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parents[2]  # docs/ops/build_burn_tape.py -> repo root

# ---------------------------------------------------------------- pins -----
# Addresses are pinned here ONLY as mirrors of site/js/config.js; the
# fail-closed self-check below aborts if the config ever moves them.
CHAIN_ID = 4663
DEFAULT_RPC = "https://rpc.mainnet.chain.robinhood.com"
ROAMER = "0xC7a21Aa8C15C7032eE2e8352244a0f3D2154dC68"    # config.js roamStack.roamer
WELL = "0x5d08c35BcF268f4031BF3898e42b895Ff0779a24"      # config.js tokens.well.address
VAULT = "0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86"     # config.js roamStack.vault
DEAD = "0x000000000000000000000000000000000000dEaD"      # src/RoamingHarvester.sol:156 BURN_ADDRESS
WELL_DECIMALS = 18  # config.js tokens.well.decimals, eth_call-verified 2026-09-28

# Event topic0 constants (keccak of the event signatures), derived with:
#   cast keccak "Burned(address,uint256,uint256)"
#   cast keccak "SweepSkipped(address,bytes32)"
# Verified 2026-10-06; site/burn-tape/index.html carries the same constants and
# site-tests/burn-tape.test.js cross-pins the two files together.
BURNED_TOPIC = "0x23ff0e75edf108e3d0392d92e13e8c8a868ef19001bd49f9e94876dc46dff87f"
SWEEP_SKIPPED_TOPIC = "0x5cc0d130ea68954f3b0a05ff7c20becf3cf6c6f234bd1cdf36a658797e3827c5"

# eth_getLogs window width -- strictly under the endpoint's 10,000,000-block
# range cap (observed 2026-10-06).
CHUNK_BLOCKS = 9_000_000

ROW_LABEL = "burn lane sweep -- accrual swapped to WELL, transferred to the dEaD address"


def fail_closed_pins() -> None:
    """Abort before any network call if a pin has drifted from its source."""
    config = (REPO_ROOT / "site" / "js" / "config.js").read_text(encoding="utf-8")
    for label, addr in (
        ("roamStack.roamer", ROAMER),
        ("tokens.well.address", WELL),
        ("roamStack.vault", VAULT),
    ):
        if addr not in config:
            sys.exit("fail-closed: pin %s (%s) is no longer present in site/js/config.js"
                     % (label, addr))
    harvester = (REPO_ROOT / "src" / "RoamingHarvester.sol").read_text(encoding="utf-8")
    if DEAD.lower() not in harvester.lower():
        sys.exit("fail-closed: the dEaD constant (%s) is no longer pinned in "
                 "src/RoamingHarvester.sol (BURN_ADDRESS)" % DEAD)


def rpc(rpc_url: str, method: str, params: list, attempts: int = 3):
    payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method,
                          "params": params}).encode("utf-8")
    last = None
    for i in range(attempts):
        try:
            req = urllib.request.Request(
                rpc_url, data=payload, headers={
                    "Content-Type": "application/json",
                    "User-Agent": "wellstreet-ops build_burn_tape/1.0 (keyless, read-only)",
                })
            with urllib.request.urlopen(req, timeout=30) as resp:
                out = json.loads(resp.read().decode("utf-8"))
            if "error" in out:
                raise RuntimeError("RPC error %s" % (out["error"],))
            return out["result"]
        except Exception as exc:  # noqa: BLE001 -- retry, then fail closed
            last = exc
            time.sleep(1.5 * (i + 1))
    sys.exit("fail-closed: %s failed after %d attempts: %s" % (method, attempts, last))


def scan_logs(rpc_url: str, address: str, topic: str, head: int) -> list:
    """Full-history eth_getLogs in fixed windows under the RPC range cap.

    Any failed or malformed window aborts (fail-closed) -- a partial history
    would understate the tape, and an understated tape is a false claim.
    """
    logs = []
    lo = 0
    while lo <= head:
        hi = min(lo + CHUNK_BLOCKS - 1, head)
        batch = rpc(rpc_url, "eth_getLogs", [{
            "address": address, "topics": [topic],
            "fromBlock": hex(lo), "toBlock": hex(hi)}])
        if not isinstance(batch, list):
            sys.exit("fail-closed: eth_getLogs window %d-%d returned a non-list "
                     "-- aborting, never a partial tape" % (lo, hi))
        logs.extend(batch)
        lo = hi + 1
    return logs


def topic_to_addr(topic: str) -> str:
    return "0x" + topic[-40:]


def data_word(data: str, index: int) -> int:
    raw = data[2 + 64 * index:2 + 64 * (index + 1)]
    if len(raw) != 64:
        sys.exit("fail-closed: malformed log data word %d (len %d) -- aborting, "
                 "never a partial tape" % (index, len(raw)))
    return int(raw, 16)


def exact_amount(wei: int, decimals: int = WELL_DECIMALS) -> str:
    """Exact decimal string from an integer wei amount -- never a float."""
    whole, frac = divmod(wei, 10 ** decimals)
    if frac == 0:
        return str(whole)
    return "%d.%s" % (whole, str(frac).zfill(decimals).rstrip("0"))


def reason_text(word_hex: str) -> str:
    raw = bytes.fromhex(word_hex)
    return "".join(chr(b) for b in raw if 32 <= b < 127).strip()


def main() -> None:
    ap = argparse.ArgumentParser(description="Rebuild site/data/burn_tape.json "
                                             "(LOCAL-ONLY operator tool)")
    ap.add_argument("--rpc", default=DEFAULT_RPC, help="keyless JSON-RPC endpoint")
    ap.add_argument("--out", default=str(REPO_ROOT / "site" / "data" / "burn_tape.json"))
    args = ap.parse_args()

    fail_closed_pins()

    chain = int(rpc(args.rpc, "eth_chainId", []), 16)
    if chain != CHAIN_ID:
        sys.exit("fail-closed: chain id %d != %d -- wrong endpoint" % (chain, CHAIN_ID))

    to_block = int(rpc(args.rpc, "eth_blockNumber", []), 16)
    burned = scan_logs(args.rpc, ROAMER, BURNED_TOPIC, to_block)
    skipped = scan_logs(args.rpc, ROAMER, SWEEP_SKIPPED_TOPIC, to_block)

    rows = []
    for lg in burned:
        if len(lg.get("topics", [])) < 2:
            sys.exit("fail-closed: Burned log without a sourceToken topic -- aborting")
        rows.append({
            "block": int(lg["blockNumber"], 16),
            "logIndex": int(lg["logIndex"], 16),
            "tx": lg["transactionHash"],
            "sourceToken": topic_to_addr(lg["topics"][1]),
            "amountWELL": exact_amount(data_word(lg["data"], 1)),
            "label": ROW_LABEL,
        })
    rows.sort(key=lambda r: (r["block"], r["logIndex"]))

    skips = []
    for lg in skipped:
        skips.append({
            "block": int(lg["blockNumber"], 16),
            "tx": lg["transactionHash"],
            "token": topic_to_addr(lg["topics"][1]),
            "reasonHex": "0x" + lg["data"][2:66],
            "reasonText": reason_text(lg["data"][2:66]),
        })

    doc = {
        "meta": {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "method": ("chunked eth_getLogs (Burned + SweepSkipped) on the roamer, "
                       "keyless RPC; 9M-block windows under the 10M-block range "
                       "cap observed 2026-10-06"),
            "chain": CHAIN_ID,
            "rpc": urlparse(args.rpc).netloc,
            "roamer": ROAMER,
            "well": WELL,
            "dead": DEAD,
            "fromBlock": 0,
            "toBlock": to_block,
            "burnedCount": len(rows),
            "sweepSkippedCount": len(skips),
            "skips": skips,
            "wellDecimals": WELL_DECIMALS,
            "sourceFiles": ["site/js/config.js", "src/RoamingHarvester.sol"],
            "tool": "docs/ops/build_burn_tape.py (LOCAL-ONLY; never wired into the site)",
        },
        "rows": rows,
    }

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    tmp = out_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, out_path)

    print("burn_tape: %d Burned row(s), %d SweepSkipped event(s), "
          "as of block %d -> %s" % (len(rows), len(skips), to_block, out_path))


if __name__ == "__main__":
    main()
