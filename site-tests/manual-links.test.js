'use strict';
// MANUAL-LINKS (G2 MANUAL-INDEX-LIVE, 2026-10-05) — the battery behind /manual,
// the one-place index. It pins:
//   - ROT GATE: every link the page ships resolves to a file the repository
//     actually contains. A chapter row may only be added when its target is
//     live, in the same change as the row and its HREF_MAP mapping — the
//     burn-tape row landed that way (G5, 2026-10-06). The shipped href set
//     must equal the declared set exactly: no orphan links, no undeclared
//     targets, no dead rows.
//   - TRANSPORT: all targets are same-origin RELATIVE paths (no scheme, no
//     leading slash, no protocol-relative) — the mirror/IPFS convention every
//     site page follows; the only absolute host allowed anywhere on the page
//     is wellstreet.tech.
//   - VOICE: 'the manual' and 'one place' present; the kill list ('one stop
//     shop', guaranteed, risk-free, passive income, auto yield) absent; zero
//     rate figures (no percent sign survives in page text); zero VIBE strings;
//     zero hook-project alias words — the name-null convention extends to page
//     copy.
//   - SCANNER HYGIENE: HTML comments carry no guarded patterns (the
//     2026-09-21 class — site scanners read comments as code).
//   - IDENTITY: the Doto-dark contract — self-hosted relative Doto face,
//     display register on the headline and chapter titles, the substrate
//     tokens, all CSS inline, zero script tags, zero loaded resources.
//   - THE LANDING SEAM: the footer manual chip ships exactly once (the chip
//     row additionally carries the fee-receipts chip, footer-only).
//     THEME-NAV (2026-10-06, supersedes the five-anchors note): the top nav
//     now carries seven anchors — the two launch-week pages joined as plain
//     section links — and the seam test rot-gates all three page targets on
//     disk.
//   - THE RIDERS: the README pointer block and the config.js socials label.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const MANUAL_PATH = path.join(ROOT, 'site', 'manual', 'index.html');
const INDEX_PATH = path.join(ROOT, 'site', 'index.html');
const README_PATH = path.join(ROOT, 'README.md');
const CONFIG_PATH = path.join(ROOT, 'site', 'js', 'config.js');

// href as shipped on the manual page -> the repository file that must exist.
// Pure-fragment anchors (same-page) and data payloads are exempt; every other
// href must be declared here. Adding a chapter = adding its mapping in the
// same commit as the row — the rot gate is the enforcement.
const HREF_MAP = {
  '../index.html': 'site/index.html',
  '../index.html#fleet': 'site/index.html',
  '../fonts/doto-var.woff2': 'site/fonts/doto-var.woff2',
  '../data/fleet.json': 'site/data/fleet.json',
  '../skills/wellstreet-vaults.md': 'site/skills/wellstreet-vaults.md',
  '../skills/wellstreet-vaults/SKILL.md': 'site/skills/wellstreet-vaults/SKILL.md',
  '../skills/registry.json': 'site/skills/registry.json',
  '../data/hooks_register.json': 'site/data/hooks_register.json',
  '../data/hooks_by_pool.json': 'site/data/hooks_by_pool.json',
  '../hooks/index.html': 'site/hooks/index.html',
  '../burn-tape/index.html': 'site/burn-tape/index.html',
  '../data/burn_tape.json': 'site/data/burn_tape.json',
  '../label-lie/index.html': 'site/label-lie/index.html',
  '../data/label_lie.json': 'site/data/label_lie.json',
  '../docs/public/whitepaper.md': 'docs/public/whitepaper.md',
  '../whitepaper.pdf': 'site/whitepaper.pdf',
};

const raw = fs.readFileSync(MANUAL_PATH, 'utf8');

function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}
function extractHrefs(html) {
  const out = [];
  const re = /\bhref\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) { out.push(m[1]); }
  return out;
}
function navigableHrefs(html) {
  return extractHrefs(html).filter(function (h) {
    return !h.startsWith('data:') && !h.startsWith('#');
  });
}
function extractCommentText(html) {
  const out = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m;
  while ((m = re.exec(html)) !== null) { out.push(m[1]); }
  return out.join('\n');
}
function pageText(html) {
  return stripComments(html)
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

test('manual: the page ships and parses as a fully static HTML document', () => {
  assert.ok(fs.existsSync(MANUAL_PATH), 'site/manual/index.html exists');
  assert.match(raw, /^<!doctype html>/i, 'doctype comes first');
  assert.ok(/<meta\s+charset="utf-8"/i.test(raw), 'charset meta present');
  assert.ok(/name="viewport"/i.test(raw), 'viewport meta present');
  assert.match(raw, /<title>[^<]*manual[^<]*<\/title>/i, 'the title names the manual');
  assert.strictEqual((raw.match(/<script[\s>]/gi) || []).length, 0, 'zero script tags — fully static');
});

test('manual: every shipped link target exists in the repository (rot gate)', () => {
  const hrefs = navigableHrefs(stripComments(raw));
  assert.ok(hrefs.length > 0, 'the index ships links');
  for (const h of hrefs) {
    assert.ok(Object.prototype.hasOwnProperty.call(HREF_MAP, h),
      'undeclared link target — add it to HREF_MAP in the same commit: ' + h);
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(h), 'no scheme on any link: ' + h);
    assert.ok(!h.startsWith('/'), 'no leading slash (mirror-safe relative form): ' + h);
    assert.ok(!h.startsWith('//'), 'no protocol-relative link: ' + h);
    const repoPath = path.join(ROOT, HREF_MAP[h]);
    assert.ok(fs.existsSync(repoPath),
      'link target missing on disk: ' + h + ' -> ' + HREF_MAP[h]);
  }
});

test('manual: the shipped href set equals the declared chapter set exactly', () => {
  const shipped = new Set(navigableHrefs(stripComments(raw)));
  const declared = new Set(Object.keys(HREF_MAP));
  for (const d of declared) {
    assert.ok(shipped.has(d), 'declared target never linked on the page: ' + d);
  }
  assert.strictEqual(shipped.size, declared.size,
    'shipped href set must equal the declared set — no orphan links');
});

test('manual: the eight canonical chapters ship', () => {
  const upper = raw.toUpperCase();
  for (const t of ['THE FLEET FEED', 'THE SKILL', 'THE REGISTRY', 'THE HOOK CENSUS', 'THE HOOK MANUAL', 'THE BURN TAPE', 'THE LABEL LIE', 'THE WHITEPAPER']) {
    assert.ok(upper.includes(t), 'chapter missing: ' + t);
  }
});

test('manual: voice contract — required phrases ship, the kill list never does', () => {
  const text = pageText(raw);
  assert.match(text, /the manual/i, 'the page names itself: the manual');
  assert.match(text, /one place/i, 'the one-place claim ships');
  const low = text.toLowerCase();
  for (const phrase of ['one stop shop', 'guaranteed', 'risk-free', 'passive income', 'auto yield']) {
    assert.ok(!low.includes(phrase), 'kill-list phrase present: ' + phrase);
  }
});

test('manual: zero rate figures — no percent sign survives in page text', () => {
  assert.ok(!pageText(raw).includes('%'),
    'the index states no rates: any percent figure is banned');
});

test('manual: zero VIBE strings (brand separation)', () => {
  assert.doesNotMatch(raw, /vibe/i, 'a VIBE string ships on the manual page');
});

test('manual: zero hook-project alias words — the name-null convention extends to copy', () => {
  assert.doesNotMatch(raw, /\bwth\b/i, 'alias word present');
  assert.doesNotMatch(raw, /hookr/i, 'alias word present');
});

test('manual: scanner hygiene — comments carry no guarded patterns (2026-09-21 class)', () => {
  const comments = extractCommentText(raw);
  assert.ok(comments.length > 0, 'the page carries dated comments');
  assert.doesNotMatch(comments, /\bhref\s*=/i, 'a guarded pattern lives in a comment');
  assert.doesNotMatch(comments, /\bsrc\s*=/i, 'a guarded pattern lives in a comment');
  assert.doesNotMatch(comments, /\$\(/, 'a guarded pattern lives in a comment');
  assert.doesNotMatch(comments, /#\w/, 'an anchor-guard pattern lives in a comment');
});

test('manual: Doto-dark identity — self-hosted face and display register', () => {
  assert.match(raw, /@font-face[\s\S]*?font-family:\s*"Doto"/, 'the Doto face is declared');
  assert.match(raw, /url\('\.\.\/fonts\/doto-var\.woff2'\)/, 'the woff2 face ships relatively');
  assert.match(raw, /url\('\.\.\/fonts\/doto-var\.ttf'\)/, 'the ttf fallback ships relatively');
  assert.match(raw, /font-weight:\s*100\s+900/, 'the variable weight range is declared');
  assert.match(raw, /--font-display:\s*"Doto"/, 'the display register token is declared');
  assert.match(raw, /\.hero h1\s*\{[^}]*var\(--font-display\)/, 'the headline speaks Doto');
  assert.match(raw, /\.chapter h2\s*\{[^}]*var\(--font-display\)/, 'chapter titles speak Doto');
});

test('manual: the substrate tokens ship', () => {
  for (const token of ['#0A0E12', '#070B0E', '#EDE9DC', '#9A948A', '#262E36', '#E8A33D']) {
    assert.ok(raw.toLowerCase().includes(token.toLowerCase()), 'token missing: ' + token);
  }
  // THEME-NAV (2026-10-06): the root declares both poles — the page ships
  // zero scripts, so light arrives via the OS preference and the two
  // media-scoped theme-color metas carry the scopes.
  assert.match(raw, /<html[^>]*color-scheme:\s*light\s+dark/, 'dual-pole color scheme on the root');
});

test('manual: no external resource of any kind', () => {
  const srcs = [];
  const re = /\b(src|srcset|poster)\s*=\s*"([^"]*)"/gi;
  let m;
  while ((m = re.exec(raw)) !== null) { srcs.push(m[2]); }
  assert.deepStrictEqual(srcs, [], 'zero loaded resources — the page is self-contained');
  for (const h of navigableHrefs(stripComments(raw))) {
    assert.ok(!/^https?:\/\//i.test(h), 'no absolute links on the index: ' + h);
  }
  assert.doesNotMatch(raw, /url\(\s*['"]?https?:/i, 'no remote url() payload');
  assert.doesNotMatch(raw, /<link[^>]+stylesheet/i, 'all CSS ships inline');
});

test('manual: every css url() payload resolves to a shipped repo file', () => {
  const styleM = /<style[^>]*>([\s\S]*?)<\/style>/i.exec(raw);
  assert.ok(styleM, 'the page ships inline CSS');
  const re = /url\(\s*([^)]*?)\s*\)/gi;
  let m;
  let count = 0;
  while ((m = re.exec(styleM[1])) !== null) {
    count += 1;
    const u = m[1].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
    assert.ok(!/^data:/i.test(u), 'no data payload needed in CSS');
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(u), 'no remote url(): ' + u);
    assert.ok(fs.existsSync(path.join(ROOT, 'site', 'manual', u)), 'css payload missing on disk: ' + u);
  }
  assert.ok(count >= 2, 'both Doto faces are referenced');
});

test('manual: the only absolute host anywhere on the page is wellstreet.tech', () => {
  const hosts = new Set();
  const re = /https?:\/\/([^/"'\s>]+)/gi;
  let m;
  while ((m = re.exec(raw)) !== null) { hosts.add(m[1].toLowerCase()); }
  // The SVG namespace inside the favicon data payload is an identifier, never
  // a fetched host — exempted explicitly.
  hosts.delete('www.w3.org');
  for (const h of hosts) {
    assert.strictEqual(h, 'wellstreet.tech', 'unexpected absolute host: ' + h);
  }
  assert.ok(hosts.has('wellstreet.tech'), 'the canonical host is named');
});

test('landing seam: the nav carries seven anchors; the manual and fee-receipts chips ship once each', () => {
  const indexHtml = fs.readFileSync(INDEX_PATH, 'utf8');
  // THEME-NAV (2026-10-06): two hits — the top-nav anchor plus the footer chip.
  const manualHits = (indexHtml.match(/href="manual\//g) || []).length;
  assert.strictEqual(manualHits, 2, 'the nav anchor plus the footer chip — exactly two relative paths into /manual');
  assert.ok(indexHtml.includes('wellstreet.tech/manual'), 'the chip names the canonical URL');
  for (const p of ['site/manual/index.html', 'site/burn-tape/index.html', 'site/label-lie/index.html']) {
    assert.ok(fs.existsSync(path.join(ROOT, p)), 'nav/footer target missing on disk: ' + p);
  }
  const burnHits = (indexHtml.match(/href="burn-tape\//g) || []).length;
  assert.strictEqual(burnHits, 1, 'exactly one relative path into /burn-tape (the nav anchor)');
  const labelHits = (indexHtml.match(/href="label-lie\//g) || []).length;
  assert.strictEqual(labelHits, 1, 'exactly one relative path into /label-lie (the footer chip)');
  const navM = /<nav class="site-nav"[\s\S]*?<\/nav>/.exec(indexHtml);
  assert.ok(navM, 'the top nav block exists');
  const navAnchors = (navM[0].match(/<a\s/g) || []).length;
  assert.strictEqual(navAnchors, 7, 'the nav carries seven anchors — the five sections plus the two launch-week pages');
});

test('riders: the README carries the manual pointer block', () => {
  const readme = fs.readFileSync(README_PATH, 'utf8');
  assert.ok(readme.includes('wellstreet.tech/manual'), 'the canonical URL is named');
  assert.ok(readme.includes('site/manual/index.html'), 'the source page is named');
});

test('riders: config.js carries the manual socials label (label of record only)', () => {
  const config = require(CONFIG_PATH);
  const s = config.branding && config.branding.socials;
  assert.ok(s && typeof s === 'object', 'branding.socials exists');
  assert.strictEqual(s.manual, 'https://wellstreet.tech/manual',
    'the socials label pins the canonical manual URL');
});
