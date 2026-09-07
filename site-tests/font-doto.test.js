'use strict';
// DOTO IDENTITY TESTS (WS5-DOTO, 2026-09-07) — the dot-matrix face as a contract.
// Pairs the goal's locked rule: display = Doto, every measured figure = Doto,
// prose = serif, labels/units = mono. Pins:
//   - the subset face ships on-disk within budget, real WOFF2 magic;
//   - the @font-face is self-hosted relative (zero external origins) with swap
//     + the full 100-900 weight range;
//   - both tokens (--font-display / --font-num) are defined Doto-first;
//   - the h1 consumes --font-display with 'ROND' 100 and its .quiet subline
//     stays serif (the pairing visible in the headline);
//   - EVERY live measured-number surface consumes --font-num at weight 700 with
//     'ROND' 100 (the post-grep LIVE list; dead surfaces are skipped, disclosed);
//   - labels/units stay mono (negative pin);
//   - no remote font URL anywhere in site/js, style.css, index.html;
//   - the preload line appears exactly once;
//   - the OFL attribution names the Doto Project Authors.
// NOTE: the goal text wrote "%WOF2" for the magic bytes — the real WOFF2
// signature is ASCII "wOF2" (0x77 0x4F 0x46 0x32); this file pins the real one.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const FONT_PATH = path.join(ROOT, 'site', 'fonts', 'doto-var.woff2');
const CSS_PATH = path.join(ROOT, 'site', 'css', 'style.css');
const HTML_PATH = path.join(ROOT, 'site', 'index.html');
const OFL_PATH = path.join(ROOT, 'site', 'fonts', 'OFL.txt');
const JS_DIR = path.join(ROOT, 'site', 'js');
const FONT_BUDGET_BYTES = 102400;

// The post-grep LIVE numeric surfaces (WS5-DOTO step 1): each was grepped in
// site/index.html / site/js before this list was frozen. .stat-value is DEAD
// (markup exists only inside an HTML comment; no renderer emits it) — skipped,
// disclosed. No #fleet-* numeric id carries its own typography rule
// (#fleet-books is a grid container, #fleet-coverage a prose seam cell).
const LIVE_NUM_SURFACES = ['.hero-stat-num', '.fleet-apr', '.ledger-v'];
// Labels/units that must STAY mono (the pairing rule's receding register).
const MONO_LABEL_SURFACES = ['.ledger-k', '.fleet-apr-mark', '.hero-stat-label', '.hero-stat-window'];

function readCss() {
  return fs.readFileSync(CSS_PATH, 'utf8');
}

// Comment-stripped CSS: braces inside comments must not confuse the parser.
function strippedCss() {
  return readCss().replace(/\/\*[\s\S]*?\*\//g, '');
}

// Flat-walk every rule at any nesting depth (top-level + inside @media).
function parseRules(cssText) {
  const rules = [];
  (function walk(text) {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) break;
      const selector = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (selector.startsWith('@') && body.includes('{')) {
        walk(body);
      } else if (selector && !selector.startsWith('@')) {
        rules.push({ selector: selector.replace(/\s+/g, ' '), body });
      }
      i = j;
    }
  })(cssText);
  return rules;
}

function rulesMatching(rules, selectorSuffix) {
  return rules.filter((r) => r.selector.split(',').some((s) => s.trim().endsWith(selectorSuffix)));
}

function dotoFontFaceBody(css) {
  const m = css.match(/@font-face\s*\{[^}]*font-family:\s*"Doto"[^}]*\}/);
  return m ? m[0] : null;
}

test('doto subset face: exists, within budget, real WOFF2 magic bytes', () => {
  assert.ok(fs.existsSync(FONT_PATH), 'site/fonts/doto-var.woff2 must exist');
  const size = fs.statSync(FONT_PATH).size;
  assert.ok(size <= FONT_BUDGET_BYTES, `subset font ${size}B exceeds the ${FONT_BUDGET_BYTES}B budget`);
  const buf = fs.readFileSync(FONT_PATH);
  assert.strictEqual(buf.slice(0, 4).toString('ascii'), 'wOF2', 'file must start with the WOFF2 signature');
});

test('@font-face Doto: relative self-hosted path, font-display swap, weight range 100 900, no remote URL', () => {
  const body = dotoFontFaceBody(readCss());
  assert.ok(body, 'a @font-face block for "Doto" must exist in style.css');
  assert.ok(body.includes("url('../fonts/doto-var.woff2')"), 'face must reference the relative fonts path');
  assert.ok(body.includes('font-display: swap'), 'face must use font-display: swap');
  assert.ok(body.includes('font-weight: 100 900'), 'face must declare the full 100-900 weight range');
  assert.ok(!/url\(\s*['"]?https?:\/\//.test(body), 'face must not point at any remote origin');
});

test('both Doto tokens are defined Doto-first in :root', () => {
  const css = strippedCss();
  assert.match(css, /--font-display:\s*"Doto"/, '--font-display must lead with "Doto"');
  assert.match(css, /--font-num:\s*"Doto"/, '--font-num must lead with "Doto"');
});

test('.hero h1 consumes --font-display with ROND 100; the .quiet subline stays serif', () => {
  const rules = parseRules(strippedCss());
  const h1 = rulesMatching(rules, '.hero h1');
  assert.ok(h1.length >= 1, 'a .hero h1 rule must exist');
  assert.ok(
    h1.some((r) => r.body.includes('var(--font-display)') && r.body.includes("'ROND' 100")),
    '.hero h1 must carry var(--font-display) + \'ROND\' 100'
  );
  const quiet = rulesMatching(rules, '.hero h1 .quiet');
  assert.ok(quiet.length >= 1, 'a .hero h1 .quiet rule must exist');
  assert.ok(quiet.some((r) => r.body.includes('var(--serif)')), 'the quiet subline must stay on var(--serif)');
});

for (const surface of LIVE_NUM_SURFACES) {
  test(`measured-number surface ${surface} consumes --font-num at weight 700 with ROND 100`, () => {
    const rules = parseRules(strippedCss());
    const matching = rulesMatching(rules, surface);
    assert.ok(matching.length >= 1, `a ${surface} rule must exist in style.css`);
    assert.ok(
      matching.some(
        (r) =>
          r.body.includes('var(--font-num)') &&
          r.body.includes('font-weight: 700') &&
          r.body.includes("'ROND' 100")
      ),
      `${surface} must carry var(--font-num) + font-weight: 700 + 'ROND' 100`
    );
  });
}

for (const surface of MONO_LABEL_SURFACES) {
  test(`label/units surface ${surface} stays mono (never joins the Doto number register)`, () => {
    const rules = parseRules(strippedCss());
    const matching = rulesMatching(rules, surface);
    assert.ok(matching.length >= 1, `a ${surface} rule must exist in style.css`);
    assert.ok(
      matching.every((r) => !r.body.includes('var(--font-num)')),
      `${surface} must not consume var(--font-num)`
    );
    assert.ok(
      matching.some((r) => r.body.includes('var(--mono)')),
      `${surface} must carry var(--mono)`
    );
  });
}

test('zero remote font URLs across site/js, style.css and index.html', () => {
  const remoteFont = /https?:\/\/[^"'\s)]*\.(woff2?|ttf|otf)/;
  const offenders = [];
  const css = readCss();
  if (remoteFont.test(css)) offenders.push('site/css/style.css');
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  if (remoteFont.test(html)) offenders.push('site/index.html');
  for (const entry of fs.readdirSync(JS_DIR)) {
    if (!entry.endsWith('.js')) continue;
    const text = fs.readFileSync(path.join(JS_DIR, entry), 'utf8');
    if (remoteFont.test(text)) offenders.push(`site/js/${entry}`);
  }
  assert.deepStrictEqual(offenders, [], 'no surface may reference a remote font URL');
});

test('the doto preload link appears exactly once in index.html', () => {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const needle = '<link rel="preload" href="fonts/doto-var.woff2" as="font" type="font/woff2" crossorigin>';
  const count = html.split(needle).length - 1;
  assert.strictEqual(count, 1, 'exactly one preload line for the subset face');
});

test('OFL attribution names the Doto Project Authors alongside the license', () => {
  const ofl = fs.readFileSync(OFL_PATH, 'utf8');
  assert.ok(ofl.includes('Doto Project Authors (https://github.com/googlefonts/doto)'), 'Doto copyright line must be present');
  assert.ok(/SIL OPEN FONT LICENSE/i.test(ofl), 'the OFL-1.1 license text must ship with the font');
});
