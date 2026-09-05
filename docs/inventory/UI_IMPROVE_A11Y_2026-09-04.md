# Wellstreet UI Accessibility Map — 2026-09-04

**HEAD:** `2cf5fc9` (branch `main`). **Scope:** `site/index.html`, `site/css/style.css`, `site/js/main.js`, `site/js/docs.js`, `site/js/geo.js`, cross-checked against `site-tests/theme.test.js`. **Method:** analysis-only (zero site edits); every contrast claim below was independently computed (WCAG 2.x relative-luminance formula, same math as `theme.test.js:149-159`) — the site's own token comments were verified, not trusted. Line numbers are worktree citations at HEAD `2cf5fc9` (worktree carries uncommitted edits; re-grep anchors before implementing).

**Brand angle:** the site's tagline is "checkable, not sellable." Checkable must include checkable by a screen reader and by a keyboard-only user — a page whose live numbers, focus rings, and tab panels are invisible to assistive tech is selling legibility to one audience only. The finding set below is small because the foundation is genuinely good; the fixes concentrate on focus visibility, live-region announcements, and the docs tab pattern.

---

## Summary — ranked findings

| # | Finding | Anchor | Effort | Impact |
|---|---------|--------|--------|--------|
| 1 | Focus indicator fails non-text contrast (2.54:1 accent ring on every interactive element) | style.css:86-87 | S | 5 |
| 2 | Live-data surfaces have no announcements (ledger rebuild, coverage cells, docs load) | index.html:130, main.js:810-823 | M | 4 |
| 3 | No skip link | index.html:47-62 | S | 3 |
| 4 | Docs tabs: incomplete APG wiring + `h1`-under-`h2` heading skip | docs.js:344-370, docs.js:117-130 | M | 3 |
| 5 | Non-text contrast: form-field boundaries (1.56:1) + dilution bar fill (2.54:1) | style.css:294-297, style.css:1220-1229 | M | 3 |
| 6 | Wallet picker appears with no focus move and no announcement | main.js:1094-1111 | S | 3 |
| 7 | Status glyph `●` rendered as text at 2.54:1 | style.css:267 | S | 2 |
| 8 | Sim slider value semantics: raw "5000" announced, static `role="img"` label never reflects state | index.html:386-395, main.js:744-760 | S | 2 |
| 9 | `.code-copy` target height ≈23px — under the 24px WCAG 2.2 AA floor | docs.js:296-316, style.css:388-394 | S | 1 |
| 10 | Geo-block page (if ever wired): applying it destroys landmarks and does not move focus | geo.js:101-136, index.html:538-562 | S | 1 |

---

## Part A — Verified passes (the lens questions that come back clean)

### A1. Contrast audit — the token system is AA-clean where it claims to be

All 31 fg/bg pairs computed (4.5:1 = AA body, 3:1 = AA large / WCAG 1.4.11 non-text):

| Pair | Ratio | Where | Verdict |
|------|-------|-------|---------|
| ink `#1C1A15` / paper `#EDE9DC` | **14.31** | body text | pass |
| ink-soft `#5C584C` / paper | **5.85** | muted text, `.quiet` headline, lede, labels | pass |
| ink-soft / paper-raised `#F3EFE3` | **6.18** | doc-toc, muted on cards | pass |
| ink-soft / paper-2 `#E4DFD1` | **5.34** | idle doc tabs, code-copy, apr-footnote, field labels | pass |
| ink-soft / code-bg `#E0D9C9` | **5.05** | `.inv-disclosure` | pass |
| accent-text `#0d6b4f` / paper | **5.35** | links, section indices, stat-marker | pass |
| accent-text / paper-raised | **5.65** | `.flag-ok` text, ledger-strong values | pass |
| accent-text / paper-2 | **4.88** | accent text on the footnote band | pass |
| punch `#006B45` / paper | **5.42** | h1 punch word, `#vaults .index`, delta-up tick | pass |
| warn `#a33a24` / paper | **5.42** | pending-tag text, delta-down tick | pass |
| warn / paper-2 | **4.95** | warn rows on cards | pass |
| warn / warn-bg `#EFD9D1` | **4.87** | `.pending-tag` | pass |
| accent-ink `#1C1A15` / accent `#00A86B` | **5.64** | primary button text (CSS comment claims 5.6 — confirmed) | pass |
| accent-ink / accent-hover `#0FB879` | **6.75** | primary button hover | pass |
| paper / ink | **14.31** | cta-solid, nav-cta, active doc tab, ink callout | pass |
| paper / warn | **5.42** | warn chip | pass |
| white / warn (geo head, frozen literal) | **6.59** | `.geo-block-head` | pass |
| ink / chip-tan `#D9CFB4` | **11.20** | tan chip (comment claims ≈11.2 — confirmed) | pass |
| footer-muted `#4E4939` / `#E2DCCB` | **6.56** | footer header cells (comment claims 6.6 — confirmed) | pass |
| footer-faint `#615C4C` / `#E2DCCB` | **4.88** | footer fine print (comment claims 4.9 — confirmed) | pass |
| accent-visited `#3A6B58` / paper | **5.05** | visited links | pass |
| **accent `#00A86B` / paper** | **2.54** | focus ring, `.flag-ok` glyph, sim-bar fill | **FAIL — findings 1, 5, 7** |
| **accent / paper-raised** | **2.68** | focus ring on cards/inputs/tabs | **FAIL — finding 1** |
| **line `#C8C1AD` / paper-raised** | **1.56** | input/code borders | **FAIL — finding 5** |
| **line / paper** | **1.48** | hairline borders | decorative use OK; see finding 5 |
| input bg paper vs panel paper-raised | **1.06** | the field boundary is carried by the border alone | see finding 5 |

The six-pair AA battery in `site-tests/theme.test.js:143-182` passes and its asserted values match my recomputation; the failure surface is entirely **accent-as-graphic / line-as-boundary**, not the text palette.

**The muted two-tone headline verdict:** `h1 .quiet` at `--ink-soft` on paper (style.css:179) computes **5.85:1** — it deliberately "recedes" relative to the 14.31:1 ink line but still clears the 4.5:1 body-text threshold, let alone the 3:1 large-text threshold that applies at `clamp(2.5rem, 7.8vw, 6.25rem)` (style.css:170-177). Same for `#invariants .quiet` and `#agents .quiet` (style.css:649, 1319) at h2 display sizes. **The two-tone treatment passes AA at every size it ships at. No flag.**

### A2. CTA pair semantics — honest

`.cta-solid`/`.cta-outline` are `<a>` elements with real in-page fragment hrefs (`#deposit`, `#docs`, index.html:110-113; `.nav-cta` → `#docs`, index.html:57). Navigation semantics = link semantics; a screen reader announcing "link, Deposit" is telling the truth. The button *look* (mono uppercase, 44px min-height, style.css:320-337) is styling, not a semantics lie. Verdict: **no change needed.** The only honest-improvement option (not required): nothing.

### A3. Reduced-motion completeness — verified complete

- Global guard nullifies all animation/transition (style.css:464-469).
- Scoped pairs restate it per shipped block: WS-HERO-V9 (693-698), V10 chips incl. `translate`/`scale` (816-823), the WOW batch incl. static stamp/tick/rails (1287-1305), asset wire incl. clip-path (1386-1390), plus `no-preference` gating for asset motion (1364-1380).
- JS gates: count-up reveal consults `matchMedia` and writes finals synchronously (main.js:429-438, 448); tape ticks only fire inside that same guard (main.js:454); magnify sweep gated by `motionAllowed()` with a fail-closed default (main.js:575-583, 626-633).
- Reveal/hidden states are armed only by JS (main.js:1273-1305, 1314-1330) — no-JS never sees hidden content.
**No gap found.** (Shared-guard editing discipline noted in the CSS comments is what keeps this true — preserve it.)

### A4. Structure, landmarks, and decorative imagery — verified clean

- Landmarks: `header` (index.html:47), `nav aria-label="Sections"` (53), `main` (62), `footer` (501); two labeled `aside` complementary regions (125, 156); `figure` + `figcaption` on the flow diagram (245, 271).
- One static `h1` (105); `h2` per section; `h3` for cards/panels (main.js:186; index.html:325, 348, 430). (Exception in dynamic docs content → finding 4.)
- Labels associated: `for` on both amount inputs and the sim slider (index.html:330, 353, 386).
- Every decorative image (hands, curve, motif SVG) carries `alt=""` + `aria-hidden` (index.html:72, 147, 341, 449, 466; main.js:200-206) — no noise leaked to AT.
- Existing live regions that already work: `#hero-ledger-state` (128), `#chain-badge` (182), `#wallet-balances` (368), `#widget-status` (369) — money-flow outcomes (confirmations, reverts, explorer link) are announced.
- Delta direction is not color-only: ▲/▼ glyphs accompany the flashes (style.css:1000-1011; main.js:592-608), and the tape band/chips are `aria-hidden` duplicate surfaces (index.html:96, 204) whose figures are exposed elsewhere (hero ledger rows, card rows, hero facts) — the duplication contract holds, with one denominational nuance: the band's USD TVL appears in the ledger only as a muted `≈ $` suffix (main.js:313-315). Acceptable; worth remembering if the aria-hidden band is ever promoted.

---

## Part B — Findings

### 1. Focus indicator fails non-text contrast on every interactive element — impact 5, effort S
**Anchor:** `site/css/style.css:86-87` (`a:focus-visible, button:focus-visible, input:focus-visible, [tabindex]:focus-visible { outline-color: var(--accent); }`).
**Violation:** the single focus ring color is `--accent #00A86B` = **2.54:1 on paper, 2.68:1 on paper-raised** (cards, inputs, doc tabs all sit on paper-raised/paper-2 surfaces). WCAG 1.4.11 requires 3:1 for focus indicators; this is the page-wide keyboard-visibility failure — every link, button, input, tab, and the focusable `#doc-pane` share it. (The CSS already does the right *structure* — 2px + 2px offset + `:focus-visible` only; only the token is wrong.)
**Fix:** point the outline at `--accent-punch #006B45` (5.42:1 paper / 5.73:1 paper-raised) or `--ink` (14.31:1). One-line token change; re-pin `theme.test.js` if the palette assertion set grows (it currently does not assert the outline color).

### 2. Live-data surfaces announce nothing — impact 4, effort M
**Anchors:** `site/index.html:130` (`#hero-ledger-rows` — no live region); `site/js/main.js:286-364` (`renderLedger` rebuilds all rows every 60s via the refresh loop, main.js:98-121); `site/js/main.js:810-823` (`fillBackingCoverage` fills `#mint-backed` index.html:161 and `#inv-stat` index.html:431 asynchronously); `site/js/docs.js:318-342` (`loadDoc` swaps the pane contents; `aria-busy` toggles but nothing is announced).
**Violation:** a screen-reader user who lands on the "live ledger" hears the static "connecting to public RPC…" skeleton forever — the values that *are* the product (slot0 price, TVL, protocol cut, coverage %) mutate silently 60s-cycle after cycle. The whole "live on-chain reads" honesty claim is visually-only.
**Fix (chatty-safe):** (a) one visually-hidden `aria-live="polite"` status node updated once per completed refresh cycle with a *summary*, not the values ("Ledger refreshed — slot0, balances and cut verified"), so a full rebuild never dumps the entire ledger into the queue; (b) `aria-live="polite"` on the two coverage cells (they change at most once per cycle and are single-value); (c) after `loadDoc` resolves, announce the doc title via the same hidden status ("Loaded: Risk disclosure"). Do **not** put `aria-live` on `#hero-ledger-rows` itself or on `#vaults-updated` (main.js:90-96 rewrites it every 5s — it would babble).

### 3. No skip link — impact 3, effort S
**Anchor:** `site/index.html:47-62` — the sticky header (brand + 4 nav anchors) precedes `main` with no bypass.
**Violation:** keyboard users re-tab 5 links to reach content on every page load and after every section jump; WCAG 2.4.1 (Bypass Blocks).
**Fix:** first focusable element in `<body>`: a visually-hidden-until-focused "Skip to content" anchor → `#vaults` (first content section). `section.block` already carries `scroll-margin-top: 84px` (style.css:225) so the landing position is correct. No visual redesign — an unstyled-focus link in the brand voice.

### 4. Docs tabs: incomplete ARIA APG wiring + `h1`-under-`h2` heading skip — impact 3, effort M
**Anchors:** `site/js/docs.js:344-370` (`role="tablist"`/`role="tab"`, `aria-selected` — good; but no `aria-label` on the tablist, no `aria-controls`, no arrow-key roving tabindex); `site/index.html:455-456` (`#doc-pane` has `role="tabpanel" tabindex="0"` but no `id` referenced by tabs and no `aria-labelledby`); `site/js/docs.js:117-130` (the markdown renderer emits literal heading levels — every doc's `# Title` becomes an `h1` nested under the section's `h2` "Docs" at index.html:442); `site/js/docs.js:230-239` (TOC indexes only h2+h3, so the doc's own title is unreachable from its TOC); `site/js/docs.js:167-168` (rendered `<th>` without `scope="col"`).
**Violation:** (a) the tab widget exposes roles without the wiring that makes them mean anything to AT — a tab panel that no tab controls and no arrow-key pattern (buttons-all-tabbable works but is not the APG contract the roles claim); (b) heading navigation (the primary SR document-skimming mechanism) hits `h2 → h1` and per-doc `h1` fragments pollute the page-level heading map.
**Fix:** emit the doc title at `h2` and demote rendered `#/##/###` by one level (renderer-local: `Math.min(level + 1, 6)` with `#doc-pane h2/h3/h4` style re-point — style.css:367-369 already sizes these rungs); add `id="doc-pane"` + `aria-controls="doc-pane"` + `aria-labelledby` (active tab) + `aria-label="Documentation"`; add left/right arrow roving tabindex per APG. Keep `role="tabpanel"` + `tabindex="0"`.

### 5. Non-text contrast: form-field boundaries and the dilution bar — impact 3, effort M
**Anchors:** `site/css/style.css:294-297` (`.field input` border `2px solid var(--line)`); `style.css:88-89` (code/pre borders, same token); `style.css:1220-1229` + `site/index.html:395` (`.sim-bar-fill` background `--accent`).
**Violation:** the deposit/redeem inputs are identifiable by border alone (input bg `#EDE9DC` vs panel bg `#F3EFE3` = **1.06:1**; border `--line` = **1.56:1**) — under the 3:1 WCAG 1.4.11 component-boundary requirement, and this is the money-input form. The dilution bar fill (`--accent` on paper = **2.54:1**) encodes the headline sim quantity; its value is duplicated as text in `#sim-share` (index.html:396) so it is partially redundant, but the bar is the visual anchor of the region.
**Fix:** input/pre borders → `--ink-soft #5C584C` (**6.18:1** on paper-raised; also reads as "interactive," which the hairline `--line` does not) or, minimal-diff variant, only the two money inputs. Sim-bar fill → `--accent-punch` (**5.42:1**). Do NOT re-token all `--line` borders wholesale — the ledger-grid aesthetic relies on hairlines for *decorative* separation, which WCAG does not govern; scope the change to boundaries that identify interactive components.

### 6. Wallet picker appears without focus move or announcement — impact 3, effort S
**Anchor:** `site/js/main.js:1094-1111` (`showWalletPicker` un-hides `#wallet-picker` (index.html:367) and appends buttons; focus stays on "Connect wallet"); contrast note: the picker label is `--ink-soft` on paper = 5.85:1 (pass).
**Violation:** with >1 wallet installed, clicking Connect produces an invisible-to-AT state change — the SR user hears nothing and the next Tab lands on the *page content after the picker*, not the wallet choices. Keyboard reachability is fine; discovery is not.
**Fix:** after rendering buttons, move focus to the first wallet button (with a `focus()` guarded by `typeof n.focus === 'function'` per the file's stub discipline) and give `#wallet-picker` `aria-live="polite"` so "Multiple wallets detected — choose one:" is announced. On `connectUsing`, focus can return to `#btn-connect` (already re-labeled "Connected: 0x…", main.js:1014).

### 7. Status glyph `●` rendered as 2.54:1 text — impact 2, effort S
**Anchor:** `site/css/style.css:267` (`.flag-ok .flag-glyph { color: var(--accent); }`) + `site/js/main.js:136` (the glyph is a text node, 14px).
**Violation:** the deployed-status dot computes **2.54:1 on paper / 2.68:1 on paper-raised** — below even the 3:1 large-text floor. The adjacent text ("deployed · 0x…", main.js:260) carries the same information, so this is WCAG-exempt as redundant decoration — but a *status glyph* that nearly vanishes is exactly the kind of quiet dishonesty the brand argues against, and `.flag-ok`'s own text rides `--accent-text` at 5.65:1 one rule away (style.css:263).
**Fix:** `color: var(--accent-text)` — one declaration, glyph and label agree, the fill-role `--accent` stays reserved for surfaces (its own documented rule, style.css:21).

### 8. Sim slider announces raw units; the bar's `role="img"` label is frozen — impact 2, effort S
**Anchors:** `site/index.html:386-395`; `site/js/main.js:744-760` (`renderSim`).
**Violation:** the slider's accessible value is the raw integer ("5000"), while the visible output is "$5,000 · 0.42% of pool TVL". The `role="img"` label on `.sim-bar` is a *static* string ("Your illustrative deposit as a share of the live pool TVL") that never reflects the value the bar visually encodes — a graphic whose accessible name contradicts its state.
**Fix:** in `renderSim`, set `slider.setAttribute('aria-valuetext', '$5,000 · 0.42% of pool TVL')` (or the honest-unavailable string when `share === null`); either update the bar's `aria-label` with the same string per render or drop `role="img"` from the bar entirely and let the adjacent `#sim-share` text carry the value (simpler, and the bar becomes purely decorative).

### 9. `.code-copy` target height ≈23px — impact 1, effort S
**Anchors:** `site/js/docs.js:296-316`; `site/css/style.css:388-394` (11px mono, `padding: var(--space-2) var(--space-8)`, 1px border → total height ≈ 23px).
**Violation:** below the WCAG 2.2 AA 2.5.8 minimum target size of 24×24 (the page elsewhere is disciplined about this — `button.btn`, `.doc-tab`, `.cta-*`, `#sim-slider` all carry 44px min-heights with explicit comments).
**Fix:** `min-height: 24px` (or `var(--space-6)` vertical padding) on `.code-copy`. One declaration.

### 10. Geo-block page (if ever wired): landmark loss and no focus move — impact 1, effort S
**Anchors:** `site/js/geo.js:101-136` (`applyGate` blocked branch: `document.body.textContent = ''` then appends the template); `site/index.html:538-562` (template has `h1`, disclosure, no landmark wrapper).
**Violation:** the applied block page has no `main`/`nav` landmarks (header and skip link are wiped), focus stays wherever it was, and SR users get no "page replaced" cue. Ratios pass (white/warn 6.59:1; ink-soft/#fbfaf5 6.80:1). Dormant by decision D14 (byte-frozen) — recorded so that IF the gate is ever wired, these ship with it; **do not edit the frozen template outside a gate-wiring change.**
**Fix (gate-wiring time):** wrap the card in `<main>`, call `.focus()` on the card (add `tabindex="-1"`), and reuse finding 1's corrected focus token.

---

## Part C — Sequencing note

Findings 1, 3, 7 are one-line token/markup changes with no layout impact — a natural single batch. Finding 2 is the highest-value *new surface* (an sr-only status writer) and should land with its own `site-tests` assertion (the suite already pattern-matches frozen strings; a "live-region present" grep tooth in `render.test.js` fits the house style). Findings 4/5 touch the docs renderer and form borders — both have frozen-anchor/test re-pin obligations (`wow.test.js` pins renderer output shape; `theme.test.js` pins palette values) and belong in a goal with verifyCmds, not a drive-by.
