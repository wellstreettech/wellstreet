# UI Improve — MOBILE lens, the ≤640px experience (2026-09-04)

**HEAD:** `2cf5fc9` (branch `main`). **Scope:** `site/index.html`, `site/css/style.css`, `site/js/main.js`, `site/js/docs.js`, `site/img/`. **Binding context:** `docs/inventory/FRONTEND_MAP_2026-09-04.md` + `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (ratified paper/ink/serif/green identity — every proposal below keeps all elements ON the phone; this is mobile-specific composition, never desktop shrinkage).

**Method:** analysis-only (zero site edits). Claims are MEASURED, not speculative: a headless-Chromium probe at 390×844 (mobile viewport, touch, DPR 2) against the worktree pages, plus CSS/markup citation. Numbers below are from that probe (hero-child geometry, tap-target boxes, tab-strip scroll widths, image fetch log). Line numbers are worktree citations at HEAD `2cf5fc9` — the worktree carries uncommitted edits (`site/index.html` compressed-img attrs, `site/js/main.js` skill-mirror); re-grep anchors before implementing.

**Cross-references (no duplication):** `UI_IMPROVE_A11Y_2026-09-04.md` #9 (`.code-copy` height — theirs is the 24px WCAG floor, ours is the 44px mobile floor); `UI_IMPROVE_UX-FLOWS_2026-09-04.md` #7 (Connect-must-come-first — theirs is the flow logic + copy, M5 below is only the mobile CSS-ordering mechanics) and #8 (mobile-wallet hint).

---

## Measured evidence (390×844 probe, the pain in numbers)

| # | Measurement | Value | Citation |
|---|-------------|-------|----------|
| E1 | Sticky header height on phone | **159px** (3 stacked rows: brand, nav anchors, nav-cta pill) | style.css:448 |
| E2 | Anchored-jump landing vs header | `scroll-margin-top: 84px` but header is 159px → **section headings land ~75px UNDER the sticky bar** (visually confirmed: "02 DEPOSIT / REDEEM" and "04 DOCS" clipped in screenshots) | style.css:225-226 |
| E3 | First viewport content | h1 top 195px, CTA pair bottom 555px, lede spills past 844px; **`.hero-ledger` (live data) starts at 929px, `.mint-card` at 1441px — zero live data above the fold** | index.html:104-163 |
| E4 | Tap targets < 44px | `.site-nav a` 29px, `.nav-cta` 38px, `#dep-amount`/`#red-amount` **42px**, `.doc-toc a` ≈20px, agents skill links 20px | style.css:123, 131, 294-297, 380-386; index.html:491,493 |
| E5 | Doc tab strip | `scrollWidth 1192` vs `clientWidth 350` (7 tabs, one row, swipeable — works, but the ACTIVE tab is never scrolled into view on hash deep-links) | style.css:458-459; main.js:1229-1233 |
| E6 | Stat band | 2×2 grid, 163px columns; `.stat-line` value+tick has no overflow guard as figures grow | style.css:878-886, 956-961, 907-909 |
| E7 | Image weight on cellular at load | only `certificate.png` (6.8KB) fetched eagerly; `hand-point.png` display:none → never fetched (confirmed in request log — the lazy+hidden pairing works); `curve-stroke.png` **81KB compressed, renders 320×180 on phone** when scrolled to | style.css:1392-1397; index.html:147,466 |
| E8 | Chain identity on phone | `#chain-badge` renders 2362px deep; the hero's `.hero-chip--chain` is `display:none` ≤640 | style.css:781-784; index.html:182 |
| E9 | Passes (no proposal needed) | CTAs/buttons/doc-tabs/sim-slider all 44px (style.css:306,324,333,356,1180); inputs 16px + `inputmode="decimal"` (no iOS zoom, index.html:331,354); no horizontal overflow at 390; ledger-row/mint-card column stacking is clean (style.css:681-682); flow SVG hidden, nodes 1-col ≤720 (style.css:1138-1141) | |

---

## Ranked proposals (10)

### 1. Anchored jumps land under the 159px sticky header — re-pin scroll-margin on mobile
- **Anchor:** style.css:225-226 (`section.block, .hero { scroll-margin-top: 84px; }` + `#doc-pane [id]`) — measured header 159px (style.css:448).
- **What changes:** a ≤640px override raising both scroll-margins to ≈176px (header 159 + 17 breathing), or `scroll-margin-top: calc(<header-height> + 16px)` if the header is first compressed (P3).
- **Pain removed:** every nav tap ("Docs", "Deposit / Redeem") and every docs TOC deep-link lands with the section heading HALF-BURIED under the sticky bar (E2, visually confirmed) — the user then scrolls blind to find the thing they asked for. The single cheapest high-impact fix on the page.
- **Effort S · Impact 5.**
- **Landing:** NEW block appended at end of file (style.css:1395-1397 block is last; 225 is base) — overrides AFTER base is the repo's cascade scar (the 684-686 comment documents exactly this discipline). Do NOT put it in the 443 block: later equal-specificity rules (e.g. `.hero` at 686) already sit after it.

### 2. Phone-first hero composition — live proof in viewport 1
- **Anchor:** style.css:162-169 — `.hero .wrap` is ALREADY `display:flex; flex-direction:column` (justify/center), so children reorder via `order` with zero display changes. The existing ≤640 block is style.css:443-460.
- **What changes:** inside a ≤640 block, assign `order` on the wrap's children: h1 → the one-line verify pitch (index.html:109) → `.cta-row` → **`.hero-ledger`** → `.mint-card` → `p.lede` → `.hero-facts` → `#chain-badge`. Nothing hidden, nothing rewritten — the long lede and the four trust pills become scroll content instead of fold content. Tune the two margin handoffs (`.hero-ledger` margin style.css:577; `.lede` margin 180) in the same block.
- **Pain removed:** on a phone the first viewport is headline + CTA + a 310px paragraph and ZERO live data (E3 — ledger at 929px vs 844px fold). The site's whole identity is "checkable, live, in your browser" — a phone user must scroll ~1.5 viewports before seeing a single real number. This is the ratified draft's own mobile composition (`welldis1.jpg`, DESIGN_REFERENCE §ratified) rather than desktop-stacked shrinkage.
- **Effort M · Impact 5.**
- **Landing:** the reorder itself can live in the 443-460 block (base `.hero .wrap` at 162 wins nothing later — no conflict); any `.hero-ledger`/`.lede` margin overrides must land in a block AFTER style.css:678-687 (the WS-HERO-V9 media block re-declares `.hero` and 576-610 re-declares the ledger) — i.e. the final ≤640 block. Constraints: the hero-recompose COEXISTENCE PIN (index.html:149-155) reserves hero MERGING for another goal — this proposal reorders only, no markup moves; `scroll-reveal` row cascade (main.js:1289-1291) is order-agnostic; verify no chip overlap at 320px after reflow.

### 3. Compress the sticky header: 3 rows → 2 rows, nav strip at 44px targets
- **Anchor:** style.css:448 (existing ≤640 header reflow — `flex-direction: column`), nav base 122-138.
- **What changes:** at ≤640, make `.site-nav` a single nowrap horizontally-scrollable strip (exact precedent: `.doc-tabs` at style.css:458-459 — `flex-wrap: nowrap; overflow-x: auto; scroll-snap-type`), bump nav-link padding to reach the 44px floor (see P4), and let `.nav-cta` ride the same row (its 38px height raised to 44). Header drops 159px → ~115px (E1) permanently on every screen.
- **Pain removed:** 19% of the phone viewport is chrome, re-stacked as three rows; scrollspy underline (main.js:1240-1263) works but the bar crowds every scroll position. Alternative rejected: hiding nav on scroll (loses the anchors that make a 5,000px-deep page navigable — the deposit section starts at 5,182px on phone).
- **Effort M · Impact 4.**
- **Landing:** inside the EXISTING 443-460 block (base header rules 95-138 all precede it — cascade-safe). If adopted, re-measure P1's scroll-margin against the new header height.

### 4. Tap-target floor sweep ≤640px (WS-TAP-TARGETS-44 continuation)
- **Anchor (all measured sub-44 at 390):** `.site-nav a` 29px (style.css:123, `padding: var(--space-4) var(--space-0)`) · `.nav-cta` 38px (style.css:131 `min-height:38px`) · `#dep-amount`/`#red-amount` **42px** (style.css:294-297 — 10px padding + 16px font + 2×2px border) · `.doc-toc a` ≈20px (style.css:380-386) · agents-section skill links 20px (index.html:491,493) · `.code-copy` ≈24px (style.css:388-392 — cross-ref A11Y #9).
- **What changes:** ≤640: nav links `padding: var(--space-9) var(--space-0)` + the P3 strip; `.nav-cta` min-height 44; widget inputs `min-height: 44px` (KEEP font-size 16px — the no-iOS-zoom threshold documented at style.css:295); `.doc-toc a` and `.code-copy` get ≥12px vertical padding at ≤640; the inline skill links get `display:inline-block; padding: 10px 0` on mobile.
- **Pain removed:** the money inputs are 2px shy of the floor the repo itself ratified ("44 = platform floor", style.css:306); nav links and every docs-pane micro-link are thumb-hostile. The precedent batch proved this is className-level cheap.
- **Effort S · Impact 4.**
- **Landing:** EXISTING 443-460 block for nav/inputs (bases at 123/294 precede it). `.code-copy` (388) and `.doc-toc` (380) bases also precede 443 — but the `.mt-16/.mt-20` utilities (926-927) and everything from the WOW batch (833+) come AFTER the 443 block, so any rule touching a class styled after line 443 (none here) would need the final block. Inputs: add `min-height` only, never re-set font-size below 16.

### 5. Docs tab strip: auto-center the active tab on load and on hash deep-links
- **Anchor:** main.js:1229-1233 (hash path clicks the matched tab), docs.js:356-365 (click handler activates), style.css:458-459 (mobile one-row strip), E5 (scrollWidth 1192 vs 350).
- **What changes:** after tab activation, if `matchMedia('(max-width:640px)')`, call `tab.scrollIntoView({ inline:'center', block:'nearest' })`; add `scroll-padding-inline` on `.doc-tabs` so the centered tab isn't flush against the edge. Two small JS lines + one CSS line; keep the existing snap behavior.
- **Pain removed:** deep links (`#doc-run-it-yourself-…` from TOC/nav) activate a tab that is off-screen right — the phone user sees tab #1 highlighted content-wise but has no cue WHICH strip item is live; the strip looks inert at position 0.
- **Effort S · Impact 3.**
- **Landing:** CSS into the EXISTING 443 block (doc-tabs base 350-359 precedes it); JS in main.js `initDocs`/the docs.js click handler — both are behavior-additive and stub-safe (guard `scrollIntoView` existence as main.js:1226 already does).

### 6. `.doc-toc` becomes the same one-row swipe strip on mobile
- **Anchor:** style.css:380-385 (`.doc-toc` flex-wrap wrap — long docs wrap into a multi-row paragraph of ≈20px links above every document).
- **What changes:** ≤640: `flex-wrap: nowrap; overflow-x: auto; scroll-snap-type: x proximity` + 44px row height — a byte-level mirror of the `.doc-tabs` mobile treatment (style.css:458-459, including its `flex: 0 0 auto; scroll-snap-align: start` child form).
- **Pain removed:** on the long docs (run-it-yourself, methodology) the TOC alone occupies several rows of tiny targets before any content; it reads as broken nav. The strip pattern is already the site's own ratified mobile idiom — this just applies it consistently.
- **Effort S · Impact 3.**
- **Landing:** EXISTING 443-460 block (base 380-387 precedes it). Pairs naturally with P5 (same gesture language).

### 7. Surface the chain chip on the mobile hero (chain identity, currently phone-invisible)
- **Anchor:** style.css:781-784 (`.hero-chip--chain` is `display:none` ≤640; the 641-1279 band shows it); E8 (`#chain-badge` at 2362px).
- **What changes:** ≤640: give `.hero-chip--chain` a top-band slot alongside `--price`/`--share` (style.css:779-780 positions) — e.g. left/center/right trio in the existing 36px top padding band; the chip is the static "RH · 4663" pill (index.html:102), zero JS, zero new surfaces (decorative-duplicate discipline already documented at index.html:85-95).
- **Pain removed:** a phone user deep in the page has no visible chain identity — the chain badge is ~6 viewports down and the hero-ledger state chip ("live · chain 4663", main.js:292) is below the fold. For a page whose entire trust model is "you are reading chain 4663 yourself," that fact should be in the first screenful.
- **Effort S · Impact 2.**
- **Landing:** the chip positions live at 779-803, AFTER the 443 block — so the override MUST go in a block after them (final ≤640 block, not 443). Verify the three chips fit without overlap at 320px (combined ≈230px at 390 — tight but fits; if not, drop `--share` to the 641px+ band instead, it is the redundant label).

### 8. Stat tape cell overflow guard at 320-390px
- **Anchor:** style.css:956-961 (`.stat-line` flex, `min-width: 0` on the line but NOT the value), 878-886 (`.stat-value` clamp floor 18px, no overflow handling), 962-967 (`.stat-tick` beside it), 907-909 (2×2 grid ≤720 → 163px columns at 390, ~140px at 320).
- **What changes:** ≤640: `.stat-value { overflow-wrap: anywhere; min-width: 0; }` (and optionally a `font-size: clamp(16px, 4.6vw, 18px)` mobile floor) so a 7-digit TVL + ▲ tick wraps/shrinks inside the column instead of blowing the cell out.
- **Pain removed:** the tape is the marquee surface; as pool TVL grows (or a user opens at 320px iPhone SE) the value+tick pair can overflow the 2×2 column with no wrap point — the one place the live band can visually break on phone.
- **Effort S · Impact 2.**
- **Landing:** MUST be a block AFTER style.css:907-909/956-977 (the WOW-1 rules come late in the file) — final ≤640 block, never the 443 block (equal-specificity later rules would win — the cascade scar again).

### 9. Sim slider thumb ergonomics
- **Anchor:** style.css:1178-1184 (`#sim-slider` is 44px tall — but the INPUT box is; the native thumb is the actual touchpoint and ships at UA-default size ≈15-20px).
- **What changes:** `::-webkit-slider-thumb` / `::-moz-range-thumb` ≥24px square-ish thumb (accent fill, 2px ink border — matches the token family), visible track; global (desktop benefits equally), no motion added so no reduced-motion pair needed.
- **Pain removed:** the only interactive control in the simulator is a slider whose draggable surface is half the ratified floor; on touch, setting "your deposit size" is a precision gesture it should not be.
- **Effort S · Impact 2.**
- **Landing:** appended block at end of file (base 1178 is late; pseudo-element rules have no ordering conflicts). Static by construction — motion doc's guard pattern not triggered.

### 10. Curve divider: cellular-weight mobile asset via srcset
- **Anchor:** index.html:466 (`<img class="asset-draw" src="img/compressed/curve-stroke.png" width="1280" height="720">`), style.css:1358-1359 (`width: min(640px, 82vw)` → renders **320×180 on phone**), E7 (81KB compressed file).
- **What changes:** derive a ~480w variant of the same stroke (the repo already owns the compressed pipeline, `site/img/compressed/`), wire `srcset="img/compressed/curve-stroke-480.png 480w, img/compressed/curve-stroke.png 1280w" sizes="(max-width: 640px) 82vw, 640px"`. Optional companion: cap `.asset-draw` height at ≤640 (~120px) so the decorative divider stops costing 180px of scroll.
- **Pain removed:** 81KB + 180px of cellular data and screen for a purely decorative divider on the phone — the heaviest decorative asset a mobile visitor downloads. Keeps the identity (the stroke stays; it just gets sized honestly).
- **Effort M · Impact 2.**
- **Landing:** CSS into the final ≤640 block (base 1358-1359 precedes it); the srcset edit is index.html + one new asset. Verify `resource-gate.test.js` still passes (relative host, allowlist-safe) and re-pin the render.test registry only if the img attrs are pinned (they pin width/height attributes, not srcset — check render.test.js current pinned form before editing).

---

## Sequencing note

P1 + P4 are mechanical and independent (land first). P2 and P3 both reflow the hero/header and must be measured TOGETHER (P3 changes the header height P1 pins; P2 changes what the fold contains — probe after both, re-verify chips at 320px). P5/P6/P7/P8/P9 are independent one-liners. P10 is the only asset-producing change — batch it with any other image work.

All proposals respect the ratified identity: paper substrate, serif display, green accent, hard borders, and the honesty/copy-frozen anchors untouched — every element survives the small screen; only composition and touch ergonomics change.
