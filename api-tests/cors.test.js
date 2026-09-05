'use strict';

/**
 * CORS consistency pin — all four /api/* functions must emit the IDENTICAL
 * access-control-* header set, on success paths AND error paths (the headers come
 * from the shared applyCors/sendJson seam; this test fails if any endpoint ever
 * grows a divergent or missing CORS answer).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const health = require('../api/health.js');
const prices = require('../api/prices.js');
const rpc = require('../api/rpc.js');
const vaults = require('../api/vaults.js');
const shared = require('../api/lib/shared.js');
const { mockReq, mockRes, fetchMock } = require('./mocks.js');

const HANDLERS = { health, prices, rpc, vaults };

/** The exact CORS headers every endpoint must carry (shared.js CORS_HEADERS). */
function assertCors(res, label) {
  for (const [k, v] of Object.entries(shared.CORS_HEADERS)) {
    assert.equal(res.headers[k], v, `${label}: ${k}`);
  }
}

test('cors: OPTIONS preflight → 204 with the identical CORS set on all four endpoints', async () => {
  for (const [name, handler] of Object.entries(HANDLERS)) {
    const res = mockRes();
    await handler(mockReq({ method: 'OPTIONS' }), res);
    assert.equal(res.statusCode, 204, name);
    assertCors(res, `${name} OPTIONS`);
    assert.equal(res.headers['access-control-max-age'], '86400', name);
  }
});

test('cors: error responses (405/400) carry the identical CORS set on all four endpoints', async () => {
  for (const [name, handler] of Object.entries(HANDLERS)) {
    let res;
    if (name === 'rpc') {
      // 400: a POST body that is not JSON-RPC
      res = mockRes();
      await handler(mockReq({ method: 'POST', body: { hello: 1 } }), res);
      assert.equal(res.statusCode, 400, name);
    } else {
      // 405: every read-only endpoint rejects POST
      res = mockRes();
      await handler(mockReq({ method: 'POST', body: {} }), res);
      assert.equal(res.statusCode, 405, name);
    }
    assertCors(res, `${name} error`);
  }
});

test('cors: real failure responses keep the CORS set — health/prices/rpc 502', async () => {
  const down = fetchMock([{ error: 'all upstreams down' }]);

  // health: every upstream unreachable
  health._setFetch(down);
  health._setClock(() => 1000);
  const h = mockRes();
  await health(mockReq({ method: 'GET' }), h);
  assert.equal(h.statusCode, 502);
  assertCors(h, 'health 502');

  // prices: both sources unreachable for every feed
  prices._setFetch(down);
  prices._setClock(() => Date.UTC(2026, 8, 1, 14, 0, 0));
  const p = mockRes();
  await prices(mockReq({ method: 'GET' }), p);
  assert.equal(p.statusCode, 502);
  assertCors(p, 'prices 502');

  // vaults: registry read fails with no warm cache → 502
  vaults._resetCache();
  vaults._setFactory('0xAbCdEf0000000000000000000000000000001234');
  vaults._setFetch(down);
  const v = mockRes();
  await vaults(mockReq({ method: 'GET' }), v);
  assert.equal(v.statusCode, 502);
  assertCors(v, 'vaults 502');

  // rpc: all upstreams failing
  rpc._setFetch(down);
  const r = mockRes();
  await rpc(
    mockReq({ method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] } }),
    r
  );
  assert.equal(r.statusCode, 502);
  assertCors(r, 'rpc 502');
});
