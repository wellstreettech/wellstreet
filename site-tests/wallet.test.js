'use strict';
// wallet.js pure cores: eip-6963 provider-registry dedupe, receipt polling, and the
// receipt → honest-outcome mapping. The wallet EVENT wiring itself is browser-only;
// these tests pin the decision logic that money-flows depend on.
const test = require('node:test');
const assert = require('node:assert');

const wallet = require('../site/js/wallet.js');

function providerDetail(rdns, uuid, name) {
  return { info: { rdns: rdns, uuid: uuid, name: name || rdns }, provider: { fake: rdns } };
}

test('addProvider: keeps announced wallets, ignores malformed details', () => {
  let list = [];
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u1', 'MetaMask'));
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].info.name, 'MetaMask');
  // malformed announcements are dropped, never crash
  assert.strictEqual(wallet.addProvider(list, null), list);
  assert.strictEqual(wallet.addProvider(list, {}), list);
  assert.strictEqual(wallet.addProvider(list, { info: { rdns: 'x' } }), list);
  assert.strictEqual(wallet.addProvider(list, { provider: {} }), list);
});

test('addProvider: dedupes by (rdns, uuid); same rdns with a new uuid is a distinct wallet', () => {
  let list = [];
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u1'));
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u1')); // dup
  assert.strictEqual(list.length, 1);
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u2')); // second install
  assert.strictEqual(list.length, 2);
  list = wallet.addProvider(list, providerDetail('com.rabby', 'u1')); // other vendor
  assert.strictEqual(list.length, 3);
  // returns a NEW list — the announced list is never mutated in place
  assert.notStrictEqual(list, wallet.addProvider(list, providerDetail('new', 'u3')));
});

test('addProvider: an info missing rdns or uuid is malformed (dropped, never dedupe-collided)', () => {
  let list = [];
  list = wallet.addProvider(list, providerDetail('io.metamask', 'u1', 'MetaMask'));
  // info present but identity fields missing — a non-compliant announce must not
  // enter the registry, where two of them would collide on undefined===undefined
  assert.strictEqual(wallet.addProvider(list, { info: {}, provider: { fake: 1 } }), list);
  assert.strictEqual(wallet.addProvider(list, { info: { uuid: 'u2' }, provider: { fake: 2 } }), list);
  assert.strictEqual(wallet.addProvider(list, { info: { rdns: 'com.x' }, provider: { fake: 3 } }), list);
  assert.strictEqual(list.length, 1, 'malformed announces dropped, registry unchanged');
});

test('receiptOutcome: maps receipt to confirmed / reverted / unknown / not-mined', () => {
  assert.strictEqual(wallet.receiptOutcome({ status: '0x1', blockNumber: '0x5' }), 'confirmed');
  assert.strictEqual(wallet.receiptOutcome({ status: '0x01', blockNumber: '0x5' }), 'confirmed');
  assert.strictEqual(wallet.receiptOutcome({ status: 1 }), 'confirmed');
  assert.strictEqual(wallet.receiptOutcome({ status: '0x0' }), 'reverted');
  assert.strictEqual(wallet.receiptOutcome({ status: 0 }), 'reverted');
  assert.strictEqual(wallet.receiptOutcome({ blockNumber: '0x9' }), 'included-unknown-status');
  assert.strictEqual(wallet.receiptOutcome({ blockHash: '0xabc' }), 'included-unknown-status');
  assert.strictEqual(wallet.receiptOutcome({}), null);
  assert.strictEqual(wallet.receiptOutcome(null), null);
  assert.strictEqual(wallet.receiptOutcome(undefined), null);
  assert.strictEqual(wallet.receiptOutcome('receipt'), null);
});

function fakeClient(script) {
  let i = 0;
  const calls = [];
  return {
    calls: calls,
    call: async function (method, params) {
      assert.strictEqual(method, 'eth_getTransactionReceipt');
      calls.push(params[0]);
      const step = script[Math.min(i++, script.length - 1)];
      return step;
    }
  };
}

test('waitForReceipt: returns the receipt as soon as it is mined', async () => {
  const receipt = { status: '0x1', blockNumber: '0x64', blockHash: '0xh' };
  const client = fakeClient([null, null, receipt]);
  let slept = 0;
  const out = await wallet.waitForReceipt(client, '0xHASH', {
    intervalMs: 1,
    sleepFn: function () { slept++; return Promise.resolve(); }
  });
  assert.deepStrictEqual(out, receipt);
  assert.strictEqual(client.calls.length, 3);
  assert.strictEqual(slept, 2);
  assert.ok(client.calls.every(function (h) { return h === '0xHASH'; }));
});

test('waitForReceipt: null after the attempt budget — never a fabricated success', async () => {
  const client = fakeClient([null]);
  const out = await wallet.waitForReceipt(client, '0xHASH', {
    intervalMs: 1, maxAttempts: 4,
    sleepFn: function () { return Promise.resolve(); }
  });
  assert.strictEqual(out, null);
  assert.strictEqual(client.calls.length, 4);
});

test('waitForReceipt: an empty-object "receipt" is treated as pending, not mined', async () => {
  const client = fakeClient([{}, { status: '0x0' }]);
  const out = await wallet.waitForReceipt(client, '0xHASH', {
    intervalMs: 1,
    sleepFn: function () { return Promise.resolve(); }
  });
  assert.deepStrictEqual(out, { status: '0x0' });
  assert.strictEqual(client.calls.length, 2);
});

// MOBILE-WALLET-GUIDE + ALWAYS-CONNECT-ENTRY (2026-09-08, user reports on
// iPhone Safari): the entry button must be visible outside the collapsed
// flagship, and the guide must ship WITHOUT absolute external hrefs in the
// markup (the resource-gate scans href= as a load channel — deep links are
// assigned by main.js at show time).
test('wallet-connect is discoverable: persistent entry + iOS guide ship honest', () => {
  const fs = require('fs');
  const path = require('path');
  const site = path.join(__dirname, '..', 'site');
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(site, 'js', 'main.js'), 'utf8');
  assert.ok(html.includes('id="btn-connect-entry"'), 'the always-visible Connect entry exists at block 02 (all viewports)');
  assert.ok(html.includes('id="mobile-wallet-guide"'), 'the iOS guide panel exists');
  assert.ok(/id="mobile-wallet-guide"[^>]*hidden/.test(html), 'the guide defaults to hidden (desktop never sees it)');
  assert.strictEqual((html.match(/data-mwg-open=/g) || []).length, 2, 'the two wallet-app deep-link anchors exist');
  assert.ok(!/href="https:\/\/(metamask|rnbwapp)/.test(html), 'no absolute external hrefs in markup — resource-gate stays green');
  assert.ok(js.includes('metamask.app.link') && js.includes('rnbwapp.com/url='), 'main.js assigns the universal-link hrefs at show time');
});

// =======================================================================
// G5-CONNECT-SURFACES behavioral riders (2026-09-08, UI_LOOP_2 W5) — boot
// the REAL main.js against a stub DOM (the render.test.js harness pattern:
// minimal registry + the mwg surfaces) and drive the connect surfaces
// through real user paths:
//   - desktop UA, no injected provider → the guide SHOWS with the desktop
//     lead line (deep links stay live; the iOS lead is untouched),
//   - iPhone UA → the guide shows with the markup's Safari lead,
//   - a provider present (window.ethereum OR a live eip-6963 registry) or a
//     CONNECTED wallet → the guide stays/becomes hidden,
//   - mwg-copy's feedback label resets to 'copy' after ~2.5s and a repeat
//     tap CLEARS the pending timer (fake clock),
//   - picker rows render the announced info.icon (data: URI) inside the
//     hairline container at 20px; icon-less announces render none.
// Each rider boots a FRESH main.js (cache-busted) — module state never
// leaks between riders.
// =======================================================================
const G5_LEAD_IOS = 'Safari carries no wallet of its own. Open Wellstreet inside your wallet app\'s browser:';
const G5_LEAD_DESKTOP = 'No wallet extension detected — install one, or open this page inside your wallet app\'s browser:';
const g5fs = require('fs');
const g5path = require('path');

function g5Settle() { return new Promise(function (r) { setImmediate(function () { setImmediate(r); }); }); }

test('G5 rider: addProvider preserves the announced info.icon (data: URI) shapes; the icon is optional and never rescues a malformed announce', () => {
  const icon = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciLz4=';
  let list = wallet.addProvider([], { info: { rdns: 'io.metamask', uuid: 'u1', name: 'MetaMask', icon: icon }, provider: { fake: 1 } });
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].info.icon, icon, 'the data: URI icon rides the registry entry untouched');
  // icon optional: an announce without one is still a valid wallet
  list = wallet.addProvider(list, { info: { rdns: 'com.rabby', uuid: 'u2', name: 'Rabby' }, provider: { fake: 2 } });
  assert.strictEqual(list.length, 2);
  assert.strictEqual('icon' in list[1], false);
  // an icon does NOT rescue a malformed announce (identity fields still required)
  assert.strictEqual(wallet.addProvider(list, { info: { name: 'X', icon: icon }, provider: {} }), list);
  assert.strictEqual(list.length, 2);
  // a re-announce with the same identity but a different icon stays deduped
  assert.strictEqual(wallet.addProvider(list, { info: { rdns: 'io.metamask', uuid: 'u1', name: 'MetaMask', icon: 'data:image/png;base64,AA==' }, provider: {} }).length, 2);
});

function g5Click(node) {
  (node.listeners.click || []).forEach(function (fn) { fn({ preventDefault: function () {} }); });
}

// widgetStatus writes its text into a child flag span — read the subtree deep.
function g5AllText(node, out) {
  out = out || [];
  if (node._text) { out.push(node._text); }
  for (let i = 0; i < node.children.length; i++) { g5AllText(node.children[i], out); }
  return out;
}

const G5_KEYS = ['window', 'document', 'IntersectionObserver', 'matchMedia', 'fetch', 'addEventListener', 'dispatchEvent', 'navigator'];
let g5Saved = null;

function bootG5(opts) {
  const o = opts || {};
  if (!g5Saved) {
    g5Saved = {};
    G5_KEYS.forEach(function (k) { g5Saved[k] = Object.getOwnPropertyDescriptor(global, k) || null; });
  }
  const REGISTRY = {};
  function classTokens(el) { return String(el.className || '').split(/\s+/).filter(Boolean); }
  function matches(el, sel) {
    if (sel.charAt(0) === '.') { return classTokens(el).indexOf(sel.slice(1)) !== -1; }
    const attr = sel.match(/^\[([^=\]]+)(?:="([^\"]*)")?\]$/);
    if (attr) { const v = el.attrs[attr[1]]; return attr[2] === undefined ? v !== undefined : v === attr[2]; }
    return false;
  }
  function collect(root, sel, out) {
    for (let i = 0; i < root.children.length; i++) {
      const c = root.children[i];
      if (matches(c, sel)) { out.push(c); }
      collect(c, sel, out);
    }
    return out;
  }
  function makeEl(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), id: '', className: '', children: [], attrs: {}, listeners: {}, parentNode: null,
      _text: '', innerHTML: '', hidden: false, disabled: false, value: '', title: '', href: '', target: '', rel: '', open: false,
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v == null ? '' : v); this.children = []; },
      appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
      insertBefore(c, ref) {
        const idx = this.children.indexOf(ref);
        if (idx === -1) { this.children.push(c); } else { this.children.splice(idx, 0, c); }
        c.parentNode = this;
        return c;
      },
      remove() { if (this.parentNode) { const p = this.parentNode; p.children = p.children.filter(function (x) { return x !== this; }.bind(this)); } },
      setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') { REGISTRY[v] = this; this.id = String(v); } },
      getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
      addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); },
      querySelector(sel) { return collect(this, sel, [])[0] || null; },
      querySelectorAll(sel) { return collect(this, sel, []); }
    };
    el.classList = {
      add(c) { const t = classTokens(el); if (t.indexOf(c) === -1) { el.className = t.concat(c).join(' '); } },
      remove(c) { el.className = classTokens(el).filter(function (x) { return x !== c; }).join(' '); },
      contains(c) { return classTokens(el).indexOf(c) !== -1; }
    };
    return el;
  }

  const body = makeEl('body');
  const doc = {
    readyState: 'complete', title: '', body: body,
    getElementById: function (id) { return REGISTRY[id] || null; },
    createElement: function (t) { return makeEl(t); },
    createDocumentFragment: function () { return makeEl('#document-fragment'); },
    addEventListener: function () {},
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };

  // the mwg panel subtree — index.html :208-218 (post-hotfix 05c23ad nesting)
  const panel = makeEl('div'); panel.setAttribute('id', 'mobile-wallet-guide'); panel.className = 'mwg'; panel.hidden = true;
  const lead = makeEl('p'); lead.className = 'mwg-lead'; lead.textContent = G5_LEAD_IOS;
  const aMm = makeEl('a'); aMm.className = 'mwg-link'; aMm.setAttribute('data-mwg-open', 'metamask'); aMm.textContent = 'MetaMask — open the app';
  const aRb = makeEl('a'); aRb.className = 'mwg-link'; aRb.setAttribute('data-mwg-open', 'rainbow'); aRb.textContent = 'Rainbow — open the app';
  const mwgRow = makeEl('div'); mwgRow.className = 'mwg-row';
  const urlNode = makeEl('span'); urlNode.className = 'mwg-url'; urlNode.setAttribute('id', 'mwg-url'); urlNode.textContent = 'wellstreet.tech';
  const copyBtn = makeEl('button'); copyBtn.className = 'mwg-copy'; copyBtn.setAttribute('id', 'mwg-copy-url'); copyBtn.textContent = 'copy';
  mwgRow.appendChild(urlNode); mwgRow.appendChild(copyBtn);
  const foot = makeEl('p'); foot.className = 'mwg-foot'; foot.textContent = 'No wallet needed anywhere else on this page — every number is a public read.';
  panel.appendChild(lead); panel.appendChild(aMm); panel.appendChild(aRb); panel.appendChild(mwgRow); panel.appendChild(foot);
  body.appendChild(panel);

  const picker = makeEl('div'); picker.setAttribute('id', 'wallet-picker'); picker.hidden = true; body.appendChild(picker);
  const connectBtn = makeEl('button'); connectBtn.setAttribute('id', 'btn-connect'); connectBtn.className = 'btn btn-primary'; body.appendChild(connectBtn);
  const status = makeEl('div'); status.setAttribute('id', 'widget-status'); body.appendChild(status);
  const connectEntry = makeEl('button'); connectEntry.setAttribute('id', 'btn-connect-entry'); body.appendChild(connectEntry);
  // the static ids render.test.js pre-registers (the proven boot set; doc-tabs/
  // doc-pane stay OUT — initDocs early-returns and the docs fetch machinery is
  // not this rider's subject). Everything else resolves null → null-guarded.
  ['ws-jurisdiction-banner', 'ws-geo-block', 'chain-badge', 'widget-chain', 'dep-amount',
   'red-amount', 'btn-approve', 'btn-deposit', 'btn-withdraw', 'btn-redeem',
   'wallet-balances', 'acquire-note', 'footer-year', 'trademark-note',
   'deposit', 'docs', 'fleet', 'agents', 'agents-skill-link', 'agents-skill-mirror-link',
   'red-amount-label', 'redeem-preview', 'deposit-panel-head',
   'apr-sim', 'sim-slider', 'sim-size', 'sim-bar-fill', 'sim-share', 'sim-projection',
   'hero-stat', 'hero-stat-num', 'hero-stat-label', 'hero-stat-window',
   'fleet-flagship-apr', 'fleet-vault-reads', 'fleet-coverage',
   'fleet-surface', 'fleet-table', 'fleet-tbody', 'fleet-cards', 'fleet-sheet', 'fleet-unavailable'
  ].forEach(function (id) { const n = makeEl('div'); n.setAttribute('id', id); body.appendChild(n); });

  global.document = doc;
  global.window = global;
  const ioRecords = [];
  global.IntersectionObserver = function (cb, ioOpts) {
    const rec = { cb: cb, opts: ioOpts, observed: [] };
    ioRecords.push(rec);
    return { observe(t) { rec.observed.push(t); }, unobserve() {}, disconnect() {} };
  };
  global.matchMedia = function (q) {
    return { matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  };
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: {
      userAgent: o.ua || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      maxTouchPoints: 0,
      clipboard: { writeText: function () { return Promise.resolve(); } }
    }
  });
  global.fetch = async function () { return { ok: false, status: 404, text: async function () { return 'nf'; } }; };
  const winListeners = {};
  global.addEventListener = function (t, fn) { (winListeners[t] = winListeners[t] || []).push(fn); };
  global.dispatchEvent = function (ev) { (winListeners[ev.type] || []).forEach(function (fn) { fn(ev); }); return true; };
  if (o.ethereum) { global.ethereum = o.ethereum; }

  // main.js is a browser script that reads WS.* off the global and BAILS
  // unless WS.config exists — load the full browser-order module set (the
  // render.test.js require list), cache-busting wallet.js + main.js so each
  // rider boots fresh (discovery registry state resets).
  const JS = g5path.join(__dirname, '..', 'site', 'js');
  const G5_BUNDLE = ['config.js', 'abi.js', 'amount.js', 'rpc.js', 'geo.js', 'vault.js', 'apr.js', 'wallet.js', 'docs.js', 'main.js'];
  [g5path.join(JS, 'wallet.js'), g5path.join(JS, 'main.js')].forEach(function (p) { delete require.cache[require.resolve(p)]; });
  G5_BUNDLE.forEach(function (name) { require(g5path.join(JS, name)); });
  if (process.env.G5_DEBUG) {
    console.error('G5 boot:', JSON.stringify({
      panelHidden: panel.hidden, lead: lead.textContent,
      discovered: global.WS.wallet.discovered().length,
      eth: typeof global.ethereum,
      ua: global.navigator.userAgent.slice(0, 24),
      status: status.textContent, connect: connectBtn.textContent
    }));
  }

  return { panel: panel, lead: lead, aMm: aMm, aRb: aRb, urlNode: urlNode, copyBtn: copyBtn, picker: picker, connectBtn: connectBtn, connectEntry: connectEntry, status: status, winListeners: winListeners, ioRecords: ioRecords };
}

test('G5 rider: desktop UA, no injected provider — the guide SHOWS with the desktop lead line and live deep links', () => {
  const g5 = bootG5();
  assert.strictEqual(g5.panel.hidden, false, 'the desktop-no-provider branch shows the panel');
  assert.strictEqual(g5.lead.textContent, G5_LEAD_DESKTOP, 'the lead line is the desktop install hint');
  const target = encodeURIComponent('https://wellstreet.tech/');
  assert.strictEqual(g5.aMm.href, 'https://metamask.app.link/' + target, 'the MetaMask deep link is assigned at show time');
  assert.strictEqual(g5.aRb.href, 'https://rnbwapp.com/url=' + target, 'the Rainbow deep link is assigned at show time');
  assert.strictEqual(g5.urlNode.textContent, 'wellstreet.tech');
  assert.strictEqual(g5.copyBtn.textContent, 'copy', 'the copy chip ships its plain label');
  assert.strictEqual(g5.connectBtn.textContent, 'Connect wallet');
});

test('G5 rider: iPhone UA — the guide shows with the markup Safari lead (the iOS branch is unchanged)', () => {
  const g5 = bootG5({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' });
  assert.strictEqual(g5.panel.hidden, false);
  assert.strictEqual(g5.lead.textContent, G5_LEAD_IOS, 'the iOS lead line is untouched by the desktop branch');
});

test('G5 rider: mwg-copy feedback resets to copy after ~2.5s; a repeat tap clears the pending timer (fake clock)', async () => {
  const g5 = bootG5();
  const scheduled = [];
  const realSet = global.setTimeout;
  const realClear = global.clearTimeout;
  global.setTimeout = function (fn, ms) { const h = { fn: fn, ms: ms, cleared: false }; scheduled.push(h); return h; };
  global.clearTimeout = function (h) { if (h && typeof h === 'object' && 'cleared' in h) { h.cleared = true; } };
  try {
    g5Click(g5.copyBtn);
    await g5Settle();
    assert.strictEqual(g5.copyBtn.textContent, 'copied — paste in the app');
    // unrelated rpc retry timers share the swap window — pin the RESET timers by their delay
    const resets = scheduled.filter(function (h) { return h.ms === 2500; });
    assert.strictEqual(resets.length, 1, 'exactly one reset timer scheduled');
    assert.strictEqual(resets[0].cleared, false);
    g5Click(g5.copyBtn); // repeat tap BEFORE the reset fires
    await g5Settle();
    const resets2 = scheduled.filter(function (h) { return h.ms === 2500; });
    assert.strictEqual(resets2.length, 2, 'the second tap schedules a fresh timer');
    assert.strictEqual(resets2[0].cleared, true, 'the repeat tap CLEARED the first pending reset (no timer leak)');
    assert.strictEqual(resets2[1].cleared, false);
    resets2[1].fn(); // fire the live timer
    assert.strictEqual(g5.copyBtn.textContent, 'copy', 'the label resets to copy');
  } finally {
    global.setTimeout = realSet;
    global.clearTimeout = realClear;
  }
});

test('G5 rider: a live eip-6963 registry renders picker icons (data: URI, 20px, hairline container) and CLOSES the desktop guide branch', async () => {
  const g5 = bootG5();
  assert.strictEqual(g5.panel.hidden, false, 'precondition: no provider at boot — guide visible');
  const icon = 'data:image/svg+xml;base64,PHN2Zy8+';
  const withIcon = { info: { rdns: 'io.metamask', uuid: 'u1', name: 'MetaMask', icon: icon }, provider: {} };
  const noIcon = { info: { rdns: 'com.rabby', uuid: 'u2', name: 'Rabby' }, provider: {} };
  const ev1 = new Event('eip6963:announceProvider'); ev1.detail = withIcon;
  const ev2 = new Event('eip6963:announceProvider'); ev2.detail = noIcon;
  global.dispatchEvent(ev1); global.dispatchEvent(ev2);

  g5Click(g5.connectBtn); // two announced wallets → the picker opens
  await g5Settle();
  assert.strictEqual(g5.picker.hidden, false, 'the picker is reachable from the connect flow');
  const btns = g5.picker.children.filter(function (c) { return String(c.className).indexOf('picker-btn') !== -1; });
  assert.strictEqual(btns.length, 2);
  const wrapOf = function (b) { return b.children.filter(function (c) { return String(c.className).indexOf('picker-icon-wrap') !== -1; }); };
  const nameOf = function (b) { return b.children.filter(function (c) { return String(c.className).indexOf('picker-name') !== -1; })[0]; };
  assert.strictEqual(wrapOf(btns[0]).length, 1, 'the iconed announce renders its icon container');
  const img = wrapOf(btns[0])[0].children[0];
  assert.strictEqual(img.getAttribute('src'), icon, 'the img src IS the announced data: URI (JS-assigned — the sanctioned channel)');
  assert.strictEqual(img.getAttribute('width'), '20');
  assert.strictEqual(img.getAttribute('alt'), '', 'the icon is decorative — the name carries the meaning');
  assert.strictEqual(nameOf(btns[0]).textContent, 'MetaMask');
  assert.strictEqual(wrapOf(btns[1]).length, 0, 'an icon-less announce renders no image');
  assert.strictEqual(nameOf(btns[1]).textContent, 'Rabby');
  assert.ok(g5fs.readFileSync(g5path.join(__dirname, '..', 'site', 'css', 'style.css'), 'utf8')
    .includes('#wallet-picker .picker-icon-wrap'), 'the hairline icon container is styled in the shipped css');

  // the registry is NON-empty → the desktop branch closes on the next render
  g5Click(btns[0]); // connect attempt with the announced (stub) provider → honest failure → renderWidgetState
  await g5Settle();
  assert.strictEqual(g5.panel.hidden, true, 'a present eip-6963 provider keeps the guide hidden');
});

test('G5 rider: window.ethereum present hides the guide at boot; a successful connect keeps it hidden', async () => {
  const stubProvider = {
    request: async function (req) {
      if (req.method === 'eth_requestAccounts') { return ['0xABCdEf1234567890123456789012345678901234']; }
      if (req.method === 'eth_chainId') { return '0x1237'; } // 4663 — the expected chain
      throw new Error('stub: unexpected ' + req.method);
    },
    on: function () {}
  };
  const g5 = bootG5({ ethereum: stubProvider });
  assert.strictEqual(g5.panel.hidden, true, 'provider-present at boot → guide hidden (desktop branch closed)');
  g5Click(g5.connectBtn); // 0 announced → legacy window.ethereum path
  await g5Settle();
  assert.strictEqual(g5.connectBtn.textContent.indexOf('Connected: '), 0, 'the connect succeeded through the stub provider');
  assert.strictEqual(g5.connectBtn.disabled, true);
  assert.ok(g5AllText(g5.status).join(' ').indexOf('on chain 4663.') !== -1, 'the honest connected status renders');
  assert.strictEqual(g5.panel.hidden, true, 'post-connect the guide stays hidden');
});
