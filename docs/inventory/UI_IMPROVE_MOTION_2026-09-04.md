# UI Improvement — Motion & Micro-Interaction Map (2026-09-04)

**Repo:** `/home/raivo/Documents/wellstreet` · branch `main` · HEAD `2cf5fc9` ("improvement batch from frontend map"). **Worktree caveat:** `site/index.html` (MM) and `site/js/main.js` (M) carry live sibling-session deltas; `site/css/style.css` is clean at HEAD. All `file:line` citations below are the **worktree** read on 2026-09-04 — a dispatching wave must re-verify anchors at dispatch time (DISPATCH-TIME STATE UPDATE discipline).

**Method:** analysis-only. Full read of `site/css/style.css` (1,397 ln), `site/js/main.js` (1,445 ln), `site/index.html` (575 ln), `site/js/docs.js` (tab/copy paths), plus the asset inventory (`site/img/`, `site/img/compressed/`, `docs/internal/design-kit/`). Binding inputs: `docs/inventory/FRONTEND_MAP_2026-09-04.md` + `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (MOTION MENU section). Zero code edits, zero commits.

**Hard constraints honored by every proposal:** transform/opacity-only (compositor; the one sanctioned exception inside the shipped vocabulary is `stroke-dashoffset` + small-element `background-color`, both already used by the WOW batch — see §0), a `prefers-reduced-motion` static pair in the same change, no new dependencies, no mp4/lottie, page-weight `du ≤ +50KB` total (site is currently 719,847B; `site/img` 257,111B).

---

## 0. Shipped motion inventory (what exists — proposals do not duplicate it)

Timing system: `--t-fast 120ms / --t-base 200ms / --t-slow 320ms`, `--ease-enter` expo-out `cubic-bezier(0.16,1,0.3,1)`, `--ease-loop` symmetric (style.css:31-36). Accepted vocabulary note: "transform / opacity / stroke-dashoffset / background-color on small elements" (style.css:940-943).

| Motion | Where | Anchor |
|---|---|---|
| Nav link hover (border rule), nav-cta fill | header | style.css:123-124, 128-137 |
| Button/CTA/tab/copy hovers (fill swaps) | widget + docs | style.css:308-311, 328, 337, 359, 394 |
| Card/panel hover (box-shadow lift) | vault grid, panels | style.css:242-243, 288-289 |
| Hero chips: enter + float + hover lift | hero | style.css:744-762, 805-812 |
| Count-up reveal (IO+rAF, once) | stat band | main.js:422-524; style.css:852-909 |
| Tape ticks ▲▼– + band settle (WOW-1) | stat band | main.js:536-572; style.css:962-981 |
| Ledger-row delta flash + ▲▼ (WOW-7) | hero ledger | main.js:585-608; style.css:990-1011 |
| Stamp heartbeat / dim; connecting pulse | vaults head + ledger chip | main.js:610-617; style.css:1012-1023 |
| Ledger stamp "✓ read" fade (WOW-8) | hero ledger | main.js:306, 321, 337, 636-643; style.css:1030-1042 |
| Flow dash-flow, 3-rate buckets (WOW-2) | flow figure | main.js:649-662; style.css:1071-1087 |
| Sim dilution bar scaleX (WOW-6) | sim | main.js:744-760; style.css:1220-1229 |
| Scroll reveal primitive + hero-ledger cascade + flow-node stagger (WOW-5) | page | main.js:1273-1305; style.css:929-934, 1239-1261 |
| Launch-flip one-time beat (WOW-3) | 4 regions | main.js:701-725; style.css:1270-1280 |
| Press-hand dip on deposit hover/focus | widget | style.css:1364-1370 |
| Magnify sweep per refresh cycle | docs head | main.js:98-102, 626-633; style.css:1374, 1381-1385 |
| Curve divider draw-on | divider | main.js:1314-1330; style.css:1377-1379 |
| Shared JS motion gate `motionAllowed()` | — | main.js:575-583 |
| Reduced-motion guards (global + scoped) | — | style.css:462-469, 693-698, 816-823, 1287-1305, 1386-1390 |

**Census negatives (verified by grep):** zero `:active` pseudo-states anywhere in style.css; no `scroll-behavior` anywhere in `site/`; no focus-motion beyond the static `outline-color` accent (style.css:86-87).

**MOTION MENU status:** press-hand dip ✅ shipped · magnify sweep ✅ shipped · curve draw-on ✅ shipped · thumbs-up tx bounce = planned-but-UNSHIPPED (logo system not yet wired; tracked in the reference doc §SITE LOGO WIRING). Not re-proposed here — proposals below go **beyond** the menu.

---

## 1. Ranked proposals

### 1. Tactile press — a universal `:active` affordance (the whole interactive set has zero pressed states)
- **Anchor:** style.css:301-309 (`button.btn`), 320-337 (`.cta-solid`/`.cta-outline`), 128-137 (`a.nav-cta`), 350-359 (`.doc-tab`), 388-394 (`.code-copy`); wallet-picker buttons (`button.picker-btn`, main.js:1100-1105) inherit `button.btn`.
- **Motion:** on `:active:not(:disabled)` — `transform: translateY(1px)` on pill actions + `scale(0.985)` on the two big CTAs; duration `--t-fast` (120ms) on press, `--t-base` (200ms) `--ease-enter` on release. Pure CSS, one shared rule block; no JS. Disabled controls excluded (`:disabled` keeps `cursor: not-allowed`, style.css:309).
- **Why the print aesthetic:** the site's whole voice is physical paper — ink plates, stamped reads, pressed hands. A button that gives zero acknowledgment until the click registers reads like glass, not paper. The press-hand keeper already dips beside DEPOSIT (style.css:1369-1370); the button itself staying rigid breaks the pairing.
- **Reuses:** existing timing tokens only. The press-hand dip pairs with it for free (same trigger surface).
- **Effort:** S · **Impact:** 5 · **Bytes:** ~0.4KB CSS.
- **Reduced-motion pair:** the global guard (style.css:464-469) already nullifies transitions; restate `transform: none` for the `:active` rules in the same scoped block belt-and-braces.

### 2. Hero entrance choreography — the eye-order sequence (headline → CTA → ledger cascade → facts)
- **Anchor:** index.html:104-183 (hero stack: h1 :105, verification line :109, CTA row :110-113, ledger :125-148, facts :164-181); main.js:1273-1305 (`initReveal` — the arming precedent), 1288-1291 (hero-ledger rows cascade); style.css:1239-1249 (existing row stagger tokens).
- **Motion (first load only):** JS arms `.ws-entrance` on the hero `.wrap`'s direct children (armed-only — no-JS never hides content, same discipline as `initReveal`, main.js:1276-1284). One-shot keyframes (opacity 0→1 + `translateY(10px)`→0, `--t-slow` 320ms `--ease-enter`, `backwards` fill): h1 @0ms → verification line @80ms → CTA row @160ms → ledger card @240ms (its rows keep the existing 70ms cascade, style.css:1245-1248, so the card lands then the rows settle) → hero-facts @320ms → chain badge @400ms. Total ≤720ms. The chips' own schedule (60-460ms, style.css:779-803) is untouched and overlaps by design. The animation+`backwards` form (not transition-delay) avoids delaying the elements' other transitions — same pattern as `ws-hero-chip-in` (style.css:745-747, 809-812).
- **Why:** the lens's entrance-hierarchy item. Today everything except chips and ledger rows appears at once; the ratified draft composition reads top-down (serif claim → proof → machine), and motion should re-tell that order once. The "checkable" reading order IS the hierarchy: claim first, live ledger second, trust row last.
- **Reuses:** `initReveal` arming + the stagger-token pattern; no new infrastructure.
- **Effort:** S/M · **Impact:** 4 · **Bytes:** ~0.8KB CSS + ~15 lines JS.
- **Reduced-motion pair:** extend the scoped block (style.css:1287-1305) with `.ws-entrance` → `animation: none; opacity: 1; transform: none`; JS arming also checks `motionAllowed()` (main.js:575-583) and skips adding the class entirely (double guard, `statsCanAnimate` precedent main.js:429-438).

### 3. Scrollspy sliding "ledger rule" — the active-anchor underline becomes a moving 2px bar
- **Anchor:** style.css:122-138 (`.site-nav a` border-bottom + `.active`), main.js:1240-1263 (`initScrollSpy` — the single writer of `.active`).
- **Motion:** an absolutely-positioned 2px bar at the nav's bottom edge (inside `.site-header`, z-index above the paper). On each scrollspy activation, JS measures the active anchor's `offsetLeft/offsetWidth` once and writes `transform: translateX(<left>px) scaleX(<w/refW>)` — never `left/width` (compositor). Duration `--t-base` 200ms `--ease-enter`; `transform-origin: left`. Hidden ≤640px (nav reflows to a stacked strip, style.css:443-460) and re-measured on `resize` (debounced). The per-anchor `border-bottom-color` hover (style.css:124) stays — the bar is the *section* position, the hairline is the *hover* position; they don't fight.
- **Why:** the nav is a ledger index; a rule that physically slides between entries reads as a margin-line moving down a page of accounts. Also the only remaining "state-change" gap in the header: `.active` currently teleports.
- **Reuses:** the existing scrollspy IO (main.js:1244-1262) is the only trigger; no second observer.
- **Effort:** S · **Impact:** 3 · **Bytes:** ~0.6KB CSS + ~20 lines JS.
- **Reduced-motion pair:** `transition: none` in the scoped block — the bar jumps (state change preserved, motion dropped).
- **User-gate sub-item (deviation flag):** `@media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }` would make the nav jumps + TOC deep links glide instead of snap (scroll-margin already handles the 68px header, style.css:225-226). This is the ONE proposal outside the transform/opacity vocabulary — scroll is not compositor-animated. Include only if the constraint gate permits; cut cleanly otherwise.

### 4. Sequential verification pass — stagger the ledger stamps (the cadence becomes a line-by-line check)
- **Anchor:** style.css:1030-1042 (`.ledger-v.ledger-stamp::after` + `ws-stamp-fade`); trigger sites main.js:306 (`slot0`), 321 (`balances`), 337 (`slot0`).
- **Motion:** today all three stamps fire in the same `renderLedger` pass and fade simultaneously every 60s. Add per-row `animation-delay` on the `::after`: row 1 @0ms, row 2 @140ms, row 3 @280ms via `.hero-ledger-rows .ledger-row:nth-child(n) .ledger-stamp::after`. The 900ms fade keyframe is unchanged; the page then reads *slot0 verified → balances verified → cut verified* as a 3-beat pass (~420ms spread). Rows are rebuilt each cycle (main.js:295 `rowsBox.textContent = ''`), so the stagger replays on every refresh with zero JS change.
- **Why:** "Checkable, not sellable" is the brand; the check should be *watchable*. A simultaneous triple-stamp reads as an ornament; a sequential pass reads as an audit line walking down the ledger. Cheapest honesty amplifier on the page.
- **Reuses:** pure CSS on the shipped WOW-8 stamp; the reduce block already keeps `.ledger-stamp::after` visible statically (style.css:1293, 1302) — delays are moot under `animation: none`.
- **Effort:** S · **Impact:** 3 · **Bytes:** ~0.3KB CSS.
- **Reduced-motion pair:** already exists in the shipped scoped guard — no new block needed; verify it covers the delayed selectors.

### 5. Family-grid reveal stagger + section lead/follow (scroll choreography between sections)
- **Anchor:** main.js:1391-1399 (card render loop — where a per-card index is set), 178-213 (`renderCardShell`); style.css:241 (`#vault-grid` auto-fit grid — built for multiple cards), 929-934 (`.ws-reveal`); thresholds today: 0.15 heads/panels (main.js:1301), 0.25 stats/curve (main.js:522, 1326).
- **Motion:** (a) each card gets `--card-i` (its index, set once at render) and — because a plain `transition-delay` would also delay the hover box-shadow (style.css:242) — the card reveal becomes a one-shot animation with `animation-delay: calc(var(--card-i) * 90ms)` + `backwards` fill (chip-in pattern, style.css:745-747). Two cards entering a row reveal 90ms apart instead of popping together. (b) Lead/follow: within each section, the `.block-head` keeps its own IO reveal; the section's `.block-sub` and content block get a +80ms/+160ms follow delay (same animation form) so a section always resolves head → sub → content. No threshold changes: 0.15 for content, 0.25 kept for the count-up band so numbers never fire off-screen.
- **Why:** the vault family grid is the designed growth path (WS-VAULT-FAMILY-GRID, main.js:142-153); with one card the stagger is invisible, with RBLX/USDG the simultaneous pop will read cheap. Sequencing head-before-content is how print spreads read.
- **Reuses:** `initReveal` IO (one observer, class-only changes); no new observers.
- **Effort:** S/M · **Impact:** 3 · **Bytes:** ~0.7KB CSS + ~8 lines JS.
- **Reduced-motion pair:** scoped-block extension mirroring proposal 2 (`animation: none; opacity: 1; transform: none`).

### 6. Chain-pulse extended to the flow diagram — its live cells flash when their quantity moves
- **Anchor:** index.html:252-270 (flow nodes are STATIC markup — `#flow-pool-tvl` :260, `#flow-cut` :261, `#flow-yield` :268); main.js:664-673 (`setFlowPool` — the writer), 341-345 (`applyLedgerDeltas` call site — the diff already exists), 592-608 (the diff machinery); style.css:990-999 (delta keyframes), 1287-1305 (scoped reduce block).
- **Motion:** when the ledger's `tvl`/`cut` diff fires, the pool node (and the cut sub-line) gets the same one-beat `delta-up`/`delta-down` background flash — new rules `.flow-node.delta-up { animation: ws-delta-up 600ms var(--ease-loop) 1; }` (+ `--down`), reusing the EXISTING keyframes. Because flow nodes are static (not rebuilt like ledger rows), replay needs the remove → 30ms re-add pattern (`pulseStamp`, main.js:610-617). First render never flashes (`prevLedgerSnap === null` guard already upstream, main.js:595-596). `#flow-yield` is excluded forever — it is the published projection; a tick would imply a live reading (the `TAPE_TICK_IDS` discipline, main.js:450-458, 536).
- **Why:** the flow figure is WOW-2's showpiece but is motion-mute about its own data — the ledger rows flash while the diagram showing the *same* numbers sits still, a visible inconsistency in the "page breathes with the chain" story. Slice-safety: all touched code sits ABOVE the WOW-6 SIM BEGIN marker (main.js:727) that `wow.test.js` polices.
- **Reuses:** `applyLedgerDeltas` diff, `ws-delta-*` keyframes, `pulseStamp` re-trigger pattern.
- **Effort:** M · **Impact:** 3 · **Bytes:** ~0.5KB CSS + ~25 lines JS.
- **Reduced-motion pair:** add the two new selectors to the existing scoped block (style.css:1287-1305).

### 7. Certificate seal-stamp — the keeper presses onto the card when `backingCoverage()` actually lands
- **Anchor:** index.html:147 (point hand — deliberately static, do NOT touch), 341 (press), main.js:200-207 (certificate img appended by `renderCardShell`), 810-823 (`fillBackingCoverage` — the single seam writing `#mint-backed` + `#inv-stat`); style.css:1348-1357 (`.asset-certificate`).
- **Motion:** only when a real measurement lands (`pct !== null` — the success branch of `writeAll`), the certificate plays one seal-press: `scale(1.07) rotate(-2.5deg)` → `scale(1) rotate(0)`, 420ms `--ease-enter`, `transform-origin: top right`, one-shot class `.asset-seal` (remove/re-add on later cycles, `sweepMagnifier` pattern main.js:626-633, gated by `motionAllowed()`). `unavailable (RPC)` and the pending text never seal — the seal certifies a verified read, exactly as `stampRow` only fires on data rows (main.js:306/321/337).
- **Why:** the certificate is the "one share" object sitting on the card whose headline fact is the live coverage figure; sealing it at the moment the measurement verifies ties the decoration to the data instead of floating free. Dither-asset motion that stays honest.
- **Reuses:** `motionAllowed()` gate, sweep re-trigger pattern, zero new assets.
- **Effort:** S · **Impact:** 3 · **Bytes:** ~0.4KB CSS + ~12 lines JS.
- **Reduced-motion pair:** `.asset-certificate` added to a scoped `animation: none` line (the no-preference gating + reduce-block double form used by the other keepers, style.css:1364-1390).

### 8. Stop-motion frame-flip kit — press hand gets 3 poses (the degen option, scoped to the two hands that earn it)
- **Anchor:** current asset `site/img/compressed/hand-press.png` (4,721B); wiring style.css:1340-1347, 1364-1370; trigger `#btn-deposit` hover/focus (index.html:335-341). Pose family source: `docs/internal/design-kit/` (generation consistency rule: same style suffix + paper background, reference doc §ASSET SET).
- **Motion:** replace the single-img dip with a 3-frame stack (raised → half → pressed) cross-faded by `steps(1)` opacity keyframes on stacked `<img>`s (compositor-safe; no `background-image` swapping). Hover = raised→half (~240ms); `:active` = holds the pressed frame while the button itself does proposal 1's 1px dip; release reverses. Secondary (optional, cut first over budget): magnify hand 2-frame (level/swept) enriching the existing 900ms sweep, ~8KB.
- **Which assets deserve variants (lens question):** press (yes — it is the only hand bound to a *press* gesture, and the gesture has three physical states) and magnify (weak yes — the sweep reads fine as transform, frames are gravy). Point: NO — declared static by ratified comment (index.html:145-146). Certificate: NO — proposal 7 covers it transform-only. Thumbs-up: already-planned menu item, not re-proposed. Curve: draw-on shipped.
- **Why:** the MOTION MENU's "hand-cranked zoetrope" is the single most degen-native move available and the dither halftone style is *made* of discrete frames — a smooth transform on a halftone cutout is a small style lie; a 3-frame flip is true to the medium.
- **Reuses:** existing trigger surface (hover/focus/active selectors, style.css:1369-1370); no JS if hover/active-only (CSS `steps()`); ~10KB for the 2 new compressed frames.
- **Effort:** M (asset generation + wiring) · **Impact:** 3 · **Bytes:** ~10KB (+8KB optional) — the only byte-heavy proposal; budget rollup in §3.
- **Reduced-motion pair:** the stack renders frame 1 only (`animation: none; frame 2/3 opacity: 0`) inside the no-preference/reduce double guard (style.css:1364, 1386-1390 pattern).

### 9. Motif ink-grid draw-on — the hero's quarter-turn strokes lay themselves down once
- **Anchor:** index.html:72-84 (motif SVG, aria-hidden; two stroked paths :79-80); vocabulary sanction style.css:940-943 (`stroke-dashoffset` accepted), precedent `ws-flow` (style.css:1085-1087).
- **Motion:** `pathLength="1"` on both paths + `stroke-dasharray: 1; stroke-dashoffset: 1 → 0` keyframes, 900ms `--ease-enter`, delay 600ms (after proposal 2's entrance reaches the ledger), one-shot on load. CSS-only with a `prefers-reduced-motion: no-preference` gate (decorative-animation precedent: the chips animate without JS arming, style.css:745).
- **Why:** the motif is the og.png visual language drawn as ink paths; drawing them once at load is the "ink laid down" feeling the curve divider already sells (style.css:1375-1379) applied to the hero itself. Zero requests, zero bytes beyond CSS.
- **Reuses:** curve-divider vocabulary; nothing new.
- **Effort:** S · **Impact:** 2 · **Bytes:** ~0.3KB CSS.
- **Reduced-motion pair:** no-preference gate = reduced users get the static full strokes by construction; restate in the reduce block (style.css:1386-1390 block family).

### 10. Honest-state micro-pack — the wallet-waiting pulse + the `copied` pop
- **Anchor:** main.js:980-985 (`widgetStatus`), 1133 ("sent — waiting for confirmation…"), 1164/1171/1178/1185 ("Waiting for wallet confirmation…"); docs.js:303-311 (`code-copy` flips to `copied` for 1,200ms); style.css:399-408 (`.state` + `ws-state-pulse` — ALREADY EXISTS).
- **Motion:** (a) pending wallet statuses get the existing `.state` pulse class (opacity 1→0.55→1, 1.8s loop) — zero new CSS, the honest-states component already defines the vocabulary and the docs pane's `aria-busy` uses it (style.css:399); terminal states (confirmed/reverted) render still. (b) `code-copy` gets a one-shot `scale(1→1.05→1)` pop (240ms `--ease-enter`) at the moment the label flips to `copied`.
- **Why:** the money path's longest dead air is the wallet-confirm wait — the page goes silent exactly when the user is anxious; a breathing status is the shipped honest-state answer. The copy pop mirrors the stamp beat in miniature (verification acknowledged).
- **Reuses:** existing `ws-state-pulse`; one new 3-step keyframe.
- **Effort:** S · **Impact:** 2 · **Bytes:** ~0.3KB CSS + ~6 lines JS.
- **Reduced-motion pair:** global guard covers the pulse; the pop gets a scoped `animation: none` line.

### 11. Ledger-row hover verification tint — the row you are checking is "held"
- **Anchor:** style.css:593-603 (`.ledger-row` anatomy — non-interactive data rows); background-color vocabulary sanction style.css:990-999 (delta flash already animates this exact property on these exact rows).
- **Motion:** `.hero-ledger .ledger-row:hover { background: var(--paper-2); }` with a 120ms `--t-fast` background-color transition. No pointer cursor, no click affordance (rows are not links — this is inspection feel, not fake interactivity). Mint-ticket rows inherit if desired (same class).
- **Why:** on a page whose thesis is "read the ledger," the reading finger should get feedback. It is the same tint the delta flash uses, so a hovered row and a just-changed row share one visual grammar.
- **Reuses:** tokens only.
- **Effort:** S · **Impact:** 2 · **Bytes:** ~0.2KB CSS.
- **Reduced-motion pair:** global guard nullifies the transition; the tint itself is a state, not motion — it can stay.

---

## 2. Considered and rejected (lens coverage)

- **Hatch-separator crawl** (animating the 45° border-image hatch between sections): `border-image`/`background-position` have no compositor path — would violate the transform/opacity constraint on a full-width band. Rejected.
- **Chip value ticks** (▲▼ on `chip-price`/`chip-tvl`): duplicates the tape's tick job on a decorative aria-hidden surface — violates depth-not-duplication (WOW batch charter, style.css:945-947). The tape owns deltas.
- **Vault-card row ticks** (flashing every card row each 60s cycle): cards are the raw-read archive; 6 rows × N cards flashing per minute reads as noise, and rows are rebuilt wholesale (main.js:880) so a diff would be new machinery for low signal. Rejected (flow nodes in proposal 6 are the right surface — few, shared, already diffed).
- **Pending-tag blink** on pending cards: over-signals an honest static state; the designed pending card (style.css:277-284) already reads as intentional scaffolding, and pulsing it would imply activity where there is none.
- **Card-internal launch-flip choreography** (pending-tag peel / dashed→solid): the WOW-3 region flip (style.css:1270-1276) already carries the beat; `border-style` cannot animate and micro-choreographing a once-per-session event that has never fired is speculative polish. Deferred until launch.
- **Docs active-tab slide indicator**: the tabs sit on a shared 2px border with per-tab fills (style.css:350-359); an indicator would need measurement JS for a surface the `:active` press (proposal 1) already covers. Cut for budget.
- **Smooth scroll**: folded into proposal 3 as a flagged user-gate sub-item rather than a standalone proposal (constraint deviation, disclosed there).

## 3. Page-weight rollup (budget `du ≤ +50KB`)

| Proposal | Bytes |
|---|---|
| 1, 2, 3, 4, 5, 6, 7, 9, 10, 11 (CSS+JS only) | ~5KB total |
| 8 press frames (2 × compressed PNG) | ~10KB |
| 8 optional magnify frame | ~8KB (cut first) |
| **Worst case** | **~23KB** — under half the gate |

All new files are same-origin relative under `site/img/compressed/` (resource-gate checks hosts, not file existence — no allowlist change); no new element IDs (class-based only) so the render.test.js static-ID registry is untouched; proposal 6 keeps all code above the WOW-6 SIM BEGIN marker (main.js:727) that `wow.test.js` polices. Every JS-gated effect goes through the shared `motionAllowed()` gate (main.js:575-583); every CSS animation ships its scoped reduced-motion pair in the same change.

**Suggested cut line if the wave wants a smaller batch:** proposals 1 + 2 + 4 + 7 (S-effort, ~2KB, cover tactile / entrance / cadence / data-honesty) — the frame-flip kit (8) is the one to defer, not the one to lead with.
