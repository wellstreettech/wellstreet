'use strict';

/**
 * POST /api/rpc — JSON-RPC passthrough proxy with endpoint failover.
 *
 * Forwards the request body to the first healthy upstream and returns its JSON
 * response verbatim (status included). Fails over on network errors, 429 and 5xx.
 * No cache — a proxy must not serve stale chain state.
 *
 * Request-size guard: 256 KB hard cap, enforced at three layers —
 *   1. the Vercel bodyParser config below (platform-level 413),
 *   2. the Content-Length header check before reading,
 *   3. the stream-accumulation cap while reading.
 *
 * Honest note on trust: this is a pure passthrough, so it also relays write
 * methods (e.g. eth_sendRawTransaction) from any CORS origin. Read-only method
 * allowlisting is a deliberate build-time decision left open — the frontend is
 * serverless-clean (direct browser eth_calls) and treats this endpoint as an
 * optional reliability enhancement only.
 */

const { BODY_LIMIT_BYTES, handleOptions, sendJson, rpcWithFailover } = require('./lib/shared.js');

// Platform-level belt (Vercel): reject oversized bodies before the handler runs.
module.exports.config = { api: { bodyParser: { sizeLimit: '256kb' } } };

let _fetch = (...args) => globalThis.fetch(...args);

/** JSON-RPC 2.0 shape check — accepts a single object or a batch array. */
function isJsonRpcShape(body) {
  const one = (b) =>
    b !== null && typeof b === 'object' && !Array.isArray(b) && typeof b.method === 'string';
  if (Array.isArray(body)) return body.length > 0 && body.every(one);
  return one(body);
}

/**
 * Read the request body with the size cap enforced. Prefers the pre-parsed
 * req.body (Vercel default bodyParser), falls back to chunk accumulation
 * (bodyParser disabled / streamed mocks). Returns { ok, value } |
 * { tooLarge: true } | { ok: false, parseError }.
 */
async function readJsonBody(req, limit) {
  const cl = req.headers && req.headers['content-length'];
  if (cl) {
    const n = Number(cl);
    if (Number.isFinite(n) && n > limit) return { tooLarge: true };
  }

  let raw;
  if (req.body !== undefined && req.body !== null) {
    raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  } else {
    const chunks = [];
    let size = 0;
    let oversized = false;
    raw = await new Promise((resolve) => {
      const onData = (c) => {
        size += c.length;
        if (size > limit) {
          oversized = true;
          resolve(null);
          return;
        }
        chunks.push(c);
      };
      req.on('data', onData);
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', () => resolve(null));
    });
    if (oversized) return { tooLarge: true };
  }

  if (raw === null) return { ok: false, parseError: 'request stream error' };
  if (Buffer.byteLength(String(raw), 'utf8') > limit) return { tooLarge: true };
  try {
    return { ok: true, value: JSON.parse(String(raw) || 'null') };
  } catch (e) {
    return { ok: false, parseError: String((e && e.message) || e) };
  }
}

async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method not allowed — JSON-RPC proxy accepts POST only' }, { allow: 'POST' });
  }

  const body = await readJsonBody(req, BODY_LIMIT_BYTES);
  if (body.tooLarge) {
    return sendJson(res, 413, { ok: false, error: `request body exceeds the ${BODY_LIMIT_BYTES} byte limit` });
  }
  if (!body.ok) {
    return sendJson(res, 400, { ok: false, error: 'request body is not valid JSON', detail: body.parseError });
  }
  if (!isJsonRpcShape(body.value)) {
    return sendJson(res, 400, { ok: false, error: 'expected a JSON-RPC 2.0 request object (or batch) with a "method" string' });
  }

  const r = await rpcWithFailover(_fetch, body.value);
  if (r.ok) {
    return sendJson(res, r.status, r.json);
  }
  return sendJson(res, 502, {
    jsonrpc: '2.0',
    id: !Array.isArray(body.value) && body.value ? body.value.id ?? null : null,
    error: {
      code: -32000,
      message: 'all upstream RPC endpoints failed',
      data: { attempts: r.attempts },
    },
  });
}

module.exports = handler;
module.exports.default = handler;
module.exports._setFetch = (fn) => (_fetch = fn);
module.exports._readJsonBody = readJsonBody;
module.exports._isJsonRpcShape = isJsonRpcShape;
