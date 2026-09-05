# UI Improvement Round 2 — The Money Surfaces (2026-09-05)

**Repo:** `/home/raivo/Documents/wellstreet` — analysis only, **zero site edits**. Task brief HEAD `28208df`; sibling round-2 docs read the worktree at `048718f` (canyon-hero + WS-PRODUCT-GAPS landed on top). All `file:line` citations below are from a full read of `site/index.html` (591 ln), `site/css/style.css` (1,511 ln), `site/js/main.js` (1,639 ln) **this session** — re-grep anchors before implementing.

**Inputs:** `docs/inventory/FRONTEND_MAP_2026-09-04.md` (surface map, D8/honesty constraints, COEXISTENCE PIN) + `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (ratified grammar: paper/ink/serif/green, ONE hot accent, mono small-cap label rows with bold right-aligned values, black-box fine print, "LIVE ONCHAIN" green tag).

**Lens:** where money moves — the LIVE LEDGER, the Stratton-grammar mint ticket, the deposit/redeem widget (inputs, buttons, pause state, position line), the floating chips. The design law these surfaces already obey: real numbers only, honest degrade. The question: does the EYE go to the money data first?

**Finding in one sentence:** the page's money values lose their own hierarchy war — every ledger row sets its LABEL (serif 16px) larger than its VALUE (mono 14px), the user's own position is the least-designed money line on the page, and the accent/scarsity discipline (one hot green) leaks into ghosts and a red "APR" pill.

**Cross-references (no duplication):** `UI_IMPROVE2_DEGRADED-STATES_2026-09-05.md` #2 (finality = stillness; the pulse fixes), #4 (pause-state staging — I do NOT re-propose the pause row), #7 (coverage verify line — my #2 is the value emphasis, complementary), #8 (wallet-absent neutral flag). `UI_IMPROVE_MOBILE_2026-09-04.md` (mobile fold order — my proposals are order-neutral). `UI_IMPROVE2_SKINS_2026-09-05.md` (token palette — every color below reuses an existing token pairing).

---

## Ranking summary

| # | Proposal | Surface | Effort | Impact | Design-law risk |
|---|----------|---------|--------|--------|-----------------|
| 1 | One ledger-row grammar: label recedes, value leads | hero ledger + mint ticket | S | **High** — the eye finally hits the numbers | None — CSS only, zero copy |
| 2 | BACKED: the live coverage number gets the accent | mint ticket + invariants | S/M | **High** — the ticket's one live number is currently anonymous | None — class only when the verified read lands |
| 3 | Position line → ledger-row anatomy | deposit widget | M | **High** — the user's own money is a 12.5px run-on line | None — verified reads, re-chunked |
| 4 | The mint-ticket GREEN tag (ratified treatment) | mint ticket | S | Med-high — the ticket's stamp is unbranded ink | None — existing accent-ink-on-accent pair |
| 5 | Disabled money buttons stop being washed-green ghosts | widget buttons | S | Med-high — pre-connect state + accent scarcity | None — mirrors `.field input:disabled` |
| 6 | Redeem preview promoted to a number line | redeem panel | S | Med — a chain-priced figure styled as status chatter | None — value text unchanged |
| 7 | APR chip de-red: warn is for failures, not projections | hero chips | S | Med — red = honest-failure in the site's own V5 vocabulary | None — palette swap |
| 8 | "live · chain 4663" as the ratified LIVE ONCHAIN tag | hero ledger head | S | Med — the proof stamp is bare 11px text | None — state-driven class exists |
| 9 | Fine print promoted: `.inv-disclosure` joins the ink-callout family | invariants card | S | Med — Stratton grammar #7, "the fine print, promoted" | None — staging only |
| 10 | One face for figures: `.stat-value` mono | stat band | S | Low-med — same four numbers, two fonts | Taste call — flag for user gate |
| 11 | `word-break: break-all` bug on the money status box | widget status | S | Low — every wallet status wraps mid-word | None — bug fix |

---

## 1. One ledger-row grammar: the label recedes, the VALUE leads

**Today.** `.ledger-k` is **serif at `--step-11` (16px)** in full ink; `.ledger-v` is mono at `--step-8` (14px) (style.css:649-650). Every row of the hero ledger and the mint ticket therefore typesets its LABEL bigger than its NUMBER — on the page whose entire claim is the numbers. The site already owns the correct anatomy one section down: `.inv-dt` (mono, 11px, uppercase, tracked) over `.inv-dd` (mono 14px right) at style.css:705-706 — exactly the Stratton grammar ("mono small-cap label rows with bold right-aligned values", DESIGN_REFERENCE item 5). The hero ledger is the odd one out, and it sits 24px above the ticket whose labels are literally uppercase in HTML (index.html:167-170) — two grammars for two stacked money cards.

**Exact diff** (style.css, replace :649-650; the mono override at :688 `.mint-card .ledger-k { font-family: var(--mono); }` becomes redundant and can be deleted):

```css
/* MONEY-GRAMMAR (2026-09-05): one ledger-row anatomy everywhere money renders —
   the .inv-dl grammar promoted to the hero ledger + mint ticket. Labels recede
   to mono small-cap; values stay the row's dominant element. Text content and
   both writers (static HTML + main.js ledgerRow) unchanged. */
.ledger-k {
  font-family: var(--mono);
  font-size: var(--step-1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--ink-soft);
  flex: 0 0 auto;
}
.ledger-v {
  text-align: right;
  font-family: var(--mono);
  font-size: var(--step-8);
  word-break: break-word;
  font-variant-numeric: tabular-nums;
  color: var(--ink);
}
/* live figures out-size their row: the price/TVL <strong>s (main.js:326,335)
   become the largest element in the panel */
.ledger-row .ledger-v strong { font-size: var(--step-11); }
.ledger-row-strong .ledger-v strong { color: var(--accent-text); font-size: var(--step-11); } /* was step-8, :652 */
```

- **Pain removed:** first-glance hierarchy. Before: six 16px serif phrases with small numbers attached. After: quiet 11px mono keys with 16px figures — a receipt, not a form.
- **Considered and rejected:** dotted leader rules between label and value (receipt flourish) — needs a spacer element in BOTH row writers (static HTML + `ledgerRow()` main.js:299-307) and test re-pins; not worth the churn.
- **Anchors:** `grep -n "ledger-k" site/css/style.css site/index.html site/js/main.js` · `grep -n "inv-dt" site/css/style.css`.
- **Effort S · Impact High.**
- **Design-law check:** PASS — pure CSS, zero copy, zero data; contrast improves (labels go `--ink-soft` on raised, a pinned pairing used by `.card-note`/`.flow-node-k`).

## 2. BACKED: the ticket's one live number is anonymous — give it the accent

**Today.** `fillBackingCoverage` (main.js:849-862) writes the identical string into `#mint-backed` and `#inv-stat` — "99.9%" (truncation-toward-zero, vault-coverage.test pinned) — into a `.ledger-v` cell identical to every neighbor: mono 14px, ink. The single most money-critical figure in the mint ticket (the backing invariant, the section the site calls "defined below — measured live on-chain") renders with exactly the same visual weight as "Robinhood Chain (chainId 4663)".

**Exact diff** — main.js `fillBackingCoverage`, thread a `live` flag through the existing single seam:

```js
function writeAll(t, live) {
  cells.forEach(function (c) {
    if (!c) { return; }
    c.textContent = t;
    if (c.classList) { c.classList.toggle('coverage-live', live === true); }  // stub-safe guard
  });
}
// call sites: writeAll(PENDING_COVERAGE_TEXT) → live omitted;
// both 'unavailable (RPC)' branches → live omitted;
// the decode success branch → writeAll(pct, true);
```

CSS (append near the STRATTON-LEDGER-CARD block, style.css:661-725):

```css
/* MONEY-GRAMMAR: the verified live coverage figure is the ticket's ONE hot
   number (accent = orientation, not decoration). Only the live read gets the
   class — pending/unavailable states keep the neutral cell. */
#mint-backed.coverage-live, #inv-stat.coverage-live {
  font-weight: 700;
  color: var(--accent-text);
  font-size: var(--step-11);
}
```

- **Anchors:** `grep -n "fillBackingCoverage" site/js/main.js` · `grep -n "mint-backed" site/index.html site/js/main.js`.
- **Effort S/M · Impact High.**
- **Design-law check:** PASS — the accent rides ONLY a verified decode; pending wiring-truth and `unavailable (RPC)` stay neutral, so the green cannot ever claim a number the chain didn't return. Complements DEGRADED-STATES #7 (their static verify line sits under the cell; this styles the value itself).

## 3. The position line — the user's own money is the least-designed money surface

**Today.** After connect, `refreshBalances` (main.js:1125-1160) pours the holder's facts into `#wallet-balances` as two bare text divs at `--step-4` (12.5px) `--ink-soft`: "Your SPY balance: … · allowance to vault: …" and "Your ws-SPY: … · ≈ … at the current share price." (the P2 position line, main.js:1147-1154). This is the user's actual money — balance, allowance, shares, live-marked value — typeset below the status chatter, in muted prose, with no label/value anatomy at all. Every other number on the page outranks it.

**Exact diff** — reuse the ledger anatomy instead of new CSS: render the box's contents with the existing `ledgerRow()` helper (main.js:299-307) and give the box the data-element border. main.js `refreshBalances`, replace the two `box.appendChild(el('div', null, …))` builds:

```js
box.textContent = '';
box.appendChild(ledgerRow('Your SPY balance', fmtToken(bal)));
box.appendChild(ledgerRow('Allowance to vault', fmtToken(allow)));
if (pos && pos.sharesRaw !== null && pos.sharesRaw !== undefined) {
  var value = (pos.sharesRaw * pos.assetsPerShareRaw) / 1000000000000000000n;
  box.appendChild(ledgerRow('Your ws-SPY', fmtToken(pos.sharesRaw),
    pos.assetsPerShareRaw ? 'ledger-row-strong' : ''));
  if (pos.assetsPerShareRaw) {
    box.appendChild(ledgerRow('≈ at the current share price',
      fmtToken(value) + ' ' + ((tBal && tBal.symbol) || 'underlying')));
  }
}
```

(symbols resolve from the existing `tBal`/`v.shareSymbol` locals — no hardcoded strings; keep the existing catch branch writing the error line.)

CSS (one rule, `#wallet-balances` style.css:384):

```css
#wallet-balances {
  margin-top: var(--space-10);
  font-family: var(--mono);
  font-size: var(--step-4);
  color: var(--ink-soft);
  border: 2px solid var(--line);
  background: var(--paper-raised);
}
```

- **Pain removed:** the money moment a holder checks most ("what do I have, what's it worth") gets the receipt anatomy the hero gives the POOL's money.
- **Anchors:** `grep -n "refreshBalances" site/js/main.js` · `grep -n "wallet-balances" site/index.html site/js/main.js site/css/style.css`.
- **Effort M · Impact High.**
- **Design-law check:** PASS — every value is an already-verified read (`balanceOf`/`allowance`/`readPosition`/`convertToAssets`); labels are re-chunked existing copy, zero new claims; the ≈ keeps its "at the current share price" qualifier verbatim.

## 4. The mint-ticket GREEN tag — the ratified treatment never landed

**Today.** `.mint-card-tag` ("MINT TICKET", index.html:166) is ink text on paper with a `--line` border (style.css:677-687) — the least-branded element on the component the design doc calls "THE Wellstreet-native move." The ratified draft grammar names the green tag explicitly: "accent GREEN #00A86B (CONNECT button, LIVE ONCHAIN tag, #00A86B highlight block)" (DESIGN_REFERENCE §ratified). The green exists on `.btn-primary`, `.hero-chip--green`, `.flow-split-dep` — the ticket's own stamp missed it.

**Exact diff** (style.css, extend `.mint-card-tag` :677-687):

```css
.mint-card-tag {
  /* …existing geometry… */
  background: var(--accent);
  color: var(--accent-ink);
  border-color: var(--ink);
}
```

- **Why this exact form:** `--accent-ink` on `--accent` is a documented 5.6:1 pair (`:root` comment, style.css:20); the 1px ink border keeps it a printed stamp rather than a floating pill. Green scarcity holds — the ticket then carries exactly one accent element, matching the Stratton reference's "one highlighted element per component."
- **Anchors:** `grep -n "mint-card-tag" site/css/style.css site/index.html`.
- **Effort S · Impact Med-high.**
- **Design-law check:** PASS — a component stamp, zero data claims; reuses the site's existing text-on-fill pairing (theme.test: no NEW pair introduced — same pair as `.btn-primary`).

## 5. Disabled money buttons are washed-green ghosts — and they break accent scarcity

**Today.** `button.btn:disabled { opacity: 0.45; }` (style.css:351) sits on `#btn-approve`/`#btn-deposit` — and `#btn-deposit` is `btn-primary` (index.html:344). Pre-connect (the DEFAULT state of the page's money section), the visitor sees a 45%-opacity green primary: a muddy desaturated color that is neither the palette's green nor its paper — plus a washed ink. The disabled inputs next to them already do it right: `background: var(--paper-2); color: var(--ink-soft)` (style.css:340).

**Exact diff** (style.css, replace :351):

```css
button.btn:disabled {
  opacity: 1;
  background: var(--paper-2);
  color: var(--ink-soft);
  border-color: var(--line);
  cursor: not-allowed;
}
button.btn-primary:disabled {
  background: var(--paper-2);
  color: var(--ink-soft);
  border-color: var(--line);
}
```

- **Pain removed:** two birds — (a) the disabled register unifies with `.field input:disabled` and `.pending-tag` (parked, not broken); (b) **accent scarcity is restored for free**: pre-connect the only green button is CONNECT (the gate), post-connect the only green is DEPOSIT (the fund-mover) — exactly one hot accent at every moment, no new classes, no JS.
- **Anchors:** `grep -n "btn:disabled" site/css/style.css` · `grep -n "btn-primary" site/index.html`.
- **Effort S · Impact Med-high.**
- **Design-law check:** PASS — state stays unmistakable (background + muted text + not-allowed cursor + the honest status line beneath); nothing enabled-looking; contrast of `--ink-soft` on `--paper-2` is an existing pairing.

## 6. The redeem preview is a chain-priced number styled as status chatter

**Today.** `#redeem-preview` (index.html:375) renders "≈ 41.2031 SPY out at the current rate — the chain prices the final amount." through the `.flag` class — mono 13.5px, no separation from the buttons above (style.css:304). It is a live vault-view eth_call result (`previewRedeem`/`previewWithdraw`, main.js:1336-1363) — the only forward-priced money figure in the widget — and it looks like a footnote.

**Exact diff** (style.css, one additive rule):

```css
#redeem-preview {
  font-size: var(--step-8);
  color: var(--ink);
  font-variant-numeric: tabular-nums;
  border-top: 1px dotted var(--line-dotted);
  padding-top: var(--space-10);
  margin-top: var(--space-12);
}
```

- **Why dotted hairline:** the `.card-row` separator vocabulary (style.css:293) — it reads as a data row, not a new panel; no box, no new surface.
- **Anchors:** `grep -n "redeem-preview" site/index.html site/js/main.js site/css/style.css`.
- **Effort S · Impact Med.**
- **Design-law check:** PASS — text untouched (the anti-promise wording is load-bearing); only size/color/hairline. Proposal 1's value sizing inherits cleanly.

## 7. APR chip is red — warn is the site's honest-FAILURE color

**Today.** The hero APR chip (`hero-chip--warn hero-chip--apr`, index.html:107) renders `background: var(--warn)` (style.css:824) — the deep red the site reserves for blocked/unavailable/failed everywhere else (`.flag-warn`, `.pending-tag`, `.jurisdiction-banner`, `delta-down`). A red pill advertising "~40.3% projected" is a semantic false alarm: the V5 honest-state vocabulary says red = the read failed; here the read succeeded.

**Exact diff** — index.html:107: `class="hero-chip hero-chip--warn hero-chip--apr"` → `class="hero-chip hero-chip--tan hero-chip--apr"` (tan = the informational static register, ink-on-`--chip-tan` ≈ 11.2:1, style.css:532/823). Keep `--warn` available for real chip failures.

- **Optional JS follow-up (separate decision):** `renderChipsLive` (main.js:406-426) adds `hero-chip--warn` to the APR chip only when the published string comes back empty AND a failure reason exists — degraded chips would then honestly go red. Not required for this proposal.
- **Anchors:** `grep -n "hero-chip--warn" site/index.html site/css/style.css`.
- **Effort S · Impact Med.**
- **Design-law check:** PASS — strengthens the law rather than bending it (accent semantics become strictly truthful); re-pin the render.test anchors that grep the chip classes in-change.

## 8. "live · chain 4663" — the proof stamp should be the ratified LIVE ONCHAIN tag

**Today.** The hero ledger's live state (`.hero-ledger-state`, set to `flag flag-ok` + "live · chain 4663" by `renderLedger`, main.js:312-317) is styled as bare accent-text 11px (style.css:639) — visually a typo-weight fragment floating at the panel's top-right. The ratified grammar's green "LIVE ONCHAIN tag" is the missing treatment, and this chip is its natural host.

**Exact diff** (style.css, extend :639):

```css
.hero-ledger-state.flag-ok {
  color: var(--accent-text);
  border: 1px solid var(--accent-text);
  padding: var(--space-2) var(--space-6);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  white-space: nowrap;
}
```

- The warn branch (`rpc unreachable — the rows below show the gap, not a guess`) deliberately stays a bare red line: failure is not stamped.
- **Anchors:** `grep -n "hero-ledger-state" site/css/style.css site/js/main.js`.
- **Effort S · Impact Med.**
- **Design-law check:** PASS — state-driven via the existing class; accent-text/outlined-accent is the `.stat-marker` pairing (style.css:943-955); uppercase transform is CSS-only (copy intact).

## 9. Fine print promoted: the backing disclosure joins the ink-callout family

**Today.** The mint ticket's mechanism statement gets the ink box (`.mint-card-callout`, style.css:689-697) — but the invariants card's deeper disclosure (`.inv-disclosure`, style.css:725: `--code-bg`, `--ink-soft`, 12.5px) renders the section's actual mechanism text as the visual sibling of a code sample. Stratton grammar item 7: "small-print disclosure blocks in BLACK boxes — the honest voice given visual weight instead of buried fine print." The site even says it: section 04's subtitle is "the fine print, promoted."

**Exact diff** (style.css, replace :725 + one override):

```css
.inv-disclosure {
  margin-top: var(--space-12);
  padding: var(--space-12);
  background: var(--ink);
  color: var(--paper);
  font-size: var(--step-4);
  line-height: 1.5;
}
.inv-disclosure code { background: transparent; color: var(--paper); border-color: var(--paper); }
```

- **Opt-in extension:** `#apr-footnote` (style.css:313-317, the 8px-left-border block) could join the same family — flag for the user gate; the full methodology paragraph is long, and an ink box that size changes the Vaults section's temperature.
- **Anchors:** `grep -n "inv-disclosure" site/css/style.css site/index.html`.
- **Effort S · Impact Med.**
- **Design-law check:** PASS — staging only; `--paper` on `--ink` is the existing callout pairing; the mono `<code>` inside stays legible via the override.

## 10. One face for figures: the stat band breaks the mono register

**Today.** `.stat-value` is **Inter 600** (style.css:927-935) — the ONLY money figures on the page set in sans. The identical four numbers render mono 14px in the hero ledger rows twenty viewports of scroll away; the band re-typesets them in a different face with sans-isms (`letter-spacing: -0.025em`). A ledger keeps one face for figures; the mixed register also makes the count-up's digit churn (rAF re-writing the value) jitter differently in proportional type than the mono rows below it.

**Exact diff** (style.css:928):

```css
.stat-value {
  font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace);
  font-weight: 700;
  letter-spacing: 0;
  /* size clamp, tabular-nums, min-height unchanged */
}
```

- **Flag:** this inverts a deliberate WSV-STATS choice ("the design reference's display-font character set"); mono here is the terminal-strip reading of the same band (WOW-1's own name for it). Taste call — user gate, cheap to revert.
- **Anchors:** `grep -n "stat-value" site/css/style.css`.
- **Effort S · Impact Low-med.**
- **Design-law check:** PASS — render-degrade.test pins `''`/fallback TEXT, not the face; tabular-nums retained so the count-up doesn't reflow.

## 11. Bug: `word-break: break-all` on the money status box wraps sentences mid-word

**Today.** `#widget-status { … word-break: break-all; }` (style.css:383) exists to wrap tx hashes — but it applies to EVERY status line on the money path: "Deposit confirmed in block 25,441,208." wraps as "confirma/tion", "waiting for wallet" as "waiti/ng for wall/et" at narrow widths. `break-all` breaks anywhere including inside normal words.

**Exact diff** (style.css:383):

```css
#widget-status { …existing… word-break: normal; overflow-wrap: anywhere; }
```

`overflow-wrap: anywhere` still breaks the long hashes/explorer URLs (the reason the rule exists) but only when a token cannot otherwise fit.

- **Anchors:** `grep -n "widget-status" site/css/style.css site/js/main.js`.
- **Effort S · Impact Low (quality bug).**
- **Design-law check:** PASS — no content change.

---

## Test-safety map (what each proposal can and cannot break)

- **render.test.js static-ID registry:** no proposal adds/removes an id. #3 renders NEW children into the existing `#wallet-balances` (not registry-tracked); its DOM-stub path must keep the null guards the file already uses (`if (c.classList)` in #2, `ledgerRow` is stub-safe by construction — it only uses `el()`/`appendChild`).
- **theme.test.js six WCAG pairs:** every color/text pairing proposed is an existing documented pair (`--accent-ink` on `--accent` 5.6:1; `--accent-text` on paper 5.4:1; `--paper` on `--ink` callout; `--ink-soft` on `--paper-2`; ink on `--chip-tan`). No new pairing is introduced; re-run the battery to confirm the six-pin enumeration is selector-scoped as assumed.
- **wow.test.js:** #2 touches `fillBackingCoverage` (NOT inside the WOW-6 SIM source-slice markers, main.js:757-802 — the slice gate is unaffected); #7 touches index.html chip classes — re-pin any grepped anchors in the same change.
- **vault-coverage.test.js:** #2 adds a class toggle only — the truncation-toward-zero string ("99.9%", never "100.0%") is untouched.
- **Reduced-motion:** all proposals are static styling; zero new animations/transitions; the scoped guards (style.css:511-518, 742-747, 865-872, 1343-1368) are untouched.
- **Mobile:** #1's label recede helps the ≤640px stacked rows (style.css:730-731) — smaller keys above left-aligned values; no new media blocks needed. The WS-MOBILE-FIXES EOF block (style.css:1478-1510) is untouched.
- **COEXISTENCE PIN:** no proposal merges/reorders the hero ledger and mint ticket (the hero-recompose goal owns that); they only converge on ONE row grammar.

## Considered and rejected

- **Merging the two hero cards** — COEXISTENCE PIN (FRONTEND_MAP #13 comment, index.html:158-164); out of scope by contract.
- **Dotted leader rules between label and value** — needs markup in both row writers + test re-pins; the typography fix delivers the hierarchy without them.
- **Fixed-width label column (`grid-template-columns`)** — breaks the ≤640px stacking rules that genuinely inherit `.ledger-row` anatomy (style.css:727-736) and would need a second mobile override; flex space-between with right-aligned mono values already reads as a ticket.
- **Green stamp on the hero ledger's `✓ slot0` verification marks** — WOW-8 is data-carrying and already accent-text; more green would break scarcity.
- **Pause-state restaging** — owned by UI_IMPROVE2_DEGRADED-STATES #4.
