// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RoamAllowlist} from "./RoamAllowlist.sol";

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
    address public constant FORK_QUOTER = 0x076838736F90Cd1d30dED756A3B89E576BE972F8;
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
    ///         residual dust is booked as accounted revenue (burn tail).
    uint256 public constant SIZE_MARGIN_BPS = 1;
    uint256 public constant BPS = 10_000;

    /// @dev v4 TickMath sqrt bounds (fork source) — swap price limits are clamped
    ///      inside these (the fork rejects tick-extreme limits with InvalidPrice).
    uint160 internal constant MIN_SQRT_PLUS_1 = 4295128740;
    uint160 internal constant MAX_SQRT_MINUS_1 = 1461446703485210103287273052203988822378783945700;

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
        uint256 accounted = accountedAccrued[token];
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
        if (pos.liquidity == 0) revert UnknownPosition(fromHash);

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
        _mint(key, tickLower, tickUpper, int256(uint256(liquidity)), salt);
    }

    function _exitCallback(bytes calldata data) internal returns (bytes memory) {
        (BookKey memory key, address to) = abi.decode(data, (BookKey, address));
        // A full decrease returns principal + accrued fees in ONE callerDelta (the
        // fork's callerDelta = principalDelta + feesAccrued, house-verified): every
        // leg goes straight to `to` — the disclosed wind-down custody event.
        Position storage pos = positions[keccak256(abi.encode(key.poolKey, key.tickLower, key.tickUpper, key.salt))];
        (int256 delta,) = IPoolManagerV4(poolManager).modifyLiquidity(
            key.poolKey,
            IPoolManagerV4.ModifyLiquidityParams({
                tickLower: key.tickLower,
                tickUpper: key.tickUpper,
                liquidityDelta: -int256(uint256(pos.liquidity)),
                salt: key.salt
            }),
            ""
        );
        (int128 d0, int128 d1) = _decodeDeltas(delta);
        uint256 taken0 = _takePositiveTo(key.poolKey.currency0, to, d0);
        uint256 taken1 = _takePositiveTo(key.poolKey.currency1, to, d1);
        return abi.encode(taken0, taken1);
    }

    function _sweepCallback(address well) internal {
        // 1) Collect live fees from every open position into the accounted accrual —
        //    PER-POSITION ISOLATION (ROAMER-AUDIT F-3): a hook reverting inside
        //    modifyLiquidity reverts THIS position's collect only (skipped via
        //    CollectSkipped); its fees stay in the pool and the sweep continues.
        uint256 n = openKeys.length;
        for (uint256 i = 0; i < n; i++) {
            (bool okC, bytes memory errC) =
                address(this).call(abi.encodeCall(this.collectOnePosition, (openKeys[i])));
            if (!okC) emit CollectSkipped(openKeys[i], _skipReason(errC));
        }
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
    }

    /// @dev ISOLATED per-position fee collect (F-3 liveness). NOT a public surface:
    ///      only the sweep's own unlock callback may drive it (guarded self-call —
    ///      an external frame is what makes the per-position revert catchable).
    function collectOnePosition(bytes32 kHash) external {
        if (msg.sender != address(this) || _activeAction != ACTION_SWEEP) {
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
        (int256 delta,) = IPoolManagerV4(poolManager).modifyLiquidity(
            pos.poolKey,
            IPoolManagerV4.ModifyLiquidityParams({
                tickLower: pos.tickLower,
                tickUpper: pos.tickUpper,
                liquidityDelta: 0, // zero-delta: callerDelta IS the accrued-fee pair
                salt: pos.salt
            }),
            ""
        );
        (int128 d0, int128 d1) = _decodeDeltas(delta);
        uint256 c0 = _takePositive(pos.poolKey.currency0, d0);
        uint256 c1 = _takePositive(pos.poolKey.currency1, d1);
        if (c0 > 0) _creditAccrual(pos.poolKey.currency0, c0);
        if (c1 > 0) _creditAccrual(pos.poolKey.currency1, c1);
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
        Deployed memory dep = _deployToBand(toKey, leg.ds);
        _bookAndEmit(toKey, minOuts, leg, dep);
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
        (int256 delta,) = IPoolManagerV4(poolManager).modifyLiquidity(
            fromKey.poolKey,
            IPoolManagerV4.ModifyLiquidityParams({
                tickLower: pos.tickLower,
                tickUpper: pos.tickUpper,
                liquidityDelta: 0,
                salt: pos.salt
            }),
            ""
        );
        (int128 d0, int128 d1) = _decodeDeltas(delta);
        leg.collected0 = _takePositive(fromKey.poolKey.currency0, d0);
        leg.collected1 = _takePositive(fromKey.poolKey.currency1, d1);
        if (leg.collected0 > 0) _creditAccrual(fromKey.poolKey.currency0, leg.collected0);
        if (leg.collected1 > 0) _creditAccrual(fromKey.poolKey.currency1, leg.collected1);
        emit FeesCollected(leg.fromHash, leg.fromPid, leg.collected0, leg.collected1);

        // ---- Step 2: close the from-position (principal out) ----
        (delta,) = IPoolManagerV4(poolManager).modifyLiquidity(
            fromKey.poolKey,
            IPoolManagerV4.ModifyLiquidityParams({
                tickLower: pos.tickLower,
                tickUpper: pos.tickUpper,
                liquidityDelta: -int256(uint256(pos.liquidity)),
                salt: pos.salt
            }),
            ""
        );
        (d0, d1) = _decodeDeltas(delta);
        leg.principal0 = _takePositive(fromKey.poolKey.currency0, d0);
        leg.principal1 = _takePositive(fromKey.poolKey.currency1, d1);
        _deletePosition(leg.fromHash);
    }

    /// @dev Step 3 + 4: the roaming take (in-kind, both legs → accounted, the burn
    ///      tail) and the capital conversion to the target denomination.
    function _takeAndConvert(BookKey memory fromKey, BookKey memory toKey, Leg memory leg) internal {
        leg.ilCurrency = _sharedCurrency(fromKey.poolKey, toKey.poolKey);
        leg.sIsFromC0 = fromKey.poolKey.currency0 == leg.ilCurrency;

        uint32 feeBps = migrationFeeBps;
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
        emit RealizedIL(leg.fromHash, _realizedIL(leg, toKey, toSqrtP, dep), leg.ilCurrency);
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
    ///         book's own venue), leaving the capital in the shared currency. A
    ///         same-pool re-range skips conversion: both legs are already held.
    function _convertCapital(BookKey memory fromKey, BookKey memory toKey, address s, uint256 cap0, uint256 cap1)
        internal
        returns (DeployState memory ds)
    {
        address f0 = fromKey.poolKey.currency0;
        address f1 = fromKey.poolKey.currency1;
        if (keccak256(abi.encode(fromKey.poolKey)) == keccak256(abi.encode(toKey.poolKey))) {
            return DeployState({curA: f0, amtA: cap0, curB: f1, amtB: cap1, fromSqrtP: 0});
        }

        // Cross-book: exactly one of (f0, f1) == s; the other must be sold entirely.
        if (f0 == s) {
            ds = DeployState({
                curA: s,
                amtA: cap0 + _sellLeg(fromKey.poolKey, f1, s, cap1),
                curB: address(0),
                amtB: 0,
                fromSqrtP: 0
            });
        } else {
            ds = DeployState({
                curA: s,
                amtA: cap1 + _sellLeg(fromKey.poolKey, f0, s, cap0),
                curB: address(0),
                amtB: 0,
                fromSqrtP: 0
            });
        }
        address t0 = toKey.poolKey.currency0;
        address t1 = toKey.poolKey.currency1;
        if (s != t0 && s != t1) revert BooksShareNoCurrency(f0, f1, t0, t1);
    }

    /// @dev Sell `amountIn` of `tokenIn` for the shared currency ON THE FROM-POOL via
    ///      an exact-input v4-native swap (fresh pinned-Quoter quote, fail-closed
    ///      stale-quote check, spot-derived price limit).
    function _sellLeg(IPoolManagerV4.PoolKey memory poolKey, address tokenIn, address, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        if (amountIn == 0) return 0;
        bool zeroForOne = poolKey.currency0 == tokenIn;
        (uint160 spot,,, ) = IStateView(FORK_STATE_VIEW).getSlot0(keccak256(abi.encode(poolKey)));
        uint160 limit = _priceLimit(spot, zeroForOne);

        // Fresh quote (fork semantics: NEGATIVE amountSpecified = exact input).
        IPoolManagerV4.SwapParams memory qp =
            IPoolManagerV4.SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit});
        (int256 q0, int256 q1,, ) = IForkQuoter(FORK_QUOTER).quoteSingle(poolKey, qp);
        uint256 quotedOut = uint256(zeroForOne ? q1 : q0);
        if (quotedOut == 0) revert SwapOutputBelowQuote(0, 0);

        (int128 d0, int128 d1) = _swapOnPool(poolKey, qp);
        amountOut = _takePositive(zeroForOne ? poolKey.currency1 : poolKey.currency0, zeroForOne ? d1 : d0);
        uint256 paid = _payNegative(zeroForOne ? poolKey.currency0 : poolKey.currency1, zeroForOne ? d0 : d1);

        // Fail-closed: the realized output must be within the slippage allowance of
        // the fresh quote (a stale/corrupt quote reverts the WHOLE migration), and an
        // exact-input leg pays EXACTLY its input (a limit-capped partial fill reverts
        // — the operator retries; nothing is stranded).
        if (amountOut < Math.mulDiv(quotedOut, BPS - SWAP_SLIPPAGE_BPS, BPS)) {
            revert SwapOutputBelowQuote(amountOut, quotedOut);
        }
        if (paid != amountIn) revert SwapInputAboveBalance(paid, amountIn);
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
    ///      affordability self-corrects here).
    function _planAndBuy(BookKey memory toKey, DeployState memory ds, bytes32 toPid)
        internal
        returns (uint256 bal0, uint256 bal1, uint128 liquidity)
    {
        (uint160 spot, , , ) = IStateView(FORK_STATE_VIEW).getSlot0(toPid);
        uint256 target0;
        uint256 target1;
        (bal0, bal1, target0, target1) = _planBand(toKey, ds, spot);
        (bal0, bal1) = _buyDeficit(toKey, target0, target1, bal0, bal1, spot);
        liquidity = _affordableForBand(toKey, bal0, bal1, toPid);
    }

    /// @dev The affordable-liquidity bound recomputed from the ACTUAL post-buy spot
    ///      and balances (own frame for the codegen stack budget). EXACT per-leg
    ///      bounds (nested mulDiv): the raw-unit per-liquidity amounts floor to ZERO
    ///      on off-1:1 books (SPY/USDG raw price 0.06 → a1L = 0.244; USDG/ETH 3e-9 →
    ///      a1L = 5e-5) and must never be used as intermediate scales.
    ///        a0L = 2^96·(√PU−√P)/(√P·√PU), a1L = (√P−√PL)/2^96 (raw wei per L);
    ///        below-range the c0 leg is L·2^96·(1/√PL − 1/√PU) (spot-independent).
    ///      The sizing margin keeps the pool's own rounding from demanding a wei more
    ///      than the tracked balances.
    function _affordableForBand(BookKey memory toKey, uint256 bal0, uint256 bal1, bytes32 toPid)
        internal
        view
        returns (uint128 liquidity)
    {
        (uint160 spot2, , , ) = IStateView(FORK_STATE_VIEW).getSlot0(toPid);
        uint160 sqrtPL = _sqrtRatioAtTick(toKey.tickLower);
        uint160 sqrtPU = _sqrtRatioAtTick(toKey.tickUpper);
        uint256 margin = BPS - SIZE_MARGIN_BPS;
        uint256 l0 = type(uint256).max;
        uint256 l1 = type(uint256).max;
        if (spot2 < sqrtPU) {
            if (spot2 > sqrtPL) {
                l0 = Math.mulDiv(Math.mulDiv(bal0, spot2, 1 << 96), sqrtPU, sqrtPU - spot2);
            } else {
                l0 = Math.mulDiv(Math.mulDiv(bal0, sqrtPL, sqrtPU - sqrtPL), sqrtPU, 1 << 96);
            }
        }
        if (spot2 > sqrtPL) {
            // a1L = (√P − √PL)/2^96 is the per-liquidity token1 amount ONLY while the
            // spot is INSIDE the band. ABOVE range (spot2 ≥ √PU — an all-token1
            // position) the amount is spot-independent: (√PU − √PL)/2^96. Applying the
            // in-range form above range understates the affordable liquidity by
            // (√PU − √PL)/(spot − √PL), and _openBand then credited the entire
            // shortfall as accounted accrual → burned (ROAMER-AUDIT F-1: a
            // permissionless one-sided-band migrate could destroy up to ~100% of
            // principal).
            uint256 denom = spot2 < sqrtPU ? spot2 - sqrtPL : sqrtPU - sqrtPL;
            l1 = Math.mulDiv(bal1, 1 << 96, denom);
        }
        uint256 lFinal = Math.mulDiv(l0 < l1 ? l0 : l1, margin, BPS);
        if (lFinal == 0 || lFinal > type(uint128).max) revert BadTicks(toKey.tickLower, toKey.tickUpper);
        liquidity = uint128(lFinal);
    }

    /// @dev The deficit-buy leg (split out for the codegen stack budget). Each buy
    ///      inherently sells the surplus leg, so post-swap the balances track the
    ///      band ratio.
    function _buyDeficit(
        BookKey memory toKey,
        uint256 target0,
        uint256 target1,
        uint256 bal0,
        uint256 bal1,
        uint160 spot
    ) internal returns (uint256 out0, uint256 out1) {
        out0 = bal0;
        out1 = bal1;
        if (target1 > bal1 && bal0 > 0) {
            out1 = bal1 + _buyOnPool(toKey.poolKey, toKey.poolKey.currency1, target1 - bal1, bal0, spot);
        } else if (target0 > bal0 && bal1 > 0) {
            out0 = bal0 + _buyOnPool(toKey.poolKey, toKey.poolKey.currency0, target0 - bal0, bal1, spot);
        }
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
        (int256 delta, ) = IPoolManagerV4(poolManager).modifyLiquidity(
            toKey.poolKey,
            IPoolManagerV4.ModifyLiquidityParams({
                tickLower: toKey.tickLower,
                tickUpper: toKey.tickUpper,
                liquidityDelta: int256(uint256(liquidity)),
                salt: dep.salt
            }),
            ""
        );
        (int128 d0, int128 d1) = _decodeDeltas(delta);
        dep.owed0 = _payNegative(toKey.poolKey.currency0, d0);
        dep.owed1 = _payNegative(toKey.poolKey.currency1, d1);
        if (bal0 > dep.owed0) _creditAccrual(toKey.poolKey.currency0, bal0 - dep.owed0);
        if (bal1 > dep.owed1) _creditAccrual(toKey.poolKey.currency1, bal1 - dep.owed1);
    }

    /// @dev Observable-state band plan: the all-capital deployment targets for the
    ///      band and the currently-held per-currency balances (TRACKED capital only —
    ///      junk never enters the plan). The targets are planning quantities — they
    ///      drive only the deficit buy and are re-derived from the ACTUAL post-buy
    ///      balances in _planAndBuy — but they must be right-ORDERED: the per-liquidity
    ///      raw-unit values floor to zero on off-1:1 books, so every step below is a
    ///      single nested mulDiv that absorbs the 2^96/2^192 scaling (verified: at a
    ///      1:1 spot a full-range band yields target0 = target1 = value/2).
    function _planBand(BookKey memory toKey, DeployState memory ds, uint160 spot)
        internal
        pure
        returns (uint256 bal0, uint256 bal1, uint256 target0, uint256 target1)
    {
        address t0 = toKey.poolKey.currency0;
        address t1 = toKey.poolKey.currency1;
        uint160 sqrtPL = _sqrtRatioAtTick(toKey.tickLower);
        uint160 sqrtPU = _sqrtRatioAtTick(toKey.tickUpper);

        uint256 valueC1 = _capitalValueC1(ds, t0, spot);
        uint256 targetL = _liquidityTarget(valueC1, spot, sqrtPL, sqrtPU);

        // target0 = L·2^96·(√PU−√P)/(√P·√PU) in-range; below-range it is
        // L·2^96·(√PU−√PL)/(√PL·√PU) (spot-independent); above-range 0.
        // target1 = L·(√P−√PL)/2^96 in-range; the WHOLE capital (valueC1) above-range
        // (an all-token1 position); 0 below.
        if (spot < sqrtPU) {
            if (spot > sqrtPL) {
                target0 = Math.mulDiv(Math.mulDiv(targetL, sqrtPU - spot, spot), 1 << 96, sqrtPU);
            } else {
                target0 = Math.mulDiv(Math.mulDiv(targetL, sqrtPU - sqrtPL, sqrtPL), 1 << 96, sqrtPU);
            }
        }
        if (spot > sqrtPL) {
            if (spot < sqrtPU) {
                target1 = Math.mulDiv(spot - sqrtPL, targetL, 1 << 96);
            } else {
                // Above range the position holds ONLY token1: plan the WHOLE capital
                // into token1 directly. (spot − √PL)·targetL with the fixed targetL
                // would OVER-plan past the held balance and silently rely on the
                // deficit buy's affordability scaling (ROAMER-AUDIT F-1 fix shape).
                target1 = valueC1;
            }
        }

        bal0 = ds.curA == t0 ? ds.amtA : (ds.curB == t0 ? ds.amtB : 0);
        bal1 = ds.curA == t1 ? ds.amtA : (ds.curB == t1 ? ds.amtB : 0);
    }

    /// @dev The tracked capital's total value in c1-wei (nested-mulDiv raw-price
    ///      conversion — no explicit spot² product, so no overflow at the TickMath
    ///      extremes, and no sub-unit flooring: each step's error is relative 2^-96).
    function _capitalValueC1(DeployState memory ds, address t0, uint160 spot) internal pure returns (uint256 value) {
        value = (ds.curA == t0 ? _c0ToC1(ds.amtA, spot) : ds.amtA)
            + (ds.curB == t0 ? _c0ToC1(ds.amtB, spot) : ds.amtB);
    }

    /// @dev c0-wei → c1-wei at the observable spot: amt·(√P/2^96)² = amt·√P²/2^192.
    function _c0ToC1(uint256 amtC0, uint160 spot) internal pure returns (uint256) {
        return Math.mulDiv(Math.mulDiv(amtC0, spot, 1 << 96), spot, 1 << 96);
    }

    /// @dev c1-wei → c0-wei at the observable spot: amt·(2^96/√P)² = amt·2^192/√P².
    function _c1ToC0(uint256 amtC1, uint160 spot) internal pure returns (uint256) {
        return Math.mulDiv(Math.mulDiv(amtC1, 1 << 96, spot), 1 << 96, spot);
    }

    /// @dev The all-capital liquidity target L = valueC1 / (a0L·P + a1L), derived in
    ///      ONE nested mulDiv per branch (the per-liquidity terms themselves floor to
    ///      zero in raw units, so the division is never materialized as intermediates):
    ///        in-range:  a0L·P + a1L = B/(√PU·2^96) with
    ///                   B = √P·(√PU−√P) + (√P−√PL)·√PU  ⇒  L = valueC1·√PU/(B/2^96);
    ///        below:     unit = √PL·(√PU−√PL)·√P²/(√PL·√PU·2^96)  ⇒  L = valueC1·√PL·√PU·2^96/((√PU−√PL)·√P²);
    ///        above:     unit = (√PU−√PL)/2^96  ⇒  L = valueC1·2^96/(√PU−√PL) (spot-independent — an all-token1 position).
    function _liquidityTarget(uint256 valueC1, uint160 spot, uint160 sqrtPL, uint160 sqrtPU)
        internal
        pure
        returns (uint256 targetL)
    {
        if (spot > sqrtPL && spot < sqrtPU) {
            uint256 b = Math.mulDiv(spot, 2 * uint256(sqrtPU) - uint256(spot), 1 << 96)
                - Math.mulDiv(sqrtPL, sqrtPU, 1 << 96);
            targetL = Math.mulDiv(valueC1, sqrtPU, b);
        } else if (spot <= sqrtPL) {
            uint256 vc0 = _c1ToC0(valueC1, spot);
            targetL = Math.mulDiv(Math.mulDiv(vc0, sqrtPL, sqrtPU - sqrtPL), sqrtPU, 1 << 96);
        } else {
            // Above range: unit = (√PU − √PL)/2^96 — the position is all-token1 and its
            // per-liquidity token1 amount is spot-INDEPENDENT. The old in-range
            // denominator (spot − √PL) understated L by (√PU − √PL)/(spot − √PL) and
            // the un-deployed share was credited as accrual → burned (ROAMER-AUDIT F-1).
            targetL = Math.mulDiv(valueC1, 1 << 96, sqrtPU - sqrtPL);
        }
        // (targetL == 0 ⇔ valueC1 == 0: zero tracked capital — _planAndBuy's lFinal
        // check rejects the deployment; no separate revert needed here.)
    }

    /// @dev Exact-output buy of `amountOut` of `tokenOut` on `poolKey`, paying from
    ///      the held surplus (`payFromBal`) — fresh pinned-Quoter quote first; the
    ///      executed input must stay within the quote + slippage allowance AND within
    ///      the held balance (the fork's spot-derived price limit caps the fill).
    function _buyOnPool(IPoolManagerV4.PoolKey memory poolKey, address tokenOut, uint256 amountOut, uint256 payFromBal, uint160 spot)
        internal
        returns (uint256 bought)
    {
        if (amountOut == 0) return 0;
        bool zeroForOne = poolKey.currency1 == tokenOut; // output c1 → input c0
        address tokenIn = zeroForOne ? poolKey.currency0 : poolKey.currency1;
        uint160 limit = _priceLimit(spot, zeroForOne);

        // Fresh quote (fork semantics: POSITIVE amountSpecified = exact output).
        IPoolManagerV4.SwapParams memory qp =
            IPoolManagerV4.SwapParams({zeroForOne: zeroForOne, amountSpecified: int256(amountOut), sqrtPriceLimitX96: limit});
        (int256 q0, int256 q1, , ) = IForkQuoter(FORK_QUOTER).quoteSingle(poolKey, qp);
        uint256 quotedPaid = uint256(-1 * (zeroForOne ? q0 : q1)); // negative = the paid leg
        if (quotedPaid == 0) revert SwapOutputBelowQuote(amountOut, 0);
        if (quotedPaid > payFromBal) {
            // Cannot afford the target at the live price: scale the request to the
            // affordable input (partial deployment self-corrects at the size step).
            amountOut = Math.mulDiv(amountOut, payFromBal, quotedPaid);
            if (amountOut == 0) return 0;
            qp.amountSpecified = int256(amountOut);
        }

        (int128 d0, int128 d1) = _swapOnPool(poolKey, qp);
        bought = _takePositive(tokenOut, zeroForOne ? d1 : d0);
        uint256 paid = _payNegative(tokenIn, zeroForOne ? d0 : d1);
        if (paid > Math.mulDiv(quotedPaid, BPS + SWAP_SLIPPAGE_BPS, BPS)) revert SwapInputAboveBalance(paid, quotedPaid);
        if (bought < Math.mulDiv(amountOut, BPS - SWAP_SLIPPAGE_BPS, BPS)) revert SwapOutputBelowQuote(bought, amountOut);
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
        // accrual forwards to the TREASURY — never the burn stream.
        if (balance > accounted) {
            uint256 junk = balance - accounted;
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
    ///      WELL, burn directly. Returns the consumed source amount.
    function _burnToken(address token, uint256 sweepAmt, address well) internal returns (uint256 consumed) {
        uint256 wellBought;
        if (token == well) {
            wellBought = sweepAmt;
            consumed = sweepAmt;
        } else {
            (wellBought, consumed) = _swapTokenToWell(token, sweepAmt, well);
        }
        if (wellBought > 0) {
            IERC20(well).safeTransfer(BURN_ADDRESS, wellBought);
        }
        emit Burned(token, wellBought, wellBought);
    }

    /// @dev The quoteSingle EXACT-OUTPUT burn swap (own frame for the codegen stack
    ///      budget): fresh quote of the swept amount sets the minOut floor, then at
    ///      least `minOut` WELL is bought on the Safe-set route.
    function _swapTokenToWell(address token, uint256 sweepAmt, address well)
        internal
        returns (uint256 wellBought, uint256 consumed)
    {
        IPoolManagerV4.PoolKey memory route = sweepRoutes[token];
        if (route.currency0 == address(0) && route.currency1 == address(0)) revert NoSweepRoute(token);
        bool zeroForOne = route.currency0 == token;
        (uint160 spot, , , ) = IStateView(FORK_STATE_VIEW).getSlot0(keccak256(abi.encode(route)));
        uint160 limit = _priceLimit(spot, zeroForOne);
        uint256 minOut = _quoteMinOut(route, zeroForOne, sweepAmt, limit);
        // EXACT-OUTPUT execution: buy at least `minOut` WELL (the swap IS the price).
        IPoolManagerV4.SwapParams memory sp =
            IPoolManagerV4.SwapParams({zeroForOne: zeroForOne, amountSpecified: int256(minOut), sqrtPriceLimitX96: limit});
        (int128 d0, int128 d1) = _swapOnPool(route, sp);
        wellBought = _takePositive(well, zeroForOne ? d1 : d0);
        consumed = _payNegative(token, zeroForOne ? d0 : d1);
        if (consumed > sweepAmt) revert SwapInputAboveBalance(consumed, sweepAmt);
        if (wellBought < minOut) revert SwapOutputBelowQuote(wellBought, minOut);
    }

    /// @dev Fresh quote of an exact-input sweep → the minOut floor (1% allowance).
    function _quoteMinOut(IPoolManagerV4.PoolKey memory route, bool zeroForOne, uint256 sweepAmt, uint160 limit)
        internal
        view
        returns (uint256 minOut)
    {
        IPoolManagerV4.SwapParams memory qp =
            IPoolManagerV4.SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(sweepAmt), sqrtPriceLimitX96: limit});
        (int256 q0, int256 q1, , ) = IForkQuoter(FORK_QUOTER).quoteSingle(route, qp);
        uint256 quotedOut = uint256(zeroForOne ? q1 : q0);
        if (quotedOut == 0) revert SwapOutputBelowQuote(0, 0);
        minOut = Math.mulDiv(quotedOut, BPS - SWAP_SLIPPAGE_BPS, BPS);
    }

    // ------------------------------------------------------------------
    // Internals — LP primitives (house HarvesterV4 settlement patterns)
    // ------------------------------------------------------------------

    function _mint(
        IPoolManagerV4.PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta,
        bytes32 salt
    ) internal {
        (int256 delta, ) = IPoolManagerV4(poolManager).modifyLiquidity(
            key,
            IPoolManagerV4.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: salt
            }),
            ""
        );
        (int128 d0, int128 d1) = _decodeDeltas(delta);
        _payNegative(key.currency0, d0);
        _payNegative(key.currency1, d1);
    }

    /// @dev Execute a swap against the pinned PoolManager and decode the packed
    ///      per-currency deltas (shared frame-keeper for every swap site).
    function _swapOnPool(IPoolManagerV4.PoolKey memory key, IPoolManagerV4.SwapParams memory qp)
        internal
        returns (int128 d0, int128 d1)
    {
        (int256 delta) = IPoolManagerV4(poolManager).swap(key, qp, "");
        (d0, d1) = _decodeDeltas(delta);
    }

    /// @dev Take the POSITIVE leg out to this contract; returns the taken amount.
    function _takePositive(address currency, int128 leg) internal returns (uint256 taken) {
        if (leg > 0) {
            taken = uint256(uint128(leg));
            IPoolManagerV4(poolManager).take(currency, address(this), taken);
        }
    }

    /// @dev Take the POSITIVE leg out to `to` (exit path); returns the taken amount.
    function _takePositiveTo(address currency, address to, int128 leg) internal returns (uint256 taken) {
        if (leg > 0) {
            taken = uint256(uint128(leg));
            IPoolManagerV4(poolManager).take(currency, to, taken);
        }
    }

    /// @dev Settle the NEGATIVE leg (this contract owes the pool) from its own
    ///      balance: ERC-20 via sync→transfer→settle, native via settle{value}.
    ///      Returns the paid amount (0 when the leg is not negative).
    function _payNegative(address currency, int128 leg) internal returns (uint256 paid) {
        if (leg < 0) {
            paid = uint256(uint128(-leg));
            if (currency == address(0)) {
                if (address(this).balance < paid) revert InsufficientNativeBalance(paid, address(this).balance);
                IPoolManagerV4(poolManager).settle{value: paid}();
            } else {
                uint256 bal = IERC20(currency).balanceOf(address(this));
                if (bal < paid) revert SwapInputAboveBalance(paid, bal);
                IPoolManagerV4(poolManager).sync(currency);
                IERC20(currency).safeTransfer(poolManager, paid);
                IPoolManagerV4(poolManager).settle();
            }
        }
    }

    /// @dev Decodes the fork's PACKED BalanceDelta word: amount0 = HIGH 128 bits,
    ///      amount1 = LOW 128 bits (money-critical fork pin; decoding canonically
    ///      would sign-flip the legs — house HarvesterV4.sol pattern).
    function _decodeDeltas(int256 delta) internal pure returns (int128 d0, int128 d1) {
        d0 = int128(delta >> 128);
        d1 = int128(uint128(uint256(delta)));
    }

    // ------------------------------------------------------------------
    // Internals — accounting / registry
    // ------------------------------------------------------------------

    function _creditAccrual(address token, uint256 amount) internal {
        if (!_accountedTokenSeen[token]) {
            _accountedTokenSeen[token] = true;
            accountedTokens.push(token);
        }
        accountedAccrued[token] += amount;
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

    /// @dev Price limit derived from the live spot (the fork rejects tick-extreme
    ///      limits — InvalidPrice — so the ±SWAP_SLIPPAGE_BPS band is clamped inside
    ///      the TickMath bounds).
    function _priceLimit(uint160 spot, bool zeroForOne) internal pure returns (uint160) {
        uint256 bump = Math.mulDiv(spot, SWAP_SLIPPAGE_BPS, BPS);
        if (zeroForOne) {
            uint256 lower = uint256(spot) - bump;
            if (lower <= MIN_SQRT_PLUS_1) lower = uint256(MIN_SQRT_PLUS_1) + 1;
            return uint160(lower);
        }
        uint256 upper = uint256(spot) + bump;
        if (upper >= MAX_SQRT_MINUS_1) upper = uint256(MAX_SQRT_MINUS_1) - 1;
        return uint160(upper);
    }

    /// @dev The honest realized-IL mark (07 §3 ledger field): the released principal
    ///      valued at the from-book's live spot vs the deployed amounts valued at the
    ///      to-book's live spot, minus the roaming take — all in the shared currency,
    ///      all observable pool state, no oracle. >= 0 is a loss, < 0 a gain.
    function _realizedIL(Leg memory leg, BookKey memory toKey, uint160 toSqrtP, Deployed memory dep)
        internal
        pure
        returns (int256 il)
    {
        uint256 released;
        uint256 take;
        if (leg.sIsFromC0) {
            // s == the FROM book's c0: value in s-wei = principal0 + principal1 in c0-wei
            // (nested-mulDiv raw-price conversion — both sides of the mark in s-wei).
            released = leg.principal0 + _c1ToC0(leg.principal1, leg.ds.fromSqrtP);
            // BOTH fee legs left the capital (the take is charged in-kind on both legs
            // and both are credited to the accrual) — the mark adds BOTH back at the
            // from-spot. Adding back only the shared-side leg overstated loss (or
            // understated gain) by the non-shared fee leg (ROAMER-AUDIT F-2).
            take = leg.fee0 + _c1ToC0(leg.fee1, leg.ds.fromSqrtP);
        } else {
            // s == the FROM book's c1: value in s-wei = principal0 in c1-wei + principal1.
            released = _c0ToC1(leg.principal0, leg.ds.fromSqrtP) + leg.principal1;
            take = _c0ToC1(leg.fee0, leg.ds.fromSqrtP) + leg.fee1;
        }
        uint256 deployed;
        if (toKey.poolKey.currency0 == leg.ilCurrency) {
            deployed = dep.owed0 + _c1ToC0(dep.owed1, toSqrtP);
        } else {
            deployed = _c0ToC1(dep.owed0, toSqrtP) + dep.owed1;
        }
        uint256 net = deployed + take;
        uint256 loss = released > net ? released - net : 0;
        uint256 gain = net > released ? net - released : 0;
        il = gain > 0 ? -int256(gain) : int256(loss);
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
        if (key.tickLower >= key.tickUpper) revert BadTicks(key.tickLower, key.tickUpper);
        if (key.tickLower < MIN_TICK || key.tickUpper > MAX_TICK) revert BadTicks(key.tickLower, key.tickUpper);
        if (key.tickLower % key.poolKey.tickSpacing != 0 || key.tickUpper % key.poolKey.tickSpacing != 0) {
            revert BadTickAlignment(key.tickLower, key.poolKey.tickSpacing);
        }
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

    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    /// @notice The pure TickMath evaluation, exposed for the battery's live cross-check
    ///         (ROAMER-AUDIT F-4 — the proof surface the NatSpec claims below).
    function sqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return _sqrtRatioAtTick(tick);
    }

    /// @dev The battery cross-checks this table against the LIVE pools (F-4): for each
    ///      anchor book's live slot0 the table must BRACKET the observed price
    ///      (sqrtRatioAtTick(tick) ≤ slot0.sqrtPriceX96 < sqrtRatioAtTick(tick + 1) —
    ///      a pool's live sqrtP is a swap output, not a tick-boundary value), stay
    ///      strictly monotonic across the money-path neighborhood, and match the
    ///      canonical TickMath anchor at MIN_TICK exactly — a hard live proof of the
    ///      table that feeds every band-sizing and price-limit computation.
    function _sqrtRatioAtTick(int24 tick) internal pure returns (uint160 sqrtP) {
        uint256 absTick = tick < 0 ? uint256(-int256(tick)) : uint256(int256(tick));
        // absTick is bounded by validation to ±887272 (< 2^20), so the 19-entry table suffices.
        uint256 ratio = absTick & 0x1 != 0 ? 0xfffcb933bd6fad37aa2d162d1a594001 : 0x100000000000000000000000000000000;
        unchecked {
            if (absTick & 0x2 != 0) ratio = (ratio * 0xfff97272373d413259a46990580e213a) >> 128;
            if (absTick & 0x4 != 0) ratio = (ratio * 0xfff2e50f5f656932ef12357cf3c7fdcc) >> 128;
            if (absTick & 0x8 != 0) ratio = (ratio * 0xffe5caca7e10e4e61c3624eaa0941cd0) >> 128;
            if (absTick & 0x10 != 0) ratio = (ratio * 0xffcb9843d60f6159c9db58835c926644) >> 128;
            if (absTick & 0x20 != 0) ratio = (ratio * 0xff973b41fa98c081472e6896dfb254c0) >> 128;
            if (absTick & 0x40 != 0) ratio = (ratio * 0xff2ea16466c96a3843ec78b326b52861) >> 128;
            if (absTick & 0x80 != 0) ratio = (ratio * 0xfe5dee046a99a2a811c461f1969c3053) >> 128;
            if (absTick & 0x100 != 0) ratio = (ratio * 0xfcbe86c7900a88aedcffc83b479aa3a4) >> 128;
            if (absTick & 0x200 != 0) ratio = (ratio * 0xf987a7253ac413176f2b074cf7815e54) >> 128;
            if (absTick & 0x400 != 0) ratio = (ratio * 0xf3392b0822b70005940c7a398e4b70f3) >> 128;
            if (absTick & 0x800 != 0) ratio = (ratio * 0xe7159475a2c29b7443b29c7fa6e889d9) >> 128;
            if (absTick & 0x1000 != 0) ratio = (ratio * 0xd097f3bdfd2022b8845ad8f792aa5825) >> 128;
            if (absTick & 0x2000 != 0) ratio = (ratio * 0xa9f746462d870fdf8a65dc1f90e061e5) >> 128;
            if (absTick & 0x4000 != 0) ratio = (ratio * 0x70d869a156d2a1b890bb3df62baf32f7) >> 128;
            if (absTick & 0x8000 != 0) ratio = (ratio * 0x31be135f97d08fd981231505542fcfa6) >> 128;
            if (absTick & 0x10000 != 0) ratio = (ratio * 0x9aa508b5b7a84e1c677de54f3e99bc9) >> 128;
            if (absTick & 0x20000 != 0) ratio = (ratio * 0x5d6af8dedb81196699c329225ee604) >> 128;
            if (absTick & 0x40000 != 0) ratio = (ratio * 0x2216e584f5fa1ea926041bedfe98) >> 128;
            if (absTick & 0x80000 != 0) ratio = (ratio * 0x48a170391f7dc42444e8fa2) >> 128;
        }
        if (tick > 0) ratio = type(uint256).max / ratio;
        // Q128 → Q96, round up (canonical TickMath behavior).
        sqrtP = uint160((ratio >> 32) + (ratio % (1 << 32) == 0 ? 0 : 1));
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
}
