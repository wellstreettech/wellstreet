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

const vaultListRaw = () =>
  '0x' +
  word(0x20).slice(2) +
  word(2).slice(2) +
  '0'.repeat(24) + V1.slice(2) +
  '0'.repeat(24) + V2.slice(2);

function vaultRoutes({ revertVault2TotalAssets = false } = {}) {
  const fieldRoute = (to, selector, result) => ({
    match: (url, b) =>
      url === RH && b.params[0].to === to && b.params[0].data.slice(0, 10) === selector,
    json: rpcResult(result),
  });
  const routes = [
    {
      match: (url, b) => url === RH && b.params[0].to === FACTORY && b.params[0].data.slice(0, 10) === shared.SEL.vaultList,
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
      fieldRoute(addr, shared.SEL.decimals, word(18)),
      fieldRoute(addr, shared.SEL.asset, '0x' + '0'.repeat(24) + SPY_TOKEN.slice(2).toLowerCase())
    );
    if (!(revertVault2TotalAssets && addr === V2)) {
      routes.push(fieldRoute(addr, shared.SEL.totalAssets, word('1000000000000000000')));
    }
    routes.push(
      fieldRoute(addr, shared.SEL.totalSupply, word('1000000000000000000')),
      fieldRoute(addr, shared.SEL.pricePerShare, word('1000000000000000000')),
      fieldRoute(addr, shared.SEL.paused, word(0))
    );
  }
  return routes;
}

function baseSetup() {
  vaults._resetCache();
  vaults._setClock(() => 1_000_000);
}

test('vaults: unconfigured factory → 200 {configured:false, vaults:[]}, no fetch', async () => {
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

test('vaults: configured factory → decoded vault list with normalized values', async () => {
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
  assert.equal(v.decimals, 18);
  assert.equal(v.asset.toLowerCase(), SPY_TOKEN.toLowerCase());
  assert.equal(v.paused, false);
  assert.equal(v.totalAssetsRaw, '1000000000000000000');
  assert.equal(v.totalAssets.exact, '1');
  assert.equal(v.pricePerShare.value, 1);
  assert.equal(v.totalSupplyRaw, v.totalAssetsRaw);
  assert.equal(res.headers['cache-control'], 'public, max-age=60, s-maxage=600');
});

test('vaults: in-memory cache TTL 600s — hit within TTL, refetch after', async () => {
  baseSetup();
  let now = 1_000_000;
  vaults._setClock(() => now);
  vaults._setFactory(FACTORY);
  const fetch = fetchMock(vaultRoutes());
  vaults._setFetch(fetch);

  // 1st call: populates the cache (1 registry read + 8 views × 2 vaults)
  const res1 = mockRes();
  await vaults(mockReq({ method: 'GET' }), res1);
  assert.equal(res1.statusCode, 200);
  assert.equal(JSON.parse(res1.rawBody).cached, false);
  const callsAfterFirst = fetch.calls.length;
  assert.ok(callsAfterFirst >= 17, `expected full fan-out, got ${callsAfterFirst} calls`);

  // 2nd call 60s later: served from cache, zero new fetches
  now += 60_000;
  const res2 = mockRes();
  await vaults(mockReq({ method: 'GET' }), res2);
  const body2 = JSON.parse(res2.rawBody);
  assert.equal(body2.cached, true);
  assert.equal(fetch.calls.length, callsAfterFirst);

  // 3rd call 601s after the first: TTL expired → refetch
  now += 601_000 - 60_000 + 1;
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
  assert.equal(v2.errors.length, 1);
  assert.equal(v2.errors[0].field, 'totalAssets');
  assert.equal(v2.errors[0].error.includes('execution reverted'), true);
  // healthy fields on the same vault still decoded
  assert.equal(v2.symbol, 'ws-SPY');
  // healthy vault untouched
  assert.equal(body.vaults[0].totalAssetsRaw, '1000000000000000000');
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
  assert.equal(body.error, 'factory vaultList() eth_call failed');
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
