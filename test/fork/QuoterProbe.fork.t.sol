// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @dev The fork Quoter's custom read surface (canonical v4-periphery `quoteExactInputSingle`
///      REVERTS on all six deploys — the fork ships `quoteSingle` instead; 04 doc §5.3).
interface IForkQuoter {
    function quoteSingle(PoolKey calldata poolKey, SwapParams calldata swapParams)
        external
        view
        returns (int256 amount0, int256 amount1, uint160 sqrtPriceX96After, uint32);
}

/// @dev Canonical v4-periphery lens, ctor-arg-bound to the fork PoolManager (GOAL §S0.5).
interface IStateView {
    function getSlot0(bytes32 poolId) external view returns (uint160, int24, uint24, uint24);
}

struct PoolKey {
    address currency0;
    address currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

struct SwapParams {
    bool zeroForOne;
    int256 amountSpecified;
    uint160 sqrtPriceLimitX96;
}

/// @title QuoterProbeForkTest — QUOTER-PIN-FORK-TEST (§S0.8 evidence, GOAL doc 2026-09-04)
/// @notice Pins the fork Quoter and closes the 04 doc's open item: the SPY-book
///         `quoteSingle` revert `0x00bfc921` was a WRONG-KEY artifact, not a pool quirk.
///         Root cause (bundle-proven + live-discriminated):
///           1. `0x00bfc921` = `InvalidPrice()` — declared ONLY in the verified PoolManager
///              bundle's `SqrtPriceMath.sol` (fired by `getAmount0Delta` when either bound
///              sqrt price is ZERO; the bundle's 45 files contain no other occurrence).
///           2. A poolKey that matches NO initialized pool reads all-zero pool state from
///              the PoolManager → current sqrtPrice = 0 → `InvalidPrice()` on EVERY
///              amount/direction — reproduced live on two distinct nonexistent keys.
///           3. The 2026-09-04 probe used the Merkl-labeled SPY/USDG fee-500/ts-80 key —
///              StateView `getSlot0` on that poolId is ALL ZERO (no such pool exists).
///           4. The REAL SPY/USDG book (fee 3000, ts 60, poolId 0xfe2a80bb…526cd per §S0.3)
///              quotes cleanly through the SAME pinned Quoter — live-verified 2026-09-06
///              in both directions (the zeroForOne direction may return a LIMIT-CAPPED
///              partial fill on the thin book — see the cap-rule test below).
///         Zero real-chain transactions, zero broadcast, zero spend. Read-only fork.
///         Self-skips when WELLSTREET_ROBINHOOD_RPC_URL is unset (house pattern,
///         HarvestFork.t.sol:127); CI injects the secret and fails on any skip.
contract QuoterProbeForkTest is Test {
    // ---- PIN (§QUOTER-PIN-FORK-TEST): ONE fork Quoter of the 6 identical PM-bound deploys ----
    // Prior-live-evidence pick: the 04 doc §5.3 probe address. All six deploys share runtime
    // codehash 0x6f47a0e49bab7e7d8a7feb99a3a1e470089b7cc920545cfdf8dc0a6fa34fe8cb
    // (live-verified 2026-09-06), so the choice among them is arbitrary-but-pinned.
    address constant QUOTER = 0x076838736F90Cd1d30dED756A3B89E576BE972F8;

    address constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant STATE_VIEW = 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2;

    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;

    /// @dev The six PM-bound `Quoter` deploys (04 doc §5.3 ctor sweep). Identical bytecode.
    ///      (Solidity does not implement `constant` arrays of value type — pinned inline here.)
    address[6] QUOTER_DEPLOYS = [
        0x076838736F90Cd1d30dED756A3B89E576BE972F8,
        0x3881e5246E81e1bf731A9fc1856268d381Bb9bd7,
        0x444d7f1B72DD8D269ca10033980fDe384f705C53,
        0x7232686FC954f12079cadFC5e9F755a9fEAeb3Ca,
        0xBDC63B6C33Ad52398a870151b958Cf0b1f3d2564,
        0xce6cd4E35447E05A39A50A4bCf61f2DcD93A8f0D
    ];

    /// @dev Shared runtime codehash of the six deploys (live 2026-09-06).
    bytes32 constant QUOTER_DEPLOYS_CODEHASH = 0x6f47a0e49bab7e7d8a7feb99a3a1e470089b7cc920545cfdf8dc0a6fa34fe8cb;

    // ---- The REAL SPY/USDG book (GOAL §S0.3: derived from live Initialize, poolId re-derived) ----
    PoolKey SPY_USDG_REAL =
        PoolKey({currency0: SPY, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: address(0)});
    bytes32 constant SPY_USDG_REAL_POOL_ID = 0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd;

    // ---- The WRONG key behind the 2026-09-04 revert: Merkl-labeled "SPY books fee 500 / ts 80"
    //      (04 doc §5.4 status line). StateView proves NO pool exists under this key. ----
    PoolKey SPY_USDG_WRONG_20260904 =
        PoolKey({currency0: SPY, currency1: USDG, fee: 500, tickSpacing: 80, hooks: address(0)});
    bytes32 constant SPY_USDG_WRONG_20260904_POOL_ID = 0xdf6149c7772bd34cd9e8b9206e58e014e8bddde7416ea1c8f421532ee8bdb08e;

    // A synthetic guaranteed-nonexistent key (second discriminator, live-probed same day).
    PoolKey SPY_USDG_SYNTHETIC =
        PoolKey({currency0: SPY, currency1: USDG, fee: 1234, tickSpacing: 10, hooks: address(0)});

    uint160 constant MIN_SQRT_PLUS_1 = 4295128740;
    uint160 constant MAX_SQRT_MINUS_1 = 1461446703485210103287273052203988822378783945700;

    /// @dev `InvalidPrice()` — the ONLY source of selector 0x00bfc921 in the verified
    ///      45-file PoolManager bundle (SqrtPriceMath.getAmount0Delta zero-price guard).
    bytes4 constant INVALID_PRICE_SELECTOR = 0x00bfc921;

    function _rpc() internal view returns (string memory) {
        return vm.envOr("WELLSTREET_ROBINHOOD_RPC_URL", string(""));
    }

    function setUp() public {
        string memory rpc = _rpc();
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
    }

    function _quoter() internal view returns (IForkQuoter) {
        return IForkQuoter(QUOTER);
    }

    function _poolId(PoolKey memory key) internal pure returns (bytes32) {
        // Fork poolId = canonical keccak256(abi.encode(poolKey)) (GOAL §S0.2 — PoolId.toId, 0xa0 bytes).
        return keccak256(abi.encode(key));
    }

    // ------------------------------------------------------------------
    // PIN evidence
    // ------------------------------------------------------------------

    /// @notice The pin target is a live contract, and all six deploys are byte-identical —
    ///         pinning ONE of them (any of the six) is behavior-preserving.
    function test_pin_one_of_six_identical_quoter_deploys() public view {
        for (uint256 i = 0; i < QUOTER_DEPLOYS.length; i++) {
            assertEq(
                keccak256(QUOTER_DEPLOYS[i].code),
                QUOTER_DEPLOYS_CODEHASH,
                "Quoter deploy bytecode drifted from the pinned codehash"
            );
        }
        assertEq(keccak256(QUOTER.code), QUOTER_DEPLOYS_CODEHASH, "pinned QUOTER is one of the six");
        // PM-bound ctor: the quoter must reference the fork PoolManager, never a canonical address.
        assertTrue(POOL_MANAGER.code.length > 0, "fork PoolManager missing");
    }

    /// @notice The real SPY/USDG poolId re-derives EXACTLY to the §S0.3 pin from live Initialize.
    function test_real_spy_book_poolId_matches_s03_pin() public view {
        assertEq(_poolId(SPY_USDG_REAL), SPY_USDG_REAL_POOL_ID, "real SPY/USDG poolId drifted from S0.3 pin");
        assertEq(_poolId(SPY_USDG_WRONG_20260904), SPY_USDG_WRONG_20260904_POOL_ID, "wrong-key poolId pin drifted");
    }

    // ------------------------------------------------------------------
    // The REAL book quotes cleanly through the pinned Quoter
    // ------------------------------------------------------------------

    /// @notice Fork semantics re-proven live: positive amountSpecified = EXACT OUTPUT, and the
    ///         specified amount is echoed back on the specified side (for zeroForOne=false the
    ///         specified/output currency is currency0 → amount0 == amountSpecified exactly,
    ///         amount1 < 0 = the paid leg). Probed live 2026-09-06 at 1e18 (clean fill).
    function test_real_spy_book_quotes_exactOutput_semantics() public view {
        SwapParams memory p = SwapParams({zeroForOne: false, amountSpecified: 1e15, sqrtPriceLimitX96: MAX_SQRT_MINUS_1});
        (int256 amount0, int256 amount1, uint160 sqrtAfter,) = _quoter().quoteSingle(SPY_USDG_REAL, p);
        assertEq(amount0, int256(1e15), "exact-output echo on the specified side (currency0)");
        assertTrue(amount1 < 0, "the unspecified leg must be the negative PAID amount");
        assertTrue(sqrtAfter > MIN_SQRT_PLUS_1 && sqrtAfter < MAX_SQRT_MINUS_1, "post-swap price in bounds");
    }

    /// @notice Cap rule (structural): if the swap reached its price limit, the requested exact
    ///         output was NOT fully delivered (the loop stops at the limit). Observed live
    ///         2026-09-06: (true, 1e18) on the thin SPY/USDG book landed sqrtAfter == MIN+1
    ///         with a partial fill. Either mode is valid; the CAP is what must hold.
    function test_real_spy_book_zeroForOne_respects_price_limit_cap() public view {
        SwapParams memory p = SwapParams({zeroForOne: true, amountSpecified: 1e18, sqrtPriceLimitX96: MIN_SQRT_PLUS_1});
        (, int256 amount1, uint160 sqrtAfter,) = _quoter().quoteSingle(SPY_USDG_REAL, p);
        assertTrue(amount1 > 0, "positive amountSpecified = output leg must be positive");
        if (sqrtAfter == MIN_SQRT_PLUS_1) {
            assertTrue(amount1 < int256(1e18), "limit reached => fill must be capped below the request");
        }
    }

    /// @notice The real book is INITIALIZED (nonzero slot0) — the discriminator pair against
    ///         the all-zero wrong-key read below.
    function test_stateview_real_spy_book_is_initialized() public view {
        (uint160 sqrtP, , , ) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_REAL_POOL_ID);
        assertTrue(sqrtP != 0, "real SPY/USDG book must be initialized (nonzero sqrtPriceX96)");
    }

    // ------------------------------------------------------------------
    // ROOT CAUSE of the 2026-09-04 SPY-book revert 0x00bfc921
    // ------------------------------------------------------------------

    /// @notice THE 2026-09-04 REPRO: the Merkl-labeled fee-500/ts-80 SPY key reverts
    ///         `InvalidPrice()` (0x00bfc921) at every amount/direction — because NO pool
    ///         exists under that key: StateView getSlot0 is ALL ZERO (proven first), so the
    ///         Quoter's state read yields current sqrtPrice = 0 and getAmount0Delta fires
    ///         its zero-price guard. Wrong key, not a pool quirk.
    function test_wrong_key_20260904_spy_probe_reverts_invalidPrice() public {
        (uint160 sqrtP, int24 tick, uint24 protocolFee, uint24 lpFee) =
            IStateView(STATE_VIEW).getSlot0(SPY_USDG_WRONG_20260904_POOL_ID);
        assertEq(sqrtP, 0, "the 2026-09-04 probe key matches NO initialized pool (sqrtP == 0)");
        assertEq(uint256(int256(tick)), 0, "tick == 0 for a nonexistent pool");
        assertEq(uint256(protocolFee), 0, "protocolFee == 0 for a nonexistent pool");
        assertEq(uint256(lpFee), 0, "lpFee == 0 for a nonexistent pool");

        SwapParams memory z4o = SwapParams({zeroForOne: true, amountSpecified: 1e18, sqrtPriceLimitX96: MIN_SQRT_PLUS_1});
        vm.expectRevert(INVALID_PRICE_SELECTOR);
        _quoter().quoteSingle(SPY_USDG_WRONG_20260904, z4o);

        SwapParams memory o4z =
            SwapParams({zeroForOne: false, amountSpecified: 1e18, sqrtPriceLimitX96: MAX_SQRT_MINUS_1});
        vm.expectRevert(INVALID_PRICE_SELECTOR);
        _quoter().quoteSingle(SPY_USDG_WRONG_20260904, o4z);
    }

    /// @notice Second discriminator: a synthetic key with no on-chain pool reverts the SAME
    ///         selector — the revert is the generic nonexistent-pool signature, not something
    ///         specific to the SPY token or the 500/80 parameters.
    function test_synthetic_nonexistent_key_reverts_invalidPrice() public {
        SwapParams memory z4o = SwapParams({zeroForOne: true, amountSpecified: 1e6, sqrtPriceLimitX96: MIN_SQRT_PLUS_1});
        vm.expectRevert(INVALID_PRICE_SELECTOR);
        _quoter().quoteSingle(SPY_USDG_SYNTHETIC, z4o);
    }
}
