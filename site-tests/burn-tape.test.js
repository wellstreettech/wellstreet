'use strict';
// BURN-TAPE (G5 BURN-TAPE-SKELETON, 2026-10-06) — the battery behind
// wellstreet.tech/burn-tape, the receipt page for the burn lane. It pins:
//   - THE SEAM: exactly two external scripts — the shared config and rpc
//     modules every live-figure page uses — plus one inline script. All
//     figures are read LIVE from chain 4663 over the keyless RPC through
//     that seam; the keyless endpoint is never hardcoded on the page.
//   - ZERO-STATE HONESTY: launch-day zero is the honest state. Loading
//     renders "measuring"; a failed read renders "unavailable — never
//     estimated"; a confirmed zero renders as the zero it is; the tape's
//     empty state says the first burn writes the first row. No percent sign
//     survives in page text — nothing here is a rate, nothing annualized.
//   - VOICE: burn never buyback; exact amounts; no claim without a pointer;
//     zero VIBE strings; zero hook-project alias words; the ~6,268 registry
//     figure never ships (F7) — the identity section states the branch that
//     the one keyless ERC-8004 probe actually took: no identity held.
//   - ADDRESS PINS: the page's 0x-literal set equals exactly the five pins —
//     the dEaD burn address, WELL, the roamer, the vault, the canonical
//     ERC-8004 registry — each cross-pinned to its source of record
//     (config.js for the three protocol pins, the harvester source for dEaD).
//   - THE TAPE: the page fetches the committed data file; the file's schema
//     is pinned (meta block + rows of block/logIndex/tx/sourceToken/
//     amountWELL/label, exact decimal strings, sorted); zero rows is a valid,
//     honest state (the W2 rule). The page cross-checks the file's row count
//     against the live Burned events so a stale file can never pose as truth.
//   - THE TOPICS: the Burned and SweepSkipped topic0 constants are identical
//     in the page and in docs/ops/build_burn_tape.py.
//   - THE TOOL IS LOCAL-ONLY: docs/ops/build_burn_tape.py is an operator
//     tool — no site page or site script ever references it.
//   - SCANNER HYGIENE: comments carry no guarded patterns (2026-09-21 class).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PAGE_PATH = path.join(ROOT, 'site', 'burn-tape', 'index.html');
const DATA_PATH = path.join(ROOT, 'site', 'data', 'burn_tape.json');
const BUILDER_PATH = path.join(ROOT, 'docs', 'ops', 'build_burn_tape.py');
const CONFIG_PATH = path.join(ROOT, 'site', 'js', 'config.js');
const HARVESTER_PATH = path.join(ROOT, 'src', 'RoamingHarvester.sol');

const DEAD = '0x000000000000000000000000000000000000dEaD';
const WELL = '0x5d08c35BcF268f4031BF3898e42b895Ff0779a24';
const ROAMER = '0xC7a21Aa8C15C7032eE2e8352244a0f3D2154dC68';
const VAULT = '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86';
const REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const BURNED_TOPIC = '0x23ff0e75edf108e3d0392d92e13e8c8a868ef19001bd49f9e94876dc46dff87f';
const SWEEP_SKIPPED_TOPIC = '0x5cc0d130ea68954f3b0a05ff7c20becf3cf6c6f234bd1cdf36a658797e3827c5';
const HARVEST_TOPIC = '0x3fb12fb590bb295327f3bfc48158ada0b1147f8f823e0c7a09b98b301d186774';

const raw = fs.readFileSync(PAGE_PATH, 'utf8');

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
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}
function extractAddresses(text) {
  const out = [];
  const re = /0x[0-9a-fA-F]{40}(?![0-9a-fA-F])/g;
  let m;
  while ((m = re.exec(text)) !== null) { out.push(m[0]); }
  return out;
}
function sortedAddrs(list) {
  return list.map(function (a) { return a.toLowerCase(); }).sort();
}

// relative link as shipped -> the repository file that must exist
const HREF_MAP = {
  '../index.html': 'site/index.html',
  '../manual/index.html': 'site/manual/index.html',
  '../data/burn_tape.json': 'site/data/burn_tape.json',
  '../fonts/doto-var.woff2': 'site/fonts/doto-var.woff2',
};

test('burn-tape: the page ships and parses, with exactly the shared seam as scripts', () => {
  assert.ok(fs.existsSync(PAGE_PATH), 'site/burn-tape/index.html exists');
  assert.match(raw, /^<!doctype html>/i, 'doctype comes first');
  assert.ok(/<meta\s+charset="utf-8"/i.test(raw), 'charset meta present');
  assert.ok(/name="viewport"/i.test(raw), 'viewport meta present');
  assert.match(raw, /<title>[^<]*burn tape[^<]*<\/title>/i, 'the title names the burn tape');
  // THEME-NAV (2026-10-06): the anti-FOUC pre-paint script joins the head —
  // still src-less, so the extractSrcs seam below is unchanged.
  const scriptTags = (raw.match(/<script[\s>]/gi) || []).length;
  assert.strictEqual(scriptTags, 4, 'two external scripts plus the anti-FOUC head script and the main inline script');
  assert.deepStrictEqual(extractSrcs(raw), ['../js/config.js', '../js/rpc.js'],
    'the only external scripts are the shared config and rpc seam, in that order');
  assert.match(raw, /https:\/\/wellstreet\.tech\/burn-tape/, 'the canonical route is pinned');
});

test('burn-tape: transport — every link is relative and resolves to a shipped file', () => {
  const hrefs = navigableHrefs(stripComments(raw));
  for (const h of hrefs) {
    assert.ok(Object.prototype.hasOwnProperty.call(HREF_MAP, h),
      'undeclared link target — declare it in HREF_MAP: ' + h);
    assert.ok(!/^[a-z][a-z0-9+.-]*:/i.test(h), 'no scheme on any link: ' + h);
    assert.ok(!h.startsWith('/'), 'no leading slash (mirror-safe relative form): ' + h);
    assert.ok(fs.existsSync(path.join(ROOT, HREF_MAP[h])),
      'link target missing on disk: ' + h + ' -> ' + HREF_MAP[h]);
  }
  assert.deepStrictEqual(Array.from(new Set(hrefs)).sort(), Object.keys(HREF_MAP).sort(),
    'the shipped href set equals the declared set exactly — no orphan links');
});

test('burn-tape: Doto-dark identity — self-hosted face and display register', () => {
  assert.match(raw, /@font-face[\s\S]*?font-family:\s*"Doto"/, 'the Doto face is declared');
  assert.match(raw, /url\('\.\.\/fonts\/doto-var\.woff2'\)/, 'the woff2 face ships relatively');
  assert.match(raw, /url\('\.\.\/fonts\/doto-var\.ttf'\)/, 'the ttf fallback ships relatively');
  assert.match(raw, /font-weight:\s*100\s+900/, 'the variable weight range is declared');
  assert.match(raw, /--font-display:\s*"Doto"/, 'the display register token is declared');
  assert.match(raw, /\.hero h1\s*\{[^}]*var\(--font-display\)/, 'the headline speaks Doto');
  assert.match(raw, /\.chapter h2\s*\{[^}]*var\(--font-display\)/, 'chapter titles speak Doto');
  for (const token of ['#0A0E12', '#070B0E', '#EDE9DC', '#9A948A', '#262E36', '#E8A33D']) {
    assert.ok(raw.toLowerCase().includes(token.toLowerCase()), 'token missing: ' + token);
  }
  assert.match(raw, /<html[^>]*color-scheme:\s*dark/, 'dark-only color scheme on the root');
});

test('burn-tape: zero-state honesty — loading, error and empty states all ship', () => {
  const text = pageText(raw);
  for (const phrase of [
    'measuring',
    'unavailable, never estimated',
    'a zero here is the honest state',
    'no sweeps on the tape yet — the first burn writes the first row',
    'shipped before the first burn',
    'nothing here is annualized',
    'no identity held',
    'one row per sweep',
    'the exact amount, the block, the transaction',
  ]) {
    assert.ok(text.includes(phrase), 'required zero-state/honesty phrase missing: ' + phrase);
  }
  const script = stripComments(raw).replace(/[\s\S]*?<\/head>/i, ' ');
  for (const phrase of [
    'never estimated', 'never fabricated', 'never summed across tokens',
    'the live figures above are the truth',
  ]) {
    assert.ok(script.includes(phrase), 'required fail-closed phrase missing from the script: ' + phrase);
  }
  assert.ok(!pageText(raw).includes('%'),
    'the page states no rates: any percent figure is banned');
});

test('burn-tape: voice contract — burn never buyback, the kill list never ships', () => {
  const text = pageText(raw);
  assert.match(text, /\bburn/i, 'the page speaks of the burn');
  const low = text.toLowerCase();
  for (const phrase of ['buyback', 'guaranteed', 'risk-free', 'passive income', 'auto yield']) {
    assert.ok(!low.includes(phrase), 'kill-list phrase present: ' + phrase);
  }
  assert.doesNotMatch(text, /\bap[ry]\b/, 'a rate acronym ships on the page');
  assert.doesNotMatch(raw, /vibe/i, 'a VIBE string ships on the page');
  assert.doesNotMatch(raw, /\bwth\b/i, 'alias word present');
  assert.doesNotMatch(raw, /hookr/i, 'alias word present');
  assert.doesNotMatch(raw, /6,?268/, 'the unverified registry figure ships (F7) — state the branch, not a number');
});

test('burn-tape: address pins — exactly the five 0x literals, each cross-pinned', () => {
  // Set semantics: a pin may ship twice (the dEaD address lives in the prose
  // pin paragraph AND in the reader constant) — a repetition of a pinned
  // address is not a violation; any sixth DISTINCT address is.
  const addrs = Array.from(new Set(sortedAddrs(extractAddresses(raw))));
  const expected = sortedAddrs([DEAD, WELL, ROAMER, VAULT, REGISTRY]);
  assert.deepStrictEqual(addrs, expected,
    'the page carries exactly the dEaD address, WELL, the roamer, the vault and the ERC-8004 registry');
  const config = fs.readFileSync(CONFIG_PATH, 'utf8');
  for (const [label, addr] of [['WELL', WELL], ['roamer', ROAMER], ['vault', VAULT]]) {
    assert.ok(config.includes(addr), label + ' pin missing from site/js/config.js');
  }
  const harvester = fs.readFileSync(HARVESTER_PATH, 'utf8');
  assert.ok(harvester.toLowerCase().includes(DEAD.toLowerCase()),
    'the dEaD address is the contract BURN_ADDRESS in src/RoamingHarvester.sol');
});

test('burn-tape: rpc contract — keyless read through the seam, endpoint never hardcoded', () => {
  assert.match(raw, /createRpcClient/, 'the page builds its client from the shared rpc seam');
  assert.match(raw, /cfg\.rpc\.endpoints/, 'endpoints come from the shared config');
  assert.doesNotMatch(raw, /rpc\.mainnet\.chain\.robinhood\.com/,
    'the keyless endpoint is never hardcoded on the page');
  // Range discipline: the keyless RPC refuses eth_getLogs spans over 10,000,000
  // blocks (observed 2026-10-06, -32602). A bare full-range pull would fail
  // every page load — the page must scan windowed chunks instead.
  assert.doesNotMatch(raw, /fromBlock:\s*'0x0'/,
    'a full-range eth_getLogs ships on the page — the endpoint caps ranges at 10M blocks');
  assert.match(raw, /LOG_WINDOW_BLOCKS/,
    'the windowed log scan is pinned on the page');
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

test('burn-tape: scanner hygiene — comments carry no guarded patterns (2026-09-21 class)', () => {
  const comments = extractCommentText(raw);
  assert.ok(comments.length > 0, 'the page carries dated comments');
  assert.doesNotMatch(comments, /\bhref\s*=/i, 'a guarded pattern lives in a comment');
  assert.doesNotMatch(comments, /\bsrc\s*=/i, 'a guarded pattern lives in a comment');
  assert.doesNotMatch(comments, /\$\(/, 'a guarded pattern lives in a comment');
  assert.doesNotMatch(comments, /#\w/, 'an anchor-guard pattern lives in a comment');
  assert.doesNotMatch(raw, /\$\(/, 'the page never uses selector-style lookups');
});

test('burn-tape: the topic0 constants match the local-only builder exactly', () => {
  const builder = fs.readFileSync(BUILDER_PATH, 'utf8');
  assert.ok(builder.includes(BURNED_TOPIC), 'Burned topic in the page equals the builder constant');
  assert.ok(builder.includes(SWEEP_SKIPPED_TOPIC), 'SweepSkipped topic in the page equals the builder constant');
  assert.ok(raw.includes(BURNED_TOPIC), 'the page pins the Burned topic for its chain cross-check');
  assert.ok(raw.includes(SWEEP_SKIPPED_TOPIC), 'the page pins the SweepSkipped topic');
  assert.ok(raw.includes(HARVEST_TOPIC), 'the page pins the YieldHarvested topic');
  assert.match(builder, /CHUNK_BLOCKS/,
    'the builder scans windowed eth_getLogs chunks — the endpoint caps ranges at 10M blocks');
});

test('burn-tape: the tape file schema — meta block plus exact, sorted rows', () => {
  assert.ok(fs.existsSync(DATA_PATH), 'site/data/burn_tape.json exists (committed, may be zero rows)');
  const doc = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
  assert.ok(doc && typeof doc === 'object', 'the file is a JSON object');
  const meta = doc.meta;
  assert.ok(meta && typeof meta === 'object', 'an as-of meta block ships');
  for (const key of ['generatedAt', 'method', 'chain', 'rpc', 'roamer', 'well', 'dead',
    'fromBlock', 'toBlock', 'burnedCount', 'sweepSkippedCount', 'skips', 'wellDecimals',
    'sourceFiles', 'tool']) {
    assert.ok(Object.prototype.hasOwnProperty.call(meta, key), 'meta key missing: ' + key);
  }
  assert.strictEqual(meta.chain, 4663, 'the meta block names chain 4663');
  assert.strictEqual(meta.wellDecimals, 18, 'WELL decimals pinned');
  assert.strictEqual(meta.fromBlock, 0, 'the pull covers the full chain range');
  assert.ok(Number.isInteger(meta.toBlock) && meta.toBlock > 0, 'the as-of block is real');
  assert.match(meta.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/, 'generatedAt is an ISO Z stamp');
  assert.ok(typeof meta.rpc === 'string' && !meta.rpc.includes('://'),
    'the meta block names the rpc host only — never a key-carrying URL');
  assert.strictEqual(meta.roamer.toLowerCase(), ROAMER.toLowerCase(), 'meta roamer pin');
  assert.strictEqual(meta.well.toLowerCase(), WELL.toLowerCase(), 'meta well pin');
  assert.strictEqual(meta.dead.toLowerCase(), DEAD.toLowerCase(), 'meta dead pin');
  assert.ok(Array.isArray(meta.skips), 'skips ship as an array (empty is honest)');
  assert.strictEqual(meta.skips.length, meta.sweepSkippedCount, 'the skip count matches the skip list');
  assert.ok(Array.isArray(meta.sourceFiles) && meta.sourceFiles.includes('site/js/config.js'),
    'the meta block names its pin sources');
  assert.ok(meta.tool.includes('LOCAL-ONLY'), 'the tool line declares LOCAL-ONLY');
  assert.ok(Array.isArray(doc.rows), 'rows ship as an array');
  assert.strictEqual(doc.rows.length, meta.burnedCount, 'the burned count matches the row list');
  let prev = null;
  for (const row of doc.rows) {
    assert.deepStrictEqual(Object.keys(row).sort(),
      ['amountWELL', 'block', 'label', 'logIndex', 'sourceToken', 'tx'],
      'row keys are exactly the schema: ' + JSON.stringify(Object.keys(row)));
    assert.ok(Number.isInteger(row.block) && row.block > 0, 'block is an integer');
    assert.ok(Number.isInteger(row.logIndex) && row.logIndex >= 0, 'logIndex is an integer');
    assert.match(row.tx, /^0x[0-9a-fA-F]{64}$/, 'tx is a 32-byte hash');
    assert.match(row.sourceToken, /^0x[0-9a-fA-F]{40}$/, 'sourceToken is an address');
    assert.match(row.amountWELL, /^\d+(\.\d+)?$/, 'amountWELL is an exact decimal string, never a float');
    assert.ok(row.label.includes('dEaD'), 'the row label names the dEaD destination');
    const key = row.block * 1e6 + row.logIndex;
    if (prev !== null) { assert.ok(key > prev, 'rows are sorted by (block, logIndex)'); }
    prev = key;
  }
});

test('burn-tape: the builder is a LOCAL-ONLY tool no site file references', () => {
  const builder = fs.readFileSync(BUILDER_PATH, 'utf8');
  assert.match(builder, /LOCAL-ONLY/, 'the builder declares itself LOCAL-ONLY');
  assert.match(builder, /never wired into the site/i, 'the builder restates the wiring rule');
  const siteDir = path.join(ROOT, 'site');
  const offenders = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(p); continue; }
      if (!/\.(html|js)$/.test(entry.name)) { continue; }
      if (fs.readFileSync(p, 'utf8').includes('build_burn_tape')) { offenders.push(p); }
    }
  }
  walk(siteDir);
  assert.deepStrictEqual(offenders, [],
    'the operator tool name appears in site files — it must never be wired into the site');
  assert.match(raw, /fetch\('\.\.\/data\/burn_tape\.json'\)/,
    'the page loads the committed tape file, not the tool');
});

// -------------------------------------------------- THEME-NAV (2026-10-06) ----

test('burn-tape: the light pole ships — the pinned token block carries the contrast-verified set', () => {
  const page = stripComments(raw);
  const blockM = /html\[data-theme="light"\]\s*\{([\s\S]*?)\}/.exec(page);
  assert.ok(blockM, 'the pinned light block exists');
  assert.ok(blockM[1].includes('#F2EFE6'), 'light paper token in the pinned block');
  assert.ok(blockM[1].includes('#26231C'), 'light ink token in the pinned block');
  assert.ok(blockM[1].includes('--accent-text: #7A4E0E'), 'the light accent-text token ships');
});

test('burn-tape: the system-follow light block ships under the media scope', () => {
  const page = stripComments(raw);
  const blockM = /@media \(prefers-color-scheme: light\)\s*\{\s*html:not\(\[data-theme\]\)\s*\{([\s\S]*?)\}/.exec(page);
  assert.ok(blockM, 'the media-scoped system-follow block exists');
  assert.ok(blockM[1].includes('#F2EFE6') && blockM[1].includes('#26231C'), 'the same light set in the media block');
  assert.match(page, /html\[data-theme="light"\] \.hero-field/, 'the hero-field light duplicate ships under the pinned scope');
});

test('burn-tape: the anti-FOUC pin read ships in the head, before the stylesheet', () => {
  const styleAt = raw.indexOf('<style');
  assert.ok(styleAt > -1, 'the stylesheet opens');
  const head = raw.slice(0, styleAt);
  assert.ok(head.indexOf("localStorage.getItem('ws-theme-v1')") > -1,
    'the pre-paint pin read reads the shared key before first paint');
  assert.ok(head.indexOf('<script') > -1, 'the pin read rides a head script');
});

test('burn-tape: the theme toggle ships once, in the header', () => {
  const page = stripComments(raw);
  assert.match(page, /<button id="theme-toggle" class="theme-toggle" type="button" aria-pressed="false">LIGHT<\/button>/,
    'the toggle button ships with type, aria state and the initial GET-mode label');
  assert.strictEqual((page.match(/id="theme-toggle"/g) || []).length, 1, 'exactly one toggle');
  assert.match(page, /\.theme-toggle\s*\{/, 'the toggle styles ship');
});

test('burn-tape: the toggle wiring ships — click and matchMedia listeners', () => {
  const page = stripComments(raw);
  assert.ok(page.includes("var KEY = 'ws-theme-v1'"), 'the wiring reads the shared storage key');
  assert.ok(page.includes('btn.addEventListener(\'click\''), 'a click listener drives the toggle');
  assert.ok(page.includes("window.matchMedia('(prefers-color-scheme: light)')"), 'the matchMedia path ships');
  assert.ok(page.includes("mq.addEventListener('change', onChange)"), 'the system-preference change listener ships');
});
