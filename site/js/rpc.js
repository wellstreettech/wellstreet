/*
 * Wellstreet site — rpc.js
 * JSON-RPC client for direct browser reads (serverless-clean, D8).
 *
 * WHY THE RETRY/FAILOVER DESIGN EXISTS (phase-0 probe (e), docs/ops/phase0/tokens-oracle-rpc.md §2.2):
 * The primary public RPC intermittently emits a DUPLICATE Access-Control-Allow-Origin
 * header ("*,*"). Chromium rejects such responses outright ("...contains multiple values
 * '*,*', but only one is allowed") — 7 of 15 probe page loads (~47%) failed MID-SEQUENCE,
 * and the failure is INVISIBLE to curl/header checks (curl always saw a single header).
 * There were ZERO HTTP 429s at page-load cadence from the primary.
 * The block is intermittent PER RESPONSE — a retry typically lands clean — hence:
 *   1. per-endpoint fetch retry (3 attempts, exponential backoff), then
 *   2. endpoint failover (primary -> secondary).
 * The decision logic below is PURE (decide/classifyFailure/backoffDelay) so it is unit
 * testable; the client itself takes an injectable fetch implementation for tests.
 *
 * No npm, no build step, no dependencies.
 */
(function (root, factory) {
  var api = factory();
  root.WS = root.WS || {};
  root.WS.rpc = api;
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  'use strict';

  // ------------------------------------------------------------------
  // PURE: exponential backoff. attempt starts at 1. No jitter (deterministic).
  // ------------------------------------------------------------------
  function backoffDelay(attempt, baseMs, capMs) {
    var base = Math.max(0, baseMs == null ? 250 : baseMs);
    var cap = Math.max(base, capMs == null ? 4000 : capMs);
    var a = Math.max(1, attempt | 0);
    var delay = base * Math.pow(2, a - 1);
    return Math.min(delay, cap);
  }

  // ------------------------------------------------------------------
  // PURE: classify a failure outcome into a strategy class.
  //   outcome: {kind:'network'}                    fetch threw (CORS dup, offline, DNS)
  //            {kind:'timeout'}                    AbortController fired
  //            {kind:'http', status}               non-2xx HTTP
  //            {kind:'rpc', code}                  JSON-RPC error object
  // Classes:
  //   'retryable' — same endpoint may succeed on retry (CORS dup class; 429; 5xx)
  //   'failover'  — skip remaining attempts on this endpoint (401/403/404 UA/CF-gated;
  //                 -32601 method not supported by this endpoint)
  //   'fatal'     — deterministic failure; retrying elsewhere is wasted (bad params, parse)
  // ------------------------------------------------------------------
  function classifyFailure(outcome) {
    if (!outcome || typeof outcome !== 'object') { return 'fatal'; }
    switch (outcome.kind) {
      case 'network':
      case 'timeout':
        return 'retryable';
      case 'http': {
        var s = outcome.status | 0;
        if (s === 408 || s === 429 || s >= 500) { return 'retryable'; }
        if (s === 401 || s === 403 || s === 404) { return 'failover'; }
        return 'failover'; // other 4xx: endpoint-specific, try the next one
      }
      case 'rpc': {
        var c = outcome.code | 0;
        if (c === -32601) { return 'failover'; }   // method not found on this endpoint
        if (c === -32005) { return 'retryable'; }  // limit exceeded
        if (c === -32603) { return 'retryable'; }  // internal error (often transient)
        return 'fatal';                            // -32602 invalid params etc.
      }
      default:
        return 'fatal';
    }
  }

  // ------------------------------------------------------------------
  // PURE: the retry/failover scheduler. Given where we are and the outcome class,
  // decide the next action. This is the heart of the CORS-find mitigation.
  // ------------------------------------------------------------------
  function decide(state) {
    var outcomeClass = state.outcomeClass;
    var attempt = Math.max(1, state.attempt | 0);
    var attemptsPerEndpoint = Math.max(1, state.attemptsPerEndpoint | 0);
    var endpointIndex = Math.max(0, state.endpointIndex | 0);
    var endpointCount = Math.max(1, state.endpointCount | 0);
    var baseMs = state.backoffBaseMs;
    var capMs = state.backoffCapMs;

    if (outcomeClass === 'fatal') { return { action: 'fail', delayMs: 0 }; }

    if (outcomeClass === 'retryable' && attempt < attemptsPerEndpoint) {
      return { action: 'retry', delayMs: backoffDelay(attempt, baseMs, capMs) };
    }
    // retries exhausted on this endpoint (or outcome was 'failover'): move on
    if (endpointIndex + 1 < endpointCount) {
      return { action: 'failover', delayMs: 0 };
    }
    return { action: 'fail', delayMs: 0 };
  }

  // ------------------------------------------------------------------
  // Client factory. opts:
  //   endpoints            [url, ...]            (required)
  //   fetchImpl            injectable fetch      (default global fetch)
  //   attemptsPerEndpoint  3                     (config.rpc)
  //   backoffBaseMs/CapMs, timeoutMs             (config.rpc)
  //   sleepFn              injectable delay      (default setTimeout promise)
  //   nowFn                injectable clock
  // ------------------------------------------------------------------
  function createRpcClient(opts) {
    var endpoints = opts.endpoints;
    if (!endpoints || !endpoints.length) { throw new Error('createRpcClient: endpoints required'); }
    var attemptsPerEndpoint = opts.attemptsPerEndpoint || 3;
    var backoffBaseMs = opts.backoffBaseMs == null ? 250 : opts.backoffBaseMs;
    var backoffCapMs = opts.backoffCapMs == null ? 4000 : opts.backoffCapMs;
    var timeoutMs = opts.timeoutMs == null ? 20000 : opts.timeoutMs;
    var batchMaxCalls = opts.batchMaxCalls || 16;
    var fetchImpl = opts.fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    if (!fetchImpl) { throw new Error('createRpcClient: no fetch implementation available'); }
    var sleepFn = opts.sleepFn || function (ms) {
      return new Promise(function (resolve) { setTimeout(resolve, ms); });
    };

    var stats = { requests: 0, retries: 0, failovers: 0, failures: 0, batches: 0 };
    var nextId = 1;

    async function attemptFetch(endpoint, body) {
      var controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      var timer = null;
      if (controller) { timer = setTimeout(function () { controller.abort(); }, timeoutMs); }
      try {
        var res = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          signal: controller ? controller.signal : undefined
        });
        if (!res.ok) { return { kind: 'http', status: res.status }; }
        var text = await res.text();
        var json;
        try { json = JSON.parse(text); } catch (e) { return { kind: 'network' }; }
        return { kind: 'json', json: json };
      } catch (err) {
        if (err && (err.name === 'AbortError' || String(err.message || '').indexOf('abort') !== -1)) {
          return { kind: 'timeout' };
        }
        // fetch() TypeError: includes the duplicate-ACAO CORS rejection class
        return { kind: 'network' };
      } finally {
        if (timer !== null) { clearTimeout(timer); }
      }
    }

    // Core loop: walk endpoints x attempts, consulting decide() after each failure.
    async function execute(payload) {
      var body = JSON.stringify(payload);
      var lastOutcome = null;
      var lastError = null;
      for (var ei = 0; ei < endpoints.length; ei++) {
        var attempt = 1;
        while (true) {
          stats.requests++;
          var outcome = await attemptFetch(endpoints[ei], body);
          if (outcome.kind === 'json') {
            var json = Array.isArray(outcome.json) ? outcome.json[0] : outcome.json;
            if (json && typeof json === 'object') {
              if (json.id !== undefined && payload.id !== undefined && json.id !== payload.id) {
                // mismatched response id: treat as transient garbage
                outcome = { kind: 'network' };
              } else if (json.error) {
                outcome = { kind: 'rpc', code: json.error.code, message: json.error.message };
                var cls = classifyFailure(outcome);
                if (cls === 'fatal') {
                  var rpcErr = new Error('RPC error ' + json.error.code + ': ' + (json.error.message || ''));
                  rpcErr.rpcCode = json.error.code;
                  rpcErr.outcome = outcome;
                  throw rpcErr;
                }
              } else if ('result' in json) {
                return json.result;
              } else {
                outcome = { kind: 'network' };
              }
            } else {
              outcome = { kind: 'network' };
            }
          }
          lastOutcome = outcome;
          var decision = decide({
            outcomeClass: classifyFailure(outcome),
            attempt: attempt,
            attemptsPerEndpoint: attemptsPerEndpoint,
            endpointIndex: ei,
            endpointCount: endpoints.length,
            backoffBaseMs: backoffBaseMs,
            backoffCapMs: backoffCapMs
          });
          if (decision.action === 'fail') {
            stats.failures++;
            var err = new Error('All RPC endpoints failed (last outcome: ' + JSON.stringify(lastOutcome) + ')');
            err.outcome = lastOutcome;
            throw err;
          }
          if (decision.action === 'retry') {
            stats.retries++;
            attempt++;
            await sleepFn(decision.delayMs);
            continue;
          }
          // failover
          stats.failovers++;
          break;
        }
      }
      // unreachable: decide() throws/fails before loop exit, but be explicit
      stats.failures++;
      throw new Error('All RPC endpoints failed');
    }

    // Single JSON-RPC call. Returns the raw `result` field.
    async function call(method, params) {
      return execute({ jsonrpc: '2.0', id: nextId++, method: method, params: params || [] });
    }

    // Batched eth_calls: [{method, params}, ...] -> aligned results array.
    // If the endpoint answers a batch with a single (non-array) object — some
    // gateways do not support batching — fall back to sequential single calls.
    async function batch(calls) {
      if (!Array.isArray(calls)) { throw new Error('batch: calls must be an array'); }
      if (calls.length === 0) { return []; }
      if (calls.length === 1) { return [await call(calls[0].method, calls[0].params)]; }
      if (calls.length > batchMaxCalls) { throw new Error('batch: too many calls (' + calls.length + ' > ' + batchMaxCalls + ')'); }
      stats.batches++;
      var payload = calls.map(function (c) {
        return { jsonrpc: '2.0', id: nextId++, method: c.method, params: c.params || [] };
      });
      try {
        var result = await executeBatch(payload);
        return result;
      } catch (err) {
        if (err && err.unsupportedBatch) {
          // sequential fallback, preserving order; individual failures reject the whole batch
          var out = new Array(calls.length);
          for (var i = 0; i < calls.length; i++) {
            out[i] = await call(calls[i].method, calls[i].params);
          }
          return out;
        }
        throw err;
      }
    }

    async function executeBatch(payload) {
      var body = JSON.stringify(payload);
      for (var ei = 0; ei < endpoints.length; ei++) {
        var attempt = 1;
        while (true) {
          stats.requests++;
          var outcome = await attemptFetch(endpoints[ei], body);
          if (outcome.kind === 'json') {
            var json = outcome.json;
            if (Array.isArray(json)) {
              var byId = {};
              for (var i = 0; i < json.length; i++) {
                if (json[i] && json[i].id !== undefined) { byId[json[i].id] = json[i]; }
              }
              var results = new Array(payload.length);
              var fatal = null;
              for (var j = 0; j < payload.length; j++) {
                var item = byId[payload[j].id];
                if (!item) { fatal = new Error('batch response missing id ' + payload[j].id); break; }
                if (item.error) {
                  fatal = new Error('RPC error ' + item.error.code + ': ' + (item.error.message || ''));
                  fatal.rpcCode = item.error.code;
                  break;
                }
                results[j] = item.result;
              }
              if (fatal) {
                fatal.unsupportedBatch = true; // fall back to sequential for diagnosis
                throw fatal;
              }
              return results;
            }
            if (json && json.error) {
              // whole batch rejected by this endpoint (e.g. batching unsupported)
              var err = new Error('batch rejected: ' + json.error.code + ' ' + (json.error.message || ''));
              err.unsupportedBatch = true;
              throw err;
            }
            outcome = { kind: 'network' };
          }
          var decision = decide({
            outcomeClass: classifyFailure(outcome),
            attempt: attempt,
            attemptsPerEndpoint: attemptsPerEndpoint,
            endpointIndex: ei,
            endpointCount: endpoints.length,
            backoffBaseMs: backoffBaseMs,
            backoffCapMs: backoffCapMs
          });
          if (decision.action === 'fail') {
            stats.failures++;
            var failErr = new Error('All RPC endpoints failed for batch (last outcome: ' + JSON.stringify(outcome) + ')');
            failErr.outcome = outcome;
            throw failErr;
          }
          if (decision.action === 'retry') {
            stats.retries++;
            attempt++;
            await sleepFn(decision.delayMs);
            continue;
          }
          stats.failovers++;
          break;
        }
      }
      stats.failures++;
      throw new Error('All RPC endpoints failed for batch');
    }

    return {
      call: call,
      batch: batch,
      endpoints: endpoints.slice(),
      stats: stats
    };
  }

  return {
    backoffDelay: backoffDelay,
    classifyFailure: classifyFailure,
    decide: decide,
    createRpcClient: createRpcClient
  };
});
