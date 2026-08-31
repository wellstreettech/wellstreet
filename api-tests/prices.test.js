'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const prices = require('../api/prices.js');
const shared = require('../api/lib/shared.js');
const { mockReq, mockRes, fetchMock, rpcResult, word, abiStringRaw } = require('./mocks.js');

const RH = 'https://rpc.mainnet.chain.robinhood.com';
const BS_REST = 'https://robinhoodchain.blockscout.com/api/v2';
const SPY_PROXY = shared.FEEDS.SPY.proxies[0];
const NVDA_PROXY = shared.FEEDS.NVDA.proxies[0];
const SPY_TOKEN = shared.FEEDS.SPY.token;

const SPY_ROUND_ID = 18446744073709551728n; // phase-0 capture (2^64 + 112)
const SPY_ANSWER = 77026515000n; // → $770.26515
const NVDA_ANSWER = 21815545000n; // → $218.15545

const roundDataRaw = (answer, updatedAtSec) =>
  '0x' +
  word(SPY_ROUND_ID).slice(2) +
  word(answer).slice(2) +
  word(1787933907).slice(2) + // startedAt (phase-0 capture)
  word(updatedAtSec).slice(2) +
  word(SPY_ROUND_ID).slice(2); // answeredInRound == roundId (fully answered)

function chainlinkRoutes({ spyUpdatedAt, nvdaUpdatedAt, nvdaAnswer = NVDA_ANSWER, spyFails = false }) {
  const route = (to, selector, result) => ({
    match: (url, b) =>
      url === RH && b.params[0].to === to && b.params[0].data.slice(0, 10) === selector,
    json: rpcResult(result),
  });
  const routes = [];
  if (spyFails) {
    routes.push({
      match: (url, b) => url === RH && b.params[0].to === SPY_PROXY,
      error: 'chainlink unreachable',
    });
  } else {
    routes.push(
      route(SPY_PROXY, shared.SEL.latestRoundData, roundDataRaw(SPY_ANSWER, spyUpdatedAt)),
      route(SPY_PROXY, shared.SEL.decimals, word(8)),
      route(SPY_PROXY, shared.SEL.description, abiStringRaw('RHSPY / USD'))
    );
  }
  routes.push(
    route(NVDA_PROXY, shared.SEL.latestRoundData, roundDataRaw(nvdaAnswer, nvdaUpdatedAt)),
    route(NVDA_PROXY, shared.SEL.decimals, word(8)),
    route(NVDA_PROXY, shared.SEL.description, abiStringRaw('RHNVDA / USD'))
  );
  return routes;
}

test('prices: chainlink quotes with exact 8-decimal normalization and honest provenance', async () => {
  const nowSec = Date.UTC(2026, 8, 1, 14, 0, 0) / 1000; // Tuesday 2026-09-01 14:00 UTC
  prices._setClock(() => nowSec * 1000);
  const fetch = fetchMock(
    chainlinkRoutes({ spyUpdatedAt: nowSec - 1000, nvdaUpdatedAt: nowSec - 1000 })
  );
  prices._setFetch(fetch);

  const res = mockRes();
  await prices(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, true);
  assert.equal(body.chainId, 4663);
  assert.equal(body.primarySource, 'chainlink');

  const spy = body.feeds.SPY;
  assert.equal(spy.source, 'chainlink');
  assert.equal(spy.formulaSource, 'oracle');
  assert.equal(spy.raw, '77026515000');
  assert.equal(spy.price.exact, '770.26515');
  assert.equal(spy.price.value, 770.26515);
  assert.equal(spy.decimals, 8);
  assert.equal(spy.stale, false);
  assert.equal(spy.staleReason, 'fresh');
  assert.equal(spy.sourceDetail.description, 'RHSPY / USD');
  assert.equal(spy.sourceDetail.aggregator, shared.FEEDS.SPY.aggregator);
  assert.equal(spy.sourceDetail.method, 'AggregatorV3Interface.latestRoundData');

  const nvda = body.feeds.NVDA;
  assert.equal(nvda.price.exact, '218.15545');

  // provenance block: slot0 is never the sole displayed price
  assert.equal(body.provenance.primary.includes('Chainlink'), true);
  assert.equal(body.provenance.slot0.includes('slot0'), true);
  assert.equal(body.provenance.formula.includes('uiMultiplier'), true);
  assert.equal(body.provenance.secondary.includes('Blockscout'), true);

  // full feed table included
  assert.equal(body.feedTable.length, 26);
  const spyRow = body.feedTable.find((f) => f.description === 'RHSPY/USD');
  assert.equal(spyRow.proxies.length, 2);
  const unaddressed = body.feedTable.find((f) => f.description === 'Robinhood AAPL/USD');
  assert.deepEqual(unaddressed.proxies, []);

  assert.equal(res.headers['cache-control'], 'public, max-age=30');
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('prices: weekday staleness > 4h flags stale:true but still returns the last value + age', async () => {
  const nowSec = Date.UTC(2026, 8, 1, 14, 0, 0) / 1000; // Tuesday
  prices._setClock(() => nowSec * 1000);
  prices._setFetch(
    fetchMock(chainlinkRoutes({ spyUpdatedAt: nowSec - 1000, nvdaUpdatedAt: nowSec - 5 * 3600 }))
  );

  const res = mockRes();
  await prices(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, true); // the flag never degrades the response
  const nvda = body.feeds.NVDA;
  assert.equal(nvda.stale, true);
  assert.equal(nvda.ageSeconds, 5 * 3600);
  assert.equal(nvda.price.value, 218.15545);
  assert.equal(typeof nvda.updatedAt, 'string');
  assert.equal(nvda.staleReason.includes('weekday'), true);
});

test('prices: weekend staleness is expected — not flagged (49h Sunday case from phase-0)', async () => {
  const sunSec = Date.UTC(2026, 7, 30, 17, 20, 7) / 1000; // Sunday probe anchor
  prices._setClock(() => sunSec * 1000);
  prices._setFetch(
    fetchMock(chainlinkRoutes({ spyUpdatedAt: sunSec - 1000, nvdaUpdatedAt: sunSec - 49 * 3600 }))
  );

  const res = mockRes();
  await prices(mockReq({ method: 'GET' }), res);
  const body = JSON.parse(res.rawBody);
  const nvda = body.feeds.NVDA;
  assert.equal(nvda.stale, false);
  assert.equal(nvda.staleExpected, true);
  assert.equal(nvda.ageSeconds, 49 * 3600);
});

test('prices: chainlink unreachable → secondary Blockscout exchange_rate with browser UA', async () => {
  const nowSec = Date.UTC(2026, 8, 1, 14, 0, 0) / 1000;
  prices._setClock(() => nowSec * 1000);
  const fetch = fetchMock([
    ...chainlinkRoutes({ spyUpdatedAt: nowSec - 1000, nvdaUpdatedAt: nowSec - 1000, spyFails: true }),
    {
      match: (url) => url === `${BS_REST}/tokens/${SPY_TOKEN}`,
      json: { exchange_rate: '778.66' },
    },
  ]);
  prices._setFetch(fetch);

  const res = mockRes();
  await prices(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, true);
  const spy = body.feeds.SPY;
  assert.equal(spy.source, 'blockscout-exchange-rate');
  assert.equal(spy.price.value, 778.66);
  assert.equal(spy.stale, null);
  assert.equal(typeof spy.chainlinkError, 'string');
  // NVDA unaffected — still chainlink
  assert.equal(body.feeds.NVDA.source, 'chainlink');
  // the Blockscout REST call carried the browser-like User-Agent
  const restCall = fetch.calls.find((c) => c.url.includes('/api/v2/tokens/'));
  assert.equal(restCall.init.headers['user-agent'], shared.BROWSER_UA);
});

test('prices: both sources failing for every feed → 502 {ok:false} with per-feed errors', async () => {
  prices._setClock(() => Date.UTC(2026, 8, 1, 14, 0, 0));
  prices._setFetch(
    fetchMock([
      { match: (url) => url.startsWith(RH), error: 'network down' },
      { match: (url) => url.startsWith(BS_REST), status: 500, json: { error: 'boom' } },
    ])
  );

  const res = mockRes();
  await prices(mockReq({ method: 'GET' }), res);

  assert.equal(res.statusCode, 502);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.ok, false);
  assert.deepEqual(body.errors, ['SPY', 'NVDA']);
  assert.equal(body.feeds.SPY.error.includes('primary and secondary'), true);
});

test('prices: incomplete round (answeredInRound < roundId) is flagged stale', async () => {
  const nowSec = Date.UTC(2026, 8, 1, 14, 0, 0) / 1000;
  prices._setClock(() => nowSec * 1000);
  const fresh = nowSec - 10;
  const raw =
    '0x' +
    word(100n).slice(2) + // roundId
    word(SPY_ANSWER).slice(2) +
    word(fresh - 5).slice(2) +
    word(fresh).slice(2) +
    word(99n).slice(2); // answeredInRound < roundId
  prices._setFetch(
    fetchMock([
      {
        match: (url, b) => url === RH && b.params[0].to === SPY_PROXY && b.params[0].data.slice(0, 10) === shared.SEL.latestRoundData,
        json: rpcResult(raw),
      },
      {
        match: (url, b) => url === RH && b.params[0].to === SPY_PROXY,
        json: rpcResult(word(8)),
      },
      {
        match: (url, b) => url === RH && b.params[0].to === NVDA_PROXY && b.params[0].data.slice(0, 10) === shared.SEL.latestRoundData,
        json: rpcResult(roundDataRaw(NVDA_ANSWER, fresh)),
      },
      { match: (url, b) => url === RH && b.params[0].to === NVDA_PROXY, json: rpcResult(word(8)) },
    ])
  );

  const res = mockRes();
  await prices(mockReq({ method: 'GET' }), res);
  const body = JSON.parse(res.rawBody);
  assert.equal(body.feeds.SPY.stale, true);
  assert.equal(body.feeds.SPY.staleReason.includes('answeredInRound'), true);
});

test('prices: GET-only — POST → 405, OPTIONS → 204', async () => {
  prices._setClock(() => Date.UTC(2026, 8, 1, 14, 0, 0));
  prices._setFetch(fetchMock([]));

  const post = mockRes();
  await prices(mockReq({ method: 'POST', body: {} }), post);
  assert.equal(post.statusCode, 405);

  const opt = mockRes();
  await prices(mockReq({ method: 'OPTIONS' }), opt);
  assert.equal(opt.statusCode, 204);
  assert.equal(opt.headers['access-control-allow-origin'], '*');
});
