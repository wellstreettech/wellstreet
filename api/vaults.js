'use strict';

/**
 * GET /api/vaults — full vault list read from the Wellstreet factory registry.
 *
 * Pipeline: eth_call factory.allVaults() → per-vault view fan-out (name, symbol,
 * decimals, asset, totalAssets, totalSupply, depositsPaused) → one dependent read
 * per vault (convertToAssets(10^shareDecimals) = the asset value of ONE WHOLE SHARE,
 * plus the asset token's own decimals) → assembled JSON. In-memory module-level
 * cache, TTL 60s (vault state moves on every deposit/harvest — the TTL matches the
 * site's own 60s refresh loop; serverless instances are warm between invocations,
 * so this is a genuine cache for repeat traffic).
 *
 * Selector provenance: every selector is verified against the DEPLOYED source (F-01
 * broadcast 2026-09-03) — see api/lib/shared.js SEL. The pre-broadcast
 * vaultList()/pricePerShare()/paused() guesses named functions that do not exist on
 * the deployed contracts and have been removed.
 *
 * Denomination rules (the 24-decimal share convention, YieldShares.sol:49):
 *   - share decimals = asset decimals + 6 (the ERC-4626 virtual offset)
 *   - totalSupply is denominated in SHARE decimals
 *   - totalAssets and the whole-share price are denominated in ASSET decimals —
 *     normalized only against the asset token's VERIFIED on-chain decimals(), never
 *     assumed (a wrong decimal shift would quietly misstate every figure).
 *
 * Degradation rules (the endpoint is an ENHANCEMENT, never a dependency):
 *  - Factory address disabled (WELLSTREET_FACTORY_ADDRESS set to an empty value) →
 *    200 with configured:false and an empty list — never an error; the frontend
 *    reads the factory directly from the browser (serverless-clean). By default the
 *    endpoint reads the deployed factory pinned in site/js/config.js.
 *  - A per-vault eth_call failure is tolerated inline (field null + errors[])
 *    so one misbehaving vault cannot blank the list.
 *  - A failed registry read serves the last good cache marked staleCache:true
 *    (public-RPC rate-limit resilience); only a cache-less failure returns 502.
 */

const {
  CHAIN_ID_EXPECTED,
  SEL,
  DEFAULT_FACTORY_ADDRESS,
  VAULT_CACHE_TTL_MS,
  MAX_VAULTS,
  handleOptions,
  sendJson,
  ethCall,
  encodeUintArg,
  hexToBigInt,
  decodeAbiString,
  decodeAddressWord,
  decodeAddressArray,
  normalizeDecimal,
} = require('./lib/shared.js');

// CDN/browser caches may hold ≤30s/≤60s — never longer than the in-memory TTL below.
const CACHE_HEADER = 'public, max-age=30, s-maxage=60';

let _fetch = (...args) => globalThis.fetch(...args);
let _clock = () => Date.now();

// Test seam: an explicit _setFactory() override wins; otherwise the factory resolves
// LIVE per request (env override → the pinned deployed factory; empty env disables).
const FACTORY_UNSET = Symbol('factory-unset');
let _factory = FACTORY_UNSET;

function factoryInUse() {
  if (_factory !== FACTORY_UNSET) return _factory;
  const raw = process.env.WELLSTREET_FACTORY_ADDRESS;
  if (raw !== undefined && raw.trim() === '') return null; // explicitly disabled via env
  return (raw && raw.trim()) || DEFAULT_FACTORY_ADDRESS;
}

// Module-level cache (survives across warm invocations).
const _cache = { payload: null, at: 0 };

// Core per-vault views — one parallel eth_call batch.
const CORE_FIELDS = {
  name: SEL.name,
  symbol: SEL.symbol,
  decimals: SEL.decimals,
  asset: SEL.asset,
  totalAssets: SEL.totalAssets,
  totalSupply: SEL.totalSupply,
  depositsPaused: SEL.depositsPaused,
};

function rpcErrText(r, fallback) {
  if (r && r.rpcError) return `RPC error ${r.rpcError.code || ''}: ${r.rpcError.message || ''}`.trim();
  return (r && r.error) || fallback;
}

async function loadVault(fetchImpl, address) {
  const vault = {
    address,
    name: null,
    symbol: null,
    decimals: null,
    asset: null,
    assetDecimals: null,
    totalAssetsRaw: null,
    totalSupplyRaw: null,
    pricePerShareRaw: null,
    depositsPaused: null,
    errors: [],
  };

  await Promise.all(
    Object.entries(CORE_FIELDS).map(async ([field, selector]) => {
      try {
        const r = await ethCall(fetchImpl, address, selector);
        if (!r.ok) {
          vault.errors.push({ field, error: rpcErrText(r, 'eth_call failed') });
          return;
        }
        if (field === 'name' || field === 'symbol') vault[field] = decodeAbiString(r.raw);
        else if (field === 'decimals') vault.decimals = Number(hexToBigInt(r.raw));
        else if (field === 'asset') vault.asset = decodeAddressWord(r.raw);
        else if (field === 'depositsPaused') vault.depositsPaused = hexToBigInt(r.raw) !== 0n;
        else vault[`${field}Raw`] = hexToBigInt(r.raw).toString();
      } catch (e) {
        vault.errors.push({ field, error: String((e && e.message) || e) });
      }
    })
  );

  // Dependent reads: the whole-share price input is 10^shareDecimals (share decimals
  // carry the +6 virtual offset), and the RESULT is denominated in the ASSET's
  // decimals — so the asset token's own decimals() is verified before normalization.
  if (Number.isInteger(vault.decimals) && vault.decimals > 0) {
    const assetAddr = vault.asset;
    const [priceRes, assetDecRes] = await Promise.all([
      ethCall(fetchImpl, address, SEL.convertToAssets + encodeUintArg(10n ** BigInt(vault.decimals))),
      typeof assetAddr === 'string' && /^0x[0-9a-fA-F]{40}$/.test(assetAddr)
        ? ethCall(fetchImpl, assetAddr, SEL.decimals)
        : Promise.resolve({ ok: false, error: 'asset address unavailable — asset decimals not read' }),
    ]);
    if (priceRes.ok) {
      try {
        vault.pricePerShareRaw = hexToBigInt(priceRes.raw).toString();
      } catch (e) {
        vault.errors.push({ field: 'pricePerShare', error: String((e && e.message) || e) });
      }
    } else {
      vault.errors.push({ field: 'pricePerShare', error: rpcErrText(priceRes, 'eth_call failed') });
    }
    if (assetDecRes.ok) {
      try {
        vault.assetDecimals = Number(hexToBigInt(assetDecRes.raw));
      } catch (e) {
        vault.errors.push({ field: 'assetDecimals', error: String((e && e.message) || e) });
      }
    } else {
      vault.errors.push({ field: 'assetDecimals', error: rpcErrText(assetDecRes, 'eth_call failed') });
    }
  } else {
    vault.errors.push({
      field: 'pricePerShare',
      error: 'share decimals unavailable — the whole-share price input is unknown',
    });
  }

  // Normalization at each figure's own denomination (never a shared assumption):
  //   totalSupply → share decimals; totalAssets / whole-share price → VERIFIED asset
  //   decimals. Without the verified asset decimals the asset-denominated figures
  //   stay raw (null normalized form) — an honest gap, not a guessed shift.
  if (Number.isInteger(vault.decimals) && vault.totalSupplyRaw !== null) {
    try {
      vault.totalSupply = normalizeDecimal(vault.totalSupplyRaw, vault.decimals);
    } catch {}
  }
  if (Number.isInteger(vault.assetDecimals)) {
    for (const [rawField, normField] of [
      ['totalAssetsRaw', 'totalAssets'],
      ['pricePerShareRaw', 'pricePerShare'],
    ]) {
      if (vault[rawField] !== null) {
        try {
          vault[normField] = normalizeDecimal(vault[rawField], vault.assetDecimals);
        } catch {}
      }
    }
  }
  return vault;
}

async function buildVaults(fetchImpl) {
  const factory = factoryInUse();
  if (!factory || !/^0x[0-9a-fA-F]{40}$/.test(factory)) {
    return {
      ok: true,
      configured: false,
      factory: null,
      vaults: [],
      note: 'Factory reads disabled (WELLSTREET_FACTORY_ADDRESS is set to an empty value). By default this endpoint reads the deployed factory pinned in site/js/config.js. This endpoint is an enhancement only: the frontend reads the factory directly from the browser (serverless-clean).',
    };
  }

  const listRes = await ethCall(_fetch, factory, SEL.allVaults);
  if (!listRes.ok) {
    return {
      ok: false,
      error: 'factory allVaults() eth_call failed',
      detail: listRes.rpcError ? JSON.stringify(listRes.rpcError) : listRes.error,
      attempts: listRes.attempts,
    };
  }

  let addresses;
  try {
    addresses = decodeAddressArray(listRes.raw);
  } catch (e) {
    return { ok: false, error: `allVaults() decode failed: ${String((e && e.message) || e)}` };
  }

  const capped = addresses.slice(0, MAX_VAULTS);
  const vaults = await Promise.all(capped.map((addr) => loadVault(_fetch, addr)));

  return {
    ok: true,
    configured: true,
    factory,
    vaults,
    note: 'Selectors verified against the deployed source (F-01 broadcast 2026-09-03; src/VaultFactory.sol, src/YieldShares.sol, OZ ERC-4626). pricePerShare = convertToAssets(10^shareDecimals) — the asset value of one whole share — normalized at the asset token\'s verified decimals; share decimals include the +6 virtual offset (YieldShares.sol:49).',
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

  // Only configured, successful reads populate the cache (a disabled response
  // must not pin the empty shape once the factory is reachable again).
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
module.exports._setFactory = (addr) => (_factory = addr); // explicit override (null = unconfigured)
module.exports._clearFactory = () => (_factory = FACTORY_UNSET); // back to env/default resolution
module.exports._resetCache = () => {
  _cache.payload = null;
  _cache.at = 0;
};
