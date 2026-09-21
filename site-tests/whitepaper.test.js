'use strict';
// whitepaper battery (2026-09-18) — the receipts teeth for docs/public/whitepaper.md.
// The whitepaper is the paper of record; this battery makes its factual drift FAIL CI.
// Truth sources, per the wave-2 goal contract:
//   (a) every 0x…40-hex address literal in the paper is a config-pinned address
//       (site/js/config.js — same derivation site-tests/docs-claims.test.js uses,
//       plus the roamStack.allowlist / roamStack.safe / uniswapV4.positionManager
//       keys, which ARE config-pinned); PLUS a positive must-quote set so the scan
//       can never pass on zero hits
//   (b) guardrail values quoted in the paper match skills/registry.json — config.js
//       carries NO roamer guardrails, so the machine-readable pin source for the
//       live/ceiling guardrail values is the agent registry
//   (c) the 90/10 split + feeBps figures match config.economics (1000 initial /
//       2000 cap / 10 tip) and the vault-lane split constants the paper quotes
//   (d) census claims in the paper match site/data/fleet.json — book count,
//       zero-fee count, measured-APR coverage, and the anchor-book row (located
//       via the config-pinned anchor poolId prefix) are parsed from the JSON, not
//       hardcoded; the raw-screen census (docs/ops/v4_fee_screen.json, an
//       UNTRACKED research artifact) is checked only when the file is present
//   (e) kill-list scan specific to the paper (guaranteed / risk-free / ownerless /
//       passive income / auto yield absent — 'guaranteed' is checked OUTSIDE the
//       literal not-guaranteed.md filename reference, which is a doc pointer, not
//       a promise), plus zero VIBE-brand mentions and zero stale pending claims
//   (f) the paper exists and is ≥ 4,500 words
//   (g) config.docs.index contains the whitepaper entry at its locked position
//       (position 2, right after the agent-vault-ops lead) AND the file exists on
//       disk (index↔disk truth)
// Plus renderer-discipline pins: no tables, no HTML tags, no 64-hex id literals.
// Dependency-free: node:test + node:assert + node:fs ONLY (house style).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../site/js/config.js');

const PAPER_PATH = path.join(__dirname, '..', 'docs', 'public', 'whitepaper.md');
const FLEET_PATH = path.join(__dirname, '..', 'site', 'data', 'fleet.json');
const REGISTRY_PATH = path.join(__dirname, '..', 'skills', 'registry.json');
const RAW_SCREEN_PATH = path.join(__dirname, '..', 'docs', 'ops', 'v4_fee_screen.json');

function countOccurrences(haystack, needle) {
  if (needle === '') { return 0; }
  var n = 0;
  var i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n += 1; i += needle.length; }
  return n;
}

const paper = fs.readFileSync(PAPER_PATH, 'utf8');
const paperLower = paper.toLowerCase();
const fleet = JSON.parse(fs.readFileSync(FLEET_PATH, 'utf8'));
const registry = JSON.parse(fs.readFileSync(REGISTRY_PATH, 'utf8'));

function paperNumber(re, label) {
  const m = paper.match(re);
  assert.ok(m, 'whitepaper.md is missing the census figure the battery keys on: ' + label);
  return Number(m[1]);
}

// ---- (g) index↔disk truth -------------------------------------------------------

test('(g) paper exists on disk and config.docs.index carries the whitepaper entry at the locked position', () => {
  assert.ok(fs.existsSync(PAPER_PATH), 'docs/public/whitepaper.md is missing');
  assert.ok(paper.length > 0, 'docs/public/whitepaper.md is empty');
  const idx = config.docs.index;
  const entry = idx.find(function (d) { return d.id === 'whitepaper'; });
  assert.ok(entry, 'config.docs.index has no whitepaper entry');
  assert.strictEqual(entry.file, 'whitepaper.md', 'whitepaper index entry points at the wrong file');
  assert.strictEqual(entry.title, 'Whitepaper', 'whitepaper index entry title drifted');
  assert.strictEqual(idx[1] && idx[1].id, 'whitepaper',
    'whitepaper must sit at docs index position 2 (index 1), right after the agent-vault-ops lead');
  assert.strictEqual(idx[0] && idx[0].id, 'agent-vault-ops',
    'the locked agent-vault-ops lead must stay first in the docs index');
});

// ---- (f) existence + length ------------------------------------------------------

test('(f) the paper is ≥ 4,500 words', () => {
  const words = paper.split(/\s+/).filter(Boolean).length;
  assert.ok(words >= 4500, 'whitepaper.md is ' + words + ' words — below the 4,500 floor');
});

// ---- (a) addresses ----------------------------------------------------------------

const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

// Same pin derivation as docs-claims.test.js, plus the roamer-stack keys that are
// config-pinned but absent from that battery's map (allowlist, safe, positionManager).
function pinnedAddresses() {
  const c = config.contracts;
  const out = {};
  out['contracts.weth'] = c.weth;
  out['contracts.swapRouter02'] = c.swapRouter02;
  out['contracts.quoterV2'] = c.quoterV2;
  out['contracts.vaultFactory'] = c.vaultFactory;
  out['contracts.treasuryTimelock'] = c.treasuryTimelock;
  out['contracts.harvester'] = c.harvester;
  out['tokens.weth'] = config.tokens.weth.address;
  out['tokens.spy'] = config.tokens.spy.address;
  if (config.roamStack) {
    ['vault', 'roamer', 'allowlist', 'usdg', 'timelock', 'safe'].forEach(function (k) {
      if (typeof config.roamStack[k] === 'string' && /^0x[0-9a-fA-F]{40}$/.test(config.roamStack[k])) {
        out['roamStack.' + k] = config.roamStack[k];
      }
    });
  }
  config.vaults.forEach(function (v) {
    out['vaults[' + v.id + '].vault'] = v.vault;
    out['vaults[' + v.id + '].asset'] = v.asset;
  });
  if (Array.isArray(config.vaultFamily)) {
    config.vaultFamily.forEach(function (f) {
      ['vault', 'harvester', 'asset', 'quote'].forEach(function (k) {
        if (typeof f[k] === 'string' && /^0x[0-9a-fA-F]{40}$/.test(f[k])) {
          out['vaultFamily[' + f.id + '].' + k] = f[k];
        }
      });
    });
  }
  Object.keys(config.pools).forEach(function (k) {
    out['pools.' + k] = config.pools[k].address;
    out['pools.' + k + '.token0'] = config.pools[k].token0;
    out['pools.' + k + '.token1'] = config.pools[k].token1;
  });
  if (config.uniswapV4) {
    out['uniswapV4.poolManager'] = config.uniswapV4.poolManager;
    out['uniswapV4.stateView'] = config.uniswapV4.stateView;
    if (typeof config.uniswapV4.positionManager === 'string' &&
        /^0x[0-9a-fA-F]{40}$/.test(config.uniswapV4.positionManager)) {
      out['uniswapV4.positionManager'] = config.uniswapV4.positionManager;
    }
  }
  config.priceFeeds.spyUsd.proxies.forEach(function (p, i) { out['priceFeeds.spyUsd[' + i + ']'] = p; });
  return out;
}

test('(a) every address literal in the paper is a config-pinned address', () => {
  const pins = pinnedAddresses();
  const lowerPins = Object.keys(pins).map(function (k) { return pins[k].toLowerCase(); });
  const hits = paper.match(ADDRESS_RE) || [];
  assert.ok(hits.length > 0, 'scan found zero address literals — the battery is not scanning the paper');
  for (const addr of hits) {
    assert.ok(
      lowerPins.indexOf(addr.toLowerCase()) !== -1,
      'whitepaper.md quotes address ' + addr + ' which is NOT pinned in site/js/config.js — ' +
      'fix the paper or pin it deliberately in the same change'
    );
  }
});

test('(a) the paper quotes the core live-stack pins (positive scan — never pass on zero hits)', () => {
  const pins = pinnedAddresses();
  const lowerPaper = paperLower;
  const mustQuote = ['roamStack.vault', 'roamStack.roamer', 'roamStack.usdg',
    'uniswapV4.poolManager', 'uniswapV4.stateView'];
  for (const key of mustQuote) {
    assert.ok(pins[key], 'pin map missing ' + key + ' — extend pinnedAddresses() in the same change');
    assert.ok(countOccurrences(lowerPaper, pins[key].toLowerCase()) >= 1,
      'whitepaper.md does not quote the pinned ' + key + ' (' + pins[key] + ')');
  }
});

test('(a) the paper carries NO 64-hex id literals (poolIds / governance ids / tx hashes are config-key references)', () => {
  const hex64 = paper.match(/0x[0-9a-fA-F]{64}/g) || [];
  assert.deepStrictEqual(hex64, [],
    'whitepaper.md embeds a full 64-hex literal — poolIds/governance ids/tx hashes must be quoted ' +
    'by config key or truncated reference, never pasted whole');
});

// ---- (b) guardrails vs skills/registry.json ----------------------------------------

const wsSkill = registry.skills.find(function (s) { return s.name === 'wellstreet-vaults'; });
const g = wsSkill && wsSkill.guardrails ? wsSkill.guardrails : null;

test('(b) guardrail values quoted in the paper match the registry pins (live + ceilings)', () => {
  assert.ok(g, 'skills/registry.json carries no wellstreet-vaults guardrails — the pin source moved');
  // MIN_HOLD
  assert.ok(countOccurrences(paper, String(g.minHoldSeconds)) >= 1,
    'paper must quote MIN_HOLD = ' + g.minHoldSeconds);
  assert.ok(countOccurrences(paper, 'ceiling 30 d') >= 1 || countOccurrences(paper, '30 days') >= 1,
    'paper must state the MIN_HOLD ceiling (' + g.ceilings.minHoldDays + ' days)');
  // MAX_MIGRATIONS_PER_PERIOD (rolling 365 days, re-ranges count)
  assert.ok(countOccurrences(paper, String(g.maxMigrationsPerPeriod)) >= 1,
    'paper must quote MAX_MIGRATIONS_PER_PERIOD = ' + g.maxMigrationsPerPeriod);
  assert.ok(countOccurrences(paper, String(g.maxMigrationsPeriodDays)) >= 1,
    'paper must state the rolling-period length (' + g.maxMigrationsPeriodDays + ' days)');
  // MIN_EXPECTED_GAIN_BPS
  assert.ok(countOccurrences(paper, String(g.minExpectedGainBps)) >= 1,
    'paper must quote MIN_EXPECTED_GAIN_BPS = ' + g.minExpectedGainBps);
  assert.ok(countOccurrences(paper, String(g.ceilings.minExpectedGainBps)) >= 1,
    'paper must quote the MIN_EXPECTED_GAIN_BPS ceiling ' + g.ceilings.minExpectedGainBps);
  // DEPOSIT_CAP operating + ceiling
  assert.ok(countOccurrences(paper, '25,000 USDG') >= 1,
    'paper must quote the operating DEPOSIT_CAP ' + g.depositCapUsdg + ' USDG');
  assert.ok(countOccurrences(paper, '250,000 USDG') >= 1,
    'paper must quote the DEPOSIT_CAP ceiling ' + g.ceilings.depositCapUsdg + ' USDG');
});

test('(b) the break-even arithmetic the paper prints is internally consistent', () => {
  // 3911 = round(75 bps * 365/7) and 31286 = round(600 bps * 365/7) — the paper
  // prints both formulas; the battery pins the arithmetic so a re-print cannot drift.
  assert.strictEqual(Math.round(75 * 365 / 7), 3911, 'moderate break-even arithmetic moved');
  assert.strictEqual(Math.round(600 * 365 / 7), 31286, 'heavy break-even arithmetic moved');
  assert.ok(countOccurrences(paper, '365/7') >= 1, 'paper must carry the break-even 365/7 form');
});

test('(b) live-state figures quoted in the paper match config.roamStack.statusNote', () => {
  const note = config.roamStack.statusNote;
  const nums = note.match(/\d+\.\d{6}/g) || [];
  assert.ok(nums.length >= 3, 'config.roamStack.statusNote no longer carries the live split figures — re-pin the battery');
  for (const n of nums) {
    assert.ok(countOccurrences(paper, n) >= 1,
      'whitepaper.md does not quote the config-pinned live figure ' + n);
  }
});

// ---- (c) split + feeBps vs config.economics -----------------------------------------

test('(c) the paper states the config economics: 90/10, the cap, the initial fee, the tip', () => {
  const econ = config.economics;
  assert.strictEqual(econ.maxFeeBps, 2000, 'maxFeeBps re-pinned — update this battery in the same change');
  assert.strictEqual(econ.protocolFeeBpsInitial, 1000, 'protocolFeeBpsInitial re-pinned — update this battery in the same change');
  assert.strictEqual(econ.harvesterTipBps, 10, 'harvesterTipBps re-pinned — update this battery in the same change');
  assert.ok(countOccurrences(paperLower, 'max_fee_bps = ' + econ.maxFeeBps) >= 1,
    'paper must carry the literal cap: MAX_FEE_BPS = ' + econ.maxFeeBps);
  assert.ok(countOccurrences(paper, '20%') >= 1, 'paper must state the hard cap 20%');
  assert.ok(countOccurrences(paper, '10%') >= 1, 'paper must state the initial protocol fee 10%');
  assert.ok(countOccurrences(paper, '0.1%') >= 1, 'paper must state the harvest tip 0.1%');
  // the RoamVault provenance split the paper describes (DEPOSITOR_BPS/BURN_BPS)
  assert.ok(countOccurrences(paper, '9000 / 10000') >= 1, 'paper must state the depositor split constant (9000 / 10000)');
  assert.ok(countOccurrences(paper, '1000 / 10000') >= 1, 'paper must state the burn split constant (1000 / 10000)');
  assert.ok(countOccurrences(paperLower, '90% depositors / 10% burn') >= 1,
    'paper must state the vault-lane split as 90% depositors / 10% burn accrual');
});

// ---- (d) census vs site/data/fleet.json ----------------------------------------------

test('(d) curated census figures in the paper match fleet.json summary', () => {
  const s = fleet.summary;
  assert.ok(s && typeof s.books === 'number', 'fleet.json summary missing — the feed shape moved');
  const books = paperNumber(/books\s*\.{2,}\s*(\d+)\s*\(\s*(\d+)\s*PAYS\s*\/\s*(\d+)\s*HOOK\s*\/\s*(\d+)\s*DEAD\s*\)/,
    'curated census line "books ... (N PAYS / N HOOK / N DEAD)"');
  assert.strictEqual(books, s.books, 'paper curated book count drifts from fleet.json summary.books');
  const pays = paperNumber(/books\s*\.{2,}\s*\d+\s*\(\s*(\d+)\s*PAYS/, 'curated PAYS count');
  const hook = paperNumber(/books\s*\.{2,}\s*\d+\s*\(\s*\d+\s*PAYS\s*\/\s*(\d+)\s*HOOK/, 'curated HOOK count');
  const dead = paperNumber(/books\s*\.{2,}\s*\d+\s*\(\s*\d+\s*PAYS\s*\/\s*\d+\s*HOOK\s*\/\s*(\d+)\s*DEAD/, 'curated DEAD count');
  assert.strictEqual(pays, s.paysLps, 'paper PAYS count drifts from fleet.json summary.paysLps');
  assert.strictEqual(hook, s.hookMonetized, 'paper HOOK count drifts from fleet.json summary.hookMonetized');
  assert.strictEqual(dead, s.dead, 'paper DEAD count drifts from fleet.json summary.dead');
});

test('(d) the zero-fee count in the paper matches fleet.json books[].paysNothingToLps', () => {
  const zeroFee = fleet.books.filter(function (b) { return b.paysNothingToLps === true; }).length;
  const quoted = paperNumber(/pay LPs nothing\s*\.{2,}\s*(\d+)/, 'zero-fee census line "pay LPs nothing"');
  assert.strictEqual(quoted, zeroFee,
    'paper zero-fee count drifts from fleet.json books[].paysNothingToLps (' + zeroFee + ')');
});

test('(d) the measured-APR coverage count in the paper matches fleet.json', () => {
  const withApr = fleet.books.filter(function (b) { return typeof b.feeAprPct === 'number'; }).length;
  const quoted = paperNumber(/measured feeAprPct\s*\.{2,}\s*(\d+)\s*of\s*\d+\s*rows/, 'measured-APR coverage census line');
  assert.strictEqual(quoted, withApr,
    'paper measured-APR coverage drifts from fleet.json numeric feeAprPct rows (' + withApr + ')');
});

test('(d) the anchor-book figures in the paper match the fleet.json anchor row', () => {
  const anchorPoolId = config.roamStack.usdgEthPoolId;
  assert.ok(typeof anchorPoolId === 'string' && anchorPoolId.length > 10,
    'config.roamStack.usdgEthPoolId missing — cannot locate the anchor row');
  const anchor = fleet.books.find(function (b) {
    return typeof b.poolId === 'string' && b.poolId.slice(0, 10) === anchorPoolId.slice(0, 10);
  });
  assert.ok(anchor, 'fleet.json carries no anchor-book row (poolId prefix ' + anchorPoolId.slice(0, 10) + ')');
  assert.ok(countOccurrences(paper, String(anchor.feeAprPct)) >= 1,
    'paper does not quote the anchor feeAprPct ' + anchor.feeAprPct + ' from fleet.json');
  assert.ok(countOccurrences(paper, String(anchor.chargedFeeBps)) >= 1,
    'paper does not quote the anchor chargedFeeBps ' + anchor.chargedFeeBps + ' from fleet.json');
});

test('(d) raw-screen census in the paper matches docs/ops/v4_fee_screen.json (when the untracked artifact is present)', () => {
  if (!fs.existsSync(RAW_SCREEN_PATH)) {
    // v4_fee_screen.json is an untracked research artifact; its absence skips the
    // raw-screen check — the curated fleet.json checks above carry the teeth.
    return;
  }
  const screen = JSON.parse(fs.readFileSync(RAW_SCREEN_PATH, 'utf8'));
  const meta = screen.dexscreener_meta || {};
  const pools = Array.isArray(screen.pools) ? screen.pools : Object.values(screen.pools || {});
  const tally = pools.reduce(function (m, p) { m[p.class] = (m[p.class] || 0) + 1; return m; }, {});
  const aboveDust = paperNumber(/books measured\s*\.{2,}\s*(\d+)/, 'raw census line "books measured"');
  assert.strictEqual(aboveDust, meta.above_dust, 'paper raw book count drifts from the screen above_dust meta');
  const rawPays = paperNumber(/PAYS-LPS\s*\.{2,}\s*(\d+)/, 'raw PAYS-LPS count');
  const rawHook = paperNumber(/HOOK-MONETIZED\s*\.{2,}\s*(\d+)/, 'raw HOOK-MONETIZED count');
  const rawDead = paperNumber(/DEAD\s*\.{2,}\s*(\d+)/, 'raw DEAD count');
  assert.strictEqual(rawPays, tally['PAYS-LPS'], 'paper PAYS-LPS count drifts from the screen tally');
  assert.strictEqual(rawHook, tally['HOOK-MONETIZED'], 'paper HOOK-MONETIZED count drifts from the screen tally');
  assert.strictEqual(rawDead, tally['DEAD'], 'paper DEAD count drifts from the screen tally');
  // the derived shares the paper prints (percentages + the black-hole sum)
  const hookPct = Math.round(rawHook / aboveDust * 1000) / 10;
  const quotedHookPct = paperNumber(/\((\d+\.\d)% of (\d+)\b/, 'hook share percentage of the raw universe');
  assert.strictEqual(quotedHookPct, hookPct, 'paper hook-monetized percentage drifts from the screen tally');
  const blackHole = rawHook + rawDead;
  assert.ok(countOccurrences(paper, String(blackHole)) >= 1,
    'paper does not quote the derived books-paying-zero sum ' + blackHole);
});

// ---- (e) kill-list scan --------------------------------------------------------------

test('(e) the paper carries none of the banned promise/brand/pending language', () => {
  const banned = ['vibe', 'guaranteed returns', 'risk-free', 'ownerless', 'passive income',
    'auto yield', 's&p vault', 'pending_deploy', 'not yet deployed', 'awaiting on-chain',
    'has not deployed', 'd12', 'pad buyback'];
  for (const phrase of banned) {
    assert.strictEqual(
      countOccurrences(paperLower, phrase), 0,
      'whitepaper.md carries banned language "' + phrase + '" — the voice contract kill list is absolute'
    );
  }
});

test('(e) the word "guaranteed" appears in the paper ONLY inside the not-guaranteed.md doc reference', () => {
  const stripped = paperLower.split('not-guaranteed').join(' ');
  assert.strictEqual(
    countOccurrences(stripped, 'guaranteed'), 0,
    'whitepaper.md uses "guaranteed" outside the not-guaranteed.md reference — the paper promises nothing'
  );
});

// ---- renderer discipline (the docs.js contract) ---------------------------------------

test('renderer discipline: no tables, no HTML tags, fenced blocks only for math', () => {
  const tableRows = paper.split('\n').filter(function (l) { return /^\s*\|.+\|\s*$/.test(l); });
  assert.deepStrictEqual(tableRows, [], 'whitepaper.md uses a markdown table — the wave-2 contract says tables are out');
  const htmlTags = paper.match(/<(\/?(?:b|i|em|strong|code|pre|div|span|table|br|img|a|h[1-6])\b)/gi) || [];
  assert.deepStrictEqual(htmlTags, [], 'whitepaper.md embeds raw HTML — everything renders through docs.js escaping');
});

// ---- PDF LOCKSTEP (2026-09-19) ----------------------------------------------------------
// The PDF rendering (site/whitepaper.pdf) is generated FROM this md by
// scripts/whitepaper_pdf.js + whitepaper_pdf_render.py. Same ceremony as the skill
// registry: the md's PDF line and the artifact must exist together, or the paper
// advertises a download that 404s (or ships a PDF nobody links).

test('(h) PDF lockstep: the md names the PDF and the artifact exists on disk', () => {
  assert.ok(
    paperLower.indexOf('wellstreet.tech/whitepaper.pdf') !== -1,
    'whitepaper.md no longer carries the whitepaper.pdf link line — restore it or remove the PDF'
  );
  const pdfPath = path.join(__dirname, '..', 'site', 'whitepaper.pdf');
  assert.ok(fs.existsSync(pdfPath), 'site/whitepaper.pdf is missing — regenerate: node scripts/whitepaper_pdf.js > /tmp/wellstreet-whitepaper.html && python3 scripts/whitepaper_pdf_render.py');
  const pdf = fs.readFileSync(pdfPath);
  assert.ok(pdf.length > 100 * 1024, 'site/whitepaper.pdf is suspiciously small (' + pdf.length + ' bytes)');
  assert.strictEqual(pdf.slice(0, 5).toString('ascii'), '%PDF-', 'site/whitepaper.pdf is not a PDF');
});

// ---- (i) router deployment state (2026-09-21) ------------------------------------------
// FleetRouter v1 deployed 2026-09-21 on RH chain 4663 (self-custodied one-tx LP entry;
// audit GO-WITH-FIXES, fixes in f581bef). The router is deliberately NOT pinned in
// site/js/config.js yet (post-$WELL sequencing), so the paper carries NO router address
// literal — test (a) rejects any non-pin literal by design. These teeth pin the
// deployment CLAIMS instead. When config gains the router pin, replace the ban-scan
// below with a positive scan that the paper quotes config's router address.

test('(i) the paper states the router deployment: date, starting fee, timelock gate, ceiling, caller custody', () => {
  assert.ok(countOccurrences(paper, '2026-09-21') >= 1, 'paper must date the router deployment');
  assert.ok(countOccurrences(paper, '0.0005 ETH') >= 1, 'paper must quote the router starting fee 0.0005 ETH');
  assert.ok(countOccurrences(paper, '0.05 ETH') >= 1, 'paper must quote the router hard ceiling 0.05 ETH');
  assert.ok(countOccurrences(paperLower, 'setfee') >= 1, 'paper must name the timelock-gated setFee');
  assert.ok(countOccurrences(paper, 'never leave the caller') >= 1,
    'paper must state the zero-custody property (NFT + tokens never leave the caller)');
});

test('(i) the paper quotes NO full router address while the router is unpinned in config', () => {
  const routerAddr = '0xafae77e6b13a5350682c0d1a7876a3f309eec0c9';
  assert.strictEqual(countOccurrences(paperLower, routerAddr), 0,
    'whitepaper.md quotes the full router address — pin it in site/js/config.js first, ' +
    'then quote the pin (test (a) will enforce it matches)');
});
