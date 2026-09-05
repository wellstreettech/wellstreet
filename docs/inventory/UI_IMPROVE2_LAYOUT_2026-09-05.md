# UI Improve round 2 — LAYOUT & COMPOSITION lens (2026-09-05)

**HEAD:** `28208df` (branch `main`, per task brief). **Scope:** `site/css/style.css`, `site/index.html` (CSS-first; HTML only where stated). **Binding context:** `docs/inventory/FRONTEND_MAP_2026-09-04.md` + `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (ratified paper/ink/serif/green identity + the user-ratified nano-banana drafts — the desktop draft `welldis.jpg` is the composition target).

**Method:** analysis-only, ZERO site edits. Produced from a full read of `site/css/style.css` (1,511 lines, current merged worktree — the motion/a11y/copy wave hunks are already in: `.ws-entrance` :1335, `.skip-link`/`.visually-hidden` :93-114, the `--accent-punch` focus ring :87), `site/index.html` (591 lines), the vault-card/ledger regions of `site/js/main.js`, and a visual read of `site/img/canyon-hero.png` (2560×1440) + the ratified draft `welldis.jpg`. **Bash was denied in this session** — no probe ran; all geometry numbers below are computed from image dimensions, token values and the rendered box model, and are marked computed. Every anchor is worktree-read 2026-09-05; siblings are live on these files — re-grep every anchor at dispatch (DISPATCH-TIME STATE UPDATE).

**Cross-references (no duplication):** mobile ≤640 fold/header/tap targets → `UI_IMPROVE_MOBILE_2026-09-04.md` (P1-P3 landed as the EOF block, style.css:1488-1510); all motion → `UI_IMPROVE_MOTION_2026-09-04.md` (every proposal below ships ZERO animation — no reduce pair needed); frozen copy → `UI_IMPROVE_COPY_2026-09-04.md`; flow logic → `UI_IMPROVE_UX-FLOWS_2026-09-04.md` (proposal L7 coordinates with its #7); focus/AT → `UI_IMPROVE_A11Y_2026-09-04.md`.

---

## Observed evidence (the lens in numbers)

| # | Observation | Value | Citation |
|---|-------------|-------|----------|
| L-E1 | Canyon open-center geometry | Buildings occupy ≈0-38% and ≈62-100% of frame width; the bright sky is ≈38-62% (≈24% wide at top, widening to ≈40% at bottom) — computed from the 2560×1440 asset | `site/img/canyon-hero.png`, `.hero-canyon` style.css:194-203 |
| L-E2 | Hero text vs the canyon | `.wrap` left edge at 1440vp = 14.6% of viewport ((1440−1020)/2); the h1 spans ≈15-70% → the first ~23% of every headline line sits ON the left building's dither; `.cta-outline` renders `background: transparent` (style.css:375) directly on texture; the h1 is weight-400 serif (thin strokes, style.css:215). The open center (L-E1) is too narrow to host the headline at any draft-scale type size | style.css:119, 204-219, 375; index.html:113-121 |
| L-E3 | Hero card stack | `.hero-ledger` (max-width 46rem, margin 32/0/40) + `.mint-card` (max-width 46rem, margin 24/0/32) stack back-to-back ≈730px of near-identical bordered tables — the dominant mass of the hero; the ratified draft places the TICKET BESIDE the headline, not under it | style.css:625-630, 671-676; index.html:133-172; `welldis.jpg` |
| L-E4 | Single vault card is full-wrap | `#vault-grid` = `repeat(auto-fit, minmax(320px, 1fr))` — with one entry the card stretches to the full 980px wrap; ~10 label/value rows stretch to ≈400-500px of dotted void per row | style.css:283; index.html:308 |
| L-E5 | Width inventory (no system) | wrap 1020px (:119/:578) · stat-grid 920px (:913) · `.block-sub` 52rem (:280) · `.hero-ledger`/`.mint-card`/`.inv-card` 46rem (:626/:672/:710) · `#doc-pane` 72ch (:407) · `#vault-grid`/`.widget-grid`/`.apr-sim`/`.apr-footnote` uncapped | style.css throughout |
| L-E6 | Hatch rhythm is incomplete | `border-image` hatch fires on 6 of 8 inter-section boundaries; the two missing are exactly the prologue: stat-band→flow-figure and flow-figure→#vaults are plain 2px lines (:902, :1107) — the page's rhythm stutters where spectacle hands off to product | style.css:186, 263, 901-904, 1105-1111 |
| L-E7 | Draft type scale | `welldis.jpg` headline ≈130-150px on a 1280 frame (≈10-11vw); current clamp caps at 100px (`clamp(2.5rem, 7.8vw, 6.25rem)`, style.css:214) — the draft's dominant element is ~30% larger | style.css:212-219 |
| L-E8 | Connect row placement | "Connect wallet" (`#btn-connect`, the money path's step 0) renders BELOW both widget panels (index.html:380-382) — on desktop it sits detached under the Redeem panel, visually orphaned from the Deposit panel it serves | index.html:331-385 |
| L-E9 | Passes (no proposal) | Section verticals are a deliberate system (hero 56/48+80vh :204-211; prologue bands 28/32 :905-908, 28/28 :1112-1116; blocks 64/48 :269; footer 40/48 :462) — uniform block padding is correct, not a defect; `.hero-facts` overlap pills, `.footer-grid` ledger table and `.curve-divider` already carry the draft's edge grammar | style.css as cited |

---

## Ranked proposals (9)

### L1. The draft's asymmetric hero — mint ticket beside the headline, live ledger full-measure below (≥1024)
- **Anchor:** `.hero .wrap {` style.css:204-211 (flex column) and the z-index re-declare :609-611; the 8 direct children h1/p/`.cta-row`/`p.lede`/`.hero-ledger`/`.mint-card`/`.hero-facts`/`#chain-badge` (index.html:112-192 — same 8 the mobile EOF block orders at ≤640 and WS-MOTION-POLISH arms).
- **What changes:** ONE new `min-width` block appended at EOF (zero edits to existing lines; the ≤640 `order` contract at :1488-1510 is a different media condition — cascade-safe):

```css
/* UI2-L1 (>=1024): the ratified draft's asymmetric hero (welldis.jpg) —
   headline + pitch + CTA in the left column, the mint ticket beside them,
   the live ledger spanning full measure below. Same 8 .wrap children — the
   <=640 order block (:1488) and the ws-entrance arming are untouched
   (min-width-scoped, class/HTML unchanged). */
@media (min-width: 1024px) {
  .hero .wrap {
    display: grid;
    grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
    grid-template-areas:
      "h1     mint"
      "pitch  mint"
      "cta    mint"
      "lede   lede"
      "ledger ledger"
      "facts  facts"
      "badge  badge";
    column-gap: var(--space-40);
    align-content: center;   /* replaces the flex justify-content:center beat */
  }
  .hero .wrap > h1 { grid-area: h1; }
  .hero .wrap > p:not(.lede) { grid-area: pitch; }
  .hero .wrap > .cta-row { grid-area: cta; align-self: start; }
  .hero .wrap > .mint-card { grid-area: mint; margin: 0; align-self: start; margin-top: var(--space-56); } /* probe-tune: draft seats the ticket at headline line 2 */
  .hero .wrap > p.lede { grid-area: lede; }
  .hero .wrap > .hero-ledger { grid-area: ledger; margin: var(--space-24) 0 var(--space-32); }
  .hero .wrap > .hero-facts { grid-area: facts; }
  .hero .wrap > #chain-badge { grid-area: badge; }
}
```
- **Pain removed:** E3 — the hero stops being a 730px double-card stack; the ticket (the draft's signature surface, with the live BACKED cell) enters the first viewport beside the type at ≥1024 — the desktop mirror of the ratified mobile P2 fold win. Kills ≈450px of scroll before the facts.
- **Effort M · Impact 5.**
- **Landing:** EOF append; base `position: relative; z-index: 1` (:611) and `min-height: 80vh` (:207) persist (not restated, cascade keeps them); launch-flip (`body.launch-flip .hero-ledger`) and `.ws-entrance` are animation-only — grid placement coexists. **Do NOT wrap the two asides in a container div** — that breaks the 8-children contracts (mobile order block, WS-MOTION-POLISH arming, render.test.js markup pins).
- **Design-law check:** tokens only; no new colors; no motion; no markup/new ids (registry untouched); no copy; DO-NOT-INSERT zone respected (EOF); ≥1280 chip-gutter geometry (:842-852) untouched — chips live in section.hero, not .wrap.

### L2. Canyon legibility: dim the backdrop to substrate (the open center cannot host the headline — computed)
- **Anchor:** `.hero-canyon {` style.css:194-203; the sibling's reduce restate `.hero-canyon { animation: none !important; }` :517 and the vibrate gate :1447 (this layer is a live sibling's UNCOMMITTED feature — hunk-classified landing, never revert).
- **What changes:** one additive declaration + one mobile dim in a new EOF ≤640 block:

```css
/* UI2-L2: the dithered canyon reads as paper texture, not photography —
   the sky is ~24-40% of the frame (computed) and cannot host a 100px+ serif
   headline, so full-opacity buildings sit under the left third of every
   headline line (L-E2). 0.30 keeps the framing gesture and recovers
   ink-on-paper legibility everywhere (darkest dither pixel blends to
   ~#B7AE9C ≈ 8:1 vs --ink at 0.30 — computed). */
.hero-canyon { opacity: 0.30; }   /* probe 0.25-0.35 at 1440×900 and 390×844 */
```
```css
@media (max-width: 640px) {
  .hero-canyon { opacity: 0.22; }  /* phone: buildings dominate the crop; the ratified mobile fold is paper-first */
}
```
- **Pain removed:** E2 — the page's core promise is "checkable"; a weight-400 serif headline, the verify pitch and the transparent `.cta-outline` (style.css:375) currently render over dithered building noise. The ascetic-degen answer is the reference's own: texture from technique, not decoration — the canyon becomes substrate and the framing survives.
- **Effort S · Impact 5.**
- **Landing:** base rule lands adjacent to the sibling's `.hero-canyon` block or at EOF (later wins, equal specificity); the ≤640 dim goes in a NEW EOF max-width block AFTER the WS-MOBILE-FIXES block (:1488-1510 — the final-≤640-block cascade rule). Coordinate with the canyon sibling (their hunks are uncommitted on these exact lines).
- **Considered and rejected:** centering the stack in the sky (geometrically impossible at display scale — sky ≈24-40% vs headline ≈60%+ of frame width); text plates/boxes behind each block (fights the ascetic grammar, boxy); a radial/linear mask to carve a sky window (violates the zero-gradient law — the hatch border-image is the only sanctioned gradient use); hiding the canyon outright (discards the operator's ratified layer; dim preserves it).
- **Design-law check:** opacity is a value, not a color literal (theme.test.js sweeps colors — safe); no motion touched (the sibling's reduce/no-preference pairs stay byte-identical); tokens otherwise untouched.

### L3. One ledger width: cap the vault card, APR footnote and invariant list to the 46rem ledger measure
- **Anchor:** `#vault-grid` style.css:283; `.apr-footnote` :313-316; `.inv-dl` :699. The 46rem measure already governs `.hero-ledger` :626, `.mint-card` :672, `.inv-card` :710.
- **What changes:** three one-line appended rules (cascade over the early bases):

```css
/* UI2-L3: the ledger-surface measure — a single family card is a 736px
   ledger table, not a 980px full-wrap stretch (E4); footnote and invariant
   list join the same measure so each section reads as one aligned unit. */
#vault-grid { max-width: 46rem; }
.apr-footnote { max-width: 46rem; }
.inv-dl { max-width: 46rem; }
```
- **Pain removed:** E4 — section 01 is the product surface; a full-wrap card renders ≈400-500px of dotted void per row and visually contradicts every other ledger surface on the page. At 46rem the card, its footnote, and the invariant dl+card stack share one hard left/right edge (the Stratton-grammar compact table).
- **Effort S · Impact 4.**
- **Landing:** EOF append. Family-grid math (computed): at the 736px grid box, `minmax(320px,1fr)` auto-fit yields 2×358px cards when vault #2 lands, 3rd card wraps — the WS-VAULT-FAMILY-GRID template is unaffected; revisit the cap when the family grows past 2 (owning session).
- **Design-law check:** reuses the existing 46rem literal (tokenized in L9); no colors/motion/markup; `.card-note`'s `margin: auto 0 0` bottom-pin (:302) unaffected; certificate keeper (:1414-1422) unaffected.

### L4. Draft display scale at ≥1280 (media-scoped to protect the mobile fold contract)
- **Anchor:** `.hero h1` style.css:212-219 (`clamp(2.5rem, 7.8vw, 6.25rem)`); mobile fold gate P2 (`.hero-ledger top ≤ 844` at 390×844) was measured against the current floor — a global bump risks it.
- **What changes:**

```css
/* UI2-L4: the draft's dominant move — type IS the composition
   (welldis.jpg measures ~10-11vw). Desktop-only: the <=640 clamp floor
   stays byte-identical so the ratified mobile fold gates keep holding. */
@media (min-width: 1280px) {
  .hero h1 { font-size: clamp(6.25rem, 9vw, 8.25rem); }  /* 115px @1280, 129.6px @1440 */
}
```
- **Pain removed:** E7 — at 100px the headline under-runs the draft by ~30%; the two-tone serif is the page's identity and the canyon composition's anchor. With L1's grid, the taller left column is exactly what the ticket sits beside.
- **Effort S · Impact 4.**
- **Landing:** EOF min-width block. Hero grows ≈+90px (3 wrapped lines at 1020 column — computed); the hero already scrolls, `min-height: 80vh` unaffected. **Pre-flight sweep:** grep site-tests for `7.8vw` / `6.25rem` before landing (no pin found this session, but siblings pin aggressively — a dated re-pin comment is the authorized form).
- **Design-law check:** type role unchanged (display clamp, not a --step text role — the R3 scale's "2 display clamps" allowance, :575-576); no copy; `text-wrap: balance` (:71) still governs the wrap; chips sit in gutters outside `.wrap` — no new collision surface (positions :846-851).

### L5. Hatch continuity: the two missing boundaries (stat-band→flow, flow→vaults)
- **Anchor:** `.stat-band { border-bottom: 2px solid var(--line…` style.css:901-904; `.flow-figure { … border-bottom: 2px solid …` :1105-1111; house form `.hero` :186 / `section.block` :263.
- **What changes:** two appended one-line rules restating the house hatch (each boundary its own gradient declaration — the :180-186 law):

```css
/* UI2-L5: boundary rhythm — every major band edge carries the same 8px
   hatch; today the two prologue boundaries are plain 2px lines (E6),
   stuttering exactly where spectacle hands off to product. */
.stat-band { border-bottom: 8px solid transparent; border-image: repeating-linear-gradient(45deg, var(--line) 0 4px, transparent 4px 8px) 8; }
.flow-figure { border-bottom: 8px solid transparent; border-image: repeating-linear-gradient(45deg, var(--line) 0 4px, transparent 4px 8px) 8; }
```
- **Pain removed:** E6 — 6 of 8 boundaries hatch; the two plain ones sit directly under the 80vh hero where the rhythm matters most. The hatch is the reference's own separator technique (Constellation item 6) and already the site's ratified idiom.
- **Effort S · Impact 3.**
- **Landing:** EOF append. Note: the appended text must NOT contain the substring `border-bottom: 2px solid var(--line)` (theme.test.js exact-count pin — the rules above don't).
- **Design-law check:** reuses the sanctioned border-image gradient verbatim (one declaration per boundary block); no new colors; no motion; stat-band/flow figure inner contracts (WOW-1/WOW-2, wow.test.js source-slice gates) are class/markup-scoped — a border change touches no pinned slice.

### L6. Mint-ticket stamp: the MINT TICKET tag straddles the card's top border (draft's LIVE-ONCHAIN overlap grammar)
- **Anchor:** `.mint-card` :671-676 (no padding-top, no position); `.mint-card-tag` :677-687 (in-flow, `margin: 12px 12px 8px 12px`, transparent background).
- **What changes:**

```css
/* UI2-L6: the draft seats a rotated stamp tag OVER the ticket's top edge
   (LIVE ONCHAIN in welldis.jpg). Static transform — no motion, no reduce
   pair required; -2deg echoes the chips' rotation register (:828-851). */
.mint-card { position: relative; padding-top: var(--space-28); }  /* 28px + first row's 10px ≈ the old 38px tag headroom */
.mint-card-tag {
  position: absolute;
  top: -10px;              /* half the tag box — probe-tune ±2px */
  left: var(--space-16);
  margin: 0;
  background: var(--paper); /* opaque: the card's 1px border must not strike through the glyph run */
  transform: rotate(-2deg);
}
```
- **Pain removed:** the current tag is a quiet first row inside the card; the draft's edge-overlap is the page's most distinctive micro-composition and is one rule-pair away. Optional variant: apply the same straddle to `.inv-tag` (style.css:713-722) — not proposed by default (the draft shows it on the ticket only).
- **Effort S · Impact 3.**
- **Landing:** EOF append (ungated — width-agnostic). Copy unchanged ("MINT TICKET" byte-frozen); the mobile order block moves `.mint-card` whole — the tag travels with it.
- **Design-law check:** static transform (the global reduce guard nullifies transitions/animations, not static transforms — safe by construction); tokens only; no new colors; no copy; three-radii law untouched (tag keeps its 1px square border — a data-element surface).

### L7. Promote the connect-wallet row above the widget grid (coordinate with UX-FLOWS #7)
- **Anchor:** `#deposit` children order — `.widget-grid` (index.html:331) renders before `.btn-row.mt-20` with `#btn-connect` (:380-382); `.btn-row` margin base style.css:342.
- **What changes:**

```css
/* UI2-L7: step 0 above the panels — the connect row reads as the widget's
   header action instead of a detached footer under Redeem (E8). CSS order
   only; DOM and ids untouched. Coordinate: UX-FLOWS #7 owns the flow logic. */
@media (min-width: 720px) {
  #deposit .wrap { display: flex; flex-direction: column; }
  #deposit .wrap > .block-head { order: -3; }
  #deposit .wrap > .block-sub { order: -2; }
  #deposit .wrap > .btn-row { order: -1; margin-top: 0; margin-bottom: var(--space-20); }
}
```
- **Pain removed:** E8 — the money path's first action is visually orphaned; above the panels it also gives the disabled deposit inputs an immediate "why" (connect first).
- **Effort M · Impact 2.**
- **Landing:** EOF min-width block. Flex on `#deposit .wrap` stops margin collapsing between its children — verify `.apr-sim`'s `margin-top` (:1201) and `#widget-status` spacing at 720-1024 in the probe; the `.mt-20` utility is overridden by the higher-specificity child selector.
- **Design-law check:** no markup/ids/copy; disabled-button gating logic (main.js `depositsOpen`) untouched — presentation only; UX-FLOWS sign-off required before landing (their lens owns this surface).

### L8. Agents section: two-column editorial split (headline left, machine-surface prose right)
- **Anchor:** `#agents .wrap` has exactly two children — `.block-head` (index.html:498-503) and `.block-sub` (:504-512); agent-first.test.js pins the link hrefs/presence (CSS-only change is safe).
- **What changes:**

```css
/* UI2-L8: the page's emptiest section (a 52rem paragraph in a 64/48 block)
   becomes an asymmetric editorial spread — the two-tone headline owns the
   left column, the skill prose the right. Same two children, zero markup. */
@media (min-width: 900px) {
  #agents .wrap {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 3fr);
    column-gap: var(--space-40);
  }
  #agents .wrap > .block-head { grid-column: 1; grid-row: 1; align-self: start; }
  #agents .wrap > .block-sub { grid-column: 2; grid-row: 1; margin: 0; }
}
```
- **Pain removed:** section 05 currently renders one thin paragraph centered in a full block — the agent-first differentiator deserves composition, and the split is the cheapest asymmetric move in the draft grammar (edge-aligned, not centered-safety).
- **Effort S · Impact 2.**
- **Landing:** EOF min-width block; the `.block-head`'s spacer/muted wrap inside the narrow column (acceptable; probe at 900-1024). Links stay relative (repoUrl PENDING_IDENTITY untouched).
- **Design-law check:** no copy (the two-tone h2 and prose are byte-frozen); no ids; tokens only; agent-first.test.js pins are content/href greps — unaffected by CSS.

### L9. Measure tokens: name the width system the page already implies
- **Anchor:** token `:root` block opening style.css:524 (`--wrap-max` :578); the 46rem sites :626/:672/:710; `.block-sub` 52rem :280.
- **What changes:** two new tokens + re-point of five `max-width` literals (L3's new rules should be written against the token from the start):

```css
  /* UI2-L9: measure roles — the ledger surface (data cards) vs the copy
     measure (prose subs). New text-width decisions pick a role token. */
  --measure-ledger: 46rem;
  --measure-copy: 52rem;
```
then re-point `max-width: 46rem` → `max-width: var(--measure-ledger)` at :626/:672/:710 (+ L3's three sites) and `max-width: 52rem` → `max-width: var(--measure-copy)` at :280.
- **Pain removed:** E5 — five ad-hoc widths; the family-grid future (vault #2, more cards) inherits the system instead of re-guessing.
- **Effort S · Impact 2.**
- **Landing:** token additions are additive; the re-points are EDITS to existing lines — land them in the same hunk-classified batch only after the sibling quiesce window (this is the one proposal that cannot be a pure EOF append).
- **Design-law check:** pure tokenization, zero rendered change; matches the v1.2 token-foundation convention (:520-523 comment).

---

## Considered and rejected (design-law checks that failed)

1. **Full-bleed nav ticker strip under the header** (draft's `ws-SPY → SPY → 4663` boxes): a FOURTH surface for already-published figures — violates the WOW batch's depth-not-duplication law, needs new JS writes, and collides with theme.test.js exact-count pins. The chips + stat band already carry it.
2. **Centering the hero stack in the canyon's sky:** sky ≈24-40% of frame width (L-E1, computed) vs the headline's ≈60%+ — impossible at display scale; would force a 2-3× type cut that breaks the draft's dominant-type grammar.
3. **Gradient/mask scrim behind the hero text:** violates the zero-gradient law (the hatch border-image is the only sanctioned gradient). L2's opacity dim achieves the same legibility recovery without one.
4. **Two-column invariants (dl beside the inv-card):** the dl starves at ~200px ("MINT / REDEEM ARB" alone overruns); the 46rem stack IS the reference's invariant-section grammar (Stratton item 6).
5. **Asymmetric re-flow of the WOW-2 flow nodes:** shipped package under wow.test.js/render.test.js pins; risk ≫ reward.
6. **Full-bleed content column (dropping `--wrap-max: 1020px`):** the wrap is load-bearing for the ≥1280 chip-gutter contract ("gutters >=130px", :843-845), the 68px-header reading measure, and scroll-margin math — breaking it to chase the draft's ~4% margins trades a ratified system for cosmetics.

---

## Sequencing note

L2 is independent and cheapest-per-point — land first (it touches the canyon sibling's layer: hunk-classify, never revert their hunks). L1 + L4 compose (bigger type fills L1's left column) and must be probe-verified together at 1280/1440. L3 + L9 are the same width system — write L3 against literals, tokenize in L9's pass. L5/L6/L8 are independent one-liners. L7 waits for UX-FLOWS sign-off. All proposals are byte-only (no assets) — combined ≈2.5KB against style.css, inside any page-weight gate of the +4KB class; every proposal is static (zero new animation → zero new reduce pairs), zero new ids (render.test.js registry untouched), zero copy changes, zero color literals (theme.test.js safe), and every new block lands at EOF after the WS-MOBILE-FIXES block per the repo's final-block cascade discipline.

All proposals respect the ratified identity: paper substrate, serif display, green accent, hard borders on data surfaces, and the honesty/copy-frozen anchors untouched — composition and proportion change; nothing on the page is hidden, moved between sections, or reworded.
