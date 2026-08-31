'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const health = require('../api/health.js');
const { mockReq, mockRes, fetchMock, rpcResult } = require('./mocks.js');

const RH = 'https://rpc.mainnet.chain.robinhood.com';

test('health: 200 with {ok, chainId, latencyMs} on the expected chain id', async () => {
  let calls = 0;
  health._setFetch(async () => {
    calls++;
    return { ok: true, status: 200, text: async () => JSON.stringify(rpcResult('0x1237')) };
  });
  health._setClock(() => {
    calls++; // fake advancing clock: each read costs 3ms
    return calls * 3;
  });

  const res = mockRes();
  await health(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, true);
  assert.equal(body.chainId, 4663);
  assert.equal(body.chainIdHex, '0x1237');
  assert.equal(body.method, 'eth_chainId');
  assert.equal(typeof body.latencyMs, 'number');
  assert.ok(body.latencyMs >= 0);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('health: mismatched chain id → ok:false with 502, value still reported', async () => {
  health._setFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify(rpcResult('0x1')) }));
  health._setClock(() => 1000);

  const res = mockRes();
  await health(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, false);
  assert.equal(body.chainId, 1);
  assert.equal(body.expectedChainId, 4663);
});

test('health: all upstreams unreachable → 502 {ok:false} with per-attempt detail', async () => {
  health._setFetch(async () => {
    throw new Error('ECONNREFUSED');
  });
  health._setClock(() => 1000);

  const res = mockRes();
  await health(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, false);
  assert.equal(body.chainId, null);
  assert.ok(Array.isArray(body.attempts));
  assert.ok(body.attempts.length >= 2); // both upstreams attempted
});

test('health: preflight OPTIONS → 204 with CORS headers, no fetch performed', async () => {
  let called = 0;
  health._setFetch(async () => {
    called++;
    return { ok: true, status: 200, text: async () => JSON.stringify(rpcResult('0x1237')) };
  });
  const res = mockRes();
  await health(mockReq({ method: 'OPTIONS' }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.equal(called, 0);
});

test('health: failover reaches the second upstream when the first errors', async () => {
  const fetch = fetchMock([
    { match: (url) => url === RH, error: 'boom' },
    { match: (url) => url.includes('blockscout'), json: rpcResult('0x1237') },
  ]);
  health._setFetch(fetch);
  health._setClock(() => 1000);

  const res = mockRes();
  await health(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, true);
  assert.equal(body.upstream, 'blockscout-eth-rpc');
  assert.equal(fetch.callCount(RH), 1);
  assert.equal(fetch.callCount('blockscout'), 1);
});
