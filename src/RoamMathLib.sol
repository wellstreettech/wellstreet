// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IForkQuoter, IPoolManagerV4, IStateView} from "./RoamingHarvester.sol";

/// @title RoamMathLib — the roamer's pure observable-state math, extracted as an
///        external library (ROAMVAULT-SIZE 2026-09-09).
/// @notice WHY THIS LIBRARY EXISTS: the RH-4663 chain ENFORCES EIP-170 (24,576-byte
///         runtime limit) and RoamingHarvester's runtime exceeded it, so the heavy
///         PURE computation clusters (no storage access, no state mutation — inputs
///         in, outputs out) moved here. External library functions execute via
///         DELEGATECALL against the linked library and count ZERO toward the
///         caller's runtime size. BEHAVIOR-IDENTICAL extraction: every function
///         body below is copied VERBATIM from RoamingHarvester.sol (same branch
///         order, same constants, same revert selectors — custom errors declared
///         here produce byte-identical selectors because selectors are
///         signature-derived). The audited fix shapes (ROAMER-AUDIT F-1 band
///         sizing, F-2 both-legs take, F-4 TickMath table) live HERE now — the
///         NatSpec that documents them moved with the code.
///         STATELESS: no storage reads/writes anywhere — every input arrives as an
///         argument; the only non-arithmetic operations are the reverts below.
library RoamMathLib {
    using SafeERC20 for IERC20;
    // ------------------------------------------------------------------
    // Constants — VALUES IDENTICAL to RoamingHarvester.sol's originals
    // (the contract keeps BPS / SWAP_SLIPPAGE_BPS for its own call sites and
    // MAX_SQRT_MINUS_1 as the public battery pin; the copies here serve only
    // the pure math).
    // ------------------------------------------------------------------

    uint256 internal constant BPS = 10_000;
    /// @dev Slippage allowance on every fresh quote (1%) — house HarvesterV4 shape.
    uint256 internal constant SWAP_SLIPPAGE_BPS = 100;
    /// @dev Sizing margin (0.01%) shaved off the liquidity target so the pool's own
    ///      rounding can never demand a wei more than the tracked capital.
    uint256 internal constant SIZE_MARGIN_BPS = 1;

    // Pinned fork stack — VALUES IDENTICAL to RoamingHarvester.sol's originals (the
    // contract's poolManager immutable is ctor-enforced == FORK_POOL_MANAGER_4663,
    // and the test battery etches its mocks AT these pinned addresses, so the
    // constant IS the value in every reachable deployment). The lib performs no
    // HARVESTER-storage access; these pins only route its external calls.
    address internal constant FORK_POOL_MANAGER_4663 = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant FORK_QUOTER = 0x076838736F90Cd1d30dED756A3B89E576BE972F8;
    address internal constant FORK_STATE_VIEW = 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2;

    /// @dev v4 TickMath sqrt bounds (fork source) — swap price limits are clamped
    ///      inside these (the fork rejects tick-extreme limits with InvalidPrice).
    ///      V-5 fix 2026-09-08 (composition audit): the MAX constant is canonical
    ///      TickMath.MAX_SQRT_RATIO - 1 and MIN_SQRT_PLUS_1 canonical
    ///      MIN_SQRT_RATIO + 1 (the contract exposes MAX_SQRT_MINUS_1 publicly for
    ///      the battery's live pin — RoamVaultFork/RoamingHarvesterFork F-4).
    uint160 internal constant MIN_SQRT_PLUS_1 = 4295128740;
    uint160 internal constant MAX_SQRT_MINUS_1 = 1461446703485210103287273052203988822378729556659;

    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    // ------------------------------------------------------------------
    // Errors — IDENTICAL signatures to the contract's originals (selectors are
    // signature-derived, so vm.expectRevert against the contract's declarations
    // still matches when the revert is raised here).
    // ------------------------------------------------------------------

    error BadTicks(int24 tickLower, int24 tickUpper);
    error BadTickAlignment(int24 tick, int24 tickSpacing);
    error SwapOutputBelowQuote(uint256 received, uint256 quoted);
    error SwapInputAboveBalance(uint256 required, uint256 available);
    error BooksShareNoCurrency(address from0, address from1, address to0, address to1);
    error NoSweepRoute(address token);
    error InsufficientNativeBalance(uint256 required, uint256 available);

    // ------------------------------------------------------------------
    // TickMath.getSqrtRatioAtTick (standard v3/v4 constant table, round-up)
    // ------------------------------------------------------------------

    /// @dev The battery cross-checks this table against the LIVE pools (F-4): for
    ///      each anchor book's live slot0 the table must BRACKET the observed price
    ///      (sqrtRatioAtTick(tick) ≤ slot0.sqrtPriceX96 < sqrtRatioAtTick(tick + 1)
    ///      — a pool's live sqrtP is a swap output, not a tick-boundary value), stay
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

    /// @notice The pure TickMath evaluation — the battery's live cross-check surface
    ///         reaches it through the harvester's public `sqrtRatioAtTick` (F-4).
    function sqrtRatioAtTick(int24 tick) external pure returns (uint160) {
        return _sqrtRatioAtTick(tick);
    }

    // ------------------------------------------------------------------
    // Swap price limiting
    // ------------------------------------------------------------------

    /// @dev Price limit derived from the live spot (the fork rejects tick-extreme
    ///      limits — InvalidPrice — so the ±SWAP_SLIPPAGE_BPS band is clamped inside
    ///      the TickMath bounds). Lib-internal: every caller (the swap composites)
    ///      lives in this library.
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

    // ------------------------------------------------------------------
    // Band planning (the F-1 domain-branched liquidity-target derivations)
    // ------------------------------------------------------------------

    /// @dev The tracked capital's total value in c1-wei (nested-mulDiv raw-price
    ///      conversion — no explicit spot² product, so no overflow at the TickMath
    ///      extremes, and no sub-unit flooring: each step's error is relative 2^-96).
    function _capitalValueC1(address curA, uint256 amtA, address curB, uint256 amtB, address t0, uint160 spot)
        internal
        pure
        returns (uint256 value)
    {
        value = (curA == t0 ? _c0ToC1(amtA, spot) : amtA) + (curB == t0 ? _c0ToC1(amtB, spot) : amtB);
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
        // (targetL == 0 ⇔ valueC1 == 0: zero tracked capital — the caller's lFinal
        // check rejects the deployment; no separate revert needed here.)
    }

    // ------------------------------------------------------------------
    // The honest realized-IL mark (F-2: BOTH fee legs added back)
    // ------------------------------------------------------------------

    /// @dev The honest realized-IL mark (07 §3 ledger field): the released principal
    ///      valued at the from-book's live spot vs the deployed amounts valued at the
    ///      to-book's live spot, minus the roaming take — all in the shared currency,
    ///      all observable pool state, no oracle. >= 0 is a loss, < 0 a gain.
    ///      Args flattened from the harvester's (Leg, BookKey, Deployed):
    ///      sIsFromC0 = the shared currency is the FROM book's currency0;
    ///      fromSqrtP/toSqrtP = the from/to spot snapshots; toC0IsIl =
    ///      (to-book currency0 == the IL currency); owed0/owed1 = the deployed legs.
    function realizedIL(
        uint256 principal0,
        uint256 principal1,
        uint256 fee0,
        uint256 fee1,
        bool sIsFromC0,
        uint160 fromSqrtP,
        bool toC0IsIl,
        uint256 owed0,
        uint256 owed1,
        uint160 toSqrtP
    ) external pure returns (int256 il) {
        uint256 released;
        uint256 take;
        if (sIsFromC0) {
            // s == the FROM book's c0: value in s-wei = principal0 + principal1 in c0-wei
            // (nested-mulDiv raw-price conversion — both sides of the mark in s-wei).
            released = principal0 + _c1ToC0(principal1, fromSqrtP);
            // BOTH fee legs left the capital (the take is charged in-kind on both legs
            // and both are credited to the accrual) — the mark adds BOTH back at the
            // from-spot. Adding back only the shared-side leg overstated loss (or
            // understated gain) by the non-shared fee leg (ROAMER-AUDIT F-2).
            take = fee0 + _c1ToC0(fee1, fromSqrtP);
        } else {
            // s == the FROM book's c1: value in s-wei = principal0 in c1-wei + principal1.
            released = _c0ToC1(principal0, fromSqrtP) + principal1;
            take = _c0ToC1(fee0, fromSqrtP) + fee1;
        }
        uint256 deployed;
        if (toC0IsIl) {
            deployed = owed0 + _c1ToC0(owed1, toSqrtP);
        } else {
            deployed = _c0ToC1(owed0, toSqrtP) + owed1;
        }
        uint256 net = deployed + take;
        uint256 loss = released > net ? released - net : 0;
        uint256 gain = net > released ? net - released : 0;
        il = gain > 0 ? -int256(gain) : int256(loss);
    }

    // ------------------------------------------------------------------
    // Deployed-value in the vault denomination (ROAMVAULT item 6 mark)
    // ------------------------------------------------------------------

    /// @dev A to-band's deployed value in the vault's USDG denomination, valued at the
    ///      observable to-book spot (no oracle). The harvester's wrapper owns the
    ///      currency branching (which leg is the vault asset); this is the per-branch
    ///      math. (The unreachable third branch of the original stays in the wrapper.)
    function deployedValueC(bool c0IsDenom, uint256 owed0, uint256 owed1, uint160 spot)
        external
        pure
        returns (uint256)
    {
        if (c0IsDenom) return owed0 + _c1ToC0(owed1, spot);
        return _c0ToC1(owed0, spot) + owed1;
    }

    // ------------------------------------------------------------------
    // Band validation
    // ------------------------------------------------------------------

    /// @dev Band validation: ordered, inside the TickMath table bounds, and aligned
    ///      to the book's tick spacing.
    function validateBand(int24 tickLower, int24 tickUpper, int24 tickSpacing) external pure {
        if (tickLower >= tickUpper) revert BadTicks(tickLower, tickUpper);
        if (tickLower < MIN_TICK || tickUpper > MAX_TICK) revert BadTicks(tickLower, tickUpper);
        if (tickLower % tickSpacing != 0 || tickUpper % tickSpacing != 0) {
            revert BadTickAlignment(tickLower, tickSpacing);
        }
    }

    // ==================================================================
    // ROAMVAULT-SIZE second wave — the storage-free swap/plan composites.
    // These functions read and write NO harvester storage: every one of them
    // talks ONLY to the pinned fork stack (StateView reads, Quoter staticcalls,
    // PoolManager settlement) and to the ERC-20s themselves, with every input
    // passed as an argument and every output returned. They execute via
    // DELEGATECALL, so msg.sender/address(this) stay the harvester and the
    // PM lock/funds checks behave exactly as when the bodies lived in the
    // contract. Bodies copied VERBATIM from RoamingHarvester.sol.
    // ==================================================================

    // ------------------------------------------------------------------
    // LP primitives (house HarvesterV4 settlement patterns) — lib-internal
    // copies serving the composites above and below (the harvester keeps its
    // own copies for its remaining call sites).
    // ------------------------------------------------------------------

    function _decodeDeltas(int256 delta) internal pure returns (int128 d0, int128 d1) {
        d0 = int128(delta >> 128);
        d1 = int128(uint128(uint256(delta)));
    }

    function _swapOnPool(IPoolManagerV4.PoolKey memory key, IPoolManagerV4.SwapParams memory qp)
        internal
        returns (int128 d0, int128 d1)
    {
        (int256 delta) = IPoolManagerV4(FORK_POOL_MANAGER_4663).swap(key, qp, "");
        (d0, d1) = _decodeDeltas(delta);
    }

    function _takePositive(address currency, int128 leg) internal returns (uint256 taken) {
        if (leg > 0) {
            taken = uint256(uint128(leg));
            IPoolManagerV4(FORK_POOL_MANAGER_4663).take(currency, address(this), taken);
        }
    }

    function _payNegative(address currency, int128 leg) internal returns (uint256 paid) {
        if (leg < 0) {
            paid = uint256(uint128(-leg));
            if (currency == address(0)) {
                if (address(this).balance < paid) revert InsufficientNativeBalance(paid, address(this).balance);
                IPoolManagerV4(FORK_POOL_MANAGER_4663).settle{value: paid}();
            } else {
                uint256 bal = IERC20(currency).balanceOf(address(this));
                if (bal < paid) revert SwapInputAboveBalance(paid, bal);
                IPoolManagerV4(FORK_POOL_MANAGER_4663).sync(currency);
                IERC20(currency).safeTransfer(FORK_POOL_MANAGER_4663, paid);
                IPoolManagerV4(FORK_POOL_MANAGER_4663).settle();
            }
        }
    }

    // ------------------------------------------------------------------
    // ROAMVAULT-SIZE third wave — the LP-primitive composites. Each is the
    // verbatim contract sequence (PoolManager modifyLiquidity → packed
    // BalanceDelta decode → per-leg take/pay) behind ONE library boundary:
    // the harvester keeps the storage touches (position fields, nonce,
    // residual routing) and every emit; the PM call, decode and settlement
    // legs run here from the delegatecall frame — identical
    // msg.sender/address(this) semantics, so PM lock/funds checks behave
    // exactly as when the bodies lived in the contract. Sign conventions
    // preserved: decrease/exit legs pass -int256(uint256(liquidity)), open
    // passes +int256(uint256(liquidity)), the fee collect passes 0.
    // ------------------------------------------------------------------

    /// @dev The shared PoolManager modifyLiquidity core (verbatim call + the fork's
    ///      packed BalanceDelta decode: amount0 HIGH 128 bits, amount1 LOW).
    function _modifyLiquidity(
        IPoolManagerV4.PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta,
        bytes32 salt
    ) internal returns (int128 d0, int128 d1) {
        (int256 delta, ) = IPoolManagerV4(FORK_POOL_MANAGER_4663).modifyLiquidity(
            key,
            IPoolManagerV4.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: salt
            }),
            ""
        );
        (d0, d1) = _decodeDeltas(delta);
    }

    /// @dev Take the POSITIVE leg out to `to` (the harvester's _takePositiveTo body,
    ///      verbatim; _takePositive above is its to == address(this) form).
    function _takePositiveTo(address currency, address to, int128 leg) internal returns (uint256 taken) {
        if (leg > 0) {
            taken = uint256(uint128(leg));
            IPoolManagerV4(FORK_POOL_MANAGER_4663).take(currency, to, taken);
        }
    }

    /// @dev Zero-delta fee collect: callerDelta IS the accrued-fee pair; both legs
    ///      taken to this contract (verbatim _collectOne / _collectAndClose step-1).
    function collectFees(IPoolManagerV4.PoolKey memory key, int24 tickLower, int24 tickUpper, bytes32 salt)
        external
        returns (uint256 c0, uint256 c1)
    {
        (int128 d0, int128 d1) = _modifyLiquidity(key, tickLower, tickUpper, 0, salt);
        c0 = _takePositive(key.currency0, d0);
        c1 = _takePositive(key.currency1, d1);
    }

    /// @dev Full/partial decrease: principal out, both legs to this contract
    ///      (verbatim _collectAndClose step-2 and _egressSlice legs).
    function decreaseLegs(
        IPoolManagerV4.PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt,
        uint128 liquidity
    ) external returns (uint256 p0, uint256 p1) {
        (int128 d0, int128 d1) = _modifyLiquidity(key, tickLower, tickUpper, -int256(uint256(liquidity)), salt);
        p0 = _takePositive(key.currency0, d0);
        p1 = _takePositive(key.currency1, d1);
    }

    /// @dev Full close with both legs straight to `to` (verbatim _exitCallback — the
    ///      disclosed wind-down custody path; `to` is an arbitrary timelock-chosen
    ///      recipient, so the take targets it directly).
    function exitLegsTo(
        IPoolManagerV4.PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt,
        uint128 liquidity,
        address to
    ) external returns (uint256 taken0, uint256 taken1) {
        (int128 d0, int128 d1) = _modifyLiquidity(key, tickLower, tickUpper, -int256(uint256(liquidity)), salt);
        taken0 = _takePositiveTo(key.currency0, to, d0);
        taken1 = _takePositiveTo(key.currency1, to, d1);
    }

    /// @dev Open/increase: the pool's owed principal paid from this contract's own
    ///      balance (verbatim _openBand/_mint legs; the InsufficientNativeBalance /
    ///      SwapInputAboveBalance selectors are identical — declared above).
    function openLegs(
        IPoolManagerV4.PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt,
        uint128 liquidity
    ) external returns (uint256 paid0, uint256 paid1) {
        (int128 d0, int128 d1) = _modifyLiquidity(key, tickLower, tickUpper, int256(uint256(liquidity)), salt);
        paid0 = _payNegative(key.currency0, d0);
        paid1 = _payNegative(key.currency1, d1);
    }

    // ------------------------------------------------------------------
    // The conversion leg (verbatim _convertCapital + _sellLeg)
    // ------------------------------------------------------------------

    /// @dev Sell `amountIn` of `tokenIn` for the shared currency ON THE FROM-POOL via
    ///      an exact-input v4-native swap (fresh pinned-Quoter quote, fail-closed
    ///      stale-quote check, spot-derived price limit). The original contract
    ///      function's third parameter (the shared currency) was UNUSED in the body
    ///      and is dropped here; the contract's wrapper keeps its signature.
    function sellLeg(IPoolManagerV4.PoolKey memory poolKey, address tokenIn, uint256 amountIn)
        external
        returns (uint256 amountOut)
    {
        return _sellLeg(poolKey, tokenIn, amountIn);
    }

    /// @dev The sell-leg body (verbatim) — shared by the external entry above and
    ///      the convertCapital composite below.
    function _sellLeg(IPoolManagerV4.PoolKey memory poolKey, address tokenIn, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        if (amountIn == 0) return 0;
        bool zeroForOne = poolKey.currency0 == tokenIn;
        (uint160 spot, , , ) = IStateView(FORK_STATE_VIEW).getSlot0(keccak256(abi.encode(poolKey)));
        uint160 limit = _priceLimit(spot, zeroForOne);

        // Fresh quote (fork semantics: NEGATIVE amountSpecified = exact input).
        IPoolManagerV4.SwapParams memory qp =
            IPoolManagerV4.SwapParams({zeroForOne: zeroForOne, amountSpecified: -int256(amountIn), sqrtPriceLimitX96: limit});
        (int256 q0, int256 q1, , ) = IForkQuoter(FORK_QUOTER).quoteSingle(poolKey, qp);
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

    /// @dev Sell the non-shared from-currency entirely (on the from-pool — it IS that
    ///      book's own venue), leaving the capital in the shared currency. A
    ///      same-pool re-range skips conversion: both legs are already held.
    ///      Flattened DeployState return: (curA, amtA, curB, amtB); the caller keeps
    ///      the fromSqrtP snapshot leg exactly as before (it is read BEFORE this call
    ///      and written into the caller's DeployState).
    function convertCapital(
        IPoolManagerV4.PoolKey memory fromPoolKey,
        IPoolManagerV4.PoolKey memory toPoolKey,
        address s,
        uint256 cap0,
        uint256 cap1
    ) external returns (address curA, uint256 amtA, address curB, uint256 amtB) {
        address f0 = fromPoolKey.currency0;
        address f1 = fromPoolKey.currency1;
        if (keccak256(abi.encode(fromPoolKey)) == keccak256(abi.encode(toPoolKey))) {
            return (f0, cap0, f1, cap1);
        }

        // Cross-book: exactly one of (f0, f1) == s; the other must be sold entirely.
        if (f0 == s) {
            curA = s;
            amtA = cap0 + _sellLeg(fromPoolKey, f1, cap1);
        } else {
            curA = s;
            amtA = cap1 + _sellLeg(fromPoolKey, f0, cap0);
        }
        curB = address(0);
        amtB = 0;
        address t0 = toPoolKey.currency0;
        address t1 = toPoolKey.currency1;
        if (s != t0 && s != t1) revert BooksShareNoCurrency(f0, f1, t0, t1);
    }

    // ------------------------------------------------------------------
    // The band plan + deficit buy + affordable sizing (verbatim
    // _planAndBuy + _buyDeficit + _buyOnPool over the moved _planBand and
    // _affordableForBand math)
    // ------------------------------------------------------------------

    /// @dev Band plan + deficit buy + affordable-liquidity sizing (recomputed at the
    ///      ACTUAL post-buy spot — the deficit buy moves it; limit-capped
    ///      affordability self-corrects here). ONE library boundary for the whole
    ///      storage-free planning core: the harvester keeps only the storage touches
    ///      around it (_openBand's nonce/routing).
    function planAndBuy(
        IPoolManagerV4.PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        bytes32 toPid,
        address curA,
        uint256 amtA,
        address curB,
        uint256 amtB
    ) external returns (uint256 bal0, uint256 bal1, uint128 liquidity) {
        (uint160 spot, , , ) = IStateView(FORK_STATE_VIEW).getSlot0(toPid);
        uint256 target0;
        uint256 target1;
        (bal0, bal1, target0, target1) = _planBand(poolKey, tickLower, tickUpper, spot, curA, amtA, curB, amtB);
        (bal0, bal1) = _buyDeficit(poolKey, target0, target1, bal0, bal1, spot);
        (uint160 spot2, , , ) = IStateView(FORK_STATE_VIEW).getSlot0(toPid);
        liquidity = _affordableForBand(tickLower, tickUpper, spot2, bal0, bal1);
    }

    /// @dev The band plan (verbatim _planBand over flattened args; lib-internal —
    ///      the composite above is its only caller). The band plan derives the
    ///      all-capital deployment targets for the band and the currently-held
    ///      per-currency balances (TRACKED capital only — junk never enters the
    ///      plan). The targets are planning quantities — they drive only the deficit
    ///      buy and are re-derived from the ACTUAL post-buy balances by the caller —
    ///      but they must be right-ORDERED: the per-liquidity raw-unit values floor
    ///      to zero on off-1:1 books, so every step below is a single nested mulDiv
    ///      that absorbs the 2^96/2^192 scaling (verified: at a 1:1 spot a full-range
    ///      band yields target0 = target1 = value/2).
    function _planBand(
        IPoolManagerV4.PoolKey memory poolKey,
        int24 tickLower,
        int24 tickUpper,
        uint160 spot,
        address curA,
        uint256 amtA,
        address curB,
        uint256 amtB
    ) internal pure returns (uint256 bal0, uint256 bal1, uint256 target0, uint256 target1) {
        address t0 = poolKey.currency0;
        address t1 = poolKey.currency1;
        uint160 sqrtPL = _sqrtRatioAtTick(tickLower);
        uint160 sqrtPU = _sqrtRatioAtTick(tickUpper);

        uint256 valueC1 = _capitalValueC1(curA, amtA, curB, amtB, t0, spot);
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

        bal0 = curA == t0 ? amtA : (curB == t0 ? amtB : 0);
        bal1 = curA == t1 ? amtA : (curB == t1 ? amtB : 0);
    }

    /// @dev The affordable-liquidity bound (verbatim _affordableForBand over
    ///      flattened args; lib-internal — the composite above is its only caller).
    ///      EXACT per-leg bounds (nested mulDiv): the raw-unit per-liquidity amounts
    ///      floor to ZERO on off-1:1 books (SPY/USDG raw price 0.06 → a1L = 0.244;
    ///      USDG/ETH 3e-9 → a1L = 5e-5) and must never be used as intermediate
    ///      scales.
    ///        a0L = 2^96·(√PU−√P)/(√P·√PU), a1L = (√P−√PL)/2^96 (raw wei per L);
    ///        below-range the c0 leg is L·2^96·(1/√PL − 1/√PU) (spot-independent).
    ///      The sizing margin keeps the pool's own rounding from demanding a wei more
    ///      than the tracked balances.
    function _affordableForBand(int24 tickLower, int24 tickUpper, uint160 spot2, uint256 bal0, uint256 bal1)
        internal
        pure
        returns (uint128 liquidity)
    {
        uint160 sqrtPL = _sqrtRatioAtTick(tickLower);
        uint160 sqrtPU = _sqrtRatioAtTick(tickUpper);
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
            // (√PU − √PL)/(spot − √PL), and the deploy step then credited the entire
            // shortfall as accounted accrual → burned (ROAMER-AUDIT F-1: a
            // permissionless one-sided-band migrate could destroy up to ~100% of
            // principal).
            uint256 denom = spot2 < sqrtPU ? spot2 - sqrtPL : sqrtPU - sqrtPL;
            l1 = Math.mulDiv(bal1, 1 << 96, denom);
        }
        uint256 lFinal = Math.mulDiv(l0 < l1 ? l0 : l1, margin, BPS);
        if (lFinal == 0 || lFinal > type(uint128).max) revert BadTicks(tickLower, tickUpper);
        liquidity = uint128(lFinal);
    }

    /// @dev The deficit-buy leg (verbatim _buyDeficit, poolKey flattened from the
    ///      BookKey). Each buy inherently sells the surplus leg, so post-swap the
    ///      balances track the band ratio.
    function _buyDeficit(
        IPoolManagerV4.PoolKey memory poolKey,
        uint256 target0,
        uint256 target1,
        uint256 bal0,
        uint256 bal1,
        uint160 spot
    ) internal returns (uint256 out0, uint256 out1) {
        out0 = bal0;
        out1 = bal1;
        if (target1 > bal1 && bal0 > 0) {
            out1 = bal1 + _buyOnPool(poolKey, poolKey.currency1, target1 - bal1, bal0, spot);
        } else if (target0 > bal0 && bal1 > 0) {
            out0 = bal0 + _buyOnPool(poolKey, poolKey.currency0, target0 - bal0, bal1, spot);
        }
    }

    /// @dev Exact-output buy of `amountOut` of `tokenOut` on `poolKey`, paying from
    ///      the held surplus (`payFromBal`) — fresh pinned-Quoter quote first; the
    ///      executed input must stay within the quote + slippage allowance AND within
    ///      the held balance (the fork's spot-derived price limit caps the fill).
    function _buyOnPool(
        IPoolManagerV4.PoolKey memory poolKey,
        address tokenOut,
        uint256 amountOut,
        uint256 payFromBal,
        uint160 spot
    ) internal returns (uint256 bought) {
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
    // The burn swap (verbatim _swapTokenToWell + _quoteMinOut, route passed
    // in instead of read from the harvester's sweepRoutes mapping — the read
    // stays contract-side in _burnToken)
    // ------------------------------------------------------------------

    /// @dev The quoteSingle EXACT-OUTPUT burn swap: fresh quote of the swept amount
    ///      sets the minOut floor, then at least `minOut` WELL is bought on the
    ///      Safe-set route.
    function swapTokenToWell(IPoolManagerV4.PoolKey memory route, address token, uint256 sweepAmt, address well)
        external
        returns (uint256 wellBought, uint256 consumed)
    {
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
}
