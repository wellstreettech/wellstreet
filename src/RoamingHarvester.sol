// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RoamAllowlist} from "./RoamAllowlist.sol";
import {RoamMathLib} from "./RoamMathLib.sol";

/// @dev Minimal RH-4663 v4-fork PoolManager surface (house HarvesterV4 pattern). The
///      fork is CUSTOM: BalanceDelta packs amount0 in the HIGH 128 bits (amount1 LOW),
///      and — live-probed 2026-09-07 against the SPY/USDG book via the pinned Quoter
///      (QuoterProbe evidence, 04 doc §5.3) — `swap` follows the fork's reversed amount
///      semantics: POSITIVE amountSpecified = EXACT OUTPUT (negative = exact input), and
///      the swap returns a SINGLE packed int256 (no trailing fee word; the per-swap
///      charged fee is a Swap-EVENT field, an off-chain yield-model input — this
///      contract never consumes any static rate, it books only pool deltas).
interface IPoolManagerV4 {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes32 salt;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    function unlock(bytes calldata data) external returns (bytes memory);

    function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        external
        returns (int256 callerDelta, int256 feesAccrued);

    function swap(PoolKey calldata key, SwapParams calldata params, bytes calldata hookData)
        external
        returns (int256 delta);

    function take(address currency, address to, uint256 amount) external;

    function sync(address currency) external;

    function settle() external payable returns (uint256);
}

/// @dev The fork Quoter (custom `quoteSingle` view; live-proven semantics: POSITIVE
///      amountSpecified = EXACT OUTPUT, echoed on the specified side, the unspecified
///      leg negative = the PAID amount). Pinned constant below — one of six identical
///      PM-bound deploys sharing one runtime codehash (QuoterProbe, 04 doc §5.3).
interface IForkQuoter {
    function quoteSingle(IPoolManagerV4.PoolKey calldata poolKey, IPoolManagerV4.SwapParams calldata swapParams)
        external
        view
        returns (int256 amount0, int256 amount1, uint160 sqrtPriceX96After, uint32);
}

/// @dev Canonical v4-periphery lens, ctor-arg-bound to the fork PoolManager (house
///      StateView pin) — the observable-state price read (ticks/reserves, NO oracle).
interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);
}

/// @dev WETH9 — reserved for a future wrap leg; the v1 conversion path trades pool
///      currencies directly (a native leg is paid/settled natively via settle{value}).
interface IWETH9 {
    function deposit() external payable;
}

/// @title RoamingHarvester — the protocol-owned-liquidity roamer (POL mode: protocol
///        capital ONLY, no user deposits in v1). Holds multi-pool, salt-keyed Uniswap
///        v4 positions on the pinned RH-4663 FORK PoolManager, migrates them between
///        allowlisted fee-paying books, and automatically buys back and burns $WELL
///        from its fee yield (AMENDMENT B: permissionless sweepToBurn — no staking
///        distributor exists, the dev take is structurally 0, 100% of swept accounted
///        revenue becomes burned $WELL).
/// @notice GUARDRAILS (07_ROAM_POLICY_BACKTEST §1, verbatim names, on-chain):
///           - MIN_HOLD: minimum TIME between migrations per position key (7d
///             Safe-settable start, immutable 30d ceiling), anchored at the LATER of
///             position creation and the position key's last migration (a Safe seed is
///             hold-locked from seed time; every migration re-anchors at itself).
///           - MAX_MIGRATIONS_PER_PERIOD: rolling-365-day counter per harvester
///             (default 4, immutable ceiling 52; same-pool re-ranges COUNT — the 07
///             "per rolling week"/"week-bounded" wording is a ratified ERRATUM).
///           - MIN_EXPECTED_GAIN_BPS: ATTESTATION check against the caller-supplied
///             `expectedGainBps` — FAIL-CLOSED on absence/zero. It is NOT a proof (07
///             §1 REQUIRED trust model); MIN_HOLD + the period cap are the
///             self-enforcing guards and the realized-IL ledger is the backstop.
///         NO on-chain book-TVL floor and NO oracle anywhere in the fee/swap path:
///         every price input is the pools' own observable state (StateView slot0) and
///         the pinned fork Quoter's quote — the swap IS the price. The deep-dive
///         rank-7 min-book-TVL on-chain cap is DEMOTED to RoamAllowlist registry
///         metadata (advisory, off-chain — supersession recorded in the SPEC
///         amendment).
///         PERMISSIONING: migrate() and sweepToBurn() are PERMISSIONLESS with NO tip
///         param (a tip paid from protocol capital would turn a permissionless call
///         into a self-dealing farm; absence of the param is the fail-closed form).
///         The only admin surface is the 48h treasury timelock (Safe 2-of-3 proposer):
///         guardrail params within immutable ceilings, migration fee within the
///         deploy-fixed 2000 bps cap, allowlist, seed, exitBook, rescue, sweep routes,
///         one-shot WELL init. migrate() validates toKey against the allowlist ONLY
///         (fromKey is the caller's live position — a dead/removed book can always be
///         migrated OUT of while any live book remains; exitBook is the total-egress
///         path and never consumes the migration cap).
///         SWAP LEG: v4-native, composed in ONE unlockCallback
///         (collect fees → close → charge migration fee → convert the released
///         capital through quoteSingle-bounded exact-input/exact-output PM swaps →
///         open the target band). Price limits are derived from the live pool spot
///         ±SWAP_SLIPPAGE_BPS (the fork rejects tick-extreme limits — clamped to the
///         TickMath bounds). The burn tail's swap runs inside its own unlock for the
///         same reason (PM.swap is lock-gated).
///         v1 CONSTRAINT (disclosed): from-book and to-book must share at least one
///         currency (the conversion leg trades through the shared currency; the
///         books' own pools are the venues). exitBook has no such constraint.
///         AMENDMENT A (band-shape): open/migrate accept ARBITRARY tick ranges
///         including ONE-SIDED upper-max/lower-max bands; whenever a requested band
///         does NOT bracket the live spot tick, DirectionalRange is emitted — the
///         honest directional-disclosure surface. bandShape is TREASURY-DISCRETION
///         config (per-book, via the Safe-seeded open), never the default roam policy
///         and never mixed into the measured-APR ranking (judged by the harness's
///         exposure-tracking leg).
///         CAPITAL-INERT until the Safe funds it; funding size = USER GATE (roam-ops).
contract RoamingHarvester is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------
    // Pinned fork stack (canonical v4 addresses on 4663 are scam drainers)
    // ------------------------------------------------------------------

    /// @dev The ONLY PoolManager: the RH-4663 v4 FORK PoolManager (house pin).
    address public constant FORK_POOL_MANAGER_4663 = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    /// @dev The pinned fork Quoter — 6 identical PM-bound deploys share one codehash;
    ///      the choice among them is arbitrary-but-pinned (QuoterProbe evidence).
    ///      ROAMVAULT-SIZE 2026-09-09: every quoter CALL now runs inside
    ///      RoamMathLib (which re-pins the same address); the IForkQuoter interface
    ///      stays declared here (the fork battery imports it from this file).
    /// @dev The fork StateView lens (ctor-bound to the fork PoolManager) — the
    ///      observable-state spot-price read for sizing and swap limits.
    address public constant FORK_STATE_VIEW = 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2;
    /// @dev Burn address: OZ ERC-20 has no burn(); a plain transfer to dEaD works with
    ///      or without a native burn() (AMENDMENT B).
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    // ------------------------------------------------------------------
    // Guardrails — 07 §1-faithful, Safe-settable starts, immutable ceilings
    // ------------------------------------------------------------------

    /// @notice MIN_HOLD ceiling: 30 days (immutable).
    uint32 public constant MIN_HOLD_CEILING = 30 days;
    /// @notice MAX_MIGRATIONS_PER_PERIOD ceiling: 52 per rolling 365 days (immutable).
    uint16 public constant MAX_MIGRATIONS_CEILING = 52;
    /// @notice MIN_EXPECTED_GAIN_BPS ceiling: 31286 bps — the 07 §2 break-even at the
    ///         heavy cost scenario, 7-day hold (immutable).
    uint32 public constant MIN_EXPECTED_GAIN_CEILING = 31286;
    /// @notice migrationFeeBps hard cap fixed at deploy: 2000 bps — the deliverable-6
    ///         sensitivity grid's upper bound (no Safe-queueable operating value can
    ///         exceed the range the grid actually priced).
    uint32 public constant MIGRATION_FEE_CAP = 2000;
    /// @notice The rolling migration-counter window: 365 days.
    uint64 public constant MIGRATION_PERIOD = 365 days;
    /// @notice Slippage allowance on every fresh quote (1%) — house HarvesterV4 shape.
    uint256 public constant SWAP_SLIPPAGE_BPS = 100;
    /// @notice Sizing margin (0.01%) shaved off the liquidity target so the pool's own
    ///         rounding can never demand a wei more than the tracked capital; the
    ///         residual dust is booked as accounted revenue (burn tail). PUBLIC pin —
    ///         the fork battery derives the dust bound from it (its math lives in
    ///         RoamMathLib since ROAMVAULT-SIZE 2026-09-09).
    uint256 public constant SIZE_MARGIN_BPS = 1;
    uint256 public constant BPS = 10_000;

    /// @dev v4 TickMath sqrt bounds (fork source) — swap price limits are clamped
    ///      inside these (the fork rejects tick-extreme limits with InvalidPrice).
    ///      V-5 fix 2026-09-08 (composition audit): the MAX constant was canonical
    ///      MAX_SQRT_RATIO + 54,389,040 while NAMED "minus one" — a clamp into it
    ///      could still be rejected by the fork. It is now canonical
    ///      TickMath.MAX_SQRT_RATIO - 1 (== the fork table at MAX_TICK minus one,
    ///      battery-pinned), and PUBLIC so the battery can pin the equality.
    ///      Zero behavior change in any reachable live state (spot within ~1% of
    ///      1.46e48 is unreachable); MIN_SQRT_PLUS_1 was already canonical.
    ///      ROAMVAULT-SIZE 2026-09-09: both clamp constants now live in RoamMathLib
    ///      (the clamp math moved there); this public pin stays for the battery's
    ///      live F-4 equality checks.
    uint160 public constant MAX_SQRT_MINUS_1 = 1461446703485210103287273052203988822378729556659;

    // ------------------------------------------------------------------
    // Position key (the `bytes` fromKey/toKey ABI payload = one BookKey)
    // ------------------------------------------------------------------

    struct BookKey {
        IPoolManagerV4.PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt; // seed: MUST be 0 (the roamer assigns monotone nonces); fromKey: the live position's salt; toKey: MUST be 0
    }

    struct Position {
        IPoolManagerV4.PoolKey poolKey;
        int24 tickLower;
        int24 tickUpper;
        bytes32 salt;
        uint128 liquidity;
        uint64 createdAt;
        uint64 lastMigrationAt;
    }

    uint8 internal constant ACTION_NONE = 0;
    uint8 internal constant ACTION_MIGRATE = 1;
    uint8 internal constant ACTION_SEED = 2;
    uint8 internal constant ACTION_EXIT = 3;
    uint8 internal constant ACTION_SWEEP = 4;

    // ------------------------------------------------------------------
    // Immutable wiring
    // ------------------------------------------------------------------

    address public immutable timelock;
    address public immutable treasury;
    address public immutable poolManager; // ctor-enforced == FORK_POOL_MANAGER_4663
    RoamAllowlist public immutable allowlist;

    // ------------------------------------------------------------------
    // Guardrail state (Safe-settable within immutable ceilings)
    // ------------------------------------------------------------------

    uint32 public minHoldSeconds; // MIN_HOLD (7d operating start — roam-ops)
    uint16 public maxMigrationsPerPeriod; // MAX_MIGRATIONS_PER_PERIOD (4 operating start)
    uint32 public minExpectedGainBps; // MIN_EXPECTED_GAIN_BPS (3911 operating start)
    uint32 public migrationFeeBps; // roaming take per migration (1000 start, cap 2000)

    // ------------------------------------------------------------------
    // Positions / accounting
    // ------------------------------------------------------------------

    mapping(bytes32 => Position) internal positions; // keyHash => position (read via positionRecord)
    bytes32[] public openKeys; // enumerable open positions
    mapping(bytes32 => uint256) public poolNonce; // monotone salt nonce per book (re-ranges get fresh keys)
    mapping(address => uint256) public accountedAccrued; // per-token accounted revenue (burn tail)
    address[] public accountedTokens;
    mapping(address => bool) private _accountedTokenSeen;
    mapping(address => IPoolManagerV4.PoolKey) public sweepRoutes; // token -> pinned-PM pool trading (token, WELL)
    mapping(address => uint256) public sweepMinAccrued; // SWEEP_MIN_ACCRUED per token (Safe-settable trigger gate)

    uint64[] private _migrationTimes; // rolling-365d migration timestamps (bounded by the ceiling)

    address public wellToken; // one-shot fail-closed init (inert burn tail until set)

    uint8 internal _activeAction;

    // ------------------------------------------------------------------
    // Events (honest ledger; decomposition follows the house Harvested pattern)
    // ------------------------------------------------------------------

    event BookOpened(
        bytes32 indexed keyHash, bytes32 indexed poolId, uint128 liquidity, int24 tickLower, int24 tickUpper, bytes32 salt
    );
    event BookExited(address indexed to, bytes32 indexed keyHash, uint128 liquidity, uint256 amount0, uint256 amount1);
    event FeesCollected(bytes32 indexed keyHash, bytes32 indexed poolId, uint256 amount0, uint256 amount1);
    event MigrationFeeCharged(bytes32 indexed keyHash, uint256 fee0, uint256 fee1, uint32 feeBps);
    event MigrationExecuted(
        bytes32 indexed fromKeyHash,
        bytes32 indexed toKeyHash,
        int24 toTickLower,
        int24 toTickUpper,
        uint256 collected0,
        uint256 collected1,
        uint256 migrationFee0,
        uint256 migrationFee1,
        uint32 expectedGainBps, // the caller's ATTESTATION claim, recorded as claimed
        uint256 amount0Deployed,
        uint256 amount1Deployed,
        uint128 liquidity
    );
    /// @dev The honest realized-IL mark for the migration keyed by the FROM position
    ///      (>= 0 a loss, < 0 a gain; measured against the pools' own observable
    ///      spots — no oracle; 07 §3's ledger backstop). The from-band ticks are
    ///      recoverable off-chain from fromKeyHash (the position's BookKey).
    event RealizedIL(bytes32 indexed keyHash, int256 il, address ilCurrency);
    event DirectionalRange(bytes32 indexed book, int24 tickLower, int24 tickUpper, int24 spotTick);
    event Burned(address indexed sourceToken, uint256 wellBought, uint256 wellBurned);
    event Forwarded(address indexed token, uint256 amount, address indexed to);
    /// @dev F-3 liveness telemetry: a token whose sweep pass reverted (missing route,
    ///      reverting/blacklisted token, degenerate quote) was SKIPPED — the rest of
    ///      the burn tail stayed live. `reason` = the first word of the revert payload.
    event SweepSkipped(address indexed token, bytes32 reason);
    /// @dev F-3 liveness telemetry: a position whose fee collect reverted (a hooked
    ///      pool reverting inside modifyLiquidity) was SKIPPED — its fees stay in the
    ///      pool and the sweep continued.
    event CollectSkipped(bytes32 indexed keyHash, bytes32 reason);

    // ------------------------------------------------------------------
    // Errors
    // ------------------------------------------------------------------

    error ZeroAddress();
    error NotTimelock(address caller);
    error CallbackNotActive(address caller, uint8 action);
    error BadTicks(int24 tickLower, int24 tickUpper);
    error BadTickAlignment(int24 tick, int24 tickSpacing);
    error ZeroLiquidity();
    error UnknownPosition(bytes32 keyHash);
    error SaltMustBeZero(bytes32 salt);
    error BooksShareNoCurrency(address from0, address from1, address to0, address to1);
    error HoldLocked(uint256 readyAt, uint256 nowTs);
    error MigrationCapReached(uint256 cap);
    error GainAttestationMissing();
    error GainAttestationBelowFloor(uint32 claimed, uint32 floor);
    error MigrationFeeAboveCap(uint32 requested, uint32 cap);
    error ParamAboveCeiling(uint256 requested, uint256 ceiling);
    error MinOutBreached(uint256 leg, uint256 deployed, uint256 minOut);
    error SwapOutputBelowQuote(uint256 received, uint256 quoted);
    error SwapInputAboveBalance(uint256 required, uint256 available);
    error NoWellToken();
    error WellTokenAlreadySet(address current);
    error NoSweepRoute(address token);
    error WrongSweepRoute(address token, address well);
    error InsufficientNativeBalance(uint256 required, uint256 available);
    error NativeForwardFailed();
    error AllowlistTimelockMismatch(address allowlistTimelock, address harvesterTimelock);

    /// @param timelock_  The 48h treasury timelock (the ONLY admin surface).
    /// @param treasury_  Custody address for junk excess (never the operating stream)
    ///                   and the exitBook wind-down recipient candidate.
    /// @param allowlist_ The timelock-gated book registry migrate() rails toKey against.
    /// @param minHoldSeconds_          MIN_HOLD start (<= MIN_HOLD_CEILING; operating 7d).
    /// @param maxMigrationsPerPeriod_  MAX_MIGRATIONS_PER_PERIOD start (<= ceiling; op 4).
    /// @param minExpectedGainBps_      MIN_EXPECTED_GAIN_BPS start (<= ceiling; op 3911).
    /// @param migrationFeeBps_         roaming take start (<= MIGRATION_FEE_CAP).
    constructor(
        address timelock_,
        address treasury_,
        address allowlist_,
        uint32 minHoldSeconds_,
        uint16 maxMigrationsPerPeriod_,
        uint32 minExpectedGainBps_,
        uint32 migrationFeeBps_
    ) ReentrancyGuard() {
        if (timelock_ == address(0) || treasury_ == address(0) || allowlist_ == address(0)) revert ZeroAddress();
        // SINGLE admin root (ROAMER-AUDIT F-7): an allowlist governed by a DIFFERENT
        // timelock would silently split the governance surface (the Safe could govern
        // books the harvester's own timelock does not control, and vice versa).
        if (RoamAllowlist(allowlist_).timelock() != timelock_) {
            revert AllowlistTimelockMismatch(RoamAllowlist(allowlist_).timelock(), timelock_);
        }
        // Lean constructor: param validation lives in the internal setters (house
        // HarvesterV4 constructor-stack lesson).
        timelock = timelock_;
        treasury = treasury_;
        allowlist = RoamAllowlist(allowlist_);
        poolManager = FORK_POOL_MANAGER_4663; // the pin IS the value: a WrongPoolManager revert is unreachable by construction
        _setMinHoldSeconds(minHoldSeconds_);
        _setMaxMigrationsPerPeriod(maxMigrationsPerPeriod_);
        _setMinExpectedGainBps(minExpectedGainBps_);
        _setMigrationBps(migrationFeeBps_);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice A position's key hash: keccak256(abi.encode(poolKey, tickLower, tickUpper, salt)).
    function keyHash(BookKey calldata key) external pure returns (bytes32) {
        return keccak256(abi.encode(key.poolKey, key.tickLower, key.tickUpper, key.salt));
    }

    /// @notice A book's pool id — the fork's PoolId derivation (verified live).
    function bookPoolId(IPoolManagerV4.PoolKey calldata key) external pure returns (bytes32) {
        return keccak256(abi.encode(key));
    }

    function openKeyCount() external view returns (uint256) {
        return openKeys.length;
    }

    /// @notice Full position record (public auto-getters omit nested structs).
    function positionRecord(bytes32 kHash) external view returns (Position memory) {
        return positions[kHash];
    }

    /// @notice Migrations performed inside the rolling 365-day period.
    function migrationsThisPeriod() external view returns (uint256 count) {
        uint64 cutoff = uint64(block.timestamp - MIGRATION_PERIOD);
        for (uint256 i = 0; i < _migrationTimes.length; i++) {
            if (_migrationTimes[i] > cutoff) count++;
        }
    }

    // ------------------------------------------------------------------
    // Admin surface — ONLY the 48h timelock (Safe 2-of-3 proposer)
    // ------------------------------------------------------------------

    modifier onlyTimelock() {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        _;
    }

    function setMinHoldSeconds(uint32 v) external onlyTimelock {
        _setMinHoldSeconds(v);
    }

    function setMaxMigrationsPerPeriod(uint16 v) external onlyTimelock {
        _setMaxMigrationsPerPeriod(v);
    }

    function setMinExpectedGainBps(uint32 v) external onlyTimelock {
        _setMinExpectedGainBps(v);
    }

    /// @notice The roaming take per migration, charged on the released principal
    ///         (in-kind, both legs) into the accounted revenue — which the burn tail
    ///         swaps to WELL and burns. Hard cap fixed at deploy (2000 bps).
    function setMigrationBps(uint32 v) external onlyTimelock {
        _setMigrationBps(v);
    }

    /// @notice SWEEP_MIN_ACCRUED per token: the sweep trigger gate (below the floor,
    ///         the accounted accrual waits for the next sweep).
    function setSweepMinAccrued(address token, uint256 v) external onlyTimelock {
        sweepMinAccrued[token] = v;
    }

    /// @notice Configure the burn tail's swap route for `token`: a pinned-PM pool
    ///         trading (token, wellToken). `token` MAY be address(0) — a native-ETH
    ///         accrual is swapped on a (native, WELL) pool and paid via settle{value}.
    ///         Passing the zero KEY removes the route.
    function setSweepRoute(address token, IPoolManagerV4.PoolKey calldata route) external onlyTimelock {
        if (
            route.currency0 == address(0) && route.currency1 == address(0) && route.fee == 0
                && route.tickSpacing == 0 && route.hooks == address(0)
        ) {
            delete sweepRoutes[token];
            return;
        }
        if (wellToken == address(0)) revert NoWellToken();
        if (!(route.currency0 < route.currency1)) revert WrongSweepRoute(token, wellToken);
        if (
            !(route.currency0 == token && route.currency1 == wellToken)
                && !(route.currency0 == wellToken && route.currency1 == token)
        ) {
            revert WrongSweepRoute(token, wellToken);
        }
        sweepRoutes[token] = route;
    }

    /// @notice ONE-SHOT, fail-closed, timelock-only WELL init. The burn tail stays
    ///         INERT (sweepToBurn reverts NoWellToken) until this lands; fees
    ///         accumulate in the harvester, never lost. Re-set and zero revert.
    function setWellToken(address token) external onlyTimelock {
        if (wellToken != address(0)) revert WellTokenAlreadySet(wellToken);
        if (token == address(0)) revert ZeroAddress();
        wellToken = token;
    }

    /// @notice Timelock-only emergency egress of a stranded token balance to the
    ///         treasury (house forwardToken analog; the junk guard already forwards
    ///         unaccounted excess at sweep time — this is the manual override).
    ///         Clamped to the junk guard's OWN rule: only the UNACCOUNTED excess
    ///         (raw balance above the accounted accrual) is rescueable. Forwarding the
    ///         full raw balance could strand accounted > raw — the junk guard would go
    ///         blind (future donations silently absorbed) and a zero-balance accrued
    ///         token would revert the whole sweep on a zero-quote burn (ROAMER-AUDIT F-5).
    function rescueToTreasury(address token) external onlyTimelock nonReentrant {
        // ROAMVAULT item 3 + V-2 fix 2026-09-08 (composition audit): the basis
        // excludes the VAULT bucket too. Once the last vault position closes, the
        // open-positions guard lifts while the 90% depositor bucket can still sit
        // un-swept (it fills at the SAME redeem's fee-collect that deletes the tag)
        // — a bal-minus-accounted basis would sweep un-pushed depositor yield to
        // TREASURY. Only true junk (above accounted accrual + the vault bucket) is
        // rescueable; the bucket drains exclusively through the vault-yield sweep.
        uint256 accounted = accountedAccrued[token] + vaultAccrued[token];
        _revertIfVaultPositionsOpen(); // fail-closed custody — vault capital is rescueable ONLY through the vault's own egress seam, never by treasury rescue
        if (token == address(0)) {
            uint256 bal = address(this).balance;
            if (bal > accounted) _forwardNative(bal - accounted);
        } else {
            uint256 bal = IERC20(token).balanceOf(address(this));
            if (bal > accounted) {
                uint256 junk = bal - accounted;
                IERC20(token).safeTransfer(treasury, junk);
                emit Forwarded(token, junk, treasury);
            }
        }
    }

    function _setMinHoldSeconds(uint32 v) internal {
        if (v > MIN_HOLD_CEILING) revert ParamAboveCeiling(v, MIN_HOLD_CEILING);
        minHoldSeconds = v;
    }

    function _setMaxMigrationsPerPeriod(uint16 v) internal {
        if (v == 0 || v > MAX_MIGRATIONS_CEILING) revert ParamAboveCeiling(v, MAX_MIGRATIONS_CEILING);
        maxMigrationsPerPeriod = v;
    }

    function _setMinExpectedGainBps(uint32 v) internal {
        if (v > MIN_EXPECTED_GAIN_CEILING) revert ParamAboveCeiling(v, MIN_EXPECTED_GAIN_CEILING);
        minExpectedGainBps = v;
    }

    function _setMigrationBps(uint32 v) internal {
        if (v > MIGRATION_FEE_CAP) revert MigrationFeeAboveCap(v, MIGRATION_FEE_CAP);
        migrationFeeBps = v;
    }

    // ------------------------------------------------------------------
    // Seed — the FIRST position per book (timelock-only, house custody)
    // ------------------------------------------------------------------

    /// @notice Open the FIRST position on a book: timelock-only (07 §1's guardrails
    ///         are migration-scoped and give a first-open no protection — the house
    ///         HarvesterV4 timelock-only openPosition is the custody pattern).
    ///         `key` = the ABI-encoded BookKey payload with salt 0 (the roamer assigns
    ///         the monotone per-book nonce). Sizing is the Safe's off-chain decision
    ///         (`liquidity`); the pool's own math dictates the required principal, paid
    ///         from THIS contract's balances (underfunding reverts atomically;
    ///         overfunding leftover is unaccounted and routes to the treasury at sweep
    ///         time — the house force-sent-token pattern). POL mode: protocol capital
    ///         ONLY. ARBITRARY tick bands accepted (AMENDMENT A).
    function seedBook(bytes calldata key, uint128 liquidity) external onlyTimelock nonReentrant {
        BookKey memory bk = abi.decode(key, (BookKey));
        if (liquidity == 0) revert ZeroLiquidity();
        if (bk.salt != bytes32(0)) revert SaltMustBeZero(bk.salt);
        _validateBand(bk);

        bytes32 pid = keccak256(abi.encode(bk.poolKey));
        if (!allowlist.isListed(pid)) revert UnknownPosition(pid);

        bytes32 salt = bytes32(++poolNonce[pid]); // monotone per-book salt (fresh key per position)
        _activeAction = ACTION_SEED;
        IPoolManagerV4(poolManager).unlock(abi.encode(bk.poolKey, bk.tickLower, bk.tickUpper, salt, liquidity));
        _activeAction = ACTION_NONE;

        bytes32 kHash = keccak256(abi.encode(bk.poolKey, bk.tickLower, bk.tickUpper, salt));
        positions[kHash] = Position({
            poolKey: bk.poolKey,
            tickLower: bk.tickLower,
            tickUpper: bk.tickUpper,
            salt: salt,
            liquidity: liquidity,
            createdAt: uint64(block.timestamp), // the LATER-of anchor's creation leg: a seed is hold-locked from seed time
            lastMigrationAt: 0
        });
        openKeys.push(kHash);

        _emitDirectionalRangeIfDirectional(pid, bk.tickLower, bk.tickUpper);
        emit BookOpened(kHash, pid, liquidity, bk.tickLower, bk.tickUpper, salt);
    }

    // ------------------------------------------------------------------
    // Migrate — permissionless, railed on toKey ONLY, one unlockCallback
    // ------------------------------------------------------------------

    /// @notice Close the `fromKey` position, charge `migrationFeeBps` on the released
    ///         principal, convert the capital through quoteSingle-bounded v4-native
    ///         swaps, and open the `toKey` band — all in ONE unlockCallback.
    ///         `fromKey`/`toKey` = ABI-encoded BookKey payloads (toKey salt MUST be 0;
    ///         fromKey salt = the live position's salt). PERMISSIONLESS, NO tip.
    ///         Guardrails (07 §1, fail-closed): MIN_HOLD (later-of
    ///         creation/last-migration anchor), the rolling-365d
    ///         MAX_MIGRATIONS_PER_PERIOD counter (re-ranges count), and the
    ///         MIN_EXPECTED_GAIN_BPS attestation floor (fail-closed on absence/zero —
    ///         an attestation, never a proof). fromKey is NEVER railed against the
    ///         allowlist; toKey must be allowlisted. `minOuts` are per-currency floors
    ///         on the amounts deployed into the target position (checked after the
    ///         pool told us the real numbers; breach reverts the WHOLE migration).
    function migrate(bytes calldata fromKey, bytes calldata toKey, uint256[2] calldata minOuts, uint32 expectedGainBps)
        external
        nonReentrant
    {
        BookKey memory fk = abi.decode(fromKey, (BookKey));
        BookKey memory tk = abi.decode(toKey, (BookKey));
        bytes32 fromHash = _migratePreflight(fk, tk, expectedGainBps);

        // Guardrail 2: rolling-365d cap (same-pool re-ranges count — no exemption path).
        _checkAndConsumeMigrationCap();

        _activeAction = ACTION_MIGRATE;
        IPoolManagerV4(poolManager).unlock(abi.encode(fk, tk, minOuts, expectedGainBps, fromHash));
        _activeAction = ACTION_NONE;
    }

    /// @dev Guardrails 1 + 3 and the target-book rails, fail-closed BEFORE any cap is
    ///      consumed. Split out to keep migrate()'s frame shallow.
    function _migratePreflight(BookKey memory fromKey, BookKey memory toKey, uint32 expectedGainBps)
        internal
        view
        returns (bytes32 fromHash)
    {
        fromHash = keccak256(abi.encode(fromKey.poolKey, fromKey.tickLower, fromKey.tickUpper, fromKey.salt));
        Position storage pos = positions[fromHash];
        if (pos.liquidity == 0) revert UnknownPosition(fromHash);

        _validateBand(toKey);
        if (toKey.salt != bytes32(0)) revert SaltMustBeZero(toKey.salt);
        bytes32 toPid = keccak256(abi.encode(toKey.poolKey));
        if (!allowlist.isListed(toPid)) revert UnknownPosition(toPid);
        _sharedCurrency(fromKey.poolKey, toKey.poolKey); // fail-closed v1 constraint (also checked in the callback)

        // Guardrail 1: MIN_HOLD — later of creation and last migration (07 §1).
        uint64 anchor = pos.lastMigrationAt > pos.createdAt ? pos.lastMigrationAt : pos.createdAt;
        uint256 readyAt = uint256(anchor) + minHoldSeconds;
        if (block.timestamp < readyAt) revert HoldLocked(readyAt, block.timestamp);

        // Guardrail 3: MIN_EXPECTED_GAIN_BPS attestation — FAIL-CLOSED on absence/zero.
        if (expectedGainBps == 0) revert GainAttestationMissing();
        if (expectedGainBps < minExpectedGainBps) revert GainAttestationBelowFloor(expectedGainBps, minExpectedGainBps);
    }

    // ------------------------------------------------------------------
    // exitBook — timelock-gated FULL capital egress (never a migration)
    // ------------------------------------------------------------------

    /// @notice Safe-queued FULL close of one position with both legs (principal +
    ///         final accrued fees) to `to` — the house HarvesterV4 closePosition(to)
    ///         custody pattern. Because migrate() rails on toKey ONLY, an emptied or
    ///         dead allowlist can never trap protocol capital: exitBook is the
    ///         total-egress path when no live book remains. NOT a migration: it
    ///         removes capital, never roams it, and NEVER consumes
    ///         MAX_MIGRATIONS_PER_PERIOD. `fromKey` = the ABI-encoded BookKey payload
    ///         of the live position.
    function exitBook(bytes calldata fromKey, address to) external onlyTimelock nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        BookKey memory key = abi.decode(fromKey, (BookKey));
        bytes32 fromHash = keccak256(abi.encode(key.poolKey, key.tickLower, key.tickUpper, key.salt));
        Position storage pos = positions[fromHash];
        if (pos.liquidity == 0) revert UnknownPosition(fromHash); if (_isVaultPosition[fromHash]) revert VaultPositionProtected(fromHash); // ROAMVAULT item 3: fail-closed custody — vault-tagged capital exits ONLY through the vault's own egress seam, never to an arbitrary treasury

        uint128 liquidity = pos.liquidity;
        _activeAction = ACTION_EXIT;
        bytes memory ret = IPoolManagerV4(poolManager).unlock(abi.encode(key, to));
        _activeAction = ACTION_NONE;

        // The close callback took every leg straight to `to`; clear the record.
        _deletePosition(fromHash);
        (uint256 taken0, uint256 taken1) = abi.decode(ret, (uint256, uint256));
        emit BookExited(to, fromHash, liquidity, taken0, taken1);
    }

    // ------------------------------------------------------------------
    // sweepToBurn — AMENDMENT B: the automated buyback-and-burn tail
    // ------------------------------------------------------------------

    /// @notice Permissionless (NO tip — a burn output cannot self-deal), nonReentrant:
    ///         collect the ACCOUNTED per-token revenue accrual (live fees first, from
    ///         every open position) → per-token junk split (for every token WITH
    ///         accounted accrual: raw-balance EXCESS above the accrual forwards to the
    ///         TREASURY — force-sent/junk never enters the burn stream; junk of a
    ///         never-accrued token waits for the timelock's rescueToTreasury) → swap
    ///         the swept revenue to WELL through the pinned fork Quoter (quoteSingle
    ///         EXACT-OUTPUT, minOut-bounded — the swap IS the price, no oracle) →
    ///         transfer the bought WELL to dEaD → Burned.
    ///         DEV TAKE STRUCTURALLY 0: nothing is retained anywhere; no fee/dev/take
    ///         setter exists. FAIL-CLOSED INERT until the Safe sets the WELL token.
    ///         Composed in ONE unlock (PM.swap is lock-gated). PER-TOKEN LIVENESS
    ///         (F-3): one unrouteable/reverting token (or one reverting hooked pool)
    ///         is SKIPPED (SweepSkipped/CollectSkipped) — it can never brick the whole
    ///         burn tail.
    function sweepToBurn() external nonReentrant {
        address well = wellToken;
        if (well == address(0)) revert NoWellToken();
        _activeAction = ACTION_SWEEP;
        IPoolManagerV4(poolManager).unlock(abi.encode(well));
        _activeAction = ACTION_NONE;
    }

    // ------------------------------------------------------------------
    // PoolManager callback — the ONE composed unlock for every action
    // ------------------------------------------------------------------

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != poolManager || _activeAction == ACTION_NONE) {
            revert CallbackNotActive(msg.sender, _activeAction);
        }
        uint8 action = _activeAction;
        if (action == ACTION_SEED) {
            _seedCallback(data);
            return "";
        }
        if (action == ACTION_EXIT) {
            return _exitCallback(data);
        }
        if (action == ACTION_SWEEP) {
            _sweepCallback(abi.decode(data, (address)));
            return "";
        }
        if (action == ACTION_MIGRATE) {
            _migrateCallback(data);
            return "";
        }
        if (action == ACTION_VSWEEP) {
            _vSweepCallback();
            return "";
        }
        if (action == ACTION_VDEPLOY) {
            return _vDeployCallback(data);
        }
        if (action == ACTION_VEGRESS) {
            return _vEgressCallback(data);
        }
        revert CallbackNotActive(msg.sender, action);
    }

    /// @notice Accept native ETH: taken native legs and force-sent donations.
    receive() external payable {}

    // ------------------------------------------------------------------
    // Internals — callbacks
    // ------------------------------------------------------------------

    function _seedCallback(bytes calldata data) internal {
        (IPoolManagerV4.PoolKey memory key, int24 tickLower, int24 tickUpper, bytes32 salt, uint128 liquidity) =
            abi.decode(data, (IPoolManagerV4.PoolKey, int24, int24, bytes32, uint128));
        // ROAMVAULT-SIZE 2026-09-09: the mint body (modifyLiquidity + decode +
        // per-leg pay) moved VERBATIM to RoamMathLib.openLegs — the paid amounts
        // are unchecked here exactly as the old _mint returned none.
        RoamMathLib.openLegs(key, tickLower, tickUpper, salt, liquidity);
    }

    function _exitCallback(bytes calldata data) internal returns (bytes memory) {
        (BookKey memory key, address to) = abi.decode(data, (BookKey, address));
        // A full decrease returns principal + accrued fees in ONE callerDelta (the
        // fork's callerDelta = principalDelta + feesAccrued, house-verified): every
        // leg goes straight to `to` — the disclosed wind-down custody event.
        // ROAMVAULT-SIZE 2026-09-09: the close legs moved VERBATIM to
        // RoamMathLib.exitLegsTo (delegatecall frame — identical msg.sender/
        // address(this), so the PM lock and settlement checks behave exactly as
        // before); the storage read of the position's liquidity stays HERE.
        Position storage pos = positions[keccak256(abi.encode(key.poolKey, key.tickLower, key.tickUpper, key.salt))];
        (uint256 taken0, uint256 taken1) =
            RoamMathLib.exitLegsTo(key.poolKey, key.tickLower, key.tickUpper, key.salt, pos.liquidity, to);
        return abi.encode(taken0, taken1);
    }

    function _sweepCallback(address well) internal {
        // 1) Collect live fees from every open position into the accounted accrual —
        //    PER-POSITION ISOLATION (ROAMER-AUDIT F-3): a hook reverting inside
        //    modifyLiquidity reverts THIS position's collect only (skipped via
        //    CollectSkipped); its fees stay in the pool and the sweep continues.
        _collectAllFees();
        // 2) Per-token junk split + swap-to-WELL + burn (must run INSIDE the lock) —
        //    PER-TOKEN ISOLATION (ROAMER-AUDIT F-3): one unrouteable/reverting token
        //    (missing route, paused/blacklisted token, degenerate quote) is SKIPPED
        //    (SweepSkipped) and can never brick the whole burn tail. The skipped
        //    token's accrual AND its junk stay put (its whole pass reverted as a
        //    unit) for the next sweep once the Safe routes it.
        uint256 m = accountedTokens.length;
        for (uint256 i = 0; i < m; i++) {
            (bool ok, bytes memory err) =
                address(this).call(abi.encodeCall(this.sweepOneToken, (accountedTokens[i], well)));
            if (!ok) emit SweepSkipped(accountedTokens[i], _skipReason(err));
        }
        // 3) ROAMVAULT item 7: the VAULT-YIELD push rides the same sweep (isolated
        //    per-token pass — a stuck push can never brick the burn tail).
        _pushVaultYieldAll();
    }

    /// @dev ROAMVAULT item 7 (extracted verbatim from the sweep callback): the
    ///      per-position fee-collect loop, shared by the burn sweep and the
    ///      vault-yield sweep (the collect loop FILLS the vault bucket).
    function _collectAllFees() internal {
        uint256 n = openKeys.length;
        for (uint256 i = 0; i < n; i++) {
            (bool okC, bytes memory errC) =
                address(this).call(abi.encodeCall(this.collectOnePosition, (openKeys[i])));
            if (!okC) emit CollectSkipped(openKeys[i], _skipReason(errC));
        }
    }

    /// @dev ROAMVAULT item 7: the per-token vault-yield push loop (isolated — a stuck
    ///      token emits VaultYieldSkipped and the rest of the lane continues). WELL-
    ///      INDEPENDENT: this lane never consults wellToken.
    function _pushVaultYieldAll() internal {
        uint256 v = _vaultAccrualTokens.length;
        for (uint256 i = 0; i < v; i++) {
            (bool okV, bytes memory errV) =
                address(this).call(abi.encodeCall(this.pushVaultYieldOne, (_vaultAccrualTokens[i])));
            if (!okV) emit VaultYieldSkipped(_vaultAccrualTokens[i], _skipReason(errV));
        }
    }

    /// @dev ISOLATED per-position fee collect (F-3 liveness). NOT a public surface:
    ///      only the sweep's own unlock callback may drive it (guarded self-call —
    ///      an external frame is what makes the per-position revert catchable). Both
    ///      sweep actions (burn + vault-yield) may drive it.
    function collectOnePosition(bytes32 kHash) external {
        if (msg.sender != address(this) || (_activeAction != ACTION_SWEEP && _activeAction != ACTION_VSWEEP)) {
            revert CallbackNotActive(msg.sender, _activeAction);
        }
        _collectOne(kHash);
    }

    /// @dev ISOLATED per-token sweep pass (F-3 liveness). NOT a public surface: only
    ///      the sweep's own unlock callback may drive it (guarded self-call — an
    ///      external frame is what makes the per-token revert catchable).
    function sweepOneToken(address token, address well) external {
        if (msg.sender != address(this) || _activeAction != ACTION_SWEEP) {
            revert CallbackNotActive(msg.sender, _activeAction);
        }
        _sweepToken(token, well);
    }

    /// @dev First 4 bytes of the revert payload (the custom-error selector when
    ///      present), left-aligned — the skip events' honest reason field. Empty
    ///      reverts carry a fixed label.
    function _skipReason(bytes memory err) internal pure returns (bytes32 reason) {
        uint256 n = err.length < 4 ? err.length : 4;
        for (uint256 i = 0; i < n; i++) {
            reason |= bytes32(uint256(uint8(err[i]))) << (248 - 8 * i);
        }
        if (reason == 0) reason = "harvester:reverted";
    }

    function _collectOne(bytes32 kHash) internal {
        Position storage pos = positions[kHash];
        if (pos.liquidity == 0) return;
        // ROAMVAULT-SIZE 2026-09-09: the zero-delta collect legs (modifyLiquidity +
        // decode + both takes) moved VERBATIM to RoamMathLib.collectFees.
        (uint256 c0, uint256 c1) = RoamMathLib.collectFees(pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt);
        // ROAMVAULT item 7: provenance split at the credit choke point — vault-tagged
        // fees credit the VAULT bucket (90% depositors / 10% burn), POL fees stay
        // 100% burn.
        bool vaultLane = _isVaultPosition[kHash];
        if (c0 > 0) _creditAccrualLane(pos.poolKey.currency0, c0, vaultLane);
        if (c1 > 0) _creditAccrualLane(pos.poolKey.currency1, c1, vaultLane);
        emit FeesCollected(kHash, keccak256(abi.encode(pos.poolKey)), c0, c1);
    }

    function _migrateCallback(bytes calldata data) internal {
        (BookKey memory fromKey, BookKey memory toKey, uint256[2] memory minOuts, uint32 claimedGain, bytes32 fromHash) =
            abi.decode(data, (BookKey, BookKey, uint256[2], uint32, bytes32));
        Leg memory leg;
        leg.fromHash = fromHash;
        leg.claimedGain = claimedGain;
        _collectAndClose(fromKey, leg);
        _takeAndConvert(fromKey, toKey, leg);
        // ROAMVAULT item 5: the to-position's vault tag is set at completion
        // (_emitMigration) — the residual lane is bracketed EXPLICITLY here so a
        // vault migration's deploy residual returns to the vault, never the accrual.
        _vaultResidualLane = _isVaultPosition[fromHash];
        _vaultResidualReturned = 0;
        // ROAMVAULT items 1+5: the vault path is single-sided after _convertCapital
        // (the sold leg lands entirely in the shared currency), so the to-book's
        // deficit buy carries the fee+impact wedge — plan at the margin-scaled capital
        // (see VAULT_DEPLOY_MARGIN_BPS); the margin returns as residual below.
        if (_vaultResidualLane) _applyVaultPlanMargin(leg.ds);
        Deployed memory dep = _deployToBand(toKey, leg.ds);
        _bookAndEmit(toKey, minOuts, leg, dep);
        // ROAMVAULT item 5 (the residual's idle-book credit): the routed residual
        // arrived at the vault as a RAW transfer — unaccounted excess by the storage
        // accounting, invisible to the share price and stranded outside the books.
        // The excess-bounded harvest() seam (the declared yield-push mechanism)
        // credits exactly what physically arrived, so depositor principal coming home
        // lands in the IDLE book. The realized-IL mark above stays RAW: it writes the
        // migration's fee/valuation wedges down ONCE (deployed book), while this
        // credit returns the un-deployed margin — no double count, books conserve.
        if (_vaultResidualReturned > 0) IRoamVaultVault(vault).harvest(_vaultResidualReturned);
        _vaultResidualLane = false;
        _vaultResidualReturned = 0;
    }

    /// @dev ROAMVAULT items 1+5: shrink a vault-lane DeployState's planned amounts to
    ///      (BPS − VAULT_DEPLOY_MARGIN_BPS) of the tracked capital — the deploy-plan
    ///      headroom that keeps the deficit buy's fee+impact wedge inside the physical
    ///      balance (see VAULT_DEPLOY_MARGIN_BPS). The margin itself is depositor
    ///      capital: the residual routing returns it to the vault.
    function _applyVaultPlanMargin(DeployState memory ds) internal pure {
        ds.amtA = Math.mulDiv(ds.amtA, BPS - VAULT_DEPLOY_MARGIN_BPS, BPS);
        if (ds.amtB > 0) ds.amtB = Math.mulDiv(ds.amtB, BPS - VAULT_DEPLOY_MARGIN_BPS, BPS);
    }

    /// @dev One migration's accumulator: the released capital, the honest-ledger
    ///      from-band fields, the charged roaming take, and the conversion output.
    struct Leg {
        uint256 collected0;
        uint256 collected1;
        uint256 principal0;
        uint256 principal1;
        bytes32 fromPid;
        bytes32 fromHash;
        uint32 claimedGain;
        uint256 fee0;
        uint256 fee1;
        address ilCurrency;
        bool sIsFromC0; // the shared currency is the FROM book's currency0 (IL valuation branch)
        DeployState ds;
    }

    /// @dev Steps 1-2 of the migration: harvest-before-move (fees → accounted
    ///      accrual) and the full close (principal out). Split out to keep the
    ///      callback frames shallow (legacy codegen stack limit — house lesson).
    function _collectAndClose(BookKey memory fromKey, Leg memory leg) internal {
        Position storage pos = positions[leg.fromHash];
        leg.fromPid = keccak256(abi.encode(fromKey.poolKey));

        // ---- Step 1: harvest-before-move — collect from-fees into the accrual ----
        // ROAMVAULT-SIZE 2026-09-09: both settlement cores moved VERBATIM to
        // RoamMathLib (collectFees = zero-delta collect + both takes;
        // decreaseLegs = full close + both takes), identical leg order and
        // selectors; the storage reads of the position fields stay HERE.
        (leg.collected0, leg.collected1) =
            RoamMathLib.collectFees(fromKey.poolKey, pos.tickLower, pos.tickUpper, pos.salt);
        // ROAMVAULT item 7: provenance split — vault-tagged harvest-before-move fees
        // credit the VAULT bucket, POL fees stay 100% burn.
        bool vaultLane = _isVaultPosition[leg.fromHash];
        if (leg.collected0 > 0) _creditAccrualLane(fromKey.poolKey.currency0, leg.collected0, vaultLane);
        if (leg.collected1 > 0) _creditAccrualLane(fromKey.poolKey.currency1, leg.collected1, vaultLane);
        emit FeesCollected(leg.fromHash, leg.fromPid, leg.collected0, leg.collected1);

        // ---- Step 2: close the from-position (principal out) ----
        (leg.principal0, leg.principal1) =
            RoamMathLib.decreaseLegs(fromKey.poolKey, pos.tickLower, pos.tickUpper, pos.salt, pos.liquidity);
        _deletePosition(leg.fromHash);
    }

    /// @dev Step 3 + 4: the roaming take (in-kind, both legs → accounted, the burn
    ///      tail) and the capital conversion to the target denomination.
    function _takeAndConvert(BookKey memory fromKey, BookKey memory toKey, Leg memory leg) internal {
        leg.ilCurrency = _sharedCurrency(fromKey.poolKey, toKey.poolKey);
        leg.sIsFromC0 = fromKey.poolKey.currency0 == leg.ilCurrency;

        // ROAMVAULT item 4 (the migrationFee vault-branch guard): the roaming take on
        // VAULT capital is exactly the principal-take the 90/10 ruling forbids — the
        // vault path charges STRUCTURALLY ZERO. POL positions keep migrationFeeBps.
        uint32 feeBps = _isVaultPosition[leg.fromHash] ? 0 : migrationFeeBps;
        leg.fee0 = Math.mulDiv(leg.principal0, feeBps, BPS);
        leg.fee1 = Math.mulDiv(leg.principal1, feeBps, BPS);
        if (leg.fee0 > 0) _creditAccrual(fromKey.poolKey.currency0, leg.fee0);
        if (leg.fee1 > 0) _creditAccrual(fromKey.poolKey.currency1, leg.fee1);
        emit MigrationFeeCharged(leg.fromHash, leg.fee0, leg.fee1, feeBps);

        // The from-spot snapshot (observable state) anchors the honest realized-IL
        // mark taken later — read it BEFORE our own conversion swaps move the pool.
        (uint160 fromSqrtP,,, ) = IStateView(FORK_STATE_VIEW).getSlot0(leg.fromPid);
        leg.ds = _convertCapital(fromKey, toKey, leg.ilCurrency, leg.principal0 - leg.fee0, leg.principal1 - leg.fee1);
        leg.ds.fromSqrtP = fromSqrtP;
    }

    /// @dev Step 6: minOut enforcement + bookkeeping + the honest-ledger
    ///      MigrationExecuted emission (the whole migration reverts atomically).
    function _bookAndEmit(BookKey memory toKey, uint256[2] memory minOuts, Leg memory leg, Deployed memory dep) internal {
        // minOuts are floors on the deployed amounts — fail-closed (checked AFTER the
        // pool told us the real numbers).
        if (dep.owed0 < minOuts[0]) revert MinOutBreached(0, dep.owed0, minOuts[0]);
        if (dep.owed1 < minOuts[1]) revert MinOutBreached(1, dep.owed1, minOuts[1]);

        bytes32 toHash = _bookPosition(toKey, dep);
        _emitMigration(toKey, leg, dep, toHash);
    }

    /// @dev Write the new position record (MIN_HOLD re-anchored at this migration)
    ///      and disclose a directional band (AMENDMENT A). Returns the new key hash.
    function _bookPosition(BookKey memory toKey, Deployed memory dep) internal returns (bytes32 toHash) {
        bytes32 toPid = keccak256(abi.encode(toKey.poolKey));
        toHash = keccak256(abi.encode(toKey.poolKey, toKey.tickLower, toKey.tickUpper, dep.salt));
        positions[toHash] = Position({
            poolKey: toKey.poolKey,
            tickLower: toKey.tickLower,
            tickUpper: toKey.tickUpper,
            salt: dep.salt,
            liquidity: dep.liquidity,
            createdAt: uint64(block.timestamp),
            lastMigrationAt: uint64(block.timestamp) // re-anchor MIN_HOLD at this migration
        });
        openKeys.push(toHash);
        _emitDirectionalRangeIfDirectional(toPid, toKey.tickLower, toKey.tickUpper);
    }

    /// @dev The honest-ledger migration emission (own frame for the codegen stack
    ///      budget): the migration record, then the realized-IL mark.
    function _emitMigration(BookKey memory toKey, Leg memory leg, Deployed memory dep, bytes32 toHash) internal {
        emit MigrationExecuted(
            leg.fromHash,
            toHash,
            toKey.tickLower,
            toKey.tickUpper,
            leg.collected0,
            leg.collected1,
            leg.fee0,
            leg.fee1,
            leg.claimedGain,
            dep.owed0,
            dep.owed1,
            dep.liquidity
        );
        // Honest realized-IL mark (in the shared currency, at the pools' own spots).
        bytes32 toPid = keccak256(abi.encode(toKey.poolKey));
        (uint160 toSqrtP, , , ) = IStateView(FORK_STATE_VIEW).getSlot0(toPid);
        int256 il = _realizedIL(leg, toKey, toSqrtP, dep);
        emit RealizedIL(leg.fromHash, il, leg.ilCurrency);
        if (_isVaultPosition[leg.fromHash]) {
            // ROAMVAULT item 6 (the vault-IL report, in the _emitMigration completion
            // chain): the to-position INHERITS the vault tag (vault capital stays
            // vault capital across a migration), its par-USDG mark is set from the
            // deployed amounts at the to-book spot (observable state, no oracle), and
            // the realized-IL mark pushes to the vault's deployed book — the vault
            // re-values via applyRealizedIL (losses write the share price DOWN).
            _isVaultPosition[toHash] = true;
            _positionDeployedUsdg[toHash] = _deployedUsdgValue(toKey, dep, toSqrtP);
            IRoamVaultVault(vault).applyRealizedIL(il, leg.ilCurrency);
        }
    }

    struct DeployState {
        address curA; // capital currency A (shared currency s, or from-c0 on a re-range)
        uint256 amtA;
        address curB; // capital currency B (zero on a cross-book migration)
        uint256 amtB;
        uint160 fromSqrtP; // the from-book spot snapshot at conversion time (IL mark anchor)
    }

    struct Deployed {
        uint128 liquidity;
        uint256 owed0;
        uint256 owed1;
        bytes32 salt;
    }

    /// @dev Sell the non-shared from-currency entirely (on the from-pool — it IS that
    ///      book's own venue), leaving the capital in the shared currency. A
    ///      same-pool re-range skips conversion: both legs are already held. Thin
    ///      internal wrapper — the storage-free conversion moved VERBATIM to
    ///      RoamMathLib.convertCapital (ROAMVAULT-SIZE 2026-09-09; the leg sales run
    ///      from the delegatecall frame with identical msg.sender/address(this), so
    ///      PoolManager lock and settlement checks behave exactly as before). The
    ///      returned DeployState carries fromSqrtP = 0 — the caller overwrites it
    ///      with its pre-conversion spot snapshot, exactly as before.
    function _convertCapital(BookKey memory fromKey, BookKey memory toKey, address s, uint256 cap0, uint256 cap1)
        internal
        returns (DeployState memory ds)
    {
        (ds.curA, ds.amtA, ds.curB, ds.amtB) =
            RoamMathLib.convertCapital(fromKey.poolKey, toKey.poolKey, s, cap0, cap1);
    }

    /// @dev Sell `amountIn` of `tokenIn` for the shared currency ON THE FROM-POOL via
    ///      an exact-input v4-native swap (fresh pinned-Quoter quote, fail-closed
    ///      stale-quote check, spot-derived price limit). Thin internal wrapper —
    ///      the body moved VERBATIM to RoamMathLib.sellLeg (ROAMVAULT-SIZE
    ///      2026-09-09); its unused shared-currency parameter is kept in this
    ///      signature so the call sites stay untouched.
    function _sellLeg(IPoolManagerV4.PoolKey memory poolKey, address tokenIn, address, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        return RoamMathLib.sellLeg(poolKey, tokenIn, amountIn);
    }

    /// @dev Size the target band from the held capital (observable-state value math),
    ///      buy the deficit leg via a fresh-quote exact-output swap, open the
    ///      position, and book the residual dust as accounted revenue (burn tail).
    function _deployToBand(BookKey memory toKey, DeployState memory ds) internal returns (Deployed memory dep) {
        bytes32 toPid = keccak256(abi.encode(toKey.poolKey));
        (uint256 bal0, uint256 bal1, uint128 liquidity) = _planAndBuy(toKey, ds, toPid);
        _openBand(toKey, bal0, bal1, liquidity, dep);
    }

    /// @dev Band plan + deficit buy + affordable-liquidity sizing (recomputed at the
    ///      ACTUAL post-buy spot — the deficit buy moves it; limit-capped
    ///      affordability self-corrects here). Thin internal wrapper — the whole
    ///      storage-free planning core moved VERBATIM to RoamMathLib.planAndBuy
    ///      (ROAMVAULT-SIZE 2026-09-09): one library boundary for the plan, the
    ///      deficit buy and the affordable sizing, with the StateView spot reads
    ///      riding the delegatecall frame (same pinned addresses, same values).
    function _planAndBuy(BookKey memory toKey, DeployState memory ds, bytes32 toPid)
        internal
        returns (uint256 bal0, uint256 bal1, uint128 liquidity)
    {
        return RoamMathLib.planAndBuy(
            toKey.poolKey, toKey.tickLower, toKey.tickUpper, toPid, ds.curA, ds.amtA, ds.curB, ds.amtB
        );
    }

    /// @dev Open the position on the target band (the pool's own math dictates the
    ///      owed principal — paid from tracked balances, so force-sent junk can never
    ///      be consumed by the position) and book the residual dust (rounding + the
    ///      sizing margin) as accounted revenue — the burn tail, never stranded,
    ///      never treasury.
    function _openBand(BookKey memory toKey, uint256 bal0, uint256 bal1, uint128 liquidity, Deployed memory dep)
        internal
    {
        bytes32 toPid = keccak256(abi.encode(toKey.poolKey));
        dep.salt = bytes32(++poolNonce[toPid]);
        dep.liquidity = liquidity;
        // ROAMVAULT-SIZE 2026-09-09: the open legs (modifyLiquidity + decode +
        // per-leg pay from this contract's own balance) moved VERBATIM to
        // RoamMathLib.openLegs — the nonce stays HERE (storage).
        (dep.owed0, dep.owed1) =
            RoamMathLib.openLegs(toKey.poolKey, toKey.tickLower, toKey.tickUpper, dep.salt, liquidity);
        // ROAMVAULT item 5 (the deploy-residual return-to-vault routing): on a
        // vault-tagged target the rounding/sizing-margin residual is DEPOSITOR
        // capital — it returns to the vault, NEVER the burn-stream accrual (the
        // house bal-owed credit at this site would burn depositor dust). POL targets
        // keep the house accrual credit.
        bytes32 toHash = keccak256(abi.encode(toKey.poolKey, toKey.tickLower, toKey.tickUpper, dep.salt));
        _routeResidual(toKey.poolKey.currency0, bal0 > dep.owed0 ? bal0 - dep.owed0 : 0, toHash);
        _routeResidual(toKey.poolKey.currency1, bal1 > dep.owed1 ? bal1 - dep.owed1 : 0, toHash);
    }

    // ------------------------------------------------------------------
    // Internals — sweep/burn
    // ------------------------------------------------------------------

    function _sweepToken(address token, address well) internal {
        uint256 accounted = accountedAccrued[token];
        if (accounted == 0) return;
        uint256 balance = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
        // accounted > raw is reachable (e.g. a fee-on-transfer leg over-crediting the
        // accrual, or a historical rescue of tokens backing unswept accrual) — a token
        // with a ZERO raw balance must not reach the burn swap, where a zero-amount
        // quote reverts the whole sweep (ROAMER-AUDIT F-5).
        if (balance == 0) return;

        // Junk guard (house force-sent-token pattern): raw excess above the accounted
        // accrual forwards to the TREASURY — never the burn stream. ROAMVAULT item 7
        // custody: the VAULT accrual bucket's tokens are physically here between
        // collect and push — they are DEPOSITOR money, never junk and never burn; the
        // split excludes the vault bucket and the vault-yield push drains it.
        uint256 vaultBucket = vaultAccrued[token];
        if (balance > accounted + vaultBucket) {
            uint256 junk = balance - accounted - vaultBucket;
            if (token == address(0)) {
                _forwardNative(junk);
            } else {
                IERC20(token).safeTransfer(treasury, junk);
                emit Forwarded(token, junk, treasury);
            }
            balance = accounted;
        }

        uint256 minAccrued = sweepMinAccrued[token];
        if (balance < minAccrued) return; // trigger gate: below the Safe-set floor, leave accrued

        // Consume EXACTLY what the burn leg used (an exact-output fill can pay less
        // than requested at the price limit — the remainder stays accounted and the
        // next sweep retries it).
        uint256 consumed = _burnToken(token, balance, well);
        accountedAccrued[token] = accounted - consumed;
    }

    /// @dev Swap `sweepAmt` of `token` to WELL (pinned-Quoter-bounded exact-output on
    ///      the Safe-set route) and transfer the bought WELL to dEaD. If `token` IS
    ///      WELL, burn directly. Returns the consumed source amount. The swap core
    ///      moved VERBATIM to RoamMathLib.swapTokenToWell (ROAMVAULT-SIZE
    ///      2026-09-09) with the route passed in — the sweepRoutes read stays HERE
    ///      (the only storage touch); the emit stays HERE so the honest ledger's
    ///      emission code is unchanged.
    function _burnToken(address token, uint256 sweepAmt, address well) internal returns (uint256 consumed) {
        uint256 wellBought;
        if (token == well) {
            wellBought = sweepAmt;
            consumed = sweepAmt;
        } else {
            (wellBought, consumed) = RoamMathLib.swapTokenToWell(sweepRoutes[token], token, sweepAmt, well);
        }
        if (wellBought > 0) {
            IERC20(well).safeTransfer(BURN_ADDRESS, wellBought);
        }
        emit Burned(token, wellBought, wellBought);
    }

    // ------------------------------------------------------------------
    // Internals — LP primitives (house HarvesterV4 settlement patterns).
    // ROAMVAULT-SIZE 2026-09-09: the settlement primitive bodies (_mint,
    // _takePositive, _takePositiveTo, _payNegative, _decodeDeltas) moved
    // VERBATIM into RoamMathLib (external library code counts ZERO toward
    // this contract's EIP-170 runtime budget) — the per-flow composites
    // collectFees / decreaseLegs / exitLegsTo / openLegs below-mentioned
    // wrap them; every storage touch and emit stayed HERE.
    // ------------------------------------------------------------------

    // ------------------------------------------------------------------
    // Internals — accounting / registry
    // ------------------------------------------------------------------

    function _creditAccrual(address token, uint256 amount) internal {
        _creditAccrualLane(token, amount, false);
    }

    /// @dev ROAMVAULT item 7 (the provenance split): POL revenue credits 100% to the
    ///      burn accrual (house path, unchanged). VAULT-TAGGED revenue splits by the
    ///      vault's NAMED constants — BURN_BPS (1000) onto the existing burn accrual
    ///      and DEPOSITOR_BPS (9000) into the VAULT accrual bucket (vaultAccrued),
    ///      which the vault-yield lane later swaps to USDG and pushes into the vault
    ///      for the excess-bounded harvest() credit. The 90% lane NEVER passes through
    ///      the WELL gate: it accumulates here WELL-independently, while the 10% sits
    ///      as BURN-PENDING accounted accrual until setWellToken (conserved, never
    ///      treasury, never junk-forwarded — the junk guard excludes this bucket).
    function _creditAccrualLane(address token, uint256 amount, bool vaultLane) internal {
        if (!vaultLane) {
            if (!_accountedTokenSeen[token]) {
                _accountedTokenSeen[token] = true;
                accountedTokens.push(token);
            }
            accountedAccrued[token] += amount;
            return;
        }
        IRoamVaultVault v = IRoamVaultVault(vault);
        uint256 burnCut = Math.mulDiv(amount, v.BURN_BPS(), v.BPS());
        if (burnCut > 0) {
            if (!_accountedTokenSeen[token]) {
                _accountedTokenSeen[token] = true;
                accountedTokens.push(token);
            }
            accountedAccrued[token] += burnCut;
        }
        uint256 depositorCut = Math.mulDiv(amount, v.DEPOSITOR_BPS(), v.BPS());
        if (depositorCut > 0) {
            if (!_vaultAccrualSeen[token]) {
                _vaultAccrualSeen[token] = true;
                _vaultAccrualTokens.push(token);
            }
            vaultAccrued[token] += depositorCut;
        }
    }

    function _deletePosition(bytes32 kHash) internal {
        delete positions[kHash];
        uint256 n = openKeys.length;
        for (uint256 i = 0; i < n; i++) {
            if (openKeys[i] == kHash) {
                openKeys[i] = openKeys[n - 1];
                openKeys.pop();
                return;
            }
        }
    }

    // ------------------------------------------------------------------
    // Internals — math (observable-state only, NO oracle)
    // ------------------------------------------------------------------

    /// @dev The honest realized-IL mark (07 §3 ledger field; ROAMER-AUDIT F-2's
    ///      both-legs take-back). Thin internal wrapper — the pure branch math moved
    ///      VERBATIM to RoamMathLib.realizedIL (ROAMVAULT-SIZE 2026-09-09); this
    ///      frame flattens the (Leg, BookKey, Deployed) memory structs into scalars.
    function _realizedIL(Leg memory leg, BookKey memory toKey, uint160 toSqrtP, Deployed memory dep)
        internal
        pure
        returns (int256 il)
    {
        return RoamMathLib.realizedIL(
            leg.principal0,
            leg.principal1,
            leg.fee0,
            leg.fee1,
            leg.sIsFromC0,
            leg.ds.fromSqrtP,
            toKey.poolKey.currency0 == leg.ilCurrency,
            dep.owed0,
            dep.owed1,
            toSqrtP
        );
    }

    /// @dev Directional-band disclosure (AMENDMENT A): whenever the requested band
    ///      does NOT bracket the live spot tick.
    function _emitDirectionalRangeIfDirectional(bytes32 pid, int24 tickLower, int24 tickUpper) internal {
        (, int24 spotTick, , ) = IStateView(FORK_STATE_VIEW).getSlot0(pid);
        if (spotTick <= tickLower || spotTick >= tickUpper) {
            emit DirectionalRange(pid, tickLower, tickUpper, spotTick);
        }
    }

    function _validateBand(BookKey memory key) internal pure {
        RoamMathLib.validateBand(key.tickLower, key.tickUpper, key.poolKey.tickSpacing);
    }

    function _sharedCurrency(IPoolManagerV4.PoolKey memory a, IPoolManagerV4.PoolKey memory b)
        internal
        pure
        returns (address)
    {
        if (a.currency0 == b.currency0 || a.currency0 == b.currency1) return a.currency0;
        if (a.currency1 == b.currency0 || a.currency1 == b.currency1) return a.currency1;
        revert BooksShareNoCurrency(a.currency0, a.currency1, b.currency0, b.currency1);
    }

    function _forwardNative(uint256 amount) internal {
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert NativeForwardFailed();
        emit Forwarded(address(0), amount, treasury);
    }

    // ------------------------------------------------------------------
    // TickMath.getSqrtRatioAtTick (standard v3/v4 constant table, round-up)
    // ------------------------------------------------------------------

    /// @notice The pure TickMath evaluation, exposed for the battery's live cross-check
    ///         (ROAMER-AUDIT F-4 — the proof surface). ROAMVAULT-SIZE 2026-09-09: the
    ///         19-entry table moved VERBATIM to RoamMathLib (external library code
    ///         counts zero toward this contract's EIP-170 runtime budget); the public
    ///         surface stays HERE — the F-4 fork battery pins through it unchanged.
    ///         The table's live-proof NatSpec (bracket/monotonic/anchor checks) moved
    ///         with the code into RoamMathLib.
    function sqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return RoamMathLib.sqrtRatioAtTick(tick);
    }

    // ------------------------------------------------------------------
    // Rolling cap counter
    // ------------------------------------------------------------------

    function _checkAndConsumeMigrationCap() internal {
        // Prune entries older than the rolling period from the front (amortized O(1);
        // the array is bounded by the immutable ceiling + 1).
        uint64 cutoff = uint64(block.timestamp - MIGRATION_PERIOD);
        while (_migrationTimes.length > 0 && _migrationTimes[0] <= cutoff) {
            // shift-free removal: the array is tiny (<= 53); compact from the front.
            for (uint256 i = 0; i < _migrationTimes.length - 1; i++) {
                _migrationTimes[i] = _migrationTimes[i + 1];
            }
            _migrationTimes.pop();
        }
        if (_migrationTimes.length >= maxMigrationsPerPeriod) revert MigrationCapReached(maxMigrationsPerPeriod);
        _migrationTimes.push(uint64(block.timestamp));
    }

    // ==================================================================
    // ROAMVAULT additions (GOAL 2026-09-08 MINIMAL-DIFF PIN: the SEVEN
    // declared items + THREE named helper touch-points; appended AFTER the
    // last protected declaration so the audited line numbers above hold).
    // ==================================================================

    uint8 internal constant ACTION_VDEPLOY = 5;
    uint8 internal constant ACTION_VEGRESS = 6;
    uint8 internal constant ACTION_VSWEEP = 7;

    /// @notice ROAMVAULT deploy-plan margin (items 1 + 5): vault capital arrives
    ///         SINGLE-SIDED (all USDG), so the band plan deficit-buys the other leg.
    ///         The plan reserves the deficit at the SPOT price (fee-exclusive) but the
    ///         executed exact-output swap pays pool fee + price impact (the fill is
    ///         price-limit capped at ±SWAP_SLIPPAGE_BPS) on top — deploying 100% of
    ///         the capital then demands more of the paid leg than physically remains
    ///         (_payNegative reverts SwapInputAboveBalance inside the whole deploy).
    ///         The plan therefore sizes at (BPS − VAULT_DEPLOY_MARGIN_BPS) of the
    ///         capital; the un-deployed margin is DEPOSITOR capital and returns to the
    ///         vault as deploy residual (items 1+5 routing — never accrual, never
    ///         treasury). 500 bps covers the ±1% fill limit + any realistic pool fee
    ///         (SPY/USDG fixed 0.3%; the dynamic-fee USDG/ETH book read 0 live) with
    ///         headroom; a wedge beyond the margin fails CLOSED (revert), never a loss.
    uint256 public constant VAULT_DEPLOY_MARGIN_BPS = 500;

    /// @notice The bound RoamVault (ONE-SHOT — zero-address and re-set both revert).
    address public vault;
    /// @notice The vault's USDG asset, bound together with the vault: every vault
    ///         book must pair it, so egress can always convert legs back on the
    ///         position's own venue.
    address public vaultAsset;
    /// @notice Custody tag: position key hash => vault capital (DECISION 3i).
    mapping(bytes32 => bool) internal _isVaultPosition;
    /// @notice Par-USDG mark per vault position (deploy value minus released slices).
    mapping(bytes32 => uint256) internal _positionDeployedUsdg;
    /// @notice The VAULT accrual bucket (the 90% depositor lane, WELL-independent).
    mapping(address => uint256) public vaultAccrued;
    address[] internal _vaultAccrualTokens;
    mapping(address => bool) internal _vaultAccrualSeen;
    /// @dev Transient residual lane (bracketed around _deployToBand — the to-position
    ///      tag lands only at completion, see _migrateCallback).
    bool internal _vaultResidualLane;
    /// @dev Transient USDG residual accumulator for the vaultDeploy seam (what the
    ///      residual routes physically returned to the vault in the vault's own
    ///      denomination; consumed by _vDeployCallback).
    uint256 internal _vaultResidualReturned;

    event VaultSet(address indexed vault, address indexed vaultAsset);
    event VaultBookDeployed(bytes32 indexed keyHash, uint256 capital, uint256 deployedVal, uint256 residual);
    event VaultResidualReturned(address indexed token, uint256 amount, address indexed to);
    event VaultYieldPushed(address indexed token, uint256 usdgPushed);
    event VaultYieldSkipped(address indexed token, bytes32 reason);

    error VaultNotSet();
    error VaultAlreadySet(address current);
    error NotVault(address caller);
    error VaultPositionProtected(bytes32 keyHash);
    error VaultBookNotPaired(address vaultAsset);
    error VaultAssetMismatch(address boundAsset, address vaultAsset);
    error ZeroDeploy();
    error ZeroEgress();
    error NoVaultRoute(address token);

    /// @notice ITEM 2: ONE-SHOT, fail-closed, timelock-only vault binding. Re-set and
    ///         zero revert. Bind together with the vault's USDG asset (the vault-book
    ///         pairing constraint keys on it). ROAMVAULT V-4 fix 2026-09-08
    ///         (composition audit): the two bindings are CROSS-CHECKED — the bound
    ///         vault's ACTUAL asset() must equal the bound denomination, else every
    ///         later deploy plans and values in a token the vault never transferred
    ///         (deployed-book inflation on day one of operation).
    function setVault(address vault_, address usdgAsset_) external onlyTimelock {
        if (vault != address(0)) revert VaultAlreadySet(vault);
        if (vault_ == address(0) || usdgAsset_ == address(0)) revert ZeroAddress();
        address actualAsset = IRoamVaultVault(vault_).asset();
        if (actualAsset != usdgAsset_) revert VaultAssetMismatch(usdgAsset_, actualAsset);
        vault = vault_;
        vaultAsset = usdgAsset_;
        emit VaultSet(vault_, usdgAsset_);
    }

    /// @notice Custody-tag read (DECISION 3i): is this position key vault capital?
    function isVaultPosition(bytes32 kHash) external view returns (bool) {
        return _isVaultPosition[kHash];
    }

    /// @dev ROAMVAULT item 3 (the rescueToTreasury guard, body-inline above): while
    ///      ANY vault-tagged position exists, the treasury rescue is fail-closed —
    ///      the vault's own egress seam is the ONLY custody path for depositor
    ///      capital (a rescue could otherwise move roamer-held value that backs
    ///      vault redemptions, and the vault accrual buckets read as "junk" to the
    ///      raw-balance split).
    function _revertIfVaultPositionsOpen() internal view {
        uint256 n = openKeys.length;
        for (uint256 i = 0; i < n; i++) {
            if (_isVaultPosition[openKeys[i]]) revert VaultPositionProtected(openKeys[i]);
        }
    }

    /// @notice ITEM 7: permissionless vault-yield sweep — collect live fees (which
    ///         FILLS the vault bucket with the 90% depositor cut) then push the
    ///         bucket to the vault (swap-to-USDG + transfer + excess-bounded
    ///         harvest() credit). WELL-INDEPENDENT: runs before setWellToken (the
    ///         10% burn lane stays BURN-PENDING); no tip — the output lands in the
    ///         vault, nothing to farm.
    function sweepVaultYield() external nonReentrant {
        _activeAction = ACTION_VSWEEP;
        IPoolManagerV4(poolManager).unlock("");
        _activeAction = ACTION_NONE;
    }

    /// @notice ITEM 1 (the deploy half of the vault-authorized pair): deploy
    ///         `capitalUsdg` of vault capital into the allowlisted book `key`
    ///         (BookKey payload, salt 0). ONLY the bound vault calls this (the
    ///         Safe-queued vault.vaultDeploy forwards here after transferring the
    ///         capital). The band is capital-driven (sized by the roamer's own
    ///         band math from the capital actually received). Returns (deployedVal,
    ///         residual): the USDG value locked into the position and the
    ///         un-deployed USDG leftover (returned to the vault — NEVER the burn
    ///         accrual). The position is VAULT-TAGGED.
    function vaultDeploy(bytes calldata key, uint256 capitalUsdg)
        external
        nonReentrant
        returns (uint256 deployedVal, uint256 residual)
    {
        if (vault == address(0)) revert VaultNotSet();
        if (msg.sender != vault) revert NotVault(msg.sender);
        if (capitalUsdg == 0) revert ZeroDeploy();
        BookKey memory bk = abi.decode(key, (BookKey));
        if (bk.salt != bytes32(0)) revert SaltMustBeZero(bk.salt);
        _validateBand(bk);
        bytes32 pid = keccak256(abi.encode(bk.poolKey));
        if (!allowlist.isListed(pid)) revert UnknownPosition(pid);
        // Custody constraint: the vault asset must be a currency of the book so the
        // egress can always convert the legs back to USDG on the book's own venue.
        if (bk.poolKey.currency0 != vaultAsset && bk.poolKey.currency1 != vaultAsset) {
            revert VaultBookNotPaired(vaultAsset);
        }
        _activeAction = ACTION_VDEPLOY;
        bytes memory ret = IPoolManagerV4(poolManager).unlock(abi.encode(bk, capitalUsdg));
        _activeAction = ACTION_NONE;
        (bytes32 kHash, uint256 deployed, uint256 resid) = abi.decode(ret, (bytes32, uint256, uint256));
        emit VaultBookDeployed(kHash, capitalUsdg, deployed, resid);
        return (deployed, resid);
    }

    /// @notice ITEM 1 (the egress half of the vault-authorized pair): close pro-rata
    ///         DECREASE-ONLY slices of open vault-tagged positions until at least
    ///         `shortfallUsdg` USDG is raised (or every vault position is exhausted).
    ///         ONLY the bound vault calls this (the vault's redeem settlement). NOT a
    ///         migration: never consumes MAX_MIGRATIONS_PER_PERIOD, NEVER gated by
    ///         MIN_HOLD (depositor exits are never gated). Fee-collect runs FIRST per
    ///         slice (the accrual lane, house _collectOne) so the redeemer payout is
    ///         principal-side; non-USDG legs convert on the position's OWN venue with
    ///         the fresh-quote house band (never a zero floor).
    function vaultEgress(uint256 shortfallUsdg) external nonReentrant returns (uint256 proceedsUsdg) {
        if (vault == address(0)) revert VaultNotSet();
        if (msg.sender != vault) revert NotVault(msg.sender);
        if (shortfallUsdg == 0) revert ZeroEgress();
        _activeAction = ACTION_VEGRESS;
        bytes memory ret = IPoolManagerV4(poolManager).unlock(abi.encode(shortfallUsdg));
        _activeAction = ACTION_NONE;
        return abi.decode(ret, (uint256));
    }

    /// @dev ISOLATED per-token vault-yield push (F-3 liveness shape). NOT a public
    ///      surface: only the sweep callbacks may drive it (guarded self-call).
    function pushVaultYieldOne(address token) external {
        if (
            msg.sender != address(this)
                || (_activeAction != ACTION_SWEEP && _activeAction != ACTION_VSWEEP)
        ) {
            revert CallbackNotActive(msg.sender, _activeAction);
        }
        _pushVaultYield(token);
    }

    /// @dev The vault-yield sweep callback (ACTION_VSWEEP): collect fees (fills the
    ///      vault bucket) then push. No burn leg — the 10% cut stays BURN-PENDING
    ///      until a setWellToken'd sweepToBurn picks it up.
    function _vSweepCallback() internal {
        _collectAllFees();
        _pushVaultYieldAll();
    }

    /// @dev The vaultDeploy unlock callback: open the capital-driven band, tag the
    ///      position, mark its par-USDG value, and settle deployed-vs-residual from
    ///      the tracked balances (pre-existing roamer balances excluded — idle vault
    ///      capital never idles here and POL accrual is never counted as deployed).
    function _vDeployCallback(bytes calldata data) internal returns (bytes memory) {
        (BookKey memory bk, uint256 capital) = abi.decode(data, (BookKey, uint256));
        address usdg = vaultAsset;
        uint256 preExisting = IERC20(usdg).balanceOf(address(this)) - capital;
        // ROAMVAULT items 1+5: the band plan sizes at the margin-scaled capital —
        // vault capital is single-sided, so the deficit buy's fee+impact wedge would
        // otherwise strand the second leg (see VAULT_DEPLOY_MARGIN_BPS). The margin
        // itself is depositor capital and returns below.
        DeployState memory ds = DeployState({
            curA: usdg,
            amtA: Math.mulDiv(capital, BPS - VAULT_DEPLOY_MARGIN_BPS, BPS),
            curB: address(0),
            amtB: 0,
            fromSqrtP: 0
        });
        _vaultResidualLane = true; // residual is depositor money from the first wei
        _vaultResidualReturned = 0;
        Deployed memory dep = _deployToBand(bk, ds);
        _vaultResidualLane = false;
        bytes32 pid = keccak256(abi.encode(bk.poolKey));
        bytes32 kHash = keccak256(abi.encode(bk.poolKey, bk.tickLower, bk.tickUpper, dep.salt));
        positions[kHash] = Position({
            poolKey: bk.poolKey,
            tickLower: bk.tickLower,
            tickUpper: bk.tickUpper,
            salt: dep.salt,
            liquidity: dep.liquidity,
            createdAt: uint64(block.timestamp),
            lastMigrationAt: 0
        });
        openKeys.push(kHash);
        _isVaultPosition[kHash] = true;
        // ROAMVAULT item 5 (physical exactness): sweep whatever un-deployed USDG still
        // sits here (the plan margin + any un-routed dust) home BEFORE the residual is
        // computed — the vault is about to credit its idle book by `residual`, and the
        // idle book must be FULLY physical (backingCoverage 1e18) and never idle inside
        // the roamer (DECISION 3ii).
        uint256 leftover = IERC20(usdg).balanceOf(address(this)) - preExisting;
        if (leftover > 0) {
            IERC20(usdg).safeTransfer(vault, leftover);
            emit VaultResidualReturned(usdg, leftover, vault);
        }
        // The residual = everything un-deployed that returned in the vault's own
        // denomination: what the residual routes physically transferred back
        // (_vaultResidualReturned) plus the leftover just swept above.
        uint256 residual = _vaultResidualReturned + leftover;
        _vaultResidualReturned = 0;
        uint256 deployedVal = capital - residual;
        _positionDeployedUsdg[kHash] = deployedVal;
        _emitDirectionalRangeIfDirectional(pid, bk.tickLower, bk.tickUpper);
        emit BookOpened(kHash, pid, dep.liquidity, bk.tickLower, bk.tickUpper, dep.salt);
        return abi.encode(kHash, deployedVal, residual);
    }

    /// @dev The vaultEgress unlock callback: pro-rata slice selection across open
    ///      vault-tagged positions (decrease-only), each slice fee-collected FIRST
    ///      (accrual lane) then principal-decreased, non-USDG legs converted on the
    ///      position's own venue, and the USDG proceeds transferred to the vault.
    function _vEgressCallback(bytes calldata data) internal returns (bytes memory) {
        uint256 shortfall = abi.decode(data, (uint256));
        address usdg = vaultAsset;
        uint256 n = openKeys.length;
        bytes32[] memory keys = new bytes32[](n);
        uint256 totalMarked;
        for (uint256 i = 0; i < n; i++) {
            keys[i] = openKeys[i];
            if (_isVaultPosition[keys[i]]) totalMarked += _positionDeployedUsdg[keys[i]];
        }
        uint256 proceeds;
        if (totalMarked > 0) {
            uint256 remaining = shortfall;
            for (uint256 i = 0; i < n && remaining > 0; i++) {
                bytes32 kHash = keys[i];
                if (!_isVaultPosition[kHash]) continue;
                Position storage pos = positions[kHash];
                if (pos.liquidity == 0) continue;
                uint256 marked = _positionDeployedUsdg[kHash];
                if (marked == 0) continue;
                uint256 sliceMarked = Math.min(remaining, marked);
                uint128 sliceLiq = uint128(
                    Math.min(
                        pos.liquidity,
                        Math.mulDiv(pos.liquidity, sliceMarked, marked, Math.Rounding.Ceil)
                    )
                );
                if (sliceLiq == 0) continue;
                proceeds += _egressSlice(pos, kHash, sliceLiq, sliceMarked);
                remaining -= sliceMarked;
            }
        }
        if (proceeds > 0) IERC20(usdg).safeTransfer(vault, proceeds);
        return abi.encode(proceeds);
    }

    /// @dev ONE slice close: fee-collect into the accrual lane FIRST (the redeemer
    ///      payout stays principal-side), then the principal-only decrease, then the
    ///      non-USDG leg conversion on the position's OWN venue, then the record and
    ///      mark shrink. Returns the slice's USDG proceeds.
    function _egressSlice(Position storage pos, bytes32 kHash, uint128 sliceLiq, uint256 sliceMarked)
        internal
        returns (uint256 usdgOut)
    {
        address usdg = vaultAsset;
        _collectOne(kHash); // fees first — the accrual lane, never the redeemer payout
        // ROAMVAULT-SIZE 2026-09-09: the decrease-only slice legs moved VERBATIM to
        // RoamMathLib.decreaseLegs (decrease-only by construction — the negative
        // liquidityDelta derives from the slice here).
        (uint256 leg0, uint256 leg1) =
            RoamMathLib.decreaseLegs(pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt, sliceLiq);
        if (pos.poolKey.currency0 == usdg) {
            usdgOut = leg0 + _sellLeg(pos.poolKey, pos.poolKey.currency1, usdg, leg1);
        } else {
            usdgOut = leg1 + _sellLeg(pos.poolKey, pos.poolKey.currency0, usdg, leg0);
        }
        if (pos.liquidity > sliceLiq) {
            pos.liquidity -= sliceLiq;
            _positionDeployedUsdg[kHash] = sliceMarked < _positionDeployedUsdg[kHash]
                ? _positionDeployedUsdg[kHash] - sliceMarked
                : 0;
        } else {
            _deletePosition(kHash);
            delete _positionDeployedUsdg[kHash];
            delete _isVaultPosition[kHash]; // the tag record goes with the position
        }
    }

    /// @dev The per-token vault-yield push: 90%-bucket -> USDG (the token's own vault
    ///      book IS the venue) -> transfer to the vault -> excess-bounded harvest()
    ///      credit (assets transferred FIRST — the push can never credit more than
    ///      physically arrived).
    function _pushVaultYield(address token) internal {
        uint256 amount = vaultAccrued[token];
        if (amount == 0) return;
        address usdg = vaultAsset;
        uint256 outUsdg;
        if (token == usdg) {
            outUsdg = amount;
        } else {
            IPoolManagerV4.PoolKey memory route = _findVaultRoute(token, usdg);
            if (route.currency0 == address(0) && route.currency1 == address(0)) revert NoVaultRoute(token);
            outUsdg = _sellLeg(route, token, usdg, amount);
        }
        if (outUsdg > 0) {
            IERC20(usdg).safeTransfer(vault, outUsdg);
            IRoamVaultVault(vault).harvest(outUsdg);
        }
        vaultAccrued[token] = 0;
        emit VaultYieldPushed(token, outUsdg);
    }

    /// @dev The venue for a vault-bucket token's USDG conversion: a currently-open
    ///      vault-tagged position whose pool pairs (token, USDG). None open -> the
    ///      push skips (isolated, conserved) until a fresh vault position pairs it.
    function _findVaultRoute(address token, address usdg)
        internal
        view
        returns (IPoolManagerV4.PoolKey memory)
    {
        uint256 n = openKeys.length;
        for (uint256 i = 0; i < n; i++) {
            if (!_isVaultPosition[openKeys[i]]) continue;
            IPoolManagerV4.PoolKey memory k = positions[openKeys[i]].poolKey;
            if ((k.currency0 == token && k.currency1 == usdg) || (k.currency1 == token && k.currency0 == usdg)) {
                return k;
            }
        }
        return IPoolManagerV4.PoolKey({currency0: address(0), currency1: address(0), fee: 0, tickSpacing: 0, hooks: address(0)});
    }

    /// @dev ITEM 5: the deploy-residual router. Vault-lane residuals are DEPOSITOR
    ///      capital — they return to the VAULT (physical transfer, NEVER the
    ///      burn-stream accrual); the vaultDeploy seam books the USDG part of what
    ///      returned (_vaultResidualReturned + leftover) as its residual and the rest
    ///      sits as unaccounted excess backing. The transfer CLAMPS to the physically
    ///      present balance: the house plan tracker can be stale by the deficit-buy
    ///      payment (the plan tracks capital, the payment leaves the real balance), so
    ///      the raw bal-owed figure is an upper bound — clamping keeps POL accrual
    ///      semantics byte-unchanged while making the vault lane physically exact.
    ///      POL lane keeps the house accrual credit.
    function _routeResidual(address token, uint256 amount, bytes32 toHash) internal {
        if (amount == 0) return;
        if (_isVaultPosition[toHash] || _vaultResidualLane) {
            // Native-safe read (a same-pool vault migration into the USDG/ETH book can
            // carry an ETH residual — IERC20(address(0)) has no code).
            uint256 bal = token == address(0) ? address(this).balance : IERC20(token).balanceOf(address(this));
            if (bal == 0) return;
            if (amount > bal) amount = bal;
            if (token == address(0)) {
                // Native residual: custody goes to the VAULT (never treasury, never
                // accrual — DECISION 3ii/3iii). RoamVault accepts native via receive()
                // and holds it as unaccounted native excess (the storage accounting
                // keys on the USDG asset — donations are deliberately uncredited).
                (bool ok,) = vault.call{value: amount}("");
                if (!ok) revert NativeForwardFailed();
            } else {
                IERC20(token).safeTransfer(vault, amount);
            }
            if (token == vaultAsset) _vaultResidualReturned += amount;
            emit VaultResidualReturned(token, amount, vault);
        } else {
            _creditAccrual(token, amount);
        }
    }

    /// @dev A to-band's deployed value in the vault's USDG denomination, valued at the
    ///      observable to-book spot (no oracle). Unreachable third branch: vault
    ///      books are USDG-paired by the deploy constraint. Thin internal wrapper —
    ///      the per-branch conversion math moved VERBATIM to
    ///      RoamMathLib.deployedValueC (ROAMVAULT-SIZE 2026-09-09); this frame keeps
    ///      the vaultAsset read contract-side.
    function _deployedUsdgValue(BookKey memory toKey, Deployed memory dep, uint160 toSqrtP)
        internal
        view
        returns (uint256)
    {
        address usdg = vaultAsset;
        if (toKey.poolKey.currency0 == usdg) return RoamMathLib.deployedValueC(true, dep.owed0, dep.owed1, toSqrtP);
        if (toKey.poolKey.currency1 == usdg) return RoamMathLib.deployedValueC(false, dep.owed0, dep.owed1, toSqrtP);
        return 0;
    }
}

/// @dev The bound vault's surface the roamer consumes (RoamVault implements it; the
///      harvest(uint256) signature is the audited chassis excess-bounded credit).
///      asset() backs the V-4 setVault cross-check (the bound denomination must be
///      the vault's actual asset).
interface IRoamVaultVault {
    function asset() external view returns (address);
    function BPS() external view returns (uint256);
    function DEPOSITOR_BPS() external view returns (uint256);
    function BURN_BPS() external view returns (uint256);
    function harvest(uint256 assets) external;
    function applyRealizedIL(int256 il, address ilCurrency) external;
}
