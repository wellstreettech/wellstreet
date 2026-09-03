'use strict';
// WSV-DARK-RESKIN-ALL theme battery (2026-09-02) — dark token flip contract.
// Dependency-free: node:test + node:assert + node:fs ONLY (no npm, no new deps).
// Assertions:
//   (a) pinned dark palette (tokens + shadows + deposit literal) present in style.css
//   (b) head metas: theme-color == the --paper token value, color-scheme dark,
//       light metas ABSENT (FIX-9 second absence term)
//   (c) WCAG contrast >= 4.5:1 for exactly the six text pairs (no footer/line pairs)
//   (d) legacy paper-era values gone — computed over the geo-block-line-filtered
//       stylesheet (grep -v geo-block equivalent) and over index.html whole-file;
//       #fbfaf5 companion count == 1 (the frozen geo literal only)
//   (e) geo freeze strings present (SECONDARY guard — the mechanical proof is the
//       VERIFYCMDS dispatch-capture + diff chain ending GEO-FREEZE-OK)
//   (f) frozen copy strings present exactly once each (contains-checks, never
//       line-equality — line positions may shift)
// If (d) fails the flip list is incomplete — fix the flip; NEVER edit the
// geo-frozen lines to satisfy an assertion.

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

// Pinned dark palette (byte-exact contract from the goals doc; values, not layout).
const PALETTE = [
  ['--paper', '#000000'],
  ['--paper-2', '#17171a'],
  ['--ink', '#ffffff'],
  ['--ink-soft', '#8e8e8e'],
  ['--line', 'rgba(255,255,255,0.4)'],
  ['--accent', '#2ec27e'],
  ['--accent-ink', '#000000'],
  ['--warn', '#e0654a'],
  ['--code-bg', '#131316'],
  ['--paper-raised', '#131316'],
  ['--paper-pending', '#101014'],
  ['--warn-bg', '#2a1512'],
  ['--accent-visited', '#27a86c'],
  ['--accent-hover', '#3ad18e'],
  ['--line-dotted', '#4a4a4e'],
  // R3 IMP-2 (2026-09-02): footer text re-pointed into the dark family on
  // --ink-deep #011A25 — #a8a8ae = 7.5:1, #8e8e8e = 5.4:1, both AA-clear
  // (the white-footer values #3c3c40/#6a6a70 died with the footer flip fix)
  ['--footer-muted', '#a8a8ae'],
  ['--footer-faint', '#8e8e8e'],
  ['--accent-punch', '#3fe396'],
  ['--shadow-soft', '0 20px 28px rgba(0,0,0,0.55)'],
  ['--shadow-soft-hover', '0 24px 40px rgba(0,0,0,0.7)'],
];

const LEGACY_HEXES = [
  '#f6f4ec', '#efecdf', '#17191d', '#4c4f55', '#0d6b4f', '#a33a24',
  '#e9e5d6', '#f8f5ea', '#f8e9e3', '#0a5540', '#0a5940', '#b9b4a3',
  '#cfcabb', '#b7b2a2', '#0b7f56', '#6f6a54',
];

function tokenRegex(name, value) {
  // whitespace-tolerant after the colon (file writes "--paper: #...;", table writes none)
  return new RegExp(escapeRegExp(name) + '[ \\t]*:[ \\t]*' + escapeRegExp(value));
}

function countOccurrences(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test('(a) pinned dark palette tokens present in style.css', () => {
  for (const [name, value] of PALETTE) {
    assert.ok(tokenRegex(name, value).test(css), name + ' must carry ' + value);
  }
});

test('(a2) deposit .index literal flipped to #d6d1c0', () => {
  assert.ok(/#deposit \.index \{ color: #d6d1c0; \}/.test(css),
    '#deposit .index must carry the flipped #d6d1c0 literal');
});

test('(b) theme-color equals --paper; color-scheme dark; light metas ABSENT', () => {
  const paper = (css.match(/--paper[ \t]*:[ \t]*(#[0-9a-fA-F]{6})/) || [])[1];
  assert.ok(paper, '--paper hex resolvable in style.css');
  const meta = html.match(/<meta name="theme-color" content="([^"]+)">/);
  assert.ok(meta, 'theme-color meta present in index.html');
  assert.strictEqual(meta[1], paper, 'theme-color content equals the --paper token value');
  assert.match(html, /<meta name="color-scheme" content="dark">/, 'color-scheme meta is dark');
  assert.ok(!html.includes('content="#f6f4ec"'), 'light theme-color meta absent (FIX-9)');
  assert.ok(!html.includes('color-scheme" content="light"'), 'light color-scheme meta absent (FIX-9)');
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
  const warn = tokenValue('--warn');
  const pairs = [
    ['ink/paper', ink, paper],
    ['ink-soft/paper', inkSoft, paper],
    ['accent/paper', accent, paper],
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

test('(d) legacy paper-era values gone (geo-frozen lines excluded from the sweep)', () => {
  // grep -v geo-block equivalent: drop every line containing 'geo-block' — removes
  // the only literal-bearing geo rules plus the var-only geo lines, line-agnostic.
  const cssSweep = css.split('\n')
    .filter((line) => !line.includes('geo-block'))
    .join('\n');
  for (const v of LEGACY_HEXES) {
    assert.ok(!cssSweep.includes(v), 'legacy ' + v + ' gone from style.css (geo-block lines excluded)');
    assert.ok(!html.includes(v), 'legacy ' + v + ' gone from index.html');
  }
  assert.ok(!/rgba\(14,\s*61/.test(cssSweep), 'legacy blue shadow family rgba(14, 61, ...) gone from style.css');
  assert.ok(!/rgba\(13,\s*107/.test(cssSweep), 'legacy motif green family rgba(13, 107, ...) gone from style.css');
  assert.ok(!/rgba\(14,\s*61/.test(html), 'legacy rgba(14, 61, ...) absent from index.html');
  assert.ok(!/rgba\(13,\s*107/.test(html), 'legacy rgba(13, 107, ...) absent from index.html');
  assert.ok(!html.includes('content="#f6f4ec"'), 'meta content="#f6f4ec" absent from index.html');
  assert.ok(!html.includes('color-scheme" content="light"'), 'light color-scheme meta absent from index.html');
  // motif retint: alpha-preserved 1:1 at exactly the six sites
  const retint = html.match(/rgba\(46,194,126,/g) || [];
  assert.strictEqual(retint.length, 6, 'motif retinted to rgba(46,194,126,*) at exactly six sites');
  // companion assert: #fbfaf5 == exactly 1 — the frozen geo literal; the flipped
  // --paper-raised no longer matches (pre-flip == 2)
  assert.strictEqual(countOccurrences(css, '#fbfaf5'), 1, '#fbfaf5 appears exactly once (frozen geo literal)');
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
    'Yield vaults for <span class="punch">tokenized stocks</span>.<br>Checkable, not sellable.',
    'open-source ERC-4626 vaults and routes liquidity-pool fee income to depositors.',
    'No audit. Every number on this page is read by your browser straight from public chain nodes.',
    'No audit. Every number is read by your browser straight from public chain nodes.',
    '1 · Approve',
    '2 · Deposit',
  ];
  for (const s of frozen) {
    assert.strictEqual(countOccurrences(html, s), 1, 'frozen copy appears exactly once: ' + s.slice(0, 44));
  }
});
