'use strict';

/**
 * Wellstreet — shared zero-dependency helpers for the /api/* serverless functions.
 *
 * Design rules (from the locked spec + decisions):
 *  - Zero npm dependencies. Node built-ins + global fetch only (Node 18+ runtime).
 *  - The 4 /api/* functions are CACHING/UX ENHANCEMENTS, never a dependency — the
 *    frontend renders fully without them (serverless-clean requirement), so every
 *    endpoint must degrade gracefully and never leak failure into the UI contract.
 *  - All upstreams are PUBLIC, keyless endpoints (no secrets in code or env here).
 *    A Wellstreet-owned RPC can be injected via the WELLSTREET_RPC_URLS env var.
 *  - CommonJS throughout so Vercel's Node builder needs no transpile step.
 */

const CHAIN_ID_EXPECTED = 4663; // 0x1237 — verified on-chain (phase-0 evidence)
const CHAIN_ID_HEX = '0x1237';

/**
 * Public RPC upstreams, in failover order.
 *  - robinhood-public: the chain's public RPC (used for all browser eth_calls too).
 *  - blockscout-eth-rpc: keyless failover (observed 429-limited under load — the
 *    failover ordering below puts it second for exactly that reason).
 * WELLSTREET_RPC_URLS (comma-separated) overrides the list — intended for a
 * Wellstreet-owned RPC provisioned under the Wellstreet identity. Never a shared key.
 */
const DEFAULT_UPSTREAMS = [
  { name: 'robinhood-public', url: 'https://rpc.mainnet.chain.robinhood.com' },
  { name: 'blockscout-eth-rpc', url: 'https://robinhoodchain.blockscout.com/api/eth-rpc' },
];

function getUpstreams() {
  const raw = process.env.WELLSTREET_RPC_URLS;
  if (!raw || !raw.trim()) return DEFAULT_UPSTREAMS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((url, i) => ({ name: `custom-${i + 1}`, url }));
}

const BLOCKSCOUT_REST = 'https://robinhoodchain.blockscout.com/api/v2';
// Blockscout REST 403s a plain default UA (UA-gated, not IP-gated) — browser-like UA required.
const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/**
 * Call selectors. Sources:
 *  - Verified against live on-chain calls in the phase-0 evidence file:
 *    name, symbol, decimals, totalSupply, paused, latestRoundData, description.
 *  - Computed locally (keccak via cast sig) and PROVISIONAL until verified against
 *    the deployed factory/vault source at build time: vaultList, totalAssets,
 *    pricePerShare, asset, aggregator. The factory contract does not exist yet —
 *    re-pin these the moment the deployed source is available.
 */
const SEL = {
  vaultList: '0xd223bb36', // PROVISIONAL — verify against deployed factory source
  totalAssets: '0x01e1d114', // PROVISIONAL — verify against deployed vault source
  pricePerShare: '0x99530b06', // PROVISIONAL — verify against deployed vault source
  asset: '0x38d52e0f', // PROVISIONAL — verify against deployed vault source
  totalSupply: '0x18160ddd', // verified on-chain (phase-0)
  name: '0x06fdde03', // verified on-chain (phase-0)
  symbol: '0x95d89b41', // verified on-chain (phase-0)
  decimals: '0x313ce567', // verified on-chain (phase-0)
  paused: '0x5c975abb', // verified on-chain (phase-0)
  latestRoundData: '0xfeaf968c', // verified on-chain (phase-0)
  description: '0x7284e416', // verified on-chain (phase-0)
  aggregator: '0x245a7bfc', // PROVISIONAL — verify against deployed proxy source
};

/** Canonical tokenized-stock facts (phase-0 evidence; both carry "• Robinhood Token" naming + cdn icon — the discriminator). */
const TOKENS = {
  SPY: {
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust • Robinhood Token',
    token: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C',
  },
  NVDA: {
    symbol: 'NVDA',
    name: 'NVIDIA • Robinhood Token',
    token: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC',
  },
};

/**
 * Chainlink equity feed proxies on 4663 (AggregatorV3Interface frontends).
 * Both proxies per feed front the SAME underlying aggregator (phase-0: roundIds
 * differ only in phase bits) — proxy[0] is the read target, the rest are recorded
 * alternates until Chainlink's official address page is re-pinned at build time.
 */
const FEEDS = {
  SPY: {
    ...TOKENS.SPY,
    proxies: [
      '0x319724394D3A0e3669269846abE664Cd621f9f6A',
      '0xa68CA83408bE3f78d1c58a82081c619e9d21486d',
    ],
    aggregator: '0x78bcb218fa04b9b3a278ebc865ed320bf8defbac',
  },
  NVDA: {
    ...TOKENS.NVDA,
    proxies: [
      '0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15',
      '0xCF169363636D73dbBf77733629CB38919d14232d',
    ],
    aggregator: '0xc9d16e4f2569b9e3ea0468fd85844953713dc2a2',
  },
};

/**
 * Full on-chain feed discovery table (phase-0, Blockscout EACAggregatorProxy name
 * search → description()/decimals() eth_calls). 24/5 equity feeds, 8 decimals.
 * Only feeds with recorded proxy addresses are quoted by /api/prices; the rest are
 * listed with empty addresses (not captured in the phase-0 evidence file — re-pin
 * at build time via the same on-chain discovery method).
 */
const FEED_TABLE = [
  { description: 'CBBTC/USD', proxies: [] },
  { description: 'Robinhood SGOV-USD', proxies: [] },
  { description: 'Robinhood USAR-USD', proxies: [] },
  { description: 'Robinhood DELL-USD', proxies: [] },
  { description: 'SYRUPUSDC/USDC Exchange Rate', proxies: [] },
  { description: 'RHTSLA/USD', proxies: [] },
  { description: 'RHNVDA/USD', proxies: FEEDS.NVDA.proxies, aggregator: FEEDS.NVDA.aggregator },
  { description: 'RHMU/USD', proxies: [] },
  { description: 'RHSNDK/USD', proxies: [] },
  { description: 'RHAMD/USD', proxies: [] },
  { description: 'RHSPY/USD', proxies: FEEDS.SPY.proxies, aggregator: FEEDS.SPY.aggregator },
  { description: 'RHMSFT/USD', proxies: [] },
  { description: 'Robinhood PLTR/USD', proxies: [] },
  { description: 'Robinhood QQQ/USD', proxies: [] },
  { description: 'Robinhood SLV/USD', proxies: [] },
  { description: 'Robinhood CRCL/USD', proxies: [] },
  { description: 'Robinhood META/USD', proxies: [] },
  { description: 'Robinhood AAPL/USD', proxies: [] },
  { description: 'Robinhood GOOGL/USD', proxies: [] },
  { description: 'RHUSO/USD', proxies: [] },
  { description: 'Robinhood CRWV/USD', proxies: [] },
  { description: 'Robinhood ORCL/USD', proxies: [] },
  { description: 'Robinhood SPCX/USD', proxies: [] },
  { description: 'Robinhood AMZN/USD', proxies: [] },
  { description: 'RHINTC/USD', proxies: [] },
  { description: 'Robinhood RKLB/USD', proxies: [] },
];

const RPC_TIMEOUT_MS = 10_000;
const BODY_LIMIT_BYTES = 256 * 1024; // /api/rpc request-size guard
const VAULT_CACHE_TTL_MS = 600_000; // /api/vaults in-memory cache
const MAX_VAULTS = 50; // per-response cap on the vault list fan-out
const PRICE_STALE_AFTER_SEC = 4 * 3600; // staleness threshold during weekday sessions (24/5 feed)

// ---------------------------------------------------------------- CORS / responses

const CORS_HEADERS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
};

function applyCors(res) {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
}

/** Returns true when the request was an OPTIONS preflight (already answered). */
function handleOptions(req, res) {
  if (req.method !== 'OPTIONS') return false;
  applyCors(res);
  res.setHeader('access-control-max-age', '86400');
  res.statusCode = 204;
  res.end();
  return true;
}

function sendJson(res, status, body, extraHeaders) {
  applyCors(res);
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) res.setHeader(k, v);
  }
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

// ---------------------------------------------------------------- fetch + RPC failover

async function fetchWithTimeout(fetchImpl, url, init = {}, timeoutMs = RPC_TIMEOUT_MS) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Fail over on server errors and rate limits (Blockscout eth-rpc 429s under load;
// the public RPC is the more reliable primary per phase-0).
const DEFAULT_FAIL_ON = (status) => status >= 500 || status === 429;

/**
 * POST a JSON-RPC body to each upstream in order; first healthy JSON answer wins.
 * Returns { ok, upstream, status, json, attempts } or { ok:false, error, attempts }.
 */
async function rpcWithFailover(fetchImpl, body, opts = {}) {
  const timeoutMs = opts.timeoutMs || RPC_TIMEOUT_MS;
  const failOn = opts.failOn || DEFAULT_FAIL_ON;
  const attempts = [];
  for (const up of getUpstreams()) {
    try {
      const resp = await fetchWithTimeout(
        fetchImpl,
        up.url,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
        timeoutMs
      );
      const text = await resp.text();
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {}
      attempts.push({ upstream: up.name, status: resp.status, parsed: json !== null });
      if (resp.ok && json !== null && !failOn(resp.status)) {
        return { ok: true, upstream: up, status: resp.status, json, attempts };
      }
    } catch (e) {
      attempts.push({ upstream: up.name, error: String((e && e.message) || e) });
    }
  }
  return { ok: false, error: 'all upstreams failed', attempts };
}

/**
 * eth_call with failover. NOTE: the 2-arg param form (explicit "latest" block) is
 * REQUIRED — this chain's RPCs reject the 1-arg call form (-32602, phase-0 evidence).
 */
async function ethCall(fetchImpl, to, data, opts = {}) {
  const r = await rpcWithFailover(
    fetchImpl,
    { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] },
    opts
  );
  if (!r.ok) return { ok: false, error: r.error, attempts: r.attempts };
  if (r.json && typeof r.json.error === 'object' && r.json.error !== null) {
    return { ok: false, rpcError: r.json.error, attempts: r.attempts };
  }
  if (typeof (r.json && r.json.result) !== 'string') {
    return { ok: false, error: 'missing result in RPC response', attempts: r.attempts };
  }
  return { ok: true, raw: r.json.result, attempts: r.attempts };
}

// ---------------------------------------------------------------- hex / ABI decoding

function strip0x(hex) {
  return typeof hex === 'string' && hex.startsWith('0x') ? hex.slice(2) : String(hex || '');
}

function hexToBigInt(hex) {
  return BigInt('0x' + (strip0x(hex) || '0'));
}

/** Interpret a single 32-byte word as int256 (two's complement). */
function wordToSignedInt(wordHex) {
  const v = hexToBigInt(wordHex);
  return v >= 2n ** 255n ? v - 2n ** 256n : v;
}

/** Slice an ABI-encoded return payload into 32-byte words (hex strings, no 0x). */
function splitWords(raw, minWords) {
  const h = strip0x(raw);
  if (h.length % 64 !== 0) throw new Error('malformed ABI payload (not word-aligned)');
  const words = [];
  for (let i = 0; i < h.length / 64; i++) words.push(h.slice(i * 64, (i + 1) * 64));
  if (minWords && words.length < minWords) throw new Error(`expected ${minWords} words, got ${words.length}`);
  return words;
}

/** Decode an ABI dynamic string return value (offset word + length word + data). */
function decodeAbiString(raw) {
  const words = splitWords(raw, 2);
  if (BigInt('0x' + words[0]) !== 32n) throw new Error('unexpected string offset');
  const len = Number(BigInt('0x' + words[1]));
  if (!Number.isInteger(len) || len < 0 || len > 4096) throw new Error('implausible string length');
  const dataHex = words.slice(2).join('').slice(0, len * 2);
  return Buffer.from(dataHex, 'hex').toString('utf8');
}

/** Decode the first word of an ABI payload as an address. */
function decodeAddressWord(raw) {
  const words = splitWords(raw, 1);
  return '0x' + words[0].slice(24);
}

/** Decode an address[] return value (offset word + length word + N address words). */
function decodeAddressArray(raw) {
  const words = splitWords(raw, 2);
  if (BigInt('0x' + words[0]) !== 32n) throw new Error('unexpected array offset');
  const len = Number(BigInt('0x' + words[1]));
  if (!Number.isInteger(len) || len < 0 || len > 1000) throw new Error('implausible array length');
  if (words.length < 2 + len) throw new Error('truncated address array payload');
  const out = [];
  for (let i = 0; i < len; i++) {
    const addr = '0x' + words[2 + i].slice(24);
    if (addr !== '0x0000000000000000000000000000000000000000') out.push(addr);
  }
  return out;
}

// ---------------------------------------------------------------- price math

/**
 * Exact decimal-shift normalization of a raw integer token amount / oracle answer.
 * Returns { exact, value, negative } — `exact` is the lossless decimal string
 * (BigInt-based, no float math), `value` is the JSON-friendly Number form.
 * Example: normalizeDecimal('77026515000', 8) → { exact: '770.26515', value: 770.26515 }.
 */
function normalizeDecimal(raw, decimals) {
  const s = String(raw);
  const negative = s.startsWith('-');
  const digits = negative ? s.slice(1) : s;
  if (!/^\d+$/.test(digits)) throw new TypeError('raw must be an integer string');
  const dec = Number(decimals);
  if (!Number.isInteger(dec) || dec < 0) throw new TypeError('decimals must be a non-negative integer');
  let exact;
  if (dec === 0) {
    exact = digits;
  } else if (digits.length <= dec) {
    exact = '0.' + '0'.repeat(dec - digits.length) + digits;
  } else {
    exact = digits.slice(0, digits.length - dec) + '.' + digits.slice(digits.length - dec);
  }
  if (dec > 0) exact = exact.replace(/0+$/, '').replace(/\.$/, '');
  if (exact === '' || exact === '-') exact = '0';
  return { exact, value: Number(exact), negative };
}

// ---------------------------------------------------------------- staleness (market-hours aware)

/**
 * True when `ms` falls on a UTC weekday (Mon–Fri). The equity feeds update 24/5 —
 * so a Mon–Fri gap beyond the threshold is the fault signal, while Sat/Sun staleness
 * is the expected off-session state (phase-0 observed a 49 h Sunday staleness on the
 * SPY feed — normal).
 *
 * Known limitation (documented, honest): US market HOLIDAYS are not modeled — a
 * holiday falling on a weekday is flagged stale though the market is closed. The
 * flag is informational (the last value is always returned with its age), so the
 * false-positive is low-harm; a holiday calendar is a build-time refinement.
 */
function isWeekdayUtc(ms) {
  const day = new Date(ms).getUTCDay(); // 0 = Sun … 6 = Sat
  return day >= 1 && day <= 5;
}

/**
 * Market-hours-aware staleness verdict for a 24/5 feed.
 *  - age < staleAfterSec          → { stale: false } (fresh)
 *  - age ≥ threshold on a weekday → { stale: true }  (feed should be updating — fault signal)
 *  - age ≥ threshold on a weekend → { stale: false, expected: true } (Sat/Sun gap is normal)
 * Always returns the age; the CALLER still returns the last value + age when stale —
 * the flag never degrades the response (honest-display rule).
 */
function marketStaleness(updatedAtSec, nowSec, staleAfterSec = PRICE_STALE_AFTER_SEC) {
  const ageSeconds = Math.max(0, Math.floor(nowSec - updatedAtSec));
  if (ageSeconds < staleAfterSec) {
    return { stale: false, expected: false, reason: 'fresh', ageSeconds };
  }
  if (isWeekdayUtc(nowSec * 1000)) {
    return {
      stale: true,
      expected: false,
      reason: `feed age ${ageSeconds}s exceeds the ${staleAfterSec}s threshold during a weekday (24/5 feed)`,
      ageSeconds,
    };
  }
  return {
    stale: false,
    expected: true,
    reason: 'weekend gap — 24/5 feed does not update Sat/Sun; staleness expected, not an error',
    ageSeconds,
  };
}

// ---------------------------------------------------------------- secondary price source

function parseRate(v) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Secondary quote source: Blockscout REST exchange_rate. Requires a browser-like
 * User-Agent (a plain UA gets 403 — UA-gated, proven in phase-0). Tries the token
 * endpoint first, then address search. Used ONLY when the Chainlink read fails.
 */
async function blockscoutExchangeRate(fetchImpl, tokenAddress, opts = {}) {
  const headers = { 'user-agent': BROWSER_UA, accept: 'application/json' };
  const urls = [
    `${BLOCKSCOUT_REST}/tokens/${tokenAddress}`,
    `${BLOCKSCOUT_REST}/search?q=${tokenAddress}`,
  ];
  const errors = [];
  for (const url of urls) {
    try {
      const resp = await fetchWithTimeout(fetchImpl, url, { headers }, opts.timeoutMs);
      if (!resp.ok) {
        errors.push(`${url} → HTTP ${resp.status}`);
        continue;
      }
      const j = await resp.json();
      let rate = parseRate(j && j.exchange_rate);
      if (rate == null && Array.isArray(j && j.items)) {
        const item = j.items.find(
          (it) => it && typeof it.address_hash === 'string' && it.address_hash.toLowerCase() === tokenAddress.toLowerCase()
        );
        rate = item ? parseRate(item.exchange_rate) : null;
      }
      if (rate != null) return { ok: true, rate, endpoint: url };
      errors.push(`${url} → no exchange_rate in response`);
    } catch (e) {
      errors.push(`${url} → ${String((e && e.message) || e)}`);
    }
  }
  return { ok: false, error: errors.join('; ') };
}

module.exports = {
  // constants / config
  CHAIN_ID_EXPECTED,
  CHAIN_ID_HEX,
  DEFAULT_UPSTREAMS,
  getUpstreams,
  BLOCKSCOUT_REST,
  BROWSER_UA,
  SEL,
  TOKENS,
  FEEDS,
  FEED_TABLE,
  RPC_TIMEOUT_MS,
  BODY_LIMIT_BYTES,
  VAULT_CACHE_TTL_MS,
  MAX_VAULTS,
  PRICE_STALE_AFTER_SEC,
  // responses
  CORS_HEADERS,
  applyCors,
  handleOptions,
  sendJson,
  // rpc
  fetchWithTimeout,
  DEFAULT_FAIL_ON,
  rpcWithFailover,
  ethCall,
  // decoding
  strip0x,
  hexToBigInt,
  wordToSignedInt,
  splitWords,
  decodeAbiString,
  decodeAddressWord,
  decodeAddressArray,
  // price math
  normalizeDecimal,
  isWeekdayUtc,
  marketStaleness,
  // secondary source
  blockscoutExchangeRate,
};

/**
 * Defensive default export: this module is a private library, not an endpoint. If a
 * deploy wiring ever treats api/lib/* as a routable function, it answers a clean
 * JSON 404 instead of crashing with a missing-handler error.
 */
module.exports.default = async function handler(req, res) {
  if (handleOptions(req, res)) return;
  sendJson(res, 404, { ok: false, error: 'not a public endpoint' });
};
