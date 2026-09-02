# APR methodology (projected, not promised)

This page documents how the APR figure shown on the site is derived. The headline
number is always the depositor-side figure, always labeled projected. Nothing on
this page is a promise, a guarantee, or an offer of any return.

## The formula chain

Projected depositor APR is computed as:

    pool net fee APR × (harvester LP value ÷ target vault TVL) × (1 − protocol fee)

The pool net fee APR input is itself derived:

    gross fee APR from the pool's own Swap events × (1 − pool protocol cut)

The pool protocol cut is not assumed. It is decoded live from the pool's slot0
feeProtocol word at calculation time, so a change made on chain is picked up by
the next calculation rather than silently ignored.

**What the pool net fee APR does not subtract:** LP arbitrage losses (LVR — the
value an LP position loses to arbitrageurs as the pool price trails an external
reference price). The measured pool net fee APR is net of the pool's protocol
cut ONLY. The harvester LP principal is treasury capital, excluded from
depositor accounting, and it is that capital — not depositor assets — that
bears these losses; depositor fee yield is unaffected, but the
`(harvester LP value ÷ target vault TVL)` leverage term above silently decays
as the principal shrinks. The quantified loss side is disclosed as a risk
figure in [risk-disclosure.md](risk-disclosure.md).

## Every input, and where it comes from

- **Gross fee APR** — a live, client-side sample of recent Swap events from the
  pool. When live sampling is unavailable (RPC failure, incomplete retrieval),
  the calculation falls back to the measured phase-0 baseline described below.
- **Pool protocol cut** — decoded live from the pool's slot0 feeProtocol word.
- **Harvester LP value** — the ratified GO/NO-GO seed pin. The harvester LP is
  not yet seeded; until it is, the ratified pin stands in and the page says so.
- **Target vault TVL** — the ratified GO/NO-GO TVL pin, read at page-load. TVL
  moves with the market between loads; this is a documented approximation.
- **Protocol fee** — the share of income the protocol keeps. It starts at 10%
  and is timelock-settable, hard-capped at 20%.

The phase-0 measured baseline is a real on-chain measurement, not a placeholder
number: the median net fee APR across three Tuesday, Wednesday and Thursday
14:00–16:00 UTC windows sampled on 2026-08-25, 2026-08-26 and 2026-08-27, net of
the pool's own decoded protocol cut. Wherever it is used it is labeled as a
measured input, and it feeds exactly the same formula a live sample would.

## The ratified sampling rules

- **Two-sided volume.** Each Swap event contributes the sum of abs(amount0) and
  abs(amount1), with the second token converted at the FIRST swap's price inside
  the window. Counting only one side would understate income.
- **Minimum observations.** A window with fewer than 20 Swap events is excluded.
  No projection is published from thin data.
- **Median of windows.** Window results are aggregated by taking the median.
  Reporting the largest window as the input is forbidden — a single busy window
  is not a rate.
- **Incomplete retrieval excludes the window.** If log retrieval for a window is
  incomplete, that window is dropped rather than patched over.
- **Real window length.** Window length comes from the actual block timestamps
  on chain, not from an assumed block time.

## What this is not

- A projection, not a promise. Nothing here guarantees any return.
- Fee income varies with swap activity and can go to zero. A quiet pool earns
  nothing.
- Each depositor dilutes the same income: the same fee stream divided between
  more depositors lowers each one's projected APR.
- The pool owner can change the protocol cut, which changes the net input. The
  live decode picks up such a change on the next calculation, but past figures
  are not retroactively corrected.
- The harvester LP is not yet seeded. The ratified seed pin is used until it is.
- TVL is read at page-load — a documented approximation, not a locked value.
- Nothing here is an offer, a solicitation, or financial advice.

Pool-level figures that appear in methodology work are inputs to the formula
only. They are not depositor returns and are never presented as such. Where any
label on the site and a headline number disagree, the labeling rules above win.
