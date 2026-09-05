# UI-IMPROVE-2 — Companion Skin Token-Diff Specification (2026-09-05)

**Scope:** analysis only, zero site edits. Worktree HEAD `048718f` (two canyon-hero fix commits on top of the mapping brief's `28208df`); `site/css/style.css` carries staged+unstaged worktree deltas (MM) — line numbers below are the worktree as read.
**Inputs:** `docs/inventory/FRONTEND_MAP_2026-09-04.md` (§1 #42, §5 theme.test.js), `docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md`, full read of `site/css/style.css` (1,508 ln) and `site/index.html` (591 ln), measured palettes of all 8 `site/img/` assets and the design-kit source shots, WCAG contrast computed with the exact luminance function `site-tests/theme.test.js` uses (validated: reproduces the documented 5.4 / 5.6 / 4.9 / 6.6 / 4.9 ratios to rounding).

**Question answered:** what would a DARK-PAPER companion skin cost (every token inverted/re-authored), what would a second paper variant (warmer kraft, per the design-kit shots) cost, which hardcoded escape hatches would break a skin swap, and is `prefers-color-scheme` auto-switching worth it for this brand.

---

## 1. How tokenized the site actually is

The skin-swap surface is **26 color-bearing custom properties across three `:root` blocks** (`style.css:13-41`, `:524-592`, `:764-770`). Everything else in the token system is skin-invariant:

- **Fonts** `--mono/--sans/--serif`; **motion** `--t-fast/--t-base/--t-slow/--ease-enter/--ease-loop/--motion` (+ `--ws-vibrate-period`, `--ws-entrance-delay`, the chip layout vars `--chip-tx/--chip-rot/--chip-in-delay/--chip-float-dur/--chip-float-delay`); **space** `--space-0…64`; **type** `--step-1…21`; **layout** `--wrap-max`; **radii** `--radius/--radius-soft`; **sizing** `--ws-trust-size`. None of these change in any skin.
- **JS is completely color-clean.** `grep` across `site/js/*.js` finds zero hex/rgb/hsl literals; the only inline style write is a delay token (`main.js:1447`, `--ws-entrance-delay`). The resource-gate/theme discipline held: every color decision lives in the `:root` blocks or in the escape hatches enumerated in §3.

So on tokens alone, both companion skins are one extra `:root` block each. The real cost is elsewhere (§3–§5).

## 2. Token-diff specification

Ratios are WCAG contrast computed with the theme-test luminance math; "paper/p2/raised" = the named skin's surfaces. Every proposed value clears ≥4.5:1 for its text roles unless flagged. Dark values are deliberately **fresh** hexes — the theme test's LEGACY_HEXES ban list (`site-tests/theme.test.js` test (d)) already bans every dark-era value (`#17171a`, `#131316`, `#2ec27e`, `#3ad18e`, `#3fe396`, `#011A25`, `#e0654a`, the `rgba(46,194,126`/`rgba(224,101,74`/`rgba(255,255,255` families, `#000`/`#fff` substrings), so a dark skin **cannot** resurrect the 2026-09-01 dark identity's palette even by accident.

### 2a. DARK-PAPER companion skin (ink substrate, cream ink, green accent kept)

| Token | Current (light) | Dark-paper value | Contrast (dark surfaces) | Role note |
|---|---|---|---|---|
| `--paper` | `#EDE9DC` | `#171512` | — | substrate; warm near-black (NOT banned `#17171a`) |
| `--paper-2` | `#E4DFD1` | `#211E19` | ink 13.08 | second surface (heads, tabs, inputs) |
| `--paper-raised` | `#F3EFE3` | `#26221C` | ink 12.45 | cards/panels |
| `--paper-pending` | `#E7E2D4` | `#1B1815` | ink 13.92 | pending card darker than paper-2, mirroring light's relationship |
| `--ink` | `#1C1A15` | `#E9E4D6` | 14.35 paper / 13.08 p2 | text flips to warm cream |
| `--ink-soft` | `#5C584C` | `#A39C8B` | 6.67 paper / 5.79 raised / 6.47 pending | muted text |
| `--line` | `#C8C1AD` | `#4A4438` | 1.89 vs paper (light hairline = 1.48) | non-text hairline; slightly stronger reads correctly on dark |
| `--line-dotted` | `#AFA892` | `#5C5546` | ~2.5 vs paper (light 1.96) | dotted hairlines |
| `--accent` | `#00A86B` | **`#00A86B` (keep)** | 5.91 vs paper | fill role unchanged — pops *more* on dark |
| `--accent-ink` | `#1C1A15` | **`#1C1A15` (keep)** | 5.64 on the unchanged fill | text-on-fill unchanged |
| `--accent-text` | `#0d6b4f` | `#4E9E7B` | 5.64 paper / 5.14 p2 / 4.90 raised | **direction inverts** (mirrors the punch-invert note at `style.css:765-768`): accent-as-text becomes the *brighter/desaturated* step |
| `--accent-punch` | `#006B45` | `#35D494` | 9.54 paper | h1 punch = brightest tint on dark (the dark-era convention, fresh hex) |
| `--accent-hover` | `#0FB879` | `#12C57E` | 7.71 vs `--accent-ink` text | hover brightens on dark, same direction as light |
| `--accent-visited` | `#3A6B58` | `#4B9473` | 5.02 paper / 4.57 p2 / **4.35 raised — flag** | docs-pane links sit on paper-raised; either accept 4.35 for visited-only or collide with `--accent-text` (`#4E9E7B`) |
| `--warn` | `#a33a24` | `#DC7052` | 5.63 paper / 5.13 p2 / 4.76 on warn-bg | honest red, lightened for dark |
| `--warn-bg` | `#EFD9D1` | `#33201B` | warn-on-it 4.76 | pending-tag/banner surface |
| `--code-bg` | `#E0D9C9` | `#23201A` | ink 12.79 | code surface |
| `--chip-tan` | `#D9CFB4` | `#4E4636` | ink-on-it 7.34 (light 11.2) | tan pill stays warm but dark |
| `--ws-trust-bg` | `#F4F0E4` | `#1E1B16` | ink 13.51 | trust pills |
| `--ws-trust-border` | `#C8C1AD` | `#4A4438` | — | = `--line` alias |
| `--ws-trust-text` | `#5C584C` | `#A39C8B` | 6.28 on trust-bg | = `--ink-soft` alias |
| `--ink-deep` | `#E2DCCB` | `#0F0E0B` | — | footer band re-pins DARK (deeper than paper), inverting the light flip's paper-family footer |
| `--footer-muted` | `#4E4939` (6.56 on ink-deep) | `#B5AD9C` | 8.66 | mirrors light's structure with headroom |
| `--footer-faint` | `#615C4C` (4.88) | `#8F887A` | 5.49 | clears AA |
| `--shadow-soft` | `0 20px 28px rgba(28, 26, 21, 0.10)` | `0 20px 28px rgba(0, 0, 0, 0.40)` | — | black shadows deepen on dark; ⚠ the exact strings `rgba(0,0,0,0.55)`/`rgba(0,0,0,0.7)` are test-banned — author spaced/different alphas and re-pin the ban list |
| `--shadow-soft-hover` | `0 24px 40px rgba(28, 26, 21, 0.16)` | `0 24px 40px rgba(0, 0, 0, 0.55)` | — | same caveat |
| `--accent-punch` (block 3) | `#006B45` | `#35D494` | 9.54 | re-pinned in the third `:root` (`style.css:769`) — a skin block must shadow it there or later in the cascade |

Everything else (fonts, motion, space, type, radii, wrap) carries over byte-identical.

### 2b. KRAFT second paper variant (warmer kraft substrate, same ink, same green)

Grounded in the design-kit's own paper temperatures, measured from the source shots: neutral cream `#E7DFD4` (`well1.png`, the hero drafts' family — what shipped), mild kraft `#E1D4C1` (`photo_2026-09-04_11-10-22.png`), deep kraft `#E6C59C` (the logo-source thumbs-up shot `11-11-05.png`). The spec below sits between mild and deep kraft.

| Token | Current (light) | Kraft value | Contrast (kraft surfaces) | Role note |
|---|---|---|---|---|
| `--paper` | `#EDE9DC` | `#E8DCC3` | — | kraft substrate |
| `--paper-2` | `#E4DFD1` | `#DDD0B2` | ink 11.37 | |
| `--paper-raised` | `#F3EFE3` | `#F1E8D2` | ink 14.25 | |
| `--paper-pending` | `#E7E2D4` | `#E0D4B8` | ink 11.82 | |
| `--ink` | `#1C1A15` | **keep** | 12.80 paper | same ink |
| `--ink-soft` | `#5C584C` | `#5E5643` | 5.35 paper / 4.76 p2 | warmer mute |
| `--line` | `#C8C1AD` | `#BFB184` | 1.57 (light 1.48) | hairline mirror |
| `--line-dotted` | `#AFA892` | `#A2946E` | ~2.0 | |
| `--accent` | `#00A86B` | **keep** | — | |
| `--accent-ink` | `#1C1A15` | **keep** | 5.5 on the fill | |
| `--accent-text` | `#0d6b4f` | `#0A5C42` | 5.89 paper / 5.24 p2 / 6.56 raised | kraft is darker than cream → text green goes darker |
| `--accent-punch` | `#006B45` | `#0B4A36` | 7.55 paper / 6.71 p2 | |
| `--accent-hover` | `#0FB879` | **keep** | 6.75 vs ink text | |
| `--accent-visited` | `#3A6B58` | `#2E5A45` | 5.80 paper / 5.16 p2 / 6.46 raised | current value would drop to 4.51/4.01 on kraft — must re-derive |
| `--warn` | `#a33a24` | `#9C3520` | 5.25 paper / 4.67 p2 | deeper red on the warmer ground |
| `--warn-bg` | `#EFD9D1` | `#EAD2C4` | warn-on-it 4.93 | |
| `--code-bg` | `#E0D9C9` | `#D8CAA8` | ink 10.71; ink-soft 4.48 (marginal — matches the existing light-skin condition) | |
| `--chip-tan` | `#D9CFB4` | `#D2C092` | ink-on-it 9.68 | |
| `--ws-trust-bg` | `#F4F0E4` | `#EFE5CB` | ink 13.86 | |
| `--ws-trust-border` | `#C8C1AD` | `#BFB184` | — | = `--line` |
| `--ws-trust-text` | `#5C584C` | `#5E5643` | 5.80 on trust-bg | |
| `--ink-deep` | `#E2DCCB` | `#D3C4A0` | — | kraft-family footer |
| `--footer-muted` | `#4E4939` | `#4A4331` | 5.69 (light 6.56) | ≥4.5, slightly less headroom |
| `--footer-faint` | `#615C4C` | `#564E3A` | 4.78 (light 4.88) | |
| `--shadow-soft` | rgba(28,26,21,0.10) | **keep** | — | ink-based shadows work on kraft unchanged |
| `--shadow-soft-hover` | rgba(28,26,21,0.16) | **keep** | — | |
| `--accent-punch` (block 3) | `#006B45` | `#0B4A36` | 7.55 | third-block shadow, same note as dark |

**Kraft's hidden advantage:** the keeper cutouts were generated on kraft/tan paper — the assets themselves carry kraft fringes (`#DECBB1`, `#B2A896`, `#B2A896` measured in the hand PNGs). On the shipped NEUTRAL cream page they sit with a faint warm-halo mismatch; a kraft page would *harmonize* them. Kraft needs **zero asset work** — it is genuinely the near-free skin at the token level.

## 3. Escape hatches — every hardcoded color a skin swap would miss

Verified by grep for hex/rgba/hsl across `site/css/style.css`, `site/index.html`, `site/js/`. The discipline mostly held; these are the strays and the structural exceptions:

**In CSS (4 sites):**
1. `::selection` — `rgba(0,168,107,0.35)` literal, `style.css:64`. Selection tint does not re-derive from `--accent`; a skin needs either a token (`--accent-rgb` triplet) or a per-skin literal.
2. WOW-7 delta keyframes — `rgba(0, 168, 107, 0.16)` up-flash and `rgba(163, 58, 36, 0.16)` down-flash inside `@keyframes`, `style.css:1042/1046`. Keyframe declarations cannot read re-authored fill tokens unless the rgb triplet is tokenized. On dark, 0.16-alpha green/red flashes read differently — re-tune per skin.
3. Geo-block card — `#fbfaf5` + `#fff` literals, `style.css:476-477`. **Documented, deliberate exception** (D14 byte-freeze; theme.test (e) pins `#fbfaf5` == exactly 1). A skin swap leaves the dormant geo page light; do NOT edit the frozen lines — the exemption is by design.
4. Shadow tokens (`style.css:589-590`) are token *values* (re-authorable), but their warm-ink `rgba(28,26,21,…)` base and the theme test's exact-string bans (`rgba(0,0,0,0.55)`, `rgba(0,0,0,0.7)`) constrain what a dark skin may write without re-pinning the battery.

**In HTML (4 sites):**
5. `<meta name="theme-color" content="#EDE9DC">` — `index.html:17`. Test (b) pins it == the first `--paper` value. One value per document; a second skin can't express two.
6. `color-scheme` — `style="color-scheme: light"` on `<html>` (`index.html:2`) + `<meta name="color-scheme" content="light">` (`index.html:18`). Test (b) pins light AND pins dark metas ABSENT.
7. Favicon data-URI — `%23E4DFD1` (paper-2) + `%231C1A15` (ink), `index.html:24`. URL-encoded, invisible to the hex bans; test (d) resolves the light tokens dynamically and asserts the data-URI matches them. A data-URI cannot read CSS vars; per-skin favicons need a JS swap or stay light.
8. Hero motif inline SVG — six `rgba(0,168,107,α)` presentation attributes (`index.html:83-91`), alphas 0.09–0.25. **Presentation attributes cannot read `var()`** — the only true HTML escape hatch that is also load-bearing. Test (d) pins "exactly six sites." On dark, α=0.09–0.14 greens are near-invisible (the fill green is 5.91:1 on dark paper but 9%-alpha strokes die); a dark skin needs the alphas re-tuned, which means either a per-skin SVG variant, classes + CSS-side `stroke`, or re-pinning the six-site count.

**In the asset layer (7 files + 1 — cannot be token-restyled at all):**
9. `site/img/canyon-hero.png` — dithered canyon, 61% of opaque pixels are ink `#1D1918`, plus warm mids `#625B55`/`#A89E94`/`#DECBB1` and a cream speckle `#F2E9DB` (7.8%). **Ink-direction dither: on `#171512` the buildings vanish** (≈1.03:1). A dark skin needs a re-tinted dark variant (cream-line dither on transparency).
10-14. Keeper dithers (`img/compressed/`): `hand-point.png` (dominant `#312C28`), `hand-press.png` (`#2E2A27`), `hand-magnify.png` (`#060606`), `certificate.png` (`#B9B5AC`/`#494846` grays), `curve-stroke.png` (`#46423C` family) — all dark-ink dither cutouts; same dark-skin problem, same mechanical fix.
15. `img/logo-mark.png` — solid `#111111` silhouette, 100% of opaque pixels: invisible on dark. Needs a cream silhouette variant or a paper-plate badge treatment (the design-kit's `logo-badge.png` ring variant is the ready answer).
16. `og.png` — already stale art pending rebuild (frontend map Pending #1); it is fixed per-URL and can never follow a skin. Fold the skin decision into the owed rebuild.

All 7 PNGs are 8-bit **colormap** files — a per-skin re-tint is a mechanical palette remap (Pillow, local, zero regeneration), and the design-kit source art exists in `docs/internal/design-kit/`. The dark asset cost is real but small and scriptable.

**In the test layer (the invisible escape):**
17. `site-tests/theme.test.js` resolves each token by **first occurrence** in the stylesheet. A second `:root` skin block appended later would keep (a) positive-pins and (c) WCAG checks green **while measuring only the light skin** — the battery is structurally blind to a second skin. (b)/(d)/(e) pin light-only metas, the ban list, and the geo freeze. Any skin work therefore requires a second (or per-skin-parameterized) contract battery — the current discipline does not extend automatically. Corollary: the current battery would NOT catch a dark-skin contrast regression; the six-pair check must be re-run per skin.

## 4. `prefers-color-scheme` — verdict

**Not worth it for this brand, and specifically not now.**

1. **The substrate IS the voice.** "Checkable, not sellable" is expressed as a paper ledger — ink-on-cream, hatched separators, hard borders, mono metadata edges. That is the differentiation against every dark-UI degen competitor (and the ratified identity #4 is five days old after four identity revisions in a week). Auto-switching hands ~half of visitors a skin the brand never ratified, and the punch/accent-text direction logic inverts per substrate — two brands' worth of typography decisions to maintain.
2. **The asset layer makes auto-switching a full project, not a toggle.** The canyon hero, five keepers, and the logo are all ink-direction dithers (§3.9–15). An OS-preference-triggered dark mode with the current assets ships an invisible hero. The honest dark mode ships 7 re-tinned assets + favicon strategy + og decision + a new test battery.
3. **The audience argument is real but insufficient.** Degens do live in dark mode; agents don't render themes at all. If dark-mode demand ever shows up, the token diff above is the ready spec — but it should ship as a **deliberate, persisted, user-chosen toggle**, never as an OS mirror, because the brand's one-substrate discipline is the thing being protected.

## 5. Recommendation

- **Ship neither skin now.** The identity just consolidated (paper/ink/green, revision #4); the marginal value of a second skin is negative while the hero composition and pending product surfaces (family vault #2, LP seed, $WELL launch) are still landing.
- **Dark-paper: LATER, as a manual toggle only** (`html[data-theme="dark"]` + localStorage, light default, no `prefers-color-scheme` auto-switch). Prerequisites when it happens: the §2a token block, 7 re-tinned colormap PNGs (mechanical), motif alpha re-tune + six-site re-pin, favicon decision (light-forever is acceptable), `theme.test.js` per-skin parameterization, og.png rebuild picking one canonical skin. Everything needed is specified above.
- **Kraft: never as a shipped variant; park the spec.** It is genuinely near-free (one `:root`, zero asset work, and it would harmonize the keepers' kraft fringes), but it splits a one-substrate brand for no audience need. Its real future use is as the fallback palette if a future re-skin ever wants warmer ground — the §2b table is that decision, pre-measured.

**Net:** the token architecture makes both companion skins ~90% free; the escape hatches are few and enumerated (4 CSS + 4 HTML sites, mostly one-line); the true cost center is the ink-direction dither assets and the first-occurrence test contract — and that cost only becomes worth paying for a dark toggle with demonstrated demand.

---
*Method note: all contrast figures computed with the theme test's exact luminance function (validated against the documented light values 5.4/5.6/4.9/6.6/4.9 to rounding); asset palettes sampled from the shipped PNGs with Pillow (dominant opaque colors, transparency-weighted); design-kit paper temperatures sampled from the source shots. Zero files outside this document were created or modified.*
