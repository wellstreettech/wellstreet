# UI Improve Round-2 — Art Direction & Choreography Map (2026-09-05)

**Repo:** `/home/raivo/Documents/wellstreet` · branch `main` · HEAD `28208df`. **Lens:** ART DIRECTION & CHOREOGRAPHY — where each dither asset lives, how the wired set relates, and where the unwired design-kit reserves earn their place.

**Method:** analysis-only, zero site edits, zero commits. Read: `docs/inventory/FRONTEND_MAP_2026-09-04.md`, `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (design law + MOTION MENU), full `site/index.html`, full `site/css/style.css` (1,511 ln), the asset/keeper/motion regions of `site/js/main.js`, `site-tests/agent-first.test.js` (the asset-governance battery), and the round-2 goals doc `docs/internal/GOALS_WS_UI_ROUND2_2026-09-05.md`. Every wired asset was **viewed as an image** (canyon-hero, hand-point, hand-press, hand-magnify, curve-stroke, certificate, logo-mark, og.png). **Caveat:** the mapping session had no shell — the design-kit reserves (`docs/internal/design-kit/wallstreet/`: bulls, towers, WELL ST signs, porticos, tickers, canyons) are cited at **motif granularity** per the dispatch brief; exact filenames must be enumerated (`ls docs/internal/design-kit/wallstreet/`) at wire time and the pose picked by the kit's consistency rule (same style suffix + same paper background for cutout compositing, reference doc §ASSET SET). All `file:line` anchors are the HEAD-28208df worktree read; **grep anchors (byte strings) are authoritative** — re-verify at dispatch (live siblings drift lines).

**Binding design law (restated; every proposal is checked against it):**
1. **Assets are art, never data.** Every img is `aria-hidden`/`alt=""`, decorative, and must never carry, imply, or occlude a figure (P2 is a live violation of exactly this).
2. **Self-hosted only.** Relative `img/…` paths (resource-gate host allowlist; IPFS-safe). No new origins, ever.
3. **The declaration gate.** EVERY new `site/img` reference must be declared in `ASSET_MOTION` (`agent-first.test.js:60-68`) — moving assets get a reduce pair, static assets ship **no** animation/transition in their base rule and never enter the first `no-preference` gate ((b2)/(b3) teeth).
4. **Zone discipline.** The WS-ASSET-WIRE section (banner → its reduce block → next `@media`) is slice-governed: never insert a new `@keyframes` between its `no-preference` gate and `@keyframes asset-magnify-sweep`, never a new `@media` before its byte-exact reduce pins (`.asset-press { transition: none; transform: none; }` etc.). New asset sections append **at EOF, after the WS-MOBILE-FIXES block**; any new `no-preference` gate goes there too (never before the existing one — (b3) slices the FIRST gate in the file).
5. **Hero fold contract.** `.hero .wrap` has exactly 8 direct children carrying the mobile `order` ranks (WS-MOBILE-FIXES, style.css:1498-1505). **New art never becomes a direct child of `.hero .wrap`** — it goes inside an existing container (ledger aside, block-head, footer row) or a new art becomes `order: 0` and jumps the headline on phones.
6. **Page-weight:** `du -sb site ≤ +50,000B` per wave (round-2 gate); class-only markup (no new element IDs — render.test.js registry untouched); tokens only, no new color literals (theme.test.js sweeps).

---

## 0. Wired-asset census (what lives where today)

| Asset (file · bytes-class) | Class / placement | Motion | Observations (the lens) |
|---|---|---|---|
| `img/canyon-hero.png` — hero backdrop, `object-fit: cover`, z-0 behind `.wrap` (style.css:194-203) | `.hero-canyon` (index.html:72) | 1.62s vibrate burst, `ws-canyon-vibrate` (style.css:1454-1463); reduce pairs at :517 + :1468 | The one keeper **not** under `img/compressed/` (2560×1440 declared; wire-time census 2,064,777B untracked — ~8× the rest of `site/img` combined). **Defect:** the ±6px translate exposes paper gaps at the hero edges (P1). Sepia/khaki temperature, buildings at edges, open center — the ratified draft composition. |
| Inline `.hero-motif` SVG — green grid + quarter-turn (index.html:80-92; style.css:612-621, :732) | z-0, paints **above** the canyon (later in DOM) | none (draw-on was proposed, never shipped) | Two atmosphere systems stacked in one hero: sepia dither + green og-language grid. The canyon superseded the motif's atmospheric role (it replaced the dead video); the motif now competes with it (P7). |
| `img/compressed/hand-point.png` — sleeve-point, fingertip over the hero-ledger's top-right edge (style.css:1386-1397; top −104px, right −12px) | `.asset-point` (index.html:156) | **static by declared design** (index.html comment; ASSET_MOTION `false`) | Correct composition: arm occupies the empty upper-right of the content column, finger points INTO the ledger rows. Hidden ≤640. Earns its place. |
| `img/compressed/hand-press.png` — beside `#btn-deposit` in the widget `.btn-row` (index.html:350) | `.asset-press`; dips 6px on hover/focus via `#btn-deposit:hover ~ .asset-press` (style.css:1433-1435) | moving, gated | **Pose mismatch:** the asset is a PINCH (precision gesture), the role is PRESS (a button being depressed). The dip animation sells "press" over a hand that is visibly pinching (P9). |
| `img/compressed/hand-magnify.png` — in `#docs .block-head` (index.html:465) | `.asset-magnify`; one sweep per refresh cycle, `motionAllowed()`-gated | moving, gated | The check-it-yourself motif on the check-it-yourself section. Earns its place. |
| `img/compressed/curve-stroke.png` — centered divider between #docs and #agents (index.html:481-483; style.css:1423-1424) | `.curve-divider .asset-draw`; clip-path draw-on, IO-armed | moving, gated | A big smile-arc between "the fine print, promoted" and "Operated by agents" — a hand-drawn stroke separating the human doc from the machine surface. Defensible; size is the only open question (P8). |
| `img/compressed/certificate.png` — appended by main.js to EVERY vault card, pending and live ("the empty card is its state", main.js:215-230) | `.asset-certificate` top-right of `.vault-card` (style.css:1414-1422) | static | **Defect:** at `top/right: 12px` and up to 120px wide it lands squarely on the `.card-head`'s right side — the `.share-symbol` (ws-SPY) and `.pending-tag` **data chips** (head is ~46px tall; the cert is ~64px). Art occluding data (P2). |
| `img/logo-mark.png` — header lockup, 28×30, `image-rendering: pixelated` (index.html:51; style.css:138) | `.brand-mark` | static | Solid-ink thumb — the derived favicon/nav silhouette per the ratified logo system. Harmonizes. |
| `site/og.png` — 1200×630 | head metas | — | **Already rebuilt** in the ratified aesthetic (green disc + halftone thumb + serif WELLSTREET + tagline). FRONTEND_MAP Pending #1 is resolved at this HEAD. |

**Art-density map (the print-magazine read):** hero = atmosphere (canyon) + figure (point hand) + chips — the densest spread, correctly, as the cover. Stat band, flow figure, vault rows = zero art (data surfaces — correct). Vaults = 1 keeper (certificate, misplaced). Deposit = 1 figure (press). Invariants = 0 (the "plaque" — correctly austere, one pediment is its allowance, P6). Docs = 1 figure (magnify). Divider = 1 stroke. Agents = 0. Footer = 0 — the page ends with no terminal mark (P5 is its colophon).

---

## 1. Ranked proposals

### P1. Canyon vibrate edge-bleed — fix the edge-gap defect (defect fix)
- **Anchor:** style.css `.hero-canyon {` span (194-203: `inset: 0; width: 100%; height: 100%`) + `@keyframes ws-canyon-vibrate` (1454-1463, max translate ±6px, e.g. `2% { transform: translate(-6px, 4px); }`).
- **Defect:** the img box is exactly the hero box; every translate shifts the painted box and exposes up to a 6px cream (`--paper`) gap along the trailing edges during each 1.62s burst — a flickering frame around the hero backdrop.
- **Placement diff:**
```css
.hero-canyon {
  position: absolute;
  inset: -8px;                  /* was 0 — 8px bleed ≥ the 6px max translate */
  width: calc(100% + 16px);     /* was 100% */
  height: calc(100% + 16px);    /* was 100% */
  object-fit: cover; object-position: center;  /* unchanged — bleed keeps the crop */
  z-index: 0; pointer-events: none;
}
```
- **Law check:** pure positioning, no data, no motion change; reduce pairs (:517, :1468) untouched; no new tokens.
- **Effort S · Impact 5 · Bytes ~0** (3 declarations). Verify: headless probe at 1280 mid-burst — no paper gap at any hero edge (sample 4 frames at 1%/5%/9% of the cycle).

### P2. Certificate occlusion — art must never sit on data (defect fix)
- **Anchor:** style.css `.asset-certificate {` span (1414-1422: `top: var(--space-12); right: var(--space-12); width: clamp(84px, 10vw, 120px)`); cert appended at main.js:223-230; `.card-head` anatomy (style.css:286-289).
- **Defect:** the certificate (≤120×64px) overlaps the `.card-head`'s right corner where `.share-symbol` and `.pending-tag` render (head ≈46px tall) — at the 320-400px grid widths the dither covers the symbol chip: art occluding data, a direct design-law breach.
- **Placement diff (CSS-only; reserve the note's right corner, magazine-style):**
```css
.card-note { min-height: 72px; padding-right: 108px; }   /* + two declarations in the existing rule */
.asset-certificate {
  top: auto;                    /* was var(--space-12) */
  bottom: var(--space-10);      /* corner of the fine-print row */
  right: var(--space-14);
  width: clamp(72px, 8vw, 96px);
  opacity: 0.9;
}
```
(The implementer tunes bottom/width by probe — outcome-pinned: no overlap with the last `.card-row`'s value at any grid width ≥320. `min-height` guarantees the corner on short notes.) **Alternative if the wave prefers asset-side meaning:** return the keeper to pending-cards-only (revert the 2026-09-04 "rides live cards too" re-pin in main.js:218-219) — an unissued certificate marks an unfilled vault, and the family grid stops stamping the same art on every future card (RBLX/USDG). Either is fine; do not ship both.
- **Law check:** art repositioned OFF data; static stays static ((b3): `.asset-certificate` must keep zero animation/transition in its base rule and never enter the first `no-preference` gate). ASSET_MOTION row unchanged (same file/class).
- **Effort S · Impact 4 · Bytes ~0.1KB.** Verify: probe 320/390/1280 — `.share-symbol` and `.pending-tag` bounding rects never intersect the cert rect.

### P3. Serve the canyon at keeper weight — recompress (page-weight)
- **Anchor:** `src="img/canyon-hero.png"` (index.html:72) · `['img/canyon-hero.png', 'hero-canyon', true]` (agent-first.test.js:67) · wire-time census 2,064,777B untracked (GOALS doc §WS-MOTION-POLISH dispatch gate).
- **What:** the backdrop is the heaviest byte on the page by ~8× and the only keeper outside `img/compressed/`. Produce a compressed variant — ≤1600px wide, palette-quantized PNG (the halftone dot survives quantization well; verify the dither doesn't mud at 8-bit by eye against the original). **Preferred:** recompress **in place** (same path — zero code/test churn). Tidy alternative: `img/compressed/canyon-hero.png` + update index.html:72 + the ASSET_MOTION row (dated re-pin comment).
- **Law check:** self-hosted relative path unchanged in kind; art-only; the LCP-paint byte cost drops ~1.7MB on every first view including mobile.
- **Effort S · Impact 4 · Bytes −1.7MB or better.** Verify: `du -sb site` negative delta; visual A/B of the hero at DPR-2 crop (dither texture intact at 200% zoom).

### P4. The bull earns its place as the launch-flip payoff sprite (unwired assignment — choreography)
- **Kit:** `docs/internal/design-kit/wallstreet/` bull (enumerate filenames at wire time; pick the ink-on-paper pose matching the hands' temperature).
- **Why here and nowhere else:** the bull is the most cliché degen asset on the page's register — permanent display would cheapen the ascetic voice. But the WOW-3 launch-flip is a **real, one-time, never-simulated** state event (`body.launch-flip`, main.js — fired only on a live false→true `isDeployed` transition, wow.test.js-pinned). The bull as the one-time payoff of that beat is scarce art with earned meaning: the degen mark appears the day the vault actually goes live, then stays. It is decoration announcing a state — never a figure, never simulated (wow.test.js already proves launch-flip never fires under PENDING_DEPLOY).
- **Placement:** a static `<img class="asset-bull" src="img/compressed/bull.png" … aria-hidden alt="" loading="lazy">` appended inside `#vaults .block-head` **by main.js at the flip** (same code path that sets `body.launch-flip`; never in static markup — pre-flip the art does not exist).
```css
/* appended at EOF in a new WS-ART-DIRECTION section */
body.launch-flip .asset-bull {
  display: block;                 /* default .asset-bull { display: none; } */
  width: clamp(72px, 9vw, 120px); align-self: center; flex: 0 0 auto;
  animation: ws-flip-in 640ms var(--ease-enter) both;   /* keyframes already exist (~:1330) */
}
```
- **Governance (the non-obvious part):** ASSET_MOTION row `['img/compressed/bull.png', 'asset-bull', true]`; the (b2) tooth requires the moving asset's name inside the WS-ASSET-WIRE `no-preference` gate block — put a `.asset-bull` motion line (e.g. the display/animation rule above) **inside the existing gate** as a plain rule, never a new `@keyframes` before `asset-magnify-sweep`; add `body.launch-flip .asset-bull` to a scoped reduce restate (`display: none; animation: none;` — under reduce the bull simply never appears; the state flip is the event, not the art).
- **Law check:** art tied to a real transition, never simulated; self-hosted; aria-hidden; class-only.
- **Effort M · Impact 3 · Bytes ~8-15KB asset + ~0.4KB CSS + ~6 lines JS.**

### P5. WELL ST sign → the footer colophon (unwired assignment)
- **Kit:** WELL ST street sign (ink/paper sticker variant).
- **Why:** the footer is the only fully art-less band and the page's last impression; a small street sign is the print-magazine **colophon** — the address plate at the end of the issue. It literalizes "the address" of the protocol (wellstreet.tech / ENS mirror) without adding a word of copy.
- **Placement:** inside `.footer-fine` (index.html:538-541 — the mono fine-print row), right-aligned terminal mark; never a direct `.hero .wrap` child (law 5 is moot here but the pattern holds).
```css
.footer-fine { display: flex; justify-content: space-between; align-items: center; gap: var(--space-16); }
.asset-sign { width: clamp(88px, 11vw, 140px); height: auto; flex: 0 0 auto; opacity: 0.92; }
```
- **Law check:** static (`ASSET_MOTION … false`; no gate entry, no motion anywhere); aria-hidden/alt=""/lazy/width+height attributes (CLS discipline, WS-OG-PERF precedent); self-hosted relative; the cream sticker edge pops against the `--ink-deep` footer surface — no new tokens.
- **Effort S · Impact 3 · Bytes ~8-14KB asset + ~0.2KB CSS + 1 line markup.**

### P6. Portico → the invariants pediment (unwired assignment)
- **Kit:** classical portico/pediment.
- **Why:** #invariants is the section that reads like a plaque bolted to a building ("One token is one share. Not one dollar." + the definition list + the Backing Invariant card). A single small pediment above the card gives the guarantees their facade — the one art mark the section's austerity allows.
- **Placement:** mirror the magnify slot — an `<img class="asset-portico">` in `#invariants .block-head` after the muted span (the established block-head figure pattern, index.html:465 precedent), **not** floating over `.inv-card`.
```css
.asset-portico { width: clamp(96px, 12vw, 160px); height: auto; align-self: center; flex: 0 0 auto; pointer-events: none; }
```
- **Law check:** static, declared in ASSET_MOTION (`false`); aria-hidden/alt=""/lazy; self-hosted; no motion, no tokens; one art element per section (see P12) — the curve divider stays in its docs→agents slot, not here.
- **Effort S · Impact 3 · Bytes ~8-14KB + ~0.1KB CSS + 1 line markup.**

### P7. Demote or retire the hero motif — one atmosphere per hero
- **Anchor:** `<svg class="hero-motif"` (index.html:80-92) · `.hero-motif {` (style.css:612-621) · ≤640 resize (:732) · scoped reduce mention (:742-747).
- **Why:** the motif was the og-language atmosphere that filled the hero after the video died; the canyon now owns that job. Today both paint in the same z-0 band — a green-grid quarter-turn composited over sepia dithered towers, two texture systems from two identities fighting over the same corner. The ratified drafts carry the canyon as THE atmosphere; the reference grammar keeps exactly one decorative layer behind the type (chips are the sanctioned scatter — they carry real figures and sit in the gutters).
- **Placement diff — Option A (retire, preferred):** delete index.html:73-92 (comment + svg) and the three style.css mentions (:612-621, :732, the `.hero-motif` token in the :742-747 scoped reduce block). Check pins first: no ASSET_MOTION row (inline SVG, not an img — the (b) derivation only sweeps `img/…` paths), no render.test registry id; verify theme.test.js before deleting (the motif's `rgba(0,168,107,…)` literals live in **index.html**, and the accent-retint count pin's exact target must be confirmed — if it counts html rgba sites, deletion shifts it and the pin re-pins with a dated comment).
- **Option B (demote, zero-deletion):** `opacity: 0.35; width: min(34vw, 400px);` in the base rule — the grid recedes to a texture whisper under the canyon.
- **Law check:** pure art removal/demotion; zero data; zero requests either way (the motif is inline — deleting it also saves nothing in bytes but one paint layer).
- **Effort S · Impact 3 · Bytes ±0.**

### P8. Curve divider — keep, and record why (placement verdict + optional tune)
- **Anchor:** `.curve-divider {` (style.css:1423-1424) · `img/compressed/curve-stroke.png` (index.html:482) · draw-on rules (:1442-1444).
- **Verdict:** **keep in the docs→agents slot.** It is the page's only hand-drawn stroke and it sits exactly at the seam between the human docs and the machine surface — "written to be checked" closes, one ink arc, then "Operated by agents." Moving it under the invariants claim would crowd the section P6 just gave a pediment (one-in-one-out, P12); moving it to the hero stacks a third mark onto the densest spread.
- **Optional tune if the wave wants a change:** shrink and left-align to read as a signature rather than a centered ornament — `.curve-divider { justify-content: flex-start; } .curve-divider .asset-draw { width: min(520px, 70vw); }` (the draw-on already reveals left-to-right; a left-anchored stroke matches the ink-laid-down direction).
- **Law check:** unchanged either way; static geometry only.
- **Effort S · Impact 1-2 · Bytes ~0.**

### P9. Press-hand pose truthing — a pinch is not a press
- **Anchor:** `class="asset-press"` (index.html:350) · `#btn-deposit:hover ~ .asset-press` (style.css:1433-1435) · ASSET_MOTION row (`true`).
- **Why:** the wired asset is a PINCH (precision/verify gesture — visually it is the "pinch" pose from the design-ref's required set), but its role and its motion are PRESS: it dips 6px beside the deposit button as if depressing it. The motion sells press; the hand says pinch. Either the pose serves the role or the role serves the pose.
- **Placement — Option A (preferred, asset-side, zero code):** swap the file at `img/compressed/hand-press.png` for the kit's open-palm/press-down pose (same filename, same class, same ASSET_MOTION row, same motion). The kit's consistency rule applies (same paper bg / style suffix for cutout compositing).
- **Option B (re-role, code-side):** keep the pinch and move it beside the amount field (`#dep-amount`) where precision IS the metaphor, and give the button no hand. Breaks `#btn-deposit:hover ~ .asset-press` (sibling selector) — the dip trigger must move to the field's focus/hover or die; more churn for less gain.
- **Law check:** art-only either way; Option A touches zero source bytes.
- **Effort S (A) / M (B) · Impact 2 · Bytes ~5-10KB (A).**

### P10. Mobile canyon crop — verify the 390px frame; towers stay unkeyed
- **Anchor:** `.hero-canyon` cover rule (style.css:194-203) · the ≤640 hero rules (:494, :496, :735).
- **What:** at 390×~800, `cover` shows the source's center ~32% — mostly the open-sky column with building slivers at the edges (the frame may starve: two thin dark strips against cream). Probe first (headless 390×844 DPR-2, screenshot). If the frame reads starved: produce a **portrait crop** from the kit's canyon reserves (`img/compressed/canyon-hero-mobile.png`, buildings filling more of the narrow width) and wire via `<picture>` (index.html:72) — art variant, one asset per viewport, both self-hosted.
- **Restraint record:** the kit's **towers** are NOT wired. The canyon already owns towers; a second towers asset would duplicate the atmosphere. Unkeyed stays unkeyed unless the user asks for a section-specific backdrop (e.g. a docs-band variant), which would need a density renegotiation (P12).
- **Law check:** art-only, per-viewport; `du` gate — one new compressed asset ≤15KB.
- **Effort S/M · Impact 2 · Bytes ~10-15KB if wired.**

### P11. Tickers → considered-and-rejected; the dither palette law → documented
- **Tickers (rejected):** the stat band is the live tape — a data surface. A dithered ticker-strip border along the band (or worse, in the cells) dresses data with art and flirts with implying motion in figures that are measured, not performed. The WOW-1 tape already owns that band's theatrics with honest delta ticks. Default: **do not wire**. If the user ever asks for it: strictly outside the cells — a ≤24px aria-hidden strip on the band's bottom hairline, opacity ≤0.5, ASSET_MOTION-declared static.
- **Palette law (document, zero bytes):** the wired set already splits into two deliberate temperatures — **sepia/khaki for atmosphere** (canyon, curve stroke) and **charcoal ink for figures** (point/press/magnify hands, certificate, logo mark). That split is defensible and now becomes the rule for every future kit pick: *atmosphere assets are sepia, figure assets are ink; a candidate that lands between temperatures gets regenerated, not filtered.* (A CSS `filter:` retint is possible but is a smell — fix the asset, not the paint.)
- **Law check:** this proposal ships a record, not bytes.
- **Effort — · Impact 2 · Bytes 0.**

### P12. The art-density law — one-in-one-out per section, the ASSET_MOTION gate as enforcement
- **What:** codify the print-magazine contract the census in §0 shows the page already follows: **max ONE art element per section** beyond the hero's sanctioned set (canyon + point hand + chips). Vaults = certificate · Deposit = press hand · Invariants = portico (P6) · Docs = magnify · Divider = curve · Agents/footer = terminal marks only (P5). A new asset in a section that already has one must displace it (one-in-one-out), never stack.
- **Enforcement seam:** `ASSET_MOTION` (agent-first.test.js:60-68) already forces every new img reference to be declared with its motion posture — extend the declaration habit with a one-line comment per row naming the section it serves, so the next mapper can re-derive this density map from the test file alone.
- **Law check:** this IS the law ("assets are art, never data" operationalized as a per-section budget + the self-hosted/declaration gates).
- **Effort — · Impact 2 · Bytes 0 (one comment line per future row).**

---

## 2. Unwired-reserve assignment summary

| Kit motif | Verdict | Home (if wired) | Proposal |
|---|---|---|---|
| Bull | WIRE — as the launch-flip payoff sprite, one-time, never pre-existing | #vaults block-head, revealed by `body.launch-flip` | P4 |
| WELL ST sign | WIRE — footer colophon | `.footer-fine` right slot | P5 |
| Portico | WIRE — invariants pediment | `#invariants .block-head` | P6 |
| Canyons (variants) | CONDITIONAL — portrait mobile crop only if the 390px probe starves the frame | `<picture>` swap at index.html:72 | P10 |
| Towers | NOT WIRED — duplicates the canyon's job | — | P10 (restraint) |
| Tickers | NOT WIRED — data-band austerity | — | P11 (rejected) |
| Design-ref poses not yet cut: open palm, thumbs-up non-logo use | Open palm = the P9 press-pose swap candidate; thumbs-up stays logo/og-only (its second body would dilute the mark) | — | P9 |

## 3. Considered and rejected

- **Canyon parallax/scroll-drift** — a full-bleed backdrop on a scroll-driven transform is the one move that betrays the print metaphor (prints don't drift) and it fights the already-shipped vibrate; rejected.
- **Certificate stop-motion frames** — the motion map's proposal 7 (seal-press on a real coverage landing) was zone-barred and stays out; frame-flips on the certificate would stack a second motion on the page's most data-adjacent art. Rejected here too.
- **Bull always-on in the deposit section** — permanent degen mark on the money path cheapens the register; scarcity is the whole value (P4's flip-only placement).
- **A dithered coin/share-token motif** — the certificate already IS the share object; a coin next to it duplicates the same metaphor at lower fidelity.
- **Motif draw-on (old motion-map proposal 9)** — mooted by P7: don't animate an asset being demoted.

## 4. Page-weight rollup (gate `du -sb site ≤ +50,000B` per wave)

| Item | Bytes |
|---|---|
| P1, P2, P7, P8, P11, P12 (CSS/markup only) | ~±0.5KB |
| P3 canyon recompress | **−1.7MB or better** (negative) |
| P4 bull + P5 sign + P6 portico (compressed, ~8-15KB each) | ~+35KB worst case |
| P9 pose swap | ~+5-10KB (replaces same-path file) |
| P10 mobile crop (conditional) | ~+12KB |
| **Net** | **negative to ~+50KB** — inside the gate even before P3's credit |

## 5. Governance notes for the dispatching wave

- **Suite is the safety hook:** `node --test "site-tests/*.test.js" "api-tests/*.test.js"` before and after; failure-ID-SET delta EMPTY (never a pass-count gate — siblings add tests).
- **Every new img reference** → ASSET_MOTION row (agent-first.test.js:60) + statics get NO animation/transition in their base rule + never named inside the FIRST `no-preference` gate ((b3)); movers' rules go inside the WS-ASSET-WIRE gate as plain rules, keyframes only AFTER `@keyframes asset-magnify-sweep`; new sections/restates append at EOF after the WS-MOBILE-FIXES block.
- **Markup additions:** class-only, `aria-hidden` + `alt=""` + `loading="lazy"` + explicit `width`/`height`; never a direct `.hero .wrap` child; index.html edits must leave the 8-child `order` contract and all byte-frozen copy untouched.
- **Workers never commit; no deploy in-wave** (static site — value ships at the owed user-side manual deploy; GitHub auto-deploy recorded NOT FIRING 2026-09-04).
- **Quiesce + anchor discipline:** re-verify every grep anchor on the dispatch-time worktree; live siblings hold uncommitted hunks in style.css/index.html/main.js (canyon-hero sibling + the round-2 waves' landing state at this HEAD).
