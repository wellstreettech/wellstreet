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
  assert.ok(html.indexOf('<span class="ledger-v" id="mint-backed">') !== -1,
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
