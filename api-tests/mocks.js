'use strict';

/**
 * Test helpers for the /api/* handler tests. Plain CommonJS, zero dependencies.
 * Named "mocks.js" (not matching any node --test file pattern) so the runner
 * does not execute it as a test.
 */

const { EventEmitter } = require('node:events');

/** Minimal mocked http.ServerResponse — captures status/headers/body. */
function mockRes() {
  return {
    statusCode: 0,
    headers: {},
    ended: false,
    rawBody: null,
    setHeader(k, v) {
      this.headers[String(k).toLowerCase()] = v;
    },
    getHeader(k) {
      return this.headers[String(k).toLowerCase()];
    },
    removeHeader(k) {
      delete this.headers[String(k).toLowerCase()];
    },
    writeHead(status, hdrs) {
      this.statusCode = status;
      for (const [k, v] of Object.entries(hdrs || {})) this.setHeader(k, v);
    },
    end(chunk) {
      if (chunk !== undefined) this.rawBody = chunk;
      this.ended = true;
    },
  };
}

/**
 * Minimal mocked http.IncomingMessage.
 *  - With `body` set, handlers read it directly (Vercel pre-parsed shape).
 *  - With `streamChunks` set (and no body), the handler reads a chunk stream.
 */
function mockReq({ method = 'GET', headers = {}, body, url = '/', streamChunks } = {}) {
  const req = { method, headers, url };
  if (streamChunks) {
    const ee = new EventEmitter();
    ee.headers = headers;
    ee.method = method;
    ee.body = undefined;
    queueMicrotask(() => {
      for (const c of streamChunks) ee.emit('data', Buffer.from(c));
      ee.emit('end');
    });
    return ee;
  }
  req.body = body;
  return req;
}

/** A fetch()-compatible Response-like object (text + json, like the real API). */
function jsonResponse(status, body) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  };
}

/**
 * Deterministic fetch mock. Routes are tried in order:
 *   { match?: (url, bodyObj) => bool, reply?: (url, bodyObj) => response-like,
 *     status?, json?, text?, error? }
 * Records every call; `fn.callCount(urlSubstring?)` asserts how many fetches ran.
 */
function fetchMock(routes = []) {
  const calls = [];
  const fn = async (url, init = {}) => {
    let bodyObj = null;
    if (init && typeof init.body === 'string') {
      try {
        bodyObj = JSON.parse(init.body);
      } catch {
        bodyObj = null;
      }
    }
    calls.push({ url, bodyObj, init });
    for (const r of routes) {
      if (r.match && !r.match(url, bodyObj)) continue;
      if (r.error) throw new Error(r.error);
      if (r.reply) return r.reply(url, bodyObj);
      return jsonResponse(r.status || 200, r.text !== undefined ? r.text : r.json ?? {});
    }
    throw new Error(`fetchMock: no route matched ${url} ${JSON.stringify(bodyObj)}`);
  };
  fn.calls = calls;
  fn.callCount = (urlSubstring) =>
    calls.filter((c) => !urlSubstring || c.url.includes(urlSubstring)).length;
  return fn;
}

const rpcResult = (result) => ({ jsonrpc: '2.0', id: 1, result });
const rpcError = (code, message) => ({ jsonrpc: '2.0', id: 1, error: { code, message } });

/** 32-byte word hex for a BigInt-able value. */
const word = (v) => '0x' + BigInt(v).toString(16).padStart(64, '0');

/** ABI-encoded string return payload for `s` (offset word + length word + data, word-padded). */
function abiStringRaw(s) {
  const dataHex = Buffer.from(s, 'utf8').toString('hex');
  const padded = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64 || 64, '0');
  return '0x' + word(0x20).slice(2) + word(Buffer.byteLength(s, 'utf8')).slice(2) + padded;
}

module.exports = { mockRes, mockReq, jsonResponse, fetchMock, rpcResult, rpcError, word, abiStringRaw };
