'use strict';
// docs-claims battery (2026-09-05) — the checkable-docs voice, enforced by CI.
// Pins the factual claims in docs/public/*.md against the deployed configuration
// (site/js/config.js — "THE single source of truth", config.js:2). Where a doc
// quotes a chain fact, the config value is the truth the quote must match:
//   (a) every 0x…40-hex address literal in ANY doc is a config-pinned address
//       (compared case-insensitively — config.js:85-87 preserves verified casing
//       but sanctions case-insensitive comparison), plus positive per-key pins
//       for the guarantees.md address table and the run-it-yourself.md
//       external-facts table so the scan can never pass on zero hits
//   (b) no doc claims the vaults are pending/undeployed — the stale
//       pre-broadcast phrases are banned (the contracts DEPLOYED 2026-09-03,
//       config.js:92-96; "the harvester LP is not yet seeded" is a TRUE state
//       claim and stays allowed — only the vault-pending phrasings are banned)
//   (c) the fee-split claims state the config economics: 90/10 at
//       protocolFeeBpsInitial, hard cap MAX_FEE_BPS = maxFeeBps, harvest tip =
//       harvesterTipBps — derived from config, so a deliberate re-pin must move
//       doc and config together
//   (d) methodology.md carries the ratified 2026-09-03 liquidity-share formula
//       (the L_pos/L_pool and pool-TVL/vault-TVL legs) and NOT the superseded
//       2026-08-30 TVL-share form; not-guaranteed.md's verbal formula keeps the
//       liquidity-share leg
//   (e) zero VIBE mentions (brand separation) and zero promise language
//       ('guaranteed returns', 'risk-free', 'ownerless') — the no-promises voice
//   (f) chain identity + endpoint facts quoted in docs match config: chain ID,
//       public RPC, block explorer, pool fee tier
// A failing assert here = a REAL docs/config drift: fix the doc (or re-pin
// config deliberately in the same change), never loosen the assert.
// Dependency-free: node:test + node:assert + node:fs ONLY (house style).

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const config = require('../site/js/config.js');

const DOCS_DIR = path.join(__dirname, '..', 'docs', 'public');

function countOccurrences(haystack, needle) {
  if (needle === '') { return 0; }
  var n = 0;
  var i = 0;
  while ((i = haystack.indexOf(needle, i)) !== -1) { n += 1; i += needle.length; }
  return n;
}

// Every published doc on disk, indexed by file name. Scanned WHOLE-DIR (not just
// config.docs.index) so a doc the index forgot is still claim-checked.
const docFiles = fs.readdirSync(DOCS_DIR).filter(function (f) { return f.endsWith('.md'); }).sort();
const docs = {};
for (const f of docFiles) {
  docs[f] = fs.readFileSync(path.join(DOCS_DIR, f), 'utf8');
}

// The pinned address registry, straight off the live config object — no
// hand-copied literals in this file. Keys name the config path for messages.
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
  out['pools.spyWeth500'] = config.pools.spyWeth500.address;
  out['pools.spyWeth500.token0'] = config.pools.spyWeth500.token0;
  out['pools.spyWeth500.token1'] = config.pools.spyWeth500.token1;
  config.priceFeeds.spyUsd.proxies.forEach(function (p, i) { out['priceFeeds.spyUsd[' + i + ']'] = p; });
  config.vaults.forEach(function (v) {
    out['vaults[' + v.id + '].vault'] = v.vault;
    out['vaults[' + v.id + '].asset'] = v.asset;
  });
  // WS-MULTI-VAULT-FRONTEND (2026-09-05): the vault family extends the pin map —
  // every hex address a family entry carries (vault/harvester/asset/quote) is a
  // legit doc quote. PENDING_DEPLOY placeholders are non-hex and never enter the
  // map; v4 poolIds are 64-hex (not 40-hex addresses) and are quoted in docs in
  // abbreviated form only.
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
  }
  return out;
}

const ADDRESS_RE = /0x[0-9a-fA-F]{40}/g;

// Economics strings the docs must state, derived from config (100 bps = 1%).
const econ = config.economics;
const initialPct = (econ.protocolFeeBpsInitial / 100) + '%';            // 10%
const depositorPct = ((10000 - econ.protocolFeeBpsInitial) / 100) + '%'; // 90%
const capPct = (econ.maxFeeBps / 100) + '%';                            // 20%
const tipPct = (econ.harvesterTipBps / 100) + '%';                      // 0.1%
const finalLeg = String(1 - econ.protocolFeeBpsInitial / 10000);        // 0.9

// ---- Coverage -----------------------------------------------------------------

test('battery covers every published doc on disk, non-empty, all indexed', () => {
  assert.ok(docFiles.length >= config.docs.index.length, 'docs/public has fewer .md files than the docs index');
  for (const d of config.docs.index) {
    assert.ok(docFiles.indexOf(d.file) !== -1, 'docs index file missing from the scan: ' + d.file);
    assert.ok(docs[d.file].length > 0, 'published doc is empty: ' + d.file);
  }
});

// ---- (a) addresses -------------------------------------------------------------

test('(a) every address literal in any doc is a config-pinned address', () => {
  const pins = pinnedAddresses();
  const lowerPins = Object.keys(pins).map(function (k) { return pins[k].toLowerCase(); });
  let found = 0;
  for (const file of docFiles) {
    const hits = docs[file].match(ADDRESS_RE) || [];
    found += hits.length;
    for (const addr of hits) {
      const at = lowerPins.indexOf(addr.toLowerCase());
      assert.ok(
        at !== -1,
        file + ' quotes address ' + addr + ' which is NOT pinned in site/js/config.js — ' +
        'fix the doc or pin it deliberately in the same change'
      );
    }
  }
  assert.ok(found > 0, 'scan found zero address literals — the battery is not scanning what it thinks it is');
});

test('(a) guarantees.md quotes the deployed vault family exactly as pinned', () => {
  const pins = pinnedAddresses();
  const text = docs['guarantees.md'].toLowerCase();
  for (const key of ['vaults[ws-spy].vault', 'contracts.vaultFactory', 'contracts.treasuryTimelock', 'contracts.harvester']) {
    assert.ok(
      countOccurrences(text, pins[key].toLowerCase()) >= 1,
      'guarantees.md address table does not quote the pinned ' + key + ' (' + pins[key] + ')'
    );
  }
});

test('(a) run-it-yourself.md quotes the pinned SPY token and SPY/WETH pool', () => {
  const pins = pinnedAddresses();
  const text = docs['run-it-yourself.md'].toLowerCase();
  assert.ok(countOccurrences(text, pins['tokens.spy'].toLowerCase()) >= 1,
    'run-it-yourself.md does not quote the pinned SPY address (' + pins['tokens.spy'] + ')');
  assert.ok(countOccurrences(text, pins['pools.spyWeth500'].toLowerCase()) >= 1,
    'run-it-yourself.md does not quote the pinned pool address (' + pins['pools.spyWeth500'] + ')');
});

test('(a) agent-vault-ops.md quotes the pinned flagship + family addresses', () => {
  const pins = pinnedAddresses();
  const text = docs['agent-vault-ops.md'].toLowerCase();
  const mustQuote = ['vaults[ws-spy].vault', 'contracts.vaultFactory', 'contracts.harvester',
    'tokens.spy', 'tokens.weth',
    'vaultFamily[rblx-usdg].asset', 'vaultFamily[rblx-usdg].quote',
    'pools.rblxUsdg3000'];
  for (const key of mustQuote) {
    assert.ok(pins[key], 'pin map missing ' + key + ' — extend pinnedAddresses() in the same change');
    assert.ok(countOccurrences(text, pins[key].toLowerCase()) >= 1,
      'agent-vault-ops.md does not quote the pinned ' + key + ' (' + pins[key] + ')');
  }
});

// ---- (b) no stale pending claims ------------------------------------------------

test('(b) no doc claims the vault is pending/undeployed', () => {
  const banned = ['PENDING_DEPLOY', 'not yet deployed', 'awaiting on-chain', 'has not deployed'];
  for (const file of docFiles) {
    const lower = docs[file].toLowerCase();
    for (const phrase of banned) {
      assert.strictEqual(
        countOccurrences(lower, phrase.toLowerCase()), 0,
        file + ' carries the stale pre-broadcast phrase "' + phrase + '" — the vault family is DEPLOYED (config.js pins the 2026-09-03 F-01 broadcast)'
      );
    }
  }
});

// ---- (c) fee-split claims vs config economics -----------------------------------

test('(c) config economics sanity: the split the docs must state', () => {
  // Guard against silent re-derivation: if config re-pins the economics, the
  // doc-facing pins below must move in the SAME change (checkable-docs contract).
  assert.strictEqual(econ.maxFeeBps, 2000, 'maxFeeBps re-pinned — update the docs-facing pins in this battery');
  assert.strictEqual(econ.protocolFeeBpsInitial, 1000, 'protocolFeeBpsInitial re-pinned — update the docs-facing pins in this battery');
  assert.strictEqual(econ.harvesterTipBps, 10, 'harvesterTipBps re-pinned — update the docs-facing pins in this battery');
  assert.strictEqual(initialPct, '10%');
  assert.strictEqual(depositorPct, '90%');
  assert.strictEqual(capPct, '20%');
  assert.strictEqual(tipPct, '0.1%');
});

test('(c) tokenomics.md states the 90/10 split within the MAX_FEE_BPS cap', () => {
  const text = docs['tokenomics.md'];
  const lower = text.toLowerCase();
  assert.ok(countOccurrences(lower, 'max_fee_bps = ' + econ.maxFeeBps) >= 1,
    'tokenomics.md must carry the literal cap: MAX_FEE_BPS = ' + econ.maxFeeBps);
  assert.ok(countOccurrences(text, initialPct) >= 1, 'tokenomics.md must state the initial protocol fee ' + initialPct);
  assert.ok(countOccurrences(text, depositorPct) >= 1, 'tokenomics.md must state the depositor share ' + depositorPct);
  assert.ok(countOccurrences(text, capPct) >= 1, 'tokenomics.md must state the hard cap ' + capPct);
  assert.ok(countOccurrences(text, tipPct) >= 1, 'tokenomics.md must state the harvest tip ' + tipPct);
});

test('(c) guarantees.md states the 90/10 split within the MAX_FEE_BPS cap', () => {
  const text = docs['guarantees.md'];
  const lower = text.toLowerCase();
  assert.ok(countOccurrences(lower, 'max_fee_bps = ' + econ.maxFeeBps) >= 1,
    'guarantees.md must carry the literal cap: MAX_FEE_BPS = ' + econ.maxFeeBps);
  assert.ok(countOccurrences(text, initialPct) >= 1, 'guarantees.md must state the initial protocol fee ' + initialPct);
  assert.ok(countOccurrences(text, depositorPct) >= 1, 'guarantees.md must state the depositor share ' + depositorPct);
  assert.ok(countOccurrences(text, capPct) >= 1, 'guarantees.md must state the hard cap ' + capPct);
  assert.ok(countOccurrences(text, tipPct) >= 1, 'guarantees.md must state the harvest tip ' + tipPct);
});

test('(c) every doc quoting MAX_FEE_BPS pairs it with the configured cap percent', () => {
  for (const file of docFiles) {
    if (docs[file].indexOf('MAX_FEE_BPS') === -1) { continue; }
    assert.ok(
      countOccurrences(docs[file], capPct) >= 1,
      file + ' quotes MAX_FEE_BPS without stating its ' + capPct + ' value'
    );
  }
});

// ---- (d) APR methodology formula form -------------------------------------------

const OLD_TVL_SHARE_PHRASES = [
  'harvester LP value',   // superseded 2026-08-30 numerator (LP value ÷ target vault TVL)
  'target vault TVL',     // superseded denominator pin phrasing
  'TVL share',            // TVL-share voice
  'share of TVL'
];

test('(d) methodology.md formula is the ratified liquidity-share form', () => {
  const text = docs['methodology.md'];
  assert.ok(countOccurrences(text, 'liquidity-share') >= 1, 'methodology.md must name the liquidity-share form');
  assert.ok(countOccurrences(text, '(L_pos ÷ L_pool)') >= 1, 'methodology.md must carry the L_pos ÷ L_pool leg');
  assert.ok(countOccurrences(text, '(pool TVL ÷ vault TVL)') >= 1, 'methodology.md must carry the pool TVL ÷ vault TVL leg');
  assert.ok(countOccurrences(text, 'the final leg is ' + finalLeg) >= 1,
    'methodology.md must state the post-fee final leg ' + finalLeg + ' (1 − protocolFeeBpsInitial)');
  for (const phrase of OLD_TVL_SHARE_PHRASES) {
    assert.strictEqual(
      countOccurrences(text.toLowerCase(), phrase.toLowerCase()), 0,
      'methodology.md carries superseded TVL-share phrasing "' + phrase + '" — the ratified form is pool net × (L_pos/L_pool) × (pool TVL/vault TVL) × (1 − fee)'
    );
  }
});

test('(d) not-guaranteed.md verbal formula keeps the liquidity-share leg', () => {
  const text = docs['not-guaranteed.md'];
  assert.ok(countOccurrences(text, 'share of pool liquidity') >= 1,
    'not-guaranteed.md verbal formula must carry the harvester share-of-pool-liquidity leg');
  for (const phrase of OLD_TVL_SHARE_PHRASES) {
    assert.strictEqual(
      countOccurrences(text.toLowerCase(), phrase.toLowerCase()), 0,
      'not-guaranteed.md carries superseded TVL-share phrasing "' + phrase + '"'
    );
  }
});

// ---- (e) brand separation + no promise language ----------------------------------

test('(e) no doc carries VIBE mentions or promise language', () => {
  const banned = ['vibe', 'guaranteed returns', 'risk-free', 'ownerless'];
  for (const file of docFiles) {
    const lower = docs[file].toLowerCase();
    for (const phrase of banned) {
      assert.strictEqual(
        countOccurrences(lower, phrase), 0,
        file + ' carries banned language "' + phrase + '" — brand separation is absolute and the docs promise nothing'
      );
    }
  }
});

// ---- (f) chain identity + endpoints ----------------------------------------------

test('(f) every "chain ID N" claim in a doc equals the configured chain', () => {
  assert.strictEqual(config.chain.id, 4663, 'config chain id moved — re-check every chain-ID claim in the docs');
  for (const file of docFiles) {
    const re = /chain ID (\d+)/gi;
    let m;
    while ((m = re.exec(docs[file])) !== null) {
      assert.strictEqual(
        m[1], String(config.chain.id),
        file + ' claims chain ID ' + m[1] + ' but config pins ' + config.chain.id
      );
    }
  }
});

test('(f) run-it-yourself.md quotes the configured RPC, explorer and pool fee tier', () => {
  const text = docs['run-it-yourself.md'];
  assert.ok(countOccurrences(text, config.rpc.endpoints[0]) >= 1,
    'run-it-yourself.md must quote the pinned public RPC ' + config.rpc.endpoints[0]);
  assert.ok(countOccurrences(text, config.chain.explorerBase) >= 1,
    'run-it-yourself.md must quote the pinned explorer ' + config.chain.explorerBase);
  assert.ok(countOccurrences(text, 'fee tier ' + config.pools.spyWeth500.feeTier) >= 1,
    'run-it-yourself.md must quote the pinned fee tier ' + config.pools.spyWeth500.feeTier);
});

test('(f) both address-quoting docs name site/js/config.js as the pin source', () => {
  assert.ok(countOccurrences(docs['guarantees.md'], 'site/js/config.js') >= 1,
    'guarantees.md must cite site/js/config.js as where the deployed addresses are pinned');
  assert.ok(countOccurrences(docs['run-it-yourself.md'], 'site/js/config.js') >= 1,
    'run-it-yourself.md must cite site/js/config.js as where the canonical addresses are pinned');
});
