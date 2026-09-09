'use strict';
// WS-TEST-HARDENING battery (2026-09-04) — hardens the surfaces the frontend map
// shows under-tested: docs/inventory/FRONTEND_MAP_2026-09-04.md items #39
// (agent-first section), #43 (motion system / reduced-motion pairs), #13+#19
// (mint-ticket ledger card + the backingCoverage seam), #8 (hero CTA pair) and
// #21 (launch-fact single-source writer); design authority:
// docs/internal/DESIGN_REFERENCE_ASCETIC_DEGEN_2026-09-04.md (two-tone headline
// grammar, ledger-card rows, CTA-pair discipline, MOTION MENU pairing rule).
// Dependency-free: node:test + node:assert + node:fs ONLY (theme.test.js /
// wow.test.js house style). ALL pins must PASS against the shipped tree — this
// is hardening, not red-flagging: a red assert means the CARRIER drifted, fix
// the carrier, never the assert.
// Assertions:
//   (a) the agent-first section: #agents block, two-tone headline (h2 <br> +
//       span.quiet, same grammar as hero/invariants), the skill pointer
//       (skills/wellstreet-vaults/SKILL.md) with the SKILL.md actually on disk,
//       and the https-gated repoUrl upgrade seam in main.js
//   (b) the motion system: every site/img asset referenced by the shipped
//       sources is DECLARED in ASSET_MOTION — moving assets carry their
//       prefers-reduced-motion static pair inside their own section
//       (WS-ASSET-WIRE), gated under @media (prefers-reduced-motion:
//       no-preference); STATIC assets ship no motion at all (the strongest
//       form of the pairing — a reduce rule nullifying nothing is dead text),
//       and the JS side keeps the motionAllowed() gate on the sweep
//   (c) the ledger card rows: mono labels DEPOSIT / SETTLED AT / YOU RECEIVE /
//       BACKED, the mono small-cap rule, and the BACKED cell riding the single
//       backingCoverage fill point (#mint-backed + #inv-stat, identical honest
//       pending text, isDeployed-gated, never a fabricated figure)
//   (d) the CTA pair: cta-solid -> #deposit, cta-outline -> #docs, PER-CLASS
//       :hover rules (never comma-joined) + the <=640px full-width stack
//   (e) the launch-fact writer: LAUNCH_FACT quoted-literal single-source counts
//       (quote-counting is MANDATORY — the short literal is a strict substring
//       of the long one, wow.test.js convention extended to the whole bundle)

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const siteDir = path.join(__dirname, '..', 'site');
const css = fs.readFileSync(path.join(siteDir, 'css', 'style.css'), 'utf8');
const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
const mainSrc = fs.readFileSync(path.join(siteDir, 'js', 'main.js'), 'utf8');
const JS_FILES = ['config.js', 'abi.js', 'amount.js', 'rpc.js', 'geo.js', 'vault.js',
  'apr.js', 'wallet.js', 'docs.js', 'main.js'];
const jsSources = {};
for (const name of JS_FILES) {
  jsSources[name] = fs.readFileSync(path.join(siteDir, 'js', name), 'utf8');
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// (b) THE DECLARED ASSET TABLE — RETIRED (WS-DARK-DOTO, 2026-09-07): the
// zero-image identity ships NO site/img assets, so the table is EMPTY by
// contract. It is declared in the (b) section below; the derivation there
// must see an EMPTY referenced set across html + css + all site modules.

// ---------------- (a) agent-first section ----------------
// RE-PINNED 2026-09-07 (WS-DARK-DOTO): the movement-(c) card is 'Plug in.' —
// the two-tone grammar retired with the serif voice; the skill pointer keeps
// its PENDING_IDENTITY honest byte-form and the https-gated upgrade seam.
test('(a) agent-first section: the plug-in card + skill pointer', () => {
  assert.strictEqual(countOccurrences(html, '<section class="block" id="agents">'), 1,
    'the #agents section block exists exactly once');
  const head = '<h2>Plug in.</h2>';
  assert.strictEqual(countOccurrences(html, head), 1,
    'the plug-in headline appears exactly once');
  assert.ok(/#agents \.quiet \{ color: var\(--ink-soft\); \}/.test(css),
    '#agents .quiet recede rule present (the receding register stays CSS-carried)');
  // the skill pointer: relative repo path, href == visible text (PENDING_IDENTITY
  // honest form), exactly once, and the target file actually exists on disk
  const link = '<a id="agents-skill-link" href="skills/wellstreet-vaults/SKILL.md">skills/wellstreet-vaults/SKILL.md</a>';
  assert.strictEqual(countOccurrences(html, link), 1,
    'the skill pointer anchor appears exactly once in its relative-path form');
  assert.ok(fs.existsSync(path.join(siteDir, '..', 'skills', 'wellstreet-vaults', 'SKILL.md')),
    'skills/wellstreet-vaults/SKILL.md exists on disk — the pointer never dangles');
  // the upgrade seam in main.js: ONLY a https:// repoUrl upgrades the href
  // (never a fabricated URL while branding.repoUrl is PENDING_IDENTITY)
  assert.ok(mainSrc.indexOf('agents-skill-link') !== -1, 'the skill-link upgrade seam is wired in main.js');
  assert.ok(/repoUrl\.indexOf\('https:\/\/'\) === 0/.test(mainSrc),
    'the upgrade is gated on a https:// repoUrl');
  assert.ok(mainSrc.indexOf("'/skills/wellstreet-vaults/SKILL.md'") !== -1,
    'the upgraded href reuses the same skill path');
  assert.ok(mainSrc.indexOf("'noopener'") !== -1 && mainSrc.indexOf("'_blank'") !== -1,
    'the upgraded link opens with rel=noopener target=_blank');
});

// ---------------- (b) motion system ----------------
// RE-PINNED 2026-09-07 (WS-DARK-DOTO): the zero-image identity retires EVERY
// site/img asset — the declared-asset table is empty by contract, and the
// derivation below must see an EMPTY referenced set across html + css + all
// site modules. A new img/ reference (in markup, a comment, or a url()) fails
// this battery loudly.
const ASSET_MOTION = [];

test('(b) zero referenced site/img assets (the zero-image identity, declared table empty)', () => {
  // derive the referenced set from ALL shipped sources (html + every site module
  // + the stylesheet) — comments included: a path mentioned in prose is still a
  // reference a future author could resurrect.
  const referenced = new Set();
  // subdirectory-aware: the token class includes '/' to capture the FULL path
  // (a mid-path '/' would otherwise truncate img/compressed/x.png to a phantom
  // 'img/compressed').
  const re = /img\/[A-Za-z0-9._/-]+/g;
  for (const src of [html, css].concat(JS_FILES.map((n) => jsSources[n]))) {
    let m;
    while ((m = re.exec(src)) !== null) { referenced.add(m[0]); }
  }
  const declared = new Set(ASSET_MOTION.map((a) => a[0]));
  const unknown = Array.from(referenced).filter((f) => !declared.has(f));
  assert.deepStrictEqual(unknown, [],
    'every referenced img asset must be declared in ASSET_MOTION (undeclared: ' + unknown.join(', ') + ')');
  // no dead table entries either — each declared asset is still referenced
  for (const [file] of ASSET_MOTION) {
    assert.ok(referenced.has(file), file + ' is still referenced by the shipped sources');
  }
  assert.strictEqual(referenced.size, 0,
    'the zero-image identity ships ZERO img/ references (got: ' + Array.from(referenced).join(', ') + ')');
});

test('(b2) no asset motion gates remain (the asset section is retired, not weakened)', () => {
  assert.strictEqual(css.indexOf('WS-ASSET-WIRE (2026-09-04)'), -1,
    'the WS-ASSET-WIRE section banner is gone (retired dated in style.css)');
  assert.strictEqual(css.indexOf('.asset-press'), -1, 'no .asset-press rule ships');
  assert.strictEqual(css.indexOf('.asset-draw'), -1, 'no .asset-draw rule ships');
  assert.strictEqual(css.indexOf('.asset-point'), -1, 'no .asset-point rule ships');
  assert.strictEqual(css.indexOf('.asset-magnify'), -1, 'no .asset-magnify rule ships');
  assert.strictEqual(css.indexOf('.asset-certificate'), -1, 'no .asset-certificate rule ships');
});

test('(b3) no asset base rules at all (nothing to pair, by construction)', () => {
  assert.strictEqual(css.indexOf('curve-divider'), -1, 'the curve divider is retired outright');
  assert.strictEqual(css.indexOf('hero-canyon'), -1, 'the canyon is retired outright');
  assert.strictEqual(css.indexOf('hero-motif'), -1, 'the motif is retired outright');
});

test('(b4) the curve-divider draw-on is RETIRED from main.js', () => {
  // RE-PINNED 2026-09-07 (WS-DARK-DOTO): with the curve divider gone there is
  // nothing to arm — the IO wiring is deleted outright (no dead code for a
  // dead surface).
  assert.strictEqual(countOccurrences(mainSrc, 'function initAssetDraw()'), 0,
    'initAssetDraw is deleted outright');
  assert.strictEqual(mainSrc.indexOf('initAssetDraw();'), -1, 'initAssetDraw is not wired in init()');
});

test('(b5) the global page guard stays authoritative', () => {
  const g = css.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(g !== -1, 'the global reduce guard is present');
  const head = css.slice(g, g + 200);
  assert.ok(head.indexOf('*, *::before, *::after') !== -1, 'the global guard covers every surface');
  assert.ok(head.indexOf('animation: none !important') !== -1, 'global guard nullifies animations');
  assert.ok(head.indexOf('transition: none !important') !== -1, 'global guard nullifies transitions');
  const blocks = css.match(/@media \(prefers-reduced-motion: reduce\)/g) || [];
  assert.ok(blocks.length >= 5,
    'the scoped reduce guards survive alongside the global one (got ' + blocks.length + ', need >= 5)');
});


// ---------------- (c) ledger card rows ----------------
// RE-PINNED 2026-09-07 (WS5-SKELETON): the mint-ticket ledger card and the
// invariants section are DELETED outright in the three-movement rebuild — the
// mono-label row pins (DEPOSIT / SETTLED AT / YOU RECEIVE / BACKED), the
// .mint-card .ledger-k CSS pin and the two-cell seam are retired with them.
// The backingCoverage seam survives as ONE relocated line (#fleet-coverage)
// inside the flagship fleet card's detail; the same fill contract holds.
test('(c) the coverage seam: one relocated cell rides the single fill point', () => {
  // the relocated seam cell, aria-live polite (the WS-A11Y-QUICK treatment carries over)
  assert.strictEqual(countOccurrences(html, '<span id="fleet-coverage" aria-live="polite">'), 1,
    'the coverage seam is the single relocated #fleet-coverage cell');
  const fill = mainSrc.slice(mainSrc.indexOf('function fillBackingCoverage('),
    mainSrc.indexOf('async function loadVaultData('));
  assert.ok(fill.indexOf("$('fleet-coverage')") !== -1,
    'fillBackingCoverage is the single fill point writing the relocated seam cell');
  // the static first paint carries the self-verify truth string (deployed
  // register) — re-pinned 2026-09-07 (WS-DARK-DOTO copy diet): the address
  // lives in js/config.js and the docs; the page states the seam, not the hex.
  const staticCoverage = 'live from backingCoverage() — verify it yourself with any RPC client.';
  assert.strictEqual(countOccurrences(html, staticCoverage), 1,
    'the coverage truth is exactly the ONE relocated seam cell (identical string, single carrier)');
  assert.strictEqual(countOccurrences(html, 'awaiting address wiring'), 0,
    'the stale pre-deploy coverage claim is gone from the statics (false post-deploy)');
  // seam semantics: isDeployed-gated (no eth_call pre-deploy), honest on failure
  assert.ok(fill.indexOf('WS.vault.isDeployed(') !== -1, 'the fill gates on the isDeployed seam');
  assert.ok(fill.indexOf('unavailable (RPC)') !== -1, 'a failed read renders the honest state, never a figure');
  assert.ok(mainSrc.indexOf('readBackingCoverage') !== -1, 'main.js consumes WS.vault.readBackingCoverage');
  assert.ok(html.indexOf('backingCoverage()') !== -1, 'the page discloses the backingCoverage() read by name');
  assert.ok(mainSrc.indexOf('PENDING_COVERAGE_TEXT') !== -1, 'the pending wiring-truth string is a named constant');
});

// ---------------- (d) CTA pair ----------------
// RE-PINNED 2026-09-07 (WS5-SKELETON): the solid primary anchors #fleet now —
// the goal's movement (a) re-targets it ('Open the Fleet'); the deposit widget
// moved into the flagship fleet card with its section id intact, so the
// '#deposit section present' pin survives byte-identical. Per-class :hover
// rules + the mobile stack pin are untouched (CSS-side, still green).
// ---------------- (d) THE ONE CTA ----------------
// RE-PINNED 2026-09-07 (WS-DARK-DOTO): the banner contract is ONE anchor —
// the amber solid to #fleet ('Open the Fleet'); the outline CTA is retired
// outright (markup + rules). Per-class :hover + the transition + the mobile
// stack keep their forms.
test('(d) the one CTA: solid->#fleet, amber fill, per-class :hover rule', () => {
  assert.strictEqual(countOccurrences(html, '<a class="cta-solid" href="#fleet">Open the Fleet</a>'), 1,
    'cta-solid anchors #fleet exactly once (Open the Fleet)');
  assert.strictEqual(countOccurrences(html, 'cta-outline'), 0,
    'the outline CTA is retired (one CTA, the banner contract)');
  // no dead anchors: the target is a real section in the page
  // (the deposit section survives INSIDE the flagship fleet card's detail)
  assert.ok(html.indexOf('<section class="block" id="deposit">') !== -1, '#deposit section present');
  // the hover is PER-CLASS on purpose (never a shared comma-joined hover rule):
  // the fill shifts one amber step brighter. RE-PINNED 2026-09-08 (BTN-MOTION,
  // docs/internal/BTN_MOTION_2026-09-08.md): the per-class rule gains the 1px
  // lift + the hover shadow swap + the :not(:disabled) guard — the fill-shift
  // contract itself is unchanged.
  assert.ok(css.indexOf('.cta-solid:hover:not(:disabled) { background: var(--accent-hover); color: var(--accent-ink); transform: translateY(-1px); box-shadow: var(--shadow-btn-hover); }') !== -1,
    'cta-solid has its own :hover rule (amber fill shift + the BTN-MOTION lift/shadow)');
  // the CTA keeps its transition so the hover state animates at all
  assert.ok(/\.cta-solid \{[^}]*transition:/.test(css), 'cta-solid carries its transition');
  // <=640px: the CTA stacks full-width inside the mobile media block
  const mIdx = css.indexOf('@media (max-width: 640px)');
  assert.ok(css.slice(mIdx, mIdx + 900).indexOf('.cta-row { flex-direction: column; align-items: stretch; }') !== -1,
    'the <=640px block stacks the CTA full-width');
});

// ---------------- (e) launch-fact writer ----------------
test('(e) LAUNCH_FACT single-source: quoted-literal counts, writer, byte-equal statics', () => {
  // (i) the constant is defined once; each state literal is quoted exactly once
  // in main.js. QUOTED-literal counting is mandatory — pendingShort is a strict
  // SUBSTRING of the long pending form, so naive substring counting miscounts a
  // CORRECT build.
  assert.strictEqual(countOccurrences(mainSrc, 'var LAUNCH_FACT = {'), 1, 'LAUNCH_FACT defined exactly once');
  assert.strictEqual((mainSrc.match(/'awaiting on-chain deploy'/g) || []).length, 1,
    'pendingShort quoted exactly once (strict substring of the long form — quote-counting is mandatory)');
  assert.strictEqual((mainSrc.match(/'awaiting on-chain deploy — yield phase not started'/g) || []).length, 1,
    'the long pending literal quoted exactly once (inside LAUNCH_FACT)');
  assert.strictEqual((mainSrc.match(/'deployed — yield phase live'/g) || []).length, 1,
    'the deployed literal quoted exactly once (inside LAUNCH_FACT)');
  assert.strictEqual((mainSrc.match(/'The vault is not yet on-chain[^']*'/g) || []).length, 1,
    'prosePending quoted exactly once');
  assert.strictEqual((mainSrc.match(/'The vault is on-chain[^']*'/g) || []).length, 1,
    'proseDeployed quoted exactly once');
  // (ii) single-source across the WHOLE bundle: no other site module carries a copy
  for (const name of JS_FILES) {
    if (name === 'main.js') { continue; }
    for (const lit of ['awaiting on-chain deploy', 'yield phase live', 'The vault is on-chain']) {
      assert.strictEqual(jsSources[name].indexOf(lit), -1,
        name + ' carries no launch-fact literal copy (' + lit.slice(0, 22) + '…)');
    }
  }
  // (iii) every raw literal lives on the constant line — consumers read LAUNCH_FACT
  const constStart = mainSrc.indexOf('var LAUNCH_FACT = {');
  const constLine = mainSrc.slice(constStart, mainSrc.indexOf('\n', constStart));
  const rest = mainSrc.replace(constLine, '');
  assert.strictEqual(rest.indexOf("'awaiting on-chain deploy"), -1,
    'no raw pending literal outside the LAUNCH_FACT line');
  assert.strictEqual(rest.indexOf("'deployed — yield phase live"), -1,
    'no raw deployed literal outside the LAUNCH_FACT line');
  // (iv) the writer: null-guarded and state-driven off the SAME isDeployed seam
  assert.ok(/var n = \$\('vaults-launch-fact'\);\s*if \(n\)/.test(mainSrc),
    'the writer is NULL-guarded (init() must not throw under DOM stubs)');
  assert.ok(/WS\.vault\.isDeployed\(cfg\.vaults\[0\]\.vault\) \? LAUNCH_FACT\.proseDeployed : LAUNCH_FACT\.prosePending/
    .test(mainSrc), 'the writer is state-driven off the isDeployed seam');
  // (v) the statics: the static span is byte-equal to proseDeployed (the two
  // necessary copies — static first paint + JS constant — never re-split); the
  // pending forms never ship statically; the deployed register is exactly the
  // two statics (hero-ledger row + flow node); no hard dates (they go stale).
  const constMatch = mainSrc.match(/proseDeployed:\s*'([^']*)'/);
  assert.ok(constMatch, 'proseDeployed parsed out of LAUNCH_FACT in main.js');
  const spanMatch = html.match(/id="vaults-launch-fact">([^<]*)<\/span>/);
  assert.ok(spanMatch, 'the static launch-fact span is present in index.html');
  assert.strictEqual(spanMatch[1], constMatch[1], 'the static span text is byte-equal to proseDeployed');
  assert.strictEqual((html.match(/awaiting on-chain deploy/g) || []).length, 0,
    'no pending launch-fact literal in the statics (Branch B: deployed register)');
  // re-pinned 2026-09-07 (WS5-SKELETON): the two statics that carried the short
  // deployed register (the hero-ledger vault row + the flow node) are deleted
  // outright in the three-movement rebuild — the short register ships via the JS
  // writers only (tape strip rows); the statics keep the proseDeployed span.
  assert.strictEqual((html.match(/deployed — yield phase live/g) || []).length, 0,
    'the short deployed register ships via JS writers only (its two statics are retired)');
  assert.strictEqual((html.match(/deploy\(ed|s\) 20\d\d/g) || []).length, 0,
    'index.html never hard-dates the deploy fact');
});

// ---------------- (f) WS-A11Y-QUICK a11y teeth (2026-09-05) ----------------
// docs/inventory/UI_IMPROVE_A11Y_2026-09-04.md findings 1 (focus-ring token),
// 2a+2b (sr-only per-cycle summary + polite coverage cells) and 3 (skip link).
// Finding 7 and finding 2(c) (the docs.js load announcement) are OUT of scope
// by the goal. All CSS teeth use the file's brace-span slicing: indexOf the
// selector, slice to the next '}', assert inside the span.

test('(f1) focus ring token clears the 3:1 WCAG 1.4.11 floor on every surface it lands on', () => {
  // the token swap: the old semicolon-terminated form is gone (NOT a substring
  // of the -punch form, so plain counting is safe) and the new form appears
  // exactly once. The rgba(0,168,107,*) literals stay untouched (theme.test.js
  // pins the accent retint — it owns that surface, not this battery).
  assert.strictEqual(countOccurrences(css, 'outline-color: var(--accent);'), 0,
    'the failing accent ring token is gone');
  assert.strictEqual(countOccurrences(css, 'outline-color: var(--accent-punch);'), 1,
    'the focus ring rides --accent-punch exactly once');
  // contrast tooth (permanent): parse the tokens and compute WCAG 2.x ratios
  // with the same math as theme.test.js — --accent-punch must clear 3:1 on
  // every surface the ring can land on.
  function tokenValue(name) {
    const m = css.match(new RegExp(name + '[ \\t]*:[ \\t]*(#[0-9a-fA-F]{6})'));
    assert.ok(m, name + ' hex resolvable in style.css');
    return m[1];
  }
  function luminance(hex) {
    const chans = [0, 2, 4].map((i) => {
      const v = parseInt(hex.slice(1 + i, 3 + i), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * chans[0] + 0.7152 * chans[1] + 0.0722 * chans[2];
  }
  function contrast(fg, bg) {
    const l1 = luminance(fg);
    const l2 = luminance(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
  const punch = tokenValue('--accent-punch');
  const surfaces = [tokenValue('--paper'), tokenValue('--paper-raised'), tokenValue('--paper-2')];
  surfaces.forEach(function (bg, i) {
    const r = contrast(punch, bg);
    assert.ok(r >= 3.0, '--accent-punch on surface ' + i + ' computes ' + r.toFixed(2) + ':1 — must be >= 3.0 (WCAG 1.4.11 non-text)');
  });
});

test('(f2) skip link: first focusable in body, frozen copy, clip hidden / full un-clip reveal', () => {
  // byte-frozen anchor + byte-order first-focusable proof
  // re-pinned 2026-09-07 (WS5-SKELETON): the skip target moved from #vaults
  // (retired with the vault family grid) to #fleet — the first content movement.
  // Copy byte-unchanged; position pins unchanged.
  const anchor = '<a class="skip-link" href="#fleet">Skip to content</a>';
  assert.strictEqual(countOccurrences(html, anchor), 1,
    'the skip anchor ships exactly once in its byte-frozen form');
  const anchorAt = html.indexOf(anchor);
  assert.ok(anchorAt > html.indexOf('<body'), 'the skip anchor sits inside <body>');
  assert.ok(anchorAt < html.indexOf('<noscript'), 'the skip anchor precedes the <noscript> note');
  assert.ok(anchorAt < html.indexOf('id="ws-root"'), 'the skip anchor is the first focusable (before #ws-root)');
  assert.ok(anchor.indexOf('cta-') === -1, 'the skip link never borrows a pinned CTA class');
  // both rules exist
  assert.ok(css.indexOf('.skip-link {') !== -1, 'the .skip-link hidden rule is present');
  assert.ok(css.indexOf('.skip-link:focus-visible {') !== -1, 'the .skip-link:focus-visible reveal rule is present');
  // (i) .visually-hidden: all six pinned declarations inside its brace span
  const vhAt = css.indexOf('.visually-hidden {');
  const vh = css.slice(vhAt, css.indexOf('}', vhAt));
  for (const decl of ['position: absolute', 'width: 1px', 'height: 1px', 'margin: -1px', 'overflow: hidden', 'clip: rect(0,0,0,0)']) {
    assert.ok(vh.indexOf(decl) !== -1, '.visually-hidden carries ' + decl);
  }
  // (ii) the hidden skip-link form actually clips
  const skAt = css.indexOf('.skip-link {');
  const sk = css.slice(skAt, css.indexOf('}', skAt));
  assert.ok(sk.indexOf('clip: rect(0,0,0,0)') !== -1, '.skip-link hidden state actually clips');
  // (iii) the reveal actually UN-clips — a color-only reveal leaves a
  // permanently invisible 1px skip link while every other tooth stays green
  const revAt = css.indexOf('.skip-link:focus-visible {');
  const rev = css.slice(revAt, css.indexOf('}', revAt));
  for (const decl of ['clip: auto', 'width: auto', 'height: auto', 'margin: auto', 'overflow: visible']) {
    assert.ok(rev.indexOf(decl) !== -1, '.skip-link reveal fully un-clips: ' + decl);
  }
  // (iv) no motion on ANY .skip-link rule — scoped extraction, never a
  // whole-file grep (style.css carries many unrelated transition declarations)
  const skipRules = css.match(/\.skip-link[^{]*\{[^}]*\}/g) || [];
  assert.ok(skipRules.length >= 2, 'both .skip-link rules matched by the scoped extraction (got ' + skipRules.length + ')');
  for (const span of skipRules) {
    assert.ok(span.indexOf('transition') === -1 && span.indexOf('animation') === -1,
      '.skip-link rules carry no transition/animation — the reveal is instant (reduced-motion pairing by construction)');
  }
});

// RE-PINNED 2026-09-07 (WS5-SKELETON): the mint-backed / inv-stat polite cells
// and the hero-ledger sr-only per-cycle summary are RETIRED with the mint card,
// the invariants section and the hero ledger (deleted outright in the
// three-movement rebuild). The a11y treatment carries over to the single
// relocated seam cell (#fleet-coverage, aria-live=polite) and the page's other
// live regions keep their one-aria-live discipline.
test('(f3) aria-live: the relocated coverage cell announces its changes; live regions stay one-per-surface', () => {
  assert.strictEqual(countOccurrences(html, 'id="fleet-coverage" aria-live="polite"'), 1,
    '#fleet-coverage announces its value changes (the relocated seam cell)');
  // the other live regions are untouched by the rebuild
  assert.strictEqual(countOccurrences(html, 'id="wallet-balances" aria-live="polite"'), 1,
    '#wallet-balances keeps its polite live region');
  assert.strictEqual(countOccurrences(html, 'id="widget-status" aria-live="polite"'), 1,
    '#widget-status keeps its polite live region');
});

// RETIRED 2026-09-07 (WS5-SKELETON): '(f4) the per-cycle summary writer: house
// form, after pulseStamp, frozen literals' — the hero ledger's sr-only per-cycle
// summary span, the WOW-7 pulseStamp heartbeat it was ordered against and the
// writer itself are deleted outright in the three-movement rebuild (the ledger
// surface they served no longer exists; the refresh loop is the reads, nothing
// else).

// ---------------- (m1) WS-MOTION-POLISH: press grammar + entrance + stamp stagger ----------------
// Source-grep pins ONLY (this file's charter: dependency-free node:test + node:fs).
// The behavioral DOM-stub pins (fresh-require IO capture) live in
// site-tests/motion-polish.test.js. Map authority:
// docs/inventory/UI_IMPROVE_MOTION_2026-09-04.md proposals 1, 2 and 4 (+ the
// ledger-invisibility prerequisite fix) at the 2026-09-05 dispatch anchors.
test('(m1) WS-MOTION-POLISH: :active press grammar + stamp stagger (doto re-pin; BTN-MOTION re-pin 2026-09-08)', () => {
  // (i) the five per-class press rules — one rule per line, uniform :active:not(:disabled)
  //     (the sixth, .cta-outline, retired with the outline CTA).
  //     RE-PINNED 2026-09-08 (BTN-MOTION, docs/internal/BTN_MOTION_2026-09-08.md):
  //     the press register REPLACES the 1px dip with the settle-under-the-finger
  //     form — translateY(0) scale(0.985) + the hover shadow held — for the three
  //     button-register surfaces (btn, cta-solid, nav-cta); doc-tab and code-copy
  //     are OUT of the button register and keep the 1px dip. The full press
  //     pairing (lift + every outline chip) is pinned in motion-polish.test.js.
  for (const sel of ['button.btn:active:not(:disabled) { transform: translateY(0) scale(0.985); box-shadow: var(--shadow-btn-hover); transition:',
    '.cta-solid:active:not(:disabled) { transform: translateY(0) scale(0.985); box-shadow: var(--shadow-btn-hover); transition:',
    '.doc-tab:active:not(:disabled) { transform: translateY(1px); transition:',
    '.code-copy:active:not(:disabled) { transform: translateY(1px); transition:',
    '.site-nav a.nav-cta:active:not(:disabled) { transform: translateY(0) scale(0.985); box-shadow: var(--shadow-btn-hover); transition:']) {
    assert.strictEqual(countOccurrences(css, sel), 1,
      'the press rule ships exactly once in the per-class form: ' + sel.slice(0, 44) + '…');
  }
  assert.strictEqual(countOccurrences(css, 'translateY(1px)'), 2, 'tab/copy keep the 1px dip (out of the button register)');
  assert.strictEqual(countOccurrences(css, 'scale(0.985)'), 8, 'the button register presses at 0.985 (btn, cta, nav-cta + the five chip/toggle surfaces)');
  // (ii) release rides the EXTENDED base lists — never a competing second
  // transition property (it would kill the fill/color transitions while pressed)
  // RE-PINNED 2026-09-08 (UI_LOOP_2 W2 G2-MOTION-CONSISTENCY): the three pill
  // bases tween transform at var(--motion) now (one gesture, one speed with the
  // chip register — the 200ms LIFT was the bug); doc-tab and code-copy stay
  // OUT of the button register and keep the --t-base transform component.
  // Uniformity across the 11-surface register is pinned in motion-polish.test.js.
  for (const base of ['button.btn {', '.cta-solid {']) {
    const span = css.slice(css.indexOf(base), css.indexOf('}', css.indexOf(base)));
    assert.ok(span.indexOf('transform var(--motion)') !== -1,
      base + ' base transition list carries the transform component at var(--motion)');
  }
  for (const base of ['.doc-tab {', '.code-copy {']) {
    const span = css.slice(css.indexOf(base), css.indexOf('}', css.indexOf(base)));
    assert.ok(span.indexOf('transform var(--t-base) var(--ease-enter)') !== -1,
      base + ' base transition list extended IN PLACE with the transform component');
  }
  const navSpan = css.slice(css.indexOf('.site-nav a.nav-cta {'), css.indexOf('}', css.indexOf('.site-nav a.nav-cta {')));
  assert.ok(navSpan.indexOf('transform var(--motion)') !== -1,
    '.site-nav a.nav-cta base list carries the transform component at var(--motion)');
  // (iii) source-order: the five press rules sit BEFORE the 4th reduce gate —
  // never inside any @media, never after the block
  const gates = []; let gi = -1;
  while ((gi = css.indexOf('@media (prefers-reduced-motion: reduce)', gi + 1)) !== -1) { gates.push(gi); }
  assert.ok(gates.length >= 5, 'the scoped reduce belt is intact (>= 5 gates, got ' + gates.length + ')');
  const before = css.slice(0, gates[3]).split('\n').filter((l) => l.indexOf(':active') !== -1).length;
  assert.ok(before >= 5, 'all five press rules sit before the 4th reduce gate (got ' + before + ')');
  // (iv) the five verbatim reduce restates live INSIDE the 4th scoped reduce
  // block (equal-specificity later-source wins)
  const reduceBlock = css.slice(gates[3], css.indexOf('\n}', gates[3]));
  for (const sel of ['button.btn:active:not(:disabled) { transform: none; }',
    '.cta-solid:active:not(:disabled) { transform: none; }',
    '.doc-tab:active:not(:disabled) { transform: none; }',
    '.code-copy:active:not(:disabled) { transform: none; }',
    '.site-nav a.nav-cta:active:not(:disabled) { transform: none; }']) {
    assert.ok(reduceBlock.indexOf(sel) !== -1, 'verbatim reduce restate inside the scoped block: ' + sel);
  }
  // (vi) stamp: base opacity:0 + the FORWARDS shorthand byte-unchanged
  // (a backwards fill would repaint the 0% frame during the delay).
  const stampAt = css.indexOf('.ledger-v.ledger-stamp::after {');
  const stampSpan = css.slice(stampAt, css.indexOf('}', stampAt));
  assert.ok(stampSpan.indexOf('opacity: 0;') !== -1, 'stamp base carries opacity:0 (held invisible through its delay window)');
  assert.ok(stampSpan.indexOf('animation: ws-stamp-fade 900ms var(--ease-loop, cubic-bezier(0.65, 0, 0.35, 1)) forwards;') !== -1,
    'the stamp animation shorthand stays byte-unchanged (forwards fill — never both/backwards)');
  assert.ok(css.indexOf('@keyframes ws-stamp-fade {\n  0% { opacity: 1; }\n  55% { opacity: 1; }\n  100% { opacity: 0; }\n}') !== -1,
    'the ws-stamp-fade keyframes stay byte-unchanged');
  // (viii) the one-signature motion count — DELTA RE-PIN (FLOW_SECTION_2026-09-08,
  // 2026-09-09): the user-granted second motion signature joins the page — the
  // flow pulse dot on the #flow deposit arrow (@keyframes flow-pulse, transform +
  // opacity only, reduced-motion kills it entirely). The stamp keyframes remain
  // byte-unchanged above; the budget is now exactly TWO signatures, teeth, not prose.
  assert.strictEqual((css.match(/@keyframes/g) || []).length, 4,
    'exactly FOUR @keyframes ship (ledger stamp + FLOW_SECTION_2026-09-08 pulse + UI_LOOP_3_WAVE_2026-09-09 copy-toast-in/out — user-ratified W3a toast choreography; transform+opacity only, gated under prefers-reduced-motion: no-preference)');
});
