# UI-IMPROVE-2 — COLOR & TEXTURE (2026-09-05)

**Lens:** paper-tone system · ink family · green-accent deployment density · hatch rhythm · texture-as-choice · border taxonomy.
**Scope:** analysis only, zero site edits. Worktree HEAD `cd9886aeb` (clean `site/css/style.css`, 1,510 ln; the mapping brief's `28208df` and the SKINS doc's `048718f` both predate this read — every file:line below is at `cd9886aeb`).
**Inputs:** `docs/inventory/FRONTEND_MAP_2026-09-04.md` · `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (RATIFIED LAW) · full read of `site/css/style.css` + `site/index.html` (hero/section regions) · `site-tests/theme.test.js` · `docs/inventory/UI_IMPROVE2_SKINS_2026-09-05.md` (whose Pillow-measured asset palettes are cited as evidence) · visual read of `site/img/canyon-hero.png` + `site/img/compressed/hand-point.png`.

**Boundary with sibling docs:** UI_IMPROVE2_SKINS owns companion *skins* (alternate `:root` blocks — dark/kraft, both parked). This doc works entirely INSIDE the ratified light identity: no new hue families, no second substrate. UI_IMPROVE2_HEADER / FOOTER / DEGRADED-STATES own their surfaces; color findings on those surfaces are only claimed here when they are token/texture-system findings, and coordination is noted per proposal.

---

## 0. Design law + the test contract that binds every diff below

**Ratified palette (law, `DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md:49`):** paper `#EDE9DC`-family substrate · ink · accent GREEN `#00A86B` (fill) · `#006B45` punch (h1 text on cream) · mono metadata edges · halftone-dithered hand collage. Refinements live WITHIN this: every proposal below re-uses existing tokens or adds *derived* values (alpha/filter/color-mix of existing hues) — zero new hex families.

**`site-tests/theme.test.js` constraints any implementation must survive (or deliberately re-pin):**

- (a) 22-entry PALETTE pins exact token values → **never re-value a pinned token**; add new names instead.
- (d) LEGACY_HEXES ban list — includes substring bans `#000`/`#fff` (any 6-digit hex containing them fails) and rgba-family bans `rgba(255,255,255` / `rgba(46,194,126` / `rgba(224,101,74` / `rgba(14,61` / `rgba(13,107`. New literals must avoid all of these.
- (d) motif retint: `rgba(0,168,107,` appears in **index.html exactly 6 times** — CSS-only changes to `.hero-motif` are safe; markup edits are not.
- (g) `repeating-linear-gradient` ≥ 2 · `45deg` ≥ 2 · `border-bottom: 2px solid var(--line)` occurs **exactly 9 times** · `#fbfaf5` exactly 1 (geo freeze).
- (c) WCAG ≥ 4.5:1 for exactly six text pairs (ink/paper, ink-soft/paper, accent-text/paper, accent-ink/accent, warn/paper-2, ink/paper-2) — hero-over-image text is *not* in the battery, so image-blend changes need a screenshot gate, not a test change.

---

## Ranked proposals

### P1 — Blend the canyon INTO the paper (multiply; taste dials: grayscale, brightness, mask) — the texture-as-choice flagship

**Evidence.** The hero's effective substrate is the PNG's own field, not `--paper`. Measured (SKINS §3.9): canyon-hero.png opaque pixels = 61% ink `#1D1918` + warm mids `#625B55` / `#A89E94` / `#DECBB1` + **cream speckle `#F2E9DB` (7.8%)**. `#F2E9DB` is lighter and pinker than `--paper #EDE9DC`, and the img covers the hero outright (`style.css:194-203`, `object-fit: cover; inset: 0`) — so the open center behind the h1 reads as a slightly-off foreign cream, with a visible substrate step at the header rule (`:123`) and the stat-band rule (`:902`). The mids are warm-GRAY/tan (paper-adjacent, not a rogue saturated sepia — theSKINS measurement settles what the visual read suggested), so the fix is blending, not recoloring. This is the "canyon speckle lesson": the speckle is good texture — texture as a CHOICE — but today it floats as a separate light field instead of sitting IN the paper.

**Exact diff** (`site/css/style.css:194-203`):

```css
.hero-canyon {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center;
  z-index: 0;
  pointer-events: none;
  /* texture-as-choice: multiply drops the PNG's lighter-than-paper speckle
     field (#F2E9DB, SKINS §3.9) onto --paper — the substrate step at the
     header/stat-band rules dies and the ink dither sits IN the paper family.
     Static by construction (filter/blend are not motion); engines without
     blend support render today's state (no regression). */
  mix-blend-mode: multiply;
}
```

Taste dials (implementer/user, in order of restraint): (1) `filter: grayscale(1) contrast(1.06) brightness(1.03)` turns the warm mids into strict ink-wash — take it ONLY if the law's monochrome read wins over the art's warmth (the ratified reference is paper/ink monochrome; the drafts kept warm paper, so default is NO grayscale); (2) `mask-image: linear-gradient(to bottom, #000 0%, rgba(0,0,0,0.6) 45%, #000 100%)` if any headline glyph ever crosses a darkened building edge — keeps type over the lightest band.

**Anchor:** `grep -n "hero-canyon" site/css/style.css` → :194 (rule), :517 (reduce pair — filter/blend need no pair, leave), :1447/:1454/:1468 (vibrate — untouched).
**Effort XS · Impact H** (largest surface on the page; removes the only off-token substrate field).
**Law check:** within palette — multiply is a neutral compositing op; the speckle and mids remain the art's own values, just seated on `--paper`.
**Test-safety:** no token/markup change; theme.test untouched; agent-first.test.js:67 pins the img/class (unchanged). Verify with a hero screenshot (the soak-end human gate): center should read as `--paper`, not lighter.

### P2 — One texture system per surface: demote the og-era motif under the canyon

**Evidence.** The hero currently stacks THREE decorative texture layers: the dithered canyon (img, DOM first), the green grid + quarter-turn SVG motif (index.html:80-92, same `z-index: 0`, paints ABOVE the canyon because it is later in DOM), and the floating chips (which carry data — sanctioned). The motif is the og.png/dark-era visual language; the canyon is the ratified drafts' language. Overlaid, the 9%-alpha green grid rattles across the speckled dither — two competing texture stories on one surface, exactly the noise the ascetic law cuts.

**Exact diff** (`site/css/style.css:612-621` — append to the existing `.hero-motif` rule):

```css
  /* demoted while the canyon owns the hero backdrop (one texture system per
     surface); markup stays (theme.test (d) pins the six rgba(0,168,107,)
     sites in index.html). Restore by deleting this line if the canyon is
     ever retired. */
  display: none;
```

**Anchor:** `grep -n "hero-motif" site/css/style.css` → :612.
**Effort XS · Impact M** (hero reads calmer immediately; also removes the motif's green as the hero's largest green field, which sharpens P3's accent hierarchy).
**Law check:** within — removal, not addition; the green accent register stays carried by chips/punch/focus.
**Test-safety:** CSS-only; the 6-site html pin, favicon pins, and asset-gate all untouched.

### P3 — One number, two opposite colors: re-point the APR chip off `--warn` and codify the accent semantic map

**Evidence.** The projected depositor APR renders **warn-red** in the hero (`index.html:107` — `hero-chip--warn hero-chip--apr`, fill `var(--warn)` at `style.css:824`) and **accent-green** on the stat band one scroll later (`stat-marker` border `var(--accent)` + text `var(--accent-text)`, `style.css:943-955`; the APR glyph is `--accent-text`, `:925`). The stylesheet's own law comment defines `--warn` as "warnings, blocked, unavailable" (`:22`) — a *projection* is a caution, not an absence, and the band already says it right with the printed "PROJECTED" tag. Red is the loudest chip in the hero and it is spent on the number we most want read as honest-but-not-live. Whichever way it is decided, the two surfaces must agree.

**Exact diff** (`site/index.html:107`, one class token):

```html
<span class="hero-chip hero-chip--tan hero-chip--apr"><span class="hero-chip-label">APR</span><span class="hero-chip-val" id="chip-apr"></span><span class="hero-chip-suffix">projected</span></span>
```

Chip palette becomes green(live price) / ink(TVL) / **tan(APR — the printed, not-live register)** / tan(ws-SPY) / ink(split) / tan(chain): warm tan = static/printed, green = live, ink = neutral, red = failure only. (Alternative if tan over-weights: `--ink`.)

**Codify the map** (comment on the chip-palette block, `style.css:817`):

```css
/* ACCENT SEMANTIC MAP (the law's density rule): --accent fill = LIVE/money
   (btn-primary, live chips, flow paths, sim bar); --accent-text = live/verified
   values + links; --accent-punch = orientation only (h1 punch, focus ring,
   up-tick, section index); --chip-tan = printed/static; --warn = failure,
   blocked, unavailable — never "projected". */
```

**Anchor:** `grep -n "hero-chip--warn" site/index.html` → :107; `grep -n "chip-tan" site/css/style.css` → :532, :823.
**Effort XS · Impact M** (visible on every load; aligns hero with the band and with the law's own warn definition).
**Law check:** within — reuses `--chip-tan`, adds no hue. **Decision-with-default:** if the red chip was a ratified four-color scatter choice, reject this and instead re-point the band marker — but not both colors for one number.
**Test-safety:** no test pins `hero-chip--warn` (grep across site-tests: zero hits); theme.test (c) pairs untouched.

### P4 — Formalize the PAPER LADDER; collapse the `--ws-trust-*` duplicate trio; document the ink/footer split

**Evidence.** The paper family is already a multi-step system, but it is undocumented and carries one near-duplicate: `--ws-trust-bg #F4F0E4` vs `--paper-raised #F3EFE3` (`style.css:38` vs `:526`) — one RGB step apart, two names for one tint; `--ws-trust-border`/`--ws-trust-text` are straight aliases of `--line`/`--ink-soft` (`:39-40`). The ladder as shipped: **raised** `#F3EFE3` (cards) · **base** `#EDE9DC` (body) · **recess** `#E4DFD1` (panel heads) · **deep** `#E0D9C9` (code) + two roles (`--paper-pending`, `--ink-deep #E2DCCB` — the footer band, a paper value wearing an ink-era misnomer, `:591`). Separately the ink family is two measured hue steps: `--ink-soft #5C584C` (muted on paper) vs `--footer-muted #4E4939` / `--footer-faint #615C4C` (muted on the `#E2DCCB` footer — theme.test pins both, keep values). Answering the lens question directly: one cream is NOT enough — the ladder is right — but it must be legible or every future surface invents a new tint (and SKINS §2 must re-derive three tokens it could have inherited).

**Exact diffs:**

1. `:root` (`style.css:37-40`) — delete three aliases, keep the size token:

```css
  --ws-trust-size: clamp(36px, 4.5vw, 42px); /* trust-pill colors live on the ladder: bg=--paper-raised, border=--line, text=--ink-soft */
```

2. `.hero-fact` (`:236-237`) and `.hero-fact .k` (`:248`):

```css
  border: 1px solid var(--line);
  background: var(--paper-raised);
```
```css
  color: var(--ink-soft);
```

3. Documentation block at the top of the second `:root` (`:524`):

```css
  /* THE PAPER LADDER — one substrate family, four steps + two roles:
     raised --paper-raised (cards, +1) · base --paper (body) ·
     recess --paper-2 (panel/tab heads, −1) · deep --code-bg (code, −2).
     Roles: --paper-pending (pending scaffolding, between base and recess),
     --ink-deep (footer band surface; ink-era misnomer retained for history).
     INK FAMILY: --ink text · --ink-soft muted-on-paper · --footer-muted/-faint
     muted-on-footer (measured AA pairs, theme.test-pinned). New paper surfaces
     MUST pick a step, never a new hex. */
```

**Anchor:** `grep -n "ws-trust" site/css/style.css` → :37-40, :236, :237, :239, :248.
**Effort XS · Impact M** (kills a duplicate token, makes the system legible; directly shrinks SKINS §2's per-skin table).
**Law check:** within — values land on pinned tokens; `#F4F0E4` disappears (visually imperceptible, 1 RGB step).
**Test-safety:** `--ws-trust-*` values are NOT in the theme.test PALETTE; no banned hex introduced; `--ws-trust-size` survives (used at `:239`).

### P5 — Two-register hatch rhythm: 8px major / 4px micro

**Evidence.** Today every section boundary wears the IDENTICAL 8px 45° hatch (`.hero :186`, `section.block :263` — five in a row from `#vaults` to `#agents`), while the two sub-band boundaries (`.stat-band :902`, `.flow-figure :1107`) already run plain 2px rules. The result: the hero→page break — the one major compositional break — has the same weight as every repeat boundary. The rhythm exists by accident, not by design; formalize it into three registers: **8px hatch = major (hero)**, **4px micro-hatch = section breaks**, **2px rule = sub-band (data bands)**.

**Exact diff** (`site/css/style.css:263`):

```css
/* minor register: intra-page boundaries run a 4px micro-hatch (half stripe
   width; slice 4 = the border width) so the hero's 8px major hatch reads as
   the ONE major break. The plain 2px rules on .stat-band/.flow-figure stay
   the sub-band register (data bands, not section breaks). */
section.block { border-bottom: 4px solid transparent; border-image: repeating-linear-gradient(45deg, var(--line) 0 2px, transparent 2px 4px) 4; }
```

Optional dial (same commit, user-gated): major-register stripes deepen `var(--line)` → `var(--line-dotted)` in the `.hero` rule only, for a crisper major line — same tan family, existing token.
**Anchor:** `grep -n "repeating-linear-gradient" site/css/style.css` → :186, :263.
**Effort S · Impact M**.
**Law check:** within — same tokens, same 45° grammar, hierarchy not hue.
**Test-safety:** theme.test (g) `repeating-linear-gradient` ≥2 ✓ (stays 2), `45deg` ≥2 ✓; the 9-count of `border-bottom: 2px solid var(--line)` untouched (hatch borders are transparent). Footer doc F9's "keep the single hatch" page→footer decision respected (last section keeps its hatch).

### P6 — Border taxonomy: fix the one weight inversion (ticket rows out-weigh their frame), codify the registers

**Evidence.** The page runs a coherent de-facto taxonomy — 2px = structural/live-data surfaces (header rule, brand plate, vault-card, panel, hero-ledger + its rows, buttons, inputs, tabs, doc-pane); 1px = interior hairlines + tags (td/th `:419`, footer-grid `:469`, code `:115`, share-symbol `:291`, code-copy `:436`, mint-card-tag `:681`, inv-tag `:716`); dotted `--line-dotted` = ledger leaders (card-row `:293`, card-note `:302`, doc-toc `:429`, sim-region `:1248`); 6px/8px left = disclosure blocks (blockquote `:421`, apr-footnote `:314`, geo-disclosure `:482` frozen). ONE real defect: the mint ticket's frame is 1px (`.mint-card :674`) but its inherited rows are **2px** (`.ledger-row :645`) — the interior out-weighs the frame on the page's product card, and the ticket disagrees with its own section sibling (`.inv-card` is 1px frame + 1px rows `:699-704`, coherent). Default fix follows the Stratton grammar (the ticket is a PRINTED document → print register 1px/1px); the live ledger keeps 2px/2px (live instrument).

**Exact diff** (append after the `.mint-card` block, `:676`):

```css
/* print register: the mint ticket's rows join its 1px frame — the interior
   must never out-weigh the frame (the inherited .ledger-row is 2px). The live
   .hero-ledger stays 2px/2px: live instrument vs printed ticket. */
.mint-card .ledger-row { border-bottom: 1px solid var(--line); }
```

Plus a taxonomy comment above `.vault-card` (`:284`) codifying the five registers (2px live/structural · 1px hairline/tag · dotted leader · 6/8px-left disclosure · 8px border-image hatch).
**Anchor:** `grep -n "border: 1px solid var(--line)" site/css/style.css` → :674, :709 (mint-card, inv-card); `grep -n "border-bottom: 2px solid var(--line)" site/css/style.css` → the pinned 9 (do not add an occurrence — the new rule says `1px`).
**Effort XS · Impact M** (the product card reads right; the system becomes teachable).
**Law check:** within — weights only, no color change.
**Test-safety:** motion-polish.test.js pins mint-card *entrance delays* only; agent-first.test.js:201 pins the `.mint-card .ledger-k` mono rule (untouched); theme.test (g)'s 9-count untouched (new rule is 1px).

### P7 — Keeper fringes: measured kraft halo on the neutral-cream page (asset remap primary; CSS `lighten` experiment)

**Evidence.** SKINS §2b measured the design-kit keepers as generated on kraft/tan paper: the hand PNGs carry fringe tones `#DECBB1` / `#B2A896` — DARKER than `--paper #EDE9DC`, so on the shipped neutral cream they sit with a faint warm-halo mismatch around every cutout (hand-point over `.hero-ledger`'s `--paper-raised`, index.html:156; certificate inside every vault card). CSS **multiply** is the wrong tool here (the fringe is darker than the surface, so it would survive, darkened); the honest fix is the asset layer: a colormap remap re-tinting fringe entries to `--paper`/`--paper-raised` values (Pillow, local, zero regeneration — SKINS §3 already notes all 7 PNGs are 8-bit colormap files, making this mechanical).

**CSS experiment only if asset work is out of scope** (append to `.asset-point, .asset-magnify, .asset-press, .asset-certificate` rules, `:1386-1422`):

```css
  /* fringe experiment: lighten keeps the dark ink dither and drops the
     lighter-than-nothing kraft fringe onto the surface — verify the hands'
     light mids survive before adopting; the Pillow remap is the primary fix */
  mix-blend-mode: lighten;
```

**Anchor:** `grep -n "asset-point\|asset-magnify\|asset-press\|asset-certificate" site/css/style.css` → :1386-1422.
**Effort S (remap) / XS (experiment) · Impact S-M** (subtle on desktop; the hands sit on every vault card).
**Law check:** within — moving fringe pixels onto ratified paper values IS the law.
**Test-safety:** asset re-encode must preserve dimensions + transparency; agent-first.test.js:67-style asset pins check path/class, not bytes — verify with the asset list test run.

### P8 — Token-derived alphas: close the two color escape hatches (`::selection`, WOW-7 delta flashes) with `color-mix()`

**Evidence.** Two rgb literals freeze accent hues outside the token system: `::selection rgba(0,168,107,0.35)` (`:64`) and the WOW-7 flash keyframes `rgba(0,168,107,0.16)` / `rgba(163,58,36,0.16)` (`:1042/:1046`). SKINS §3.1-2 lists both as the escape hatches a skin swap would miss. `color-mix(in srgb, var(--accent) 35%, transparent)` derives them from the tokens, so any future re-value (and any future SKINS work) propagates. Baseline 2023 browsers; var() resolves inside @keyframes against the animating element.

**Exact diffs:**

```css
::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); color: var(--ink); }
```
```css
@keyframes ws-delta-up  { 0% { background-color: color-mix(in srgb, var(--accent) 16%, transparent); } 100% { background-color: transparent; } }
@keyframes ws-delta-down { 0% { background-color: color-mix(in srgb, var(--warn) 16%, transparent); } 100% { background-color: transparent; } }
```

**Anchor:** `grep -n "rgba(" site/css/style.css` → :64, :589-590 (shadows — token VALUES, leave), :1042, :1046.
**Effort S · Impact S** (infra hardening; no visual change).
**Law check:** within — identical rendered values today.
**Test-safety:** theme.test (d) bans the *leaving* families `rgba(46,194,126`/`rgba(224,101,74`/`rgba(255,255,255` — `rgba(0,168,107`/`rgba(163,58,36` are not banned, but removing them anyway breaks nothing; the shadows keep their exact pinned strings.

### P9 — (Taste-gated, likely reject) a deliberate grain token — included so the choice is on the record

**Evidence.** The ascetic law is FLAT: the page's only sanctioned texture after P1/P2 is the canyon dither. If the hero texture is ever retired, the counter-move — texture as a CHOICE, implemented in CSS, not image noise — is one token: an inline SVG `feTurbulence` data-URI (zero external origins, favicon precedent) at 2-3% opacity, `mix-blend-mode: multiply`, hero-only. **Default recommendation: do not ship it.** Flat paper is the voice; the canyon carries the texture budget; a body-wide grain would spend the ascetic register to imitate what the dither assets already do better. Recorded so the "texture as choice" lesson has its canonical counter-example.

**Sketch (NOT a ready diff):** `--grain: url("data:image/svg+xml,…feTurbulence baseFrequency='0.9'…")` applied as a `body::before` overlay at `opacity: 0.025`.
**Anchor:** insert after `::selection` (`:64`).
**Effort S · Impact L** · **Law check:** borderline — ink-family only, but adds a texture surface the law didn't ratify. **Test-safety:** data-URI passes the resource-gate (no host); verify against `resource-gate.test.js` before adopting.

---

## Verified non-findings (checked, left alone — recorded so they are not re-opened blindly)

1. **Tan family coherence** — `--chip-tan #D9CFB4` / `--line #C8C1AD` / `--line-dotted #AFA892` / `--code-bg #E0D9C9` form a clean four-step warm-neutral ramp with distinct roles. No merge.
2. **`--accent-hover #0FB879` direction** — fills brighten on hover (btn-primary `:354`) exactly as ink fills lighten (nav-cta `:165`); direction is consistent. Keep.
3. **ink-soft vs footer-muted hue split** — two slightly different warm hues (`#5C584C` vs `#4E4939`), but both are measured AA pairs on their own surfaces and theme.test-pinned. Keep (documented in P4).
4. **`--code-bg` vs `--ink-deep` proximity** (`#E0D9C9` vs `#E2DCCB`) — two steps apart, distinct roles (code surface vs footer band). Keep.
5. **cta-solid hover near-vanish** (`:371`, ink→paper-2 flip) — deliberate per the WS-LEDGER-STRUCTURE comment (`:355-361`); header lens (P3/P8 there) owns the CTA register.
6. **`#docs .index` in warn-red** (`:879`) — fits the codified map (docs = the risk/honesty section); becomes deliberate the moment P3's map comment lands.
7. **Section-index color trio** (accent-punch/ink/warn, `:877-879`) — heterogeneous but each maps to the section's semantic; keep under the map.

## Coordination & landing notes

- **SKINS doc:** P4 shrinks its per-skin tables (three `--ws-trust` rows → one alias note); P8 closes its §3 escape hatches 1-2; P1 changes the hero-substrate math a future dark skin must redo (multiply on dark = different compositing — noted there as asset work already).
- **Sequence:** P1 → screenshot gate → P2 (visual check together — both touch the hero backdrop stack); P3+P4 same wave (map comment + ladder); P5/P6/P7/P8 independent.
- **Every implementing wave:** run `node --test site-tests/` (zero new failure IDs vs baseline), re-pin theme.test (g) counts ONLY if a proposal changes them (none do as written), and take the hero screenshot at 1280 + 400 for the user gate.
- All proposals are CSS-first (P3 one HTML class token; P7 primary path is a mechanical asset remap). No deploys in-wave; push = user gate.
