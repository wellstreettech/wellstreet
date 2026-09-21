# GOAL — WELLSTREET FLEET SORT + COLLAPSE (2026-09-21)

**Locked /goal:** Make the fleet table (`wellstreet.tech` #fleet-surface) a
user-sortable, collapsible surface: **default view = the top 8 books by fee APR
(desc), a toggle expands to all books, and every data column sorts on click.**
User ask 2026-09-21: "pools … collapsable, show by default top 8 paid by APR,
sortable by every column."

Repo: `/home/raivo/Documents/wellstreet`. Static site — **no build step**;
`node --test` is the toolchain.

## 0. BASELINE (2026-09-21 ~10:55)

- HEAD = `aa068e1` (sibling's FleetRouter status flips). LEDGER-PRESS is `ca753fa`,
  already live on wellstreet.tech.
- `node --test "site-tests/*.test.js" "api-tests/*.test.js"` → **502 pass / 0 fail**.
- Tree dirty ONLY with sibling-owned files: `docs/ops/roam-ops.md`,
  `docs/ops/roamer-deploy-runbook.md`, `site/data/fleet.json` (DATA — never edit).

## 1. DESIGN SPEC

### 1a. Sort (every data column)

- **Sortable keys** (map → row-model field in `js/fleet-table.js`):
  `book` → `pair` (string, `localeCompare`, asc-first) · `tvl` → `tvlUsd` ·
  `vol` → `vol24hUsd` · `apr` → `feeAprPct` (desc-first). NOT sortable: the spine
  (status), `il`/`age` (the DECISION-2 diet hides those columns at every width —
  they carry no data), actions.
- **Interaction:** click the th → sort by that key; click again → flip direction.
  Default state: `{ key: 'apr', dir: 'desc' }`.
- **Determinism (fail-closed):** every sort carries the tie-break chain
  `tvlUsd desc, then pair asc` — the same 8 books must render every cycle. Missing
 /null numerics sort as `-Infinity` (never NaN, never a thrown compare).
- **Indicators:** the sorted th gets class `is-sorted` (color `var(--accent-text)`)
  + a direction glyph `↑`/`↓` in a `span.ft-sort-mark`. **G8 ARROW-GRAMMAR
  AMENDMENT (dated):** `↑`/`↓` join the glyph law as the SORT register — they
  carry data state (direction), not a navigation promise; `→`/`↗` semantics
  unchanged. `aria-sort="ascending|descending|none"` on every th; th gets
  `tabindex="0"` + Enter/Space activation (keyboard parity). Assign
  `data-sort-key`/listeners in JS at init — **the static thead markup in
  index.html stays byte-identical**.
- **Invariant amendment (load-bearing):** the module header's "never re-sorts"
  contract is amended: the module applies ONE user-controlled presentation sort
  over the feed rows (the feed remains the order-of-record; sorting never
  fabricates or re-classifies data). Update the header comment + add a dated
  amendment note to `docs/internal/FLEET_UI_V2_WAVE_2026-09-07.md` §1.
- The mobile card stack (≤640) renders the SAME sorted list (one list, both
  surfaces — existing architecture).

### 1b. Collapse (top-8 by APR default)

- State `{ expanded: false }` default. Collapsed render = **first 8 rows of the
  active sort** (default ⇒ the top 8 books by fee APR — the paying books lead).
- **Toggle strip** under the table, before `.fleet-colophon`, riding the
  `.fleet-filter` chip register (44px zone, square, mono lowercase):
  `show all N books` when collapsed · `show top 8` when expanded. Hidden
  entirely when the filtered list ≤ 8. One toggle serves table + cards.
- Filter-chip changes KEEP the expanded/collapsed state (applied to the new list).
- Collapsed count line honesty: when collapsed and N > 8, the strip's own text
  carries the count (e.g. `top 8 · show all 95 books`) — never a fabricated
  figure; the census counts still come from `WS.fleet.summary()` where present.

### 1c. CSS (style.css)

- `.fleet-table thead th.is-sorted` (accent-text head) + `.ft-sort-mark` (muted
  when unsorted column hover, accent-text on the sorted th), `.fleet-more` strip
  (chip register, `margin-top` on the space scale). **Zero new color literals**
  (tokens only), zero radius changes, zero new keyframes. Sticky-thead + the
  641-892 scroller band must keep working (click targets inside the sticky head).

## 2. LOCKED CONSTRAINTS

1. Scope: ONLY `site/js/fleet-table.js`, `site/css/style.css`,
   `site/js/main.js` (only if a fill point needs it), `site/index.html` (only if
   the toggle strip needs a static mount — prefer JS-created), `site-tests/*.test.js`,
   `docs/internal/FLEET_UI_V2_WAVE_2026-09-07.md` (the §1 amendment only).
   NEVER: `site/data/fleet.json`, `site/js/config.js`, `contracts/`, `src/`,
   `script/`, `test/`, `api/`, `docs/ops/*`.
2. No new hex values, no new external resources, no new keyframes; WCAG pairs
   hold (accent-text tokens are the measured ones).
3. The §1 DOM/class anatomy of ROWS and CELLS is unchanged (td classes, row
   classes, chips, detail surfaces). Additive attributes only (`data-sort-key`,
   `aria-sort`, `is-sorted`, `ft-sort-mark`, `fleet-more`).
4. Fail-closed: a feed without `feeAprPct`/`tvlUsd`/`vol24hUsd` fields sorts
   stably (the tie-break chain absorbs nulls); the empty state and the
   unavailable state are untouched.
5. End at ONE local commit of exactly the declared files (temp-index pattern if
   the shared index is dirty — it currently is NOT). Message:
   `feat: fleet table sort + top-8 collapse (user ask 09-21)`. **NO push, NO
   deploy** — the main session handles that after its own verification.
6. Re-pin convention: dated `FLEET-SORT 2026-09-21` marker + one-line why; never
   weaken ban/contrast assertions.

## 3. VERIFY BATTERY (all exit 0)

```bash
cd /home/raivo/Documents/wellstreet
node --test "site-tests/*.test.js" "api-tests/*.test.js"     # fail 0 (baseline 502)
node --check site/js/fleet-table.js
grep -c 'data-sort-key' site/js/fleet-table.js               # >= 1
grep -c 'fleet-more' site/css/style.css site/js/fleet-table.js  # >= 1 each
grep -c ' — ' site/index.html                                # still 0 (LEDGER-PRESS hold)
git diff site/css/style.css | grep -E '^\+[^+]' | grep -cE '#[0-9a-fA-F]{6}'  # 0
```

New teeth (worker adds to site-tests, fail-closed style): default render shows
exactly 8 rows + the toggle; expanding renders all; `apr` th click sets
`aria-sort="descending"`; book sort is asc-first; the tie-break is deterministic
(same input → same order); null numerics never throw.

## 4. OUT OF SCOPE

Filter semantics, the detail sheet, copy-position, the flagship card, feed
validation, any backend/api work.
