'use strict';
// FLIP-CARRIER-CONTRACT theme battery (2026-09-04) — light-paper flip contract
// (supersedes the WSV-DARK-RESKIN-ALL dark contract; same assertion structure,
// re-pinned to the ratified light palette: paper #EDE9DC family + accent #00A86B).
// Dependency-free: node:test + node:assert + node:fs ONLY (no npm, no new deps).
// Assertions:
//   (a) pinned light palette (tokens + shadows + deposit literal) present in style.css
//       — 20 carried entries re-valued + the two flip-authored tokens --accent-text
//       and --chip-tan = 22 authored entries
//   (b) head metas: theme-color == the --paper token value, color-scheme light,
//       dark metas ABSENT (dark-era pins inverted; the FIX-9 #f6f4ec absence survives)
//   (c) WCAG contrast >= 4.5:1 for exactly the six text pairs — slot 3 re-pointed
//       accent/paper -> accent-text/paper (the ratified #00A86B fill hue measures
//       ~2.5:1 on cream and can never be a text pair)
//   (d) legacy dark-era + light-era values gone — GENERATED FROM THE LANDED FLIP
//       DIFF: dark-era leavers, light-era leavers, 3-digit short forms, the leaving
//       rgba() families (\s*-tolerant) and the exact old shadow strings, computed
//       over the geo-block-line-filtered stylesheet and over index.html whole-file;
//       #fbfaf5 companion count == 1 (the frozen geo literal only); motif retint
//       re-anchored to rgba(0,168,107, at exactly six sites; favicon data-URI
//       asserts (URL-encoded values are invisible to the hex bans)
//   (e) geo freeze strings present (SECONDARY guard — the mechanical proof is the
//       VERIFYCMDS dispatch-capture + diff chain ending GEO-FREEZE-OK)
//   (f) frozen copy strings present exactly once each (contains-checks, never
//       line-equality — line positions may shift)
//   (g) WS-LEDGER-STRUCTURE structure-layer teeth (landed 2026-09-04 — preserved)
// If (d) fails the ban list is incomplete or a carrier was missed — fix the
// CARRIER, never the assert; NEVER edit the geo-frozen lines to satisfy an assertion.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const cssPath = path.join(__dirname, '..', 'site', 'css', 'style.css');
const htmlPath = path.join(__dirname, '..', 'site', 'index.html');
const css = fs.readFileSync(cssPath, 'utf8');
const html = fs.readFileSync(htmlPath, 'utf8');

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Pinned light palette (FLIP-CARRIER-CONTRACT; values, not layout). Anchors
// ratified by user drafts: --paper #EDE9DC, --accent #00A86B; companions authored
// + measured in-wave. --accent-ink is the dark text on #00A86B fills (5.6:1);
// --accent-text is the accent hue darkened to 5.4:1 on --paper (the fill hue
// itself is 2.5:1 on cream and never renders as text).
const PALETTE = [
  ['--paper', '#EDE9DC'],
  ['--paper-2', '#E4DFD1'],
  ['--ink', '#1C1A15'],
  ['--ink-soft', '#5C584C'],
  ['--line', '#C8C1AD'],
  ['--accent', '#00A86B'],
  ['--accent-ink', '#1C1A15'],
  ['--accent-text', '#0d6b4f'],
  ['--warn', '#a33a24'],
  ['--code-bg', '#E0D9C9'],
  ['--paper-raised', '#F3EFE3'],
  ['--paper-pending', '#E7E2D4'],
  ['--warn-bg', '#EFD9D1'],
  ['--accent-visited', '#3A6B58'],
  ['--accent-hover', '#0FB879'],
  ['--line-dotted', '#AFA892'],
  ['--chip-tan', '#D9CFB4'],
  ['--footer-muted', '#4E4939'],
  ['--footer-faint', '#615C4C'],
  ['--accent-punch', '#006B45'],
  ['--shadow-soft', '0 20px 28px rgba(28, 26, 21, 0.10)'],
  ['--shadow-soft-hover', '0 24px 40px rgba(28, 26, 21, 0.16)'],
];

// LEGACY_HEXES — GENERATED FROM THE LANDED FLIP DIFF, not hand-listed.
//   dark-era leavers: every hex the dark contract carried that the light table
//   replaces. light-era leavers: the stale dark fallback literals so they cannot
//   survive invisibly in var() fallbacks. Short forms are banned by SUBSTRING
//   (includes('#000000') cannot match 'background: #000;' — direction matters).
//   Authored light-table values are asserted to NOT collide (below + by (a)'s
//   positive pins): the new --ink is freshly authored (#1C1A15), and the two
//   reused paper-era precedents (#0d6b4f accent-text, #a33a24 warn) are UN-BANNED
//   by this rewrite per the goal's own rule. #f6f4ec (the superseded cream
//   candidate) STAYS banned. Earlier paper-era bans are retained — never loosen.
const LEGACY_HEXES = [
  // dark-era leavers
  '#000000', '#17171a', '#2ec27e', '#27a86c', '#3ad18e', '#3fe396', '#131316',
  '#101014', '#2a1512', '#4a4a4e', '#28282a', '#011A25', '#d6d1c0',
  // light-era leavers (stale fallback literals)
  '#ffffff', '#8e8e8e', '#a8a8ae', '#c4c2c3', '#e0654a',
  // 3-digit short forms (substring direction)
  '#000', '#fff',
  // superseded paper candidate — stays banned
  '#f6f4ec',
  // earlier paper-era bans retained (never loosen)
  '#efecdf', '#17191d', '#4c4f55', '#e9e5d6', '#f8f5ea', '#f8e9e3', '#0a5540',
  '#0a5940', '#b9b4a3', '#cfcabb', '#b7b2a2', '#0b7f56', '#6f6a54',
];

// Authored light-table values must not collide with any retained ban entry.
const AUTHORED_VALUES = PALETTE.map(([, v]) => v).filter((v) => v.startsWith('#'));

function tokenRegex(name, value) {
  // whitespace-tolerant after the colon (file writes "--paper: #...;", table writes none)
  return new RegExp(escapeRegExp(name) + '[ \\t]*:[ \\t]*' + escapeRegExp(value));
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

// Resolve a 6-digit hex token value out of the stylesheet (favicon asserts mirror
// (b)'s dynamic-resolution pattern — URL-encoded data-URI values are invisible to
// the plain hex bans, so they get their own token-derived asserts).
function tokenHex(name) {
  const m = css.match(new RegExp(escapeRegExp(name) + '[ \\t]*:[ \\t]*(#[0-9a-fA-F]{6})'));
  assert.ok(m, name + ' hex resolvable');
  return m[1];
}

test('(a) pinned light palette tokens present in style.css', () => {
  for (const [name, value] of PALETTE) {
    assert.ok(tokenRegex(name, value).test(css), name + ' must carry ' + value);
  }
});

test('(a2) deposit .index literal re-pinned to the --ink token', () => {
  assert.ok(/#deposit \.index \{ color: var\(--ink\); \}/.test(css),
    '#deposit .index must carry color: var(--ink) (token, no literal)');
});

test('(b) theme-color equals --paper; color-scheme light; dark metas ABSENT', () => {
  const paper = (css.match(/--paper[ \t]*:[ \t]*(#[0-9a-fA-F]{6})/) || [])[1];
  assert.ok(paper, '--paper hex resolvable in style.css');
  const meta = html.match(/<meta name="theme-color" content="([^"]+)">/);
  assert.ok(meta, 'theme-color meta present in index.html');
  assert.strictEqual(meta[1], paper, 'theme-color content equals the --paper token value');
  assert.match(html, /<meta name="color-scheme" content="light">/, 'color-scheme meta is light');
  assert.ok(!html.includes('content="#000000"'), 'dark theme-color meta absent (light-paper flip)');
  assert.ok(!html.includes('color-scheme" content="dark"'), 'dark color-scheme meta absent (light-paper flip)');
  assert.ok(!html.includes('content="#f6f4ec"'), 'superseded cream meta absent (FIX-9 pin survives)');
});

test('(c) WCAG contrast >= 4.5:1 for exactly the six text pairs', () => {
  function tokenValue(name) {
    const m = css.match(new RegExp(escapeRegExp(name) + '[ \\t]*:[ \\t]*(#[0-9a-fA-F]{6})'));
    assert.ok(m, name + ' hex resolvable');
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
  const paper = tokenValue('--paper');
  const paper2 = tokenValue('--paper-2');
  const ink = tokenValue('--ink');
  const inkSoft = tokenValue('--ink-soft');
  const accent = tokenValue('--accent');
  const accentInk = tokenValue('--accent-ink');
  const accentText = tokenValue('--accent-text');
  const warn = tokenValue('--warn');
  const pairs = [
    ['ink/paper', ink, paper],
    ['ink-soft/paper', inkSoft, paper],
    ['accent-text/paper', accentText, paper],
    ['accent-ink/accent', accentInk, accent],
    ['warn/paper-2', warn, paper2],
    ['ink/paper-2', ink, paper2],
  ];
  assert.strictEqual(pairs.length, 6, 'exactly six asserted text pairs (no footer/line pairs)');
  for (const [label, fg, bg] of pairs) {
    const r = contrast(fg, bg);
    assert.ok(r >= 4.5, label + ' contrast ' + r.toFixed(2) + ' must be >= 4.5:1');
  }
});

test('(d) legacy dark-era + light-era values gone (geo-frozen lines excluded from the sweep)', () => {
  // grep -v geo-block equivalent: drop every line containing 'geo-block' — removes
  // the only literal-bearing geo rules plus the var-only geo lines, line-agnostic.
  // The .geo-block-head color stays a short-form literal ON a geo line (exempt),
  // re-evaluated for the deepened warn: white on #a33a24 measures ~6.6:1.
  const cssSweep = css.split('\n')
    .filter((line) => !line.includes('geo-block'))
    .join('\n');
  for (const v of LEGACY_HEXES) {
    assert.ok(!cssSweep.includes(v), 'legacy ' + v + ' gone from style.css (geo-block lines excluded)');
    assert.ok(!html.includes(v), 'legacy ' + v + ' gone from index.html');
  }
  // authored values never collide with the retained ban entries
  for (const v of AUTHORED_VALUES) {
    assert.ok(!LEGACY_HEXES.includes(v), 'authored ' + v + ' must not collide with the ban list');
  }
  // earlier paper-era rgba families (kept from the dark-era rewrite)
  assert.ok(!/rgba\(14,\s*61/.test(cssSweep), 'legacy blue shadow family rgba(14, 61, ...) gone from style.css');
  assert.ok(!/rgba\(13,\s*107/.test(cssSweep), 'legacy motif green family rgba(13, 107, ...) gone from style.css');
  assert.ok(!/rgba\(14,\s*61/.test(html), 'legacy rgba(14, 61, ...) absent from index.html');
  assert.ok(!/rgba\(13,\s*107/.test(html), 'legacy rgba(13, 107, ...) absent from index.html');
  // leaving rgba() families from the landed flip diff (\s*-tolerant — BOTH byte
  // forms existed: :18 unspaced, :38/:745+ spaced)
  assert.ok(!/rgba\(255,\s*255,\s*255/.test(cssSweep), 'leaving white rgba family gone from style.css');
  assert.ok(!/rgba\(46,\s*194,\s*126/.test(cssSweep), 'leaving dark-accent rgba family gone from style.css');
  assert.ok(!/rgba\(224,\s*101,\s*74/.test(cssSweep), 'leaving dark-warn rgba family gone from style.css');
  assert.ok(!/rgba\(255,\s*255,\s*255/.test(html), 'leaving white rgba family absent from index.html');
  assert.ok(!/rgba\(46,\s*194,\s*126/.test(html), 'leaving dark-accent rgba family absent from index.html');
  assert.ok(!/rgba\(224,\s*101,\s*74/.test(html), 'leaving dark-warn rgba family absent from index.html');
  // the exact old dark shadow strings (whole values, not a family ban)
  assert.ok(!cssSweep.includes('rgba(0,0,0,0.55)'), 'old dark shadow rgba(0,0,0,0.55) gone from style.css');
  assert.ok(!cssSweep.includes('rgba(0,0,0,0.7)'), 'old dark shadow rgba(0,0,0,0.7) gone from style.css');
  assert.ok(!html.includes('content="#f6f4ec"'), 'meta content="#f6f4ec" absent from index.html');
  assert.ok(!html.includes('color-scheme" content="dark"'), 'dark color-scheme meta absent from index.html (inverted dark-era pin)');
  // motif retint (light-paper flip): alpha-preserved 1:1 at exactly the six sites
  const retint = html.match(/rgba\(0,168,107,/g) || [];
  assert.strictEqual(retint.length, 6, 'motif retinted to rgba(0,168,107,*) at exactly six sites');
  const oldMotif = html.match(/rgba\(46,194,126,/g) || [];
  assert.strictEqual(oldMotif.length, 0, 'dark-era motif family rgba(46,194,126,*) fully re-hued');
  // companion assert: #fbfaf5 == exactly 1 — the frozen geo literal
  assert.strictEqual(countOccurrences(css, '#fbfaf5'), 1, '#fbfaf5 appears exactly once (frozen geo literal)');
  // favicon carrier: the data-URI is re-rendered light from the tokens —
  // URL-encoded, so the hex bans cannot see it; resolve the values dynamically
  // and assert both the presence and the dark-era absences.
  const paper2 = tokenHex('--paper-2');
  const inkTok = tokenHex('--ink');
  assert.ok(html.includes('%23' + paper2.slice(1)), 'favicon fill is the light --paper-2 value (' + paper2 + ')');
  assert.ok(html.includes('%23' + inkTok.slice(1)), 'favicon stroke/text carry the light --ink value (' + inkTok + ')');
  assert.ok(!html.includes('%2317171a'), 'favicon dark-era fill %2317171a gone');
  assert.ok(!html.includes('%23ffffff'), 'favicon white ink %23ffffff gone');
  // still a data-URI — zero new requests, zero new files
  assert.ok(/<link rel="icon" href="data:image\/svg\+xml,/.test(html), 'favicon stays an inline data-URI');
});

test('(e) geo freeze strings present (secondary guard; mechanical proof = GEO-FREEZE-OK)', () => {
  assert.ok(html.includes('<div id="ws-jurisdiction-banner" class="jurisdiction-banner" hidden>'),
    'jurisdiction banner div present');
  assert.ok(html.includes('<template id="ws-geo-block">'), 'geo template present');
  assert.ok(css.includes('background: #fbfaf5; }'), 'frozen geo-card literal present');
  const f19 = 'geo-blocking has no adjudicated safe harbor — it reduces, not eliminates, exposure';
  assert.strictEqual(countOccurrences(html, f19), 2, 'F19 disclosure present exactly twice (banner + template)');
});

test('(f) frozen copy strings present exactly once each (contains-checks)', () => {
  const frozen = [
    'Yield vaults for <span class="punch">tokenized stocks</span>.<br><span class="quiet">Checkable, not sellable.</span>',
    'open-source ERC-4626 vaults and routes liquidity-pool fee income to depositors.',
    // WS-OG-PERF (2026-09-04): the meta description was re-locked to the ratified
    // one-sentence form — the old "No audit. Every number on this page …" meta
    // string is superseded (the og:description short variant below stays pinned).
    'Yield vaults for tokenized stocks on Robinhood Chain. Checkable, not sellable — every number verifiable on-chain.',
    'No audit. Every number is read by your browser straight from public chain nodes.',
    '1 · Approve',
    '2 · Deposit',
  ];
  for (const s of frozen) {
    assert.strictEqual(countOccurrences(html, s), 1, 'frozen copy appears exactly once: ' + s.slice(0, 44));
  }
});

// (g) WS-LEDGER-STRUCTURE (2026-09-04) — ascetic structure layer teeth:
//     hatched band separators, ledger-grid footer, hero CTA pair, mono metadata
//     edges. Text asserts only (countOccurrences / regex over the same two files)
//     — band weight and CTA proportions are asserted structurally here; pixel
//     fidelity is the human screenshot gate at soak-end, not this battery.
test('(g) WS-LEDGER-STRUCTURE structure layer: hatches, ledger-grid footer, CTA pair, mono metadata edges', () => {
  // (a) hatched band separators: one diagonal-gradient declaration per boundary
  //     (.hero and section.block as separate rule blocks — never grouped)
  assert.ok(countOccurrences(css, 'repeating-linear-gradient') >= 2, '>=2 repeating-linear-gradient declarations in style.css (one per hatched boundary)');
  assert.ok(countOccurrences(css, '45deg') >= 2, '>=2 45deg stripe gradients in style.css');
  // (b) ledger-grid footer: the .footer-grid rule carries a hard 1px border and a
  //     bordered .h header-cell rule exists
  assert.ok(/\.footer-grid \{[^}]*border: 1px solid var\(--line\)/.test(css), '.footer-grid rule carries a 1px solid var(--line) border');
  assert.ok(/\.footer-grid \.h \{[^}]*border: 1px solid/.test(css), '.footer-grid .h bordered header-cell rule exists');
  // (c) hero CTA pair: exactly one solid (#deposit) + one outline (#docs) anchor;
  //     'Read the code' survives exactly once (STATE PIN — the degen-copy-pass
  //     owns re-pinning this when it rewords the secondary CTA label)
  assert.strictEqual(countOccurrences(html, 'cta-solid'), 1, 'exactly one cta-solid anchor in index.html');
  assert.strictEqual(countOccurrences(html, 'cta-outline'), 1, 'exactly one cta-outline anchor in index.html');
  assert.ok(html.includes('<a class="cta-solid" href="#deposit">'), 'cta-solid anchors #deposit');
  assert.ok(html.includes('<a class="cta-outline" href="#docs">'), 'cta-outline anchors #docs');
  assert.strictEqual(countOccurrences(html, 'Read the code'), 1, "'Read the code' appears exactly once in index.html");
  // (d) mono metadata edges: .footer-fine rides the mono stack
  assert.ok(/\.footer-fine \{[^}]*var\(--mono\)/.test(css), '.footer-fine rule contains var(--mono)');
  // (e) stale CTA comment gone from the hero
  assert.strictEqual(countOccurrences(html, 'no new classes/resources'), 0, "stale comment 'no new classes/resources' gone from index.html");
  // (f) plain 2px bottom rules dropped 11 -> 9 (exactly the two hatched boundaries)
  assert.strictEqual(countOccurrences(css, 'border-bottom: 2px solid var(--line)'), 9, 'plain 2px bottom rule occurs exactly 9 times in style.css (hero + section.block hatched)');
});
