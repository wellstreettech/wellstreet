'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const rpc = require('../api/rpc.js');
const { mockReq, mockRes, fetchMock, rpcResult } = require('./mocks.js');

const RH = 'https://rpc.mainnet.chain.robinhood.com';
const BS = 'https://robinhoodchain.blockscout.com/api/eth-rpc';

test('rpc: POST passthrough returns the upstream JSON verbatim, no cache', async () => {
  const fetch = fetchMock([{ match: (url) => url === RH, json: rpcResult('0x2fde400') }]);
  rpc._setFetch(fetch);

  const reqBody = { jsonrpc: '2.0', id: 7, method: 'eth_blockNumber', params: [] };
  const res = mockRes();
  await rpc(mockReq({ method: 'POST', headers: { 'content-length': '64' }, body: reqBody }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.rawBody), rpcResult('0x2fde400'));
  assert.equal(fetch.callCount(RH), 1);
  assert.deepEqual(fetch.calls[0].bodyObj, reqBody); // forwarded untouched
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('rpc: fails over to the second upstream on a network error from the first', async () => {
  const fetch = fetchMock([
    { match: (url) => url === RH, error: 'socket hang up' },
    { match: (url) => url === BS, json: rpcResult('0x1') },
  ]);
  rpc._setFetch(fetch);

  const res = mockRes();
  await rpc(
    mockReq({ method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.rawBody), rpcResult('0x1'));
  assert.equal(fetch.callCount(RH), 1);
  assert.equal(fetch.callCount(BS), 1);
});

test('rpc: fails over on upstream 429 (rate limit)', async () => {
  const fetch = fetchMock([
    { match: (url) => url === RH, status: 429, json: { error: 'rate limited' } },
    { match: (url) => url === BS, json: rpcResult('0x1237') },
  ]);
  rpc._setFetch(fetch);

  const res = mockRes();
  await rpc(
    mockReq({ method: 'POST', body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] } }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.rawBody), rpcResult('0x1237'));
});

test('rpc: all upstreams failing → 502 JSON-RPC error envelope carrying attempts', async () => {
  const fetch = fetchMock([{ error: 'down' }]);
  rpc._setFetch(fetch);

  const res = mockRes();
  await rpc(
    mockReq({ method: 'POST', body: { jsonrpc: '2.0', id: 42, method: 'eth_chainId', params: [] } }),
    res
  );

  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 42);
  assert.equal(body.error.code, -32000);
  assert.ok(Array.isArray(body.error.data.attempts));
});

test('rpc: GET → 405', async () => {
  rpc._setFetch(fetchMock([]));
  const res = mockRes();
  await rpc(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.allow, 'POST');
});

test('rpc: OPTIONS preflight → 204 with CORS headers', async () => {
  const res = mockRes();
  await rpc(mockReq({ method: 'OPTIONS' }), res);
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('rpc: request-size guard — oversized Content-Length → 413 before any fetch', async () => {
  let called = 0;
  rpc._setFetch(async () => {
    called++;
    return { ok: true, status: 200, text: async () => JSON.stringify(rpcResult('0x1')) };
  });

  const res = mockRes();
  await rpc(
    mockReq({
      method: 'POST',
      headers: { 'content-length': String(256 * 1024 + 1) },
      body: { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    }),
    res
  );

  assert.equal(res.statusCode, 413);
  assert.equal(JSON.parse(res.rawBody).error.includes('byte limit'), true);
  assert.equal(called, 0);
});

test('rpc: oversized streamed body (no Content-Length) → 413 mid-stream', async () => {
  rpc._setFetch(fetchMock([]));
  const big = 'x'.repeat(300 * 1024);
  const res = mockRes();
  await rpc(
    mockReq({ method: 'POST', streamChunks: ['{"jsonrpc":"2.0","id":1,"method":"eth_', big] }),
    res
  );
  assert.equal(res.statusCode, 413);
});

test('rpc: streamed valid JSON body (no pre-parsed req.body) is forwarded', async () => {
  const fetch = fetchMock([{ match: (url) => url === RH, json: rpcResult('0x1237') }]);
  rpc._setFetch(fetch);

  const res = mockRes();
  await rpc(
    mockReq({ method: 'POST', streamChunks: ['{"jsonrpc":"2.0","id":1,"method":"eth_chainId"', ',"params":[]}'] }),
    res
  );

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.rawBody), rpcResult('0x1237'));
  assert.equal(fetch.calls[0].bodyObj.method, 'eth_chainId');
});

test('rpc: invalid JSON body → 400', async () => {
  rpc._setFetch(fetchMock([]));
  const res = mockRes();
  await rpc(mockReq({ method: 'POST', body: 'not json' }), res);
  assert.equal(res.statusCode, 400);
});

test('rpc: non-JSON-RPC body (no method) → 400', async () => {
  rpc._setFetch(fetchMock([]));
  const res = mockRes();
  await rpc(mockReq({ method: 'POST', body: { hello: 1 } }), res);
  assert.equal(res.statusCode, 400);
});

test('rpc: batch JSON-RPC array is accepted and forwarded', async () => {
  const fetch = fetchMock([{ match: (url) => url === RH, json: [{ jsonrpc: '2.0', id: 1, result: '0xa' }] }]);
  rpc._setFetch(fetch);

  const batch = [
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    { jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] },
  ];
  const res = mockRes();
  await rpc(mockReq({ method: 'POST', body: batch }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.rawBody), [{ jsonrpc: '2.0', id: 1, result: '0xa' }]);
});
