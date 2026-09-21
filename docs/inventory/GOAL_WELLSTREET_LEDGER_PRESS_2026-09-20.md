# GOAL — WELLSTREET LEDGER-PRESS (2026-09-20)

**Locked /goal:** Overhaul the wellstreet.tech static site's visual composition per the
taste-skill (`Leonxlnx/taste-skill`, §11 redesign-overhaul, §14 pre-flight) —
**"LEDGER PRESS": recompose the page as a machine-printed financial broadsheet —
while keeping the dot-matrix identity and ALL colors byte-frozen.** User gates
(grilled 2026-09-20): mode = **overhaul the visual language** (keep the dot-matrix
spirit, recompose bigger); scope = **full page**; theme = **keep light-default**;
**"keep dotted style and colors"** (user directive) = the Doto face, the halftone
dot field, and every color token stay exactly as they are.

Repo: `/home/raivo/Documents/wellstreet`. Static site — **no build step**; the whole
toolchain is `node --test`.

---

## 0. BASELINE (main session, 2026-09-20 ~21:35)

- `node --test "site-tests/*.test.js" "api-tests/*.test.js"` → **500 pass / 0 fail**.
- `git diff --stat site/css/style.css` → 69 insertions / 11 deletions = the
  LEDGER-PRESS CSS moves ALREADY LANDED by the main session (§2). Do not revert
  them; build on them.
- Tree carries SIBLING work you must not touch (see §4 scope).

## 1. DESIGN SPEC — the moves

### 1a. LANDED already (main session — verify, don't redo; style.css)

1. **Radius lock (all-sharp):** `--radius: 0`, `--radius-soft: 0` (names kept,
   call sites unchanged). One corner system page-wide; tag registers distinguish
   by EDGE, not radius.
2. **Type re-value:** `--step-6: clamp(1.75rem, 3.2vw, 2.5rem)` (louder section
   voice), `--step-7: clamp(2.5rem, 4.6vw, 4rem)` (hero h1 + census numerals
   re-scaled for the split hero).
3. **Hero split CSS:** `.hero .wrap` = flex column; new `.hero-grid` (1-col base;
   ≥1000px `minmax(0,7fr) minmax(0,5fr)`, gap 48, align center), `.hero-copy`,
   `.hero-plate` (2px ink border, raised face, 56×6 amber corner tick via
   `::before`, plate-scoped `.hero-cut`/`.hero-stat-row` grid/`#hero-stat`
   margin overrides).
4. **Broadsheet section head:** `.block-head` gets `border-top: 2px solid
   var(--ink)` + `padding-top: 12px` + a 48×6 amber tab `::before` at top-left.
   Border-TOP only — the pinned `border-bottom: 2px solid var(--line)` count
   (theme.test.js (g), exactly 11) must stay 11.
5. **agents-caps marker:** `li::before` = 10×2 amber tick bar (was the `—`
   character).
6. **Fleet table head:** `thead th` border-bottom steps to `2px solid var(--ink)`.

### 1b. REMAINING (the worker's work)

**W1 — HTML hero restructure (`site/index.html`, hero section only):**

```
<section class="hero" id="top">
  <div class="hero-field" aria-hidden="true"></div>
  <div class="wrap">
    <p class="hero-ticker">WELLSTREET · ROBINHOOD CHAIN 4663</p>
    <div class="hero-grid">
      <div class="hero-copy">
        <h1>OWNED BY HOLDERS.<br>OPERATED BY AGENTS.</h1>
        <p class="hero-claim">THE OPEN, AI-NATIVE LIQUIDITY LAYER OF ROBINHOOD CHAIN.</p>
        <div class="hero-rule" aria-hidden="true"></div>
        <p class="hero-meta">every number is a raw RPC call<span class="hero-meta-dot"> ●</span><br>replay them yourself</p>
        <div class="cta-row">
          <a class="cta-solid" href="#fleet">Open the Fleet</a>
        </div>
      </div>
      <aside class="hero-plate" aria-label="The census, live">
        <p class="hero-cut">THE PROTOCOL'S CUT: <span class="hero-cut-zero">ZERO</span></p>
        <div class="hero-stat-row">
          <div id="hero-stat" class="hero-stat--unavailable"> …existing children verbatim… </div>
          <div id="hero-stat-zero" class="hero-stat--unavailable"> …existing children verbatim… </div>
        </div>
        <p class="hero-census-note">every number checkable</p>
        <div id="chain-badge" class="muted mt-16" aria-live="polite"></div>
      </aside>
    </div>
  </div>
</section>
```

- ALL ids/classes/inner markup of moved elements byte-identical (render.test.js,
  positioning.test.js, main.js fill points depend on them).
- The `<a class="cta-solid" href="#fleet">Open the Fleet</a>` stays exactly once
  (agent-first.test.js pins it).
- Existing comments move with their elements; update comment refs that describe
  the old stack order ("the DOM order IS the ratified rank…") with a dated
  LEDGER-PRESS note — never delete the provenance.

**W2 — section index eyebrows retire:** remove all seven
`<span class="index">NN</span>` spans (agents 01, fleet 02, deposit 03, flow 04,
vault 05, stats 06, docs 07). Keep the `.index` CSS rules (retired-register
records; theme.test.js (a2) pins the `#deposit .index` rule). Re-pin the index
count helpers in `site-tests/vault-ui.test.js` and `site-tests/flow.test.js` to
assert **zero** (dated amendment: LEDGER-PRESS 2026-09-20, the taste-skill §9.F
section-number ban).

**W3 — visible-copy em-dash purge (static HTML text nodes):** replace prose
em-dashes (` — `) in `site/index.html` visible copy with `:` / `,` / `·` as reads
best (e.g. agents block-sub "One skill file — any agent…" → "One skill file, any
agent…"; earn-loop "loop closes — see the whole loop" → "loop closes: see the
whole loop"; min-out note "below it — the chain is the final arbiter" → "below
it: the chain is the final arbiter"; flow lane labels "lane 1 — the vault (user
capital)" → "lane 1 · the vault (user capital)"; st-stream names "to holders —"
→ "to holders:"). **KEEP** the data-state glyphs: `>—</span>` value cells
(hero-stat-nums, flow-figs, st-values, `fleet-flagship-apr`, `lc-nums`,
`sim-projection`) — an em-dash as an unavailable VALUE is the designed
fail-closed state, not prose. After the purge: `grep -n ' — ' site/index.html`
returns zero lines. (Tool-tip `title="…waiting — …"` strings in HTML may keep
their dash if rewording risks a pin — prefer rewording where free.)

**W4 — head + og copy:** `<title>` → `Wellstreet: the AI-native liquidity layer
of Robinhood Chain`; `og:title` → `Wellstreet: the open, AI-native liquidity
layer of Robinhood Chain`. Re-pin `site-tests/positioning.test.js` R1/R2 title
assertions to the new strings (dated amendment).

**W5 — JS rendered-string literals (visible copy only; NEVER comments):**

- `site/js/main.js` `LAUNCH_FACT`: `'deployed — yield phase live'` →
  `'deployed · yield phase live'`; `'awaiting on-chain deploy — yield phase not
  started'` → `'awaiting on-chain deploy · yield phase not started'`;
  `prosePending`/`proseDeployed` " — " → ": ". `PAUSE_ROW` "never pausable —
  exits stay open" → "never pausable: exits stay open".
- Sweep `site/js/main.js`, `site/js/flow.js`, `site/js/stats.js` for RENDERED
  string literals containing " — " (status lines, sent lines, note lines) and
  restructure to ":" / "·". Keep `'—'` unavailable-value literals. Do NOT touch
  comments, verify-command templates, or config addresses.
- Re-pin every test that counts the old literals (agent-first.test.js:237/257,
  wow.test.js:185/204 and any others the suite reveals) — same assertion
  structure, new string, dated amendment.

**W6 — mobile one-screen hero re-tie (`site/css/style.css`):** the ≤640
WS5-TREATMENT block still targets `.hero .wrap > h1`, `.hero .wrap >
.hero-rule`, `.hero .wrap > .hero-meta`, `.hero .wrap > .cta-row` — re-point
those child selectors to the new DOM (`.hero-copy > h1`, `.hero-copy >
.hero-rule`, `.hero-copy > .hero-meta`, `.hero-copy > .cta-row`, and the
hero-grid/plate margins) so the 390×846 fold contract survives: h1 + CTA +
one census number within the first small viewport, CTA in the thumb third.
Keep `min-height: calc(100svh - 2px)` and the tape-strip/meta rules untouched.

**W7 — pre-flight polish sweep:** with all moves landed, re-read every changed
surface for the taste-skill §14 tells introduced by the change itself (wrapped
CTA, mixed radius remnants, stray em-dash) and fix. NO new colors, NO new fonts,
NO new motion keyframes.

## 2. LOCKED CONSTRAINTS (safety hooks — violating any = goal failed)

1. **COLOR FREEZE:** zero hex value changes anywhere in `site/css/style.css`
   (dark `:root`, both light blocks, every surface rule). The Doto font-face
   block stays byte-identical. Tooth:
   `git diff site/css/style.css | grep -E '^\+[^+]' | grep -cE '#[0-9a-fA-F]{6}'`
   must print **0**.
2. **Dot-matrix registers stay:** `.hero-field` halftone, `--font-display`/
   `--font-num` Doto usages, `.doto` class — present and unchanged in role.
3. **Scope:** ONLY `site/index.html`, `site/css/style.css`,
   `site/js/main.js`, `site/js/flow.js`, `site/js/stats.js`,
   `site-tests/*.test.js` may be edited. **NEVER** touch: `site/js/config.js`
   addresses, `site/data/fleet.json` (sibling-owned, dirty in the tree),
   `contracts/`, `src/`, `script/`, `test/`, `api/`, `docs/ops/*`, `broadcast/`.
4. **No new external resources** (resource-gate.test.js enforces; no CDN, no
   images, no fonts).
5. **Contrast:** no new text/background pair below WCAG AA 4.5:1 in EITHER
   theme. Amber fills keep ink text; `--accent-text` for amber-as-text.
6. **No push, no deploy.** wellstreet pushes are allowed by house rules but this
   goal ends at a LOCAL COMMIT. Commit ONLY the declared files (surgical staging;
   the shared index carries sibling entries — use the temp-index pattern if the
   staged set is dirty: `GIT_INDEX_FILE` exported, never inline-prefixed).
   Commit message: `feat: LEDGER-PRESS — taste-skill visual overhaul (Doto + palette byte-frozen)`.

## 3. VERIFY BATTERY (all must exit 0)

```bash
cd /home/raivo/Documents/wellstreet
node --test "site-tests/*.test.js" "api-tests/*.test.js"        # fail must be 0
! grep -q 'class="index">' site/index.html                       # eyebrows retired
grep -q 'class="hero-plate"' site/index.html                     # split hero landed
grep -q 'hero-copy' site/css/style.css                           # split CSS landed
! grep -q 'WELLSTREET — ROBINHOOD CHAIN 4663' site/index.html    # ticker dash gone
! grep -q ' — ' site/index.html                                  # prose em-dashes purged
test "$(git diff site/css/style.css | grep -E '^\+[^+]' | grep -cE '#[0-9a-fA-F]{6}')" = "0"  # COLOR FREEZE
grep -q -- '--radius: 0;' site/css/style.css                     # radius lock
test "$(grep -c 'border-bottom: 2px solid var(--line)' site/css/style.css)" = "11"  # (g) register intact
```

## 4. RE-PIN CONVENTION

House convention (theme.test.js precedent, six identity flips): same assertion
STRUCTURE, carrier table re-valued, each re-pin carries a dated marker
(`LEDGER-PRESS 2026-09-20: …`) and a one-line WHY. Never weaken a ban-list or
contrast assertion to make a test pass; fix the carrier or re-value with
justification.

## 5. OUT OF SCOPE (explicitly)

- docs/ markdown body copy, whitepaper, og.png, config addresses, flow/stats
  JS logic (only their rendered literal strings), theme token VALUES, the dark/
  light token blocks, fleet.json data.
