# UI Improve Round 2 — GLYPHS & SMALL MARKS lens (2026-09-05)

**Repo:** `/home/raivo/Documents/wellstreet`. **Scope:** analysis-only, ZERO site edits. Every claim below was read off the current worktree (HEAD `28208df` + live sibling deltas — the worktree carries landed WS-A11Y-QUICK / WS-MOBILE-FIXES / WS-PRODUCT-GAPS hunks and a fresh canyon-hero sibling; **re-verify every grep anchor at dispatch**, DISPATCH-TIME STATE UPDATE discipline). Line numbers are provenance, never edit targets.

**Method:** full read of `site/index.html` (592 ln), `site/css/style.css` (1,511 ln), `site/js/main.js` (1,639 ln), `site/js/docs.js`, the four guard batteries (`icon-cdn-guard` / `resource-gate` / `render` / `theme`), the four sibling maps (motion / a11y / copy / mobile / ux-flows — dedup §2), and the binding docs (`FRONTEND_MAP_2026-09-04.md`, `DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md`).

**The lens question, answered:** the status-glyph language is a **latent system, ~80% coherent, undocumented, with three drift points**. The system that already exists: *glyphs that carry data render in the mono face riding TEXT-role tokens* (`--accent-text` / `--accent-punch` / `--warn` / `--ink-soft`), while *the FILL token `--accent` is reserved for surfaces* (style.css:21's own documented rule); *decorative counter-glyphs* (`< % * #`) ride the display register; *the live marker is a 6px SQUARE, not a dot* (the ens anchor-square motif, `.hero-chip::before`); *the separator is the mid-dot `·`*; *≈ always marks a derived figure, … always marks truncation, ✓ always names the read that verified*. The three drift points: (1) `.flag-ok .flag-glyph` rides the FILL token at 2.54:1 — the only glyph that breaks the token law (and the only WCAG failure in the set, = a11y mapper finding 7, deferred by WS-A11Y-QUICK); (2) tag shapes split square-vs-pill across two registers with no written rule; (3) the live square exists only in the hero chips while two other live surfaces are bare text. Every proposal below either enforces the system or extends it — none invents a new glyph vocabulary.

---

## 0. Glyph census (what exists — proposals do not duplicate it)

| Glyph | Where | Mechanism | Token / face | File:line (worktree) |
|---|---|---|---|---|
| `●` / `△` status pair | vault status row, chain badge, ledger vault-state | JS `flagNode` span, CSS-aligned (`.flag-glyph` min-width 1.2em) | `--accent` **(drift 1)** / `--warn` | main.js:156-162; style.css:304-310 |
| `✓ <read>` stamp | hero ledger rows 1-3 | CSS `content: '✓ ' attr(data-stamp)`, 900ms fade, sequential 0/140/280ms (WS-MOTION-POLISH) | `--accent-text`, mono | style.css:1079-1095; main.js:659-666 |
| 6px live square | hero chips | `.hero-chip::before`, `currentColor` square | chip fill | style.css:800-807 |
| `▲` / `▼` / `–` tape ticks | stat band LIVE cells only | JS `tickGlyph` + `.stat-tick--up/down/flat` | punch / warn / ink-soft | main.js:565-584; style.css:1011-1025 |
| ` ▲` / ` ▼` delta marks | ledger row flashes | `::after` content | accent-text / warn | style.css:1049-1060 |
| `< % * #` counter-glyphs | stat band 4 cells | static markup | `--accent-text`, mono | index.html:217, 222, 227, 233 |
| `→` arrow | 2 CTAs + flow node | text | mono | index.html:119-120, 264 |
| `·` mid-dot separator | ~15 sites (brand tag, stamps, muted row joins, footer, split cell) | text | mono / sans, `--ink-soft` | main.js:110, 246-265, 337, 353, 1146, 1151, 1550; index.html:53, 522-523 |
| `≈` derived-figure mark | TVL USD, share price, previews | text | mono | main.js:337, 1151, 1351, 1356 |
| `…` truncation mark | addresses (`fmtAddr`) | text | mono | main.js:45 |
| `└` hierarchy mark | APR methodology input row | text | mono | main.js:834, 838 |
| Tag/badge shapes | MINT TICKET, DEFINITION-LEVEL GUARANTEE, pending-tag, share-symbol (square 1px) vs stat-marker, hero-chip (pill) | CSS | line/warn/accent borders | style.css:291, 323-326, 677-687, 713-722, 943-955 |
| Serif-W favicon | `<link rel="icon">` | inline data-URI SVG | `--paper-2` + `--ink` hexes, URL-encoded | index.html:21-24 |
| Hero motif | green grid + 2 quarter-turn tracks + dot + 2 rects | inline SVG, `rgba(0,168,107,*)` ×6 | pinned count: **exactly 6** in index.html | index.html:80-92; theme.test.js (d) |

**Shared law every proposal respects** (verified against the batteries):
- `icon-cdn-guard.test.js` — zero cdnjs/fontawesome bytes; **all new marks are inline SVG, CSS, or text**. The `resource-gate` COMPRESSED-KEEPER rider pins **exactly four** `img/compressed/` srcs — **no new image files** anywhere in this lens.
- `theme.test.js (d)` — `rgba(0,168,107,` appears in index.html at **exactly six** sites (the motif): any new HTML accent must use `currentColor`/tokens, never a new rgba literal; banned-hex list + `#fbfaf5`×1 + `border-bottom: 2px solid var(--line)`×9 substring pins; favicon stays a `data:image/svg+xml,` URI whose encoded `%23E4DFD1` / `%231C1A15` values are asserted (token-resolved).
- `theme.test.js (f)` frozen copy: the h1, `'Read the code'`, `'1 · Approve'`, `'2 · Deposit'`, both metas — untouchable.
- WCAG: new/changed colored glyphs ride text-role tokens only — accent-text 5.35:1 paper / 5.65:1 paper-raised / 4.88:1 paper-2; punch 5.42:1; warn 5.42:1; ink-soft 5.85:1; accent-ink on accent 5.64:1.
- No new element ids (render.test.js REGISTRY RIDER); no new CSS inside the WS-ASSET-WIRE byte-pinned zone (agent-first.test.js b2) — new rules land in component regions or one EOF block; no new `@media` blocks needed by any proposal below.

---

## 1. Ranked proposals

### G1. Enforce the glyph token law — the `●` status dot rides the FILL token at 2.54:1 (closes a11y finding 7)
- **Anchor:** style.css:309 `.flag-ok .flag-glyph { color: var(--accent); }` + main.js:159 (`ok ? '●' : '△'`). One rule away, `.flag-ok`'s own TEXT already rides `--accent-text` (style.css:305).
- **What changes:**
  ```css
  /* before */
  .flag-ok .flag-glyph { color: var(--accent); }
  /* after (G1, UI_IMPROVE2_GLYPHS): the glyph obeys the fill/text token law —
     data glyphs ride TEXT-role tokens; --accent stays reserved for surfaces */
  .flag-ok .flag-glyph { color: var(--accent-text); }
  ```
  Plus the one-line system comment at the `.flag` block head (style.css:307 area) documenting the law: *"glyphs carry data → text-role tokens; `--accent` is a surface fill"*. This is the cornerstone fix: every other proposal inherits the law instead of re-arguing it.
- **Why:** a status dot that nearly vanishes (2.54:1 paper / 2.68:1 paper-raised — computed by the a11y mapper and re-confirmed) is exactly the quiet dishonesty the brand argues against; the fix also retires a11y mapper finding 7, explicitly deferred by WS-A11Y-QUICK ("out of scope: … status glyph").
- **Grep anchors:** pre: `grep -cF '.flag-ok .flag-glyph { color: var(--accent); }' site/css/style.css` = 1 → post: same form with `--accent-text` = 1 and the accent form = 0 (exit-tolerant `== 0` wrapper). Pre-flight at dispatch: `grep -rnF 'flag-glyph' site-tests/` — expected 0 hits (no pin surfaces the glyph color); re-verify.
- **Effort S · Impact 4.** Design law: tokens only ✓; WCAG 5.35/5.65:1 ✓; zero bytes of behavior change ✓; no test re-pin expected (re-verify at dispatch).

### G2. Favicon: serif-W plate → the ratified thumbs-up mark (inline data-URI, zero new files)
- **Anchor:** index.html:21-24 (the R3 IMP-11 favicon block + `serif W` data-URI). The nav already carries the thumb (`site/img/logo-mark.png`, index.html:51) — the tab icon is the last surface still shipping the retired masthead-plate identity. The design reference §SITE LOGO WIRING already ratified this swap ("favicon data-URI replaced by the derived `logo-solid.png`"); this proposal is the in-lens, zero-asset form of it.
- **What changes (exact diff, one line):**
  ```html
  <!-- G2 (UI_IMPROVE2_GLYPHS): favicon = the ratified thumbs-up mark as a
       solid-ink silhouette (halftone dies at 16-32px — the ratified logo system's
       favicon rule). Plate/stroke stay the --paper-2 / --ink token values the
       theme battery resolves (theme.test.js (d) favicon asserts stay green
       untouched). Still an inline data-URI — zero new files, zero requests. -->
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' fill='%23E4DFD1'/%3E%3Crect x='2' y='2' width='60' height='60' fill='none' stroke='%231C1A15' stroke-opacity='0.4' stroke-width='2'/%3E%3Cpath fill='%231C1A15' d='M13 29h8v22h-8zM24 51c-2.8 0-5-2.2-5-5V31.5c0-1.5.6-2.9 1.7-3.9l7.6-7.2c1.1-1 1.7-2.5 1.7-4v-6c0-2 1.6-3.6 3.6-3.6 3.6 0 6.4 2.9 6.4 6.4v9.3h7.2c3.2 0 5.6 2.8 5.1 5.9l-2 13.9c-.4 2.9-2.9 5-5.8 5L24 51z'/%3E%3C/svg%3E">
  ```
  Geometry note: the path is a hand-tuned cuff+fist+thumb silhouette matching the `logo-mark.png` pose (thumb up-right, knuckle block left). **The implementing goal's gate is visual, not textual:** render at 16/32/48px against `docs/internal/design-kit/logo/logo-favicon-32.png` + `_logo_review.png` and nudge control points until the silhouette reads; never ship blind. (A potrace/trace of `logo-solid.png` is the alternative if hand-tuning misses — offline derivation, still one inline path.)
- **Why it stays test-green without touching theme.test.js:** the (d) asserts resolve `--paper-2`/`--ink` from the stylesheet and require the ENCODED hexes to exist somewhere in index.html (`%23E4DFD1`, `%231C1A15`) + the `data:image/svg+xml,` form — all three hold; the old serif `<text>` element carries no pin.
- **Grep anchors:** post: `grep -cF '%3EW%3C' site/index.html` = 0 (exit-tolerant); `grep -cF 'thumbs-up' site/index.html` ≥ 1 (new comment); theme.test.js (d) favicon asserts pass unchanged. **Out of lens (do not absorb):** og.png rebuild + nav lockup — owned by the wsdegen logo goal.
- **Effort S · Impact 4.** Design law: data: URI PASS (resource-gate classifier) ✓; no new files ✓; icon-cdn-guard ✓; zero requests ✓.

### G3. The hero ledger's live state becomes the ratified green LIVE tag (fill treatment, data kept)
- **Anchor:** index.html:136 `<span class="hero-ledger-state" id="hero-ledger-state" aria-live="polite">connecting to public RPC…</span>`; JS writes `live · chain 4663` at main.js:315-316; CSS style.css:638-640.
- **What changes (CSS only, edit the existing rule in place):**
  ```css
  /* before */
  .hero-ledger-state.flag-ok { color: var(--accent-text); }
  /* after (G3, UI_IMPROVE2_GLYPHS): the ratified draft's green LIVE tag grammar
     (DESIGN_REFERENCE §ratified: "accent GREEN #00A86B (CONNECT button, LIVE
     ONCHAIN tag)"). The chip IS a state surface, so the FILL token applies;
     text rides --accent-ink (5.64:1). Data kept: 'live · chain 4663'. */
  .hero-ledger-state.flag-ok {
    background: var(--accent);
    color: var(--accent-ink);
    padding: var(--space-2) var(--space-8);
    border-radius: var(--radius);
  }
  ```
- **Why:** the ratified nano-banana drafts name this exact element — the live-tag is the hero's single "this is actually live" signal and today it is bare 11px mono text sitting next to a 2px-bordered card, visually weaker than the decorative chips floating above it. The flag-warn variant stays plain (a failure should not wear a badge). No copy change — the tag carries the real chain id (more honest than the draft's literal "LIVE ONCHAIN" wording; if the user wants that exact string, it is a copy-goal call, user-gated).
- **Grep anchors:** pre: `grep -cF '.hero-ledger-state.flag-ok { color: var(--accent-text); }' site/css/style.css` = 1 → post 0; post: `grep -cF 'background: var(--accent);' site/css/style.css` +1. No HTML change (a11y goal's `id="hero-ledger-state" aria-live="polite"` ×1 pin untouched). The `is-connecting` pulse (opacity-only) composes fine with the fill.
- **Effort S · Impact 4.** Design law: surface gets the fill token (law-consistent, cf. `.btn-primary`) ✓; accent-ink on accent 5.64:1 ✓; tokens only ✓; no motion added ✓.

### G4. Extend the `✓ read` stamp grammar to the coverage seam — the two skeptic-facing cells name the read that verified them
- **Anchor:** main.js:849-862 (`fillBackingCoverage`, the single seam writing `#mint-backed` + `#inv-stat`); the WOW-8 stamp anatomy (style.css:1079-1095, JS `stampRow` main.js:659-666); #mint-backed already carries the `.ledger-v` class (index.html:170).
- **What changes (JS, one helper + one call; the minimal variant needs ZERO CSS):**
  ```js
  // G4 (UI_IMPROVE2_GLYPHS): the WOW-8 stamp grammar extended to the coverage
  // seam — the skeptic-facing cells name the read that verified them.
  // Data-carrying only (✓ + the read name), same .ledger-stamp anatomy.
  function stampCoverage() {
    [$('mint-backed'), $('inv-stat')].forEach(function (c) {
      if (!c || !c.setAttribute) { return; }
      c.setAttribute('data-stamp', 'backingCoverage');
      if (c.classList) { c.classList.add('ledger-stamp'); }
    });
  }
  ```
  called in the live-read branch:
  ```js
  // before
  writeAll(pct === null ? 'unavailable (RPC)' : pct);
  // after
  writeAll(pct === null ? 'unavailable (RPC)' : pct);
  if (pct !== null) { stampCoverage(); }
  ```
  CSS (only needed for the `#inv-stat` cell, which is not `.ledger-v` — three selector-list edits, all outside pinned zones):
  - style.css:1079 `.ledger-v.ledger-stamp::after {` → `.ledger-v.ledger-stamp::after, .inv-stat.ledger-stamp::after {`
  - style.css:1349 (reduce block animation-none selector list) — append `.inv-stat.ledger-stamp::after`
  - style.css:1358 (reduce restate `opacity: 0.9`) — same append.
  **Minimal variant:** stamp `#mint-backed` only (it is already `.ledger-v`) and ship zero CSS; disclose the asymmetry. **Full variant preferred** — the seam's whole point is the two cells matching.
- **Why:** the ✓ stamp is the site's single best "checkable, not sellable" texture — it names the actual RPC read that landed — and today it exists only in the hero ledger while the BACKED cell (the literal Skeptic row, ratified Stratton grammar) verifies silently. `textContent` is untouched (the stamp is `::after`), so the byte-for-byte seam pins (`render.test.js`: `inv-stat === mint-backed`, `'100.0%'`) and the a11y aria-live pins all hold; the stamp is decoration on top of the published string.
- **Grep anchors:** pre: `grep -cF 'stampCoverage' site/js/main.js` = 0 → post 2 (definition + call); `grep -cF 'data-stamp' site/js/main.js` 1 → 2 (helper joins `stampRow`). No new ids (both cells registered). ⚠ Sibling discipline: WS-MOTION-POLISH owns the adjacent stamp selectors (base `opacity: 0`, delays 0/140/280ms) — re-grep those rules at dispatch and land after that wave quiesces; do not re-time the stagger.
- **Effort S-M · Impact 3.** Design law: stamp stays data-carrying (the WOW-8 kill-rule: strip the read name → kill the package) ✓; reduce pair extended ✓; honesty: the stamp only ever fires on a REAL successful read ✓.

### G5. Per-section motif echo — the hero's quarter-turn track grammar repeated as quiet section marks
- **Anchor:** hero motif index.html:80-92 (grid + 2 tracks + dot + 2 rects); `.block-head` anatomy index.html:289-293 etc. (flex, `.spacer`, trailing `.muted`).
- **What changes:** one shared `<defs>` (zero-request `<use>` source, added INSIDE the existing hero-motif SVG — no new rgba literal, so theme.test's six-site pin holds) + a 40-72px corner mark in each numbered section head, colored from the STYLESHEET via `currentColor`:
  ```html
  <!-- inside <svg class="hero-motif"> defs, after the pattern -->
  <path id="ws-track-echo" d="M72 8H36a28 28 0 0 0-28 28v36" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round"/>
  ```
  ```html
  <!-- per .block-head (01-05), before the trailing .muted span -->
  <svg class="sec-motif" viewBox="0 0 80 80" aria-hidden="true" focusable="false"><use href="#ws-track-echo"/></svg>
  ```
  ```css
  /* G5 (UI_IMPROVE2_GLYPHS): per-section echo of the hero motif's quarter-turn
     track — identity cohesion down-page, tokens only (currentColor + CSS alpha;
     zero new rgba literals in HTML — theme.test.js (d) six-site pin preserved). */
  .sec-motif { width: clamp(40px, 6vw, 72px); height: auto; color: rgba(0, 168, 107, 0.14); margin-left: var(--space-14); flex: 0 0 auto; }
  @media (max-width: 640px) { /* into an EXISTING ≤640 block, never a new one */
    .sec-motif { display: none; }
  }
  ```
- **Why:** the motif is the page's only self-authored vector identity and it dies after the hero; five sections of pure type follow. The echo is the cheapest identity thread (one path, zero requests, no new assets) and answers the lens question — extend per section, not bigger in the hero.
- **Grep anchors:** post: `grep -cF 'sec-motif' site/index.html` = 5 (+1 in CSS); pre/post: `grep -cF 'rgba(0,168,107,' site/index.html` = **6** (unchanged — the new path is `currentColor`, the CSS alpha is a spaced form in the stylesheet, which theme.test does not count); `grep -cF '#ws-track-echo' site/index.html` = 2 (def + … actually 1 def + 5 use = 6). Pre-flight: `grep -nF 'ws-track-echo' site-tests/` expected 0.
- **Effort M · Impact 3.** Design law: decorative only (aria-hidden) ✓; tokens ✓; ≤640 hidden (mobile fold discipline, E3 evidence) ✓; no new files/requests ✓; icon-cdn-guard ✓.

### G6. Tag/badge shape register — record the two-register rule (one comment edit; zero visual change)
- **Anchor:** square evidence tags — `.mint-card-tag` style.css:677-687, `.inv-tag` :713-722, `.pending-tag` :323-326 (warn role), `.share-symbol` :291; pill state tags — `.stat-marker` :943-955, `.hero-chip` :779-798. The radius-law comment (style.css:583-587) says pill = "every interactive action + tag pill", which contradicts four shipped square tags.
- **What changes:** documentation + the comment fix:
  ```css
  /* before (radius-law block, style.css ~:585) */
     var(--radius) 999px (every interactive action + tag pill)
  /* after */
     var(--radius) 999px (every interactive action + STATE tag/chip: .stat-marker,
     .hero-chip — live/live-adjacent markers) — EVIDENCE tags (MINT TICKET,
     DEFINITION-LEVEL GUARANTEE, pending, share-symbol) are DATA/LEDGER elements
     and keep the hard square, per the same D15 taste split that governs cards.
  ```
  Future tags pick a register by role: names a verified on-chain fact → square; names a live page state → pill. (No markup moves — the shipped split is already coherent; the drift was that it was unwritten and the law comment misdescribed it.)
- **Grep anchors:** post: `grep -cF 'EVIDENCE tags' site/css/style.css` = 1. No test touches the radius comment (re-verify `grep -rnF 'tag pill' site-tests/` = 0 at dispatch).
- **Effort S · Impact 2** (system record — the lens deliverable is half the value). Design law: zero visual delta ✓.

### G7. Live-mark square promoted to the other live surfaces (the "live dots" answer: it is a SQUARE)
- **Anchor:** `.hero-chip::before` 6px `currentColor` square (style.css:800-807) — the only live marker; `#vaults-updated` (`live on-chain reads · updated Xs`, main.js:110) is bare text.
- **What changes (CSS only, one rule beside the stamp/Vaults-head rules):**
  ```css
  /* G7 (UI_IMPROVE2_GLYPHS): the chips' 6px anchor square is the site's live
     marker; the tape stamp joins it. currentColor: the square beats with the
     heartbeat (accent-text pulse / ink-soft dim for free). */
  #vaults-updated::before {
    content: '';
    display: inline-block;
    width: 6px; height: 6px;
    background: currentColor;
    margin-right: var(--space-6);
    vertical-align: 1px;
  }
  ```
- **Why:** one glyph = "this surface is live", reused, not reinvented; the heartbeat's existing color states color it for free. Placement: component region near `.block-head`/stamp rules (style.css ~:1000-1070 area) — OUTSIDE the WS-ASSET-WIRE byte-pinned zone.
- **Grep anchors:** post: `grep -cF '#vaults-updated::before' site/css/style.css` = 1. No HTML/JS change; `content: ''` pseudos carry no text pins.
- **Effort S · Impact 2.** Design law: decorative pseudo, no AT noise (the span text already announces) ✓; no motion added ✓.

### G8. Arrow grammar: `→` = in-page forward, `↗` = off-site exit (one site today)
- **Anchor:** index.html:119-120 (`Deposit →`, `Read the code →` — the second label is frozen-copy pinned, do not touch its text), index.html:264 (`SPY → ws-SPY shares`), main.js:1295 (`'verify it on the explorer'` — the page's only off-site nav surface, `target=_blank`).
- **What changes:**
  ```js
  // before
  var a = el('a', 'tx-link', 'verify it on the explorer');
  // after (G8: ↗ marks the page's one off-site exit — the explorer link —
  // mirroring the → in-page grammar; glyph appended AFTER the pinned string)
  var a = el('a', 'tx-link', 'verify it on the explorer ↗');
  ```
  Plus one system comment at the `.cta-row` block (style.css:355 area): `→` promises forward motion inside the page; `↗` promises an off-site handoff; no other arrows ship (`›`, `»`, `⇒` banned by convention).
- **Why:** the site is scrupulous about honesty registers in words but its one external exit looks identical to its in-page jumps. `grep -F 'verify it on the explorer'` stays ×1 (the copy-goal pin is a substring — appending the glyph keeps it green).
- **Grep anchors:** pre: `grep -cF 'verify it on the explorer ↗' site/js/main.js` = 0 → post 1; `grep -cF 'verify it on the explorer'` stays 1.
- **Effort S · Impact 2.** Design law: text glyph, no asset ✓; frozen copy intact (substring) ✓.

### G9. Separator & hierarchy glyph register — codify `·` `≈` `…` `└`, normalize the phantom wide form
- **Anchor (drift):** main.js writes `'  ·  '` (two spaces each side) at **7 literal sites** — :246, :254, :263, :264, :265, :337, :353 — while every other separator site (stamp :110, split cell :1550, balances :1146, footer index.html:522-523, frozen `'1 · Approve'`) uses single spaces. In HTML the double spaces collapse to one — the wide form is a phantom convention: dead bytes that invite copy-paste drift.
- **What changes:** (a) normalize the 7 sites to `' · '` (visual no-op, verified by whitespace collapsing — no `white-space: pre` on `.row-value`/`.ledger-v`/`.muted`); (b) one census comment at the top of main.js's helpers: `·` separates metadata fields · `≈` marks a derived figure (never a promise — the sim/preview/balance sites already obey) · `…` marks truncation (`fmtAddr`) · `└` marks a methodology child row (main.js:834/838, the only box-drawing glyph). No new separators (`—` stays the degraded-state em-dash per the honest-state idiom).
- **Grep anchors:** pre: `grep -cF "  ·  " site/js/main.js` = 7 → post 0 (exit-tolerant); `grep -cF ' · ' site/js/main.js` grows accordingly. Pre-flight: none of the 7 sites is inside a pinned literal (frozen copy `'1 · Approve'`/`'2 · Deposit'` are single-space already — theme.test (f) untouched).
- **Effort S · Impact 2** (hygiene + system record). Design law: zero visual change ✓; zero copy semantics change ✓.

### G10. Stat-band counter-glyphs: upgrade the set from decorative to meaning-carrying (user-gate)
- **Anchor:** index.html:217/222/227/233 (`< * % #`, comment: "the design reference's display-font character set").
- **What changes (user-gated — the set is a ratified reference artifact; theme.test pins none of it):**
  ```html
  <!-- before / after (G10) -->
  <span class="stat-glyph">&lt;</span>   →  <span class="stat-glyph">Σ</span>  <!-- TVL = the summed pool balances -->
  <span class="stat-glyph">*</span>      →  <span class="stat-glyph">$</span>  <!-- SPY USD -->
  <!-- % and # stay (APR, split/counting) -->
  ```
- **Why:** `<` and `*` are pure decoration in an otherwise data-carrying glyph language; `Σ`/`$` keep the ledger register AND read. Rejected: emoji, icon-SVGs in the band (the band is aria-hidden duplication — weight discipline), `Δ` (the tape ticks own direction).
- **Grep anchors:** pre: `grep -cF '<span class="stat-glyph">*</span>' site/index.html` = 1 → post 0; post `grep -cF 'stat-glyph">Σ' site/index.html` = 1. Mono stack carries both glyphs (no font risk); color/size unchanged (`--accent-text`, 3:1+ n/a — decorative, aria-hidden container).
- **Effort S · Impact 2** · **USER GATE** (the reference set was named in the shipped comment; swapping two members is a taste call, not a defect).

---

## 2. Dedup / out-of-lens notes (verified against the sibling maps)

- **a11y map finding 7** (status glyph 2.54:1) — deferred by WS-A11Y-QUICK; **absorbed as G1**, credit to that map.
- **Motion map** — owns press states, entrance, stamp stagger (live wave wf_c24b7038-da9 at authoring time); no arrow-nudge or glyph-motion proposed here; the motion map's census negatives (`:active`, focus-motion) are respected.
- **Copy map (WS-COPY-VOICE, landed)** — owns every string change; G3/G8 keep copy byte-stable by design (fill treatment / glyph append after a pinned substring).
- **Design reference §SITE LOGO WIRING + og.png** — the fuller logo system (nav lockup, og.png rebuild, badge variants) stays owned by the wsdegen logo goal; G2 is only the favicon slice, built to not collide (data-URI, no new assets).
- **`1 · Approve` / `2 · Deposit`** frozen copy already demonstrate the single-space separator register — G9 aligns the code to the frozen form, never the reverse.

## 3. Sequencing

One batch, all 10 are S-M and token/text-level. **Land after WS-MOTION-POLISH quiesces** (G4 touches its stamp selectors); everything else touches disjoint rules. Suite gate before/after: `node --test site-tests/*.test.js` → fail-ID-SET delta EMPTY (expected baseline 0 failures; pass count grows only if teeth are promoted). No deploys, no commits, workers never commit; page-weight delta ≤ ~2KB total (G2's data-URI ≈ +450B, G5 ≈ +700B HTML+CSS, rest are one-liners).
