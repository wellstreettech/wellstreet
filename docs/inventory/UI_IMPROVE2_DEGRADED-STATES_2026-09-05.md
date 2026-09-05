# UI Improvement Round 2 — Degraded & Empty States as Designed Moments (2026-09-05)

**Repo:** `/home/raivo/Documents/wellstreet` — worktree HEAD at read time: `048718f1f5e313942b73d361327064275afcfa91` (line numbers below refer to this tree; the task brief's `28208df` predates the canyon-hero/WS-PRODUCT-GAPS landings).
**Inputs:** `docs/inventory/FRONTEND_MAP_2026-09-04.md` (feature map, D8/honesty constraints), `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (ratified ascetic-degen grammar: paper/ink/serif/green, mono small-caps, ledger rows, black callouts).
**Lens:** the honesty law says degraded states tell the truth — the design question is whether they look **designed** or **neglected**. Every state below already tells the truth in copy; the gaps are in *staging, finality semantics, and the no-JS environment*.
**Zero site edits.** All diffs are proposals. Test-safety map at the end.

---

## Ranking summary

| # | Proposal | Effort | Impact | Design-law risk |
|---|----------|--------|--------|-----------------|
| 1 | Empty-vault tag + verified share-supply row | M | High (the live product state is invisible) | None — verified read |
| 2 | State-finality split: stop pulsing settled facts | S/M | High (core vocabulary fix) | None — stillness, no new claims |
| 3 | Noscript first paint as a designed plate | M | High (the honesty law's most degraded environment) | None — points at real files |
| 4 | Pause-state staging: warn tag + static no-pause guarantee tag | S | Med-high | None — verified-read-gated; guarantee is structural |
| 5 | APR baseline-fallback marker on band + chip | S/M | Med (most-quoted number hides its fallback) | None — additive label |
| 6 | Stat-band designed empty cells (`:empty` CSS) | S | Med | None — DOM stays `''` (test-pinned) |
| 7 | Coverage-cell verify line (static, state-independent) | S | Med | None — states a public view exists |
| 8 | Wallet-absent neutral state (`flag--info`) | S | Low-med | None |
| 9 | Jurisdiction banner print-craft | S | Low (dormant) | Gated by D14 byte-freeze |

---

## 1. The empty vault says nothing — give the deployed-empty state its verified sentence

**Moment today.** The vault is deployed and EMPTY (FRONTEND_MAP pending item #11; main.js:218-219 comment: "the deployed vault is empty; the empty card is its state"). The card's answer to emptiness is… a decorative certificate PNG at 0.9 opacity overlapping the rows (main.js:223-230, style.css:1413-1422). No surface — card, mint ticket, invariants, hero ledger — ever says "the vault is empty; no shares exist yet." A first-time reader sees live SPY prices, a pool, an APR projection, and "BACKED 100.0%" with no idea there are zero depositors. This is the *single most-seen state of the product* and it is currently staged as wallpaper, not as information.

**Fix.** Add one verified read (vault `totalSupply()` — the selector derivation already exists; `0n` = no shares minted = empty, isomorphic to the skill's pre-broadcast "returns empty" rule), and when it is `0n` render a designed empty register:

- `site/js/vault.js` — append next to `readPosition`:
  ```js
  // EMPTY-VAULT: the vault's own totalSupply() — 0n = no shares minted (the
  // empty state). Honest null on failed/undecodable read — never a claim.
  async function readVaultSupply(client, vaultAddr) {
    var raw = await ethCall(client, vaultAddr, root.WS.abi.selectorOf('totalSupply()'));
    return root.WS.abi.wordCount(raw) >= 1 ? root.WS.abi.decodeUint(raw, 0) : null;
  }
  ```
  (export on `WS.vault` alongside `readPosition`).
- `site/js/main.js` `loadVaultData` (~line 896, alongside the pause read):
  ```js
  var supplyP = WS.vault.readVaultSupply(client, vaultCfg.vault).catch(function () { return null; });
  ```
  then after the rows rebuild (~line 932):
  ```js
  var supply = await supplyP;
  if (supply !== null && supply !== undefined) {
    mounts.rows.appendChild(row('Shares outstanding',
      supply === 0n ? '0 — the vault is empty; the first deposit mints the first shares'
                    : fmtToken(supply)));
  } else {
    mounts.rows.appendChild(row('Shares outstanding', 'unavailable (RPC)'));
  }
  mounts.card.classList.toggle('vault-card--empty', supply === 0n);
  ```
- `site/css/style.css` (extend the WS-ASSET-WIRE block):
  ```css
  /* EMPTY-VAULT (2026-09-05): the certificate keeper stops being wallpaper when
     its state is real — the empty register gets the tag + full-strength keeper. */
  .vault-card--empty .asset-certificate { opacity: 1; }
  .card-empty-tag {
    position: absolute; top: var(--space-12); left: var(--space-14);
    font-family: var(--mono); font-size: var(--step-1); text-transform: uppercase;
    letter-spacing: 0.08em; color: var(--ink); border: 1px solid var(--line);
    background: var(--paper); padding: var(--space-2) var(--space-8); white-space: nowrap;
  }
  ```
  and in `renderCardShell` (main.js, after the `pending-tag` append at :213) add the tag element — written only when the supply read lands `0n` (so the class toggles it, or append there gated the same way).

**Anchors:** `grep -n "asset-certificate" site/js/main.js site/css/style.css` · `grep -n "readPosition" site/js/vault.js` · `grep -n "empty card is its state" site/js/main.js`.
**Effort/impact:** M (~1-2h + one battery addition; new eth_call rides the existing client/failover — D8-safe, same hosts). High: converts the site's dominant state from decorated silence into the ledger fact it is.
**Design-law check:** PASS — `totalSupply() == 0n` is a verified on-chain fact; read failure renders `unavailable (RPC)`, never the claim; when shares exist the tag and class vanish. No fabricated data, no optimistic spin ("empty" is stated as mechanism, not as opportunity).

---

## 2. Finality semantics: a settled "unavailable" must not pulse

**Moment today.** `.state` carries `animation: ws-state-pulse 1.8s … infinite` (style.css:446-455) — a "working" signal. But the hero ledger's degraded rows are *final facts*: `el('span', 'state', 'unavailable (RPC)')` at main.js:327, 340, 356. Under a total RPC outage the page's most prominent data panel renders three indefinitely-pulsing "unavailable" lines — the animation says *transient*, the words say *settled*. (The `computing…` APR placeholder at main.js:827 is correctly transient and keeps its pulse.) The ascetic move is: **finality = stillness**. The static skeleton spans in index.html:144-146 share the class — see Proposal 3 for the no-JS branch of the same lie.

**Fix.**
- `site/css/style.css` — append after the honest-states block (after :455):
  ```css
  /* WS-DEGRADED-STATES (2026-09-05): the pulse means "working". A settled
     degraded fact renders STILL — finality is quiet, never a fake progress
     signal. Voice unchanged (mono, --ink-soft); only the motion stops. */
  .state--final { animation: none !important; }
  ```
- `site/js/main.js` — add the modifier at exactly the three settled writes:
  - :327 `el('span', 'state state--final', 'unavailable (RPC)')` (SPY/WETH row)
  - :340 same (Pool TVL row)
  - :356 same (protocol-cut row)
  Leave `computing…` (main.js:827) and the static `connecting to public RPC…` skeletons pulsing — they are genuinely transient for JS users.

**Anchors:** `grep -n "'state', 'unavailable (RPC)'" site/js/main.js` · `grep -n "ws-state-pulse" site/css/style.css`.
**Effort/impact:** S/M (3 one-token edits + 1 CSS rule; render/render-degrade tests do not select `.state` — verified by grep over `site-tests/*.test.js`). High: the whole degraded vocabulary gains a coherent finality semantic.
**Design-law check:** PASS — pure motion change; the words are already truthful. Also fold here: `Preview unavailable (RPC).` (main.js:1350/1355/1361) and `Balance check failed (RPC): …` (main.js:1156-1159) already render static mono — they need no class; keep them as the quiet register this rule formalizes.

---

## 3. The noscript first paint is the honesty law's flagship — and it's the least-designed surface on the page

**Moment today.** With JavaScript off, a visitor gets: (a) a fine but unstyled `.noscript-note` paragraph (index.html:28-35, style.css:392); (b) three hero-ledger rows pulsing **"connecting to public RPC… forever"** — the `.state` pulse runs from CSS alone, and no JS will ever arrive: an indefinite animation on a claim that is false in this environment (index.html:144-146), plus the ledger-state chip's static "connecting to public RPC…" (index.html:136); (c) an **empty** `#vault-grid` (index.html:308 — zero-height void inside a full section); (d) an **empty** `#doc-pane` (index.html:472 — a 220px bordered void); (e) `—` placeholders in the stat band. The note says "nothing is hidden behind it" — the page below it then looks broken rather than candid. This is the one environment where the site cannot fall back on its own rendering, i.e. the purest test of the honesty aesthetic.

**Fix.** All-`<noscript>` + CSS — zero JS-path impact (noscript children are inert when scripting is on; the DOM-stub batteries never execute noscript content).

- `site/index.html` `<head>` (after the favicon link, :24):
  ```html
  <noscript><style>
    [data-skeleton] { display: none; }
    .stat-value { color: var(--ink-soft); }
    .vault-grid-empty, .doc-pane-empty { display: block; }
  </style></noscript>
  ```
- Ledger-state chip (:136) — skeleton + honest noscript twin:
  ```html
  <span class="hero-ledger-state" id="hero-ledger-state" aria-live="polite" data-skeleton>connecting to public RPC…</span><noscript><span class="hero-ledger-state">unavailable without JavaScript — every figure on this page is a public RPC call you can make yourself</span></noscript>
  ```
  (keep the `id` on the skeleton; main.js rewrites it wholesale at main.js:312-317 when JS runs).
- The three ledger rows (:144-146): same pattern — `data-skeleton` on each `<span class="state">connecting to public RPC…</span>`, plus a `<noscript><span class="state">unavailable without JavaScript</span></noscript>` sibling.
- `#vault-grid` (:308):
  ```html
  <noscript><div class="vault-grid-empty">The vault cards are rendered by your browser from live chain reads. Without JavaScript: the contracts are open source, and every figure is a public RPC call you can make yourself — the note above points at the docs.</div></noscript>
  ```
- `#doc-pane` (:472):
  ```html
  <noscript><div class="doc-pane-empty">The docs render locally in your browser. The raw markdown lives under /docs/public/ — the same files this pane reads.</div></noscript>
  ```
- `site/css/style.css` (near :392):
  ```css
  .vault-grid-empty, .doc-pane-empty { display: none; /* shown only by the <noscript> style block */ }
  .noscript-note { border: 2px solid var(--line); border-left-width: 8px; background: var(--paper-2); margin-top: var(--space-16); }
  .noscript-kicker { display: block; font-family: var(--mono); font-size: var(--step-1); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink); margin-bottom: var(--space-6); }
  ```
  and restructure the note (:29-34) with a kicker span — copy preserved nearly verbatim, split into `Live reads require JavaScript` (kicker) + the existing sentence body; optionally wrap `/docs/public/` in a real relative anchor `<a href="docs/public/">`.

**Anchors:** `grep -n "noscript" site/index.html` · `grep -n "connecting to public RPC" site/index.html` · `grep -n "noscript-note" site/css/style.css`.
**Effort/impact:** M (~1-2h, markup + CSS only; `resource-gate.test.js` scans for resource URLs — an inline `<style>` with no `url()` adds none; `render.test.js`'s stub never executes noscript content). High: the most degraded environment gets the same print-craft as the hero, and the forever-pulse lie dies.
**Design-law check:** PASS — the no-JS page stops *claiming* a connection it can never make; the replacements state absence and point at real artifacts (open-source contracts, `/docs/public/`). Nothing fabricated, nothing optimistic.

---

## 4. The pause state is a footnote; the never-pausable guarantee is invisible

**Moment today.** When a verified pause lands, `appendWidgetTruthRows` (main.js:1112-1123) appends one mono red line inside the `#widget-status` box (main.js:34 `PAUSE_ROW` — excellent copy, weak staging) and the deposit buttons dim with a hover-only `title` tooltip. Meanwhile the site's *strongest* structural flex — **redeems have no pause path; our own controls can never trap your funds** (stated in the block-sub, index.html:326-329) — has zero visual presence at the exact place a frightened holder looks: the Redeem panel. Truth asymmetry: the bad state is styled, the guarantee isn't.

**Fix.**
- `site/index.html` :333 — give the deposit panel head a hook: `<div class="panel-head" id="deposit-panel-head">`.
- `site/index.html` Redeem panel head (~:356) — a **static** structural tag (true always, not a state read):
  ```html
  <span class="panel-tag panel-tag--safe">exits: no pause path</span>
  ```
- `site/css/style.css` (pending-tag anatomy reuse, after :326):
  ```css
  /* WS-DEGRADED-STATES: panel-head state tags — same anatomy as .pending-tag. */
  .panel-tag { font-family: var(--mono); font-size: var(--step-1); text-transform: uppercase; letter-spacing: 0.08em; padding: var(--space-2) var(--space-8); border: 1px solid var(--line); background: var(--paper); white-space: nowrap; }
  .panel-tag--safe { color: var(--accent-text); border-color: var(--accent-text); }
  .panel-tag--warn { color: var(--warn); border-color: var(--warn); background: var(--warn-bg); }
  ```
- `site/js/main.js` `appendWidgetTruthRows` (:1115) — the dynamic half, verified-read-gated:
  ```js
  if (state.depositsPaused === true) {
    box.appendChild(el('div', 'flag flag-warn', PAUSE_ROW));
    var dh = $('deposit-panel-head');
    if (dh && !dh.querySelector('.panel-tag--warn')) { dh.appendChild(el('span', 'panel-tag panel-tag--warn', 'deposits paused')); }
  }
  ```

**Anchors:** `grep -n "PAUSE_ROW" site/js/main.js` · `grep -n "appendWidgetTruthRows" site/js/main.js` · `grep -n "panel-head" site/index.html` · `grep -n "pending-tag" site/css/style.css`.
**Effort/impact:** S (~30 min). Med-high: the pause becomes a staged panel moment and the no-pause guarantee gets permanent, always-true signage on the redeem side.
**Design-law check:** PASS — the warn tag renders ONLY on `depositsPaused === true` (unknown read → no tag, the existing fail-closed rule P1); the safe tag is protocol structure (no pause path exists in the design), not a state claim. `widget-pause.test.js` pins the PAUSE_ROW verbatim — untouched; no test pins panel-head children (verified by grep).

---

## 5. The APR fallback is labeled in a footnote but identical on the band — the most-quoted number hides its provenance

**Moment today.** When live sampling is unavailable, `deriveApr` publishes the phase-0 baseline through the same fan-out (main.js:1013-1019) — the card's APR row carries the long source label, but the surfaces people actually quote (`#stat-apr`, `chip-apr`, `#flow-yield`) show the identical `~X.X%` with only the static "projected" marker. A live-sample reading and a fallback reading are visually indistinguishable everywhere except a card footnote most visitors never open. The honesty law is met in text and lost in staging.

**Fix.** A sibling marker element (the `.stat-marker` text is strict-pinned `'projected'` in render-degrade.test.js:159 — never change it; add, don't edit):
- `site/index.html` — in the APR stat cell (after :230): `<span class="stat-baseline-note" id="stat-baseline-note" hidden>baseline</span>`; in the APR chip (after :107's suffix): `<span class="hero-chip-suffix" id="chip-baseline-note" hidden>baseline</span>`.
- `site/js/main.js` `publish()` (primary branch, ~:958):
  ```js
  var baselineNote = !apr.live ? true : false;   // set by the fallback path
  ```
  — concretely: pass a flag through `publish(apr, isBaseline)`; in the fallback call site (:1019) `publish(projBase, true)`; in the writer:
  ```js
  var bn = $('stat-baseline-note'); if (bn) { bn.hidden = !isBaseline; }
  var cb = $('chip-baseline-note'); if (cb) { cb.hidden = !isBaseline; }
  ```
- `site/css/style.css`: `.stat-baseline-note { font-family: var(--mono); font-size: var(--step-1, 0.6875rem); text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-soft, #5C584C); border: 1px solid var(--line, #C8C1AD); padding: 2px 8px; align-self: flex-start; }` (chip variant inherits `.hero-chip-suffix`).

**Anchors:** `grep -n "phase-0 measured baseline" site/js/main.js` · `grep -n "stat-marker" site/index.html site-tests/render-degrade.test.js` · `grep -n "chip-apr" site/index.html`.
**Effort/impact:** S/M. Med: provenance travels with the figure on every quoted surface, live-vs-fallback becomes legible at a glance.
**Design-law check:** PASS — the label states exactly what the code already states in the card row; hidden by default, shown only on the real fallback. `stat-apr` cell must NOT gain a tick/re-roll (already excluded from `TAPE_TICK_IDS`, main.js:559 — unchanged).

---

## 6. Stat-band degraded cells: a designed blank instead of a vanished number

**Moment today.** Under total RPC failure the two live cells' DOM stays `''` — the correctness pin (render-degrade.test.js:165: `''` not `0`, never fabricated). But visually a failed cycle *clears* the static `—` placeholders (main.js:420-421 writes `''`), leaving two blank holes in a four-cell band: the empty state reads as breakage, not as a statement. (The band is `aria-hidden` — the accessible truth lives in the ledger + summary line, main.js:136.)

**Fix.** CSS-only — the DOM string stays `''`, the visual gets the designed mark:
```css
/* WS-DEGRADED-STATES: a failed live read leaves the DOM '' (render-degrade pin:
   never 0-as-fake). The VISUAL empty is designed: a mono unavailable mark in
   the muted voice. Scoped to the two LIVE cells only — the split cell is a
   ratified constant filled at init (never empty past first paint) and the APR
   cell degrades to the labeled baseline (never empty). */
#stat-tvl:empty::after, #stat-price:empty::after {
  content: 'unavailable (RPC)';
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
  font-size: var(--step-6, 0.84375rem);
  font-weight: 400;
  letter-spacing: 0;
  color: var(--ink-soft, #5C584C);
}
```
First paint is safe: the static cells contain `—` (not `:empty`), so no flash before init.

**Anchors:** `grep -n "stat-value" site/css/style.css` (:927) · `grep -n "failedCoverage" site-tests/render-degrade.test.js` (:165).
**Effort/impact:** S (one CSS rule). Med: the band's failure mode moves from "broken" to "the same designed unavailable voice as the ledger".
**Design-law check:** PASS — the pinned honesty invariant (DOM `''`) is preserved byte-for-byte; the visible mark is true (the read did fail); decorative duplicate surface only.

---

## 7. The BACKED cell's verify-yourself promise vanishes exactly when it matters most

**Moment today.** The mint-ticket BACKED cell and `#inv-stat` carry a long first-paint sentence that teaches the verify path ("…verify it yourself with any RPC client", index.html:170/447). On any failure, `fillBackingCoverage` (main.js:849-862) overwrites it with the terse `'unavailable (RPC)'` — and the verify instruction is gone precisely during the state where a skeptical reader would want it. The degrade string is **strict-pinned** (render-degrade.test.js:164-171) — do not change the string.

**Fix.** Make the instruction a static, state-independent line under the mint-card BACKED row (never overwritten, because main.js never touches it):
- `site/index.html` (after :170's ledger-row, inside `.mint-card`):
  ```html
  <p class="mint-card-verify">The BACKED figure is the vault's own <code>backingCoverage()</code> view — one public eth_call, decodable by any RPC client; the invariants card below carries the same seam.</p>
  ```
- `site/css/style.css`: `.mint-card-verify { margin: 0 var(--space-12); padding: 0 var(--space-2) var(--space-10); font-family: var(--mono); font-size: var(--step-1); color: var(--ink-soft); }`.

**Anchors:** `grep -n "mint-backed" site/index.html site/js/main.js` · `grep -n "PENDING_COVERAGE_TEXT" site/js/main.js` (:847).
**Effort/impact:** S. Med: the check-it-yourself promise survives every state, matching the docs' "written to be checked" voice.
**Design-law check:** PASS — the sentence states only what exists (a public view + the one-seam duplication already documented in the map). Cell strings untouched → pins intact.

---

## 8. Wallet-absent: style the read-only state as the feature it is

**Moment today.** `renderWidgetState` (main.js:1099) writes "Not connected — connect a wallet to interact. Reads above still work without one." as a bare `.flag` line — same anatomy as the warn states one hue away. The second half of that sentence is a real differentiator (the whole page works walletless, D8) rendered with the same visual weight as any other status line, and `#wallet-balances` below it is an unstyled empty div.

**Fix.** Minimal, copy-preserving:
- `site/js/main.js` :1099 — third arg on `widgetStatus(text, warn, cls)`; call with `'flag--info'` (the non-warn branch already passes `false`).
- `site/css/style.css`: `#widget-status .flag--info { color: var(--ink-soft); } #widget-status .flag-warn { color: var(--warn); }` — neutral reads muted, warnings read red; the box's two moods become legible at a glance.

**Anchors:** `grep -n "Not connected" site/js/main.js` (:1099) · `grep -n "widgetStatus(" site/js/main.js`.
**Effort/impact:** S (~15 min). Low-med: consistency pass; the walletless capability stays stated in copy, now with a distinct quiet register.
**Design-law check:** PASS — no copy change, no new claim; pure state-color semantics.

---

## 9. Jurisdiction banner print-craft — GATED on the D14 byte-freeze

**Moment today.** `.jurisdiction-banner` (index.html:41-46, style.css:170-177) is honest and readable: warn border + `--warn-bg`, body line + mono disclosure block. It is **dormant** (unhidden only on mirrors, geo.js:128-135) and — per FRONTEND_MAP pending item #10 — the geo surfaces are **byte-frozen by decision D14**: "retained-but-unwired … not dead code to edit without a decision."

**Fix (only if the freeze is lifted by an explicit decision):** add a mono kicker ("Jurisdiction notice" is currently body-lead text — promote it to the `.hero-ledger-title` register) and give the wrap the `.apr-footnote` left-rule anatomy (`border-left-width: 8px` vocabulary). No copy changes; the F19 disclosure injection point (`[data-geo-disclosure]`) is untouched.

**Anchors:** `grep -n "ws-jurisdiction-banner" site/index.html` · `grep -n "jurisdiction-banner" site/css/style.css` · DECISIONS_2026-08-30 (D13/D14).
**Effort/impact:** S. Low (dormant surface). **Design-law check:** PASS on styling, but the governing law here is process — D14 freeze outranks taste; listed last and gated for that reason.

---

## Test-safety map (what each proposal must not break)

| Pin | File:line | Proposals constrained |
|-----|-----------|----------------------|
| `mint-backed`/`inv-stat` degrade string strictEqual `'unavailable (RPC)'` | site-tests/render-degrade.test.js:164-171 | 7 (string untouchable → static sibling line instead) |
| stat-tvl / stat-price stay `''` on total RPC failure | site-tests/render-degrade.test.js (~:150s) | 6 (CSS `:empty::after` keeps DOM `''`) |
| `.stat-marker` textContent strictEqual `'projected'` | site-tests/render-degrade.test.js:159 | 5 (add sibling `<span hidden>`, never edit the marker) |
| PAUSE_ROW verbatim in `#widget-status`; redeem buttons enabled under pause | site-tests/widget-pause.test.js | 4 (additions only) |
| LAUNCH_FACT literals quoted exactly once in main.js; pending sentence never ships statically (Branch B) | site-tests/wow.test.js:182-252 | 1, 4 (do not re-quote launch-fact strings anywhere) |
| Pending-card variant + honest pending status row | site-tests/render.test.js:619-627 | 1 (pending path untouched; empty tag rides the supply read, not the isDeployed seam) |
| Resource-host allowlist | site-tests/resource-gate.test.js | 3 (inline `<noscript><style>` adds zero resource URLs) |
| `.state` class selectors | none found in site-tests/*.test.js (grepped) | 2 (modifier-class additions safe) |

## Cross-cutting design-law statement

Every proposal obeys the three laws: **truthful always** (each new visual states a verified fact — `totalSupply()==0n`, `depositsPaused===true`, a failed read, a structural no-pause-path), **no fabricated data** (every degrade still renders absence, never a placeholder number; the `''` and `'unavailable (RPC)'` pins survive byte-for-byte), **no false-optimistic spin** (the empty state and the pause are staged as facts in the ascetic register — stillness, mono, borders — never as marketing; the one green tag in Proposal 4 marks a *structural guarantee*, not a performance).
