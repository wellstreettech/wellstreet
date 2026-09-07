'use strict';
// FLIP-CARRIER-CONTRACT theme battery (2026-09-07) — dark-calm flip contract,
// identity revision #5 (light-paper 2026-09-04 -> dark-calm carbon; same
// assertion STRUCTURE, expectations inverted; predecessor: the 09-04
// FLIP-CARRIER-CONTRACT light rewrite, which this file's shape descends from).
// Dependency-free: node:test + node:assert + node:fs ONLY (no npm, no new deps).
// Assertions:
//   (a) pinned dark-calm palette (tokens + shadows) present in style.css
//       — the whole carrier table re-valued + --ink-deep pinned for the first
//       time (it existed as an unpinned footer-surface token before this flip)
//   (b) head metas: theme-color == the --paper token value, color-scheme dark,
//       light metas ABSENT (light-era pins inverted; the FIX-9 #f6f4ec absence
//       survives; the html-element inline color-scheme stays dark too)
//   (c) WCAG contrast >= 4.5:1 for exactly the six text pairs — same slots as
//       every predecessor flip, recomputed against the carbon table
//   (d) light-era + retained legacy values gone — GENERATED FROM THE LANDED
//       FLIP DIFF: light-era leavers, retained dark-era/paper-era leavers,
//       3-digit short forms, the leaving rgba() families (\s*-tolerant) and
//       the exact old shadow strings, computed over the geo-block-line-filtered
//       stylesheet and over index.html whole-file; #fbfaf5 companion count == 1
//       (the frozen geo literal only); motif retint re-anchored to
//       rgba(0,168,107, at exactly six sites; favicon data-URI asserts
//       (URL-encoded values are invisible to the hex bans)
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

// Pinned dark-calm palette (FLIP-CARRIER-CONTRACT, revision #5; values, not
// layout). Anchors: --paper #0B0D0C carbon, --accent #00A86B STAYS the ratified
// green (FILL role). Companions authored + measured in-wave: every pair (c)
// asserts clears AA with headroom. --accent-ink is carbon text on #00A86B fills
// (6.3:1); --accent-text is the brighter accent-as-TEXT step (8.3:1 on carbon —
// on dark the punch direction re-inverts: --accent-punch is now the BRIGHTEST
// text-safe step, the light-era deepest-step rule is dead).
const PALETTE = [
  ['--paper', '#0B0D0C'],
  ['--paper-2', '#070908'],
  ['--ink', '#EAE6DB'],
  ['--ink-soft', '#A29C90'],
  ['--line', '#3B372F'],
  ['--accent', '#00A86B'],
  ['--accent-ink', '#0B0D0C'],
  ['--accent-text', '#2FBF83'],
  ['--warn', '#D96A52'],
  ['--code-bg', '#050706'],
  ['--paper-raised', '#151817'],
  ['--paper-pending', '#090B0A'],
  ['--warn-bg', '#30181A'],
  ['--accent-visited', '#219167'],
  ['--accent-hover', '#0CC07C'],
  ['--line-dotted', '#2E2B25'],
  ['--chip-tan', '#262218'],
  ['--footer-muted', '#A8A297'],
  ['--footer-faint', '#948E83'],
  ['--accent-punch', '#5BD9A4'],
  ['--ink-deep', '#0E100F'],
  ['--shadow-soft', '0 20px 28px rgba(0, 0, 0, 0.45)'],
  ['--shadow-soft-hover', '0 24px 40px rgba(0, 0, 0, 0.60)'],
];

// LEGACY_HEXES — GENERATED FROM THE LANDED FLIP DIFF, not hand-listed.
//   light-era leavers: every hex the light table carried that the dark-calm
//   table replaces (the goal names twelve; the diff adds the footer/chip/punch/
//   warn/shadow-surface carriers + the two comment-only values so they cannot
//   survive invisibly in a comment or var() fallback). Retained bans from every
//   predecessor era stay — NEVER LOOSEN. Short forms are banned by SUBSTRING
//   (includes('#000') cannot match 'background: #000;' — direction matters, and
//   no authored carbon value contains either short form).
//   Authored dark-table values are asserted to NOT collide (below + by (a)'s
//   positive pins). #f6f4ec (the superseded cream candidate) STAYS banned.
const LEGACY_HEXES = [
  // light-era leavers (the 2026-09-04 table, replaced by this flip)
  '#EDE9DC', '#E4DFD1', '#F3EFE3', '#E7E2D4', '#E0D9C9', '#EFD9D1',
  '#1C1A15', '#5C584C', '#C8C1AD', '#AFA892', '#3A6B58', '#0FB879',
  // light-era leavers from the landed diff beyond the goal's named twelve
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

test('(a) pinned dark-calm palette tokens present in style.css', () => {
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
  assert.ok(!html.includes('color-scheme" content="light"'), 'light color-scheme meta absent (dark-calm flip)');
  assert.ok(!html.includes('color-scheme: light'), 'light inline color-scheme absent from the html element (dark-calm flip)');
  assert.ok(!html.includes('content="#EDE9DC"'), 'light theme-color meta absent (dark-calm flip)');
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

test('(d) legacy light-era + retained values gone (geo-frozen lines excluded from the sweep)', () => {
  // grep -v geo-block equivalent: drop every line containing 'geo-block' — removes
  // the only literal-bearing geo rules plus the var-only geo lines, line-agnostic.
  // The .geo-block-head color stays a short-form literal ON a geo line (exempt),
  // re-evaluated for the dark table: white on the frozen --warn head measures
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
  // dark-era rgba families (kept from every predecessor rewrite)
  assert.ok(!/rgba\(14,\s*61/.test(cssSweep), 'legacy blue shadow family rgba(14, 61, ...) gone from style.css');
  assert.ok(!/rgba\(13,\s*107/.test(cssSweep), 'legacy motif green family rgba(13, 107, ...) gone from style.css');
  assert.ok(!/rgba\(14,\s*61/.test(html), 'legacy rgba(14, 61, ...) absent from index.html');
  assert.ok(!/rgba\(13,\s*107/.test(html), 'legacy rgba(13, 107, ...) absent from index.html');
  // leaving rgba() families from the landed flip diffs (\s*-tolerant — BOTH byte
  // forms existed across eras; the light table's shadow + warn families leave here)
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
  // the exact old shadow strings (whole values, not a family ban — the new
  // dark alphas are spaced-form and deliberately distinct)
  assert.ok(!cssSweep.includes('rgba(0,0,0,0.55)'), 'old dark shadow rgba(0,0,0,0.55) gone from style.css');
  assert.ok(!cssSweep.includes('rgba(0,0,0,0.7)'), 'old dark shadow rgba(0,0,0,0.7) gone from style.css');
  assert.ok(!html.includes('content="#f6f4ec"'), 'meta content="#f6f4ec" absent from index.html');
  assert.ok(!html.includes('color-scheme" content="light"'), 'light color-scheme meta absent from index.html (inverted light-era pin)');
  // motif retint (ratified green stays the fill hue): alpha-preserved 1:1 at
  // exactly the six sites
  const retint = html.match(/rgba\(0,168,107,/g) || [];
  assert.strictEqual(retint.length, 6, 'motif carries rgba(0,168,107,*) at exactly six sites');
  const oldMotif = html.match(/rgba\(46,194,126,/g) || [];
  assert.strictEqual(oldMotif.length, 0, 'dark-era motif family rgba(46,194,126,*) fully re-hued');
  // companion assert: #fbfaf5 == exactly 1 — the frozen geo literal
  assert.strictEqual(countOccurrences(css, '#fbfaf5'), 1, '#fbfaf5 appears exactly once (frozen geo literal)');
  // favicon carrier: the data-URI is re-rendered dark from the tokens —
  // URL-encoded, so the hex bans cannot see it; resolve the values dynamically
  // and assert both the presence and the light-era absences.
  const paper2 = tokenHex('--paper-2');
  const inkTok = tokenHex('--ink');
  assert.ok(html.includes('%23' + paper2.slice(1)), 'favicon fill is the dark --paper-2 value (' + paper2 + ')');
  assert.ok(html.includes('%23' + inkTok.slice(1)), 'favicon stroke/text carry the dark --ink value (' + inkTok + ')');
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
    // WS-MESSAGING-V2 2026-09-06: the tokenized-stocks h1 was retired by the
    // ratified copy pass — re-pinned to the v2 two-tone form (structure unchanged:
    // line-1 claim + punch accent + br + quiet tagline).
    'The open liquidity layer of <span class="punch">Robinhood Chain</span>.<br><span class="quiet">Checkable, not sellable.</span>',
    // WS-MESSAGING-V2 2026-09-06: string retired by the ratified copy pass
    // ("open-source ERC-4626 vaults and routes liquidity-pool fee income to
    // depositors." lived only in the old lede; the v2 lede no longer contains it —
    // the og:description's "Open-source ERC-4626 vaults and protocol-owned
    // liquidity…" is a different string, still pinned via its "No audit." tail).
    // WS-OG-PERF (2026-09-04): the meta description was re-locked to the ratified
    // one-sentence form — the old "No audit. Every number on this page …" meta
    // string is superseded (the og:description short variant below stays pinned).
    // WS-MESSAGING-V2 2026-09-06: re-locked again to the v2 identity form.
    // WS-MESSAGING-V2-GATE-FIX (2026-09-06, main session): the tagline clause moved
    // to the lowercase tail so the period-form tagline keeps its single carrier (the
    // h1 quiet span); <title> mirrors og:title without the tagline.
    'The open liquidity layer of Robinhood Chain, operated by agents and verifiable by anyone. Every number is a raw RPC call — checkable, not sellable.',
    'No audit. Every number is read by your browser straight from public chain nodes.',
    '1 · Approve',
    '2 · Deposit',
  ];
  for (const s of frozen) {
    assert.strictEqual(countOccurrences(html, s), 1, 'frozen copy appears exactly once: ' + s.slice(0, 44));
  }
});

// WS-MESSAGING-V2 kill-list guard (2026-09-06): the ratified v2 copy pass retired
// the tokenized-stocks identity. Kill-list strings stay absent from index.html;
// the tagline stays exactly once as the h1 quiet span. GATE-FIX note (2026-09-06,
// main session): the dispatch's edit-1 title/meta pins tripled the matchable tagline
// form against the =1 boundary; the pins are amended — <title> mirrors og:title and
// the meta carries the lowercase echo "checkable, not sellable." — restoring the
// original single-carrier invariant (the period form appears ONLY in the h1).
test('WS-MESSAGING-V2 kill-list guard', () => {
  assert.strictEqual(countOccurrences(html, 'tokenized stocks'), 0, 'kill-list: tokenized-stocks identity gone');
  assert.strictEqual(countOccurrences(html, 'S&P'), 0, 'kill-list: bare S&P gone');
  assert.strictEqual(countOccurrences(html, 'S&amp;P'), 0, 'kill-list: encoded S&amp;P gone');
  assert.ok(!/guaranteed|risk-free|auto yield|passive income/i.test(html), 'kill-list: no yield overclaim');
  assert.ok(!/ownerless|fully decentralized|trustless/i.test(html), 'kill-list: no decentralization overclaim');
  assert.ok(!/vibe/i.test(html), 'kill-list: no VIBE cross-contamination');
  assert.strictEqual(countOccurrences(html, '<span class="quiet">Checkable, not sellable.</span>'), 1,
    'the tagline lives exactly once, as the h1 quiet span');
  assert.strictEqual(countOccurrences(html, 'Checkable, not sellable.'), 1,
    'period-form tagline = the h1 quiet span exactly once (GATE-FIX: head carriers amended out)');
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
  // (c) hero CTA pair: exactly one solid + one outline anchor;
  //     'Read the code' survives exactly once (STATE PIN — the degen-copy-pass
  //     owns re-pinning this when it rewords the secondary CTA label)
  //     re-pinned 2026-09-07 (WS5-SKELETON): the solid primary anchors #fleet
  //     now ('Open the Fleet') — the deposit widget moved into the flagship
  //     fleet card, so the old #deposit target byte-pin retired with the move.
  assert.strictEqual(countOccurrences(html, 'cta-solid'), 1, 'exactly one cta-solid anchor in index.html');
  assert.strictEqual(countOccurrences(html, 'cta-outline'), 1, 'exactly one cta-outline anchor in index.html');
  assert.ok(html.includes('<a class="cta-solid" href="#fleet">Open the Fleet</a>'), 'cta-solid anchors #fleet (Open the Fleet)');
  assert.ok(html.includes('<a class="cta-outline" href="#docs">'), 'cta-outline anchors #docs');
  assert.strictEqual(countOccurrences(html, 'Read the code'), 1, "'Read the code' appears exactly once in index.html");
  // (d) mono metadata edges: .footer-fine rides the mono stack
  assert.ok(/\.footer-fine \{[^}]*var\(--mono\)/.test(css), '.footer-fine rule contains var(--mono)');
  // (e) stale CTA comment gone from the hero
  assert.strictEqual(countOccurrences(html, 'no new classes/resources'), 0, "stale comment 'no new classes/resources' gone from index.html");
  // (f) plain 2px bottom rules dropped 11 -> 9 (exactly the two hatched boundaries)
  assert.strictEqual(countOccurrences(css, 'border-bottom: 2px solid var(--line)'), 9, 'plain 2px bottom rule occurs exactly 9 times in style.css (hero + section.block hatched)');
});
