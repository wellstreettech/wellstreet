# UI Improve Round 2 — HEADER & NAV (2026-09-05)

**Scope:** the sticky header bar only — brand lockup proportions, boxed-wordmark treatment, nav typography/hover states, the RUN IT YOURSELF pill vs the DEPOSIT solid, sticky behavior, and the (unbuilt) ticker-strip integration under the header.
**Method:** full read of `site/index.html` (header markup :48-62) + `site/css/style.css` (header block :121-167, tokens :13-41/:540-586, responsive :484-510 and the appended EOF block :1479-1508) + the scrollspy in `site/js/main.js:1393-1421` + the test pins (`site-tests/agent-first.test.js` m1 block, `site-tests/theme.test.js` (c)/(g)) — then a **headless Chromium measurement probe at 390/640/700/860/1280px** (file:// load, fonts settled, animations nulled). Every claim below carries a line cite or a measured number. **Zero site edits, zero commits.**
**Tree state note:** the task brief said HEAD `28208df`; the worktree is at `048718f1` with `site/css/style.css` in `MM` state (the WS-MOBILE-FIXES EOF block :1479-1508 is staged, `site/js/main.js` staged). All anchors below are worktree-state and cite exact rule text — re-grep by content at dispatch time, never by line number.

---

## 0. Measured facts (the probe numbers this doc stands on)

| Viewport | Header h | Nav rows | Notes |
|---|---|---|---|
| 1280×800 | **68.0px** | 1 (navClientH 38) | brand w 417.3 (mark 28 + word box 164.6 + tag 204.6, gaps 10) vs nav w 418.3 — fits 980 wrap with ~128px slack |
| 860×900 | **107.4px** | **2 (navClientH 77.4)** | nav wraps internally; link h 29.4 |
| 700×900 | **107.4px** | **2 (navClientH 77.4)** | same two-row band — roughly 641-940px |
| 640×900 | 113.9px | 1 (strip mode, P3 landed) | brand-tag one line (h 17) |
| 390×844 | 125.1px | 1 (strip mode) | **brand-tag squeezes to TWO lines (h 34.1 vs 17 natural)**; body scrollW 391 vs 390 (1px rounding, no real overflow) |

- Nav link static `border-bottom-color` = `rgba(0,0,0,0)`; hover = `--line` **#C8C1AD on --paper = 1.48:1** (computed) — a sub-perceptual hover indicator.
- `scroll-margin-top: 84px` base (style.css:267-268) vs measured header **107.4px in the 641-940px band** → anchored jumps land **23px under the sticky header** (section tops clipped).
- `img/logo-mark.png` source is **434×513 (ratio 0.846)**; rendered **28×30 (0.933)** → the mark is stretched ~10% horizontally (HTML attrs AND the CSS rule both pin 28/30; CSS wins).
- `button.btn-primary` (the money buttons) = **accent fill** `--accent`/`--accent-ink` (style.css:353) while the nav pill and hero `.cta-solid` are both ink fill — two registers of "primary" on one page.
- Contrast computations used below: line/paper 1.48 · ink-soft/paper **5.85** · punch/paper **5.42** · accent/paper 2.54 · accent-ink/accent **5.64** (pinned theme pair) · accent-ink/accent-hover `#0FB879` **6.75** · ink-soft/paper-2 5.34 · line/paper-2 1.35.

## 0b. Design laws any header change must satisfy (inherited, not re-litigated)

1. **Tokens only** — no color literals in rules (fallback-literal form only where the file already uses it).
2. **Reduced-motion pairing** — every new animation needs a scoped static pair; the cheapest header moves ship **zero new motion**.
3. **Zero external origins** (`site-tests/resource-gate.test.js`) — no new files, no new hosts; the logo mark is already self-hosted.
4. **WCAG** — `theme.test.js` pins exactly six ≥4.5:1 text pairs; new state colors must reuse pinned tokens (accent-punch 5.42 / ink-soft 5.85 pass; raw `--accent` 2.54 never renders as text/indicator on paper).
5. **Press-grammar pins** (`agent-first.test.js` (m1)) — the `.site-nav a.nav-cta` base rule must keep `transform var(--t-base) var(--ease-enter)` in its transition list and the verbatim `:active:not(:disabled) { transform: translateY(1px); …}` + reduce restate; fill-color edits must extend in place, never fork a second rule.
6. **WS-MOBILE-FIXES contract** (`docs/internal/GOALS_WS_UI_ROUND2_2026-09-05.md`): "NO header content removed — no display:none on header children, brand row intact"; nav clientHeight ≤48 and 44px tap targets at ≤640 are already landed — this doc must not re-litigate them.
7. **Honesty guards** — no yield figures, no static "1:1 BACKED" claim (the BACKED cell is live-filled from `backingCoverage()` and truncates to 99.9% — a static 1:1 could contradict the live value), structural facts only.
8. **Landing discipline** — `style.css` is a shared edit site (copy/motion/a11y/product-gaps waves); implementations append their own EOF block (one-final-EOF-block rule), re-grep anchors at dispatch, and quiesce-probe before landing. Workers never commit; push = user gate.

---

## Ranked proposals

### P1 — Tablet-band anchored jumps clip sections under the sticky header (BUG)
**Problem (measured):** base `scroll-margin-top: 84px` (style.css:267-268) was calibrated for the 68px desktop header. In the ~641-940px band the nav wraps to two rows and the header measures **107.4px** — a nav click lands the section top **23px underneath the sticky bar**. The ≤640 override (142px, EOF block :1506-1507) is correct for mobile (measured 125.1 + 17); only the base rule is wrong.
**Fix (exact diff, style.css:267-268):**
```css
/* was */ section.block, .hero { scroll-margin-top: 84px; }
/* now */ section.block, .hero { scroll-margin-top: 124px; } /* 641-940px band header measures 107.4 (2-row nav) + 16 landing air */
/* was */ #doc-pane [id] { scroll-margin-top: 84px; }
/* now */ #doc-pane [id] { scroll-margin-top: 124px; }
```
Desktop cost: landing air grows 84→124 on a 68px header (generous, never clipped). **Alternative** (only if the 2-row band is also collapsed by P9's strip extension): keep 84px there — but ship the measured-header arithmetic in the summary either way.
**Anchors:** `grep -n 'scroll-margin-top: 84px' site/css/style.css` → exactly 2 hits; the ≤640 `scroll-margin-top: 142px` hits must remain untouched.
**Effort XS / Impact HIGH.** Law check: tokens-only ✓ (px offset is a measured-geometry constant, same form as the landed 142px) · no motion ✓ · mobile override untouched → WS-MOBILE-FIXES P1 gate unaffected ✓.

### P2 — Nav hover state is sub-perceptual (1.48:1)
**Problem:** `.site-nav a:hover { border-bottom-color: var(--line); }` (style.css:152) renders a 2px underline at **1.48:1** on paper — below the 3:1 WCAG 1.4.11 floor for a state indicator and visually near-invisible; the only affordance left is the 120ms timing. Active state (`--ink`, :167) is fine.
**Fix (exact diff, style.css:152):**
```css
/* was */ .site-nav a:hover { border-bottom-color: var(--line); }
/* now */ .site-nav a:hover { border-bottom-color: var(--ink-soft); } /* 5.85:1 — visible step below the active ink underline */
```
Hierarchy preserved: hover `--ink-soft` (5.85) < active `--ink` (14.31) — a quiet-but-visible two-step.
**Anchors:** `grep -n 'site-nav a:hover' site/css/style.css` → 1 hit; no test pins this rule (grep across site-tests = 0).
**Effort XS / Impact HIGH** (every nav interaction, all viewports). Law check: tokens-only ✓ · reuses a pinned theme pair (ink-soft/paper) so contrast can never silently regress ✓ · no motion added ✓.

### P3 — RUN IT YOURSELF pill → the accent register (two-black-fills resolved by grammar, not by gray)
**Problem (measured/hierarchy):** the bar's "Run it yourself" pill (style.css:156-166, ink fill) and the hero "Deposit →" `.cta-solid` (ink fill) are the same black pill at two sizes, and the widget's actual money buttons (`button.btn-primary`, :353) are **accent-filled** — the page currently speaks two different "primary" registers. The ratified ascetic-degen grammar explicitly assigns accent to the connect/run button ("accent GREEN #00A86B (CONNECT button…)", DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md:49) and "Accent = orientation, not decoration".
**Fix (exact diffs — fill only; every other declaration stays byte-identical to keep the (m1) pins):**
```css
/* style.css:157 */  background: var(--ink); color: var(--paper);
              →      background: var(--accent); color: var(--accent-ink); /* 5.64:1 — already a pinned theme pair */
/* style.css:165 */  .site-nav a.nav-cta:hover { background: var(--ink-soft); }
              →      .site-nav a.nav-cta:hover { background: var(--accent-hover); } /* #0FB879 — the shipped btn-primary:hover vocabulary, 6.75:1 */
```
The hero `.cta-solid` **stays ink** = the money register; the pill becomes the self-serve/agent register, matching `btn-primary`. The two-black-fills ambiguity disappears without demoting either CTA to gray.
**Anchors:** `grep -n 'a.nav-cta' site/css/style.css` → :156/:165/:166/:1492/:1367; `agent-first.test.js` (m1) pins only the transition list + `:active` restate — **fill colors are unpinned** (verified: no `background` assertion in the navSpan check, agent-first.test.js:451-453); `theme.test.js` (g) pins the *hero* CTA pair only.
**Effort S / Impact HIGH.** Law check: pinned-pair contrast ✓ · press grammar intact (extend-in-place) ✓ · copy byte-identical ✓ · no new tokens ✓.

### P4 — Ticker strip under the header (the one ratified-grammar item not yet built)
**Problem:** the ratified grammar pins a "ws-SPY→SPY→4663 ticker strip under the nav" (DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md:49). Nothing exists between `</header>` (index.html:62) and `<main>` (:64); the only tape is the `#stat-tape` band far below the fold (index.html:213).
**Fix — static identity strip, zero JS, zero new hosts, non-sticky (scrolls away; zero sticky-cost on the 125px mobile header):**
```html
<!-- index.html, insert directly after </header> (:62) -->
<div class="tape-strip">
  <div class="wrap">
    <span>ws-SPY</span><span>SPY-backed ledger</span><span>Robinhood Chain 4663</span><span>every number read in your browser</span>
  </div>
</div>
```
```css
/* appended EOF block */
.tape-strip { border-bottom: 1px solid var(--line); background: var(--paper); }
.tape-strip .wrap { display: flex; flex-wrap: wrap; column-gap: var(--space-10); padding-top: var(--space-8); padding-bottom: var(--space-8); font-family: var(--mono); font-size: var(--step-1); text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-soft); } /* 5.85:1 at 11px — above the 4.5 small-text floor */
.tape-strip span:not(:first-child)::before { content: '·'; margin-right: var(--space-10); color: var(--accent-punch); } /* 5.42:1 */
```
The 1px border under the header's 2px keeps the weight hierarchy (header > strip > content). Copy = structural facts only (wraps-SPY, chain id, browser-read claim mirrors the noscript note, index.html:29-34) — **no yield figures, no static "1:1"** (law 0b.7; BACKED stays live-filled). Optional later upgrade: a live SPY cell filled from the existing chip pipeline (`#chip-price` fillers, main.js) with `aria-hidden` decorative-duplicate discipline — NOT in v1.
**Rejected variants:** CSS marquee (needs duplicated content + a reduce pair for a purely decorative loop — cost without information); sticky strip (eats mobile viewport; hiding it ≤640 would hit the "no display:none on header children" pin).
**Anchors:** `grep -n '</header>' site/index.html` → 1 hit; `grep -n 'tape-strip' site/css/style.css` → 0 (new class, no collisions); resource-gate: no new resource URLs ✓.
**Effort S-M / Impact HIGH** (identity; the reference's signature band). Law check: static → no reduce pair needed ✓ · tokens-only ✓ · honesty-checked copy ✓ · render.test fetch gates unaffected (no fetch) ✓.

### P5 — Brand mark renders 10% horizontally stretched
**Problem (measured):** source `site/img/logo-mark.png` is 434×513 (0.846); the lockup renders it 28×30 (0.933) — pinned in BOTH the HTML attrs (index.html:51) and CSS (style.css:138; CSS wins) — so the hand-dithered thumb is visibly squashed-wide, the single most-seen brand asset on the page.
**Fix (both sites, keep the 28px optical width, restore ratio):**
```css
/* style.css:138 */ .brand-mark { width: 28px; height: 30px; … }
             →      .brand-mark { width: 28px; height: 33px; … }   /* 28 / 0.846 = 33.1 */
```
```html
<!-- index.html:51 --> width="28" height="30"   →   width="28" height="33"
```
33px also matches the word-plate's 35.9px box height more closely than 30. Keep `image-rendering: pixelated` (the dither crunch is the point) and `align-self: center` (probe: mark center = word-plate center = 33px — already optically centered).
**Anchors:** `grep -n 'brand-mark' site/css/style.css site/index.html site-tests/agent-first.test.js` — the agent-first pin (`['img/logo-mark.png', 'brand-mark', false]`, :66) is filename+class based and still matches.
**Effort XS / Impact MEDIUM-HIGH** (identity face). Law check: no new assets ✓ · static ✓ · pin-safe ✓.

### P6 — Mobile (≤~430px): the brand tag wraps into a ragged two-line squeeze
**Problem (measured at 390px):** `.brand` (style.css:137, `flex` no-wrap, `align-items: baseline`) leaves the tag 157px of row space vs its 204.6px natural width → the tag internally wraps to two lines (h 34.1 vs 17) and the lockup reads as three ragged baselines: mark / plate / broken tag.
**Fix (in the existing ≤640 block, style.css:495-496 neighborhood — appended EOF block per law 0b.8):**
```css
@media (max-width: 640px) {
  .brand { flex-wrap: wrap; row-gap: var(--space-2); } /* tag drops to its own clean ledger line instead of internal-wrapping */
}
```
Result: mark + plate on line 1, full-width one-line tag on line 2 — a deliberate two-row lockup, same ~50px brand-row height (no WS-MOBILE-FIXES gate movement: header ≤135 and nav ≤48 unaffected).
**Rejected:** `display:none` on `.brand-tag` — violates the contract's "NO header content removed / brand row intact" pin (GOALS_WS_UI_ROUND2_2026-09-05.md:74).
**Anchors:** `grep -n 'brand-tag' site/css/style.css` → :149 only (no mobile rule exists — this adds the first).
**Effort XS / Impact MEDIUM.** Law check: no content removed ✓ · tokens-only ✓ · static ✓.

### P7 — Scrollspy "you are here" underline → accent-punch (orientation green)
**Problem:** `.site-nav a.active { border-bottom-color: var(--ink); }` (style.css:167) is the same ink the pill and headline use — location reads as emphasis, not orientation. After P2, hover (ink-soft) and active (ink) differ only by degree.
**Fix (exact diff, style.css:167):**
```css
/* was */ .site-nav a.active { border-bottom-color: var(--ink); }
/* now */ .site-nav a.active { border-bottom-color: var(--accent-punch); } /* 5.42:1 — passes 1.4.11; accent = orientation per the ratified grammar */
```
**Anchors:** `grep -n 'a.active' site/css/style.css site/js/main.js` — CSS :167; scrollspy only toggles the class (main.js:1413-1419), no color logic.
**Effort XS / Impact MEDIUM.** Law check: punch is the page's sanctioned 1.4.11-safe accent (style.css:87 comment) ✓ · tokens-only ✓.

### P8 — Wordmark plate: `--line` border → `--ink` (the stamped-masthead read) — USER-GATE taste call
**Problem:** the boxed wordmark's 2px border is `--line` on `--paper-2` (style.css:145-147) = **1.35:1** — the plate is the quietest element on the bar while carrying the brand. The file's own law says "every data/ledger element keeps its hard 2px border" and the reference grammar's ledger panels are hard-bordered; the masthead is the brand's ledger element.
**Fix (exact diff, style.css:145):**
```css
/* was */ border: 2px solid var(--line);
/* now */ border: 2px solid var(--ink);
```
Interplay: with P3 landed the bar reads ink-bordered plate (structure) + green pill (action) — one accent, one ink stamp, no competition.
**Flag:** this is a taste inversion (quiet plate → stamped plate). Ship behind the user gate; the alternative (keep `--line`) is defensible precisely because everything else on the bar is louder.
**Anchors:** `grep -n 'brand-word' site/css/style.css` → :139-148 block.
**Effort XS / Impact MEDIUM.** Law check: tokens-only ✓ · no motion ✓ · no copy change ✓.

### P9 — Desktop/tablet nav links are 29.4px targets; the two-row band (641-940px) is the real cost
**Problem (measured):** nav links measure 29.4px tall on ≥641px viewports (the 44px floor was landed ≤640 only), and between ~641-940px the nav wraps into a second row (navClientH 77.4 → header 107.4px).
**Fix (two options; ship one):**
- **(a) Tap targets** — extend the landed mobile form to all widths (style.css:151):
```css
/* was */ .site-nav a { color: var(--ink); …; padding: var(--space-4) var(--space-0); transition: …; }
/* now */ .site-nav a { color: var(--ink); …; padding: var(--space-4) var(--space-0); min-height: 44px; display: inline-flex; align-items: center; transition: …; }
```
Header grows 68→~74px desktop; hover underline stays at the border-box bottom (flex centering keeps the underline visually attached).
- **(b) Band collapse** — move the nowrap-strip form (currently ≤640, EOF block :1490) up to `@media (max-width: 940px)` so the band is one scrollable row (header returns to ~68-80px) — then P1's base scroll-margin can stay 84px. If (b) ships, P1's diff must be re-measured against the new header height (same arithmetic rule as the WS-MOBILE-FIXES P1 gate).
**Anchors:** `grep -n 'site-nav a {' site/css/style.css` → :151; strip form lives at :1490-1492 (do not edit those lines — append an overriding block).
**Effort XS / Impact MEDIUM.** Law check: tap-target law consistency ✓ · no content hidden (overflow strip = the landed .doc-tabs precedent) ✓ · re-measure dependency with P1 noted ✓.

### P10 — Verified no-change verdicts (documented so they are not re-opened blindly)
- **Sticky elevation:** the header stays flat (`--paper` + 2px `--line`, style.css:122-128). The R3 taste split reserves `--shadow-soft` for cards/buttons; chrome carries hard borders. Adding a stuck-state shadow would be the first gradient/shadow on chrome — rejected by law, not by taste.
- **z-index:** header z-10 is the site max; skip-link z-100 clears it by design (style.css:114 comment). No headroom problem.
- **Lockup baseline:** probe shows mark center (33px) == word-plate center (33px) at 1280 — the `align-self: center` on `.brand-mark` inside the baseline row is already correct; do not "fix" it to baseline.
- **Sticky header + jurisdiction banner:** the banner renders above the header and scrolls away while the header sticks — correct disclosure behavior; no change.
**Effort zero / Impact: prevents churn.**

---

## Coordination & landing notes

- **Shared-file discipline:** `site/css/style.css` carries staged sibling work (WS-MOBILE-FIXES EOF block :1479-1508) and copy/motion/a11y/product-gaps waves touched it the same day. Every CSS proposal here lands as its **own appended EOF block** (one-final-EOF-block rule) or a single-line in-place edit with a content re-grep at dispatch — never a line-number patch.
- **Test re-pinning per proposal:** P3 — none required (fill unpinned) but re-run `agent-first.test.js` (m1) + `theme.test.js` to prove it; P4 — new markup may warrant a resource-gate re-run (no new URLs → expected green); P5 — `agent-first.test.js:66` still matches; P1/P9 — re-run the WS-MOBILE-FIXES mobile gates (390×844: header ≤135, nav ≤48, jump-landing window) to prove no regression.
- **Suggested sequence:** P1 + P2 + P5 + P7 (four one-liners, zero risk) → P3 (grammar alignment) → P6 + P9 (responsive) → P4 (strip, biggest surface) → P8 (user-gate taste call last).

## Considered and rejected
- Hiding `.brand-tag` on small screens (violates the no-content-removed pin) · marquee-animated ticker (motion cost, no information) · sticky ticker strip (mobile viewport cost) · grotesque nav face swap (the mono-chrome register IS the reference's metadata voice; serif/mono pairing is the ratified identity) · gray demotion of the nav pill to fix two-black-fills (demotes a ratified CTA; the accent-register fix P3 resolves it without loss) · stuck-state header shadow (first chrome shadow, rejected by the flat law).
