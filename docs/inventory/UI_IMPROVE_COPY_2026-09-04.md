# UI Improve — Copy/Voice Map (deadpan-degen under-played), 2026-09-04

**Task:** map where the site's two best lines — "Checkable, not sellable." and "Every other yield vault asks you to trust a company, an audit, and a founder. This one asks you to read." — are under-played, and propose surgical before/after swaps. Analysis-only: this doc is the only write. No site files touched.

**Read first (binding):** `docs/inventory/FRONTEND_MAP_2026-09-04.md` + `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md`. Sources read in full: `site/index.html`, `site/js/main.js`, the user-visible strings in `site/js/{config,docs,wallet,apr,vault}.js`, and all seven `docs/public/*.md` (the honest-docs voice).

**Worktree note:** read at HEAD `2cf5fc9` with sibling in-flight state (`site/index.html` MM, `site/js/main.js` M). Line numbers are worktree-as-read — re-grep each anchor before editing.

**The voice, stated once:** deadpan-degen = wit from understatement and precision, never from hype. The site already does this at its best ("None. Read the invariants and the threat model instead." / "no numbers below pretend otherwise" / "a footnote among flowing quantities, never a promise"). Every proposal below either (a) extends that register to a spot still writing in spec-sheet monotone, or (b) fixes a string that has drifted from true. Humor that required a fact to bend was rejected at draft time.

**Honesty guards applied to every "after" (verbatim-checkable):**
- no yield promise, no rate language outside the "projected, methodology-linked" register;
- no "no owner / ownerless / trustless" (owner controls are disclosed, never denied);
- no superlatives, no emoji, no exclamation marks;
- facts byte-unchanged — wit comes from naming mechanisms ("refuses", "will not invent"), never from new claims.

---

## Ranked before/after pairs (14 · all effort S)

### 1. The post-tx CTA says "view"; the brand says "verify"
- **Anchor:** `site/js/main.js:1203`
- **Before:** `view on explorer`
- **After:** `verify it on the explorer`
- **Why:** this is the one link every approve/deposit/redeem/withdraw ends with, and it currently uses the spectator verb. The whole site is an argument that you verify instead of trust — the copy on its own money receipt should do what the tagline asks. Funnier because it is bossier in a four-syllable upgrade, and truer because "verify" is exactly what an explorer link is for.
- **Guards:** same href, same target, same behavior; zero new claim.
- **Effort:** S · **Impact:** 4 · **Tests:** no pin found on the string (grep site-tests).

### 2. Sim degraded state — name the refusal, not the need
- **Anchor:** `site/index.html:396` + `site/js/main.js:752` (keep the two byte-identical, as today)
- **Before:** `pool TVL unavailable — the dilution input needs the live read`
- **After:** `pool TVL unavailable — the dilution bar will not invent a denominator`
- **Why:** the current line describes a dependency; the new one describes a *behavior the code actually has* (share `=== null` → bar empty, `data-empty`, main.js:749-758). "Will not invent" is the site's whole ethic compressed into a slider label, and it lands as deadpan personification rather than apology.
- **Guards:** describes existing behavior exactly; no data claim; no yield content.
- **Effort:** S · **Impact:** 4 · **Tests:** no string pin; the wow source-slice gate (wow.test.js:148) bans APR tokens in the sim slice — a plain string edit is unaffected.

### 3. Section 02 header — the two-tone grammar reaches the money section
- **Anchor:** `site/index.html:312`
- **Before:** `<h2>Deposit / Redeem</h2>`
- **After:** `<h2>Deposit / Redeem<br><span class="quiet">the only buttons on this page that can move funds</span></h2>`
- **Why:** sections 03 ("Not one dollar.") and 05 ("Operated by agents.") already use the quiet-line grammar; 02 is descriptive-flat. The quiet line is a checkable scope statement — the D8 page is read-only everywhere else — and stating it plainly is both the joke and the safety disclosure.
- **Guards:** a scope statement, not a promise; verifiable by grepping the page's own write surface.
- **Effort:** S · **Impact:** 4 · **Tests:** none found on the h2.

### 4. Title / og:title — the differentiator enters the snippet
- **Anchor:** `site/index.html:19` (+ `:7` og:title, same string)
- **Before:** `Wellstreet — yield vaults for tokenized stocks`
- **After:** `Wellstreet — checkable yield vaults for tokenized stocks`
- **Why:** the search result and social card are the only surfaces still carrying no differentiator. "Checkable" is the ratified tagline adjective (theme.test.js:249 pins the h1 that owns it — the title is free), and it does more work per pixel than any other word available.
- **Guards:** a verifiability claim, not a return claim; no superlative.
- **Effort:** S · **Impact:** 4 · **Tests:** no pin found on `<title>`/og:title.

### 5. Vault-card footnote — precision IS the voice
- **Anchor:** `site/js/main.js:888-889`
- **Before:** `Everything above is read by your browser directly from public RPC nodes — no backend, no keys. Share tokens (ws-SPY) are issued by the vault at deploy.`
- **After:** `Everything above is read by your browser directly from public RPC nodes — no backend, no keys. The ws-SPY token was created at deploy; shares are minted by the vault on deposit and burned on redeem.`
- **Why:** "issued by the vault at deploy" blurs two facts the guarantees doc states precisely — the *token* exists at deploy, *shares* are minted on deposit (ERC-4626; guarantees.md §3: "No shares are minted when yield is pushed"). A site whose tagline is "checkable" cannot afford a fuzzy mechanism sentence in the card footnote.
- **Guards:** strictly more precise, zero new claims.
- **Effort:** S · **Impact:** 3 · **Tests:** none found on the string.

### 6. Flow deposit-node sub — stale line becomes the true (and better) story
- **Anchor:** `site/index.html:256`
- **Before:** `schematic — deposits activate when the vault deploys`
- **After:** `the vault takes deposits; the fee stream waits for the harvester's LP seed`
- **Why:** the current line is stale — the vault IS deployed (config.js:152, F-01 2026-09-03) and accepts deposits now. The true state is more interesting than the stale one: methodology.md, "Every input" section: "The harvester LP is not yet seeded." Wit from accuracy, again.
- **Guards:** both clauses documented facts (deployed + not paused; LP unseeded). NOTE: the node's main value shows LAUNCH_FACT.deployed ("deployed — yield phase live") — see Observations for that pre-existing tension; this pair does not touch it.
- **Effort:** S · **Impact:** 3 (truth-fix) · **Tests:** none found on the string.

### 7. The cut row's label — unify the two names and point at the right party
- **Anchor:** `site/js/main.js:253` (live card row), `:247` (degraded variant), `:335` (hero ledger), `site/index.html:137` (hero ledger static)
- **Before (live):** `Pool protocol cut (live)` · **Before (degraded):** `Protocol cut (pool owner)`
- **After (both states):** `The pool owner's cut (live)` / `The pool owner's cut`
- **Why:** the same row currently changes *name* when it degrades — an inconsistency, and a missed joke. "The pool owner's cut" names the party who can change it, which is the entire risk story the surrounding copy already tells (index.html:287 "owner-set fee cut"; the row's own slot0 note). Attribution is the wit.
- **Guards:** same fact, sharper attribution; matches docs' "the pool owner can change the protocol cut".
- **Effort:** S (4 sites, one string each) · **Impact:** 3 · **Tests:** none found on the label.

### 8. Section 04 header — the fine print gets a title
- **Anchor:** `site/index.html:442`
- **Before:** `<h2>Docs</h2>`
- **After:** `<h2>Docs<br><span class="quiet">the fine print, promoted.</span></h2>`
- **Why:** the ascetic-degen reference's own move (disclosure blocks given visual weight) named out loud. Every other site buries this section; here it is section 04 with a magnifying-glass hand. Self-aware, dry, and it sets up the block-sub without duplicating it.
- **Guards:** no fact; does not repeat "written to be checked, not to be believed" (index.html:453).
- **Effort:** S · **Impact:** 3 · **Tests:** none found on the h2.

### 9. Footer repo line — explain the absent link as dry wit
- **Anchor:** `site/index.html:513`
- **Before:** `Source repository publishes with the new identity at launch (placeholder until then).`
- **After:** `Source repository publishes with the new identity at launch. A placeholder is not an address, so this line carries no link.`
- **Why:** the current parenthetical is apologetic; the new second sentence states the pending-URL convention (main.js:1424-1437: "never a fabricated URL") as a flat definition. "A placeholder is not an address" is the ledger voice doing precision comedy.
- **Guards:** fact unchanged (repoUrl is `PENDING_IDENTITY`, config.js:35); no promise about launch date beyond the existing one.
- **Effort:** S · **Impact:** 3 · **Tests:** none found on the string.

### 10. og:description — a second honest negative, better rhythm
- **Anchor:** `site/index.html:8`
- **Before:** `Open-source ERC-4626 vaults wrapping tokenized stocks on Robinhood Chain (chain 4663). No audit. Every number is read by your browser straight from public chain nodes.`
- **After:** `Open-source ERC-4626 vaults wrapping tokenized stocks on Robinhood Chain (chain 4663). No audit. No dashboard. Every number is read by your browser straight from public chain nodes.`
- **Why:** two-beat negatives read as confidence, not deficiency, and "No dashboard" is the agent-first differentiator the hero never states. Both negatives are already ratified site claims (hero-fact "Audit status: None.", index.html:179; agents section "There is no dashboard to log into", index.html:489).
- **Guards:** both claims exist verbatim elsewhere on the page; no new assertion.
- **Effort:** S · **Impact:** 3 · **Tests:** none found.

### 11. Static BACKED / inv-stat first-paint — stale claim becomes a pointer to the read
- **Anchor:** `site/index.html:161` and `:431` (both cells; keep identical, as today)
- **Before (both):** `awaiting address wiring — coverage goes live when the vault address is published`
- **After (both):** `read live via backingCoverage() — the vault address is pinned in js/config.js`
- **Why:** the static string is now FALSE by staleness: the address IS pinned (config.js:152) and coverage renders live the moment scripts run. The new line is true for both audiences (no-JS users get the read name + where the address lives; JS users get what they're about to see) and follows the page's own convention of naming the read by name (agent-first.test.js:213 asserts `backingCoverage()` appears in the HTML).
- **Guards:** more true, not less. The unreachable not-deployed branch constant (`PENDING_COVERAGE_TEXT`, main.js:808) stays as-is — it is semantically correct for its branch.
- **Effort:** S · **Impact:** 3 (truth-fix) · **Tests:** RE-PIN REQUIRED — `site-tests/agent-first.test.js:208-210` pins `countOccurrences(html, pending) === 2` for the old string; same assertion shape, new string.

### 12. APR footnote label — kill the stutter, keep the required label
- **Anchor:** `site/index.html:301`
- **Before:** `Projected depositor APR — projected, methodology-linked`
- **After:** `Depositor APR — projected, methodology-linked`
- **Why:** "Projected… projected" in one line is exactly the kind of imprecision the page elsewhere refuses. The REQUIRED label suffix stays byte-identical.
- **Guards:** the mandated "projected, methodology-linked" label is untouched (apr.js:39 `LABEL`; pinned at wow.test.js:162 and render.test.js:336 — both check the suffix, which survives).
- **Effort:** S · **Impact:** 2 · **Tests:** suffix pins unaffected.

### 13. Hero ledger fail chip — describe the sight, not the policy
- **Anchor:** `site/js/main.js:292-293`
- **Before:** `rpc unreachable — honest states shown, never estimates`
- **After:** `rpc unreachable — the rows below show the gap, not a guess`
- **Why:** the current line describes itself ("honest states"); the new one describes what the user is looking at. Concrete beats meta in this voice — same family as "the row says so instead of estimating" (index.html:140).
- **Guards:** same truth; the rows do render "unavailable (RPC)".
- **Effort:** S · **Impact:** 2 · **Tests:** none found.

### 14. Price row degraded — the one "(feed)" that can afford a clause
- **Anchor:** `site/js/main.js:228`
- **Before:** `unavailable (feed)`
- **After:** `unavailable (feed — no invented price)`
- **Why:** the `(RPC)`/`(feed)` parenthetical idiom already names the culprit — good system copy — and this one instance gains the brand's refusal at negligible length.
- **Guards:** true (feed failure → no price anywhere; chips/band go `''`). Do NOT extend this to "unavailable (RPC)" — that idiom is pinned as an exact string (render-degrade.test.js:165-169) and appears 10+ times; it stays.
- **Effort:** S · **Impact:** 2 · **Tests:** none found on this string.

---

## Where NOT to touch (the voice is already at ceiling)

Editing these would be over-playing a hand that is already played perfectly:

- **Hero h1 + lede** (`index.html:105,109`) — h1 is byte-pinned (theme.test.js:249) and "no trust in us, an auditor, or a screenshot required" needs nobody's help.
- **Hero-facts pills** (`index.html:164-181`) — "Audit status: None." is the driest line on the page. Do not improve it.
- **Flow caption** (`index.html:272`) — "a footnote among flowing quantities, never a promise" is the voice's best sentence after the flagship two. Untouchable.
- **Sim region sub** (`index.html:401`) — "the projection is a rate, not a promise — moving your deposit does not move the rate" already does pair 2's job one line over.
- **Wallet error strings** (`wallet.js:226-259`) — "You rejected the request in your wallet. Nothing was sent." is flawless deadpan. Every mapped error there stays.
- **Pending vault status** (`main.js:262`) — "no numbers below pretend otherwise" is already the register (and the branch is currently unreachable anyway).
- **LAUNCH_FACT set** (`main.js:20`) — single-sourced, double test-pinned (agent-first.test.js:244-291, wow.test.js:184-189), and the pending/deployed flip is a sibling wave's carrier contract. Off-limits here.
- **`unavailable (RPC)` row-value idiom** — pinned exact (render-degrade.test.js:165-169); the parenthetical naming the culprit is already good system copy.
- **Footer flagship line** (`index.html:512`) — it IS the voice.

## Observations (adjacent, not proposed)

1. **Provenance line appears 3×** — "read by your browser … no backend, no keys(-ish)" at `index.html:140`, `:175`, and `main.js:888`. The R3 IMP-4 fact-dedup precedent (the ledger's duplicated fee-split row was removed for exactly this) suggests the owning session may want to dedup; not proposed here because consolidation is a restructuring decision, and the card-note pair (#5) already improves the third instance in place.
2. **"yield phase live" vs "the harvester LP is not yet seeded"** — LAUNCH_FACT.deployed (main.js:20, test-pinned, rendered in the hero ledger row 4, flow node, and pending-tag surface) coexists with methodology.md's unseeded-LP fact. Pre-existing tension owned by the flip carrier; flagged so nobody "fixes" it piecemeal.
3. **Test-coupling map for implementers:** strings pinned byte-exact or by count — h1 (theme.test.js:249), LAUNCH_FACT literals + static-span byte-equality (agent-first.test.js:244-291, wow.test.js:184-189), pending-coverage count=2 (agent-first.test.js:208-210), `unavailable (RPC)` exact (render-degrade.test.js:165-169), `projected, methodology-linked` (wow.test.js:162, render.test.js:336, apr.test.js:166), mint-card mono row anatomy (agent-first.test.js:195-201). Pairs 2, 11 above carry explicit re-pin notes; all others tested clean by grep.
