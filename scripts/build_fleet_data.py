#!/usr/bin/env python3
"""build_fleet_data.py — the Fleet feed as a file (WS5-FLEET-DATA, identity revision #5).

Offline, stdlib-only, DETERMINISTIC builder: reads docs/ops/roam_policy_fixture.json
(the 95-book V4 fee-econ screen fixture, frozen 2026-09-04) and emits the static
same-origin feed site/data/fleet.json that site/js/fleet.js reads.

Determinism contract (goal GATE): running this script twice produces byte-identical
output — sorted keys, books sorted by poolId, and NO run-dependent value inside
books[]; provenance.generated (date only, no time) is the sole run-dependent field.

Honesty contract: the builder PARSES the fixture, it never re-hardcodes fixture
figures. A figure the fixture lacks is emitted as null — never estimated, never
interpolated. Tier semantics per the pinned screen classifier (docs/ops/v4_fee_screen.py):
DEAD iff no observed swaps; HOOK-MONETIZED iff fees are captured by the hook so the
LP share is 0; else PAYS-LPS.
"""

import json
import sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIXTURE_PATH = ROOT / "docs" / "ops" / "roam_policy_fixture.json"
OUT_PATH = ROOT / "site" / "data" / "fleet.json"

SOURCE_LABEL = "docs/ops/roam_policy_fixture.json"
UNWINDOWED = "unwindowed — do not quote as current"
MAX_BYTES = 40960  # goal gate: payload must stay <= 40KB

# OURS — the poolIds where OUR capital actually sits (WS5-OURS closeout,
# 2026-09-07, user directive: the badge is about capital placement, not the
# flagship's host pool). Keyed by poolId; EMPTY TODAY because $WELL is not
# deployed (it launches on Pons later — the WELL/ETH-vs-WETH pair is decided at
# the launch step; the graduated book's poolId is read from the launch tx and
# added here; the POL roamer books join the same list as S1 seeds them). When a
# poolId is added, the page badges that row OURS with its measured window — no
# different code path. build() REJECTS any entry whose poolId is not a live book
# (a typo can never mint a phantom badge).
OURS_STATUSES = {"LIVE", "SEEDED", "WINDING-DOWN"}
OURS = {
    # "0x<poolId>": {"pair": "WELL/ETH", "status": "LIVE", "note": "our seeded LP"},
}

TIER_BY_CLASS = {
    "PAYS-LPS": "PAYS",
    "HOOK-MONETIZED": "HOOK",
    "DEAD": "DEAD",
}

METHOD_ONE_LINER = (
    "feeAprPct prefers the fixture's measured APR-M run-rate, else its formula APR-F"
    " (locked formula on DexScreener vol24h); chargedFeeBps is the fixture's"
    " swap-count-weighted mean of the charged-fee dist; zero-swap books are never"
    " estimated"
)


def window_legend(extraction_rules):
    """The fixture's own measurement-window clause, verbatim. None when it has none.

    The win-key clause is not always a standalone rule — in the frozen fixture it is
    a semicolon-separated suffix of the swaps rule — so locate the clause anywhere.
    """
    marker = "window = "
    for rule in extraction_rules:
        idx = rule.find(marker)
        if idx != -1:
            return rule[idx + len(marker):].strip()
    return None


def window_note(book):
    key = book.get("window")
    return " (window %s)" % key if key else ""


def note_for(row, tier):
    """Short honest line: what was measured and what the source lacks."""
    if tier == "HOOK":
        note = "fees flow to the hook — LP earns 0"
    elif tier == "DEAD":
        note = "no swaps in the measured window — no fee stream"
    else:
        note = "charged-fee wavg %s bps over %s swaps" % (
            row.get("fee_wavg"),
            row.get("swaps"),
        )
    note += window_note(row)
    if row.get("vol24h_source") == "meas-flow-day-05":
        note += "; fixture vol24h is a measured $/day flow, not volume"
    if row.get("fee_wavg_source") == "prose-05":
        note += "; fee wavg from the 05 prose (truncated dist)"
    if tier != "DEAD" and row.get("apr_m") is None and row.get("apr_f") is None:
        note += "; no APR figure in source"
    return note


def pays_nothing_to_lps(tier):
    """HOOK: fees captured by the hook, LP share 0 (true). PAYS: charged fees reach
    LPs (false). DEAD: no fee stream exists to route (null — inapplicable)."""
    if tier == "HOOK":
        return True
    if tier == "PAYS":
        return False
    return None


def book_entry(row, windowed):
    try:
        tier = TIER_BY_CLASS[row["class"]]
    except KeyError:
        raise SystemExit("build_fleet_data: unknown fixture class %r — refusing to guess" % row.get("class"))

    apr_m = row.get("apr_m")
    apr_f = row.get("apr_f")
    fee_apr = apr_m if apr_m is not None else apr_f
    if not windowed:
        fee_apr = None  # unwindowed — do not quote as current

    # The 10 Merkl-only rows' vol24h column carries a measured $/day flow figure,
    # NOT volume — emitting it as vol24hUsd would mislabel the quantity. Null it.
    merkl_flow = row.get("vol24h_source") == "meas-flow-day-05"

    return {
        "pair": row["book"],
        "tier": tier,
        "poolId": row["poolId"],
        "feeAprPct": fee_apr,
        "tvlUsd": row.get("tvl"),
        "vol24hUsd": None if merkl_flow else row.get("vol24h"),
        "chargedFeeBps": row.get("fee_wavg"),
        "paysNothingToLps": pays_nothing_to_lps(tier),
        "note": note_for(row, tier),
    }


def build():
    fixture = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    rows = fixture.get("books") or []
    if not rows:
        raise SystemExit("build_fleet_data: fixture carries no books")

    pool_ids = [r.get("poolId") for r in rows]
    if any(not pid or not isinstance(pid, str) for pid in pool_ids):
        raise SystemExit("build_fleet_data: fixture row without a string poolId")
    if len(set(pool_ids)) != len(pool_ids):
        raise SystemExit("build_fleet_data: duplicate poolId in fixture — 1:1 join broken")

    legend = window_legend(fixture.get("meta", {}).get("extraction_rules", []))
    windowed = legend is not None

    books = [book_entry(r, windowed) for r in rows]
    books.sort(key=lambda b: b["poolId"])  # determinism: unique total order

    # WS5-OURS closeout (2026-09-07): tag each book with our-capital placement.
    # Reject phantom entries — every OURS poolId must be a real book (a typo can
    # never mint a badge), and each status must be a known word.
    live_ids = {b["poolId"] for b in books}
    for pid in OURS:
        if pid not in live_ids:
            raise SystemExit("build_fleet_data: OURS poolId %s is not a fixture book — refusing a phantom badge" % pid)
        status = OURS[pid].get("status")
        if status not in OURS_STATUSES:
            raise SystemExit("build_fleet_data: OURS %s status %r not in %s" % (pid, status, sorted(OURS_STATUSES)))
    for b in books:
        b["ours"] = OURS.get(b["poolId"])  # null (not absent) so the shape is uniform

    payload = {
        "provenance": {
            "generated": date.today().isoformat(),
            "source": SOURCE_LABEL,
            "method": METHOD_ONE_LINER,
            "window": legend if windowed else UNWINDOWED,
        },
        "summary": {
            "books": len(books),
            "paysLps": sum(1 for b in books if b["tier"] == "PAYS"),
            "hookMonetized": sum(1 for b in books if b["tier"] == "HOOK"),
            "dead": sum(1 for b in books if b["tier"] == "DEAD"),
            "ours": sum(1 for b in books if b.get("ours")),  # WS5-OURS: books with our capital
        },
        "books": books,
    }
    summary = payload["summary"]
    if summary["paysLps"] + summary["hookMonetized"] + summary["dead"] != summary["books"]:
        raise SystemExit("build_fleet_data: tier counts do not sum to book count")

    text = json.dumps(payload, indent=2, sort_keys=True, ensure_ascii=False) + "\n"
    encoded = text.encode("utf-8")
    if len(encoded) > MAX_BYTES:
        raise SystemExit(
            "build_fleet_data: payload %d bytes exceeds the %d-byte gate" % (len(encoded), MAX_BYTES)
        )

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_bytes(encoded)
    print("build_fleet_data: wrote %s (%d books, %d bytes)" % (OUT_PATH, len(books), len(encoded)))


if __name__ == "__main__":
    try:
        build()
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — offline tool: fail loudly, name the cause
        print("build_fleet_data: FAILED: %s" % exc, file=sys.stderr)
        raise SystemExit(1)
