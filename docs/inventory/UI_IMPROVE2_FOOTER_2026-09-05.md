# UI-IMPROVE 2 — FOOTER & META-EDGES (2026-09-05)

**Scope:** the ledger-grid footer, the Source & license block, the `.footer-fine` mono metadata edges, the page→footer boundary, and what a print-magazine colophon would put here. Analysis-only — **zero site edits in this task**.
**Repo state read:** HEAD `048718f1f5e313942b73d361327064275afcfa91` ("fix: canyon hero — region-density key…"). Line numbers cite the worktree as read; the tree carries sibling in-flight edits (`site/css/style.css` MM, `site/js/main.js` M) — every anchor below is a **literal byte-grep**, not just a line number, so the owning wave can re-locate after the siblings land.
**Read-first sources honored:** `docs/inventory/FRONTEND_MAP_2026-09-04.md` (footer = map feature #40; R3 IMP-2/--ink-deep notes), `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` (reference item 6 hatched separators, item 7 ledger-grid footer "header cells (Products / Company / Legal), rows as cells — a LEDGER, not a link soup", item 8 mono metadata edges "© line at the very edges", Stratton item 7 "small-print disclosure blocks in black boxes").

**Current footer anatomy (verified bytes):**
- HTML `site/index.html:517-543` — `<footer class="site-footer">` → `.footer-grid` with three `.footer-col` columns (**Protocol** / **Source & license** / **Honesty line**), then `.footer-fine` with `#footer-year` + `#trademark-note`.
- CSS `site/css/style.css:457-472` — `.site-footer` (461), dead-looking `.site-footer a` (463 — **no anchor exists in the footer today**), `.footer-grid` 1px-ledger grid (469), `.footer-grid .h` bordered header chip (471), `.footer-fine` mono edge (472).
- Tokens `style.css:533-537` (`--footer-muted #4E4939` 6.6:1, `--footer-faint #615C4C` 4.9:1 on `--ink-deep #E2DCCB`, style.css:591), `--paper-2 #E4DFD1` (style.css:15).
- JS `site/js/main.js:1515` (`$('footer-year')` year stamp), `main.js:1528` (`$('trademark-note')` ← `config.js:36-40` trademarkNote).
- Tests: `theme.test.js:269-287` (structure teeth (b)/(d)), `theme.test.js:67-68` (footer token pins), id registries `render.test.js:129` / `render-degrade.test.js:96` / `widget-pause.test.js:103`, asset table `agent-first.test.js:60-68` (keyed on file — `img/logo-mark.png` already declared, a second static reference passes), D8 fetch gate `render.test.js:374-382` (relative-docs matcher `u.indexOf('../docs/public/') === 0`).

---

## DESIGN LAW (binding on every proposal below)

1. **No yield promises, facts only.** The Honesty-line column's projections/go-to-zero sentence is untouched; no new figure of any kind enters the footer (the only numbers added are year, chain id, commit sha — all checkable facts).
2. **Zero VIBE.** No mention of VIBE, the VIBE platform, or any VIBE asset anywhere.
3. **Zero external origins.** No new hosts (resource-gate allowlist untouched); any new asset is an already-self-hosted file or a user-gated generated one.
4. **The repo line stays linkless** while `branding.repoUrl === 'PENDING_IDENTITY'` (`config.js:35`): "A placeholder is not an address, so this line carries no link" is copy, not a TODO.
5. **No new custom property tokens** unless the proposal says so explicitly (the existing footer work pinned "existing tokens only", style.css:468); new text uses existing type roles (`--step-1` micro / `--step-4` chrome / `--step-6` small, style.css:568-571).
6. **Honesty copy is preserved byte-identical** unless the diff shows the exact old→new strings; frozen-copy teeth (`theme.test.js` test (f), `agent-first.test.js` test (a)) must still pass after each change.
7. **Reduced-motion:** nothing below adds animation. A colophon is print — it does not move.

---

## PROPOSALS (ranked)

### F1 — The contrast line becomes the footer's ink callout (the print small-print box)
**Rank 1 · impact HIGH · effort S**

The site's thesis — "This one asks you to read." — currently renders as an undifferentiated 13.5px row inside a 4-row text column. The ratified reference gives honest small print **visual weight instead of burial** (Stratton item 7: small-print disclosure blocks in black boxes), and the site already owns the exact component: `.mint-card-callout` (ink-inverted mono box, style.css:689-697). A colophon-quality footer puts its one claim in a box.

**Diff (HTML, `index.html` footer Source & license column, grep anchor `<div>Every other yield vault asks you to trust`):**
```html
<!-- OLD -->
<div>Every other yield vault asks you to trust a company, an audit, and a founder. This one asks you to read.</div>
<!-- NEW -->
<div>Every other yield vault asks you to trust a company, an audit, and a founder.</div>
<div class="footer-callout">This one asks you to read.</div>
```

**Diff (CSS, after `.footer-grid .h` rule, style.css:471):**
```css
.footer-callout { /* F1 (UI_IMPROVE2_FOOTER): the contrast line gets the ink-box
  treatment — .mint-card-callout precedent (token-inverted, mono), small-print
  given weight per the ratified reference. Token-only. */
  margin-top: var(--space-10);
  padding: var(--space-10) var(--space-12);
  background: var(--ink);
  color: var(--paper);
  font-family: var(--mono);
  font-size: var(--step-4);
  line-height: 1.5;
}
```
**Grep anchors:** `site/index.html`: `Every other yield vault asks you to trust` (1 occurrence); `site/css/style.css:689` `.mint-card-callout {` (the precedent to mirror, do not reuse the class — different context margins).
**Design-law:** the sentence is a fact-framing contrast (trust vs read), not a yield claim. Contrast pair = `--paper` on `--ink` (~15:1; same unpinned-by-count pair the mint callout already ships — theme.test.js:177's "exactly six asserted pairs" count is unaffected; adding the pair to the battery is optional hardening).
**Tests:** none re-pinned (no id, no frozen string split — both new lines keep every existing substring intact). Composes with F3 (exclude `.footer-callout` from row borders — shown there).

---

### F2 — Colophon strip: the thumbs-up printer's mark + two-edge mono metadata
**Rank 2 · impact MED-HIGH · effort S**

The reference's item 8 puts the © line "at the very edges", and a print magazine always closes with a **printer's mark** in the colophon. The site already self-hosts the ratified mark (`site/img/logo-mark.png`, header `brand-mark`, index.html:51 — already in the ASSET_MOTION table keyed by file, agent-first.test.js:66, so a second static reference passes the gate unchanged). `.footer-fine` becomes a real two-edge strip: mark + © on the left, trademark note flowing on the right, separated from the ledger grid by the site's dotted-hairline precedent (`.doc-toc`, style.css:429).

**Diff (HTML, `index.html:538-541`, grep anchor `<span id="footer-year">`):**
```html
<!-- OLD -->
<div class="footer-fine">
  <span id="footer-year">2026</span> Wellstreet contributors.
  <span id="trademark-note"></span>
</div>
<!-- NEW -->
<div class="footer-fine">
  <span class="fine-edge"><img class="fine-mark" src="img/logo-mark.png" width="14" height="15" alt="" aria-hidden="true"> <span id="footer-year">2026</span> Wellstreet contributors.</span>
  <span id="trademark-note"></span>
</div>
```

**Diff (CSS — replace the `.footer-fine` rule at style.css:472, keeping every token it already uses):**
```css
.footer-fine { /* P4 mono metadata edge → F2 colophon strip: dotted rule above
  (.doc-toc precedent), two-edge layout, printer's mark. Same tokens. */
  margin-top: var(--space-20); padding-top: var(--space-12);
  border-top: 1px dotted var(--line-dotted);
  display: flex; flex-wrap: wrap; gap: var(--space-6) var(--space-16);
  justify-content: space-between; align-items: baseline;
  font-size: var(--step-1); color: var(--footer-faint); font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em;
}
.fine-mark { width: 14px; height: 15px; vertical-align: -2px; margin-right: var(--space-6); opacity: 0.85; }
```
**Grep anchors:** `site/css/style.css:472` `.footer-fine {`; `site/index.html:51` (`img/logo-mark.png` first reference — the file is already allowlisted in `agent-first.test.js:66`).
**Design-law:** the mark is decorative (`aria-hidden`, `alt=""`), zero new requests, zero new bytes (file already ships).
**Tests:** `theme.test.js:287` regex `/\.footer-fine \{[^}]*var\(--mono\)/` still passes (the var stays inside the first rule block). `#trademark-note`/`#footer-year` ids unchanged → id registries untouched.

---

### F3 — "Run it yourself." becomes the footer's one honest link (and the dead rule gets a consumer)
**Rank 3 · impact MED-HIGH · effort S**

The footer contains **zero anchors**, yet `.site-footer a { color: var(--ink); }` (style.css:463) has shipped a rule for a link that does not exist — and the column's own last sentence is an instruction ("Run it yourself.") that goes nowhere. The nav CTA targets `#docs`; the footer should hand you the same door at the page's end. One link only — the no-link repo line and the honesty lines stay untouched (a footer of three links is the link-soup the reference rejects).

**Diff (HTML, Source & license column first row, grep anchor `Owner controls live behind a public 48-hour timelock`):**
```html
<!-- OLD -->
<div>Open source. MIT. No company behind it. Owner controls live behind a public 48-hour timelock. Run it yourself.</div>
<!-- NEW -->
<div>Open source. MIT. No company behind it. Owner controls live behind a public 48-hour timelock. <a href="#docs">Run it yourself.</a></div>
```

**Diff (CSS — replace style.css:463):**
```css
.site-footer a { color: var(--ink); text-decoration: none; border-bottom: 1px solid var(--footer-muted); } /* F3: the footer's one in-page door; hairline underline, not decoration */
.site-footer a:hover { border-bottom-color: var(--ink); }
```
**Grep anchors:** `site/index.html`: `Run it yourself.` (period form, 1 occurrence — nav's `Run it yourself` has no period, so no count collision); `site/css/style.css:463` `.site-footer a`.
**Design-law:** in-page anchor only; the repo pointer stays linkless (law 4); no new copy invented — the sentence existed, it just gains its referent.
**Tests:** none re-pinned (string occurrence counts unchanged; no id added). Optional mirror-link noted and **rejected** — the skill path already appears twice in #agents (index.html:507-509); a third instance is the fact-redundancy the design audit flagged.

---

### F4 — Trademark note gets its own imprint line
**Rank 4 · impact MED · effort S**

`#trademark-note` (config.js:36-40 — a three-sentence legal note naming Robinhood Markets and State Street) currently renders inline after "2026 Wellstreet contributors." in one uppercase 11px run — the legal colophon squeezed into the © line. An imprint page gives the legal line its own row. Works standalone; composes with F2's flex strip (the span simply lands on its own wrapped line).

**Diff (HTML, `.footer-fine` block, grep anchor `<span id="trademark-note">`):**
```html
<!-- OLD (last two lines of .footer-fine) -->
  <span id="trademark-note"></span>
</div>
<!-- NEW -->
</div>
<div class="footer-imprint"><span id="trademark-note"></span></div>
```

**Diff (CSS, after `.footer-fine`):**
```css
.footer-imprint { margin-top: var(--space-8); font-size: var(--step-1); color: var(--footer-faint); font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em; max-width: 88ch; }
```
**Grep anchors:** `site/js/main.js:1528` `$('trademark-note')` (writer unchanged — id preserved); `site/js/config.js:36` trademarkNote.
**Design-law:** facts only, verbatim note; no size shrink below the pinned `--step-1` role (no new token, law 5).
**Tests:** none re-pinned (id survives; render/render-degrade/widget-pause registries unchanged).

---

### F5 — Rows-as-cells: complete the ledger-table transfer
**Rank 5 · impact MED · effort S**

The ratified reference's footer is "a LEDGER, not a link soup" — **rows as cells**. The current `.footer-grid` draws hairlines *between columns* only; inside each column the content rows float as free text, so the ledger reading is half-built. Hairline row rules inside each column finish the table: every fact sits in its own cell, like the doc-pane tables (style.css:419) and the mint-ticket rows.

**Diff (CSS, after `.footer-grid .h`, style.css:471):**
```css
.footer-col > div:not(.h):not(.footer-callout) { /* F5 (UI_IMPROVE2_FOOTER): rows as cells —
  the reference's ledger-grid footer is a table, not stacked prose. The .footer-callout
  exclusion (F1) keeps the ink box self-bounded. */
  padding: var(--space-8) 0;
  border-bottom: 1px solid var(--line);
}
.footer-col > div:last-child { border-bottom: none; }
```
**Grep anchors:** `site/css/style.css:469` `.footer-grid {` (the column hairlines this completes); `site/css/style.css:471` `.footer-grid .h` (header cells stay distinct).
**Design-law:** structure only; no copy moves. (If F1 is not adopted, drop the `:not(.footer-callout)` guard.)
**Tests:** `theme.test.js:276-277` asserts on `.footer-grid`/`.footer-grid .h` rules — untouched. If F1 lands, the Source column's last child is the callout, so `:last-child` cleanly removes the final border.

---

### F6 — Build-provenance line: "deployed from commit X" (the checkable colophon)
**Rank 6 · impact HIGH (voice) · effort M**

A print colophon names its printing; the checkable voice wants a footer line that names the exact source revision serving the page. Done honestly this must be **build-time-injected, never hand-pinned** (a manually bumped sha drifts on the very next deploy and becomes a lie). Vercel exposes `VERCEL_GIT_COMMIT_SHA` to `buildCommand`; the site's no-build convention is preserved (one `printf` appended to the existing copy command).

**Diff (`vercel.json:4`, grep anchor `buildCommand`):**
```json
"buildCommand": "mkdir -p site/docs && cp -r docs/public site/docs/public && printf 'rev %s' \"${VERCEL_GIT_COMMIT_SHA:-unpublished}\" > site/revision.txt"
```

**Diff (HTML, inside `.footer-fine` left edge, after the F2 mark span or bare if F2 is skipped):**
```html
<span id="footer-rev"></span>
```

**Diff (JS, `main.js` init, adjacent to the footer-year writer at main.js:1515):**
```js
// F6 (UI_IMPROVE2_FOOTER): build-provenance colophon. Relative fetch (IPFS-ready);
// any failure — mirror pin without the file, offline, 404 — leaves the line empty,
// never a fabricated sha. On mirrors the line names the pin that IS serving.
var rev = $('footer-rev');
if (rev) {
  fetch('revision.txt').then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
    .then(function (t) { var s = (t || '').trim(); if (s.indexOf('rev ') === 0 && s.length <= 48) { rev.textContent = ' · ' + s.slice(0, 16); } })
    .catch(function () { /* honest silence: no rev line rather than a wrong one */ });
}
```
**Grep anchors:** `vercel.json:4`; `site/js/main.js:1515` `$('footer-year')`; D8 gate `site-tests/render.test.js:374-382`.
**Design-law:** a sha is the most checkable fact on the page (verifiable against the repo); `unpublished` fallback is truthful for non-git/manual deploys (deploys are manual until the D-D migration — FRONTEND_MAP pending #2). Chain id/commit are not yield claims.
**Tests (the one proposal that re-pins):** (a) D8 gate — extend the matcher: `const isDocs = u.indexOf('../docs/public/') === 0 || u === 'revision.txt';` with a comment citing this doc; (b) add `'footer-rev'` to the three id registries (`render.test.js:129`, `render-degrade.test.js:96`, `widget-pause.test.js:103`); (c) resource-gate untouched (runtime relative fetch, no host); (d) render-degrade's mock fetch 404s non-RPC paths (render.test.js:304) — the catch branch is exercised by the existing harness.

---

### F7 — Header cells get the header-cell fill
**Rank 7 · impact LOW-MED · effort S**

The reference's ledger header cells sit on a distinct fill; today `.footer-grid .h` (style.css:471) is a bordered chip on the same surface as its rows. One declaration reads it as a table header cell, harmonizing with `.doc-pane th { background: var(--paper-2); }` (style.css:420) — the site's own header-cell convention.

**Diff (CSS, append inside the `.footer-grid .h` rule at style.css:471):**
```css
.footer-grid .h { /* existing declarations unchanged, plus: */ background: var(--paper-2); }
```
**Grep anchors:** `style.css:471`; token `--paper-2: #E4DFD1` (style.css:15); `--footer-muted #4E4939` text on `--paper-2` ≈ 6.0:1 — clears AA.
**Design-law/tests:** token-only, zero copy; no test touches `.h`'s background (theme.test.js:277 checks the border only).

---

### F8 — Typeface & license fact line (the classic colophon sentence)
**Rank 8 · impact LOW-MED · effort S**

Print colophons name their type. The site self-hosts two OFL faces (style.css:43-59) and every fact below is already asserted elsewhere on the page — this line simply gathers them at the edge where colophons live:

**Diff (HTML, after the `.footer-grid` close, before `.footer-fine`):**
```html
<div class="footer-colophon">Set in EB Garamond &amp; Inter (OFL, self-hosted) · MIT · chain 4663 · no analytics, no tracking</div>
```
**Diff (CSS):**
```css
.footer-colophon { margin-top: var(--space-12); font-size: var(--step-1); color: var(--footer-faint); font-family: var(--mono); text-transform: uppercase; letter-spacing: 0.08em; }
```
**Fact check (each token verified):** EB Garamond + Inter, OFL, self-hosted — style.css:43-59 + `site/fonts/OFL.txt`; MIT — `config.js:34` + footer copy; chain 4663 — `config.js:44`; "no analytics, no tracking" — index.html:460 (verbatim phrase precedent). Zero VIBE, zero yield language.
**Tests:** none (no id; strings not frozen). Keep it one line — with F2/F4/F7 all landing, order top-to-bottom becomes: ledger grid → colophon fact line → dotted rule → fine strip → imprint. If the footer starts to feel stacked, this is the first candidate to drop.

---

### F9 — Page→footer boundary: decision record (keep the single hatch)
**Rank 9 · impact N/A (decision) · effort N/A**

The lens question: does the footer need its own hatched separator? **No — and adding one would be a defect.** The hatch exists exactly once at the boundary: `section.block { border-bottom: 8px solid transparent; border-image: repeating-linear-gradient(45deg, …) 8 }` (style.css:263) fires on `#agents`, the last block before `<footer>` (index.html:496,517). The footer itself takes no top border, so the band reads once. A `.site-footer` top hatch would render two adjacent 8px hatch bands (double-hatch). This is already toothed: `theme.test.js:272-273` pins `>=2` repeating-linear-gradient declarations ("one per hatched boundary" — `.hero` + `section.block`, never grouped). **Record: keep as-is.** Inside the footer, hierarchy comes from the ledger grid's own 1px border (print colophons close on a thin rule, not a band) — F2's dotted rule is the correct interior treatment.

---

### F10 — "WELL ST" sign-art colophon device (deferred, user-gated alternative to F2's mark)
**Rank 10 · impact MED (if built) · effort M + user art gate**

The bigger print-move: a dithered "WELL ST" street-sign plate as the colophon device (the canyon hero's logical small-print sibling), placed at the right edge of the F2 strip. Requirements if the user wants it: generated via the design-kit path with the SAME style suffix and paper background as the hand/curve kit (`DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` asset rules — hands are ART, never data; same applies to a sign), self-hosted under `site/img/`, `alt=""` + `aria-hidden`, static (no motion row needed beyond the ASSET_MOTION file entry), compressed like the existing `site/img/compressed/` set. **Deferred**: needs user art generation + a bytes-budget decision; F2's zero-cost mark reuse delivers the printer's-mark reading today. Not a blocker for F1-F9.

---

## REJECTED (considered, fails design law or the ratified reference)

- **Literal "Products / Company / Legal" column heads** (reference item 7's example content): "Company" is contradicted by the site's own pinned fact "No company behind it." (footer row 1), "Products" implies inventory (one vault family, honestly framed as Protocol facts), and "Legal" is already carried by the Honesty line column. The reference's transferable content is the SHAPE (header cells + rows as cells) — F1/F5 deliver that with honest heads. Do not import competitor column labels.
- **A footer top hatch** — double-hatch defect (F9).
- **More footer links** (explorer, skill mirror, vault anchors) — link soup; the reference rejects it and the skill path already appears twice on the page (F3 notes the redundancy).
- **Any emphasis treatment on the no-audit / no-link lines** — they are disclaimers; giving them the ink box would outrank the thesis line and visually equate disclaimer with claim.

---

## VERIFICATION BATTERY (for the owning wave, after implementing any subset)

```bash
cd /home/raivo/Documents/wellstreet
node --test site-tests/                     # full suite; gate = failing-ID-SET delta, never counts
grep -c "footer-callout\|footer-imprint\|footer-colophon\|fine-mark\|footer-rev" site/index.html site/css/style.css
grep -n "This one asks you to read." site/index.html          # F1: exactly 1, inside .footer-callout
grep -n "site-footer a" site/css/style.css                     # F3: rule has a consumer now
grep -n "Run it yourself." site/index.html                     # F3: still exactly 1 (period form)
node -e "JSON.parse(require('fs').readFileSync('vercel.json'))" # F6: JSON still valid
```
Screenshot gates (human, soak-end per convention): desktop 1280 + mobile 400 — ledger grid column hairlines (F5) and the callout box (F1) at both widths; the fine strip wrap order (F2/F4) at 400px.

**Sequencing note:** F1+F5 interact (callout excluded from row borders); F2+F4 restructure the same block (F4's imprint line slots under F2's strip); F6 is the only proposal touching build config/tests and should ride last. All are independent of the sibling in-flight hero/copy edits (no shared hunks — footer HTML block 517-543 and CSS 457-472 are untouched by the canyon/copy work as of this read).
