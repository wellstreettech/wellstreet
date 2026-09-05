# UI Improve 2 — TYPOGRAPHY & SCALE (2026-09-05)

**Lens:** typography & scale — headline register vs the ratified drafts, body rhythm, mono metadata sizing, letter-spacing discipline, numeric/tabular figures in ledger rows, optical alignment.
**Scope:** analysis-only. Zero site edits, zero commits, zero deploys. This doc is the only write.
**Repo:** `/home/raivo/Documents/wellstreet` (task brief HEAD `28208df`; Bash was unavailable this session so no git commands were run — every proposal below is anchored by a grep pattern, never a line number, so it is drift-safe against worktree/HEAD deltas).

**Inputs read:** `docs/inventory/FRONTEND_MAP_2026-09-04.md` · `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (incl. the ✅ ratified-drafts section) · **both ratified draft images viewed directly** (`/home/raivo/Pictures/welldis.jpg` desktop, `/home/raivo/Pictures/welldis1.jpg` mobile) · `site/css/style.css` (full) · `site/index.html` (full) · `site-tests/theme.test.js` (the pin carrier, so every honesty check below is test-grounded).

**Ratified law (binding):** paper `#EDE9DC` substrate · **serif EB Garamond display** (sentence case — the drafts' "Deposit the share. / Earn the fees.'" register) · accent green `#00A86B` (fill role; `--accent-text`/`--accent-punch` for text roles) · **mono metadata** edges · ledger rows `DEPOSIT — SPY / YOU RECEIVE — ws-SPY / BACKED 1:1 VERIFIABLE` as mono small-cap label grammar · "CHECKABLE, NOT SELLABLE" mono footer.

---

## 1. Type-system census (evidence base)

**Scale (style.css `:root` v1.2 block):** 7 text roles + 2 display clamps — `--step-1` 11px micro labels · `--step-4` 12.5px chrome/nav · `--step-6` 13.5px small · `--step-8` 14px data/code · `--step-11` 16px body · `--step-13` 18px card heads · `--step-15` 20px lede · `--step-20` clamp(2rem→3.3rem) display · `--step-21` clamp(1.35rem→1.7rem) section heads. Rule: "New text MUST pick one of these roles — a new token needs a written justification."

**Faces:** `--serif` EB Garamond (400–800 variable) = display only in principle; `--sans` Inter = body; `--mono` system stack = metadata/data.

**Letter-spacing census (uppercase/mono surfaces):**

| Tracking | Sites | Selectors |
|---|---|---|
| none | 2 | `.brand-tag`, `#doc-pane th` — the only untracked mono-metadata sites |
| 0.03em | 2 | `.hero-chip`, `.block-head h2` |
| 0.04em | 1 | `.card-title` |
| 0.05em | 3 | `.panel-head h3`, `.doc-tab`, `.inv-card h3` |
| 0.06em | 6 | `.site-nav a`, `.site-nav a.nav-cta`, `button.btn`, `.cta-solid`, `.cta-outline`, `.code-copy` |
| 0.08em | 16 | all micro labels (`.inv-dt`, `.hero-fact .k`, `.mint-card-tag`, `.stat-label`, `.flow-node-k`, footer cells, sim labels, …) |
| 0.12em | 1 | `.brand-word` (masthead) |
| 0.22em | 1 | `.block-head .index` (decorative numeral) |

Seven tracking values across one page — the same sub-perceptual-cluster disease R3 IMP-1 cured for sizes.

**What already honors the law (do not churn):** `font-variant-numeric: tabular-nums` on every data figure (`.ledger-v`, `.row-value`, `.stat-value`, `.inv-dd`, `.hero-chip`, `.sim-region-v`) ✓ · `.ledger-row`/`.inv-dl-row`/`.stat-line`/`.block-head` baseline alignment ✓ · the R3 scale collapse ✓ · exactly three radii ✓ · tabular status glyphs (`.flag-glyph` min-width) ✓.

**Findings (the gaps):**

- **F1 — The mid-display rung is missing.** Hero h1 tops at 6.25rem; section h2s sit at `--step-21` (21.6–27.2px). The drafts' grammar makes section statements display-class ("One token is one share. / Not one dollar." is the ratified invariant-section centerpiece); today the two-tone h2s are 22px **uppercase** serif — ticket-header register, not editorial display. The hierarchy jumps 100px → 27px with nothing in between.
- **F2 — Hero register is tighter/darker than the drafts.** Shipped h1: weight 400, line-height 0.96, letter-spacing −0.035em. The drafts show an airier monumental serif: visible air between the two lines (lh ≈ 1.05), open letterfit (Garamond's natural fit, not grotesque-crushing), strokes with more presence (~500). −0.035em on a Garamond at 400 risks hairline collisions ("st", "ry") and reads strained, not deadpan.
- **F3 — The punch word is green TEXT; the drafts' signature move is the green BLOCK.** Both drafts render the accent as a solid green highlight block behind serif type (the `#00A86B` block). Shipped: `.hero h1 .punch { color: var(--accent-punch) }` — quiet by comparison.
- **F4 — The last serif-in-data island.** `.ledger-k` (hero live-ledger row keys) is **serif 16px** while its sibling value is mono 14px — a 2px size clash inside one row — while the adjacent mint ticket's keys are mono 11px (`.mint-card .ledger-k` override) and `.hero-fact .k` is mono. Two adjacent hero cards, two row grammars. The ratified drafts show ONE grammar: mono small-cap labels.
- **F5 — Stat band hierarchy is inverted.** `.stat-glyph` (decorative `<`, `*`, `%`, `#`) renders 22–33px; `.stat-value` (the REAL figures) renders 18–26px sans. The decoration out-sizes the data. The drafts' tape register is big MONO.
- **F6 — `.card-row` lacks baseline alignment.** `.ledger-row` uses `align-items: baseline`; `.card-row` does not — so the APR row's 18px strong value top-aligns against its 14px label instead of sharing a baseline.
- **F7 — Tracking cluster + two untracked sites.** See census: 0.03/0.04/0.05 are sub-perceptual spread; `.brand-tag` and `#doc-pane th` carry no tracking at all; `.brand-word`'s 0.12em tracking leaves a trailing 2.2px gap inside its bordered plate (right padding reads optically wider than left).

---

## 2. Ranked proposals

Impact 1–5 (5 = changes how the page reads at first glance). Effort: S = one rule/one site; M = multi-site sweep. All diffs are CSS-only, token-only, no hex literals, no rgba(), no HTML/JS/copy changes, no new animation (reduced-motion guard untouched).

---

### P-01 · Section h2 → the drafts' display register (sentence-case serif, mid-display size)
**Impact 5 · Effort S**

**Problem:** F1. The two-tone h2s are the ratified drafts' centerpiece move and currently render 22–27px UPPERCASE with +0.03em tracking — the deadpan joke ("Not one dollar." / "Operated by agents.") lands through receding color, and uppercase-at-22px makes it shout instead. The drafts are sentence-case monumental serif.

**Diff** (rewrite the `.block-head h2` rule; extend `.block-head .index`):

```css
/* before */
.block-head h2 {
  margin: 0;
  font-family: var(--serif); /* V1 editorial-ledger display */
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-size: var(--step-21);
}

/* after */
.block-head h2 {
  margin: 0;
  font-family: var(--serif);
  text-transform: none;          /* drafts: sentence-case display */
  letter-spacing: -0.01em;       /* serif display, open fit */
  font-weight: 500;              /* drafts' stroke presence (EB Garamond var 400–800) */
  font-size: var(--step-20);     /* existing display rung — closes the 27px→100px gap */
  line-height: 1.05;
}
.block-head .index {
  font-size: var(--step-11);     /* was --step-6: numeral scales with the display head */
}
```

Token note: `--step-20` is an EXISTING role (no new token → no scale-law justification needed). If 52.8px max proves too monumental in the screenshot gate, the fallback is a justified mid rung `--step-22: clamp(1.9rem, 3.6vw, 2.9rem)` — decide at the gate, not in code.

**Anchor:** grep `.block-head h2 {` (unique) · grep `font-size: var(--step-21)` (2 hits: this rule + `#doc-pane h1` — edit only the `.block-head h2` one) · grep `.block-head .index {` (unique).

**Honesty/design-law check:** markup untouched (the hard `<br>` + `.quiet` spans stay byte-identical — theme.test.js (f) frozen-copy passes). `#deposit .index { color: var(--ink); }` (theme.test (a2) exact-regex pin) is a different rule — untouched. Per-section index colors (`#vaults`/`#docs`) unaffected. Sentence case matches the ratified drafts; no copy change; no overclaim. Caution: the Deposit h2's quiet line ("the only buttons on this page that can move funds", 49 chars) wraps to ~2 lines at display size — the flex `.block-head` keeps the muted meta baseline-right; verify in the screenshot gate.

---

### P-02 · Hero h1 register retune to the ratified drafts (air, weight, open fit)
**Impact 5 · Effort S**

**Problem:** F2. The h1 is the first thing the eye measures against the drafts, and today it is tighter (0.96), heavier-tracked (−0.035em) and lighter (400) than the ratified composition.

**Diff** (inside the `.hero h1` rule):

```css
/* before */
.hero h1 {
  font-family: var(--serif);
  font-size: clamp(2.5rem, 7.8vw, 6.25rem);
  font-weight: 400;
  line-height: 0.96;
  margin: 0 0 var(--space-24) 0;
  letter-spacing: -0.035em;
}

/* after */
.hero h1 {
  font-family: var(--serif);
  font-size: clamp(2.5rem, 7.8vw, 6.25rem);
  font-weight: 500;              /* drafts: strokes with presence */
  line-height: 1.04;             /* drafts: air between the two lines */
  margin: 0 0 var(--space-24) 0;
  letter-spacing: -0.015em;      /* Garamond's natural fit, un-crushed */
}
```

**Anchor:** grep `7.8vw` (unique — the only clamp at that viewport factor).

**Honesty/design-law check:** markup untouched (`text-wrap: balance` on h1 + the frozen `<br>` structure survive; theme.test (f) passes). No color change → the six WCAG pairs (theme.test (c)) unaffected. Hero `min-height: 80vh` flex-centering absorbs the taller block on desktop; the ≤640px P2 fold-order block (`order: 1..8`) is order-only and unaffected (verify fold height at the gate). Purely presentational — no honesty surface touched.

---

### P-03 · Punch word → the ratified green highlight BLOCK
**Impact 4 · Effort S**

**Problem:** F3. Both drafts carry the accent into the headline as a solid green block behind serif type — the single most distinctive ratified move the site has not shipped.

**Diff** (rewrite the punch rule):

```css
/* before */
.hero h1 .punch { color: var(--accent-punch); }

/* after */
.hero h1 .punch {
  color: var(--accent-ink);      /* ink on the ratified fill = 5.6:1 (asserted pair) */
  background: var(--accent);
  padding: 0 0.12em;
  box-decoration-break: clone;           /* block survives a line wrap */
  -webkit-box-decoration-break: clone;
}
```

**Anchor:** grep `.hero h1 .punch` (unique).

**Honesty/design-law check:** the drafts show CREAM text on the green block; the site's own law (style.css token comment, theme.test (c) rationale) is that the fill hue never carries cream text (2.5:1) — so this ships the law-compliant form of the same move: `--accent-ink` on `--accent`, which is ALREADY one of the six asserted pairs (5.6:1) → no new WCAG pair, no test change. No hex/rgba literals (theme.test (d) bans hold). Markup byte-frozen. `--accent-punch` stays live elsewhere (section indices, stat ticks, focus ring) — the token is not orphaned. Flag: headline-color anchor changes visually; the screenshot sign-off gate covers it.

---

### P-04 · Ledger row keys → the mono small-cap register (one grammar, both hero cards)
**Impact 4 · Effort S**

**Problem:** F4. The ratified draft grammar is mono small-cap ledger labels (`DEPOSIT — SPY`). The hero live-ledger still keys its rows in serif 16px against 14px mono values, while the mint ticket 400px away keys in mono 11px. Also bumps the honest-STATUS line (`connecting to public RPC…`) off the 11px legibility floor.

**Diff** (rewrite `.ledger-k`; extend `.hero-ledger-state`):

```css
/* before */
.ledger-k { font-family: var(--serif); font-size: var(--step-11); color: var(--ink); flex: 0 0 auto; }
.hero-ledger-state { font-family: var(--mono); font-size: var(--step-1); text-align: right; }

/* after */
.ledger-k {
  font-family: var(--mono); font-size: var(--step-4); text-transform: uppercase;
  letter-spacing: 0.08em; color: var(--ink); flex: 0 0 auto;
}
.hero-ledger-state { font-family: var(--mono); font-size: var(--step-4); text-align: right; }
```

The single `.ledger-k` change propagates to the mint ticket automatically (`.mint-card .ledger-k` only overrides `font-family`, which becomes redundant-but-harmless — leave it to minimize churn). Both cards now share the `.inv-dt` / `.hero-fact .k` label register; values stay `--step-8` mono tabular.

**Anchor:** grep `.ledger-k { font-family: var(--serif)` (unique) · grep `.hero-ledger-state { font-family: var(--mono); font-size: var(--step-1);` (unique).

**Honesty/design-law check:** after this, serif is display-ONLY on the page — a law-strengthening move (drafts: mono metadata; serif display). No copy change (uppercasing is CSS `text-transform`; the source strings stay sentence case). No color change → WCAG pairs untouched. Values/figures untouched (tabular-nums preserved). Flag: the drafts render these rows at a larger register still (~16px) — a fuller scale-up is a taste call for the user gate; this diff takes the register (face/case/tracking) without re-scaling the cards.

---

### P-05 · Stat band: data out-sizes decoration, and the figures go mono (tape register)
**Impact 4 · Effort S**

**Problem:** F5. The decorative glyphs (22–33px) out-size the real published figures (18–26px), and the value rides Inter with −0.025em tracking while the drafts' tape register is big mono.

**Diff** (rewrite `.stat-glyph` + `.stat-value`; keep the mandatory literal fallbacks — the WSV-STATS block rule):

```css
/* before */
.stat-glyph {
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
  font-size: clamp(22px, 3vw, 33px);
  line-height: 1;
  color: var(--accent-text, #0d6b4f);
}
.stat-value {
  font-family: var(--sans, "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif);
  font-size: clamp(18px, 2.2vw, 26px);
  font-weight: 600;
  letter-spacing: -0.025em;
  font-variant-numeric: tabular-nums;
  color: var(--ink, #1C1A15);
  min-height: 1.2em;
}

/* after */
.stat-glyph {
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
  font-size: clamp(15px, 1.8vw, 21px);   /* decoration recedes below the data */
  line-height: 1;
  color: var(--accent-text, #0d6b4f);
  opacity: 0.8;
}
.stat-value {
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
  font-size: clamp(20px, 2.6vw, 30px);   /* the REAL figure is the biggest thing in the cell */
  font-weight: 500;
  letter-spacing: normal;                /* mono digits are self-tabular; no grotesque tracking */
  font-variant-numeric: tabular-nums;
  color: var(--ink, #1C1A15);
  min-height: 1.2em;
}
```

**Anchor:** grep `.stat-glyph {` (unique) · grep `.stat-value {` (unique).

**Honesty/design-law check:** colors unchanged (accent-text glyph / ink value — asserted pairs); every `var()` keeps its mandatory literal fallback (WSV-STATS block contract; note the fallbacks are pre-existing pins, not new literals — theme.test (d) bans already tolerate them in place). Count-up (JS rAF) and `min-height: 1.2em` shrinkage guard unaffected; `.stat-tick` sits baseline in `.stat-line`. Weight 500 degrades gracefully on system monos without a medium cut (renders 400 — acceptable; do NOT use 600, which reads heavy at 30px). No data semantics touched — the projection cell keeps its static marker and the split cell stays un-animated (WOW-1 exclusions are JS-side).

---

### P-06 · `.card-row` baseline alignment (the APR row's 18px value vs 14px label)
**Impact 3 · Effort S**

**Problem:** F6. `.ledger-row` aligns baselines; `.card-row` doesn't — the strong APR value (`--step-13` inside a `--step-8` row) top-aligns against its label, a visible 4px-class optical sag on every vault card.

**Diff** (one declaration added to `.card-row`):

```css
/* before */
.card-row { display: flex; justify-content: space-between; gap: var(--space-14); padding: var(--space-9) var(--space-0); border-bottom: 1px dotted var(--line-dotted); font-size: var(--step-8); }

/* after */
.card-row { display: flex; justify-content: space-between; align-items: baseline; gap: var(--space-14); padding: var(--space-9) var(--space-0); border-bottom: 1px dotted var(--line-dotted); font-size: var(--step-8); }
```

**Anchor:** grep `border-bottom: 1px dotted var(--line-dotted); font-size: var(--step-8);` (unique — `.card-note` uses `border-top`, `.inv-dl-row` uses `1px solid`).

**Honesty/design-law check:** pure alignment — no color, no size, no copy. The ≤640px block flips `.card-row` to `flex-direction: column`; baseline alignment in a column is a no-op, so mobile is untouched. Matches the existing `.ledger-row` precedent exactly.

---

### P-07 · Action register: money-path buttons + primary nav step up one role
**Impact 3 · Effort S**

**Problem:** The page's most consequential labels ("2 · Deposit", "Connect wallet", "Run it yourself") sit at `--step-4` (12.5px) — below the 13.5px small-text role and visually quieter than the drafts' CONNECT button. One register for actions, matching the drafts' button prominence.

**Diff** (`font-size` re-point in five rules; everything else in each rule stays):

```css
.site-nav a          { font-size: var(--step-6); }  /* was --step-4 */
.site-nav a.nav-cta  { font-size: var(--step-6); }  /* was --step-4 */
button.btn           { font-size: var(--step-6); }  /* was --step-4 */
.cta-solid           { font-size: var(--step-6); }  /* was --step-4 */
.cta-outline         { font-size: var(--step-6); }  /* was --step-4 */
```

**Anchor:** grep `button.btn {` / `.cta-solid {` / `.cta-outline {` / `.site-nav a {` / `.site-nav a.nav-cta {` (each unique). Each `font-size: var(--step-4)` edit is inside that selector's block.

**Honesty/design-law check:** sizes only — colors, 44px min-heights, borders, radii untouched (no new WCAG surface). 13.5px uppercase mono at 0.06em stays ≥ the 12.5px chrome floor and clears WCAG size-neutrality (contrast unchanged). Mobile nav strip (nowrap scroll, 44px links) absorbs the +1px cleanly. Deliberate boundary: `.doc-tab` and `.share-symbol` stay at `--step-4` — pane chrome and symbol tags are not actions; if the gate disagrees, `.doc-tab` is the one to add.

---

### P-08 · Docs pane reading rhythm (long-form leading + tokenized heading air)
**Impact 3 · Effort S**

**Problem:** `#doc-pane` renders ~2,000px documents at the UI line-height (1.55) with UA-default heading margins — the honesty docs are the product, and their rhythm is the least designed surface in the system.

**Diff** (one declaration added to `#doc-pane`; two heading rules extended; one guard rule added):

```css
#doc-pane { /* existing rule — add: */ line-height: 1.65; }

/* before */
#doc-pane h2 { font-size: var(--step-15); } /* R3 IMP-11 ... */
#doc-pane h3 { font-size: var(--step-13); } /* R3 ... */

/* after */
#doc-pane h2 { font-size: var(--step-15); margin-top: var(--space-28); }
#doc-pane h3 { font-size: var(--step-13); margin-top: var(--space-20); }
#doc-pane h2:first-child, #doc-pane h3:first-child { margin-top: 0; }
```

**Anchor:** grep `border-top: none; background: var(--paper-raised); padding: var(--space-22)` (unique — the `#doc-pane` rule) · grep `#doc-pane h2 { font-size: var(--step-15); }` (unique) · grep `#doc-pane h3 { font-size: var(--step-13); }` (unique).

**Honesty/design-law check:** sizes stay on existing roles (no new token — the R3 IMP-1 law holds; the h1/h2 collision noted in the map is deliberately left alone because no mid role exists). No copy, no color. The renderer's escaped-first output is untouched (docs.test.js operates on JS, not CSS). Headings keep `scroll-margin-top: 84px` behavior (deep-link landing unchanged; the first-heading guard prevents a new gap under the title border).

---

### P-09 · The deadpan pitch line gets its typographic voice
**Impact 3 · Effort S**

**Problem:** The hero's skeptic line ("Every number on this page is something you can verify yourself — …") renders full-ink 16px at full measure. The ratified ascetic reference is explicit: deadpan subcopy is *small, matter-of-fact, quiet* — the joke/point lands through understatement. On mobile (P2 fold order) it sits directly under the h1 as the h1's echo — currently the loudest paragraph on the page.

**Diff** (additive rule, placed adjacent to the `.hero .lede` rule):

```css
/* deadpan skeptic line (the h1's echo): quiet color, narrowed measure —
   the reference's matter-of-fact subcopy register; mobile P2 order-2 slot */
.hero .wrap > p:not(.lede) { color: var(--ink-soft); max-width: 46ch; }
```

**Anchor:** insert after the rule grep-anchored by `max-width: 60ch` (unique — `.hero .lede`). The `:not(.lede)` + direct-child shape mirrors the existing mobile selector `.hero .wrap > p:not(.lede)` (order rules) so the pairing is greppable.

**Honesty/design-law check:** color/measure only — ink-soft on paper is an asserted WCAG pair (4.5:1+). No copy change (frozen strings intact). 46ch keeps the sentence to 2 lines; the CTA row position is untouched. This is the reference's deadpan register without touching a word.

---

### P-10 · Tracking discipline: two named tokens, cluster collapsed
**Impact 2 · Effort M**

**Problem:** Seven tracking values (census §1); the 0.03/0.04/0.05 cluster is sub-perceptual spread (the exact disease R3 IMP-1 cured in sizes), and two mono-metadata sites carry none.

**Diff** (tokens in the v1.2 `:root` block, then re-point):

```css
/* add to the :root token block, after the --step-* roles: */
--track-label: 0.08em;   /* micro metadata labels (the 16-site register) */
--track-chrome: 0.06em;  /* actions + nav + chrome headings */

/* re-point (value → token, per selector): */
.hero-chip        { letter-spacing: var(--track-chrome); }  /* was 0.03em */
.card-title       { letter-spacing: var(--track-chrome); }  /* was 0.04em */
.panel-head h3    { letter-spacing: var(--track-chrome); }  /* was 0.05em */
.doc-tab          { letter-spacing: var(--track-chrome); }  /* was 0.05em */
.inv-card h3      { letter-spacing: var(--track-chrome); }  /* was 0.05em */
.site-nav a,
.site-nav a.nav-cta,
button.btn,
.cta-solid,
.cta-outline,
.code-copy        { letter-spacing: var(--track-chrome); }  /* was 0.06em */

/* the sixteen 0.08em sites → the label token (edit each rule in place; the
   grouped form below is the canonical end-state): */
.inv-dt, .hero-fact .k, .mint-card-tag, .stat-label, .stat-marker,
.flow-node-k, .sim-note, .sim-slider-label, .sim-region-k,
.footer-grid .h, .footer-fine, .apr-footnote .lbl, .pending-tag,
.field label, .hero-ledger-title, .ledger-k {
  letter-spacing: var(--track-label);
}

/* the two untracked sites join the label register: */
.brand-tag        { letter-spacing: var(--track-label); }
#doc-pane th      { letter-spacing: var(--track-label); }
```

**Anchor:** grep `letter-spacing: 0.05em` (3 hits) · `letter-spacing: 0.04em` (1) · `letter-spacing: 0.03em` (2 — the other is `.block-head h2`, already re-pointed by P-01) · `letter-spacing: 0.06em` (6). `.brand-tag {` and `#doc-pane th {` unique.

**Honesty/design-law check:** written justification for the two new tokens (the scale law requires one): these are TRACK roles, not text sizes — `--track-label` = metadata legibility tracking at 11–14px, `--track-chrome` = action/nav tracking; each replaces 2–6 byte-different declarations of the same intent. Two deliberate outliers stay literal and documented: `.brand-word` 0.12em (masthead display) and `.block-head .index` 0.22em (decorative numeral). Zero rendered change on the 0.06→token and 0.08→token sites (byte-identical computed values); the 0.03/0.04/0.05 sites shift by ≤0.03em (sub-perceptual by construction). Apply AFTER P-01/P-04/P-07 (which author the final per-selector values) or rebase those diffs onto the tokens directly.

---

### P-11 · Masthead optics: tracking gap compensation in the bordered plate
**Impact 2 · Effort S**

**Problem:** `.brand-word`'s 0.12em tracking adds a trailing ~2.2px after the final "T" inside the bordered masthead plate — the right padding renders optically wider than the left (classic uppercase-tracking artifact). The tag beside it is the one untracked mono metadata surface.

**Diff**:

```css
/* before */
.brand-word {
  font-family: var(--serif);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: var(--step-13);
  border: 2px solid var(--line);
  padding: var(--space-2) var(--space-10);
  background: var(--paper-2);
}

/* after */
.brand-word {
  font-family: var(--serif);
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-size: var(--step-13);
  border: 2px solid var(--line);
  padding: var(--space-2) var(--space-10);        /* left stays --space-10 */
  padding-right: calc(var(--space-10) - 0.12em);  /* optical: eats the trailing tracking unit */
  background: var(--paper-2);
}
.brand-tag { font-family: var(--mono); font-size: var(--step-1); color: var(--ink-soft); text-transform: uppercase; letter-spacing: 0.08em; }
```

(If P-10 lands first, `.brand-tag`'s value becomes `var(--track-label)`.)

**Anchor:** grep `.brand-word {` (unique) · grep `.brand-tag {` (unique).

**Honesty/design-law check:** optical correction only — the box model shifts ~2px; no color/copy/face change (serif caps wordmark is the ratified pairing — the drafts' render reads sans-ish but the law doc pins "WELLSTREET serif caps beside the glyph", so the face is NOT relitigated here). `--space-10` minus one tracking unit stays positive (16.84px... 10px − 2.16px = 7.84px) — safe at all widths.

---

## 3. Suite-safety matrix (theme.test.js is the pin carrier)

| Pin | Relevant proposals | Verdict |
|---|---|---|
| (a) palette token pins | none touch token VALUES | pass |
| (a2) `#deposit .index { color: var(--ink); }` exact regex | P-01 touches `.block-head .index` font-size only | pass |
| (b) metas | HTML untouched by all | pass |
| (c) six WCAG pairs (computed from tokens) | P-03 reuses the already-asserted accent-ink/accent pair; no new pair, no color-token change | pass |
| (d) hex/rgba bans, `#fbfaf5 == 1`, motif retint == 6, favicon asserts | all diffs token-only, no new literals, HTML untouched | pass |
| (f) frozen copy (contains, ==1) | HTML untouched by all | pass |
| (g) `border-bottom: 2px solid var(--line)` == **exactly 9** | no proposal adds/removes that string — do not reformat any rule carrying it while applying | pass (guard) |
| (g) hatch/CTA/footer/mono-edge asserts | untouched | pass |

General application rule (per the law doc): any proposal that changes a visually-anchored declaration ships with the suite run + screenshot gate in the same change; frozen-copy and geo lines are never touched by any diff above.

---

## 4. Application order and anti-churn notes

1. **Order:** P-02 → P-01 → P-03 (headline system in one screenshot comparison) → P-04 → P-05 (data registers) → P-06 → P-08 → P-09 → P-07 → P-11 → P-10 (the sweep last, rebasing onto landed values).
2. **Do NOT do:** do not re-add uppercase to display heads; do not reintroduce serif into data rows; do not "fix" the established `--step-1` micro-label register downward or upward wholesale (P-04/P-10 are the scoped exceptions); do not add font-size tokens (every size re-point above uses existing roles); do not touch the geo-frozen lines, the h1 markup, or any string theme.test counts.
3. **Effort profile:** no L proposals — the v1.2/R3 token foundation is sound; every gap is register-level, not structural. The highest-leverage three (P-01, P-02, P-03) are all single-rule edits.
4. **Verification:** after any applied batch — `node --test site-tests/` (zero new failure IDs), plus the screenshot gate at 1280/375 for the headline trio.
