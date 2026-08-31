'use strict';

/**
 * GET /api/health — liveness of the RPC path behind the /api/* enhancements.
 *
 * Performs a REAL chain read (eth_chainId — the canonical chainId RPC method, not a
 * static response) with endpoint failover, and reports observed latency.
 * ok is true only when the reply resolves to the expected chain id (4663 / 0x1237).
 * No cache — every call re-measures.
 */

const {
  CHAIN_ID_EXPECTED,
  CHAIN_ID_HEX,
  handleOptions,
  sendJson,
  rpcWithFailover,
} = require('./lib/shared.js');

// Test seams (no-ops in production): inject a fake fetch impl / clock.
let _fetch = (...args) => globalThis.fetch(...args);
let _clock = () => Date.now();

async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method not allowed — use GET' }, { allow: 'GET' });
  }

  const t0 = _clock();
  const r = await rpcWithFailover(_fetch, { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
  const latencyMs = Math.max(0, Math.round(_clock() - t0));

  const attempts = r.attempts || [];
  if (!r.ok || !r.json || typeof r.json.result !== 'string') {
    return sendJson(res, 502, {
      ok: false,
      chainId: null,
      expectedChainId: CHAIN_ID_EXPECTED,
      latencyMs,
      method: 'eth_chainId',
      error: (r.json && r.json.error) || r.error || 'no result from any upstream',
      attempts,
    });
  }

  const chainId = Number.parseInt(r.json.result, 16);
  const ok = chainId === CHAIN_ID_EXPECTED;
  return sendJson(res, ok ? 200 : 502, {
    ok,
    chainId,
    chainIdHex: r.json.result,
    expectedChainId: CHAIN_ID_EXPECTED,
    expectedChainIdHex: CHAIN_ID_HEX,
    latencyMs,
    method: 'eth_chainId',
    upstream: r.upstream.name,
    attempts,
    timestamp: new Date(t0).toISOString(),
  });
}

module.exports = handler;
module.exports.default = handler;
module.exports._setFetch = (fn) => (_fetch = fn);
module.exports._setClock = (fn) => (_clock = fn);
