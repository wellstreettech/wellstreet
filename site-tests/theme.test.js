'use strict';
// FLIP-CARRIER-CONTRACT theme battery (2026-09-07) — DARK DOT-MATRIX flip
// contract (WS-DARK-DOTO; identity revision #6: dark-calm carbon/green ->
// the banner substrate #0A0E12 + bone ink #EDE9DC + single amber accent
// #E8A33D). Same assertion STRUCTURE as every predecessor flip, carrier
// table re-valued; predecessor: the 09-07 dark-calm rewrite, whose shape
// descends from the 09-04 FLIP-CARRIER-CONTRACT light rewrite.
// Dependency-free: node:test + node:assert + node:fs ONLY (no npm, no new deps).
// Assertions:
//   (a) pinned dot-matrix palette (tokens + shadows) present in style.css
//       — the whole carrier table re-valued; the shadow tokens pin FLAT
//       (none) for the first time: depth is the 2px border, never a shadow
//   (a2) deposit .index literal re-pinned to the --ink token
//   (b) head metas: theme-color == the --paper token value, color-scheme dark,
//       light metas ABSENT (the FIX-9 #f6f4ec absence survives; the
//       html-element inline color-scheme stays dark too)
//   (c) WCAG contrast >= 4.5:1 for exactly the six text pairs — same slots as
//       every predecessor flip, recomputed against the doto table
//   (d) retired-era + retained legacy values gone — GENERATED FROM THE LANDED
//       FLIP DIFF: the dark-calm carbon/green leavers, retained bans from every
//       predecessor era, 3-digit short forms, the leaving rgba() families
//       (\\s*-tolerant) and the exact old shadow strings, computed over the
//       geo-block-line-filtered stylesheet and over index.html whole-file;
//       #fbfaf5 companion count == 1 (the frozen geo literal only); the motif
//       green family is RETIRED (0 sites — the SVG motif is deleted outright);
//       favicon data-URI asserts (URL-encoded values are invisible to the hex
//       bans)
//   (e) geo freeze strings present (SECONDARY guard — the mechanical proof is the
//       VERIFYCMDS dispatch-capture + diff chain ending GEO-FREEZE-OK)
//   (f) frozen copy strings present exactly once each (contains-checks, never
//       line-equality — line positions may shift) — re-pinned to the banner
//       headline register (WS-DARK-DOTO copy diet)
//   (g) WS-DARK-DOTO structure-layer teeth: the halftone field, the amber
//       hero rule, hard 2px band boundaries (hatches retired), the ledger-grid
//       footer, the ONE CTA, mono metadata edges.
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

// Pinned dot-matrix palette (WS-DARK-DOTO; values, not layout). Anchors:
// --paper #0A0E12 substrate, --ink #EDE9DC bone, --accent #E8A33D the SINGLE
// amber (fill AND text role — one accent, both roles). Companions authored +
// measured in-wave: every (c) pair clears AA with headroom. --accent-ink is
// substrate text on amber fills (8.99:1); --accent-punch is the brightest
// amber step (focus ring). Shadows pin FLAT: the identity is hard borders.
const PALETTE = [
  ['--paper', '#0A0E12'],
  ['--paper-2', '#070B0E'],
  ['--ink', '#EDE9DC'],
  ['--ink-soft', '#9A948A'],
  ['--line', '#262E36'],
  ['--accent', '#E8A33D'],
  ['--accent-ink', '#0A0E12'],
  ['--accent-text', '#E8A33D'],
  ['--warn', '#D96A52'],
  ['--code-bg', '#060A0D'],
  ['--paper-raised', '#10161C'],
  ['--paper-pending', '#090D11'],
  ['--warn-bg', '#30181A'],
  ['--accent-visited', '#C98F35'],
  ['--accent-hover', '#F0B55A'],
  ['--line-dotted', '#1D242B'],
  ['--chip-tan', '#262218'],
  ['--footer-muted', '#8F8A80'],
  ['--footer-faint', '#7E796F'],
  ['--accent-punch', '#F5C069'],
  ['--ink-deep', '#05080A'],
  ['--shadow-soft', 'none'],
  ['--shadow-soft-hover', 'none'],
];

// LEGACY_HEXES — GENERATED FROM THE LANDED FLIP DIFF, not hand-listed.
//   dark-calm leavers (the 2026-09-07 revision-5 table, replaced by this flip):
//   every hex the carbon/green table carried. The light-era leaver list is
//   RETAINED minus #EDE9DC — the banner ink is now an AUTHORED value.
//   Retained bans from every predecessor era stay — NEVER LOOSEN. Short forms
//   are banned by SUBSTRING (includes('#000') cannot match 'background: #000;'
//   — direction matters, and no authored doto value contains either short form).
//   Authored dark-table values are asserted to NOT collide (below + by (a)'s
//   positive pins). #f6f4ec (the superseded cream candidate) STAYS banned.
const LEGACY_HEXES = [
  // dark-calm leavers (the revision-5 carbon/green table, replaced by this flip)
  '#0B0D0C', '#070908', '#EAE6DB', '#A29C90', '#3B372F', '#00A86B', '#00a86b',
  '#2FBF83', '#0CC07C', '#219167', '#5BD9A4', '#0E100F', '#151817', '#090B0A',
  '#050706',
  // light-era leavers (the 2026-09-04 table — #EDE9DC promoted to authored)
  '#E4DFD1', '#F3EFE3', '#E7E2D4', '#E0D9C9', '#EFD9D1',
  '#1C1A15', '#5C584C', '#C8C1AD', '#AFA892', '#3A6B58', '#0FB879',
  '#D9CFB4', '#4E4939', '#615C4C', '#006B45', '#0d6b4f', '#a33a24',
  '#E2DCCB', '#F4F0E4', '#B7AE9C',
  // dark-era leavers (retained — the first flip's ban list survives)
  '#000000', '#17171a', '#2ec27e', '#27a86c', '#3ad18e', '#3fe396', '#131316',
  '#101014', '#2a1512', '#4a4a4e', '#28282a', '#011A25', '#d6d1c0',
  // stale fallback literals from earlier eras (retained)
  '#ffffff', '#8e8e8e', '#a8a8ae', '#c4c2c3', '#e0654a',
  // 3-digit short forms (substring direction)
  '#000', '#fff',
  // superseded paper candidate — stays banned
  '#f6f4ec',
  // earlier paper-era bans retained (never loosen)
  '#efecdf', '#17191d', '#4c4f55', '#e9e5d6', '#f8f5ea', '#f8e9e3', '#0a5540',
  '#0a5940', '#b9b4a3', '#cfcabb', '#b7b2a2', '#0b7f56', '#6f6a54',
];

// Authored dark-table values must not collide with any retained ban entry.
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

test('(a) pinned dot-matrix palette tokens present in style.css', () => {
  for (const [name, value] of PALETTE) {
    assert.ok(tokenRegex(name, value).test(css), name + ' must carry ' + value);
  }
});

test('(a2) deposit .index literal re-pinned to the --ink token', () => {
  assert.ok(/#deposit \.index \{ color: var\(--ink\); \}/.test(css),
    '#deposit .index must carry color: var(--ink) (token, no literal)');
});

test('(b) theme-color equals --paper; color-scheme dark; light metas ABSENT', () => {
  const paper = (css.match(/--paper[ \t]*:[ \t]*(#[0-9a-fA-F]{6})/) || [])[1];
  assert.ok(paper, '--paper hex resolvable in style.css');
  const meta = html.match(/<meta name="theme-color" content="([^"]+)">/);
  assert.ok(meta, 'theme-color meta present in index.html');
  assert.strictEqual(meta[1], paper, 'theme-color content equals the --paper token value');
  assert.match(html, /<meta name="color-scheme" content="dark">/, 'color-scheme meta is dark');
  assert.ok(!html.includes('color-scheme" content="light"'), 'light color-scheme meta absent (doto flip)');
  assert.ok(!html.includes('color-scheme: light'), 'light inline color-scheme absent from the html element (doto flip)');
  assert.ok(!html.includes('content="#E4DFD1"'), 'light-era theme-color meta absent (retained pin)');
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

test('(d) legacy retired-era + retained values gone (geo-frozen lines excluded from the sweep)', () => {
  // grep -v geo-block equivalent: drop every line containing 'geo-block' — removes
  // the only literal-bearing geo rules plus the var-only geo lines, line-agnostic.
  // The .geo-block-head color stays a short-form literal ON a geo line (exempt),
  // re-evaluated for the doto table: white on the frozen --warn head measures
  // well clear of AA.
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
  // retired rgba families (kept from every predecessor rewrite + the motif green)
  assert.ok(!/rgba\(14,\s*61/.test(cssSweep), 'legacy blue shadow family rgba(14, 61, ...) gone from style.css');
  assert.ok(!/rgba\(13,\s*107/.test(cssSweep), 'legacy motif green family rgba(13, 107, ...) gone from style.css');
  assert.ok(!/rgba\(14,\s*61/.test(html), 'legacy rgba(14, 61, ...) absent from index.html');
  assert.ok(!/rgba\(13,\s*107/.test(html), 'legacy rgba(13, 107, ...) absent from index.html');
  assert.ok(!/rgba\(0,\s*168,\s*107/.test(cssSweep), 'the motif green rgba family is retired from style.css (WS-DARK-DOTO)');
  assert.ok(!/rgba\(0,\s*168,\s*107/.test(html), 'the motif green rgba family is retired from index.html (the SVG motif is deleted outright)');
  // leaving rgba() families from the landed flip diffs (\s*-tolerant — BOTH byte
  // forms existed across eras)
  assert.ok(!/rgba\(255,\s*255,\s*255/.test(cssSweep), 'leaving white rgba family gone from style.css');
  assert.ok(!/rgba\(46,\s*194,\s*126/.test(cssSweep), 'leaving dark-accent rgba family gone from style.css');
  assert.ok(!/rgba\(224,\s*101,\s*74/.test(cssSweep), 'leaving dark-warn rgba family gone from style.css');
  assert.ok(!/rgba\(28,\s*26,\s*21/.test(cssSweep), 'leaving light-shadow rgba family gone from style.css');
  assert.ok(!/rgba\(163,\s*58,\s*36/.test(cssSweep), 'leaving light-warn rgba family gone from style.css');
  assert.ok(!/rgba\(255,\s*255,\s*255/.test(html), 'leaving white rgba family absent from index.html');
  assert.ok(!/rgba\(46,\s*194,\s*126/.test(html), 'leaving dark-accent rgba family absent from index.html');
  assert.ok(!/rgba\(224,\s*101,\s*74/.test(html), 'leaving dark-warn rgba family absent from index.html');
  assert.ok(!/rgba\(28,\s*26,\s*21/.test(html), 'leaving light-shadow rgba family absent from index.html');
  assert.ok(!/rgba\(163,\s*58,\s*36/.test(html), 'leaving light-warn rgba family absent from index.html');
  // the exact old shadow strings (whole values, not a family ban — the doto
  // table pins the shadow TOKENS to none; no spaced rgba shadow ships)
  assert.ok(!cssSweep.includes('rgba(0,0,0,0.55)'), 'old dark shadow rgba(0,0,0,0.55) gone from style.css');
  assert.ok(!cssSweep.includes('rgba(0,0,0,0.7)'), 'old dark shadow rgba(0,0,0,0.7) gone from style.css');
  assert.ok(!cssSweep.includes('rgba(0, 0, 0,'), 'no black rgba shadow literal ships (the shadow tokens pin none)');
  assert.ok(!html.includes('content="#f6f4ec"'), 'meta content="#f6f4ec" absent from index.html');
  assert.ok(!html.includes('color-scheme" content="light"'), 'light color-scheme meta absent from index.html (inverted light-era pin)');
  // motif retint RETIRED (WS-DARK-DOTO): the green motif SVG is deleted outright —
  // the green family must be gone and the amber halftone/ink families are the
  // only painted textures.
  const retint = html.match(/rgba\(0,168,107,/g) || [];
  assert.strictEqual(retint.length, 0, 'the motif green carries ZERO sites in index.html (deleted outright)');
  const oldMotif = html.match(/rgba\(46,194,126,/g) || [];
  assert.strictEqual(oldMotif.length, 0, 'dark-era motif family rgba(46,194,126,*) stays fully retired');
  // companion assert: #fbfaf5 == exactly 1 — the frozen geo literal
  assert.strictEqual(countOccurrences(css, '#fbfaf5'), 1, '#fbfaf5 appears exactly once (frozen geo literal)');
  // favicon carrier: the data-URI is re-rendered from the doto tokens —
  // URL-encoded, so the hex bans cannot see it; resolve the values dynamically
  // and assert both the presence and the light-era absences.
  const paper2 = tokenHex('--paper-2');
  const inkTok = tokenHex('--ink');
  assert.ok(html.includes('%23' + paper2.slice(1)), 'favicon fill is the doto --paper-2 value (' + paper2 + ')');
  assert.ok(html.includes('%23' + inkTok.slice(1)), 'favicon stroke/text carry the doto --ink value (' + inkTok + ')');
  assert.ok(!html.includes('%23E4DFD1'), 'favicon light-era fill %23E4DFD1 gone');
  assert.ok(!html.includes('%231C1A15'), 'favicon light-era ink %231C1A15 gone');
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
    // WS-DARK-DOTO 2026-09-07: the banner headline is the h1 — the ratified
    // north-star copy (docs/internal/design-kit/twitter/twitter-banner.html).
    '<h1>OWNED BY HOLDERS.<br>OPERATED BY AGENTS.</h1>',
    'WELLSTREET — ROBINHOOD CHAIN 4663',
    'every number is a raw RPC call',
    'replay them yourself',
    '<a class="cta-solid" href="#fleet">Open the Fleet</a>',
    // head carriers (invisible to the visible-word diet; still single-source):
    // WS-MESSAGING-V2 2026-09-06 form retained — the meta description and the
    // og:description short variant stay pinned.
    'The open liquidity layer of Robinhood Chain, operated by agents and verifiable by anyone. Every number is a raw RPC call — checkable, not sellable.',
    'No audit. Every number is read by your browser straight from public chain nodes.',
    '1 · Approve',
    '2 · Deposit',
  ];
  for (const s of frozen) {
    assert.strictEqual(countOccurrences(html, s), 1, 'frozen copy appears exactly once: ' + s.slice(0, 44));
  }
});

// WS-MESSAGING-V2 kill-list guard, re-pinned WS-DARK-DOTO (2026-09-07): the
// banner headline replaces the two-tone h1, so the tagline's capital form is
// retired from the body (its lowercase echo survives once, in the meta
// description). Kill-list strings stay absent from index.html.
test('WS-MESSAGING-V2 kill-list guard (doto re-pin)', () => {
  assert.strictEqual(countOccurrences(html, 'tokenized stocks'), 0, 'kill-list: tokenized-stocks identity gone');
  assert.strictEqual(countOccurrences(html, 'S&P'), 0, 'kill-list: bare S&P gone');
  assert.strictEqual(countOccurrences(html, 'S&amp;P'), 0, 'kill-list: encoded S&amp;P gone');
  assert.ok(!/guaranteed|risk-free|auto yield|passive income/i.test(html), 'kill-list: no yield overclaim');
  assert.ok(!/ownerless|fully decentralized|trustless/i.test(html), 'kill-list: no decentralization overclaim');
  assert.ok(!/vibe/i.test(html), 'kill-list: no VIBE cross-contamination');
  assert.strictEqual(countOccurrences(html, 'OWNED BY HOLDERS.'), 1,
    'the banner headline line 1 lives exactly once');
  assert.strictEqual(countOccurrences(html, 'OPERATED BY AGENTS.'), 1,
    'the banner headline line 2 lives exactly once');
  assert.strictEqual(countOccurrences(html, 'Checkable, not sellable.'), 0,
    'the capital-form tagline retired with the two-tone h1 (doto copy diet)');
  assert.strictEqual(countOccurrences(html, 'checkable, not sellable.'), 1,
    'the lowercase echo lives exactly once, in the meta description');
});

// (g) WS-DARK-DOTO structure-layer teeth (2026-09-07) — the banner anatomy:
//     the halftone field, the amber rule, hard 2px band boundaries (the
//     diagonal hatches retire with the identity), the ledger-grid footer,
//     ONE CTA, mono metadata edges. Text asserts only (countOccurrences /
//     regex over the same two files) — pixel fidelity is the human
//     screenshot gate at soak-end, not this battery.
test('(g) WS-DARK-DOTO structure layer: halftone field, amber rule, hard boundaries, ledger footer, one CTA', () => {
  // (a) the halftone field: the banner's dot grid + the ledger column lines —
  //     the page's ONLY painted textures (no images, no other gradients)
  assert.strictEqual(countOccurrences(css, 'radial-gradient(circle, rgba(237, 233, 220, 0.055) 1px, transparent 1.2px)'), 1,
    'the halftone dot grid ships exactly once (the banner field)');
  assert.ok(countOccurrences(css, '14px 14px') >= 1, 'the halftone grid step (14px) is present');
  assert.strictEqual(countOccurrences(css, 'repeating-linear-gradient'), 1,
    'exactly one repeating-linear-gradient ships (the halftone ledger lines — the diagonal hatches are retired)');
  assert.strictEqual(countOccurrences(css, '45deg'), 0, 'no diagonal-stripe hatch gradients remain (doto identity)');
  // (b) the amber rule: the banner's single accent bar under the headline
  assert.ok(/\.hero-rule \{[^}]*background: var\(--accent\);/.test(css), '.hero-rule carries the amber fill');
  // (c) band boundaries are hard 2px rules now (hero + section.block, separate blocks)
  assert.strictEqual(countOccurrences(css, 'border-bottom: 2px solid var(--line)'), 11,
    'plain 2px bottom rule occurs exactly 11 times in style.css (the hard-boundary register)');
  // (d) ledger-grid footer: the .footer-grid rule carries a hard 1px border and a
  //     bordered .h header-cell rule exists
  assert.ok(/\.footer-grid \{[^}]*border: 1px solid var\(--line\)/.test(css), '.footer-grid rule carries a 1px solid var(--line) border');
  assert.ok(/\.footer-grid \.h \{[^}]*border: 1px solid/.test(css), '.footer-grid .h bordered header-cell rule exists');
  // (e) ONE CTA: exactly one solid anchor, no outline CTA;
  //     'Read the code' retired with the second anchor
  assert.strictEqual(countOccurrences(html, 'cta-solid'), 1, 'exactly one cta-solid anchor in index.html');
  assert.strictEqual(countOccurrences(html, 'cta-outline'), 0, 'the outline CTA is retired (one CTA, the banner contract)');
  assert.ok(html.includes('<a class="cta-solid" href="#fleet">Open the Fleet</a>'), 'cta-solid anchors #fleet (Open the Fleet)');
  assert.strictEqual(countOccurrences(html, 'Read the code'), 0, "'Read the code' retired with the outline CTA");
  // (f) mono metadata edges: .footer-fine rides the mono stack
  assert.ok(/\.footer-fine \{[^}]*var\(--mono\)/.test(css), '.footer-fine rule contains var(--mono)');
  // (g) stale CTA comment gone from the hero
  assert.strictEqual(countOccurrences(html, 'no new classes/resources'), 0, "stale comment 'no new classes/resources' gone from index.html");
});
