'use strict';

/**
 * GET /api/vault — the live RoamVault snapshot (protocol v2, config.roamStack.vault).
 *
 * One request batches EVERY vault view and returns the assembled JSON. This is the
 * same-origin caching ENHANCEMENT for the vault dashboard: the browser reader
 * (site/js/vault.js readRoamVaultSnapshot) performs the identical reads directly
 * (serverless-clean D8) and never depends on this endpoint. The two layers carry
 * the same field contract; the site-side pure math (share price, cap headroom,
 * deployment state) is the unit-pinned twin of the derivation below.
 *
 * Pipeline: 11 parallel eth_calls (asset, decimals, totalAssets, totalSupply,
 * idleBook, deployedBook, backingCoverage, depositsPaused, maxDeposit(0x0),
 * DEPOSIT_CAP, harvester) → one dependent round (convertToAssets(10^shareDecimals)
 * = the asset value of ONE WHOLE SHARE, plus the asset token's own decimals())
 * → assembled JSON. In-memory module-level cache, TTL 60s (VAULT_CACHE_TTL_MS —
 * vault state moves on every deposit/harvest/deploy; the TTL matches the site's
 * own 60s refresh loop).
 *
 * Selector provenance: every selector is derived from the DEPLOYED source
 * (src/RoamVault.sol) and was verified live on chain 4663 on 2026-09-13. The
 * shared SEL constants are reused where the signature is identical (ERC-20/4626
 * surface); the RoamVault-specific views are declared below.
 *
 * Denomination rules (read from the chain, never assumed):
 *   - the vault asset is USDG (6 decimals) — asset-denominated figures normalize
 *     only against the asset token's VERIFIED on-chain decimals(),
 *   - share decimals = asset decimals + the ERC-4626 virtual offset (6) — the
 *     USDG chassis reads decimals() = 12 (one whole share = 10^12 raw; at a 1:1
 *     price raw shares = raw assets × 10^6). NOTHING hardcodes either figure.
 *
 * Honest state model: harvester() = address(0) until P3-A executes and
 * deployedBook() = 0 until P3-B executes — both are REAL on-chain states surfaced
 * as deploymentState 'unbound' | 'idle' | 'deployed' (never an error, never a
 * fabricated yield figure).
 *
 * Degradation rules (an ENHANCEMENT, never a dependency):
 *  - Vault address disabled (WELLSTREET_ROAM_VAULT_ADDRESS set to an empty value)
 *    → 200 with configured:false — never an error; the frontend reads the vault
 *    directly from the browser. By default the endpoint reads the vault pinned in
 *    site/js/config.js roamStack.vault.
 *  - A per-field eth_call failure is tolerated inline (field null + errors[]) so
 *    one misbehaving view cannot blank the snapshot.
 *  - A failed round-1 read serves the last good cache marked staleCache:true
 *    (public-RPC rate-limit resilience); only a cache-less failure returns 502.
 */

const {
  CHAIN_ID_EXPECTED,
  SEL,
  VAULT_CACHE_TTL_MS,
  handleOptions,
  sendJson,
  ethCall,
  encodeUintArg,
  hexToBigInt,
  decodeAddressWord,
  normalizeDecimal,
} = require('./lib/shared.js');

// CDN/browser caches may hold ≤30s/≤60s — never longer than the in-memory TTL.
const CACHE_HEADER = 'public, max-age=30, s-maxage=60';

/**
 * The deployed RoamVault (LIVE 2026-09-13: P0/P1/P2 executed, seeded 12.473590
 * USDG; P3 pair queued — ready 2026-09-15) — pinned identically in
 * site/js/config.js `roamStack.vault` (the single source of truth). /api/vault
 * defaults to it so the enhancement works with no serverless env config;
 * WELLSTREET_ROAM_VAULT_ADDRESS overrides (empty string disables).
 */
const DEFAULT_ROAM_VAULT_ADDRESS = '0xefA732aF74CaC318414BE8A1D645F3Ca5AB72E86';

/**
 * RoamVault-specific views (src/RoamVault.sol — selector derived from the
 * signature, value verified live 2026-09-13):
 *   idleBook        — :234  the IDLE book alone (physically custodyable capital)
 *   deployedBook    — :229  the deployed-capital book (marked at par minus IL)
 *   backingCoverage — :265  1e18 fixed point; RoamVault's denominator is the IDLE
 *                             book (YieldShares used the accounted figure — both
 *                             read 1e18 while the invariant holds)
 *   DEPOSIT_CAP     — :112  the operating cap (Safe-settable, immutable ceiling)
 *   harvester       — :127  the roamer binding (address(0) until P3-A)
 *   maxDeposit      — ERC-4626 override :290 (0 when paused, else cap headroom;
 *                             the address argument is ignored — 0x0 passed)
 */
const ROAM_SEL = {
  idleBook: '0x19c17aa2',
  deployedBook: '0x7b943d61',
  backingCoverage: '0x17b7fb14',
  depositCap: '0xb8a429ff',
  harvester: '0x4bdaeac1',
  maxDeposit: '0x402d267d',
};

const ZERO_ARG = '0000000000000000000000000000000000000000000000000000000000000000';
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

let _fetch = (...args) => globalThis.fetch(...args);
let _clock = () => Date.now();

// Test seam: an explicit _setVaultAddress() override wins; otherwise the vault
// resolves LIVE per request (env override → the pinned RoamVault; empty disables).
const VAULT_UNSET = Symbol('vault-unset');
let _vault = VAULT_UNSET;

function vaultInUse() {
  if (_vault !== VAULT_UNSET) return _vault;
  const raw = process.env.WELLSTREET_ROAM_VAULT_ADDRESS;
  if (raw !== undefined && raw.trim() === '') return null; // explicitly disabled via env
  return (raw && raw.trim()) || DEFAULT_ROAM_VAULT_ADDRESS;
}

// Module-level cache (survives across warm invocations).
const _cache = { payload: null, at: 0 };

function rpcErrText(r, fallback) {
  if (r && r.rpcError) return `RPC error ${r.rpcError.code || ''}: ${r.rpcError.message || ''}`.trim();
  return (r && r.error) || fallback;
}

function safeNormalize(raw, decimals) {
  try {
    return normalizeDecimal(raw, decimals);
  } catch {
    return null;
  }
}

function deriveHeadroom(capRaw, totalAssetsRaw) {
  if (capRaw === null || totalAssetsRaw === null) return null;
  const cap = BigInt(capRaw);
  const ta = BigInt(totalAssetsRaw);
  return (cap > ta ? cap - ta : 0n).toString();
}

function deploymentState(harvesterAddr, deployedBookRaw) {
  if (harvesterAddr === null || deployedBookRaw === null) return 'unknown';
  if (harvesterAddr === ZERO_ADDRESS) return 'unbound';
  return BigInt(deployedBookRaw) > 0n ? 'deployed' : 'idle';
}

async function loadRoamVault(fetchImpl, address) {
  const vault = {
    address,
    asset: null,
    assetDecimals: null,
    shareDecimals: null,
    totalAssetsRaw: null,
    totalAssets: null,
    totalSupplyRaw: null,
    totalShares: null,
    idleRaw: null,
    idle: null,
    deployedRaw: null,
    deployedBook: null,
    backingCoverageRaw: null,
    depositsPaused: null,
    maxDepositRaw: null,
    maxDeposit: null,
    depositCapRaw: null,
    depositCap: null,
    capHeadroomRaw: null,
    capHeadroom: null,
    pricePerShareRaw: null,
    pricePerShare: null,
    harvester: null,
    deploymentState: 'unknown',
    errors: [],
  };

  // Round 1: eleven parallel views. The shared SEL map covers the ERC-20/4626
  // surface; ROAM_SEL carries the RoamVault-specific views.
  const fields = [
    ['asset', SEL.asset, (r) => decodeAddressWord(r.raw)],
    ['shareDecimals', SEL.decimals, (r) => Number(hexToBigInt(r.raw))],
    // Raw magnitude fields serialize as STRINGS (JSON has no BigInt — a live
    // BigInt in the payload throws on JSON.stringify and 500s the endpoint).
    ['totalAssetsRaw', SEL.totalAssets, (r) => hexToBigInt(r.raw).toString()],
    ['totalSupplyRaw', SEL.totalSupply, (r) => hexToBigInt(r.raw).toString()],
    ['idleRaw', ROAM_SEL.idleBook, (r) => hexToBigInt(r.raw).toString()],
    ['deployedRaw', ROAM_SEL.deployedBook, (r) => hexToBigInt(r.raw).toString()],
    ['backingCoverageRaw', ROAM_SEL.backingCoverage, (r) => hexToBigInt(r.raw).toString()],
    ['depositsPaused', SEL.depositsPaused, (r) => hexToBigInt(r.raw) !== 0n],
    ['maxDepositRaw', ROAM_SEL.maxDeposit, (r) => hexToBigInt(r.raw).toString()],
    ['depositCapRaw', ROAM_SEL.depositCap, (r) => hexToBigInt(r.raw).toString()],
    ['harvester', ROAM_SEL.harvester, (r) => decodeAddressWord(r.raw)],
  ];

  await Promise.all(
    fields.map(async ([field, selector, decode]) => {
      try {
        const arg = field === 'maxDepositRaw' ? ZERO_ARG : '';
        const r = await ethCall(fetchImpl, address, selector + arg);
        if (!r.ok) {
          vault.errors.push({ field, error: rpcErrText(r, 'eth_call failed') });
          return;
        }
        vault[field] = decode(r);
      } catch (e) {
        vault.errors.push({ field, error: String((e && e.message) || e) });
      }
    })
  );

  vault.capHeadroomRaw = deriveHeadroom(vault.depositCapRaw, vault.totalAssetsRaw);
  vault.deploymentState = deploymentState(vault.harvester, vault.deployedRaw);

  // Round 2 (dependent): the whole-share price input is 10^shareDecimals, and the
  // RESULT is denominated in the ASSET's decimals — so the asset token's own
  // decimals() is verified before any normalization.
  if (Number.isInteger(vault.shareDecimals) && vault.shareDecimals > 0) {
    const assetAddr = vault.asset;
    const [priceRes, assetDecRes] = await Promise.all([
      ethCall(
        fetchImpl,
        address,
        SEL.convertToAssets + encodeUintArg(10n ** BigInt(vault.shareDecimals))
      ),
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
  // shares → share decimals; every asset-denominated figure → the VERIFIED asset
  // decimals. Without verified decimals the figure stays null (raw form only) —
  // an honest gap, not a guessed shift.
  if (Number.isInteger(vault.shareDecimals) && vault.totalSupplyRaw !== null) {
    const n = safeNormalize(vault.totalSupplyRaw.toString(), vault.shareDecimals);
    if (n) vault.totalShares = n.exact;
  }
  if (Number.isInteger(vault.assetDecimals)) {
    for (const [rawField, normField] of [
      ['totalAssetsRaw', 'totalAssets'],
      ['idleRaw', 'idle'],
      ['deployedRaw', 'deployedBook'],
      ['maxDepositRaw', 'maxDeposit'],
      ['depositCapRaw', 'depositCap'],
      ['capHeadroomRaw', 'capHeadroom'],
      ['pricePerShareRaw', 'pricePerShare'],
    ]) {
      if (vault[rawField] !== null) {
        const n = safeNormalize(vault[rawField].toString(), vault.assetDecimals);
        if (n) vault[normField] = n.exact;
      }
    }
  }
  return vault;
}

async function buildRoamVault(fetchImpl) {
  const vaultAddr = vaultInUse();
  if (!vaultAddr || !/^0x[0-9a-fA-F]{40}$/.test(vaultAddr)) {
    return {
      ok: true,
      configured: false,
      vault: null,
      note: 'RoamVault reads disabled (WELLSTREET_ROAM_VAULT_ADDRESS is set to an empty value). By default this endpoint reads the deployed RoamVault pinned in site/js/config.js roamStack.vault. This endpoint is an enhancement only: the frontend reads the vault directly from the browser (serverless-clean).',
    };
  }
  const vault = await loadRoamVault(_fetch, vaultAddr);
  return {
    ok: true,
    configured: true,
    vault: vaultAddr,
    snapshot: vault,
    note: 'Selectors derived from src/RoamVault.sol and verified live 2026-09-13. pricePerShare = convertToAssets(10^shareDecimals) normalized at the asset token\'s verified decimals; share decimals = asset decimals + the ERC-4626 virtual offset (USDG chassis: 12). deploymentState: unbound (harvester()=0x0, P3-A pending) | idle (bound, deployedBook()=0, P3-B pending) | deployed.',
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

  const built = await buildRoamVault(_fetch);
  if (!built.ok) {
    if (_cache.payload) {
      // Graceful degradation: serve the last good snapshot, marked stale.
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
    vault: built.vault,
    configured: built.configured,
    generatedAt: new Date(now).toISOString(),
    cached: false,
    snapshot: built.snapshot || null,
  };
  if (built.note) payload.note = built.note;

  // Only configured, successful reads populate the cache (a disabled response
  // must not pin the empty shape once the vault is reachable again).
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
module.exports._setVaultAddress = (addr) => (_vault = addr); // explicit override (null = unconfigured)
module.exports._clearVaultAddress = () => (_vault = VAULT_UNSET); // back to env/default resolution
module.exports._resetCache = () => {
  _cache.payload = null;
  _cache.at = 0;
};
