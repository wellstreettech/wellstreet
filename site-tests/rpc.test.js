'use strict';
// RPC client tests — the CORS-find mitigation (duplicate Access-Control-Allow-Origin
// "*,*" emitted intermittently by the primary RPC; Chromium rejects such responses
// outright, ~47% of phase-0 probe page loads, invisible to curl).
// The decision logic is exercised as PURE functions, and the full client loop is
// driven end-to-end with an injected fetch implementation (mock fetch) — no network.
const test = require('node:test');
const assert = require('node:assert');

const config = require('../site/js/config.js');
const rpc = require('../site/js/rpc.js');

const ENDPOINTS = ['https://rpc-primary.example', 'https://rpc-secondary.example'];

function client(fetchImpl, extra) {
  return rpc.createRpcClient(Object.assign({
    endpoints: ENDPOINTS,
    attemptsPerEndpoint: 3,
    backoffBaseMs: 1,
    backoffCapMs: 2,
    timeoutMs: 500,
    fetchImpl: fetchImpl,
    sleepFn: function () { return Promise.resolve(); }
  }, extra || {}));
}

function rpcResponse(req, extra) {
  return {
    ok: true,
    status: 200,
    text: async function () {
      return JSON.stringify(Object.assign({ jsonrpc: '2.0', id: req.id, result: '0x1237' }, extra || {}));
    }
  };
}

function parseBody(opts) { return JSON.parse(opts.body); }

// ---------------- pure: backoffDelay ----------------
test('backoffDelay is exponential from the base and capped', () => {
  assert.strictEqual(rpc.backoffDelay(1, 250, 4000), 250);
  assert.strictEqual(rpc.backoffDelay(2, 250, 4000), 500);
  assert.strictEqual(rpc.backoffDelay(3, 250, 4000), 1000);
  assert.strictEqual(rpc.backoffDelay(4, 250, 4000), 2000);
  assert.strictEqual(rpc.backoffDelay(9, 250, 4000), 4000); // capped
  assert.strictEqual(rpc.backoffDelay(1), 250);             // defaults
});

// ---------------- pure: classifyFailure ----------------
test('classifyFailure: CORS/network + timeout + 429/5xx are retryable', () => {
  assert.strictEqual(rpc.classifyFailure({ kind: 'network' }), 'retryable');
  assert.strictEqual(rpc.classifyFailure({ kind: 'timeout' }), 'retryable');
  assert.strictEqual(rpc.classifyFailure({ kind: 'http', status: 429 }), 'retryable');
  assert.strictEqual(rpc.classifyFailure({ kind: 'http', status: 503 }), 'retryable');
});

test('classifyFailure: UA/CF-gated 401/403/404 and method-not-found fail over', () => {
  assert.strictEqual(rpc.classifyFailure({ kind: 'http', status: 403 }), 'failover');
  assert.strictEqual(rpc.classifyFailure({ kind: 'http', status: 401 }), 'failover');
  assert.strictEqual(rpc.classifyFailure({ kind: 'http', status: 404 }), 'failover');
  assert.strictEqual(rpc.classifyFailure({ kind: 'rpc', code: -32601 }), 'failover');
});

test('classifyFailure: deterministic JSON-RPC errors are fatal (no wasted calls)', () => {
  assert.strictEqual(rpc.classifyFailure({ kind: 'rpc', code: -32602 }), 'fatal');
  assert.strictEqual(rpc.classifyFailure({ kind: 'rpc', code: -32600 }), 'fatal');
  assert.strictEqual(rpc.classifyFailure({ kind: 'rpc', code: -32700 }), 'fatal');
});

// ---------------- pure: decide ----------------
test('decide: retries same endpoint within the attempt budget, then fails over', () => {
  const base = { attemptsPerEndpoint: 3, endpointCount: 2, backoffBaseMs: 250, backoffCapMs: 4000 };
  // endpoint 0
  assert.deepStrictEqual(rpc.decide(Object.assign({ outcomeClass: 'retryable', attempt: 1, endpointIndex: 0 }, base)),
    { action: 'retry', delayMs: 250 });
  assert.deepStrictEqual(rpc.decide(Object.assign({ outcomeClass: 'retryable', attempt: 2, endpointIndex: 0 }, base)),
    { action: 'retry', delayMs: 500 });
  assert.deepStrictEqual(rpc.decide(Object.assign({ outcomeClass: 'retryable', attempt: 3, endpointIndex: 0 }, base)),
    { action: 'failover', delayMs: 0 });
  // endpoint 1 (last)
  assert.deepStrictEqual(rpc.decide(Object.assign({ outcomeClass: 'retryable', attempt: 3, endpointIndex: 1 }, base)),
    { action: 'fail', delayMs: 0 });
  // fatal never retries anywhere
  assert.deepStrictEqual(rpc.decide(Object.assign({ outcomeClass: 'fatal', attempt: 1, endpointIndex: 0 }, base)),
    { action: 'fail', delayMs: 0 });
  // failover skips remaining same-endpoint attempts
  assert.deepStrictEqual(rpc.decide(Object.assign({ outcomeClass: 'failover', attempt: 1, endpointIndex: 0 }, base)),
    { action: 'failover', delayMs: 0 });
});

// ---------------- full client loop with mock fetch ----------------
test('client: duplicate-ACAO network failure twice, then success on the SAME endpoint (retry path)', async () => {
  let calls = 0;
  const fetchImpl = async function (url, opts) {
    calls++;
    const req = parseBody(opts);
    if (calls <= 2) { throw new TypeError("Failed to fetch"); } // the CORS "*,*" signature
    return rpcResponse(req);
  };
  const c = client(fetchImpl);
  const out = await c.call('eth_chainId', []);
  assert.strictEqual(out, '0x1237');
  assert.strictEqual(calls, 3);
  assert.strictEqual(c.stats.retries, 2);
  assert.strictEqual(c.stats.failovers, 0);
  // every attempt hit the PRIMARY (failover never needed)
  assert.strictEqual(c.stats.requests, 3);
});

test('client: primary exhausted -> failover to secondary succeeds', async () => {
  const seen = [];
  const fetchImpl = async function (url, opts) {
    seen.push(url);
    const req = parseBody(opts);
    if (url === ENDPOINTS[0]) { throw new TypeError('Failed to fetch'); }
    return rpcResponse(req);
  };
  const c = client(fetchImpl);
  const out = await c.call('eth_chainId', []);
  assert.strictEqual(out, '0x1237');
  assert.strictEqual(seen.filter(function (u) { return u === ENDPOINTS[0]; }).length, 3);
  assert.strictEqual(seen[seen.length - 1], ENDPOINTS[1]);
  assert.strictEqual(c.stats.failovers, 1);
});

test('client: all endpoints exhausted throws with the last outcome recorded', async () => {
  const fetchImpl = async function () { throw new TypeError('Failed to fetch'); };
  const c = client(fetchImpl);
  await assert.rejects(function () { return c.call('eth_chainId', []); }, function (err) {
    return err && err.message.indexOf('All RPC endpoints failed') === 0;
  });
  // 3 attempts x 2 endpoints
  assert.strictEqual(c.stats.requests, 6);
});

test('client: HTTP 429 retries then succeeds without failover', async () => {
  let calls = 0;
  const fetchImpl = async function (url, opts) {
    calls++;
    const req = parseBody(opts);
    if (calls === 1) { return { ok: false, status: 429 }; }
    return rpcResponse(req);
  };
  const c = client(fetchImpl);
  const out = await c.call('eth_blockNumber', []);
  assert.strictEqual(out, '0x1237');
  assert.strictEqual(calls, 2);
});

test('client: 403 fails over immediately (UA-gated endpoint, retry is futile)', async () => {
  const seen = [];
  const fetchImpl = async function (url, opts) {
    seen.push(url);
    const req = parseBody(opts);
    if (url === ENDPOINTS[0]) { return { ok: false, status: 403 }; }
    return rpcResponse(req);
  };
  const c = client(fetchImpl);
  const out = await c.call('eth_call', [{ to: '0x0', data: '0x' }, 'latest']);
  assert.strictEqual(out, '0x1237');
  assert.strictEqual(seen.filter(function (u) { return u === ENDPOINTS[0]; }).length, 1);
});

test('client: JSON-RPC -32602 (invalid params) fails fast with no further fetches', async () => {
  let calls = 0;
  const fetchImpl = async function (url, opts) {
    calls++;
    const req = parseBody(opts);
    return rpcResponse(req, { error: { code: -32602, message: 'invalid argument' }, result: undefined });
  };
  const c = client(fetchImpl);
  await assert.rejects(function () { return c.call('eth_call', [{ bad: true }, 'nope']); }, function (err) {
    return err && err.rpcCode === -32602;
  });
  assert.strictEqual(calls, 1);
});

test('client: single-endpoint config fails after its attempt budget', async () => {
  const fetchImpl = async function () { return { ok: false, status: 503 }; };
  const c = client(fetchImpl, { endpoints: [ENDPOINTS[0]] });
  await assert.rejects(function () { return c.call('eth_chainId', []); });
  assert.strictEqual(c.stats.requests, 3);
});

// ---------------- batching ----------------
test('batch: aligned results from a JSON-RPC batch response', async () => {
  const fetchImpl = async function (url, opts) {
    const req = parseBody(opts);
    assert.ok(Array.isArray(req), 'payload must be a JSON-RPC batch array');
    return {
      ok: true,
      status: 200,
      text: async function () {
        return JSON.stringify(req.map(function (r, i) {
          return { jsonrpc: '2.0', id: r.id, result: '0x' + (i + 1).toString(16) };
        }));
      }
    };
  };
  const c = client(fetchImpl);
  const out = await c.batch([
    { method: 'eth_call', params: [{ to: '0x1', data: '0x01' }, 'latest'] },
    { method: 'eth_call', params: [{ to: '0x2', data: '0x02' }, 'latest'] },
    { method: 'eth_call', params: [{ to: '0x3', data: '0x03' }, 'latest'] }
  ]);
  assert.deepStrictEqual(out, ['0x1', '0x2', '0x3']);
  assert.strictEqual(c.stats.batches, 1);
});

test('batch: endpoint that rejects batches falls back to sequential calls, order preserved', async () => {
  const singles = [];
  const fetchImpl = async function (url, opts) {
    const req = parseBody(opts);
    if (Array.isArray(req)) {
      return {
        ok: true, status: 200,
        text: async function () {
          return JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32600, message: 'batch unsupported' } });
        }
      };
    }
    singles.push(req.params[0].to);
    return rpcResponse(req);
  };
  const c = client(fetchImpl);
  const out = await c.batch([
    { method: 'eth_call', params: [{ to: '0xaaaa', data: '0x' }, 'latest'] },
    { method: 'eth_call', params: [{ to: '0xbbbb', data: '0x' }, 'latest'] }
  ]);
  assert.deepStrictEqual(out, ['0x1237', '0x1237']);
  assert.deepStrictEqual(singles, ['0xaaaa', '0xbbbb']);
});

test('batch: retries/failover apply to batched calls too', async () => {
  let calls = 0;
  const fetchImpl = async function (url, opts) {
    calls++;
    const req = parseBody(opts);
    if (calls === 1) { throw new TypeError('Failed to fetch'); }
    assert.ok(Array.isArray(req));
    return {
      ok: true, status: 200,
      text: async function () {
        return JSON.stringify(req.map(function (r) {
          return { jsonrpc: '2.0', id: r.id, result: '0xdead' };
        }));
      }
    };
  };
  const c = client(fetchImpl);
  const out = await c.batch([
    { method: 'eth_call', params: [{ to: '0x1', data: '0x' }, 'latest'] },
    { method: 'eth_call', params: [{ to: '0x2', data: '0x' }, 'latest'] }
  ]);
  assert.deepStrictEqual(out, ['0xdead', '0xdead']);
  assert.strictEqual(calls, 2);
});

test('batch: empty input returns empty; single call short-circuits to call()', async () => {
  const fetchImpl = async function (url, opts) {
    return rpcResponse(parseBody(opts));
  };
  const c = client(fetchImpl);
  assert.deepStrictEqual(await c.batch([]), []);
  assert.deepStrictEqual(await c.batch([{ method: 'eth_chainId', params: [] }]), ['0x1237']);
});
