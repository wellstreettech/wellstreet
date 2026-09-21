'use strict';
// WS-VAULT-DEPOSIT (2026-09-13) — pins for the deposit/redeem money path's
// reconciliation to the LIVE RoamVault.
//
// The flow machinery (connect → approve → deposit, redeem/withdraw with live
// previews, receipt polling, explorer links) is the pre-existing wallet-write
// surface in site/js/main.js + site/js/wallet.js — this goal did NOT rebuild
// it. What changed is the TARGET: vaults[0] (the config entry the widget
// driver vaultCfg() consumes) is now the live RoamVault instead of the empty,
// wind-down-declared SPY flagship. These pins hold that reconciliation shut:
//
//   - the money path targets config.roamStack.vault (the live, seeded, deposit-
//     open vault — P0/P1/P2 executed 2026-09-13, 12.473590 USDG at 1:1)
//   - the asset is USDG at its REAL 6 decimals (the 18-dec fallback would have
//     mis-scaled every deposit by 10^12 — the money-correctness pin)
//   - the share symbol is the LIVE contract symbol wsrUSDG (cast call 09-13)
//   - the write calldata shapes are the exact ERC-4626 forms wallet.js sends
//   - the static first paint names the same vault the JS targets (noscript
//     honesty): no stale ws-SPY/SPY deposit strings remain
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../site/js/abi.js');
const WS = globalThis.WS;
const abi = WS.abi;
const amount = require('../site/js/amount.js');
const wallet = require('../site/js/wallet.js');
const config = require('../site/js/config.js');

const RV = '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86';
const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168';
const USER = '0x62f0bCd442a70cb86c0E2Ed7F66022a1f6A046E1';

// ---------------- the reconciliation: the money path targets the LIVE vault ----

test('config: vaults[0] IS the RoamVault — the widget driver and roamStack agree', () => {
  assert.strictEqual(config.vaults[0].vault, RV);
  assert.strictEqual(config.vaults[0].vault, config.roamStack.vault);
  assert.strictEqual(config.vaults[0].asset, USDG);
  assert.strictEqual(config.vaults[0].asset, config.roamStack.usdg);
});

test('config: the RoamVault entry carries no pool/chainlinkFeed keys (the conditional reads degrade honestly)', () => {
  assert.strictEqual(config.vaults[0].pool, undefined);
  assert.strictEqual(config.vaults[0].chainlinkFeed, undefined);
});

test('config: the share symbol is the LIVE contract symbol wsrUSDG (cast call 2026-09-13)', () => {
  assert.strictEqual(config.vaults[0].shareSymbol, 'wsrUSDG');
});

test('config: the wind-down SPY flagship stays as a family entry (reads context, not the money path)', () => {
  assert.strictEqual(config.vaults[1].id, 'ws-spy');
  assert.notStrictEqual(config.vaults[1].vault, config.vaults[0].vault);
});

test('config: USDG token pinned at its REAL 6 decimals — the 18-dec fallback would mis-scale deposits ×10^12', () => {
  const t = config.tokens.usdg;
  assert.strictEqual(t.address, USDG);
  assert.strictEqual(t.symbol, 'USDG');
  assert.strictEqual(t.decimals, 6);
});

// ---------------- money math: 6-dec parseUnits ---------------------------------

test('parseUnits: 1.5 USDG at 6 decimals → 1500000n base units (BigInt, no float)', () => {
  const r = amount.parseUnits('1.5', 6);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 1500000n);
});

test('parseUnits: 12.47359 USDG → the live seed figure exactly', () => {
  const r = amount.parseUnits('12.47359', 6);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 12473590n);
});

test('parseUnits: at-most-6-decimals rule — a 7th decimal is rejected, never truncated', () => {
  const r = amount.parseUnits('1.0000001', 6);
  assert.strictEqual(r.ok, false);
  assert.match(r.reason, /decimal place/);
});

test('parseUnits: garbage, negative, exponent, empty — all fail with a human reason', () => {
  for (const bad of ['abc', '-1', '1e5', '', '1,5', '1 5']) {
    const r = amount.parseUnits(bad, 6);
    assert.strictEqual(r.ok, false, bad);
    assert.strictEqual(typeof r.reason, 'string');
  }
});

// ---------------- calldata shapes: the exact ERC-4626 write forms --------------

test('approve calldata: selector 0x095ea7b3 + spender + amount (the vault as spender)', () => {
  const data = abi.encodeCall('approve(address,uint256)', [RV, 1500000n]);
  assert.strictEqual(data, '0x095ea7b3' + '0'.repeat(24) + RV.slice(2).toLowerCase() +
    BigInt(1500000n).toString(16).padStart(64, '0'));
});

test('deposit calldata: selector 0x6e553f65 + assets + receiver (RoamVault ERC-4626 form)', () => {
  const data = abi.encodeCall('deposit(uint256,address)', [12473590n, USER]);
  assert.ok(data.startsWith('0x6e553f65'));
  assert.ok(data.includes('0'.repeat(24) + USER.slice(2).toLowerCase()));
  assert.strictEqual(abi.decodeUint(data.slice(10), 0), 12473590n);
});

test('redeem/withdraw calldata selectors match the verified ERC-4626 signatures', () => {
  assert.strictEqual(abi.selectorOf('redeem(uint256,address,address)'), '0xba087652');
  assert.strictEqual(abi.selectorOf('withdraw(uint256,address,address)'), '0xb460af94');
  assert.strictEqual(abi.selectorOf('previewRedeem(uint256)'), '0x4cdad506');
  assert.strictEqual(abi.selectorOf('previewWithdraw(uint256)'), '0x0a28a477');
});

test('wallet module: the four write flows + receipt polling exist (the machinery this goal reconciles)', () => {
  for (const fn of ['approve', 'deposit', 'withdraw', 'redeem', 'waitForReceipt', 'receiptOutcome', 'connect', 'describeError']) {
    assert.strictEqual(typeof wallet[fn], 'function', fn);
  }
});

// ---------------- static first paint: noscript users see the same vault --------

const html = fs.readFileSync(path.join(__dirname, '..', 'site', 'index.html'), 'utf8');

test('index.html: the deposit/redeem first paint names wsrUSDG — no stale ws-SPY deposit strings', () => {
  assert.ok(html.includes('<span class="fleet-pair">wsrUSDG</span>'));
  assert.strictEqual((html.match(/<span class="share-symbol">wsrUSDG<\/span>/g) || []).length, 2);
  assert.ok(html.includes('<label for="dep-amount">Amount (USDG)</label>'));
  assert.ok(!html.includes('Amount (SPY)'));
  assert.ok(!html.includes('<span class="share-symbol">ws-SPY</span>'));
});

test('index.html: the fee-split fact is the RoamVault lanes — never the old protocol split', () => {
  assert.ok(html.includes('90% depositors · 10% burns $WELL · 0% to anyone else'));
  assert.ok(!html.includes('10% protocol · cap 20%'));
});

test('index.html: the fleet intro is the dead-simple promise — SPY wind-down copy gone, RoamVault live (FLEET-SIMPLE-EARN 2026-09-14)', () => {
  // the SPY flagship reconciliation sentence retired with the flagship itself —
  // the intro is now the one-vault promise; the wind-down copy is asserted ABSENT
  assert.ok(!html.includes('The SPY flagship is winding down'), 'the SPY wind-down sentence is gone');
  assert.ok(!html.includes('winding down'), 'no SPY wind-down copy remains anywhere in index.html');
  assert.ok(html.includes('RoamVault (wsrUSDG)'), 'the live vault is named in the intro');
  assert.ok(html.includes("90% of the roamer's trading fees flow to depositors automatically"), 'the dead-simple promise: 90% of fees flow to depositors');
  assert.ok(html.includes('earnings start at the first harvest'), 'the no-harvests honesty line survives the rewrite');
  assert.ok(html.includes('id="vaults-launch-fact"'), 'the protected launch-fact seam survives');
});

// ---------------- G3 completion pass (2026-09-13): the guided money path -------
//
// The completion pass closes what §G3 named that the landed reconciliation
// lacked: the Max button, the deposit-side preview (previewDeposit), the
// decimals-correct formatters (12-dec share chassis / 6-dec USDG), the
// allowance-skip, the maxDeposit cap guard, the wsrUSDG redeem-unit label,
// and the pre-P3-B idle note in the unbound capital-state sentence.

const vault = require('../site/js/vault.js');

function word(v) { return '0x' + BigInt(v).toString(16).padStart(64, '0'); }

// minimal eth_call router (mirrors the injected client contract of rpc.js)
function routeClient(routes) {
  return {
    call: async function (method, params) {
      const to = params[0].to.toLowerCase();
      const sel = params[0].data.slice(0, 10);
      const hit = routes.find(function (r) {
        return r.to.toLowerCase() === to && r.sel === sel &&
          (r.fullData === undefined || params[0].data === r.fullData);
      });
      if (!hit) { throw new Error('unrouted call ' + to + ' ' + sel); }
      return hit.raw;
    },
    batch: async function () { throw new Error('not used by these readers'); }
  };
}

test('vault.readShareDecimals: reads the vault\'s own decimals() — the 12-dec RoamVault chassis', async () => {
  const client = routeClient([{ to: RV, sel: abi.selectorOf('decimals()'), raw: word(12) }]);
  assert.strictEqual(await vault.readShareDecimals(client, RV), 12);
});

test('vault.readShareDecimals: a failed/empty read is null (fail closed, never a wrong scale)', async () => {
  const client = routeClient([{ to: RV, sel: abi.selectorOf('decimals()'), raw: '0x' }]);
  assert.strictEqual(await vault.readShareDecimals(client, RV), null);
});

test('vault.previewDeposit: previewDeposit(uint256) eth_call with the assets arg, decodes shares', async () => {
  let seen = null;
  const client = {
    call: async function (method, params) {
      seen = params[0].data;
      return word(12473590000000n);   // 12.47359 wsrUSDG at the 12-dec chassis
    }
  };
  const shares = await vault.previewDeposit(client, RV, 12473590n);
  assert.strictEqual(shares, 12473590000000n);
  assert.ok(seen.startsWith(abi.selectorOf('previewDeposit(uint256)')), 'previewDeposit selector');
  assert.ok(seen.endsWith(BigInt(12473590n).toString(16).padStart(64, '0')), 'assets arg');
});

test('vault.previewDeposit: null on a failed read — the row renders unavailable, never a figure', async () => {
  const client = routeClient([]); // everything unrouted → throws
  assert.strictEqual(await vault.previewDeposit(client, RV, 12473590n), null);
});

test('vault.readMaxDeposit: maxDeposit(address) with the wallet arg (RoamVault.sol:290 ignores it)', async () => {
  let seen = null;
  const client = {
    call: async function (method, params) {
      seen = params[0].data;
      return word(24987526410n);   // cap − totalAssets, live 09-13
    }
  };
  const room = await vault.readMaxDeposit(client, RV, USER);
  assert.strictEqual(room, 24987526410n);
  assert.ok(seen.startsWith(abi.selectorOf('maxDeposit(address)')));
  assert.ok(seen.includes('0'.repeat(24) + USER.slice(2).toLowerCase()));
});

test('vault.readMaxDeposit: zero room is a real state (cap reached / deposits paused), not an error', async () => {
  const client = routeClient([{ to: RV, sel: abi.selectorOf('maxDeposit(address)'), raw: word(0) }]);
  assert.strictEqual(await vault.readMaxDeposit(client, RV, USER), 0n);
});

test('money formatting: 12-dec shares and 6-dec assets format at their OWN scales — the 18-dec assumption mis-stated both', () => {
  // the live 1:1 chassis: 12.47359 wsrUSDG = 12473590000000 raw at 12 dec
  // (the formatter TRUNCATES the displayed fraction — never rounds up)
  assert.strictEqual(amount.formatUnits(12473590000000n, 12, 4), '12.4735');
  // the legacy 18-dec default would have printed 0.0000124735 → "0" — the lie this closes
  assert.notStrictEqual(amount.formatUnits(12473590000000n, 18, 4), '12.4736');
  // the asset side: 12.473590 USDG = 12473590 raw at 6 dec
  assert.strictEqual(amount.formatUnits(12473590n, 6, 6), '12.47359');
});

test('max-fill round trip: formatUnits(bal, 6, 6) comma-stripped re-parses to the SAME BigInt (no float)', () => {
  const bal = 15441860n;   // 15.441860 USDG
  const s = amount.formatUnits(bal, 6, 6).replace(/,/g, '');
  const r = amount.parseUnits(s, 6);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, bal);
});

test('capital-state sentences: the pre-P3-B idle note rides the unbound state — deposits earn from the next fee harvest after capital deploys', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');
  const m = mainSrc.match(/var DEPLOYMENT_SENT = \{([\s\S]*?)\};/);
  assert.ok(m, 'DEPLOYMENT_SENT block found');
  const block = m[1];
  const unbound = (block.match(/unbound: '([^']*)'/) || [])[1];
  assert.ok(unbound && unbound.indexOf('all capital is idle by construction') !== -1, 'idle-by-construction truth');
  assert.ok(unbound.indexOf('deposits earn from the next fee harvest after capital deploys') !== -1,
    'the honest earning note (truthful, not alarming)');
  for (const key of ['idle', 'deployed', 'unknown']) {
    assert.ok(new RegExp(key + ": '").test(block), key + ' has its own sentence');
  }
  // exactly once — the idle/deployed states carry their own truths, no duplication
  assert.strictEqual((mainSrc.match(/deposits earn from the next fee harvest after capital deploys/g) || []).length, 1);
});

test('redeem unit ownership: the shared input\'s shares label names the LIVE share symbol — no generic "Amount (shares)" anywhere', () => {
  assert.ok(html.includes('<label for="red-amount" id="red-amount-label">Amount (wsrUSDG)</label>'));
  assert.ok(!html.includes('Amount (shares)'));
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');
  assert.ok(!mainSrc.includes("'Amount (shares)'"), 'main.js builds the label from the config share symbol');
  assert.ok(mainSrc.includes("(vCfg && vCfg.shareSymbol) || 'shares'"), 'setRedeemAction reads vaultCfg().shareSymbol');
});

test('deposit panel: the Max button + the deposit preview row ship in the first paint', () => {
  assert.ok(html.includes('<button type="button" class="btn" id="btn-dep-max" disabled>Max</button>'));
  assert.ok(html.includes('<p class="flag" id="deposit-preview" aria-live="polite"></p>'));
});

test('money path guards: the allowance-skip and the maxDeposit cap guard live in the deposit flow', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');
  assert.ok(mainSrc.includes('Allowance already covers '), 'the skip states the covered amount');
  assert.ok(mainSrc.includes('WS.vault.readMaxDeposit('), 'the deposit branch guards on the vault\'s own maxDeposit');
  assert.ok(mainSrc.includes('not accepting deposits right now (cap reached or deposits paused)'), 'zero-room honest state');
  // the safe default: a FAILED allowance read never skips
  assert.ok(mainSrc.includes('read failed — approve anyway (the safe default)'));
});

// ---------------- G3 exit path (2026-09-13): the redeemWithMinOut pins ---------
//
// The redeemer-bounded exit (RoamVault.sol:337): redeem shares but revert when
// the payout lands below the CALLER's per-call minPayout — never a vault-held
// floor (a stale global floor would be a redemption trap; the contract's own
// doc says so, and its check is per-call: `minPayout > 0 && payout <
// minPayout` reverts PayoutBelowMin). Selector 0x4fed4f32 was cross-verified
// with `cast sig 'redeemWithMinOut(uint256,address,address,uint256)'` on
// 2026-09-13; these pins hold the site's calldata to that exact shape.

test('redeemWithMinOut calldata: selector 0x4fed4f32 (cast sig cross-verified) + the 4-arg RoamVault.sol:337 shape', () => {
  // the site's own keccak must reproduce the cast-verified selector — if these
  // drift apart the calldata ships wrong and every floor redeem reverts
  assert.strictEqual(abi.selectorOf('redeemWithMinOut(uint256,address,address,uint256)'), '0x4fed4f32');
  const data = abi.encodeCall('redeemWithMinOut(uint256,address,address,uint256)',
    [12473590000000n, USER, USER, 5250000n]);
  assert.ok(data.startsWith('0x4fed4f32'), 'the min-out selector leads the calldata');
  // word order is the contract's parameter order: shares, receiver, owner, minPayout
  const words = data.slice(10);
  assert.strictEqual(BigInt('0x' + words.slice(0, 64)), 12473590000000n, 'word0 = shares (12-dec chassis)');
  assert.strictEqual(words.slice(64, 128), '0'.repeat(24) + USER.slice(2).toLowerCase(), 'word1 = receiver');
  assert.strictEqual(words.slice(128, 192), '0'.repeat(24) + USER.slice(2).toLowerCase(), 'word2 = owner');
  assert.strictEqual(BigInt('0x' + words.slice(192, 256)), 5250000n, 'word3 = minPayout (asset 6-dec scale)');
});

test('wallet.redeemWithMinOut: eth_sendTransaction to the VAULT with the floor riding the calldata — per-call, never a stored floor', async () => {
  const sent = [];
  const stub = {
    request: async function (m) {
      if (m.method === 'eth_accounts') { return [USER]; }
      if (m.method === 'eth_chainId') { return config.chain.idHex; }
      if (m.method === 'eth_sendTransaction') { sent.push(m.params[0]); return '0xdeadbeef'; }
      throw new Error('unexpected method ' + m.method);
    }
  };
  global.window = { ethereum: stub };
  try {
    const hash = await wallet.redeemWithMinOut(config, config.vaults[0].vault,
      12473590000000n, USER, USER, 5250000n);
    assert.strictEqual(hash, '0xdeadbeef');
    assert.strictEqual(sent.length, 1, 'one send, no pre-flight writes');
    assert.strictEqual(sent[0].to, config.vaults[0].vault, 'the call targets the vault, not the token');
    assert.strictEqual(sent[0].value, '0x0', 'no value rides a redeem');
    assert.ok(sent[0].data.startsWith('0x4fed4f32'), 'the min-out selector rides the wire');
    const words = sent[0].data.slice(10);
    assert.strictEqual(BigInt('0x' + words.slice(0, 64)), 12473590000000n, 'shares from the ARG (per-call)');
    assert.strictEqual(BigInt('0x' + words.slice(192, 256)), 5250000n, 'minPayout from the ARG (per-call — no vault state consulted)');
    const walletSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'wallet.js'), 'utf8');
    assert.ok(walletSrc.includes('never a vault-held global floor'), 'the floor-lifetime truth is stated where the calldata is built');
  } finally { delete global.window; }
});

test('min-out floor parse: the floor is an ASSET (USDG) amount at the 6-dec scale — never the 12-dec share scale', () => {
  // the floor is denominated in what the vault PAYS OUT (assets), so it parses
  // at the asset scale — the same scale previewRedeem quotes in
  const r = amount.parseUnits('5.25', 6);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.value, 5250000n);
  // sub-dollar floors (the honest slippage class) are representable
  assert.strictEqual(amount.parseUnits('0.05', 6).value, 50000n);
  // a floor typed at the share scale would be a 10^6 overfloor — every redeem refused
  assert.notStrictEqual(amount.parseUnits('5.25', 6).value, amount.parseUnits('5.25', 12).value);
  // main.js parses min-out through parseInput (tokenDecimals = the asset), NOT parseSharesInput
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');
  const b0 = mainSrc.indexOf("kind === 'redeem-min'");
  const branch = mainSrc.slice(b0, mainSrc.indexOf('} catch (err) {', b0));
  assert.ok(branch.includes("await parseSharesInput('red-amount')"), 'the redeem amount is SHARES at the live scale');
  assert.ok(branch.includes("var minRaw = parseInput('min-out');"), 'the floor is an ASSET amount');
  assert.ok(!branch.includes("parseSharesInput('min-out')"), 'the floor is never parsed as shares');
});

test('redeem-min pre-check: quote-below-floor refuses with the honest reason; a FAILED quote read never blocks the send', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');
  const b0 = mainSrc.indexOf("kind === 'redeem-min'");
  const branch = mainSrc.slice(b0, mainSrc.indexOf('} catch (err) {', b0));
  // the quote is the vault's own previewRedeem at the SAME share amount being redeemed
  assert.ok(branch.includes('var quote = await WS.vault.previewRedeem(state.client, v.vault, amtM.value)'),
    'previewRedeem(shares) is the quote source');
  // the pre-check mirrors the contract's revert condition (payout < minPayout)
  assert.ok(branch.includes('quote < minRaw.value'), 'refuse exactly when the CURRENT quote is below the floor');
  assert.ok(branch.includes('is below your floor'), 'the refusal names the relationship');
  assert.ok(branch.includes('Lower the floor or retry when the rate moves.'), 'the honest next step, never a fake success');
  // fail-open anatomy, ORDER-pinned: quote read → empty catch → send. A failed
  // quote read falls through to the wallet (the chain is the final arbiter and
  // a below-floor redeem reverts honestly on-chain) — never a silent block.
  const iQuote = branch.indexOf('WS.vault.previewRedeem(');
  const iCatch = branch.indexOf('catch (e) { /* quote read failed — let the chain decide */ }');
  const iSend = branch.indexOf('WS.wallet.redeemWithMinOut(');
  assert.ok(iQuote !== -1 && iCatch > iQuote && iSend > iCatch, 'quote → catch (fail-open) → send');
  // the send carries the parsed floor, receiver/owner = the connected account
  assert.ok(branch.includes('WS.wallet.redeemWithMinOut(cfg, v.vault, amtM.value, state.wallet.account, state.wallet.account, minRaw.value)'),
    'the 4-arg form wired to the parsed inputs');
  // an empty/zero floor is refused with the honest redirect — silently degrading
  // to a plain redeem would change the money semantics without the user choosing them
  assert.ok(branch.includes("'Min out: ' + minRaw.reason"), 'an unparseable floor surfaces the parse reason');
  // LEDGER-PRESS 2026-09-20: carrier re-valued to the ',' form (the prose em-dash ban on rendered strings); same refusal role.
  assert.ok(branch.includes('Enter a min-out floor greater than zero, or use Redeem, which needs no floor.'),
    'a zero floor is refused, not silently downgraded');
});

test('redeem-min gates: the floor input + button ride the REDEEM-side gates (wallet + deployed) with disabled-with-reason — never the deposit pause', () => {
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'main.js'), 'utf8');
  const g0 = mainSrc.indexOf('WS-VAULT-DEPOSIT G3 exit path (2026-09-13): the min-out floor');
  const gate = mainSrc.slice(g0, mainSrc.indexOf('WS-VAULT-DEPOSIT G3 completion', g0));
  assert.ok(gate.includes("var minOutInput = $('min-out');"), 'the floor input is gated, never hidden');
  assert.ok(gate.includes("var minOutBtn = $('btn-redeem-min');"), 'the floor-redeem button is gated, never hidden');
  assert.ok(gate.includes('minOutInput.disabled = !inputsReady;') && gate.includes('minOutBtn.disabled = !inputsReady;'),
    'both ride the shared redeem-side readiness flag');
  assert.ok(gate.includes("'Connect a wallet first.'"), 'no-wallet reason');
  assert.ok(gate.includes("'Vault contract pending deploy.'"), 'pre-deploy reason');
  // LEDGER-PRESS 2026-09-20: title carrier re-valued to the ':' form (prose em-dash ban); same semantics.
  assert.ok(gate.includes('Redeem with a payout floor: the redeem reverts below it.'),
    'the connected-state title carries the floor semantics');
  // an exit is an exit: the redeem-side gates never consult the deposit pause
  assert.ok(!gate.includes('depositsPaused'), 'the exit path never gates on the deposit pause');
});

test('index.html: the min-out surface ships in the first paint — field, button, and the honest floor signage', () => {
  // LEDGER-PRESS 2026-09-20: label/note carriers re-valued ('·' / ':') per the prose em-dash ban; same signage roles.
  assert.ok(html.includes('<label for="min-out" id="min-out-label">Min out (USDG) · payout floor</label>'),
    'the label names the ASSET denomination');
  assert.ok(html.includes('<input type="text" id="min-out" inputmode="decimal" placeholder="0.0" disabled>'),
    'the floor input ships (disabled until the gates open)');
  assert.ok(html.includes('<button type="button" class="btn" id="btn-redeem-min" disabled>Redeem w/ floor</button>'),
    'the floor-redeem button ships (44px .btn, disabled until the gates open)');
  assert.ok(html.includes('per-call, never vault-held'), 'the markup comment states the floor lifetime');
  assert.ok(html.includes('The floor reverts this redeem if the payout lands below it: the chain is the final arbiter.'),
    'the honest slippage note');
  assert.ok(html.includes('Leave it empty and use Redeem for the no-floor exit.'),
    'the no-floor exit stays discoverable');
});

test('site-tests registry: the min-out ids ride the render.test.js REGISTRY RIDER array (the 55-id add)', () => {
  const rider = fs.readFileSync(path.join(__dirname, 'render.test.js'), 'utf8');
  for (const id of ['min-out', 'btn-redeem-min', 'min-out-note']) {
    assert.ok(rider.includes("'" + id + "'"), 'registry add: ' + id);
  }
  assert.ok(rider.includes('-> 55: the redeemer-bounded'), 'the dated registry-add note names the exit path');
});


// ------------------------------------------------------------------
// WS-VAULT-GATES second pass (2026-09-14) — the connect chain-id pin.
// The G4 probe walk caught connect() reporting the PRE-switch chain id when
// the wallet auto-switched ('Connected on chain 1' while the wallet sat on
// 4663) — the status line named a chain the wallet had already left.
// ------------------------------------------------------------------

test('connect re-reads eth_chainId after the switch — the reported chain is the POST-switch chain', () => {
  const walletSrc = fs.readFileSync(path.join(__dirname, '..', 'site', 'js', 'wallet.js'), 'utf8');
  const fnStart = walletSrc.indexOf('async function connect(');
  assert.ok(fnStart !== -1, 'connect ships');
  const fnEnd = walletSrc.indexOf('async function ensureChain(', fnStart);
  const body = walletSrc.slice(fnStart, fnEnd);
  const guardAt = body.indexOf('Number.parseInt(chainIdHex, 16) !== cfg.chain.id');
  assert.ok(guardAt !== -1, 'the wrong-chain guard ships');
  const ensureAt = body.indexOf('await ensureChain(p, cfg);', guardAt);
  assert.ok(ensureAt !== -1, 'the switch rides the guard');
  const rereadAt = body.indexOf("await p.request({ method: 'eth_chainId' })", ensureAt);
  assert.ok(rereadAt > ensureAt, 'eth_chainId is RE-READ after ensureChain (the pre-switch id must not ride out)');
});
