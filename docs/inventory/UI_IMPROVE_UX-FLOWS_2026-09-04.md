# UI Improve — UX-FLOWS lens (2026-09-04)

**Scope:** analysis-only proposals, zero code edits. Judge against the ratified design law (`docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md` — paper/ink/serif/green, deadpan wit, "checkable not sellable") and the feature inventory (`docs/inventory/FRONTEND_MAP_2026-09-04.md`). Read at HEAD `2cf5fc9` with the worktree's minor drift (img/compressed paths + skill mirror link); all `file:line` cites refer to the worktree as read on 2026-09-04.

**Method:** walked five journeys end-to-end against the shipped code: (a) first-visit comprehension, (b) deposit flow incl. every degraded state, (c) redeem flow, (d) return-visit holder, (e) skeptic trust checkpoints. Every claim is cited. Two structural facts drive the top rankings: the frontend **never reads the vault's own pause state** (`readVaultSnapshot` is exported but has no caller) and **never displays the holder's share balance** (only underlying + allowance).

**Invariants respected:** every proposal reads via browser `eth_call` against `config.rpc.endpoints` — zero `/api/*` dependencies (D8, config.js:274-283). Every proposal fits the ledger anatomy (mono labels, 1px/2px borders, tabular figures) — no new surfaces, no confetti, no motion added. Honesty guards: no yield promises, no owner language, degraded states tell the truth. Type tags: **[copy]** = pure copy/static markup, **[CSS]** = stylesheet only, **[JS]** = module logic.

---

## Ranked proposals

### 1. Deposit-pause gate — stop letting users sign doomed transactions
- **Anchor:** `site/js/vault.js:278-305` (`readVaultSnapshot` reads the vault's `paused()` — exported at :318 but **never called**); `site/js/main.js:1017-1026` (widget gates only on `hasWallet && deployed`); `site/js/wallet.js:248-256` (revert decode handles **only** `Error(string)` 0x08c379a0); `skills/wellstreet-vaults/SKILL.md:48,112,158` (`maxDeposit` returns 0 when paused; `depositsPaused()`; deposit reverts `DepositsPaused` — a custom error the current decoder cannot render).
- **What changes:** one extra `eth_call` (`depositsPaused()` or `maxDeposit(address)`) folded into the widget's read pass; when paused, disable deposit/mint buttons and render an honest status row: "Deposits are paused on the vault. Redemptions are never pausable — exits stay open." Also surface the underlying's `issuer-paused` state (already read at main.js:223) as a widget warning.
- **Why:** journey (b)'s missing degraded state. Today a paused vault renders a fully enabled widget; the user signs, pays gas, and gets a raw undecoded revert. This is the single largest gap between the page's honesty law and its write path.
- **Effort:** M · **Impact:** 5 · **Type:** [JS]
- **Honesty guard:** strengthens it — the pause model is already disclosed in prose (SKILL.md:145, index.html:319); this makes the UI state match the contract truth. Copy states the pause, never guesses its duration.

### 2. Position truth — show the holder their ws-SPY
- **Anchor:** `site/js/main.js:1047-1068` (`refreshBalances` reads only underlying `balanceOf` + `allowance` — the **share balance is never displayed anywhere on the page**); `site/index.html:368` (`#wallet-balances` mount).
- **What changes:** extend the same read pass with `balanceOf(vault, user)` + `convertToAssets(1e18)` (both already implemented in `vault.js:278-305`, currently unconsumed): "Your ws-SPY: 12.4031 · ≈ 12.45 SPY at the current share price." Rendered in the existing mono balance row.
- **Why:** journeys (b)/(c)/(d). A depositor who confirms a deposit sees no position; a redeemer cannot size a redeem without knowing their share balance; a return-visit holder has nothing personal to check — the entire holder journey is invisible. This one read closes all three.
- **Effort:** M · **Impact:** 5 · **Type:** [JS]
- **Honesty guard:** the ≈ figure must carry "at the current share price" and read the live `convertToAssets`, never multiply by the projected APR or round up. No value promise beyond the verified read.

### 3. Redeem unit disambiguation + live preview
- **Anchor:** `site/index.html:352-358` (one input labeled "shares for redeem / SPY for withdraw" driving both buttons); `site/js/main.js:1174-1187` (both flows parse the same `#red-amount` verbatim).
- **What changes:** the active action's unit owns the label ("Amount (shares)" vs "Amount (SPY)" — swap on button focus/selection), plus a live preview row via `previewRedeem`/`previewWithdraw` eth_call: "≈ 12.40 SPY out at the current rate."
- **Why:** journey (c)'s money-path hazard. ERC-4626's classic trap: a user types `10` thinking SPY, clicks "Redeem shares", and redeems 10 **shares** (a very different SPY amount). Nothing in the current UI disambiguates until the wallet popup — after signature intent is formed. The preview also gives the redeem flow the same "checkable" texture the deposit side gets from the mint ticket.
- **Effort:** M · **Impact:** 5 · **Type:** [JS] (+[copy] for labels)
- **Honesty guard:** preview labeled "at the current rate — the chain prices the final amount," never "you will receive."

### 4. Flow-diagram deposit node — bind the stale sub-label to the isDeployed seam
- **Anchor:** `site/index.html:256` (static "schematic — deposits activate when the vault deploys"); `site/js/main.js:675-691` (`setFlowVaultState` upgrades the **vault node only** — the deposit node's sub-label has no writer).
- **What changes:** give the sub-label an id and write it from the same seam: deployed → "open — approve the vault, then deposit" (deadpan); pending → the current sentence.
- **Why:** journey (a)/(b) truth-drift. The vault **has** deployed (config.js:152, F-01 2026-09-03) and the widget is live, but the diagram's first node still tells the visitor deposits are not open — a direct contradiction one screen above the enabled widget. Every other state-bearing surface reads the seam; this one was missed.
- **Effort:** S · **Impact:** 4 · **Type:** [JS]+[copy]
- **Honesty guard:** pure truth repair — removes a stale claim, adds none.

### 5. Static/noscript first paint — retire the stale pre-JS coverage sentence
- **Anchor:** `site/index.html:161` (`#mint-backed` static text "awaiting address wiring — coverage goes live when the vault address is published") and `:431` (`#inv-stat`, same string). JS overwrites both on a successful read (main.js:810-823), but with JS off — the exact user the noscript note addresses (index.html:27-34) — the page asserts the address is unpublished. It is published and pinned (config.js:152).
- **What changes:** static text → "coverage reads live from `backingCoverage()` on the vault at `0x3a1c…a01` (js/config.js); verify it yourself with any RPC client." Keep the JS fill seam unchanged.
- **Why:** journey (e). The skeptic who disables JS — the most paranoid reader — is served the one stale claim on the page. The noscript contract ("nothing is hidden behind it") demands the static paint stay true post-deploy.
- **Effort:** S · **Impact:** 4 · **Type:** [copy]
- **Honesty guard:** the fix **is** the honesty guard; current text is a false claim about deployment state.

### 6. Approval affordance — show whether approve is needed, and a MAX setter
- **Anchor:** `site/js/main.js:1057` (allowance already read), `:1160-1166` (approve flow never consults it), `site/index.html:329-342` (deposit field with no balance shortcut).
- **What changes:** (i) when the parsed amount ≤ current allowance, the approve button gets a quiet suffix "(allowance covers this)" instead of implying step 1 is mandatory; (ii) a mono "max" setter beside the deposit input fills the field from the read balance. Never auto-suggest or execute an unlimited approval.
- **Why:** journey (b). The two-step approve→deposit is presented as a fixed ritual (buttons "1 · Approve" / "2 · Deposit"); users re-approve blind or skip step 1 and revert. Both affordances are made of reads the page already performs.
- **Effort:** S-M · **Impact:** 4 · **Type:** [JS]+[copy]
- **Honesty guard:** neutral, mechanical copy; the bounded-approval rule (SKILL.md fail-closed rules) is respected — no `2^256` suggestion.

### 7. Disabled-state reasons must survive touch — and Connect must come first
- **Anchor:** `site/js/main.js:1020-1026` (button reasons live in `title=""` — **tooltips do not exist on touch**); `site/index.html:322-366` (both panels render before the Connect button at :364-366).
- **What changes:** render the gate reason as visible status text (the `#widget-status` row already exists and is the right ledger anatomy): "Connect a wallet to open these." Optionally move Connect above the panels or echo a one-line state into each panel head.
- **Why:** journey (a)/(b). A mobile-first degen tapping "Deposit →" lands on two dead panels whose only explanation is a hover tooltip; the connect affordance sits below the fold of the dead thing. The page's own money-path ergonomics notes (style.css:306) treat mobile as first-class — the state copy should too.
- **Effort:** S · **Impact:** 4 · **Type:** [JS]+[copy] (optionally [CSS] for ordering)
- **Honesty guard:** visible reasons, zero new claims.

### 8. Wallet-absent guidance — the mobile-wallet hint
- **Anchor:** `site/js/main.js:1072-1076` (`connectWallet` does nothing until clicked); `site/js/wallet.js:69-75` (`WS_NO_PROVIDER` error exists but is reactive); `site/js/main.js:1412` (`isAvailable()` consulted only to wire event handlers).
- **What changes:** at init, if no provider is available, render one deadpan line in `#widget-status`: "No wallet detected. On desktop, install a browser wallet; on mobile, open this page in your wallet's built-in browser." Nothing else changes until connect.
- **Why:** journey (b)'s entry step. Mobile degens — the dominant wallet audience — hit a silent wall: the page never says the site works inside MetaMask/Rainbow's browser. The hint is true, mechanism-level, and self-diagnosing.
- **Effort:** S · **Impact:** 4 · **Type:** [JS]+[copy]
- **Honesty guard:** states only what the code verifies (`isAvailable()` false); no wallet names, no endorsement.

### 9. Skeptic deep links — every claim points at its evidence
- **Anchor:** `site/index.html:177-180` (hero fact "None. Read the invariants and the threat model instead." — no links); `site/index.html:432` (`inv-disclosure` names `backingCoverage()` without the address); `site/js/main.js:260` (vault-card address rendered as plain text via `fmtAddr`, not a link).
- **What changes:** (i) hero-fact "threat model" → anchor to the docs tabs (`#doc-not-guaranteed`-style hash the docs deep-link system already supports, main.js:1218-1233); (ii) the inv-disclosure and mint-card BACKED row link `backingCoverage()` to the vault's Blockscout contract page (`config.js:50` helper exists); (iii) card addresses become explorer links. Copy + `href`s only.
- **Why:** journey (e). The page's whole pitch is "checkable" — but the checkable objects are unclickable text. The skeptic's path from claim to evidence should be one tap.
- **Effort:** S · **Impact:** 3 · **Type:** [copy]+[JS] (linkify `fmtAddr` sites)
- **Honesty guard:** links to neutral evidence (explorer, own docs); zero new language.

### 10. Acquire path — make "how do I get SPY" a route, not a reference
- **Anchor:** `site/js/main.js:1033-1037` (deployed-branch acquire note: raw `SwapRouter02 0xCaf6…` + "quotes via QuoterV2" as unlinked mono prose); `site/index.html:370` (`#acquire-note`).
- **What changes:** linkify the router address to `explorerAddress()` and restructure to two deadpan sentences: "The vault accepts only SPY. Get it on-chain first — swap WETH → SPY on the SPY/WETH pool via SwapRouter02 (address), or bring your own." Add a "gas exists on 4663" half-line if it fits.
- **Why:** journey (a)/(b). The first-visit degen's real blocker is upstream of the deposit: they need the underlying token. The info is present but formatted as a contract citation rather than an instruction — the difference between comprehending in 10 seconds and bouncing.
- **Effort:** S · **Impact:** 3 · **Type:** [copy]+[JS]
- **Honesty guard:** names only verified contracts from config; no swap guarantee implied.

### 11. Wrong-network state — don't call it "not connected"
- **Anchor:** `site/js/main.js:1412-1415` (`accountsChanged`/`chainChanged` both hard-reset `state.wallet = null` → status reads "Not connected — connect a wallet to interact", main.js:1040); `site/js/wallet.js:83-86` (re-connect does auto-switch via `ensureChain`).
- **What changes:** on `chainChanged`, keep the account and render the true state: "Wrong network — your wallet is on chain N. Switch to 4663 (the button re-tries the switch)." Only `accountsChanged` fully disconnects.
- **Why:** journey (b) degraded state. A user who flips networks mid-session gets a false diagnosis ("not connected") that costs one confusing re-connect round-trip to recover from. The recovery machinery already exists; the state just mislabels it.
- **Effort:** S-M · **Impact:** 3 · **Type:** [JS]+[copy]
- **Honesty guard:** the status names the actual condition — this proposal removes a misleading one.

### 12. Post-transaction refresh beat — the ledger notices your deposit
- **Anchor:** `site/js/main.js:1132-1152` (`confirmTx` reports the receipt); `:1192-1195` (`finally` re-renders the widget → balances, but the hero ledger / cards / tape wait up to 60s — `REFRESH_MS`, main.js:82).
- **What changes:** on a `confirmed` outcome, schedule one immediate `refreshCards()` (respecting the existing `flowPending`/visibility gates) so the vault card, backing cell and tape reflect the new deposit within seconds.
- **Why:** journeys (b)/(d). The moment of maximum attention — right after a confirmed deposit — is when the page's "live reads" identity is least visible: your balances update but every published figure stands still for up to a minute. The refresh beat makes the ledger behave like a ledger.
- **Effort:** S · **Impact:** 3 · **Type:** [JS]
- **Honesty guard:** triggers a **real** re-read of the same pipeline — no optimistic/predicted figures anywhere; if the read fails, the honest unavailable states stay.

---

## Cross-cutting notes

- **D8 (serverless-clean):** every proposal consumes or extends existing browser `eth_call` reads (`vault.js` modules, config endpoints). No proposal adds a fetch host or touches `/api/*`. Proposal 1's pause read and Proposal 2's share read slot into the existing parallel-read pattern (main.js:855-860) and the RPC retry/failover path.
- **Aesthetic fit:** all proposals render inside the established ledger anatomy (`.ledger-row`/`.card-row`/`.flag`/mono status text) — the mint-ticket, the widget status box, the flow node. The tone throughout is the ratified deadpan: short declaratives ("Deposits are paused. Redemptions never are."), no exclamation marks, no emoji, no motion added. Proposal 12 is the only behavioral "aliveness" change and it is diff-driven from real reads, the WOW-batch's own rule (main.js:544-547 first-render-no-flash discipline should be reused).
- **Test surface:** proposals 1, 2, 3, 11, 12 touch read/parse logic covered by `site-tests/wallet.test.js`, `vault-coverage.test.js`, `render.test.js`; proposal 5's static copy is byte-pinned adjacent to `wow.test.js`'s launch-fact pins (main.js:20) — re-pin in the same change per the design law's constraint block.
- **Not proposed (deliberately):** a share-price chart (fabricates a time series the pipeline does not have), a portfolio USD-total card (duplicates Proposal 2's honest ≈ row with more overclaim surface), toast notifications (the `#widget-status` box is the page's voice), and any "connect" modal (the inline picker at main.js:1094-1106 is already the right weight).
