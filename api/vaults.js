'use strict';

/**
 * GET /api/vaults — full vault list read from the Wellstreet factory registry.
 *
 * Pipeline: eth_call factory.vaultList() → per-vault view fan-out (name, symbol,
 * decimals, asset, totalAssets, totalSupply, pricePerShare, paused) → assembled
 * JSON. In-memory module-level cache, TTL 600s (serverless instances are warm
 * between invocations, so this is a genuine cache for repeat traffic).
 *
 * Degradation rules (the endpoint is an ENHANCEMENT, never a dependency):
 *  - Factory address unconfigured (WELLSTREET_FACTORY_ADDRESS unset) → 200 with
 *    configured:false and an empty list — never an error, the frontend reads the
 *    factory directly from the browser (serverless-clean).
 *  - A per-vault eth_call failure is tolerated inline (field null + errors[])
 *    so one misbehaving vault cannot blank the list.
 *  - A failed registry read serves the last good cache marked staleCache:true
 *    (public-RPC rate-limit resilience); only a cache-less failure returns 502.
 *
 * The vault contract does not exist yet (contracts package in flight) — the
 * vaultList/totalAssets/pricePerShare/asset selectors are PROVISIONAL and must be
 * re-pinned against the deployed source at build time (see lib/shared.js SEL).
 */

const {
  CHAIN_ID_EXPECTED,
  SEL,
  VAULT_CACHE_TTL_MS,
  MAX_VAULTS,
  handleOptions,
  sendJson,
  ethCall,
  hexToBigInt,
  decodeAbiString,
  decodeAddressWord,
  decodeAddressArray,
  normalizeDecimal,
} = require('./lib/shared.js');

const CACHE_HEADER = 'public, max-age=60, s-maxage=600';

let _fetch = (...args) => globalThis.fetch(...args);
let _clock = () => Date.now();
let _factory = process.env.WELLSTREET_FACTORY_ADDRESS || null;

// Module-level cache (survives across warm invocations).
const _cache = { payload: null, at: 0 };

const VAULT_FIELDS = {
  name: SEL.name,
  symbol: SEL.symbol,
  decimals: SEL.decimals,
  asset: SEL.asset,
  totalAssets: SEL.totalAssets,
  totalSupply: SEL.totalSupply,
  pricePerShare: SEL.pricePerShare,
  paused: SEL.paused,
};

async function loadVault(fetchImpl, address) {
  const vault = {
    address,
    name: null,
    symbol: null,
    decimals: null,
    asset: null,
    totalAssetsRaw: null,
    totalSupplyRaw: null,
    pricePerShareRaw: null,
    paused: null,
    errors: [],
  };

  await Promise.all(
    Object.entries(VAULT_FIELDS).map(async ([field, selector]) => {
      try {
        const r = await ethCall(fetchImpl, address, selector);
        if (!r.ok) {
          vault.errors.push({
            field,
            error: r.rpcError ? `RPC error ${r.rpcError.code || ''}: ${r.rpcError.message || ''}`.trim() : r.error || 'eth_call failed',
          });
          return;
        }
        if (field === 'name' || field === 'symbol') vault[field] = decodeAbiString(r.raw);
        else if (field === 'decimals') vault.decimals = Number(hexToBigInt(r.raw));
        else if (field === 'asset') vault.asset = decodeAddressWord(r.raw);
        else if (field === 'paused') vault.paused = hexToBigInt(r.raw) !== 0n;
        else vault[`${field}Raw`] = hexToBigInt(r.raw).toString();
      } catch (e) {
        vault.errors.push({ field, error: String((e && e.message) || e) });
      }
    })
  );

  // Human-normalized views at the vault's own decimals (assumption: share/asset
  // precision matches vault decimals — re-verify against the deployed ERC-4626).
  if (vault.decimals !== null) {
    for (const f of ['totalAssetsRaw', 'totalSupplyRaw', 'pricePerShareRaw']) {
      if (vault[f] !== null) {
        try {
          vault[f.replace('Raw', '')] = normalizeDecimal(vault[f], vault.decimals);
        } catch {}
      }
    }
  }
  return vault;
}

async function buildVaults(fetchImpl) {
  const factory = _factory;
  if (!factory || !/^0x[0-9a-fA-F]{40}$/.test(factory)) {
    return {
      ok: true,
      configured: false,
      factory: null,
      vaults: [],
      note: 'Factory address not configured — set WELLSTREET_FACTORY_ADDRESS (serverless env). This endpoint is an enhancement only: the frontend reads the factory directly from the browser (serverless-clean).',
    };
  }

  const listRes = await ethCall(_fetch, factory, SEL.vaultList);
  if (!listRes.ok) {
    return {
      ok: false,
      error: 'factory vaultList() eth_call failed',
      detail: listRes.rpcError ? JSON.stringify(listRes.rpcError) : listRes.error,
      attempts: listRes.attempts,
    };
  }

  let addresses;
  try {
    addresses = decodeAddressArray(listRes.raw);
  } catch (e) {
    return { ok: false, error: `vaultList() decode failed: ${String((e && e.message) || e)}` };
  }

  const capped = addresses.slice(0, MAX_VAULTS);
  const vaults = await Promise.all(capped.map((addr) => loadVault(_fetch, addr)));

  return {
    ok: true,
    configured: true,
    factory,
    vaults,
    note: 'vaultList/totalAssets/pricePerShare/asset selectors are provisional until verified against the deployed factory and vault source at build time (name/symbol/decimals/totalSupply/paused are on-chain-verified).',
  };
}

async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') {
    return sendJson(res, 405, { ok: false, error: 'method not allowed — use GET' }, { allow: 'GET' });
  }

  const now = _clock();
  if (_cache.payload && now - _cache.at < VAULT_CACHE_TTL_MS) {
    return sendJson(res, 200, { ..._cache.payload, cached: true }, { 'cache-control': CACHE_HEADER });
  }

  const built = await buildVaults(_fetch);
  if (!built.ok) {
    if (_cache.payload) {
      // Graceful degradation: serve the last good list, marked stale.
      return sendJson(
        res,
        200,
        { ..._cache.payload, cached: true, staleCache: true, error: built.error },
        { 'cache-control': 'no-store' }
      );
    }
    return sendJson(res, 502, {
      ok: false,
      chainId: CHAIN_ID_EXPECTED,
      error: built.error,
      detail: built.detail,
      attempts: built.attempts,
    });
  }

  const payload = {
    ok: true,
    chainId: CHAIN_ID_EXPECTED,
    factory: built.factory,
    configured: built.configured,
    generatedAt: new Date(now).toISOString(),
    cached: false,
    vaultCount: built.vaults.length,
    vaults: built.vaults,
  };
  if (built.note) payload.note = built.note;

  // Only configured, successful reads populate the cache (an unconfigured response
  // must not pin the empty shape once the env var is set).
  if (built.configured) {
    _cache.payload = payload;
    _cache.at = now;
  }

  return sendJson(res, 200, payload, { 'cache-control': CACHE_HEADER });
}

module.exports = handler;
module.exports.default = handler;
module.exports._setFetch = (fn) => (_fetch = fn);
module.exports._setClock = (fn) => (_clock = fn);
module.exports._setFactory = (addr) => (_factory = addr);
module.exports._resetCache = () => {
  _cache.payload = null;
  _cache.at = 0;
};
