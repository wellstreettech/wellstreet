'use strict';
// LABEL-LIE (G4, 2026-10-06) — the battery behind wellstreet.tech/label-lie,
// the fee-label receipt page. It pins:
//   - THE DATA: site/data/label_lie.json carries exactly the fixture's
//     PAYS-LPS books (276), one row each, and every row's divergence flag
//     is recomputed here straight from the frozen fixture — label (initFee,
//     the Initialize-log declaration) vs measured (feeWavg, the
//     swap-count-weighted mean of charged fees). The class rule never reads
//     the label, so the divergence is a measurement, not a definition.
//   - THE COUNTS: books 276, divergent 257, agree 19, over-half 73 — the
//     numbers the shipped headline states. The headline is the adjudicated
//     one ("276 books pay LPs. 257 charge a fee that disagrees with their
//     label."); neither gated verbatim candidate ships anywhere, because
//     the 19 exact agreements falsify both.
//   - THE F2 RECEIPT: the dated hand-check receipt exists in the VIBE-side
//     research doc, carries the literal phrase "F2 hand-check" and all
//     three hand-checked pool ids.
//   - THE ALIAS POLICY: the data file's raw bytes never carry the literal
//     "name" — pool ids only, no pool names, no token symbols.
//   - THE PAGE: Doto-dark identity; one inline script, no external script;
//     one fetch, the data file only; relative links; absolute hosts limited
//     to wellstreet.tech; the voice kill list; the never-annualized line.
//   - THE TOOL IS LOCAL-ONLY: docs/ops/build_label_lie.py is an operator
//     tool — no site page or site script ever references it.
//   - SCANNER HYGIENE: comments carry no guarded patterns (2026-09-21 class).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'site', 'label-lie', 'index.html');
const DATA_PATH = path.join(ROOT, 'site', 'data', 'label_lie.json');
const BUILDER_PATH = path.join(ROOT, 'docs', 'ops', 'build_label_lie.py');
const FIXTURE_PATH = path.join(ROOT, 'docs', 'ops', 'v4_fee_screen.json');
const MANUAL_PATH = path.join(ROOT, 'site', 'manual', 'index.html');
const F2_RECEIPT_PATH = '/home/raivo/Documents/VIBE_trader_V2/docs/research/RH_HOOK_MINING_SWEEP_2026-10-04.md';

const PINNED_FIXTURE_MD5 = '92c54bd870d72fb4dc1d9a6b586ef650';
const PINNED_HEAD_BLOCK = 56263800;
const PINNED_BOOKS = 276;
const PINNED_DIVERGENT = 257;
const PINNED_AGREE = 19;
const PINNED_OVER_HALF = 73;
const HEADLINE_BOOKS = '276 books pay LPs';
const HEADLINE_DIVERGENT = '257 charge a fee that disagrees with their label';

const raw = fs.readFileSync(PAGE_PATH, 'utf8');
const dataRaw = fs.readFileSync(DATA_PATH, 'utf8');
const fixtureRaw = fs.readFileSync(FIXTURE_PATH, 'utf8');
const doc = JSON.parse(dataRaw);
const fixture = JSON.parse(fixtureRaw);

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
function extractSrcs(html) {
  const out = [];
  const re = /\bsrc\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) { out.push(m[1]); }
  return out;
}
function extractCommentText(html) {
  const out = [];
  const re = /<!--([\s\S]*?)-->/g;
  let m;
  while ((m = re.exec(html)) !== null) { out.push(m[1]); }
  return out.join('\n');
}

// ---------------------------------------------------------------- data ----

test('fixture is the pinned frozen file', function () {
  const digest = crypto.createHash('md5').update(fixtureRaw).digest('hex');
  assert.strictEqual(digest, PINNED_FIXTURE_MD5);
  assert.strictEqual(fixture.meta.head_block, PINNED_HEAD_BLOCK);
  assert.strictEqual(fixture.meta.chain_id, 4663);
});

test('rows are exactly the fixture PAYS-LPS books, sorted by pool id', function () {
  const expected = Object.keys(fixture.pools)
    .filter(function (id) { return fixture.pools[id].class === 'PAYS-LPS'; })
    .sort();
  assert.strictEqual(doc.rows.length, expected.length);
  assert.strictEqual(doc.rows.length, PINNED_BOOKS);
  const got = doc.rows.map(function (r) { return r.poolId; });
  assert.deepStrictEqual(got, expected);
  const sorted = got.slice().sort();
  assert.deepStrictEqual(got, sorted);
});

test('every row recomputes from the fixture: divergence, delta, pct, mask', function () {
  const pools = fixture.pools;
  let divergent = 0;
  let overHalf = 0;
  const ROW_KEYS = ['poolId', 'hook', 'mask', 'initFee', 'feeWavg', 'diverges', 'delta', 'pctOfMeasured'];
  for (const r of doc.rows) {
    assert.deepStrictEqual(Object.keys(r), ROW_KEYS);
    const book = pools[r.poolId];
    assert.ok(book, 'row pool id exists in the fixture');
    assert.strictEqual(r.initFee, book.init_fee);
    assert.strictEqual(r.feeWavg, book.fee_wavg);
    assert.strictEqual(typeof r.diverges, 'boolean');
    assert.strictEqual(r.diverges, r.initFee !== r.feeWavg);
    assert.strictEqual(r.delta, r.initFee - r.feeWavg);
    if (r.feeWavg > 0) {
      assert.strictEqual(r.pctOfMeasured, Math.round(Math.abs(r.delta) / r.feeWavg * 100 * 100) / 100);
    }
    const hook = book.hook ? String(book.hook).toLowerCase() : '0x0';
    assert.strictEqual(r.hook, hook);
    // low 14 bits via the last 4 hex chars: a full 40-hex address overflows
    // Number precision, and parseInt on it would zero the low bits.
    const hex = hook.replace(/^0x/, '');
    const lowHex = hex.length >= 4 ? hex.slice(-4) : hex;
    assert.strictEqual(r.mask, '0x' + (parseInt(lowHex, 16) & 0x3FFF).toString(16));
    if (r.diverges) { divergent++; }
    if (r.feeWavg > 0 && Math.abs(r.delta) > r.feeWavg / 2) { overHalf++; }
  }
  assert.strictEqual(divergent, PINNED_DIVERGENT);
  assert.strictEqual(PINNED_BOOKS - divergent, PINNED_AGREE);
  assert.strictEqual(overHalf, PINNED_OVER_HALF);
});

test('meta carries the as-of block, the fixture pointer and the counts', function () {
  assert.strictEqual(doc.meta.asOfBlock, PINNED_HEAD_BLOCK);
  assert.strictEqual(doc.meta.chainId, 4663);
  assert.strictEqual(doc.meta.fixtureMd5, PINNED_FIXTURE_MD5);
  assert.ok(/v4_fee_screen\.json/.test(doc.meta.fixture));
  assert.strictEqual(doc.meta.counts.books, PINNED_BOOKS);
  assert.strictEqual(doc.meta.counts.divergent, PINNED_DIVERGENT);
  assert.strictEqual(doc.meta.counts.agree, PINNED_AGREE);
  assert.strictEqual(doc.meta.counts.divergeOverHalf, PINNED_OVER_HALF);
  assert.ok(/classify_book/.test(doc.meta.classRule));
  assert.ok(/Initialize/.test(doc.meta.labelRule));
  assert.ok(/Swap/.test(doc.meta.measuredRule));
  assert.ok(/low 14 bits/.test(doc.meta.maskRule));
  assert.ok(/F2 hand-check/.test(doc.meta.f2HandCheck));
});

test('alias policy: the raw file bytes never carry the literal name key', function () {
  const hits = dataRaw.split('"name"').length - 1;
  assert.strictEqual(hits, 0);
  assert.ok(!/symbols|book"/.test(dataRaw.slice(0, 400)), 'no symbol or book fields at the top of the file');
});

test('determinism shape: no wall-clock timestamp anywhere in the data file', function () {
  assert.ok(!/generatedAt|timestamp|"2026-10-06T/.test(dataRaw));
});

// ------------------------------------------------------------------ F2 ----

test('F2 hand-check receipt exists, is dated, and names the three samples', function () {
  const receipt = fs.readFileSync(F2_RECEIPT_PATH, 'utf8');
  const n = receipt.split('F2 hand-check').length - 1;
  assert.ok(n >= 1, 'receipt carries the literal phrase');
  const samples = [
    '0x007a13fa152f6dc383cad20a8eaab4e1e2538b606936eae2a424f8aa47d6db31',
    '0x069bf854bd2f4f454c3d93cf60e1c0af074027050d2c1da1a1ce15c548d06c09',
    '0x14f8cf472104b8823340025c004d022de12ab0e4d7e8112a6dc73c1979e044ad'
  ];
  for (const s of samples) {
    assert.ok(receipt.includes(s), 'receipt names sample ' + s.slice(0, 10));
  }
  assert.ok(receipt.includes('2026-10-06'), 'receipt is dated');
  assert.ok(receipt.includes('10990.0') && receipt.includes('8388608'), 'receipt carries raw fixture values');
});

test('the adjudicated headline ships; neither gated verbatim candidate does', function () {
  const page = stripComments(raw);
  assert.ok(page.includes(HEADLINE_BOOKS), 'books line on the page');
  assert.ok(page.includes(HEADLINE_DIVERGENT), 'divergence line on the page');
  assert.ok(!/every book we screen/i.test(page), 'fallback headline absent from the page');
  assert.ok(!/tell you one fee and charge another/i.test(page), 'verbatim candidate absent from the page');
  const manual = fs.readFileSync(MANUAL_PATH, 'utf8');
  assert.ok(!/tell you one fee and charge another/i.test(manual), 'verbatim candidate absent from the manual');
  assert.ok(!dataRaw.includes('tell you one fee and charge another'), 'verbatim candidate absent from the data file');
});

// ----------------------------------------------------------------- page ----

test('page identity: Doto face, ROND variation, substrate tokens', function () {
  const page = stripComments(raw);
  assert.ok(page.includes('@font-face'));
  assert.ok(page.includes("url('../fonts/doto-var.woff2')"));
  assert.ok(page.includes("'ROND' 100"));
  for (const tok of ['--paper: #0A0E12', '--paper-2: #070B0E', '--ink: #EDE9DC', '--ink-soft: #9A948A', '--line: #262E36', '--accent: #E8A33D', '--accent-ink: #0A0E12']) {
    assert.ok(page.includes(tok), 'token ' + tok);
  }
  assert.ok(page.includes('font-family: var(--font-display)'));
});

test('page wiring: one inline script, no external script, one fetch of the data file', function () {
  const page = stripComments(raw);
  const scripts = page.match(/<script\b[^>]*>/g) || [];
  // THEME-NAV (2026-10-06): the anti-FOUC pre-paint script joins the head —
  // still src-less, so the seam below is unchanged.
  assert.strictEqual(scripts.length, 2, 'the inline script plus the anti-FOUC head script');
  assert.ok(!/<script[^>]*\bsrc=/.test(page), 'no script src anywhere');
  const fetches = page.match(/fetch\(([^)]*)\)/g) || [];
  assert.strictEqual(fetches.length, 1);
  assert.ok(page.includes("fetch('../data/label_lie.json')"));
});

test('page links: relative only; absolute hosts limited to wellstreet.tech', function () {
  const page = stripComments(raw);
  const hrefs = extractHrefs(page).filter(function (h) { return !h.startsWith('data:') && !h.startsWith('#'); });
  assert.ok(hrefs.length >= 4, 'brand, data file, manual, home links present');
  assert.ok(hrefs.includes('../data/label_lie.json'));
  assert.ok(hrefs.includes('../manual/index.html'));
  assert.ok(hrefs.includes('../index.html'));
  for (const h of hrefs) {
    assert.ok(!h.startsWith('/') && !h.startsWith('http') && !/^[a-z]+:/i.test(h), 'relative href: ' + h);
  }
  const hosts = new Set();
  const re = /https?:\/\/([^/"'\s)]+)/g;
  let m;
  while ((m = re.exec(page)) !== null) {
    const host = m[1].replace(/^www\./, '');
    if (host === 'w3.org') { continue; } // the SVG namespace inside the data: favicon, per the manual battery's precedent
    hosts.add(host);
  }
  for (const host of hosts) {
    assert.strictEqual(host, 'wellstreet.tech', 'absolute host allowlist: ' + host);
  }
  assert.ok(hosts.has('wellstreet.tech'), 'og:url pins the canonical host');
});

test('page voice: kill list, exact-amount framing, never-annualized line', function () {
  const page = stripComments(raw).toLowerCase();
  for (const phrase of ['one stop shop', 'guaranteed', 'risk-free', 'passive income', 'auto yield', 'buyback', 'annualized apr']) {
    assert.ok(!page.includes(phrase), 'kill-list phrase absent: ' + phrase);
  }
  assert.ok(!/\bvibe\b/.test(page), 'no vibe strings');
  assert.ok(!/\bwth\b/.test(page), 'no wth');
  assert.ok(!/hookr/.test(page), 'no hookr');
  assert.ok(!/\bapr\b/.test(page), 'no apr talk');
  assert.ok(/neither is annualized|not annualized/.test(page), 'the never-annualized line ships');
  assert.ok(/not a yield/.test(page), 'fee label framed as a cut of each swap');
});

test('page scanner hygiene: comments carry no guarded patterns', function () {
  const comments = extractCommentText(raw);
  assert.ok(!/\bhref\s*=/i.test(comments), 'no href assignments in comments');
  assert.ok(!/\bsrc\s*=/i.test(comments), 'no src assignments in comments');
  assert.ok(!/\$\(/.test(comments), 'no query patterns in comments');
  assert.ok(!/#\w/.test(comments), 'no id-selector shapes in comments');
});

test('page receipts furniture: as-of block, fixture md5, hand-check chapter', function () {
  const page = stripComments(raw);
  assert.ok(page.includes('56,263,800'), 'as-of block in human form');
  assert.ok(page.includes('F2 hand-check'), 'the hand-check is named on the page');
  assert.ok(/0x007a13fa/.test(page) && /0x069bf854/.test(page) && /0x14f8cf47/.test(page), 'the three samples appear');
  assert.ok(page.includes('stale'), 'stale-file guard language present');
  assert.ok(page.includes('unavailable, never fabricated'), 'fail-closed data language present');
});

// --------------------------------------------------------------- builder ----

test('the builder is local-only, fail-closed, and pins the fixture md5', function () {
  const builder = fs.readFileSync(BUILDER_PATH, 'utf8');
  assert.ok(builder.includes('LOCAL-ONLY OPERATOR TOOL'));
  assert.ok(builder.includes(PINNED_FIXTURE_MD5));
  assert.ok(builder.includes('FIXTURE-MD5-MISMATCH'));
  assert.ok(builder.includes(String(PINNED_HEAD_BLOCK)));
  const siteTree = [];
  const walk = function (dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { walk(p); } else if (/\.(html|js|css|json)$/.test(e.name)) { siteTree.push(p); }
    }
  };
  walk(path.join(ROOT, 'site'));
  for (const f of siteTree) {
    const text = fs.readFileSync(f, 'utf8');
    assert.ok(!text.includes('build_label_lie'), 'no site file references the operator tool: ' + f);
  }
});

test('the data file lives where the page and the manual row point', function () {
  assert.ok(fs.existsSync(path.join(ROOT, 'site', 'data', 'label_lie.json')));
  const manual = fs.readFileSync(MANUAL_PATH, 'utf8');
  assert.ok(manual.includes('../data/label_lie.json'), 'manual row links the data file');
  assert.ok(manual.includes('../label-lie/index.html'), 'manual row links the page');
});

// -------------------------------------------------- THEME-NAV (2026-10-06) ----

test('theme-nav: the light pole ships — the pinned token block carries the contrast-verified set', function () {
  const page = stripComments(raw);
  const blockM = /html\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(page);
  assert.ok(blockM, 'the pinned light block exists');
  assert.ok(blockM[1].includes('#F2EFE6'), 'light paper token in the pinned block');
  assert.ok(blockM[1].includes('#26231C'), 'light ink token in the pinned block');
  assert.ok(blockM[1].includes('--accent-text: #7A4E0E'), 'the light accent-text token ships');
});

test('theme-nav: the system-follow light block ships under the media scope', function () {
  const page = stripComments(raw);
  const blockM = /@media \(prefers-color-scheme: light\)\s*\{\s*html:not\(\[data-theme\]\)\s*\{([\s\S]*?)\}/.exec(page);
  assert.ok(blockM, 'the media-scoped system-follow block exists');
  assert.ok(blockM[1].includes('#F2EFE6') && blockM[1].includes('#26231C'), 'the same light set in the media block');
  assert.match(page, /html\[data-theme="light"\] \.hero-field/, 'the hero-field light duplicate ships under the pinned scope');
});

test('theme-nav: the anti-FOUC pin read ships in the head, before the stylesheet', function () {
  const styleAt = raw.indexOf('<style');
  assert.ok(styleAt > -1, 'the stylesheet opens');
  const head = raw.slice(0, styleAt);
  assert.ok(head.indexOf("localStorage.getItem('ws-theme-v1')") > -1,
    'the pre-paint pin read reads the shared key before first paint');
  assert.ok(head.indexOf('<script') > -1, 'the pin read rides a head script');
});

test('theme-nav: the theme toggle ships once, in the header', function () {
  const page = stripComments(raw);
  assert.match(page, /<button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false">LIGHT<\/button>/,
    'the toggle button ships with type, aria state and the initial GET-mode label');
  assert.strictEqual((page.match(/id="theme-toggle"/g) || []).length, 1, 'exactly one toggle');
  assert.match(page, /\.theme-toggle\s*\{/, 'the toggle styles ship');
});

test('theme-nav: the toggle wiring ships — click and matchMedia listeners', function () {
  const page = stripComments(raw);
  assert.ok(page.includes("var KEY = 'ws-theme-v1'"), 'the wiring reads the shared storage key');
  assert.ok(page.includes('btn.addEventListener(\'click\''), 'a click listener drives the toggle');
  assert.ok(page.includes("window.matchMedia('(prefers-color-scheme: light)')"), 'the matchMedia path ships');
  assert.ok(page.includes("mq.addEventListener('change', onChange)"), 'the system-preference change listener ships');
});
