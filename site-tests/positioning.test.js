'use strict';
// POSITIONING — WS-POSITIONING-COPY (2026-09-20): the category claim is on the
// site, the census receipts are live-wired, the source badge rides the
// repoUrl seam, and the money claims carry replayable VERIFY chips.
// Static pins (dependency-free node:test, __dirname-relative fs reads —
// same convention as resource-gate.test.js). Behavior wiring is asserted
// against the js source; the render-stub cohorts cover the guarded null paths.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const html = read('site/index.html');
const main = read('site/js/main.js');
const cfg = read('site/js/config.js');
const cpos = read('site/js/copy-position.js');
const css = read('site/css/style.css');

// ---- R1: the category claim in the head carriers ----
test('title carries the AI-native category claim', () => {
  assert.ok(html.includes('<title>Wellstreet — the AI-native liquidity layer of Robinhood Chain</title>'),
    'the title claims the category');
  assert.ok(!html.includes('the open liquidity layer of Robinhood Chain</title>'),
    'the old title form is gone');
});

test('og:title + descriptions carry the claim and the agent-operator receipt', () => {
  assert.ok(html.includes('content="Wellstreet — the open, AI-native liquidity layer of Robinhood Chain"'),
    'og:title');
  assert.ok(html.includes('content="Open-source vaults and an autonomous LP roamer on Robinhood Chain. Every pool fee measured, every claim checkable on-chain. Owned by holders, operated by agents."'),
    'meta description');
  assert.ok(html.includes('An AI agent operates the LP book — every figure a raw RPC call, checkable by anyone.'),
    'og:description');
  const head = html.slice(0, html.indexOf('</head>'));
  assert.ok(!head.includes('No audit.'), 'the stale no-audit line is retired from the head');
});

// ---- R2: hero claim + the two-stat census strip ----
test('hero carries the slogan sub-line', () => {
  assert.ok(html.includes('<p class="hero-claim">THE OPEN, AI-NATIVE LIQUIDITY LAYER OF ROBINHOOD CHAIN.</p>'),
    'the category claim rides under the unchanged H1');
});

test('census strip: zero-fee stat present, live-wired, fail-closed', () => {
  assert.ok(html.includes('id="hero-stat-zero"'), 'the zero-fee stat block exists');
  assert.ok(html.includes('id="hero-stat-zero-num"'), 'its number span exists');
  assert.ok(html.includes('books pay LPs zero'), 'its label exists');
  assert.ok(main.includes("String(summary.hookMonetized)"),
    'main.js fills the number from the fleet summary (never hardcoded in markup)');
  assert.ok(!/id="hero-stat-zero-num">\d/.test(html), 'no fabricated number in static markup');
  assert.ok(main.includes("zStat.classList.add('hero-stat--unavailable')"),
    'the unavailable register is stamped on the zero stat too');
});

// ---- R3: the SOURCE badge rides the repoUrl seam ----
test('source badge: no markup href, JS-assigned from config', () => {
  const badgeTag = /<a id="source-badge"[^>]*>/.exec(html);
  assert.ok(badgeTag, 'the badge anchor exists');
  assert.ok(!/href=/.test(badgeTag[0]), 'markup carries no href (resource-gate scans href=)');
  assert.ok(cfg.includes("repoUrl: 'https://github.com/wellstreettech/wellstreet'"),
    'config.repoUrl is the public repo (identity ops done)');
  assert.ok(main.includes("$('source-badge')"), 'main.js wires the badge');
  assert.ok(main.includes("badge.setAttribute('rel', 'noopener')"), 'noopener on the external link');
});

// ---- R4: verify chips on the money claims ----
test('verify chips exist on the split claim and the zero-take seal', () => {
  for (const key of ['split', 'seal']) {
    assert.ok(html.includes(`id="verify-chip-${key}"`), `chip ${key} exists`);
    assert.ok(html.includes(`id="verify-panel-${key}"`), `panel ${key} exists`);
    assert.ok(html.includes(`id="verify-cmd-${key}"`), `command pre ${key} exists`);
  }
  assert.ok(main.includes('DEPOSITOR_BPS()(uint256)'), 'the split getter is pinned in the command');
  assert.ok(main.includes('BURN_BPS()(uint256)'), 'the burn getter is pinned in the command');
  assert.ok(main.includes('-> 9000'), 'the live-probed expected value ships in the command');
  assert.ok(main.includes('-> 1000'), 'the live-probed burn value ships in the command');
  assert.ok(main.includes('cfg.contracts && cfg.contracts.vault'),
    'commands compose from config addresses (addressSource=config.js)');
});

test('verify panels carry no external href and no load-time RPC', () => {
  const panelStart = html.indexOf('id="verify-panel-split"');
  const panelEnd = html.indexOf('</div>', html.indexOf('id="verify-copy-split"'));
  const panelHtml = html.slice(panelStart, panelEnd);
  assert.ok(!/href=/.test(panelHtml), 'no href inside the panel (URL stays text)');
  assert.ok(!/fetch\(|XMLHttpRequest|eth_query/i.test(main.split('function initVerifyChips')[1] || ''),
    'the chip path runs zero RPC at load');
});

test('copy-position exports the toast seam the chips reuse', () => {
  assert.ok(cpos.includes('toast: toast'), 'toast is exported');
  assert.ok(main.includes('WS.copyPosition.toast'), 'chips reuse the one-toast seam');
  assert.ok(css.includes('.verify-cmd'), 'the command block is styled');
});

// ---- R5: the kill list still holds on the touched surfaces ----
test('kill list: no hype vocabulary anywhere in the page', () => {
  assert.ok(!/guaranteed|risk-free|passive income/i.test(html), 'no hype terms');
  assert.ok(html.includes('every number checkable'), 'the census note keeps the voice');
});
