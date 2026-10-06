#!/usr/bin/env python3
"""LOCAL-ONLY OPERATOR TOOL — builds site/data/label_lie.json (G4, 2026-10-06).

This is an ops tool, the same class as build_burn_tape.py: it is run by hand
from the repo root, it is never referenced by any site page or site script,
and nothing on the site links to it. The page at wellstreet.tech/label-lie
reads the committed data file; this builder is how the file is (re)made.

FAIL-CLOSED, in order, before anything is written:
  1. FIXTURE GATE: the sole data source is docs/ops/v4_fee_screen.json
     (FROZEN). Its md5 is checked against the pin below FIRST — on any
     mismatch the tool stops with FIXTURE-MD5-MISMATCH and writes nothing.
     No other file, no RPC call, no /tmp dependency feeds the build.
  2. HEAD GATE: fixture meta.head_block must equal the pinned as-of block
     56263800 and meta.chain_id must be 4663.
  3. COUNT PINS: books == 276 and divergent == 257 — the two numbers the
     shipped headline states. If the fixture ever changes under the pin,
     the build refuses rather than let a stale headline pose as truth.
  4. ALIAS GATE: the fully serialized document is scanned for the literal
     "name" (the JSON key spelling) — any hit aborts the write. This file
     carries pool ids only: no pool names, no token symbols, no hook names.

DETERMINISM: the output depends only on the frozen fixture's bytes. There
are no wall-clock timestamps anywhere in the document; re-running the tool
reproduces the committed file byte-for-byte (diff it after a re-run).

Row semantics (label vs measured, two independent sources):
  initFee  — the fee label decoded from the pool's Initialize log
             (fixture field init_fee), hundredths of a bip on a 1e6 scale.
  feeWavg  — the swap-count-weighted mean of fees actually charged on the
             sampled Swap logs (fixture field fee_wavg).
  diverges — initFee != feeWavg. The PAYS-LPS class itself comes from
             classify_book() in v4_fee_screen.py, which never reads
             initFee, so the divergence is a measured fact, not a
             definitional one (F2 hand-check, 2026-10-06).

Usage:  python3 docs/ops/build_label_lie.py
"""

import hashlib
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
FIXTURE_PATH = REPO_ROOT / "docs" / "ops" / "v4_fee_screen.json"
OUT_PATH = REPO_ROOT / "site" / "data" / "label_lie.json"

PINNED_FIXTURE_MD5 = "92c54bd870d72fb4dc1d9a6b586ef650"
PINNED_HEAD_BLOCK = 56263800
PINNED_CHAIN_ID = 4663
PINNED_BOOKS = 276
PINNED_DIVERGENT = 257

HOOKLESS = "0x0"
MASK_BITS = 0x3FFF  # hook permission bits live in the low 14 bits


def fail(message):
    sys.stderr.write("BUILD-ABORT: " + message + "\n")
    sys.exit(1)


def mask_of(hook):
    """Low 14 bits of the hook address, hex; 0x0 for a hookless book."""
    return "0x%x" % (int(hook, 16) & MASK_BITS)


def main():
    # ---- 1. FIXTURE GATE (always first, before any other work) ----------
    try:
        fixture_bytes = FIXTURE_PATH.read_bytes()
    except OSError as exc:
        fail("cannot read the fixture: %s" % exc)
    digest = hashlib.md5(fixture_bytes).hexdigest()
    if digest != PINNED_FIXTURE_MD5:
        fail(
            "FIXTURE-MD5-MISMATCH got %s want %s for %s — the fixture moved; "
            "stop and re-adjudicate before rebuilding"
            % (digest, PINNED_FIXTURE_MD5, FIXTURE_PATH)
        )

    fixture = json.loads(fixture_bytes.decode("utf-8"))
    meta = fixture.get("meta") or {}
    pools = fixture.get("pools") or {}

    # ---- 2. HEAD + CHAIN GATES ------------------------------------------
    if meta.get("head_block") != PINNED_HEAD_BLOCK:
        fail(
            "fixture head_block %r != pinned %d"
            % (meta.get("head_block"), PINNED_HEAD_BLOCK)
        )
    if meta.get("chain_id") != PINNED_CHAIN_ID:
        fail("fixture chain_id %r != pinned %d" % (meta.get("chain_id"), PINNED_CHAIN_ID))
    if not pools:
        fail("fixture carries no pools")

    # ---- rows ------------------------------------------------------------
    rows = []
    for pool_id in sorted(pools.keys()):
        book = pools[pool_id]
        if book.get("class") != "PAYS-LPS":
            continue
        hook = book.get("hook")
        if hook:
            hook = str(hook).lower()
        else:
            hook = HOOKLESS
        init_fee = int(book.get("init_fee") or 0)
        fee_wavg = float(book.get("fee_wavg") or 0.0)
        diverges = init_fee != fee_wavg
        delta = init_fee - fee_wavg
        pct = round(abs(delta) / fee_wavg * 100.0, 2) if fee_wavg > 0.0 else None
        rows.append(
            {
                "poolId": pool_id,
                "hook": hook,
                "mask": mask_of(hook),
                "initFee": init_fee,
                "feeWavg": fee_wavg,
                "diverges": diverges,
                "delta": delta,
                "pctOfMeasured": pct,
            }
        )

    books = len(rows)
    divergent = sum(1 for r in rows if r["diverges"])
    agree = books - divergent
    over_half = sum(
        1 for r in rows if r["feeWavg"] > 0.0 and abs(r["delta"]) > r["feeWavg"] / 2.0
    )

    # ---- 3. COUNT PINS (the numbers the shipped headline states) ---------
    if books != PINNED_BOOKS:
        fail("PAYS-LPS books %d != pinned %d" % (books, PINNED_BOOKS))
    if divergent != PINNED_DIVERGENT:
        fail(
            "divergent books %d != pinned %d — the shipped headline states %d; "
            "re-adjudicate before rebuilding" % (divergent, PINNED_DIVERGENT, PINNED_DIVERGENT)
        )

    document = {
        "meta": {
            "asOfBlock": PINNED_HEAD_BLOCK,
            "chainId": PINNED_CHAIN_ID,
            "fixture": "docs/ops/v4_fee_screen.json",
            "fixtureMd5": PINNED_FIXTURE_MD5,
            "unit": "fees in hundredths of a bip on a 1e6 scale: 10000 = 1 percent of the swapped amount",
            "classRule": "PAYS-LPS per classify_book in docs/ops/v4_fee_screen.py — DEAD iff swaps_sampled == 0; HOOK-MONETIZED iff zero_fee_swaps*2 >= swaps_sampled and protocol_fees_nonzero; else PAYS-LPS. The class never reads initFee.",
            "labelRule": "initFee is the fee label decoded from the pool's Initialize log (fixture field init_fee)",
            "measuredRule": "feeWavg is the swap-count-weighted mean of fees charged on the sampled Swap logs (fixture field fee_wavg)",
            "divergenceRule": "diverges == (initFee != feeWavg); counts.divergeOverHalf counts rows where abs(initFee - feeWavg) > feeWavg / 2",
            "maskRule": "mask = the hook address's low 14 bits in hex; the literal 0x0 when the book has no hook",
            "aliasPolicy": "pool ids only: no pool names, no token symbols, no hook names anywhere in this file",
            "f2HandCheck": "F2 hand-check 2026-10-06: 3 sample books checked raw initFee vs raw feeWavg straight from the fixture before any headline shipped; verdict: the divergence is measured, not definitional — 257 of 276 PAYS-LPS books disagree, 19 agree exactly",
            "counts": {
                "books": books,
                "divergent": divergent,
                "agree": agree,
                "divergeOverHalf": over_half,
            },
        },
        "rows": rows,
    }

    serialized = json.dumps(document, indent=2) + "\n"

    # ---- 4. ALIAS GATE (pool ids only, all the way down) ------------------
    if '"name"' in serialized:
        fail('the serialized document carries the literal "name" — alias policy violated')

    OUT_PATH.write_text(serialized, encoding="utf-8")
    print(
        "LABEL-LIE-OK books=%d divergent=%d agree=%d overHalf=%d bytes=%d -> %s"
        % (books, divergent, agree, over_half, len(serialized), OUT_PATH)
    )


if __name__ == "__main__":
    main()
