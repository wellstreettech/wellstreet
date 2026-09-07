#!/usr/bin/env python3
"""ROAM-POLICY-RESTORE — roam-policy backtest: calibration + S1 migrate() design inputs.

Stdlib-only, keyless, NO network access, deterministic (no randomness, no clocks in
the math). Frozen calibration corpus: docs/ops/roam_policy_fixture.json = the
05_V4_FEE_ECON_SCREEN_2026-09-04.md §2 95-book probe table (2026-09-04 snapshot).

Authority:
  - goal: ROAM-POLICY-RESTORE in docs/inventory/GOALS_FROM_INVENTORY_2026-09-06_agentfocus2.md
  - deep-dive merge (BINDING): docs/internal/DEEP_DIVE_TOP8_ROAM_POLICY_2026-09-06.md
    rank 6 (rule family + sequential migrate() replay harness + median-of-windows
    mean / 5% CVaR scoring) and rank 2 (TWO-METRIC DOMINANCE: net fee-APR after
    realized IL AND exposure-tracking, simultaneous improvement required).
  - WARNING honored: NO RL/neural policies (the papers' own closed-form baselines
    beat learned policies; the PPO method is not adopted).

Honesty rules: every measured number carries source+window via the fixture; ALL
slippage / IL / sigma / migrationFeeBps values here are LABELED SCENARIO PARAMETERS,
never quoted as measured. All fee-APR figures are compensation-leg only, backward-
looking (arXiv 2608.13340 Prop 2 label; 05 §1).

Modes:
  --selftest  validate the fixture (count==95, 3 poolId-prefix anchors) -> prints
              "SELFTEST_OK books=95 anchors=3"
  (default)   POLICY-CALIBRATION grid + cap-drag rows + 15 break-even rows +
              42 DIRECTION-CHECK lines + RULE-FAMILY-REPLAY with two-metric dominance
"""

import argparse
import json
import statistics
import sys
from pathlib import Path

FIXTURE = Path(__file__).resolve().parent / "roam_policy_fixture.json"

# 05 §6 item 2 target booklist (frozen calibration corpus; surrogate status disclosed
# in 07_ROAM_POLICY_BACKTEST_2026-09-06.md §5) — 7 books, 42 ordered pairs.
TARGETS = [
    "fe2a80bb",  # SPY/USDG   (05 flagship)
    "cc2a903a",  # SPY/MU
    "4c862e58",  # SPY/TSM
    "bc732a1a",  # SPY/NVDA
    "f8073763",  # RBLX/USDG
    "bac3aa3b",  # USDG/ETH
    "24107d15",  # USDG/ETH
]

THRESHOLDS_BPS = [5, 10, 25, 50, 100]           # MIN_EXPECTED_GAIN_BPS grid
COST_SCENARIOS = [(5, 0), (25, 50), (100, 500)]  # (slippage_bps, crystallized_IL_bps) scenarios
HOLDS_DAYS_GRID = [1, 7, 30]                     # grid min_hold values
HOLDS_DAYS_DIRECTION = [30, 7, 1]                # DIRECTION cell order: hold30 -> hold7 -> hold1
CAPS_PER_YEAR = [4, 52, 365]                     # MAX_MIGRATIONS_PER_PERIOD cap rows
INCUMBENT = "fe2a80bb"                           # replay starts deployed in the 05 flagship

# Deliverable-6 sensitivity grid: migrationFeeBps values priced per cost scenario.
# CALIBRATION ONLY — the OPERATING migrationFeeBps is Safe-queued with the hard cap
# fixed at deploy (2000 bps) and RE-PRICED from S2's live fee-screen feed before
# go-live (07 §5(iv)); the frozen-snapshot grid is never quoted as operating policy.
FEE_BPS_GRID = [0, 250, 500, 1000, 2000]

# Rule-family scenario constants (deep-dive rank 6 shape; VALUES are scenarios, not
# measurements — the measured migration-cost probe is an S1 build-gate input).
MIGRATION_FEE_BPS = 1000   # S1's visible roaming exit take scenario (10% expressed in bps)
H0_BPS = 0.0               # inaction-region base
K1 = 1.0                   # h* widens 1:1 (bps) with total per-migration cost (bps)
K2_BPS_PER_SIGMA = 2500.0  # h* widens 2500 bps per unit annualized sigma (scenario)
SIGMA_SCENARIOS = [0.2, 0.5, 0.8, 1.0]  # annualized vol scenarios (decimal), not measured;
                                        # 1.0 > SIGMA_CEILING exercises the no-deploy gate
SIGMA_CEILING = 0.8        # no-deploy arm: sigma above ceiling -> do not deploy
T_BARE_BPS = 5.0           # trailing fee-APR comparison arm: bare threshold, no cost term
WEEK_CAP = 1               # on-chain weekly cap scenario: 1 migration per rolling week
WINDOWS = 52               # replay horizon: 52 weekly decision windows (1 year)
CVAR_TAIL_N = max(1, WINDOWS // 20)  # 5% CVaR tail count over 52 windows -> 2


def load_fixture():
    with open(FIXTURE, "r") as f:
        data = json.load(f)
    books = data["books"] if isinstance(data, dict) else data
    if len(books) != 95:
        raise SystemExit("FATAL: fixture must hold exactly 95 books, got %d" % len(books))
    idx = {}
    for rec in books:
        idx[rec["poolId"][2:10]] = rec
    return data, idx


def selftest():
    data, idx = load_fixture()
    anchors = 0
    a = idx["3280b21b"]  # ROBLOXIANS/RBLX — dist "0×394" fully listed -> weighted mean 0
    if a["class"] == "HOOK-MONETIZED" and a["fee_wavg"] == 0.0:
        anchors += 1
    a = idx["24107d15"]
    if a["apr_f"] == 348 and a["vol24h"] == 35605482 and a["tvl"] == 466721:
        anchors += 1
    a = idx["fe2a80bb"]
    if a["apr_f"] == 83:
        anchors += 1
    print("SELFTEST_OK books=%d anchors=%d" % (len(data["books"]), anchors))
    return 0 if anchors == 3 else 1


def gain_bps(d_apr_pp, hold_days):
    """expected-gain over a hold, in bps: (apr_f_to - apr_f_from) * hold/365, pp -> bps."""
    return d_apr_pp * 100.0 * hold_days / 365.0


def print_grid(apr):
    print("GRID threshold_bps in %s x cost(slippage_bps,IL_bps) in %s x min_hold_days in %s"
          % (THRESHOLDS_BPS, COST_SCENARIOS, HOLDS_DAYS_GRID))
    print("GRID cell verdict: MIGRATE iff (apr_f_to-apr_f_from)*hold/365*100 >= slippage+IL "
          "AND >= threshold_bps, else HOLD (scenario parameters, not measurements)")
    for t in THRESHOLDS_BPS:
        for (s, il) in COST_SCENARIOS:
            cost = s + il
            for h in HOLDS_DAYS_GRID:
                mig = 0
                for f in TARGETS:
                    for to in TARGETS:
                        if f == to:
                            continue
                        g = gain_bps(apr[to] - apr[f], h)
                        if g >= cost and g >= t:
                            mig += 1
                print("GRID T=%d cost=(%d,%d) hold=%dd migrate=%d/42" % (t, s, il, h, mig))


def print_cap_drag():
    print("CAP MAX_MIGRATIONS_PER_PERIOD cap rows — worst-case annual cost drag = cap x cost_bps "
          "(scenario; cap enforced ON-CHAIN per deep-dive rank 7 adaptive-adversary result)")
    for cap in CAPS_PER_YEAR:
        for (s, il) in COST_SCENARIOS:
            print("CAP cap=%d/yr cost=(%d,%d) worst_case_annual_cost_drag_bps=%d"
                  % (cap, s, il, cap * (s + il)))


def print_break_even(apr):
    print("BREAK-EVEN hold=7d GLOBAL (pair-independent): break_even_T_bps = cost_bps x 365/7 = the "
          "annualized delta-APR-F a 7d-hold migration must clear to recoup per-migration cost; "
          "pairs_7d_gain_ge_T = count of the 42 ordered pairs whose 7d expected gain >= T")
    rows = 0
    for t in THRESHOLDS_BPS:
        for (s, il) in COST_SCENARIOS:
            cost = s + il
            be = cost * 365.0 / 7.0
            cnt = sum(1 for f in TARGETS for to in TARGETS
                      if f != to and gain_bps(apr[to] - apr[f], 7) >= t)
            print("BREAK-EVEN T=%d cost=(%d,%d) break_even_T_bps=%.1f pairs_7d_gain_ge_T=%d/42"
                  % (t, s, il, be, cnt))
            rows += 1
    print("BREAK-EVEN-ROWS=%d" % rows)


def direction_cells(d_pp):
    cells = []
    for h in HOLDS_DAYS_DIRECTION:
        g = gain_bps(d_pp, h)
        results = [(g >= (s + il), s, il) for (s, il) in COST_SCENARIOS]
        if all(ok for ok, _s, _il in results):
            cells.append("PASS@hold%d-allcost" % h)
        else:
            for ok, s, il in results:
                cells.append("%s@hold%d-cost(%d,%d)" % ("PASS" if ok else "BLOCK", h, s, il))
    return cells


def print_direction(apr):
    print("DIRECTION-CHECK grammar: one line per ordered target pair; PASS iff "
          "(apr_f_to-apr_f_from)*hold/365*100 >= slippage+IL (T excluded); cells ordered "
          "hold30->hold7->hold1, cost scenarios fixed order (5,0),(25,50),(100,500); "
          "delta-APR-F <= 0 -> BLOCK-ALL, no cells")
    for f in TARGETS:
        for to in TARGETS:
            if f == to:
                continue
            d = apr[to] - apr[f]
            if d <= 0:
                print("DIRECTION-CHECK %s->%s=BLOCK-ALL" % (f, to))
            else:
                print("DIRECTION-CHECK %s->%s=%s" % (f, to, " ".join(direction_cells(d))))


def cvar5(series):
    tail = sorted(series)[:CVAR_TAIL_N]
    return sum(tail) / float(len(tail))


def run_replay(apr, rule, sigma, cost, fee_bps=None):
    """Sequential migrate() replay over the frozen snapshot: 52 weekly decision windows,
    roamer starts in INCUMBENT, at each window evaluates the arm trigger and fires
    migrate(from, to) to the best-passing candidate, paying the FULL migration cost
    (slippage + migrationFeeBps + crystallized IL, scenario) once per migration.
    Weekly cap: <= WEEK_CAP migrations per rolling 7-window week. No-deploy gate:
    sigma > SIGMA_CEILING -> zero migrations (the legitimate arm; deep-dive theme 3).
    Fee-APRs are held at their frozen 2026-09-04 fixture values (stationary snapshot —
    disclosed; per-swap dynamics replay is the rank-6 adopt-after-validation scope on
    live streams). Deterministic: fixed candidate order, fixed arithmetic.
    fee_bps: the migrationFeeBps scenario — defaults to the fixed replay scenario
    (MIGRATION_FEE_BPS); the deliverable-6 FEE-GRID sweeps it across FEE_BPS_GRID."""
    s, il = cost
    fee = MIGRATION_FEE_BPS if fee_bps is None else fee_bps
    full_cost_bps = s + fee + il
    full_cost_pp = full_cost_bps / 100.0
    if rule == "distance-h*":
        def threshold():
            return H0_BPS + K1 * full_cost_bps + K2_BPS_PER_SIGMA * sigma
    elif rule == "trailing-T5":
        def threshold():
            return T_BARE_BPS
    elif rule == "no-deploy":
        def threshold():
            return float("inf")
    else:
        raise SystemExit("unknown rule: %s" % rule)

    cur = INCUMBENT
    frontier = max(apr[t] for t in TARGETS)
    series = []
    gap_windows = []
    mig_windows = []
    for w in range(WINDOWS):
        fired = False
        if sigma <= SIGMA_CEILING:
            recent = [m for m in mig_windows if w - m < 7]
            if len(recent) < WEEK_CAP:
                thr = threshold()
                best = None
                best_gain = 0.0
                for t in TARGETS:
                    if t == cur:
                        continue
                    d = apr[t] - apr[cur]
                    if d <= 0:
                        continue
                    if d * 100.0 >= thr and d > best_gain:
                        best, best_gain = t, d
                if best is not None:
                    cur = best
                    mig_windows.append(w)
                    fired = True
        # per-window net rate (pp/yr): fee-APR of the book held this window, minus the
        # full migration cost charged once in the migration window (crystallized here)
        series.append(apr[cur] - (full_cost_pp if fired else 0.0))
        gap_windows.append(frontier - apr[cur])

    migrations = len(mig_windows)
    peak_week = 0
    for w in range(WINDOWS):
        peak_week = max(peak_week, sum(1 for m in mig_windows if w - m < 7))
    mean_net = sum(series) / float(WINDOWS)
    median_net = statistics.median(series)
    tail = cvar5(series)
    # exposure-tracking proxy (deep-dive rank 2): time-weighted yield-gap between the
    # held book and the target-book frontier, pp/yr; lower = tighter tracking.
    gap = sum(gap_windows) / float(WINDOWS)
    inc_mean = float(apr[INCUMBENT])
    dominates = (mean_net > inc_mean) and (gap < (frontier - apr[INCUMBENT]))
    return {
        "migrations": migrations,
        "peak_week": peak_week,
        "mean_net": mean_net,
        "median_net": median_net,
        "cvar5": tail,
        "gap": gap,
        "il_per_migration": il,
        "full_cost_bps": full_cost_bps,
        "dominates": dominates,
    }


def print_replay(apr):
    frontier = max(apr[t] for t in TARGETS)
    print("RULE-FAMILY-REPLAY sequential migrate() replay, %d weekly windows, start book %s, "
          "frontier apr_f=%d pp" % (WINDOWS, INCUMBENT, frontier))
    print("RULE-FAMILY arms: distance trigger h* = h0 + k1*cost + k2*sigma (h0=%gbps, k1=%g, "
          "k2=%gbps/unit-sigma) | trailing fee-APR arm T=%gbps bare (no cost term — the S4 "
          "sketch comparison arm) | no-deploy arm (sigma ceiling=%g, scenario) | weekly cap "
          "= %d migration per rolling week (MAX_MIGRATIONS_PER_PERIOD scenario)"
          % (H0_BPS, K1, K2_BPS_PER_SIGMA, T_BARE_BPS, SIGMA_CEILING, WEEK_CAP))
    print("RULE-FAMILY cost per migrate() = slippage_bps + migrationFeeBps(%d, scenario) + "
          "crystallized_IL_bps (deep-dive rank 6: gas ~free on RH-4663, NOT the binding term)"
          % MIGRATION_FEE_BPS)
    print("RULE-FAMILY scoring: median-of-windows mean net rate + 5%% CVaR (tail n=%d, never max) "
          "+ TWO-METRIC DOMINANCE vs the never-migrate incumbent: better mean net fee-APR after "
          "realized IL AND lower exposure-gap (time-weighted yield-gap to the target-book "
          "frontier, pp), SIMULTANEOUS; realized IL per migration reported separately "
          "(arXiv 2608.02917 evaluation discipline, deep-dive rank 2)" % CVAR_TAIL_N)
    print("RULE-FAMILY-REPLAY NOTE: frozen-snapshot stationary replay — fee-APRs held at their "
          "2026-09-04 fixture values; per-swap dynamics replay on live streams is the rank-6 "
          "adopt-after-validation scope. NO RL/neural policies (deep-dive warning: the papers' "
          "own closed-form baselines beat them).")
    inc_gap = frontier - apr[INCUMBENT]
    print("REPLAY-BASELINE incumbent=%s never-migrate mean_net=%.1fpp exposure_gap=%.1fpp"
          % (INCUMBENT, float(apr[INCUMBENT]), float(inc_gap)))
    dom_count = 0
    runs = 0
    for rule in ["distance-h*", "trailing-T5", "no-deploy"]:
        for sigma in SIGMA_SCENARIOS:
            for (s, il) in COST_SCENARIOS:
                r = run_replay(apr, rule, sigma, (s, il))
                runs += 1
                dom = "YES" if r["dominates"] else "NO"
                if r["dominates"]:
                    dom_count += 1
                gate = "no-deploy" if sigma > SIGMA_CEILING else "deploy"
                print("REPLAY arm=%s sigma=%.2f cost=(%d,%d) full_cost_bps=%d gate=%s "
                      "migrations=%d peak_week=%d mean_net=%.1fpp median_net=%.1fpp cvar5=%.1fpp "
                      "exposure_gap=%.1fpp il_per_migration_bps=%d dominance=%s"
                      % (rule, sigma, s, il, r["full_cost_bps"], gate, r["migrations"],
                         r["peak_week"], r["mean_net"], r["median_net"], r["cvar5"], r["gap"],
                         r["il_per_migration"], dom))
    print("REPLAY-SUMMARY runs=%d dominant_vs_incumbent=%d (dominance requires BOTH metrics "
          "simultaneously; a NO verdict is a calibration output, not a failure)" % (runs, dom_count))


def print_fee_grid(apr):
    """Deliverable 6 — migrationFeeBps sensitivity grid: FEE_BPS_GRID x the three cost
    scenarios, per-value break-even (7d hold) and two-metric dominance of the
    distance-h* arm at the mid sigma scenario. CALIBRATION ONLY."""
    sigma_mid = SIGMA_SCENARIOS[1]
    print("FEE-GRID migrationFeeBps sensitivity grid %s x cost(slippage_bps,IL_bps) in %s "
          "(deliverable 6: the selection input for the Safe-queued operating value; the "
          "deploy-fixed hard cap 2000 bps bounds every row)"
          % (FEE_BPS_GRID, COST_SCENARIOS))
    print("FEE-GRID cell: full per-migration cost = slippage_bps + migrationFeeBps + "
          "crystallized_IL_bps (scenario bps); break_even_7d_bps = cost x 365/7 (pair-"
          "independent, hold=7d); cap4_annual_drag_bps = 4 x cost (worst case, MAX_"
          "MIGRATIONS_PER_PERIOD=4 start); dominance = the distance-h* arm at the mid "
          "sigma scenario (%.2f) vs the never-migrate incumbent, two-metric (rank 2)"
          % sigma_mid)
    dom_count = 0
    rows = 0
    for fee in FEE_BPS_GRID:
        for (s, il) in COST_SCENARIOS:
            cost = s + fee + il
            be = cost * 365.0 / 7.0
            r = run_replay(apr, "distance-h*", sigma_mid, (s, il), fee_bps=fee)
            rows += 1
            dom = "YES" if r["dominates"] else "NO"
            if r["dominates"]:
                dom_count += 1
            print("FEE-GRID fee=%d cost=(%d,%d) full_cost_bps=%d break_even_7d_bps=%.1f "
                  "cap4_annual_drag_bps=%d migrations=%d mean_net=%.1fpp cvar5=%.1fpp "
                  "exposure_gap=%.1fpp dominance=%s"
                  % (fee, s, il, r["full_cost_bps"], be, 4 * cost, r["migrations"],
                     r["mean_net"], r["cvar5"], r["gap"], dom))
    print("FEE-GRID-SUMMARY rows=%d dominant_vs_incumbent=%d — CALIBRATION ONLY: never "
          "quote this frozen-snapshot grid as operating policy; the OPERATING "
          "migrationFeeBps is Safe-queued within the 2000 bps deploy cap and re-priced "
          "from S2's live fee-screen feed before go-live (07 §5(iv))" % (rows, dom_count))


def main(argv):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--selftest", action="store_true",
                    help="validate fixture: count==95 + 3 poolId-prefix anchors")
    args = ap.parse_args(argv)
    data, idx = load_fixture()
    if args.selftest:
        return selftest()

    apr = {}
    for t in TARGETS:
        if t not in idx:
            raise SystemExit("FATAL: target %s missing from fixture" % t)
        v = idx[t]["apr_f"]
        if v is None:
            raise SystemExit("FATAL: target %s has apr_f=null; never estimate — "
                             "fix the corpus or drop the target" % t)
        apr[t] = v
    n_pairs = sum(1 for f in TARGETS for to in TARGETS if f != to)
    print("POLICY-CALIBRATION targets=%d pairs=%d" % (len(TARGETS), n_pairs))
    print("CORPUS fixture=%s corpus_date=%s source=05_V4_FEE_ECON_SCREEN_2026-09-04 §2 "
          "(frozen 2026-09-04 snapshot; surrogate status disclosed in 07_ROAM_POLICY_BACKTEST "
          "§5 — never quote these numbers as v2 operating policy)"
          % (FIXTURE.name, data.get("corpus_date")))
    print_grid(apr)
    print_cap_drag()
    print_break_even(apr)
    print_direction(apr)
    print_replay(apr)
    print_fee_grid(apr)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
