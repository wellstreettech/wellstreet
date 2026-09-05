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

// (b) THE DECLARED ASSET TABLE — the motion contract, asset by asset. A new
// site/img reference without an entry here FAILS the battery, forcing the next
// author to declare its reduced-motion pairing (the WS-ASSET-WIRE invariant:
// every moving surface ships its static pair in the same change).
//   [file, css class, moving?]
const ASSET_MOTION = [
  ['img/compressed/hand-point.png', 'asset-point', false],       // hero ledger edge — static by design (index.html comment)
  ['img/compressed/hand-press.png', 'asset-press', true],        // dips ~6px on #btn-deposit hover/focus
  ['img/compressed/hand-magnify.png', 'asset-magnify', true],    // one sweep per refresh cycle, motionAllowed()-gated
  ['img/compressed/curve-stroke.png', 'asset-draw', true],       // clip-path draw-on, IO-armed only
  ['img/compressed/certificate.png', 'asset-certificate', false], // vault-card keeper (appended by main.js) — static
  ['img/logo-mark.png', 'brand-mark', false],                    // header logo mark (2026-09-04) — static, no motion by design
  ['img/canyon-hero.png', 'hero-canyon', true]                   // hero backdrop (2026-09-05) — 1.62s vibrate cycle, nulled under reduce
];

// ---------------- (a) agent-first section ----------------
test('(a) agent-first section: two-tone headline + skill pointer', () => {
  assert.strictEqual(countOccurrences(html, '<section class="block" id="agents">'), 1,
    'the #agents section block exists exactly once');
  // two-tone headline grammar (design-ref item 2, transferred): claim line 1 in
  // ink, the deadpan line 2 receding via span.quiet — same structure as the
  // hero h1 and the #invariants h2.
  const twoTone = '<h2>Built for humans.<br><span class="quiet">Operated by agents.</span></h2>';
  assert.strictEqual(countOccurrences(html, twoTone), 1,
    'the two-tone agent-first headline appears exactly once');
  assert.ok(/#agents \.quiet \{ color: var\(--ink-soft\); \}/.test(css),
    '#agents .quiet recede rule present (the two-tone treatment is CSS-carried, not inherited by accident)');
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
test('(b) every referenced site/img asset is declared with its motion pairing', () => {
  // derive the referenced set from ALL shipped sources (html + every site module
  // + the stylesheet); style.css carries only a prose comment mention (no real
  // URL) — a real url(../img/...) landing later must be declared here too.
  const referenced = new Set();
  // WS-OG-PERF (2026-09-04): subdirectory-aware — keepers serve from img/compressed/,
  // so the token class includes '/' to capture the FULL path (a mid-path '/' would
  // otherwise truncate img/compressed/hand-point.png to a phantom 'img/compressed').
  const re = /img\/[A-Za-z0-9._/-]+/g;
  for (const src of [html, css].concat(JS_FILES.map((n) => jsSources[n]))) {
    let m;
    while ((m = re.exec(src)) !== null) { referenced.add(m[0]); }
  }
  assert.ok(referenced.has('img/compressed/hand-point.png') && referenced.has('img/compressed/certificate.png'),
    'the derivation actually sees the shipped references (sanity)');
  const declared = new Set(ASSET_MOTION.map((a) => a[0]));
  const unknown = Array.from(referenced).filter((f) => !declared.has(f));
  assert.deepStrictEqual(unknown, [],
    'every referenced img asset must be declared in ASSET_MOTION (undeclared: ' + unknown.join(', ') + ')');
  // no dead table entries either — each declared asset is still referenced
  for (const [file] of ASSET_MOTION) {
    assert.ok(referenced.has(file), file + ' is still referenced by the shipped sources');
  }
});

test('(b2) moving assets: explicit prefers-reduced-motion static pair in their section', () => {
  const sectionStart = css.indexOf('WS-ASSET-WIRE (2026-09-04)');
  assert.ok(sectionStart !== -1, 'the WS-ASSET-WIRE section banner is present');
  const section = css.slice(sectionStart);
  const gateIdx = section.indexOf('@media (prefers-reduced-motion: no-preference)');
  const keyframesIdx = section.indexOf('@keyframes', gateIdx);
  assert.ok(gateIdx !== -1 && keyframesIdx > gateIdx,
    'the no-preference motion gate is present in the asset section');
  const gateBlock = section.slice(gateIdx, keyframesIdx);
  const reduceIdx = section.indexOf('@media (prefers-reduced-motion: reduce)');
  assert.ok(reduceIdx > gateIdx, 'the reduce pairing block sits in the same section, after the gate');
  const reduceBlock = section.slice(reduceIdx, section.indexOf('@media', reduceIdx + 1));
  for (const [file, cls, moving] of ASSET_MOTION) {
    if (!moving) { continue; }
    assert.ok(gateBlock.indexOf('.' + cls) !== -1,
      cls + ' (' + file + ') motion is declared inside the no-preference gate');
  }
  // the three exact reduce-block static pairs (the pairing rules themselves)
  assert.ok(reduceBlock.indexOf('.asset-press { transition: none; transform: none; }') !== -1,
    'press-hand reduce pair: transition + transform nullified');
  assert.ok(reduceBlock.indexOf('.asset-magnify.asset-sweep { animation: none; }') !== -1,
    'magnify-hand reduce pair: the sweep animation nullified');
  assert.ok(reduceBlock.indexOf('.asset-draw { clip-path: none; transition: none; }') !== -1,
    'curve-divider reduce pair: clip-path stays the full static stroke');
});

test('(b3) static assets: no motion shipped at all (pairing by construction)', () => {
  const gateIdx = css.indexOf('@media (prefers-reduced-motion: no-preference)');
  const gateBlock = css.slice(gateIdx, css.indexOf('@keyframes', gateIdx));
  for (const [file, cls, moving] of ASSET_MOTION) {
    if (moving) { continue; }
    const decl = css.match(new RegExp('\\.' + cls + ' \\{[^}]*\\}'));
    assert.ok(decl, '.' + cls + ' base rule present in style.css');
    assert.ok(!/animation|transition/.test(decl[0]),
      '.' + cls + ' (' + file + ') ships NO animation/transition — reduced-motion static by construction');
    assert.ok(gateBlock.indexOf(cls) === -1,
      '.' + cls + ' never enters the no-preference motion gate');
  }
});

test('(b4) the JS motion gate: motionAllowed() guards the magnify sweep', () => {
  assert.ok(/function motionAllowed\(\)/.test(mainSrc), 'motionAllowed() is defined in main.js');
  assert.ok(mainSrc.indexOf('(prefers-reduced-motion: reduce)') !== -1,
    'the JS gate consults the same reduce query the stylesheet pairs against');
  const sweepFn = mainSrc.slice(mainSrc.indexOf('function sweepMagnifier()'),
    mainSrc.indexOf('function stampRow('));
  assert.ok(sweepFn.indexOf('!motionAllowed()') !== -1,
    'sweepMagnifier bails BEFORE adding .asset-sweep when motion is not allowed');
  // the draw-on is armed only by the IntersectionObserver (no-JS = static stroke)
  assert.strictEqual(countOccurrences(mainSrc, 'function initAssetDraw()'), 1,
    'initAssetDraw defined exactly once');
  assert.ok(mainSrc.indexOf('initAssetDraw();') !== -1, 'initAssetDraw is wired in init()');
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
test('(c) ledger card rows: mono labels + the BACKED cell rides the coverage seam', () => {
  assert.strictEqual(countOccurrences(html, '<aside class="mint-card ledger-card" aria-label="Deposit facts">'), 1,
    'the mint-ticket ledger card is present exactly once');
  for (const label of ['DEPOSIT', 'SETTLED AT', 'YOU RECEIVE', 'BACKED']) {
    assert.strictEqual(countOccurrences(html, '<span class="ledger-k">' + label + '</span>'), 1,
      'mono label row present exactly once: ' + label);
  }
  // the stratton grammar's mono small-cap treatment (row anatomy otherwise inherited)
  assert.ok(css.indexOf('.mint-card .ledger-k { font-family: var(--mono); }') !== -1,
    '.mint-card .ledger-k rides the mono stack');
  // the BACKED cell = the read side of the single coverage seam
  // re-pinned 2026-09-05 (WS-A11Y-QUICK): aria-live="polite" appended to the coverage-cell opening tags
  assert.ok(html.indexOf('<span class="ledger-v" id="mint-backed" aria-live="polite">') !== -1,
    'the BACKED cell is #mint-backed');
  const fill = mainSrc.slice(mainSrc.indexOf('function fillBackingCoverage('),
    mainSrc.indexOf('async function loadVaultData('));
  assert.ok(fill.indexOf("$('mint-backed')") !== -1 && fill.indexOf("$('inv-stat')") !== -1,
    'fillBackingCoverage is the single fill point writing BOTH seam cells');
  // re-pinned 2026-09-05 (WS-PRODUCT-GAPS P5): the vault is DEPLOYED (config.js pins
  // the live address), so the static first paint no longer claims the address is
  // unpublished — both cells now carry the self-verify truth string (the JS fill
  // seam above is unchanged: isDeployed-gated, honest on failure).
  const staticCoverage = 'coverage reads live from backingCoverage() on the vault at 0x3a1c83ABc79A512aAd68ac721CE0F10F41de3a01 (js/config.js); verify it yourself with any RPC client.';
  assert.strictEqual(countOccurrences(html, staticCoverage), 2,
    'the noscript coverage truth is exactly the two static seam cells (identical by construction)');
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
test('(d) CTA pair: solid->#deposit, outline->#docs, per-class :hover rules', () => {
  assert.strictEqual(countOccurrences(html, '<a class="cta-solid" href="#deposit">'), 1,
    'cta-solid anchors #deposit exactly once');
  assert.strictEqual(countOccurrences(html, '<a class="cta-outline" href="#docs">'), 1,
    'cta-outline anchors #docs exactly once');
  // no dead anchors: both targets are real sections in the page
  assert.ok(html.indexOf('<section class="block" id="deposit">') !== -1, '#deposit section present');
  assert.ok(html.indexOf('<section class="block" id="docs">') !== -1, '#docs section present');
  // hover states are PER-CLASS on purpose (WS-LEDGER-STRUCTURE P3 comment): the
  // solid shifts its fill, the outline fills toward its border token — never a
  // shared comma-joined hover rule.
  assert.ok(css.indexOf('.cta-solid:hover { background: var(--paper-2); color: var(--ink); }') !== -1,
    'cta-solid has its own :hover rule (fill shift)');
  assert.ok(css.indexOf('.cta-outline:hover { background: var(--ink); color: var(--paper); }') !== -1,
    'cta-outline has its own :hover rule (fills toward its border token)');
  assert.ok(!/\.cta-solid:hover,[^{]*\.cta-outline:hover/.test(css),
    'the two hover rules are never comma-joined into one');
  // the pair keeps its hover transition so the hover state animates at all
  assert.ok(/\.cta-solid \{[^}]*transition:/.test(css), 'cta-solid carries its transition');
  assert.ok(/\.cta-outline \{[^}]*transition:/.test(css), 'cta-outline carries its transition');
  // <=640px: the pair stacks full-width inside the mobile media block
  const mIdx = css.indexOf('@media (max-width: 640px)');
  assert.ok(css.slice(mIdx, mIdx + 900).indexOf('.cta-row { flex-direction: column; align-items: stretch; }') !== -1,
    'the <=640px block stacks the CTA pair full-width');
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
  assert.strictEqual((html.match(/deployed — yield phase live/g) || []).length, 2,
    'exactly the two statics carry the deployed register (hero-ledger row + flow node)');
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
  const anchor = '<a class="skip-link" href="#vaults">Skip to content</a>';
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

test('(f3) aria-live: polite coverage cells + leading summary sibling, never the rows container', () => {
  assert.strictEqual(countOccurrences(html, 'id="mint-backed" aria-live="polite"'), 1,
    '#mint-backed announces its value changes');
  assert.strictEqual(countOccurrences(html, 'id="inv-stat" aria-live="polite"'), 1,
    '#inv-stat announces its value changes');
  assert.strictEqual(countOccurrences(html, 'id="hero-ledger-rows" aria-live'), 0,
    'the rows container is NEVER a live region (a 60s rebuild would dump the whole ledger into the queue)');
  const summary = '<span class="visually-hidden" id="hero-ledger-summary" aria-live="polite"></span>';
  assert.strictEqual(countOccurrences(html, summary), 1,
    'the sr-only summary span ships in its byte-frozen form');
  assert.ok(html.indexOf('id="hero-ledger-summary"') > html.indexOf('id="hero-ledger"'),
    'the summary sits inside aside.hero-ledger');
  assert.ok(html.indexOf('id="hero-ledger-summary"') < html.indexOf('id="hero-ledger-rows"'),
    'the summary is the LEADING sibling of the rows div (never a child — its children count pins at 4)');
  assert.strictEqual(countOccurrences(html, 'id="hero-ledger-state" aria-live="polite"'), 1,
    '#hero-ledger-state keeps exactly its one aria-live and gains no new attributes');
});

test('(f4) the per-cycle summary writer: house form, after pulseStamp, frozen literals', () => {
  assert.ok(/var n = \$\('hero-ledger-summary'\);\s*if \(n\)/.test(mainSrc),
    'the writer is null-guarded in the house form (the var n = prefix is part of the pin — no implicit global)');
  assert.strictEqual(countOccurrences(mainSrc, 'pulseStamp(!!state.pool)'), 1,
    'the placement anchor is unique (the byte-order proof stays meaningful)');
  assert.ok(mainSrc.indexOf("$('hero-ledger-summary')") > mainSrc.indexOf('pulseStamp(!!state.pool)'),
    'the writer sits inside refreshCards AFTER the early-return gate and the pulseStamp call — not at module top-level where it would run once and go stale');
  assert.strictEqual(countOccurrences(mainSrc, 'Ledger refreshed — re-read from public RPC'), 1,
    'the success literal ships exactly once (never claims coverage was re-read — it fails independently)');
  assert.strictEqual(countOccurrences(mainSrc, 'Ledger refresh failed — the ledger shows unavailable states, never estimates'), 1,
    'the failure literal ships exactly once (the honest register)');
});
