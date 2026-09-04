'use strict';
// RESOURCE-ALLOWLIST GATE (WSV-REBASELINE-GATE-TEETH, 2026-09-02) — static gate #2.
// The D8 SERVERLESS-CLEAN gate in render.test.js only sees runtime fetch() calls made
// while the page boots under the mock — it is blind to every URL the shipped HTML/CSS
// would otherwise make a browser load (link href, script/video/img src, srcset
// candidates, poster, og:image/twitter:image/og:url meta content, @font-face url()).
// This gate parses those STRAIGHT OFF DISK and checks each host against a pinned
// allowlist. Dependency-free node:test, __dirname-relative fs reads (render.test.js
// convention). Contract: docs/internal/VISUAL_IMPROVEMENTS_v11.md → RE-PIN ADDENDUM
// (2026-09-02); design-ref citations point at the VIBE repo's
// docs/inventory/DESIGN_REFERENCE_VIDEO_LANDING_2026-09-02.md (read-only, outside repo).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const SITE_DIR = path.join(__dirname, '..', 'site');

// ---------------- HOST_ALLOWLIST — exactly 1 host, PRE-SEEDED (LOCKED ANSWER Q1) ----
// Every entry cites WHY it exists. Adding a host = an explicit, documented decision
// (the entry AND the reason land in the RE-PIN ADDENDUM in the same commit).
const HOST_ALLOWLIST = [
  // og:url / og:image / twitter:image — site/index.html :10/:12/:16 at 5c7d791
  // (og:image absolute-URL precedent: crawler-consumed, not page-loaded — V7)
  'wellstreet.tech',
];

// Rider exception list. LOCKED ANSWER Q2 registers the one missing id (wallet-picker)
// via the render.test.js registry add, so this rider ships EXCEPTION-FREE. Any future
// entry needs a documented reason here AND in the RE-PIN ADDENDUM.
const PINNED_EXCEPTIONS = [
  // LAUNCH-FACT-RECONCILE (2026-09-04): #vaults-launch-fact is written by main.js's
  // NULL-GUARDED launch-fact writer. The LOCKED design keeps the id OUT of every stub
  // REGISTRY (render/render-degrade/wow) so the null-guard path stays the compliant
  // one — a registered stub node would mask the guard the wow battery must exercise.
  // Reason mirrored in VISUAL_IMPROVEMENTS_v11.md → RE-PIN ADDENDUM.
  'vaults-launch-fact',
];

// Files consuming a SHARED guard helper carry no guard literal of their own (the
// helper's file carries the literal) — list such CONSUMER files here to avoid false
// reds. None today: zero helper consumers exist at 5c7d791.
const APPROVED_GUARDS = [];

// ---------------- fs globs (any file a re-skin adds to these globs is in scope) -------
function listMatches(dir, re) {
  if (!fs.existsSync(dir)) { return []; }
  return fs.readdirSync(dir)
    .filter(function (f) { return re.test(f); })
    .map(function (f) { return path.join(dir, f); })
    .sort();
}
function htmlFiles() { return listMatches(SITE_DIR, /\.html$/); }
function cssFiles() { return listMatches(path.join(SITE_DIR, 'css'), /\.css$/); }
function jsFiles() { return listMatches(path.join(SITE_DIR, 'js'), /\.js$/); }

// ---------------- URL classification (SCANNER RULES — pinned by the goals doc) --------
// Relative URL (no scheme, no leading //)  -> PASS
// data:                                    -> PASS (media/font payloads only; none in site/ today)
// http/https, host on HOST_ALLOWLIST       -> PASS
// http/https, host NOT on allowlist        -> OFFENDER
// protocol-relative (//host/…)             -> OFFENDER-BY-DESIGN
// any other scheme (mailto:, tel:, …)      -> OFFENDER-BY-DESIGN (adding one requires
//                                             an explicit allowlist decision)
function classify(rawUrl) {
  const u = String(rawUrl == null ? '' : rawUrl).trim();
  if (u === '') { return { verdict: 'pass', kind: 'empty' }; }
  if (/^data:/i.test(u)) { return { verdict: 'pass', kind: 'data' }; }
  if (u.indexOf('//') === 0) { return { verdict: 'offender', kind: 'protocol-relative', url: u }; }
  const schemeM = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(u);
  if (!schemeM) { return { verdict: 'pass', kind: 'relative', url: u }; }
  const scheme = schemeM[1].toLowerCase();
  if (scheme !== 'http' && scheme !== 'https') {
    return { verdict: 'offender', kind: 'scheme:' + scheme, url: u };
  }
  const hostM = /^\/\/([^/?#]+)/.exec(u.slice(schemeM[0].length));
  const host = hostM ? hostM[1].toLowerCase() : '';
  if (HOST_ALLOWLIST.indexOf(host) !== -1) {
    return { verdict: 'pass', kind: 'http', host: host, url: u };
  }
  return { verdict: 'offender', kind: 'http', host: host, url: u };
}

// CSS url() — strip ONE optional pair of single/double quotes before host parsing
// (style.css uses single quotes: url('../fonts/*.woff2') at :34/:41 at 5c7d791).
function scanCssUrls(cssText, source) {
  const found = [];
  const re = /url\(\s*([^)]*?)\s*\)/gi;
  let m;
  while ((m = re.exec(String(cssText))) !== null) {
    let raw = m[1];
    const q = /^(['"])([\s\S]*)\1$/.exec(raw.trim());
    if (q) { raw = q[2]; }
    found.push(Object.assign(classify(raw), { source: source, channel: 'css url()' }));
  }
  return found;
}

// HTML resources: href=, srcset=, src=, poster= attributes + meta og:image/twitter:image/
// og:url content= + url() inside inline <style> blocks. xmlns / xmlns:* are DELIBERATELY
// outside this set — SVG namespace identifiers are not fetches (index.html:68).
function scanHtmlResources(html, source) {
  const found = [];
  // NOTE: srcset precedes src in the alternation so the attribute name is not truncated.
  const attrRe = /\b(href|srcset|src|poster)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+))/gi;
  let m;
  while ((m = attrRe.exec(html)) !== null) {
    const attr = m[1].toLowerCase();
    const val = m[2] !== undefined ? m[2] : (m[3] !== undefined ? m[3] : m[4]);
    if (attr === 'srcset') {
      // evaluate EACH candidate URL; drop descriptors (" 1x" / " 2x")
      String(val).split(',').forEach(function (cand) {
        const url = cand.trim().split(/\s+/)[0];
        if (url) { found.push(Object.assign(classify(url), { source: source, channel: 'srcset' })); }
      });
    } else {
      found.push(Object.assign(classify(val), { source: source, channel: attr }));
    }
  }
  const metaRe = /<meta\b[^>]*>/gi;
  while ((m = metaRe.exec(html)) !== null) {
    const tag = m[0];
    const keyM = /\b(?:property|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const cM = /\bcontent\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    if (!keyM || !cM) { continue; }
    const key = (keyM[1] !== undefined ? keyM[1] : keyM[2]).toLowerCase();
    if (key === 'og:image' || key === 'twitter:image' || key === 'og:url') {
      found.push(Object.assign(
        classify(keyM[1] !== undefined ? cM[1] : cM[2]),
        { source: source, channel: 'meta:' + key }));
    }
  }
  const styleRe = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  while ((m = styleRe.exec(html)) !== null) {
    scanCssUrls(m[1], source + ' <inline style>').forEach(function (x) { found.push(x); });
  }
  return found;
}

function scanSite() {
  const found = [];
  htmlFiles().forEach(function (f) {
    scanHtmlResources(fs.readFileSync(f, 'utf8'), path.relative(SITE_DIR, f))
      .forEach(function (x) { found.push(x); });
  });
  cssFiles().forEach(function (f) {
    scanCssUrls(fs.readFileSync(f, 'utf8'), path.relative(SITE_DIR, f))
      .forEach(function (x) { found.push(x); });
  });
  return found;
}

// ---------------- tests ----------------------------------------------------------------

test('real page scan: zero offenders across every site/*.html + site/css/*.css file', () => {
  const found = scanSite();
  assert.ok(found.length > 0, 'scanner extracted at least one resource URL from the site tree');
  const offenders = found.filter(function (x) { return x.verdict === 'offender'; });
  const summary = offenders.map(function (x) {
    return x.source + ' [' + x.channel + '] ' + x.url + ' (' + x.kind + ')';
  });
  assert.deepStrictEqual(summary, [],
    'non-allowlisted external resource(s) found: ' + summary.join(' | '));

  // shape (goals-doc (c)): the 3 wellstreet.tech absolute URLs (og:url/og:image/
  // twitter:image) are the allowlisted absolute set today. Re-pin this count in the
  // same commit if a re-skin goal legitimately adds another absolute self-host URL.
  const wt = found.filter(function (x) {
    return x.verdict === 'pass' && x.kind === 'http' && x.host === 'wellstreet.tech';
  });
  assert.strictEqual(wt.length, 3,
    'expected exactly 3 wellstreet.tech absolute URLs, got ' + wt.length);

  // svg xmlns namespace identifiers are SKIPPED, never scanned as resources
  assert.ok(found.every(function (x) { return String(x.url).indexOf('w3.org') === -1; }),
    'xmlns namespace identifiers must not be scanned as resources');

  // stylesheet url() payloads are relative (self-hosted fonts) today
  const cssUrls = found.filter(function (x) {
    return x.channel === 'css url()' && x.source.indexOf('style.css') !== -1;
  });
  assert.ok(cssUrls.length >= 2, 'font url() entries scanned from the stylesheet');
  assert.ok(cssUrls.every(function (x) { return x.verdict === 'pass' && x.kind === 'relative'; }),
    'stylesheet url() payloads are relative');
});

test('TEETH: deliberate HTML offenders fail the gate (synthetic fixtures only, never a site/ edit)', () => {
  const htmlOffender = scanHtmlResources('<video controls src="https://evil.example.com/x.mp4"></video>', 'fixture');
  assert.strictEqual(htmlOffender.length, 1, 'src= is scanned');
  assert.strictEqual(htmlOffender[0].verdict, 'offender');
  assert.strictEqual(htmlOffender[0].host, 'evil.example.com');

  const srcsetOff = scanHtmlResources(
    '<img srcset="https://evil.example.com/a.png 1x, https://evil.example.com/b.png 2x" alt="">', 'fixture');
  assert.deepStrictEqual(srcsetOff.map(function (x) { return x.verdict; }),
    ['offender', 'offender'], 'EACH srcset candidate is evaluated, descriptors dropped');
  assert.ok(srcsetOff.every(function (x) { return x.host === 'evil.example.com'; }));

  const mailTel = scanHtmlResources(
    '<a href="mailto:someone@example.com">m</a><a href="tel:+15550000">t</a>', 'fixture');
  assert.deepStrictEqual(mailTel.map(function (x) { return x.verdict; }),
    ['offender', 'offender'], 'mailto:/tel: are offender-by-design (explicit allowlist decision required)');

  const protoRel = scanHtmlResources('<script src="//cdn.evil.example.net/x.js"></script>', 'fixture');
  assert.strictEqual(protoRel[0].verdict, 'offender', 'protocol-relative URLs are offender-by-design');
});

test('TEETH: CSS url() offenders (bare + quoted) fail; data:/relative PASS forms stay green', () => {
  const bare = scanCssUrls('@font-face { src: url(https://cdn.sketchy.io/f.woff2) format("woff2"); }', 'fixture');
  assert.strictEqual(bare.length, 1);
  assert.strictEqual(bare[0].verdict, 'offender', 'bare url() offender caught');
  assert.strictEqual(bare[0].host, 'cdn.sketchy.io');

  const quoted = scanCssUrls("@font-face { src: url('https://cdn.sketchy.io/f.woff2') format('woff2'); }", 'fixture');
  assert.strictEqual(quoted.length, 1);
  assert.strictEqual(quoted[0].verdict, 'offender', 'single-quoted url() is quote-stripped then classified');

  const passForms = scanCssUrls(
    "@font-face { src: url('../fonts/x.woff2'), url(\"data:font/woff2;base64,dGVzdA==\") format('woff2'); }", 'fixture');
  assert.deepStrictEqual(passForms.map(function (x) { return [x.verdict, x.kind]; }),
    [['pass', 'relative'], ['pass', 'data']],
    'relative PASS + data: PASS (media/font payloads, documented)');

  const relHtml = scanHtmlResources(
    '<link rel="stylesheet" href="css/style.css"><script src="js/main.js"></script><a href="index.html">h</a>', 'fixture');
  assert.ok(relHtml.every(function (x) { return x.verdict === 'pass' && x.kind === 'relative'; }),
    'relative HTML resources PASS');
});

test('REGISTRY RIDER: every DOM id queried by site/js/*.js is pre-registered in render.test.js', () => {
  // QUERY SURFACES — scan EVERY site/js/*.js (all-files scope, NOT main.js only) across
  // three forms, UNION the results. Char class [A-Za-z0-9_-] so an id the narrow
  // [a-z0-9-] class would silently drop fails the subset check loudly instead.
  const queryRes = [
    /\$\('([A-Za-z0-9_-]+)'\)/g,                       // $ IS document.getElementById (main.js:15)
    /getElementById\('([A-Za-z0-9_-]+)'\)/g,           // geo.js queries via raw getElementById
    /querySelector(?:All)?\('#([A-Za-z0-9_-]+)'/g
  ];
  const queried = [];
  jsFiles().forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    queryRes.forEach(function (re) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        if (queried.indexOf(m[1]) === -1) { queried.push(m[1]); }
      }
    });
  });
  assert.ok(queried.length > 0, 'query surfaces found in site/js/*.js');

  // REGISTRY EXTRACTION — parse the registry from the FULL render.test.js text
  // (NEVER a line range: the block grows downward as re-skin goals register ids).
  const renderSrc = fs.readFileSync(path.join(__dirname, 'render.test.js'), 'utf8');
  const markerAt = renderSrc.indexOf('// pre-register the static ids');
  assert.ok(markerAt !== -1, 'registry marker comment present in render.test.js');
  const regM = /\[([^\][]*?)\]\.forEach\(function \(id\)/s.exec(renderSrc);
  assert.ok(regM && regM.index > markerAt,
    'registry array literal found AFTER the marker comment');
  // single-quoted id literals -> JSON-parseable (ids carry [A-Za-z0-9_-] only)
  const registryIds = JSON.parse('[' + regM[1].replace(/'([^']*)'/g, '"$1"') + ']');
  assert.strictEqual(new Set(registryIds).size, registryIds.length, 'registry entries are unique');
  assert.ok(registryIds.indexOf('wallet-picker') !== -1,
    'the queried wallet-picker id is registered (FIX-10: registry holds 32 ids post-add)');

  const missing = queried.filter(function (id) {
    return registryIds.indexOf(id) === -1 && PINNED_EXCEPTIONS.indexOf(id) === -1;
  });
  assert.deepStrictEqual(missing, [],
    'ids queried by site/js but absent from registry and PINNED_EXCEPTIONS: ' + missing.join(', '));
});

test('STUB RIDER: files using IntersectionObserver/matchMedia carry an accepted guard (the render.test.js stub provides neither)', () => {
  const IO_GUARDS = [
    /'IntersectionObserver'\s+in\s+window/,                    // main.js:674 precedent
    /window\.IntersectionObserver/,
    /typeof\s+IntersectionObserver\s*!==\s*'undefined'/
  ];
  const MM_GUARDS = [
    /'matchMedia'\s+in\s+window/,
    /typeof\s+window\.matchMedia\s*===\s*'function'/,
    /window\.matchMedia\s*(?:&&|\?)/,                          // truthiness check
    /if\s*\(\s*window\.matchMedia\s*\)/                        // truthiness check
  ];
  const files = jsFiles();
  assert.ok(files.length > 0, 'site/js/*.js glob is non-empty');
  let ioUsers = 0;
  files.forEach(function (f) {
    const src = fs.readFileSync(f, 'utf8');
    const name = path.basename(f);
    if (/new IntersectionObserver\(/.test(src)) {
      ioUsers++;
      const guarded = IO_GUARDS.some(function (re) { return re.test(src); }) ||
        APPROVED_GUARDS.indexOf(name) !== -1;
      assert.ok(guarded, name + ' uses IntersectionObserver without an accepted guard form');
    }
    if (/matchMedia\(/.test(src)) {
      const guarded = MM_GUARDS.some(function (re) { return re.test(src); }) ||
        APPROVED_GUARDS.indexOf(name) !== -1;
      assert.ok(guarded, name + ' uses matchMedia without an accepted guard form');
    }
  });
  // live state at 5c7d791: main.js is the only IO user (guard at :674); zero matchMedia
  // uses exist — that clause is vacuous until the re-skin adds one, i.e. it first fires
  // on exactly the files whose guard style it has not seen.
  assert.ok(ioUsers >= 1, 'at least one IntersectionObserver user was scanned');
});
