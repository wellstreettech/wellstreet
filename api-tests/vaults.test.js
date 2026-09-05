'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const vaults = require('../api/vaults.js');
const shared = require('../api/lib/shared.js');
const { mockReq, mockRes, fetchMock, rpcResult, rpcError, word, abiStringRaw } = require('./mocks.js');

const RH = 'https://rpc.mainnet.chain.robinhood.com';
const FACTORY = '0xAbCdEf0000000000000000000000000000001234';
const V1 = '0x1111111111111111111111111111111111111111';
const V2 = '0x2222222222222222222222222222222222222222';
const SPY_TOKEN = shared.FEEDS.SPY.token;
// decodeAddressWord returns lowercase hex — the dependent asset-decimals call goes
// to the lowercase form of the decoded asset address.
const ASSET_LOWER = SPY_TOKEN.toLowerCase();

// Deployed-share math (YieldShares.sol:49): shares = assets × 10^6, so at a 1:1 rate
// 1e18 asset units ↔ 1e24 share units; one whole share (10^24 share units) = 1e18
// asset base units = "1.0" at the asset's 18 decimals.
const SHARE_DECIMALS = 24;
const ASSET_DECIMALS = 18;
const ASSET_UNITS_1 = '1000000000000000000'; // 1e18
const SHARE_UNITS_1 = '1000000000000000000000000'; // 1e24

const vaultListRaw = () =>
  '0x' +
  word(0x20).slice(2) +
  word(2).slice(2) +
  '0'.repeat(24) + V1.slice(2) +
  '0'.repeat(24) + V2.slice(2);

function vaultRoutes({ factory = FACTORY, paused = false, omitAssetDecimals = false, revertVault2TotalAssets = false } = {}) {
  const fieldRoute = (to, selector, result, { fullData } = {}) => ({
    match: (url, b) =>
      url === RH && b.params[0].to === to && b.params[0].data.slice(0, 10) === selector &&
      (fullData === undefined || b.params[0].data === fullData),
    json: rpcResult(result),
  });
  const routes = [
    {
      match: (url, b) => url === RH && b.params[0].to === factory && b.params[0].data.slice(0, 10) === shared.SEL.allVaults,
      json: rpcResult(vaultListRaw()),
    },
  ];
  for (const addr of [V1, V2]) {
    // Vault 2 hard-fails the totalAssets field (per-item tolerance case): the
    // error route is pushed FIRST and the success route for that one field is omitted.
    if (revertVault2TotalAssets && addr === V2) {
      routes.push({
        match: (url, b) => url === RH && b.params[0].to === V2 && b.params[0].data.slice(0, 10) === shared.SEL.totalAssets,
        json: rpcError(3, 'execution reverted'),
      });
    }
    routes.push(
      fieldRoute(addr, shared.SEL.name, abiStringRaw('Wellstreet SPY')),
      fieldRoute(addr, shared.SEL.symbol, abiStringRaw('ws-SPY')),
      fieldRoute(addr, shared.SEL.decimals, word(SHARE_DECIMALS)),
      fieldRoute(addr, shared.SEL.asset, '0x' + '0'.repeat(24) + ASSET_LOWER.slice(2))
    );
    if (!(revertVault2TotalAssets && addr === V2)) {
      routes.push(fieldRoute(addr, shared.SEL.totalAssets, word(ASSET_UNITS_1)));
    }
    routes.push(
      fieldRoute(addr, shared.SEL.totalSupply, word(SHARE_UNITS_1)),
      fieldRoute(addr, shared.SEL.depositsPaused, word(paused ? 1 : 0))
    );
    // Dependent read 1: whole-share price — convertToAssets(10^shareDecimals).
    routes.push(
      fieldRoute(addr, shared.SEL.convertToAssets, word(ASSET_UNITS_1), {
        fullData: shared.SEL.convertToAssets + shared.encodeUintArg(10n ** BigInt(SHARE_DECIMALS)),
      })
    );
    // Dependent read 2: the ASSET token's own decimals (denomination of the price).
    if (!omitAssetDecimals) {
      routes.push(fieldRoute(ASSET_LOWER, shared.SEL.decimals, word(ASSET_DECIMALS)));
    }
  }
  return routes;
}

function baseSetup() {
  vaults._resetCache();
  vaults._setClock(() => 1_000_000);
}

test('vaults: disabled factory (env empty / override null) → 200 {configured:false, vaults:[]}, no fetch', async () => {
  baseSetup();
  vaults._setFactory(null);
  const fetch = fetchMock([]);
  vaults._setFetch(fetch);

  const res = mockRes();
  await vaults(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, true);
  assert.equal(body.configured, false);
  assert.deepEqual(body.vaults, []);
  assert.equal(fetch.calls.length, 0); // graceful, zero upstream traffic
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('vaults: factory resolution — env override > pinned deployed default; empty env disables', async () => {
  baseSetup();
  const prev = process.env.WELLSTREET_FACTORY_ADDRESS;
  try {
    // 1. env unset → the pinned deployed factory (site/js/config.js contracts.vaultFactory)
    delete process.env.WELLSTREET_FACTORY_ADDRESS;
    vaults._clearFactory();
    const fetch1 = fetchMock(vaultRoutes({ factory: shared.DEFAULT_FACTORY_ADDRESS }));
    vaults._setFetch(fetch1);
    const res1 = mockRes();
    await vaults(mockReq({ method: 'GET' }), res1);
    assert.equal(res1.statusCode, 200);
    assert.equal(JSON.parse(res1.rawBody).factory, shared.DEFAULT_FACTORY_ADDRESS);

    // 2. env override wins over the default
    process.env.WELLSTREET_FACTORY_ADDRESS = FACTORY;
    vaults._clearFactory();
    vaults._resetCache();
    const fetch2 = fetchMock(vaultRoutes({ factory: FACTORY }));
    vaults._setFetch(fetch2);
    const res2 = mockRes();
    await vaults(mockReq({ method: 'GET' }), res2);
    assert.equal(JSON.parse(res2.rawBody).factory, FACTORY);

    // 3. empty env = explicitly disabled → configured:false, zero fetches
    process.env.WELLSTREET_FACTORY_ADDRESS = '  ';
    vaults._clearFactory();
    vaults._resetCache();
    const fetch3 = fetchMock([]);
    vaults._setFetch(fetch3);
    const res3 = mockRes();
    await vaults(mockReq({ method: 'GET' }), res3);
    assert.equal(JSON.parse(res3.rawBody).configured, false);
    assert.equal(fetch3.calls.length, 0);
  } finally {
    if (prev === undefined) delete process.env.WELLSTREET_FACTORY_ADDRESS;
    else process.env.WELLSTREET_FACTORY_ADDRESS = prev;
    vaults._clearFactory();
    vaults._resetCache();
  }
});

test('vaults: deployed surface decoded — whole-share price normalized at the verified asset decimals', async () => {
  baseSetup();
  vaults._setFactory(FACTORY);
  const fetch = fetchMock(vaultRoutes());
  vaults._setFetch(fetch);

  const res = mockRes();
  await vaults(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, true);
  assert.equal(body.configured, true);
  assert.equal(body.factory, FACTORY);
  assert.equal(body.chainId, 4663);
  assert.equal(body.cached, false);
  assert.equal(body.vaultCount, 2);

  const v = body.vaults[0];
  assert.equal(v.address, V1);
  assert.equal(v.name, 'Wellstreet SPY');
  assert.equal(v.symbol, 'ws-SPY');
  assert.equal(v.decimals, SHARE_DECIMALS); // share decimals carry the +6 virtual offset
  assert.equal(v.assetDecimals, ASSET_DECIMALS); // verified from the asset token itself
  assert.equal(v.asset.toLowerCase(), ASSET_LOWER);
  assert.equal(v.depositsPaused, false); // the real pause flag (no paused() on the vault)
  assert.equal(v.totalAssetsRaw, ASSET_UNITS_1);
  assert.equal(v.totalAssets.exact, '1'); // asset-denominated → asset decimals
  assert.equal(v.totalSupplyRaw, SHARE_UNITS_1);
  assert.equal(v.totalSupply.exact, '1'); // share-denominated → share decimals
  assert.equal(v.pricePerShareRaw, ASSET_UNITS_1);
  assert.equal(v.pricePerShare.exact, '1'); // one whole share = 1.0 asset at par
  assert.equal(v.pricePerShare.value, 1);
  assert.deepEqual(v.errors, []);
  assert.equal(res.headers['cache-control'], 'public, max-age=30, s-maxage=60');
});

test('vaults: the whole-share price call encodes exactly 10^shareDecimals', async () => {
  baseSetup();
  vaults._setFactory(FACTORY);
  const fetch = fetchMock(vaultRoutes());
  vaults._setFetch(fetch);
  await vaults(mockReq({ method: 'GET' }), mockRes());

  const priceCall = fetch.calls.find((c) =>
    c.bodyObj && c.bodyObj.params && c.bodyObj.params[0].data.startsWith(shared.SEL.convertToAssets)
  );
  assert.ok(priceCall, 'convertToAssets call issued');
  assert.equal(priceCall.bodyObj.params[0].to, V1);
  assert.equal(
    priceCall.bodyObj.params[0].data,
    shared.SEL.convertToAssets + shared.encodeUintArg(10n ** 24n)
  );
});

test('vaults: depositsPaused=true surfaces the honest pause state', async () => {
  baseSetup();
  vaults._setFactory(FACTORY);
  vaults._setFetch(fetchMock(vaultRoutes({ paused: true })));

  const res = mockRes();
  await vaults(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.rawBody).vaults[0].depositsPaused, true);
});

test('vaults: unverified asset decimals → asset-denominated figures stay raw (honest gap, no guessed shift)', async () => {
  baseSetup();
  vaults._setFactory(FACTORY);
  const fetch = fetchMock(vaultRoutes({ omitAssetDecimals: true }));
  vaults._setFetch(fetch);

  const res = mockRes();
  await vaults(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const v = JSON.parse(res.rawBody).vaults[0];
  assert.equal(v.assetDecimals, null);
  assert.equal(v.totalAssetsRaw, ASSET_UNITS_1); // raw still reported
  assert.equal(v.totalAssets, undefined); // no normalization without the verified denomination
  assert.equal(v.pricePerShare, undefined);
  assert.equal(v.totalSupply.exact, '1'); // share-denominated normalization unaffected
  assert.equal(v.errors.some((e) => e.field === 'assetDecimals'), true);
});

test('vaults: in-memory cache TTL 60s — hit within TTL, refetch after', async () => {
  baseSetup();
  let now = 1_000_000;
  vaults._setClock(() => now);
  vaults._setFactory(FACTORY);
  const fetch = fetchMock(vaultRoutes());
  vaults._setFetch(fetch);

  // 1st call: populates the cache (1 registry read + 9 views × 2 vaults)
  const res1 = mockRes();
  await vaults(mockReq({ method: 'GET' }), res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(JSON.parse(res1.rawBody).cached, false);
  const callsAfterFirst = fetch.calls.length;
  assert.ok(callsAfterFirst >= 19, `expected full fan-out, got ${callsAfterFirst} calls`);

  // 2nd call 30s later: served from cache, zero new fetches
  now += 30_000;
  const res2 = mockRes();
  await vaults(mockReq({ method: 'GET' }), res2);
  const body2 = JSON.parse(res2.rawBody);
  assert.equal(body2.cached, true);
  assert.equal(fetch.calls.length, callsAfterFirst);

  // 3rd call 601s... 61s after the first: TTL expired → refetch (vault state moves
  // on every deposit/harvest — the cache never outlives the site's own refresh loop)
  now += shared.VAULT_CACHE_TTL_MS - 30_000 + 1;
  const res3 = mockRes();
  await vaults(mockReq({ method: 'GET' }), res3);
  assert.equal(JSON.parse(res3.rawBody).cached, false);
  assert.equal(fetch.calls.length, callsAfterFirst * 2);
});

test('vaults: one failing vault field is tolerated inline, list still 200', async () => {
  baseSetup();
  vaults._setFactory(FACTORY);
  const fetch = fetchMock(vaultRoutes({ revertVault2TotalAssets: true }));
  vaults._setFetch(fetch);

  const res = mockRes();
  await vaults(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  const v2 = body.vaults[1];
  assert.equal(v2.totalAssetsRaw, null);
  assert.equal(v2.totalAssets, undefined);
  assert.equal(v2.errors.some((e) => e.field === 'totalAssets' && e.error.includes('execution reverted')), true);
  // healthy fields on the same vault still decoded
  assert.equal(v2.symbol, 'ws-SPY');
  // healthy vault untouched
  assert.equal(body.vaults[0].totalAssetsRaw, ASSET_UNITS_1);
});

test('vaults: failed registry read with empty cache → 502 {ok:false}', async () => {
  baseSetup();
  vaults._setFactory(FACTORY);
  vaults._setFetch(fetchMock([{ match: (url) => url === RH, error: 'network down' }]));

  const res = mockRes();
  await vaults(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'factory allVaults() eth_call failed');
});

test('vaults: failed registry read with a warm cache serves it marked staleCache', async () => {
  baseSetup();
  let now = 2_000_000;
  vaults._setClock(() => now);
  vaults._setFactory(FACTORY);
  const good = fetchMock(vaultRoutes());
  vaults._setFetch(good);
  await vaults(mockReq({ method: 'GET' }), mockRes());

  now += shared.VAULT_CACHE_TTL_MS + 1; // expire the cache
  vaults._setFetch(fetchMock([{ match: (url) => url === RH, error: 'rate limited' }]));

  const res = mockRes();
  await vaults(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, true);
  assert.equal(body.staleCache, true);
  assert.equal(body.cached, true);
  assert.equal(body.vaultCount, 2);
});

test('vaults: POST → 405', async () => {
  baseSetup();
  const res = mockRes();
  await vaults(mockReq({ method: 'POST', body: {} }), res);
  assert.equal(res.statusCode, 405);
});
