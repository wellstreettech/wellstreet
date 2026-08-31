'use strict';

/**
 * GET /api/prices — tokenized-stock quotes with honest provenance.
 *
 * PRIMARY: Chainlink AggregatorV3Interface.latestRoundData on 4663 (phase-0 probe
 * (f) proved the RHSPY/USD + RHNVDA/USD feeds readable and NOT permissioned; 8
 * decimals). humanPrice = rawAnswer / 10^decimals via exact BigInt decimal shift.
 * The Robinhood feed value ALREADY includes the token uiMultiplier — never apply
 * it a second time.
 *
 * SECONDARY (only when the Chainlink read fails): Blockscout REST exchange_rate
 * with a browser-like User-Agent (plain UA gets 403).
 *
 * PROVENANCE / honest-display rule (spec H): every quote names its source, and the
 * Uniswap pool slot0 price is NEVER the sole displayed price — it is a manipulable
 * swap input, which the swap service's own deviation guard exists to catch. This
 * endpoint therefore reports the oracle as the formula source.
 *
 * STALENESS (market-hours aware, 24/5 feeds): a feed older than 4h during a UTC
 * weekday is flagged stale:true (fault signal) but is STILL RETURNED with its age —
 * the flag never degrades the response. Weekend staleness is the expected off-session
 * state (phase-0 observed a 49 h Sunday staleness — normal) and is not flagged.
 * US market holidays are not modeled (documented limitation; the flag is informational).
 * No in-memory cache (CDN header hint only).
 */

const {
  CHAIN_ID_EXPECTED,
  SEL,
  FEEDS,
  FEED_TABLE,
  handleOptions,
  sendJson,
  ethCall,
  hexToBigInt,
  splitWords,
  wordToSignedInt,
  decodeAbiString,
  normalizeDecimal,
  marketStaleness,
  blockscoutExchangeRate,
} = require('./lib/shared.js');

const CACHE_HEADER = 'public, max-age=30';

let _fetch = (...args) => globalThis.fetch(...args);
let _clock = () => Date.now();

/** Decode latestRoundData: 5 words — roundId, answer, startedAt, updatedAt, answeredInRound. */
function decodeRoundData(raw) {
  const words = splitWords(raw, 5);
  return {
    roundId: BigInt('0x' + words[0]),
    answer: wordToSignedInt(words[1]),
    updatedAtSec: Number(hexToBigInt('0x' + words[3])),
    answeredInRound: BigInt('0x' + words[4]),
  };
}

async function loadFeed(fetchImpl, symbol, nowSec) {
  const cfg = FEEDS[symbol];
  const proxy = cfg.proxies[0];

  const [roundRes, decRes, descRes] = await Promise.all([
    ethCall(fetchImpl, proxy, SEL.latestRoundData),
    ethCall(fetchImpl, proxy, SEL.decimals),
    ethCall(fetchImpl, proxy, SEL.description),
  ]);

  const base = {
    symbol,
    name: cfg.name,
    token: cfg.token,
    proxy,
    alternateProxies: cfg.proxies.slice(1),
  };

  if (!roundRes.ok) {
    // Chainlink unreachable → secondary source (Blockscout exchange_rate).
    const sec = await blockscoutExchangeRate(fetchImpl, cfg.token);
    const chainlinkError = roundRes.rpcError
      ? `RPC error ${roundRes.rpcError.code || ''}: ${roundRes.rpcError.message || ''}`.trim()
      : roundRes.error || 'eth_call failed';
    if (sec.ok) {
      return {
        ...base,
        price: { value: sec.rate, exact: String(sec.rate) },
        raw: null,
        decimals: null,
        source: 'blockscout-exchange-rate',
        sourceDetail: { endpoint: sec.endpoint },
        formulaSource: 'secondary-aggregator',
        stale: null,
        staleReason: 'staleness unknown — the secondary source exposes no timestamp',
        chainlinkError,
      };
    }
    return {
      ...base,
      price: null,
      source: null,
      error: 'primary and secondary sources both unavailable',
      chainlinkError,
      secondaryError: sec.error,
    };
  }

  let round;
  try {
    round = decodeRoundData(roundRes.raw);
  } catch (e) {
    return { ...base, price: null, source: 'chainlink', error: `latestRoundData decode failed: ${String((e && e.message) || e)}` };
  }

  // decimals()/description() failures are non-fatal: 8 decimals is the verified
  // constant for every feed in the phase-0 table.
  let decimals = 8;
  if (decRes.ok) {
    try {
      decimals = Number(hexToBigInt(decRes.raw));
    } catch {}
  }
  let description = null;
  if (descRes.ok) {
    try {
      description = decodeAbiString(descRes.raw);
    } catch {}
  }

  if (round.answer < 0n) {
    return { ...base, price: null, source: 'chainlink', error: 'negative oracle answer — treating as invalid', decimals };
  }

  const norm = normalizeDecimal(round.answer.toString(), decimals);
  const staleness = marketStaleness(round.updatedAtSec, nowSec);
  const roundCurrent = round.answeredInRound >= round.roundId;

  return {
    ...base,
    decimals,
    raw: round.answer.toString(),
    price: { exact: norm.exact, value: norm.value },
    roundId: round.roundId.toString(),
    updatedAt: new Date(round.updatedAtSec * 1000).toISOString(),
    updatedAtUnix: round.updatedAtSec,
    ageSeconds: staleness.ageSeconds,
    stale: staleness.stale || !roundCurrent,
    staleExpected: staleness.expected,
    staleReason: !roundCurrent
      ? 'latest round not fully answered (answeredInRound < roundId)'
      : staleness.reason,
    source: 'chainlink',
    sourceDetail: {
      proxy,
      aggregator: cfg.aggregator,
      description,
      method: 'AggregatorV3Interface.latestRoundData',
    },
    formulaSource: 'oracle',
  };
}

async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method not allowed — use GET' }, { allow: 'GET' });
  }

  const nowMs = _clock();
  const nowSec = Math.floor(nowMs / 1000);

  const symbols = Object.keys(FEEDS);
  const entries = await Promise.all(symbols.map((s) => loadFeed(_fetch, s, nowSec)));

  const feeds = {};
  const errors = [];
  let usable = 0;
  for (const e of entries) {
    feeds[e.symbol] = e;
    if (e && e.price && Number.isFinite(e.price.value)) usable++;
    else errors.push(e.symbol);
  }

  const ok = usable > 0;
  return sendJson(
    res,
    ok ? 200 : 502,
    {
      ok,
      chainId: CHAIN_ID_EXPECTED,
      generatedAt: new Date(nowMs).toISOString(),
      primarySource: 'chainlink',
      secondarySource: 'blockscout-exchange-rate',
      provenance: {
        primary: 'Chainlink AggregatorV3Interface.latestRoundData (equity feeds, 8 decimals) read via eth_call on chain 4663',
        formula: 'humanPrice = rawAnswer / 10^feedDecimals — the feed value already includes the token uiMultiplier, so it is never applied a second time',
        secondary: 'Blockscout REST exchange_rate (browser-like User-Agent) — used only when the Chainlink read fails',
        slot0: 'Uniswap pool slot0 is a manipulable swap-price input and is never the sole displayed price',
      },
      feeds,
      feedTable: FEED_TABLE,
      feedTableNote:
        'Full on-chain feed discovery from the phase-0 probe. Only feeds with recorded proxy addresses are quoted; the remaining addresses are re-pinned at build time using the same on-chain discovery method.',
      ...(ok ? {} : { errors }),
    },
    { 'cache-control': CACHE_HEADER }
  );
}

module.exports = handler;
module.exports.default = handler;
module.exports._setFetch = (fn) => (_fetch = fn);
module.exports._setClock = (fn) => (_clock = fn);
