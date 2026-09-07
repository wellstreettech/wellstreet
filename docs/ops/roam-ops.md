# Roam Ops — the POL Roamer (RoamingHarvester) Operating Runbook

Status: LIVE CODE, CAPITAL-INERT (v1 S1 build complete 2026-09-07; nothing deployed, no
capital funded). Authority chain: `docs/internal/GOAL_ROAMING_HARVESTER_2026-09-07.md`
(LOCKED contract) → `docs/research/yield_farming/07_ROAM_POLICY_BACKTEST_2026-09-06.md`
(VIBE repo — guardrails + ratified on-chain/off-chain split, BINDING) →
`docs/internal/DEEP_DIVE_TOP8_ROAM_POLICY_2026-09-06.md` (rankings + NO-RL warning) →
`docs/internal/SPEC_WELLSTREET_V1_2026-08-30.md` §M amendment (local-only tree) → this
runbook. Contract: `src/RoamingHarvester.sol` + `src/RoamAllowlist.sol`; battery:
`test/fork/RoamingHarvesterFork.t.sol` (6 tests, live-4663, 0 failed / 0 skipped).

Trust model (disclosed on purpose, never represented otherwise): Safe 2-of-3 (three keys,
one operator) proposes through the 48h `WellstreetTimelock`; execution is permissionless
after the delay. The 48h window is a public detection window, not prevention.

---

## 1. What the roamer is (one paragraph)

The protocol-owned-liquidity roamer holds multi-pool, salt-keyed Uniswap-v4 positions on
the pinned fork PoolManager `0x8366a39CC670B4001A1121B8F6A443A643e40951` and migrates them
between allowlisted fee-paying books when the measured fee-APR spread clears the
deterministic guardrails. It charges a visible `migrationFeeBps` take on released
principal at every migration, accrues all revenue in a per-token accounted ledger, and
the AMENDMENT B tail converts that accounted revenue to $WELL through the pinned fork
Quoter and burns it at `0x…dEaD` — holders accrue passively (supply shrinks), zero
staking, dev take structurally 0. POL mode = protocol capital ONLY; no user deposits in v1.

## 2. Guardrails (07 §1-faithful, on-chain, fail-closed)

| Guardrail | Start (Safe-settable) | Immutable ceiling | Mechanics |
|---|---|---|---|
| `MIN_HOLD` | 7 days | 30 days | Minimum TIME between migrations per position key, anchored at the LATER of position creation and the position key's last migration. A Safe seed is hold-locked from seed time; every migration re-anchors at itself. |
| `MAX_MIGRATIONS_PER_PERIOD` | 4 | 52 | Rolling-365-day counter per harvester. Same-pool re-ranges COUNT (no exemption path). A REVERTED migration consumes nothing (atomic rollback, battery-proven). |
| `MIN_EXPECTED_GAIN_BPS` | 3911 bps | 31286 bps | Attestation floor vs the caller-supplied `expectedGainBps`; FAIL-CLOSED on absence/zero. |
| `MIGRATION_FEE_CAP` | — | 2000 bps | The roaming take's deploy-fixed hard cap; no Safe-queueable operating value can exceed the range the deliverable-6 grid priced. |
| `SWEEP_MIN_ACCRUED` | 0 per token | — | Per-token sweep trigger floor (Safe-settable); below it the accrual waits. |

**REQUIRED trust-model bullet (07 §1, verbatim):** "MIN_EXPECTED_GAIN_BPS is an ATTESTATION
check, not a proof. `expectedGainBps` is caller-supplied (computed off-chain from the
fee-screen feed) and can be inflated by a broken or misbehaving agent; the on-chain floor
only verifies the claim clears the threshold and must FAIL CLOSED on absence or zero (a
migration with no gain claim is never admitted). The self-enforcing guards are therefore
MIN_HOLD and the per-period cap — they need no oracle and no trusted input — and realized
IL, emitted at every migration into the ledger, is the enforcement backstop and the honest
product surface: whatever the attestation said, the ledger records what the migration
actually cost." (`RealizedIL` event — the honest-IL ledger in the shared currency at the
pools' own observable spots, no oracle.)

**Bounded-grief disclosure (permissionless migrate, NO tip):** anyone may call
`migrate()` and pay nothing — so an adversary can consume the migration cap. The worst
case is BOUNDED BY CONSTRUCTION: adversarial cap consumption ≤ cap × per-migration
cost/yr (at the ratified start: 4 migrations/yr × ≤1600 bps full scenario cost = ≤6400
bps/yr worst-case drag, the cap-drag row in 07 §2); MIN_HOLD bounds each position key's
frequency independently. Direction sanity is OFF-CHAIN (the reversal BLOCK-ALL check per
07 §4 is policy, never an on-chain revert — the battery proves migrate MECHANICS in both
directions and asserts no reversal revert); `expectedGainBps` is inflatable (the
attestation trust model above — MIN_HOLD + the cap are the self-enforcing guards, the
realized-IL ledger is the backstop). The NO tip param is the fail-closed form: there is
nothing to farm by calling. **MIN_HOLD anchor ruling:** a Safe seed is hold-locked from
SEED time (the later-of anchor's creation leg — 07 is silent on zero-migration positions;
this closes the seed→instant-migrate path), and every migration re-anchors MIN_HOLD at
that migration (07 §1's last-migration anchor for migrated positions).

**Erratum record (07, both sections):** 07 §1's "per rolling week" AND 07 §3's
"week-bounded" wording are a ratified ERRATUM (verified at 07:16 and 07:73) — the
calibrated cap rows and the immutable ceiling (52/yr) price a ROLLING-365-DAY counter.
Ratified reading: rolling-365-day counter, default 4, ceiling 52, re-ranges count.

**Supersession record (deep-dive rank-7):** the min-book-TVL on-chain cap
(DEEP_DIVE_TOP8_ROAM_POLICY:59/:219) is DEMOTED to RoamAllowlist registry metadata
(advisory `BookMeta.minTvlUsd1e6` + the arXiv 2608.30957 drain-shock `drainShockChecked`
pre-check flag) — off-chain policy-layer input, never enforced on-chain; no oracle may
enter the fee path (the swap IS the price). v2 may revisit an oracle-free
observable-state TVL cap.

**AMENDMENT A — bandShape disposition (07 ADDENDUM 2026-09-07):** bandShape ∈ {full,
symmetric(w), upper-max, lower-max} is a zero-contract-change TREASURY-DISCRETION config
option — `seedBook`/`migrate()` already accept arbitrary tick ranges including one-sided
upper-max/lower-max bands. Per-book gated via the Safe-seeded open, disclosed as
directional (the `DirectionalRange` event fires whenever a requested band does NOT
bracket the live spot tick), never the default roam policy, never mixed into the
measured-APR ranking: directional positions are judged by the exposure-tracking leg of
the two-metric dominance, never by net fee-APR alone.

## 3. Lane split + D12 disposition (DATE-STAMPED 2026-09-07)

**User directive 2026-09-07 (roamer council re-pin):** the roamer LP-fee lane is the
AUTOMATED BUYBACK-AND-BURN tail (AMENDMENT B) — 100% of swept accounted revenue becomes
burned $WELL; there is NO staking distributor, NO stake/claim machinery, NO dev take
(structurally 0 — nothing is retained anywhere; battery-asserted). The Pons native holder
fee share covers the trading-fee/creator-stream lane per vault D18.

**D12-DISPOSITION (2026-09-07):** the user directive DROPPED the D12 buyback leg
(AGENT_FOCUS_SEQUENCE_2026-09-06.md §S3 RESOLVED block :34 "D12 buyback leg DROPPED";
re-affirmed by the 2026-09-07 roamer council). This runbook date-stamps that directive
and cites the standing records that predate/coexist with it WITHOUT contradicting them:
`docs/internal/DECISIONS_2026-08-30.md` §D18:176 and the vault note
`VIBE-V2-Brain/decisions/2026-09-06-wellstreet-fee-share-supersession` still record D12
buybacks as "PENDING GATE-FEESHARE-1-BUYBACK-COMPAT"; the vault architecture note
`VIBE-V2-Brain/architecture/wellstreet-protocol.md:19` already records "D12 buyback leg
DROPPED". Note: SPEC_WELLSTREET_V1 §A/B-era text quoting "buybackEnabled=true per D12"
describes the PONS LAUNCH PARAMETER for $WELL (a pons-side creator-stream buyback
setting), not a roamer-lane buyback — the two are distinct surfaces; the pons launch
checklist stands unchanged.

**COMPLIANCE-SCOPE (F3) — GO-LIVE GATE, zero build change:** the buyback-burn tail is a
supply-reduction surface. Per D12's compliance note (DECISIONS_2026-08-30.md:91
"buybacks REDUCE the revenue-share securities trigger vs pro-rata holder distributions …
that difference must be stated plainly in docs") and D18's compliance delta
(DECISIONS_2026-08-30.md:192, reverting to holder distributions "RE-OPENS the F3 analysis
… The F3 re-look is REQUIRED before launch"), the F3 re-look
(`docs/RH_LAUNCHPAD_COMPLIANCE_RESEARCH_2026-08-10.md` — VIBE repo, NOT wellstreet/docs)
must cover BOTH distribution lanes (the Pons creator-stream lane AND this stake-gated
LP-fee distributor's replacement, the automated buyback-burn) before the burn tail goes
live. Nothing in the build blocks on F3; the GO-LIVE does.

## 4. OPERATOR GATE — capital funding (USER GATE, never silently resolved)

The contract ships CAPITAL-INERT: no position can open until the Safe funds the harvester
AND queues the seed. Before the FIRST seed, the user must decide (template — fill in and
record the decision inline below when made):

- [ ] **Initial capital** (total): ______ (suggested evidence basis: the 05 fee screen's
      book depths at the intended bands; the target books' 30-day fee-yield at the
      intended size; gas is ~free on RH-4663)
- [ ] **Per-book capital cap**: ______ (the Safe's own sizing discipline; ≤10% of a
      book's TVL is the house off-chain sizing precedent for dust tiers)
- [ ] **MIN position size**: ______ (below it, migration fees dominate yield — the 07
      break-even table is the calibration input)
- [ ] **Operating `migrationFeeBps`**: ______ (≤ 2000 hard cap; see §6 CALIBRATION ONLY)
- [ ] **Operating guardrail values** (defaults ratified: 7d / 4-per-365d / 3911 bps)

Decision date + decision maker recorded here when made: ________________

## 5. Administration (Safe 2-of-3 → 48h timelock; the ONLY admin surface)

| Operation | Call (via `WellstreetTimelock.queue` → wait 48h → permissionless `execute`) |
|---|---|
| allowlist queueing | `RoamAllowlist.addBook(poolKey, meta)` / `removeBook(id)` / `setBookMeta(id, meta)` |
| migrationFeeBps set | `RoamingHarvester.setMigrationBps(v)` — reverts above the deploy-fixed 2000 bps cap |
| guardrail tuning | `setMinHoldSeconds(v ≤ 30d)` · `setMaxMigrationsPerPeriod(0 < v ≤ 52)` · `setMinExpectedGainBps(v ≤ 31286)` |
| seed/open | `seedBook(keyBytes, liquidity)` — the FIRST position per book (timelock-only custody; the pool's own math dictates the principal paid from the harvester's balances; underfunding reverts atomically) |
| exitBook | `exitBook(keyBytes, to)` — FULL close of one position, both legs (principal + final fees) to `to`; the total-egress path; NEVER consumes the migration cap |
| sweepToBurn | permissionless (no queue needed) — but the routes/floor below it are Safe-set |
| setWellToken | `setWellToken(addr)` — ONE-SHOT, fail-closed: zero-address and re-set both revert; the burn tail stays INERT (sweepToBurn reverts `NoWellToken`) until set; fees accumulate in the harvester, never lost |
| sweep routes / floor | `setSweepRoute(token, poolKey)` (a pinned-PM pool trading (token, WELL); zero key removes) · `setSweepMinAccrued(token, v)` |
| rescue | `rescueToTreasury(token)` — timelock-only egress of a stranded token balance (the junk guard already forwards unaccounted excess at sweep time) |

`migrate(fromKey, toKey, minOuts, expectedGainBps)` itself is PERMISSIONLESS with NO tip —
the operator runs migrations off-chain (feed → candidates → guardrail pre-checks →
`migrate`), but anyone can call it; the guardrails + no-tip form are the grief containment
(§2 bounded-grief disclosure).

**Dead-book exit note (ratified custody surface):** `migrate()` rails toKey ONLY against
the allowlist (07 §3: "fromKey = caller's live position") — fromKey is NEVER railed, so a
removed (dead/wound-down) book can always be migrated OUT of while any live book remains;
`exitBook` is the total-egress path when none does. No capital stranding is possible, and
07 §1's migration guardrails keep NO exemption paths (exitBook is a custody function
OUTSIDE the migration-guardrail scope, not an exemption from it — it removes capital,
never roams it, and never consumes the cap).

**exitBook wind-down fee-leg disclosure:** the Safe-queued close sends principal + final
accrued fees to treasury/Safe TOGETHER (house custody pattern) — this is the one
DISCLOSED treasury intake of roamer-side fees, a wind-down custody event outside the
operating revenue model. The operating sweep path (sweep → burn) is unaffected: sweep
routes accounted revenue to the burn, never to treasury (treasury roamer-side intake in
v1 = junk excess + the disclosed exitBook wind-down fee leg ONLY).

## 6. Sweep (the AMENDMENT B burn tail) — cadence, destinations, calibration

Flow (one `unlock`): collect live fees from every open position → per-token junk split
(raw-balance EXCESS above the accounted accrual forwards to TREASURY — force-sent/junk
never enters the burn stream) → swap the swept accounted revenue to WELL via the pinned
fork Quoter `0x076838736F90Cd1d30dED756A3B89E576BE972F8` `quoteSingle` (EXACT-OUTPUT,
minOut = fresh quote − 1% — the swap IS the price, NO oracle) → transfer the bought WELL
to `0x000000000000000000000000000000000000dEaD` → `Burned(sourceToken, wellBought,
wellBurned)`. If the source token IS WELL it burns directly (no swap). A partial fill at
the price limit leaves the unconsumed remainder ACCOUNTED (the next sweep retries it) —
nothing is stranded, nothing is double-counted. Dev take structurally 0: no fee/dev/take
setter exists on the roamer (battery-gated); the harvester retains nothing after a sweep.

- **Sweep cadence:** operator-configured OFF-CHAIN (permissionless call; a cron/keeper
  cadence is an ops choice, not a contract param). Suggested start: daily, or when any
  token's accounted accrual exceeds its gas-meaningful floor — gas is ~free on RH-4663,
  so the binding floor is the SWAP depth, not gas.
- **Sweep destinations:** accounted revenue → WELL → `0x…dEaD` (burn). Junk excess (raw
  balance above accounted) → `treasury` (constructor custody address) — per-token, at
  sweep time, unswapped. Wind-down fees → `to` of the Safe-queued exitBook (disclosed §5).
- **SWEEP_MIN_ACCRUED:** per-token trigger floor (Safe-settable); below it the accrual
  waits for the next sweep.

**Deliverable-6 fee grid — CALIBRATION ONLY.** `python3 docs/ops/roam_policy_backtest.py`
prints the migrationFeeBps sensitivity grid `FEE_BPS_GRID = {0, 250, 500, 1000, 2000}` ×
the three cost scenarios (15 rows: full per-migration cost, 7d break-even, cap-4 annual
drag, two-metric dominance of the distance-h* arm at the mid sigma scenario). Output
record: 15/15 rows dominant vs the never-migrate incumbent on the frozen 2026-09-04
snapshot (the snapshot's spread recovers even the heavy scenario cost within one window —
07 §2's stationary-replay caveat applies verbatim). **CALIBRATION ONLY: never quote this
frozen-snapshot grid as operating policy.** The OPERATING `migrationFeeBps` is Safe-queued
with the hard cap fixed at deploy (2000 bps) and RE-PRICED from S2's live fee-screen feed
before go-live per 07 §5(iv); the deliverable-6 grid output is the selection INPUT, not
the operating value. (The replay's own `MIGRATION_FEE_BPS = 1000` pin remains the FIXED
replay scenario for the RULE-FAMILY-REPLAY section — a scenario, not a measurement.)

## 7. If we vanish

The roamer holds protocol capital — these are the disclosure rows for "if the team
disappears". All admin actions are Safe-queued through the 48h timelock and
PERMISSIONLESSLY EXECUTABLE by anyone after the delay (the queued call is public in
`CallQueued`); none requires a vanished team. (Detail layer under the site #vanish card —
no diverging vanish texts.)

| # | Recovery surface | What anyone can do |
|---|---|---|
| 1 | **allowlist queueing** | The Safe proposes `addBook`/`removeBook`/`setBookMeta`; after 48h ANYONE executes. A dead team cannot freeze the book set: the calls are public, the delay is a detection window, execution needs no team key. |
| 2 | **migrationFeeBps set** | `setMigrationBps(v)` through the same rail, hard-capped at 2000 bps at deploy — no future key can raise the take beyond the priced range. |
| 3 | **guardrail tuning** | `setMinHoldSeconds` / `setMaxMigrationsPerPeriod` / `setMinExpectedGainBps` through the same rail, each bounded by immutable ceilings (30d / 52 / 31286) — the parameters can be loosened only inside the ratified envelope. |
| 4 | **seed/open** | `seedBook` through the same rail — the FIRST position per book is timelock-gated custody; anyone can EXECUTE a queued seed, and the principal comes from the harvester's own balance (the USER GATE sizing record above is the paper trail). |
| 5 | **exitBook** | `exitBook(key, to)` through the same rail — full capital egress per position, both legs to `to`. This is the wind-down path: with an emptied allowlist, migrate can still EXIT every book (toKey-only railing) and exitBook removes the rest. Capital is never stranded; 07 §1's guardrails have no exemption paths. |
| 6 | **sweepToBurn** | PERMISSIONLESS with no team key at all — anyone triggers the burn; the accounted revenue converts to WELL and burns whether or not the team exists. |
| 7 | **setWellToken** | ONE-SHOT `setWellToken(addr)` through the same rail, at $WELL launch — until set, the burn tail is inert and fees accumulate (never lost); after set, it can never be re-pointed. |

## 8. Verification (what was run to prove this file's contract)

- `forge test --match-contract RoamingHarvesterFork` → 6 passed / 0 failed / 0 skipped
  (live-4663 execution: timelock seed on SPY/USDG → 7d warp → migrate to USDG/ETH
  (dynamic-fee hook book) → 7d warp → migrate back; minOut fail-closed atomic rollback;
  MIN_HOLD both anchors; attestation fail-closed; rolling cap; toKey-only allowlist rail;
  burn-path math incl. the junk split, per-source Burned legs, dev-zero, and the
  structural-absence registration gate; exitBook full egress; DirectionalRange
  disclosure). Measured suite wall time ≈ 16-17s (well inside CI's 10-minute forge job —
  the exitBook leg's budget cannot bind; recorded per the contract's MANDATORY-leg rule).
- Aggregate `env -u WELLSTREET_ROBINHOOD_RPC_URL forge test` → 79 passed / 0 failed /
  exactly 5 skipped (the five known self-skipping suites; failing-ID-SET delta vs the
  73/0/5 baseline: EMPTY).
- `python3 docs/ops/roam_policy_backtest.py --selftest` → `SELFTEST_OK books=95 anchors=3`.
- `python3 docs/ops/roam_policy_backtest.py` → exit 0, deterministic; the RULE-FAMILY-REPLAY
  section is byte-identical to the 07 doc's recorded outputs (36 runs / 18 dominant).

## 9. Open items (not resolved in-goal)

- USER GATE (§4) before first seed — funding size, per-book cap, MIN position size.
- F3 compliance re-look covering BOTH lanes (§3) before the burn tail goes live.
- S2 live fee-screen feed re-price of the operating `migrationFeeBps` + guardrail values
  (07 §5(iv)) before go-live.
- S4 PACE policy-attested execution (a NEW trust root — adopt-after-validation only).
- Curator-bond/hybrid allowlist mechanisms (post-launch $WELL + a slashing trust root).
- The v2 sequence doc governs the OPERATING allowlist (the SPY-family books in the
  battery are MECHANICAL ANCHORS ONLY — 07 §5(iv): wound down, never operating).

## KNOWN ISSUES (post-audit-fix recording, 2026-09-07 — main session, per ROAMER-FIXES routing)

- DEFENSE-IN-DEPTH NOT ADOPTED (deliberate): `_activeAction` clear-at-top was rejected — it conflicts with the `sweepOneToken`/`collectOnePosition` guards, which key on `_activeAction == ACTION_SWEEP`.
- `RoamAllowlist.bookIds` enumeration includes removed books (enumeration is not a live-book list — use the allowlist check).
- `DirectionalRange.spotTick` is read POST-open (post-hoc disclosure, not pre-check).
- `expectedGainBps` is recorded verbatim (unbounded claim off-chain — the on-chain check is attestation vs MIN_EXPECTED_GAIN_BPS, off-chain sanity-bound).
- Identical-band no-op migrations consume MAX_MIGRATIONS_PER_PERIOD (off-chain policy must dedupe).
- Exact-input sell leg reverts on limit-capped partial fill (no partial-fill handling).
- IL anchor read after from-close (anchor = the from-position's last state).
- $WELL force-sent to the harvester forwards to TREASURY, not burn (junk guard routes by accounted accrual — do not donate WELL to the harvester expecting burns).
- `MAX_SQRT_MINUS_1` constant sits ~5.6e19 above the true `table(MAX_TICK)` max (proven exactly by fork test T9; latent only — ratify or fix in a follow-up).
