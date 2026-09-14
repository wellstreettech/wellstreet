'use strict';
// WS-VAULT-DASHBOARD battery (2026-09-13) — the G2 read-only surface:
// the #vault dashboard strip, the three-fee-lane explainer and the
// governance tape.
//
// Layers pinned here:
//   (a) the G1-extended vault.js governance read layer — the LIVE
//       readyAt(bytes32) read (src/WellstreetTimelock.sol:37: queue() sets
//       the mapping entry, cancel()/execute() delete it → 0 = no longer
//       queued) + the PURE status/date derivations, fail-closed end to end;
//   (b) main.js's pure dashboard helpers (WS.vaultUi — the WS.wow/WS.stats
//       test-seam pattern), booted under a LOADING document stub so init()
//       never runs and the module-scope seam is all we take;
//   (c) the index.html contract — the verbatim fee-lane line EXACTLY ONCE,
//       the kill-list greps at 0, the static first paint carrying the
//       honest em-dash register (never a fabricated number), the section
//       numbering contract (vault 05 / stats 06 / docs 07 — each numeral
//       exactly once, the flow.test.js count pins preserved), and the
//       JS-assigned-explorer-link rule (no absolute external href in the
//       new section's static markup);
//   (d) the motion budget — style.css still ships exactly FOUR keyframe
//       blocks (agent-first.test.js's pin; this battery re-asserts it so a
//       future edit fails in THIS file too, not only there).
//
// Dependency-free node:test + node:assert + node:fs (house style).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SITE = path.join(__dirname, '..', 'site');

// The boot stub MUST precede the main.js require: readyState 'loading' +
// a no-op addEventListener defers init() forever, so the module-scope work
// (the WS.stats / WS.wow / WS.vaultUi seams) is all that runs — no RPC, no
// timers, no DOM writes.
global.document = {
  readyState: 'loading',
  addEventListener: function () { /* init deferred — never fires here */ }
};

require(path.join(SITE, 'js', 'abi.js'));      // populates globalThis.WS.abi
require(path.join(SITE, 'js', 'config.js'));   // populates globalThis.WS.config
const vault = require(path.join(SITE, 'js', 'vault.js'));
require(path.join(SITE, 'js', 'main.js'));     // boots to the seams only
const ui = global.WS.vaultUi;

const html = fs.readFileSync(path.join(SITE, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(SITE, 'css', 'style.css'), 'utf8');
const mainSrc = fs.readFileSync(path.join(SITE, 'js', 'main.js'), 'utf8');

// Config-truth fixtures (config.roamStack.governance — the 2026-09-13 pins).
const cfg = global.WS.config;
const P3A_ID = cfg.roamStack.governance.queued[0].id;
const TL_ADDR = cfg.roamStack.timelock;
const READY_A = Math.floor(Date.UTC(2026, 8, 15, 9, 46, 26) / 1000); // 2026-09-15 09:46:26 UTC

function hexWord(v) { return '0x' + BigInt(v).toString(16).padStart(64, '0'); }

function stubClient(impl) {
  const calls = [];
  return {
    calls: calls,
    call: async function (method, params) {
      calls.push({ method: method, to: params[0].to, data: params[0].data });
      return impl(method, params);
    },
    batch: async function (list) {
      const out = [];
      for (const c of list) { out.push(await this.call(c.method, c.params)); }
      return out;
    }
  };
}

// ---------------- (a) governanceStatus: the PURE queue-state derivation ----

test('governanceStatus: readyAt in the future reads "queued" (bigint + string forms)', () => {
  const now = READY_A - 60;
  assert.strictEqual(vault.governanceStatus(BigInt(READY_A), now), 'queued');
  assert.strictEqual(vault.governanceStatus(String(READY_A), now), 'queued', 'string words coerce');
});

test('governanceStatus: the delay passed reads "executable" — execute is permissionless', () => {
  const now = READY_A + 1;
  assert.strictEqual(vault.governanceStatus(BigInt(READY_A), now), 'executable');
  assert.strictEqual(vault.governanceStatus(BigInt(READY_A), READY_A), 'executable', 'readyAt == now is executable, not queued');
});

test('governanceStatus: readyAt 0 reads "not-queued" (cancel()/execute() DELETE the entry)', () => {
  assert.strictEqual(vault.governanceStatus(0n, READY_A), 'not-queued');
  assert.strictEqual(vault.governanceStatus('0x0', READY_A), 'not-queued');
});

test('governanceStatus: any unreadable input reads "unknown" — never a guessed state', () => {
  assert.strictEqual(vault.governanceStatus(null, READY_A), 'unknown');
  assert.strictEqual(vault.governanceStatus(undefined, READY_A), 'unknown');
  assert.strictEqual(vault.governanceStatus(BigInt(READY_A), null), 'unknown');
  assert.strictEqual(vault.governanceStatus(BigInt(READY_A), undefined), 'unknown');
  assert.strictEqual(vault.governanceStatus('not-a-number', READY_A), 'unknown');
  assert.strictEqual(vault.governanceStatus(-5n, READY_A), 'unknown', 'negative readyAt is not a state');
});

// ---------------- (a) formatReadyAt: the live word -> UTC date --------------

test('formatReadyAt: the live word renders "YYYY-MM-DD HH:MM" in UTC', () => {
  assert.strictEqual(vault.formatReadyAt(BigInt(READY_A)), '2026-09-15 09:46');
  assert.strictEqual(vault.formatReadyAt(String(READY_A)), '2026-09-15 09:46');
});

test('formatReadyAt: absent/zero/negative reads render null — the date row drops, never a guess', () => {
  assert.strictEqual(vault.formatReadyAt(null), null);
  assert.strictEqual(vault.formatReadyAt(undefined), null);
  assert.strictEqual(vault.formatReadyAt(0n), null);
  assert.strictEqual(vault.formatReadyAt(-1n), null);
  assert.strictEqual(vault.formatReadyAt('junk'), null);
});

// ---------------- (a) readTimelockReadyAt: the fail-closed live read --------

test('readTimelockReadyAt: the selector is derived from the signature (no hardcoded selector)', () => {
  const sel = vault.timelockSelectors().readyAt;
  assert.match(sel, /^0x[0-9a-fA-F]{8}$/, 'a 4-byte selector');
  assert.strictEqual(sel, require(path.join(SITE, 'js', 'abi.js')).selectorOf('readyAt(bytes32)'));
});

test('readTimelockReadyAt: a live word decodes to bigint seconds', async () => {
  const client = stubClient(() => hexWord(READY_A));
  const out = await vault.readTimelockReadyAt(client, TL_ADDR, P3A_ID);
  assert.strictEqual(out, BigInt(READY_A));
  assert.strictEqual(client.calls.length, 1, 'exactly one eth_call');
  assert.strictEqual(client.calls[0].data, vault.timelockSelectors().readyAt + hexWord(P3A_ID).slice(2),
    'the full 32-byte id rides the calldata');
});

test('readTimelockReadyAt: empty payload / thrown call / failed decode all render null', async () => {
  assert.strictEqual(await vault.readTimelockReadyAt(stubClient(() => '0x'), TL_ADDR, P3A_ID), null);
  assert.strictEqual(await vault.readTimelockReadyAt(stubClient(() => { throw new Error('boom'); }), TL_ADDR, P3A_ID), null);
  assert.strictEqual(await vault.readTimelockReadyAt(stubClient(() => '0x' + 'ff'.repeat(8)), TL_ADDR, P3A_ID), null,
    'a short (non-word) payload is not a figure');
});

test('readTimelockReadyAt: the gates issue NO call — PENDING timelock, malformed id', async () => {
  const client = stubClient(() => hexWord(READY_A));
  assert.strictEqual(await vault.readTimelockReadyAt(client, cfg.PENDING_DEPLOY, P3A_ID), null,
    'a PENDING timelock address never reaches the wire');
  assert.strictEqual(await vault.readTimelockReadyAt(client, TL_ADDR, '0x1234'), null,
    'a truncated id never reaches the wire (ids are FULL 32-byte values, never ellipses)');
  assert.strictEqual(await vault.readTimelockReadyAt(client, TL_ADDR, null), null);
  assert.strictEqual(client.calls.length, 0, 'the guard branches issued zero eth_calls');
});

// ---------------- (b) WS.vaultUi: the dashboard helpers ----------------------

test('WS.vaultUi seam ships (the module booted to its seams under the loading stub)', () => {
  assert.ok(ui && typeof ui === 'object', 'WS.vaultUi exists');
  assert.ok(typeof ui.groupExact === 'function');
  assert.ok(typeof ui.composeCapValue === 'function');
  assert.ok(typeof ui.govIdShort === 'function');
});

test('groupExact: the house thousands glyph on the integer part; fraction untouched', () => {
  assert.strictEqual(ui.groupExact('12473.59'), '12,473.59');
  assert.strictEqual(ui.groupExact('25000'), '25,000');
  assert.strictEqual(ui.groupExact('0'), '0', 'a verified zero is a figure');
  assert.strictEqual(ui.groupExact('12.47359'), '12.47359');
  assert.strictEqual(ui.groupExact('1000000'), '1,000,000');
});

test('groupExact: fail-closed — junk, empty, negative, null never become 0', () => {
  assert.strictEqual(ui.groupExact(null), null);
  assert.strictEqual(ui.groupExact(undefined), null);
  assert.strictEqual(ui.groupExact(''), null);
  assert.strictEqual(ui.groupExact('12.4.5'), null);
  assert.strictEqual(ui.groupExact('-5'), null, 'normalize never emits negatives; a negative is not a figure');
  assert.strictEqual(ui.groupExact('abc'), null);
});

test('composeCapValue: used/cap from two reads; either missing renders null (never a half figure)', () => {
  assert.strictEqual(ui.composeCapValue('12.47359', '25000'), '12.47359 / 25,000');
  assert.strictEqual(ui.composeCapValue(null, '25000'), null);
  assert.strictEqual(ui.composeCapValue('12.47359', null), null);
  assert.strictEqual(ui.composeCapValue(null, null), null);
});

test('govIdShort: a 32-byte id truncates with the ellipsis glyph (never full-width in the tape)', () => {
  const short = ui.govIdShort(P3A_ID);
  assert.ok(short.length < P3A_ID.length, 'shorter than the full id');
  assert.ok(short.indexOf('…') !== -1, 'the truncation glyph register');
  assert.strictEqual(short, P3A_ID.slice(0, 10) + '…' + P3A_ID.slice(-6));
  assert.strictEqual(ui.govIdShort('0x1234'), '0x1234', 'short strings pass through');
  assert.strictEqual(ui.govIdShort(null), null);
});

// ---------------- (c) the index.html contract --------------------------------

const VERBATIM_SPLIT = '90% to depositors · 10% burns $WELL · 0% to anyone else';

test('the verbatim fee-lane line ships EXACTLY ONCE in index.html and nowhere in site/js', () => {
  const count = (html.match(new RegExp(VERBATIM_SPLIT.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  assert.strictEqual(count, 1, 'the split line is single-sourced (the G4 no-duplication gate)');
  assert.ok(mainSrc.indexOf(VERBATIM_SPLIT) === -1, 'main.js writes states, never re-states the split line');
});

test('kill-list greps: zero hype language in index.html', () => {
  for (const phrase of ['guaranteed', 'risk-free', 'passive income', 'auto yield', 'no owner']) {
    assert.ok(!new RegExp(phrase, 'i').test(html), 'kill-list phrase absent: ' + phrase);
  }
});

test('the #vault section ships: numbered 05, muted caption, nav link, block-sub flywheel paragraph', () => {
  assert.ok(html.indexOf('<section class="block" id="vault">') !== -1, 'the section ships');
  assert.ok(html.indexOf('<a href="#vault">The Vault</a>') !== -1, 'the nav link ships');
  assert.ok(html.indexOf('You deposit USDG. Shares are the claim') !== -1, 'the flywheel paragraph ships');
  const idx = (n) => (html.match(new RegExp('class="index">' + n + '</span>', 'g')) || []).length;
  assert.strictEqual(idx('04'), 1, 'flow is still the only 04 (flow.test.js pin preserved)');
  assert.strictEqual(idx('05'), 1, 'the vault is the only 05 (flow.test.js count pin preserved)');
  assert.strictEqual(idx('06'), 1, 'stats renumbered to 06 (flow.test.js count pin preserved)');
  assert.strictEqual(idx('07'), 1, 'docs renumbered to 07');
});

test('the three fee lanes ship as a compact list, never mixed, with the honest pre-$WELL note', () => {
  for (const lane of ['lane 1 — vault LP fees:', 'lane 2 — trading fees on $WELL:', 'lane 3 — the protocol\'s cut:']) {
    assert.strictEqual((html.match(new RegExp(lane.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1,
      'exactly one occurrence: ' + lane);
  }
  assert.ok(html.indexOf('The burn leg starts when $WELL launches — checkable on-chain') !== -1,
    'the honest pre-$WELL note ships verbatim');
});

test('the dashboard strip: fee lane status labels the 90/10 constants; 10% lane PARKED, not hidden', () => {
  assert.ok(html.indexOf('<span class="st-value doto">90 / 10</span>') !== -1, 'the immutable constants render');
  assert.ok(html.indexOf('the 10% burn leg is PARKED until $WELL launches, not earning, checkable on-chain') !== -1,
    'the parked lane is labeled, not hidden');
});

test('the static first paint carries the honest em-dash register — zero fabricated figures', () => {
  for (const id of ['va-tvl', 'va-price', 'va-coverage', 'va-cap', 'va-deposits', 'va-idle']) {
    const m = new RegExp('id="' + id + '" title="[^"]*">([^<]*)</span>').exec(html);
    assert.ok(m, 'the cell ships: ' + id);
    assert.strictEqual(m[1], '—', 'the static paint of #' + id + ' is the em-dash, never a number');
  }
});

test('the static cells name their read (the provenance tooltip convention)', () => {
  for (const pair of [['va-tvl', 'totalAssets()'], ['va-price', 'convertToAssets'], ['va-coverage', 'backingCoverage()'],
    ['va-cap', 'DEPOSIT_CAP()'], ['va-deposits', 'depositsPaused()'], ['va-idle', 'idleBook()']]) {
    const m = new RegExp('id="' + pair[0] + '" title="([^"]*)"').exec(html);
    assert.ok(m && m[1].indexOf(pair[1]) !== -1, '#' + pair[0] + ' names its read: ' + pair[1]);
  }
});

test('the governance tape ships with a static no-JS fallback line and the JS render mount', () => {
  assert.ok(html.indexOf('id="gov-tape-rows"') !== -1, 'the render mount ships');
  assert.ok(html.indexOf('CallQueued/CallExecuted events are public and replayable') !== -1,
    'the fallback states the replayable record');
  assert.ok(html.indexOf('every owner action, dated + replayable') !== -1, 'the tape label ships');
});

test('the new section ships ZERO absolute external hrefs (explorer links are JS-assigned)', () => {
  const section = html.slice(html.indexOf('<section class="block" id="vault">'),
    html.indexOf('<!-- ============ MOVEMENT 4'));
  assert.ok(section.indexOf('href="http') === -1, 'no absolute href in the vault section markup');
  assert.ok(section.indexOf('href="//') === -1, 'no protocol-relative href');
});

// ---------------- (c/d) source contracts -------------------------------------

test('main.js queries the new ids only through variable-mediated consts (the registry-rider idiom)', () => {
  assert.ok(/\$\('(va|gov)-[a-z-]*'\)/.test(mainSrc) === false, 'no quoted literal $() query for a vault id');
  assert.ok(/getElementById\('(va|gov)-/.test(mainSrc) === false, 'no quoted literal getElementById for a vault id');
  for (const id of Object.values(ui.VAULT_ID)) {
    assert.ok(html.indexOf('id="' + id + '"') !== -1, 'every queried id ships in index.html: ' + id);
  }
});

test('the dashboard refresh rides the EXISTING house loop — no new timer, no new cadence', () => {
  assert.ok(mainSrc.indexOf('await refreshVaultDashboard();') !== -1, 'refreshCards calls the dashboard pass');
  const block = mainSrc.slice(mainSrc.indexOf('WS-VAULT-DASHBOARD'), mainSrc.indexOf('4. Docs tab'));
  assert.ok(block.indexOf('setInterval') === -1, 'no new interval inside the dashboard block');
  assert.ok(block.indexOf("fetch(") === -1 && block.indexOf('/api/') === -1,
    'the dashboard block is serverless-clean (browser eth_calls only)');
});

test('the motion budget: style.css still ships exactly FOUR keyframe blocks — the dashboard added none', () => {
  assert.strictEqual((css.match(/@keyframes/g) || []).length, 4,
    'exactly four @keyframes (ledger stamp + flow pulse + the user-ratified toast pair)');
  assert.ok(css.indexOf('.gov-status--executable') !== -1, 'the governance status register ships');
  assert.ok(css.indexOf('.gov-tape') !== -1, 'the tape container ships');
});

// ---------------- G4 gates regression pin (2026-09-13) ----------------
// The first probe battery caught govRow building the status/meta/tx cell
// (v) and returning the row WITHOUT appending it — the tape shipped
// label-only in every state. Pin the append so the orphan class can never
// quietly return.

test('G4 regression: govRow appends the status/meta cell to the row (the v-orphan fix)', () => {
  const fnStart = mainSrc.indexOf('function govRow(');
  assert.ok(fnStart !== -1, 'govRow ships');
  const fnEnd = mainSrc.indexOf('function renderGovernance', fnStart);
  const body = mainSrc.slice(fnStart, fnEnd);
  assert.ok(/r\.appendChild\(v\)/.test(body), 'the v cell is appended to the row before return');
  const returnAt = body.lastIndexOf('return r;');
  const appendAt = body.indexOf('r.appendChild(v);');
  assert.ok(appendAt !== -1 && returnAt !== -1 && appendAt < returnAt,
    'the append precedes the return (an append after return is dead code)');
});

test('G4 regression: the 44px tap floor holds on the money-amount inputs and the plain nav links', () => {
  const inputRule = css.slice(css.indexOf('.field input[type="text"]'), css.indexOf('.field input:disabled'));
  assert.ok(/min-height:\s*44px/.test(inputRule), '.field inputs carry the 44px floor');
  const baseNav = css.slice(css.indexOf('.site-nav a {'), css.indexOf('.site-nav a:hover'));
  assert.ok(/min-height:\s*44px/.test(baseNav), 'the base .site-nav a rule carries the 44px floor (all-width parity with nav-cta)');
});

// ------------------------------------------------------------------
// WS-VAULT-GATES second pass (2026-09-14) — the terminal-state pins.
// The G4 probe walk caught runFlow's finally erasing every flow-terminal
// status (pre-check refusals, wallet rejections, the confirmed receipt +
// its explorer link) through an unconditional renderWidgetState(); and the
// gov-tape 'tx ↗' explorer links measuring 31x15, under the 44px tap floor.
// ------------------------------------------------------------------

test('G4 second pass: runFlow re-renders with keepStatus — the flow terminal state outlives the finally', () => {
  const fnStart = mainSrc.indexOf('async function runFlow(');
  assert.ok(fnStart !== -1, 'runFlow ships');
  const fnEnd = mainSrc.indexOf('function linkTx(', fnStart);
  const body = mainSrc.slice(fnStart, fnEnd);
  const finallyAt = body.lastIndexOf('} finally {');
  assert.ok(finallyAt !== -1, 'runFlow keeps its finally');
  const finallyBody = body.slice(finallyAt);
  assert.ok(/renderWidgetState\(true\)/.test(finallyBody),
    'the finally re-render passes keepStatus (a bare renderWidgetState() would wipe the terminal state)');
});

test('G4 second pass: renderWidgetState(keepStatus) returns BEFORE the status write', () => {
  const fnStart = mainSrc.indexOf('function renderWidgetState(');
  assert.ok(fnStart !== -1, 'renderWidgetState ships');
  const fnEnd = mainSrc.indexOf('function appendWidgetTruthRows(', fnStart);
  const body = mainSrc.slice(fnStart, fnEnd);
  const keepAt = body.indexOf('if (keepStatus) {');
  assert.ok(keepAt !== -1, 'the keepStatus early-return ships');
  const statusAt = body.indexOf("widgetStatus('Not connected");
  assert.ok(statusAt !== -1, 'the unconditional status chain still ships for full renders');
  assert.ok(keepAt < statusAt, 'the keepStatus return precedes the status write (else the wipe survives)');
});

test('G4 second pass: the tx-link carries the 44px tap floor without a layout shift', () => {
  const ruleAt = css.indexOf('.tx-link {');
  assert.ok(ruleAt !== -1, 'the .tx-link rule ships');
  const rule = css.slice(ruleAt, css.indexOf('}', ruleAt));
  assert.ok(/display:\s*inline-block/.test(rule), 'inline-block so the vertical padding paints (an inline anchor rect excludes it)');
  assert.ok(/padding:\s*15px\s+8px/.test(rule), 'the padding expands the tap area to ~45x47');
  assert.ok(/margin:\s*-15px\s+-8px/.test(rule), 'the negative margins keep the line rhythm unchanged');
});

test('G4 second pass: the connect failure path renders with keepStatus — the guard reason persists', () => {
  const fnStart = mainSrc.indexOf('async function connectUsing(');
  assert.ok(fnStart !== -1, 'connectUsing ships');
  const fnEnd = mainSrc.indexOf('function showWalletPicker(', fnStart);
  const body = mainSrc.slice(fnStart, fnEnd);
  const catchAt = body.indexOf("widgetStatus('Connect failed: '");
  assert.ok(catchAt !== -1, 'the failure write ships');
  const tail = body.slice(catchAt);
  assert.ok(/renderWidgetState\(true\)/.test(tail),
    'the catch re-render passes keepStatus (a full render replaces the reason with the generic Not-connected line)');
});
