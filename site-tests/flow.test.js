'use strict';
// FLOW_SECTION test battery (FLOW_SECTION_2026-09-08) — the live-wired flywheel
// (#flow) driven through BOTH deploy-seam states against the REAL modules:
//   - waiting state: every seam absent / PENDING_DEPLOY → the static paint IS
//     the render, NO RPC call is issued (the isDeployed-gate precedent), no
//     fabricated figure and no dressed-up zero anywhere;
//   - flipped-live state: the same config seams carry real addresses → the
//     SAME DOM nodes mutate to measured values with ZERO markup change (the
//     module only writes textContent/attributes — no element is ever created
//     or appended), the waiting chip hides, and the 10% burn lane DELEGATES
//     to WS.statsPage's Burned-event machinery (spied, not re-implemented);
//   - the FEES honesty rule: a zero Harvested-event count renders '—' + the
//     empty-engine sentence, NEVER a zero dressed as measured;
//   - the no-1.00-fabrication rule: an empty vault (totalSupply() = 0) keeps
//     the share-price cell at '—' even though convertToAssets(1e18) returns
//     a vacuous 1.00;
//   - wiring-table completeness (all six nodes + their waiting registers),
//     kill-list cleanliness of every new string, and the section markup.
// Dependency-free node:test + node:assert (house charter). The REAL abi.js and
// stats.js load under a document stub whose getElementById starts EMPTY, so
// both modules' self-init early-return and the fixtures attach per-test.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FLOW_JS = path.join(ROOT, 'site', 'js', 'flow.js');
const INDEX_HTML = path.join(ROOT, 'site', 'index.html');

// ---- document stub (empty at require time → both self-inits early-return) ----
const fixture = {}; // id → element
globalThis.document = {
  readyState: 'complete',
  getElementById(id) { return fixture[id] || null; },
};

function el(cls) {
  const node = {
    className: cls || '',
    attrs: {},
    hidden: false,
    _text: '',
    parentElement: null,
    set textContent(v) { node._text = String(v == null ? '' : v); },
    get textContent() { return node._text; },
    setAttribute(k, v) { node.attrs[k] = String(v); },
    getAttribute(k) { return (k in node.attrs) ? node.attrs[k] : null; },
    removeAttribute(k) { delete node.attrs[k]; },
  };
  return node;
}

// attach EVERY id flow.js writes (the static markup's wiring surface) + the
// section surface itself. The wiring cells are SEEDED from the real index.html
// static paint (initial textContent + title attribute) — the static paint IS
// the pending state, so the waiting tests assert the shipped markup, not an
// invented stub.
globalThis.WS = {};
const abi = require('../site/js/abi.js');
const stats = require('../site/js/stats.js'); // real — the burn lane delegates to it
const flow = require('../site/js/flow.js');

const INDEX_SRC = fs.readFileSync(INDEX_HTML, 'utf8');
const FLOW_AT = INDEX_SRC.indexOf('<section class="block" id="flow">');
const FLOW_SLICE = INDEX_SRC.slice(FLOW_AT, INDEX_SRC.indexOf('MOVEMENT 4 — THE BURN LEDGER'));

fixture['flow'] = el('block');
for (const id of Object.values(flow.ID)) {
  const node = el('span');
  const m = new RegExp('id="' + id + '"([^>]*)>([^<]*)<').exec(FLOW_SLICE);
  assert.ok(m, 'the flow cell ships in index.html and parses: ' + id);
  node.textContent = m[2];
  const t = /title="([^"]*)"/.exec(m[1]);
  if (t) { node.setAttribute('title', t[1]); }
  fixture[id] = node;
}

function snapText() {
  const out = {};
  for (const [k, id] of Object.entries(flow.ID)) { out[k] = fixture[id].textContent; }
  return out;
}
function snapshotNodes() {
  const out = {};
  for (const [k, id] of Object.entries(flow.ID)) { out[k] = fixture[id]; }
  return out;
}

// ---- the RPC seam: a stub client factory that COUNTS creations (the
// isDeployed-gate assertion: a pre-deploy page never touches the chain) ----
let clientCreations = 0;
let respond = null; // (method, params) → response, set per test
globalThis.WS.rpc = {
  createRpcClient() {
    clientCreations += 1;
    return {
      async call(method, params) { return respond(method, params); },
      async batch(calls) { return calls.map((c) => respond(c.method, c.params)); },
    };
  },
};

// config — seams flipped per test
function setConfig(contracts) {
  globalThis.WS.config = {
    PENDING_DEPLOY: 'PENDING_DEPLOY',
    contracts: contracts,
    rpc: { endpoints: ['http://stub'], attemptsPerEndpoint: 1, backoffBaseMs: 1, backoffCapMs: 2, timeoutMs: 5, batchMaxCalls: 16 },
  };
}

const addr = (b) => '0x' + String(b).repeat(20); // 40 hex chars — the isDeployed shape
const VAULT = addr('a1');
const ROAMER = addr('b2');
const ALLOWLIST = addr('c3');
const HARVESTER = addr('d4');
const USDG = addr('e5');

function hexWord(n) { return BigInt(n).toString(16).padStart(64, '0'); }

// the flipped-live responder: routes eth_call by (to, selector) using the REAL
// abi selectors; getLogs answers per address.
function liveRespond(method, params) {
  if (method === 'eth_getLogs') {
    const q = params[0];
    if (q.address === HARVESTER) { return [{ data: '0x' + hexWord(0) }, { data: '0x' + hexWord(0) }]; } // 2 harvest events
    if (q.address === ROAMER) {
      return [{ data: '0x' + hexWord(1500000) + hexWord('1500000000000000000') }]; // word0 bought, word1 burned = 1.5e18
    }
    return [];
  }
  if (method === 'eth_call') {
    const { to, data } = params[0];
    const sel = data.slice(0, 10);
    const u = (v) => '0x' + hexWord(v);
    if (to === VAULT) {
      if (sel === abi.selectorOf('totalAssets()')) { return u('5000000'); }          // 5.00 (6 dec)
      if (sel === abi.selectorOf('asset()')) { return '0x' + '0'.repeat(24) + USDG.slice(2); }
      if (sel === abi.selectorOf('convertToAssets(uint256)')) { return u('1230000'); } // 1.23 per share
      if (sel === abi.selectorOf('totalSupply()')) { return u('4987500'); }
      if (sel === abi.selectorOf('DEPOSIT_CAP()')) { return u('250000000000'); }       // 250,000 (6 dec)
      if (sel === abi.selectorOf('DEPOSIT_CAP_CEILING()')) { return u('250000000000'); }
    }
    if (to === USDG && sel === abi.selectorOf('decimals()')) { return u('6'); }
    if (to === ROAMER && sel === abi.selectorOf('openKeyCount()')) { return u('3'); }
    if (to === ALLOWLIST && sel === abi.selectorOf('bookCount()')) { return u('9'); }
  }
  throw new Error('stub client: no route for ' + method);
}

// burn-lane delegation spies (wrap the REAL statsPage helpers)
let burnSumCalls = 0;
let burnFmtCalls = 0;
const realSum = stats.sumBurnField;
const realFmt = stats.fmtWell;
function armDelegationSpies() {
  burnSumCalls = 0; burnFmtCalls = 0;
  globalThis.WS.statsPage = {
    sumBurnField: function (logs, w) { burnSumCalls += 1; return realSum(logs, w); },
    fmtWell: function (wei) { burnFmtCalls += 1; return realFmt(wei); },
  };
}

// ------------------------------------------------------------------
test('wiring table: all six brief nodes, exact waiting registers, every cell ships in the markup', () => {
  assert.deepStrictEqual(Object.keys(flow.WIRING).sort(),
    ['burn', 'depositors', 'fees', 'roamer', 'users', 'vault'].sort(),
    'the wiring table covers exactly the brief\'s six nodes');
  assert.strictEqual(flow.WIRING.users.waiting, 'waiting — RoamVault build wave');
  assert.strictEqual(flow.WIRING.vault.waiting, 'waiting — RoamVault build wave');
  assert.strictEqual(flow.WIRING.depositors.waiting, 'waiting — RoamVault build wave');
  assert.strictEqual(flow.WIRING.roamer.waiting, 'waiting — not yet broadcast');
  assert.strictEqual(flow.WIRING.burn.waiting, 'waiting for the first sweep',
    'the burn lane keeps the existing copy');
  assert.strictEqual(flow.WIRING.fees.waiting, null,
    'the FEES seam is LIVE today — its empty register is a sentence, not a waiting cause');
  assert.strictEqual(flow.WIRING.fees.read.indexOf('eth_getLogs') !== -1, true);
  assert.strictEqual(flow.WIRING.burn.read.indexOf('statsPage') !== -1, true,
    'the burn lane declares the stats.js delegation');
  // every wiring cell id ships in index.html's flow section
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  for (const id of Object.values(flow.ID)) {
    assert.ok(html.includes('id="' + id + '"'), 'flow cell ships in index.html: ' + id);
  }
});

// ------------------------------------------------------------------
test('section markup: id=flow, head 04, muted caption, seal, renumbered 04/05/06', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  assert.ok(html.includes('<section class="block" id="flow">'), 'the flow section ships');
  assert.ok(html.includes('wired to the chain — not to a slide'), 'the muted caption ships');
  assert.ok(html.includes('DEV TAKE: 0'), 'the seal ships');
  const idx = (n) => (html.match(new RegExp('class="index">' + n + '</span>', 'g')) || []).length;
  assert.strictEqual(idx('04'), 1, 'flow is the only 04');
  assert.strictEqual(idx('05'), 1, 'stats renumbered to 05');
  assert.strictEqual(idx('06'), 1, 'docs renumbered to 06');
  // placement: flow sits between the #fleet close and the burn-ledger comment
  const fleetEnd = html.indexOf('</section>', html.indexOf('id="fleet-surface"'));
  const flowAt = html.indexOf('<section class="block" id="flow">');
  const statsComment = html.indexOf('MOVEMENT 4 — THE BURN LEDGER');
  assert.ok(fleetEnd !== -1 && flowAt > fleetEnd && flowAt < statsComment,
    'flow sits between #fleet and the MOVEMENT 4 comment');
  assert.ok(/<script defer src="js\/flow.js"><\/script>/.test(html), 'flow.js ships with a defer script tag');
});

// ------------------------------------------------------------------
test('variable-mediated ids: flow.js issues zero quoted-literal id queries (the registry-rider contract)', () => {
  const src = fs.readFileSync(FLOW_JS, 'utf8');
  assert.ok(!/\$\('([A-Za-z0-9_-]+)'\)/.test(src), "no $('literal') id queries");
  assert.ok(!/getElementById\('([A-Za-z0-9_-]+)'\)/.test(src), 'no getElementById(\'literal\') queries');
  assert.ok(!/querySelector(?:All)?\('#([A-Za-z0-9_-]+)'/.test(src), "no querySelector('#literal') queries");
});

// ------------------------------------------------------------------
test('waiting state: seams absent → the static paint stands, NO RPC issued, nothing fabricated', async () => {
  setConfig({}); // no seams at all
  clientCreations = 0;
  const nodes = snapshotNodes();
  const before = snapText();
  // the seeded STATIC paint already carries the honest waiting register:
  assert.strictEqual(before.vaultValue, '—');
  assert.strictEqual(before.roamerValue, '—');
  assert.strictEqual(before.roamerBooks, '—');
  assert.strictEqual(before.feesValue, '—');
  assert.strictEqual(before.depValue, '—');
  assert.strictEqual(before.burnValue, '—');
  assert.strictEqual(before.usersCap, '—');
  assert.strictEqual(before.vaultSent, 'waiting — RoamVault build wave');
  assert.strictEqual(before.roamerSent, 'waiting — not yet broadcast');
  assert.strictEqual(before.feesSent, 'the flagship engine is live; its vault is empty');
  assert.ok(before.burnSent.indexOf('the burn ledger below reads the same events') === 0, 'UI_LOOP_3 W3b: shipped burn line cross-references the ledger (the node itself is the link — no nested anchors)');
  assert.strictEqual(fixture[flow.ID.usersChip].hidden, false, 'the vault-seam chip ships visible while waiting');
  // every waiting figure's static tooltip discloses the never-estimated contract
  for (const k of ['usersCap', 'vaultValue', 'roamerValue', 'roamerBooks', 'depValue', 'burnValue']) {
    const tip = fixture[flow.ID[k]].getAttribute('title') || '';
    assert.ok(/never estimated|would be vacuous|not be dressed/.test(tip),
      'the static waiting tooltip discloses honesty on ' + k + ': ' + tip);
  }
  await flow.refreshAll();
  assert.strictEqual(clientCreations, 0,
    'a pre-deploy page never touches the chain (isDeployed-gate precedent)');
  assert.deepStrictEqual(snapText(), before, 'the module writes NOTHING while pending — the static paint IS the waiting register');
  // no fabricated figure anywhere: no cell renders a bare zero or a 0-prefixed figure
  for (const k of Object.keys(before)) {
    assert.ok(!/^0([.,\s]|$)/.test(String(before[k]).trim()), 'no zero dressed as data in ' + k + ': ' + before[k]);
  }
  // zero markup change: the exact same node objects carry the register
  for (const k of Object.keys(nodes)) { assert.strictEqual(snapshotNodes()[k], nodes[k]); }
});

// ------------------------------------------------------------------
test('waiting state: PENDING_DEPLOY seam values are undeployed too (still no RPC)', async () => {
  setConfig({ roamVault: 'PENDING_DEPLOY', roamer: 'PENDING_DEPLOY', harvester: 'PENDING_DEPLOY' });
  clientCreations = 0;
  const before = snapText();
  await flow.refreshAll();
  assert.strictEqual(clientCreations, 0, 'PENDING_DEPLOY seams issue no RPC call');
  assert.deepStrictEqual(snapText(), before, 'the static paint stands untouched');
});

// ------------------------------------------------------------------
test('flipped-live: the same nodes render measured values, the chip hides, burn delegates to stats.js', async () => {
  setConfig({ roamVault: VAULT, roamer: ROAMER, roamAllowlist: ALLOWLIST, harvester: HARVESTER });
  respond = liveRespond;
  armDelegationSpies();
  clientCreations = 0;
  const nodes = snapshotNodes();
  await flow.refreshAll();
  const t = snapText();
  assert.ok(clientCreations >= 1, 'the WS.rpc client factory built a client');
  assert.strictEqual(t.vaultValue, '5.00', 'TVL renders from totalAssets() at the asset\'s measured decimals');
  assert.strictEqual(t.vaultUnit, 'tvl');
  assert.strictEqual(t.usersCap, '250,000.00', 'DEPOSIT_CAP renders at the measured decimals');
  assert.strictEqual(fixture[flow.ID.usersChip].hidden, true, 'the waiting chip hides once live — a chip that outlives its state lies');
  assert.strictEqual(t.roamerValue, '3', 'openKeyCount() renders');
  assert.strictEqual(t.roamerBooks, '9', 'allowlist bookCount() renders');
  assert.strictEqual(t.roamerSent, 'measured on-chain — replayable from any RPC client');
  assert.strictEqual(t.feesValue, '2', 'the Harvested-event count renders measured');
  assert.strictEqual(t.depValue, '1.23', 'the share price renders from convertToAssets(1e18)');
  assert.strictEqual(t.burnValue, realFmt(1500000000000000000n), 'the burn figure is fmtWell\'s output');
  assert.strictEqual(t.burnSent, 'measured from the roamer\'s Burned events — the buyback-and-burn tail, replayable on chain 4663');
  assert.strictEqual(burnSumCalls, 1, 'the burn read DELEGATES to stats.sumBurnField');
  assert.strictEqual(burnFmtCalls, 1, 'the burn figure DELEGATES to stats.fmtWell');
  // zero markup change: the same node objects were mutated, never replaced
  for (const k of Object.keys(nodes)) { assert.strictEqual(snapshotNodes()[k], nodes[k]); }
});

// ------------------------------------------------------------------
test('zero markup change is structural: flow.js never creates or appends an element', () => {
  const src = fs.readFileSync(FLOW_JS, 'utf8');
  assert.ok(!src.includes('createElement'), 'no createElement — write-only module');
  assert.ok(!src.includes('appendChild'), 'no appendChild — write-only module');
  assert.ok(!src.includes('innerHTML'), 'no innerHTML — write-only module');
});

// ------------------------------------------------------------------
test('FEES honesty: a zero harvest count renders the empty-engine sentence, never a zero', async () => {
  setConfig({ harvester: HARVESTER });
  respond = (method, params) => {
    if (method === 'eth_getLogs') { return []; }
    throw new Error('unexpected ' + method);
  };
  await flow.refreshAll();
  const t = snapText();
  assert.strictEqual(t.feesValue, '—', 'zero events → the honest dash, never a dressed-up 0');
  assert.strictEqual(t.feesSent, 'the flagship engine is live; its vault is empty');
});

// ------------------------------------------------------------------
test('FEES fail-closed: a failed getLogs renders the error sentence', async () => {
  setConfig({ harvester: HARVESTER });
  respond = () => { throw new Error('rpc down'); };
  await flow.refreshAll();
  assert.strictEqual(snapText().feesSent, 'the flagship harvest read failed (RPC) — nothing is estimated here');
  assert.strictEqual(snapText().feesValue, '—');
});

// ------------------------------------------------------------------
test('no 1.00 fabrication: an empty vault (totalSupply 0) keeps the share price at "—"', async () => {
  setConfig({ roamVault: VAULT });
  respond = (method, params) => {
    if (method === 'eth_call') {
      const sel = params[0].data.slice(0, 10);
      const u = (v) => '0x' + hexWord(v);
      if (sel === abi.selectorOf('totalAssets()')) { return u('0'); } // a measured zero TVL (empty vault)
      if (sel === abi.selectorOf('asset()')) { return '0x' + '0'.repeat(24) + USDG.slice(2); }
      if (sel === abi.selectorOf('convertToAssets(uint256)')) { return u('1000000000000000000'); } // the vacuous 1.00
      if (sel === abi.selectorOf('totalSupply()')) { return u('0'); }
      if (sel === abi.selectorOf('DEPOSIT_CAP()')) { return u('250000000000'); }
      if (sel === abi.selectorOf('DEPOSIT_CAP_CEILING()')) { return u('250000000000'); }
      if (params[0].to === USDG && sel === abi.selectorOf('decimals()')) { return u('6'); }
    }
    throw new Error('unexpected route');
  };
  await flow.refreshAll();
  const t = snapText();
  assert.strictEqual(t.depValue, '—', 'the vacuous 1.00 must not render');
  assert.strictEqual(t.depSent, 'the vault has no shares outstanding yet — a share price would be vacuous, so none renders');
  assert.strictEqual(t.vaultValue, '0.00', 'a MEASURED zero TVL on a live vault is honest data, not a fabrication');
});

// ------------------------------------------------------------------
test('burn fail-closed: zero Burned events keep the waiting register; a failed read renders the error sentence', async () => {
  setConfig({ roamer: ROAMER });
  respond = (method, params) => {
    if (method === 'eth_getLogs') { return []; }
    throw new Error('unexpected ' + method);
  };
  await flow.refreshAll();
  assert.strictEqual(snapText().burnValue, '—', 'no sweeps yet → the dash');
  assert.strictEqual(snapText().burnSent, 'waiting for the first sweep'); /* roamer-seam-present, zero events: the module rewrites the line with the waiting const — W3b only dedupes the PRE-roamer static paint */

  respond = () => { throw new Error('rpc down'); };
  await flow.refreshAll();
  assert.strictEqual(snapText().burnSent, 'the burn read failed (RPC) — nothing is estimated here');
  assert.strictEqual(snapText().burnValue, '—');
});

// ------------------------------------------------------------------
test('vault fail-closed: a failing batch demotes all three vault-fed nodes to their error registers', async () => {
  setConfig({ roamVault: VAULT });
  respond = () => { throw new Error('rpc down'); };
  await flow.refreshAll();
  const t = snapText();
  assert.strictEqual(t.vaultSent, 'the vault read failed (RPC) — nothing is estimated here');
  assert.strictEqual(t.vaultValue, '—');
  assert.strictEqual(t.depValue, '—');
  assert.strictEqual(fixture[flow.ID.usersChip].hidden, false, 'the chip returns while the figure is unavailable');
});

// ------------------------------------------------------------------
test('pure formatter: measured decimals only, base-unit fallback, no guessed scale', () => {
  assert.strictEqual(flow.fmtAmount(5000000n, 6), '5.00');
  assert.strictEqual(flow.fmtAmount(250000000000n, 6), '250,000.00');
  assert.strictEqual(flow.fmtAmount(1500000000000000000n, 18), '1.50');
  assert.strictEqual(flow.fmtAmount(1234567n * 1000000000000000000n, 18), '1.2M',
    'the compact register is one-decimal (the stats.js fmtWell idiom)');
  assert.strictEqual(flow.fmtAmount(1234567n, null), '1,234,567', 'decimals unknown → raw base units, grouped');
  assert.strictEqual(flow.fmtAmount(0n, 6), '0.00', 'a measured zero formats as data');
  assert.strictEqual(flow.fmtAmount(-1n, 6), '—', 'negative → the dash');
  assert.strictEqual(flow.fmtAmount('5', 6), '—', 'non-bigint → the dash');
});

// ------------------------------------------------------------------
test('kill-list + no-claims: every new flow string is clean and present-tense', () => {
  const html = fs.readFileSync(INDEX_HTML, 'utf8');
  const flowAt = html.indexOf('<section class="block" id="flow">');
  const flowEnd = html.indexOf('MOVEMENT 4 — THE BURN LEDGER');
  const slice = html.slice(flowAt, flowEnd);
  assert.ok(slice.length > 0, 'the flow slice resolves');
  assert.ok(!/guaranteed|risk-free|auto yield|passive income/i.test(slice), 'no yield overclaim');
  assert.ok(!/ownerless|fully decentralized|trustless/i.test(slice), 'no decentralization overclaim');
  assert.ok(!/tokenized stocks/.test(slice), 'kill-list: the retired identity stays retired');
  assert.ok(!/S&amp;P|S&P/.test(slice), 'kill-list: no bare S&P');
  assert.ok(!/vibe/i.test(slice), 'kill-list: no cross-contamination');
  assert.ok(!/launched on Pons|will launch|launching soon|coming soon/i.test(slice),
    'no-claims: the $WELL launch stays present-tense');
  assert.ok(!/\$WELL is live|\$WELL was live/.test(slice), 'no-claims: $WELL is never claimed live');
  const src = fs.readFileSync(FLOW_JS, 'utf8');
  assert.ok(!/vibe/i.test(src), 'kill-list: no cross-contamination in flow.js');
  assert.ok(!/guaranteed|risk-free|passive income/i.test(src), 'no yield overclaim in flow.js');
});

// ---- UI_LOOP_3 W2/W3 riders (2026-09-10) ----
const fs3 = require('fs');
const path3 = require('path');
const html = fs3.readFileSync(path3.join(__dirname, '..', 'site', 'index.html'), 'utf8');
const css = fs3.readFileSync(path3.join(__dirname, '..', 'site', 'css', 'style.css'), 'utf8');
test('W2: flow nodes navigate and the discovery bridge exists', () => {
  assert.ok(/<a class="flow-node" href="#fleet">[\s\S]*?Roamer/.test(html), 'the Roamer node links to the fleet table');
  assert.ok(/<a class="flow-node flow-node--dep" href="#deposit">/.test(html), 'Depositors links to the deposit widget');
  assert.ok(/<a class="flow-node flow-node--burn" href="#stats">/.test(html), 'the burn node links to the ledger');
  assert.ok(/flow-discovery/.test(html), 'the position-params discovery bridge exists');
  assert.ok(!/router|flat fee|0\.0[0-9]%/i.test(html.slice(html.indexOf('flow-discovery'), html.indexOf('flow-discovery') + 400)), 'no fee/router promises near the discovery line');
});
test('W3c: the holder-loop arc ships desktop-only', () => {
  assert.ok(/<svg class="flow-loop"/.test(html), 'the rinse-repeat arc exists');
  assert.ok(/rinse · repeat/.test(html), 'the loop carries its own label');
  assert.ok(/@media \(max-width: 900px\) \{ \.flow-loop, \.flow-loop-label \{ display: none/.test(css), 'hidden at <=900 — the vertical read already carries order');
});
