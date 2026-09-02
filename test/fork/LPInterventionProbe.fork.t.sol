// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {console2} from "forge-std/console2.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @dev Minimal surfaces for the live-chain measurements (Uniswap V3 stack).
interface IUniswapV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
    function slot0()
        external
        view
        returns (
            uint160 sqrtPriceX96,
            int24 tick,
            uint16 observationIndex,
            uint16 observationCardinality,
            uint16 observationCardinalityNext,
            uint8 feeProtocol,
            bool unlocked
        );
    function liquidity() external view returns (uint128);
}

interface IERC20Like {
    function balanceOf(address who) external view returns (uint256);
}

interface IQuoterV2Probe {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @notice LP INTERVENTION MEASUREMENT PROBE (phase-0, GO/NO-GO Decision E input;
///         registered in SPEC §J) — per-range measured capture on the LIVE
///         Robinhood Chain (4663) SPY/WETH tier-500 pool, latest state only
///         (the public RPC serves no archive state, so a pinned-block fork is
///         unimplementable keylessly — the fork is taken at LATEST, same as the
///         mirrored fork suites).
///
///         Measures, for the 12-candidate grid {0.5%, 1% of pool TVL} × {full-range,
///         five measured bands of half-widths 10..50 × tickSpacing(10)}:
///           (a) the candidate position's liquidity L_pos and its fee-capture share
///               L_pos/L_pool (LIQUIDITY share, never TVL share);
///           (b) harvest-swap price impact: QuoterV2 quotes over the PINNED grid
///               {12.5%, 25%, 50%, 100%} of the candidate seed's WETH leg, impact in
///               bps vs slot0, and whether the Harvester's SWAP_SLIPPAGE_BPS=100
///               headroom holds (a REPORTED finding, never a hard assert);
///           (c) per-range impermanent loss under ±5% and ±20% SPY/WETH moves
///               (quantifies the G(ii-b) treasury-capital disclosure per range).
///
///         EVIDENCE MECHANISM: this probe EMITS its measured numbers (console2.log
///         `LPI|...` lines + the LpiMeasured event). The worker captures the forge
///         output and writes docs/ops/phase0/lp-intervention.md. The test NEVER calls
///         vm.writeFile (forge's default fs_permissions denies writes and /docs/ops/
///         is gitignored — a test-side write would revert in CI).
///
///         CI-FACING ASSERTIONS ARE STRUCTURAL ONLY (chainid 4663, pool identity,
///         share > 0 on every candidate, share ∈ (0,1] on the full-range candidates,
///         impact > 0 at the largest quoted size). The SWAP_SLIPPAGE_BPS=100 headroom
///         is a FINDING reported in the emitted output — a live-measurement assert
///         would be a flaky-CI bomb.
///
///         Numeric conventions: prices are 1e18-scaled (SPY-wei per WETH-wei, i.e.
///         p*1e18); sqrt prices are 1e9-scaled (sqrt(p*1e18)); every ratio goes through
///         Math.mulDiv (no raw x*1e18 multiplications). Disclosed approximations:
///         integer fixed-point math (no floats), tick bounds rounded to usable
///         tickSpacing multiples, and the IL valuation treats the candidate as the only
///         mover of its own curve (small-position assumption — fine for a 0.5-1% seed).
///
///         SKIPPED by default (same pattern as the mirrored fork suites): set
///         WELLSTREET_ROBINHOOD_RPC_URL to run, e.g.:
///           WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
///             forge test --match-contract LPInterventionProbe -vvv
///         Zero broadcast, zero spend — the fork only READS real state and simulates
///         quotes; every state change lives in the local fork and is discarded.
contract LPInterventionProbeTest is Test {
    // Duplicated constants (the passing fork suites are NEVER edited — new plumbing
    // mirrors them). Verified addresses: docs/ops/phase0/ evidence trail.
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant SPY_WETH_POOL_500 = 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    uint24 constant TIER_500 = 500;
    // Full range for the tier-500 pool (tickSpacing 10): nearestUsableTick of
    // MIN_TICK/MAX_TICK (-887272/887272).
    int24 constant FULL_RANGE_LOWER = -887270;
    int24 constant FULL_RANGE_UPPER = 887270;
    // 1.0001 and 1/1.0001, 1e18-scaled (the tick math base).
    uint256 constant TICK_UNIT_UP = 1_0001e14;
    uint256 constant TICK_UNIT_DOWN = 9_999e14; // 0.9999e18 (≈1/1.0001; compounding error ≤0.01% at full range)

    // Pinned quote grid (SPEC §J / DEEP_DIVE:141): fractions of the candidate seed's
    // WETH leg quoted through QuoterV2.
    uint256[4] QUOTE_GRID = [1250, 2500, 5000, 10_000]; // bps of the WETH leg
    // Pinned candidate seeds (fraction of pool TVL, bps).
    uint256[2] SEEDS_BPS = [50, 100]; // 0.5% / 1%
    // Pinned band half-widths, in units of tickSpacing (the goal grid {10..50} × tickSpacing).
    int256[5] BAND_UNITS = [int256(10), int256(20), int256(30), int256(40), int256(50)]; // tickSpacing multipliers
    // Pinned IL move factors (bps of the spot price): +5% / −5% / +20% / −20%.
    uint256[4] IL_MOVES_BPS = [10_500, 9_500, 12_000, 8_000];

    event LpiMeasured(
        string label, uint256 lPos, uint256 share1e18, int256 il5UpBps, int256 il5DownBps, int256 il20UpBps, int256 il20DownBps
    );

    struct PoolState {
        uint256 p0;
        int24 tick0;
        uint256 lPool;
        uint256 tvlWei;
        int24 spacing;
    }

    function _rpc() internal view returns (string memory) {
        return vm.envOr("WELLSTREET_ROBINHOOD_RPC_URL", string(""));
    }

    // ---- fixed-point helpers ---------------------------------------------------

    function _price1e18(uint160 sqrtPriceX96) internal pure returns (uint256) {
        // P = (sqrtPriceX96 / 2^96)^2, scaled 1e18.
        return Math.mulDiv(Math.mulDiv(sqrtPriceX96, sqrtPriceX96, 1), 1e18, 2 ** 192);
    }

    function _sqrtFixed(uint256 x1e18) internal pure returns (uint256) {
        // sqrt of a 1e18-scaled value, returned 1e9-scaled: sqrt(x*1e18) = sqrt(x)*1e9.
        return Math.sqrt(x1e18);
    }

    function _powUp(uint256 exp) internal pure returns (uint256) {
        // 1.0001^exp, 1e18-scaled (binary exponentiation through mulDiv).
        uint256 r = 1e18;
        uint256 b = TICK_UNIT_UP;
        while (exp > 0) {
            if (exp & 1 == 1) r = Math.mulDiv(r, b, 1e18);
            b = Math.mulDiv(b, b, 1e18);
            exp >>= 1;
        }
        return r;
    }

    function _powDown(uint256 exp) internal pure returns (uint256) {
        // 1.0001^(−exp), 1e18-scaled.
        uint256 r = 1e18;
        uint256 b = TICK_UNIT_DOWN;
        while (exp > 0) {
            if (exp & 1 == 1) r = Math.mulDiv(r, b, 1e18);
            b = Math.mulDiv(b, b, 1e18);
            exp >>= 1;
        }
        return r;
    }

    function _floorToSpacing(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 compressed = tick / spacing;
        if (tick % spacing != 0 && tick < 0) compressed -= 1;
        return compressed * spacing;
    }

    function _ceilToSpacing(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 floored = _floorToSpacing(tick, spacing);
        if (floored < tick) floored += spacing;
        return floored;
    }

    /// @dev tick of a 1e18-scaled price: ln(p)/ln(1.0001) via a fixed-point log2
    ///     (bit-normalized integer part + 60 squaring steps of fraction), then
    ///     log2 × ln(2)/ln(1.0001). ln(2)/ln(1.0001) = 6931.8218 (scaled 1e6: 6931822).
    function _tickOfP(uint256 p1e18) internal pure returns (int24) {
        uint256 lg = _log218(p1e18); // 1e18-scaled log2
        int256 tickScaled = int256(Math.mulDiv(lg, 6_931_822, 1e12)); // tick × 1e6
        return int24(int128(tickScaled / 1e6));
    }

    function _log218(uint256 x1e18) internal pure returns (uint256) {
        // fixed-point log2 (1e18 scale) for x >= 1e18. Standard normalize-and-square.
        uint256 z = x1e18;
        uint256 ip = 0;
        while (z >= 2e18) {
            z = z / 2;
            ip += 1;
        }
        // z ∈ [1e18, 2e18)
        uint256 acc = ip * 1e18;
        uint256 w = 5e17; // weight 1/2, halving each iteration
        for (uint256 i = 0; i < 60; i++) {
            z = Math.mulDiv(z, z, 1e18);
            if (z >= 2e18) {
                z = z / 2;
                acc += w;
            }
            w = w / 2;
        }
        return acc;
    }

    /// @dev Per-unit-liquidity WETH-wei value coefficient at price p (1e18-scaled) for
    ///     a position spanning [spl, spu] (1e9-scaled sqrt prices). Returns B18 with
    ///     valueWethWei = L × B18 / 1e18. Handles all three price regimes.
    function _valueCoeffAt(uint256 p1e18, uint256 spl, uint256 spu) internal pure returns (uint256) {
        uint256 sp = _sqrtFixed(p1e18); // 1e9-scaled
        if (sp <= spl) {
            // at/below the range: all token0 (WETH): L*(1/sqrt(pl) - 1/sqrt(pu))
            // = L * 1e9*(spu - spl)/(spl*spu)  [spl > 0 in any reachable state]
            return Math.mulDiv(1e9 * (spu - spl), 1e18, spl * spu);
        }
        if (sp >= spu) {
            // at/above the range: all token1 (SPY): value = amt1/p, amt1 = L*(sqrt(pu)-sqrt(pl))
            // per L: (spu-spl)/1e9 SPY-wei -> *1e18/p1e18 WETH-wei -> (spu-spl)*1e9/p1e18
            return Math.mulDiv((spu - spl) * 1e9, 1e18, p1e18);
        }
        // in range (per unit L, 1e18-scaled WETH-wei coefficients):
        //   amt0   = 1e9*(spu - sp)/(sp*spu)
        //   amt1/p = (sp - spl)*1e9/p1e18        [p1e18 == sp*sp/1e18]
        uint256 t0 = Math.mulDiv(1e9 * (spu - sp), 1e18, sp * spu);
        uint256 t1 = Math.mulDiv((sp - spl) * 1e9, 1e18, p1e18);
        return t0 + t1;
    }

    /// @dev WETH-wei amount0 per unit L at price p (1e18-scaled coefficient) — the
    ///     candidate seed's WETH leg fraction.
    function _amount0Coeff(uint256 p1e18, uint256 spl, uint256 spu) internal pure returns (uint256) {
        uint256 sp = _sqrtFixed(p1e18);
        if (sp <= spl) return 1e18; // degenerate edge: all-WETH
        if (sp >= spu) return 0;
        return Math.mulDiv(1e9 * (spu - sp), 1e18, sp * spu);
    }

    /// @dev SPY-wei amount1 per unit L at price p (1e18-scaled coefficient).
    function _amount1Coeff(uint256 p1e18, uint256 spl, uint256 spu) internal pure returns (uint256) {
        uint256 sp = _sqrtFixed(p1e18);
        if (sp <= spl) return 0;
        if (sp >= spu) return (spu - spl) * 1e9;
        return (sp - spl) * 1e9;
    }

    /// @dev Impermanent loss in bps (negative for a loss) of moving from p0 to p1:
    ///     IL = V_pos(p1)/V_hold(p1) − 1, where V_hold revalues the p0 token split at p1.
    function _ilBps(uint256 lPos, uint256 spl, uint256 spu, uint256 p0, uint256 p1) internal pure returns (int256) {
        uint256 vPos = Math.mulDiv(lPos, _valueCoeffAt(p1, spl, spu), 1e18);
        uint256 a0 = Math.mulDiv(lPos, _amount0Coeff(p0, spl, spu), 1e18);
        uint256 a1 = Math.mulDiv(lPos, _amount1Coeff(p0, spl, spu), 1e18);
        uint256 vHold = a0 + Math.mulDiv(a1, 1e18, p1);
        if (vHold == 0) return 0;
        if (vPos >= vHold) return int256(Math.mulDiv(vPos - vHold, 10_000, vHold));
        return -int256(Math.mulDiv(vHold - vPos, 10_000, vHold));
    }

    function setUp() public {
        string memory rpc = _rpc();
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc); // LATEST — no archive state exists keylessly
    }

    function test_lpInterventionProbe_measuredCapture() public {
        if (bytes(_rpc()).length == 0) return; // skipped via setUp

        // ---- structural identity (the only CI-facing asserts) ------------------
        assertEq(block.chainid, 4663);
        IUniswapV3PoolLike pool = IUniswapV3PoolLike(SPY_WETH_POOL_500);
        assertEq(pool.token0(), WETH);
        assertEq(pool.token1(), SPY);
        assertEq(pool.fee(), TIER_500);
        int24 spacing = pool.tickSpacing();
        assertEq(spacing, 10);

        (uint160 sqrtP, int24 tick0,,, , , ) = pool.slot0();
        PoolState memory st;
        st.p0 = _price1e18(sqrtP);
        st.tick0 = tick0;
        st.lPool = pool.liquidity();
        uint256 bal0 = IERC20Like(WETH).balanceOf(SPY_WETH_POOL_500);
        uint256 bal1 = IERC20Like(SPY).balanceOf(SPY_WETH_POOL_500);
        // Probe-time TVL basis (balances at the live slot0 price) — the seed unit.
        st.tvlWei = bal0 + Math.mulDiv(bal1, 1e18, st.p0);
        st.spacing = spacing;

        console2.log("LPI|pool=0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e|tier=500");
        console2.log("LPI|spotP1e18", st.p0);
        console2.log("LPI|tick0", uint256(int256(st.tick0)));
        console2.log("LPI|L_pool", st.lPool);
        console2.log("LPI|balWethWei", bal0);
        console2.log("LPI|balSpyWei", bal1);
        console2.log("LPI|tvlWethWei", st.tvlWei);
        console2.log("LPI|tickSpacing", uint256(int256(st.spacing)));

        _runGrid(st);
    }

    function _runGrid(PoolState memory st) internal {
        for (uint256 s = 0; s < SEEDS_BPS.length; s++) {
            uint256 seedBps = SEEDS_BPS[s];
            uint256 seedWei = Math.mulDiv(st.tvlWei, seedBps, 10_000);

            // ---- full-range candidate ------------------------------------------
            _measureCandidate("full-range", seedBps, seedWei, st, FULL_RANGE_LOWER, FULL_RANGE_UPPER);

            // ---- five measured-band candidates: half-width = units × tickSpacing
            for (uint256 b = 0; b < BAND_UNITS.length; b++) {
                int24 half = int24(int256(BAND_UNITS[b])) * st.spacing;
                int24 tl = _floorToSpacing(st.tick0 - half, st.spacing);
                int24 tu = _ceilToSpacing(st.tick0 + half, st.spacing);
                _measureCandidate(
                    string.concat("band+", _u2s(uint256(BAND_UNITS[b])), "x10"),
                    seedBps, seedWei, st, tl, tu
                );
            }
        }
    }

    /// @dev Range sqrt-price bounds (1e9-scaled) from ROUNDED tick deltas:
    ///     pl = p0*1.0001^(tl-tick0), pu = p0*1.0001^(tu-tick0); spl/spl = sqrt of those.
    function _bounds(PoolState memory st, int24 tl, int24 tu) internal pure returns (uint256 spl, uint256 spu) {
        int24 tick0 = st.tick0;
        uint256 up = tu > tick0 ? uint256(int256(tu - tick0)) : 0;
        uint256 down = tick0 > tl ? uint256(int256(tick0 - tl)) : 0;
        uint256 pl = Math.mulDiv(st.p0, _powDown(down), 1e18);
        uint256 pu = Math.mulDiv(st.p0, _powUp(up), 1e18);
        spl = _sqrtFixed(pl); // 1e9-scaled (0 is legitimate for the full range)
        spu = _sqrtFixed(pu);
    }

    function _measureCandidate(
        string memory label,
        uint256 seedBps,
        uint256 seedWei,
        PoolState memory st,
        int24 tl,
        int24 tu
    ) internal {
        // Band price bounds from the ROUNDED tick deltas (exact, no log round-trip):
        // pl = p0 * 1.0001^(tl - tick0), pu = p0 * 1.0001^(tu - tick0).
        (uint256 spl, uint256 spu) = _bounds(st, tl, tu);

        // Position liquidity from the seed capital (in-range at p0, disclosed):
        // seedWei = L * B18(p0) / 1e18  =>  L = seedWei * 1e18 / B18.
        uint256 b18 = _valueCoeffAt(st.p0, spl, spu);
        if (b18 == 0) {
            console2.log(string.concat("LPI|SKIP|degenerate-range|seedBps=", _u2s(seedBps), "|range=", label));
            return;
        }
        uint256 lPos = Math.mulDiv(seedWei, 1e18, b18);
        _emitCandidate(label, seedBps, seedWei, tl, tu, lPos, spl, spu, st);
    }

    function _ilQuad(uint256 lPos, uint256 spl, uint256 spu, uint256 p0)
        internal
        view
        returns (int256[4] memory il)
    {
        il[0] = _ilBps(lPos, spl, spu, p0, Math.mulDiv(p0, IL_MOVES_BPS[0], 10_000));
        il[1] = _ilBps(lPos, spl, spu, p0, Math.mulDiv(p0, IL_MOVES_BPS[1], 10_000));
        il[2] = _ilBps(lPos, spl, spu, p0, Math.mulDiv(p0, IL_MOVES_BPS[2], 10_000));
        il[3] = _ilBps(lPos, spl, spu, p0, Math.mulDiv(p0, IL_MOVES_BPS[3], 10_000));
    }

    function _emitCandidate(
        string memory label,
        uint256 seedBps,
        uint256 seedWei,
        int24 tl,
        int24 tu,
        uint256 lPos,
        uint256 spl,
        uint256 spu,
        PoolState memory st
    ) internal {
        uint256 p0 = st.p0;
        uint256 share18 = Math.mulDiv(lPos, 1e18, st.lPool);

        // STRUCTURAL asserts (CI-safe): share strictly positive everywhere; a <=1%-of-TVL
        // full-range seed can never exceed the pool's in-range liquidity.
        assertGt(lPos, 0, "zero candidate liquidity");
        assertGt(share18, 0, "zero liquidity share");
        if (bytes(label)[0] == bytes1("f")) {
            assertLe(share18, 1e18, "full-range seed exceeds pool in-range liquidity (structural anomaly)");
        }

        // WETH leg of the candidate seed (what the harvest-swap quotes size against)
        uint256 wethLeg = Math.mulDiv(lPos, _amount0Coeff(p0, spl, spu), 1e18);

        int256[4] memory il = _ilQuad(lPos, spl, spu, p0);

        emit LpiMeasured(label, lPos, share18, il[0], il[1], il[2], il[3]);
        console2.log(_candLine(label, seedBps, seedWei, tl, tu, lPos, share18, wethLeg, il));
        _quoteGrid(label, seedBps, wethLeg, p0);
    }

    function _candLine(
        string memory label,
        uint256 seedBps,
        uint256 seedWei,
        int24 tl,
        int24 tu,
        uint256 lPos,
        uint256 share18,
        uint256 wethLeg,
        int256[4] memory il
    ) internal pure returns (string memory) {
        return string.concat(
            "LPI|cand|seedBps=", _u2s(seedBps), "|range=", label,
            "|tl=", _i2s(tl), "|tu=", _i2s(tu),
            "|seedWethWei=", _u2s(seedWei),
            "|wethLegWei=", _u2s(wethLeg),
            "|L_pos=", _u2s(lPos),
            "|L_pos_over_L_pool_1e18=", _u2s(share18),
            "|IL+5%_bps=", _i2s(il[0]), "|IL-5%_bps=", _i2s(il[1]),
            "|IL+20%_bps=", _i2s(il[2]), "|IL-20%_bps=", _i2s(il[3])
        );
    }

    /// @dev Harvest-swap price impact over the PINNED quote grid: QuoterV2 quotes at
    ///     {12.5%, 25%, 50%, 100%} of the candidate's WETH leg; impact in bps vs spot;
    ///     the SWAP_SLIPPAGE_BPS=100 headroom is a REPORTED finding, never an assert.
    function _quoteGrid(string memory label, uint256 seedBps, uint256 wethLeg, uint256 p0) internal {
        for (uint256 q = 0; q < QUOTE_GRID.length; q++) {
            uint256 amountIn = Math.mulDiv(wethLeg, QUOTE_GRID[q], 10_000);
            if (amountIn == 0) {
                console2.log(
                    string.concat("LPI|impact|seedBps=", _u2s(seedBps), "|range=", label, "|fracBps=", _u2s(QUOTE_GRID[q]), "|SKIP zero amountIn")
                );
                continue;
            }
            (uint256 out, , , ) = IQuoterV2Probe(QUOTER_V2).quoteExactInputSingle(
                IQuoterV2Probe.QuoteExactInputSingleParams({
                    tokenIn: WETH,
                    tokenOut: SPY,
                    amountIn: amountIn,
                    fee: TIER_500,
                    sqrtPriceLimitX96: 0
                })
            );
            // Executed price (SPY per WETH, 1e18) vs spot: buying SPY pushes the price
            // up, so exec <= spot; impact in bps = (spot - exec) * 1e4 / spot.
            uint256 exec = Math.mulDiv(out, 1e18, amountIn);
            uint256 impactBps = exec < p0 ? Math.mulDiv(p0 - exec, 10_000, p0) : 0;
            bool headroomOk = impactBps <= 100; // Harvester.sol SWAP_SLIPPAGE_BPS = 100
            if (q == QUOTE_GRID.length - 1) {
                assertGt(impactBps, 0, "zero measured impact at the largest quoted size");
            }
            console2.log(
                string.concat(
                    "LPI|impact|seedBps=", _u2s(seedBps), "|range=", label,
                    "|fracBps=", _u2s(QUOTE_GRID[q]),
                    "|amountInWei=", _u2s(amountIn),
                    "|quotedOutWei=", _u2s(out),
                    "|impact_bps=", _u2s(impactBps),
                    "|SWAP_SLIPPAGE_BPS=100_headroom=", headroomOk ? "OK" : "EXCEEDED"
                )
            );
        }
    }

    function _u2s(uint256 v) internal pure returns (string memory) {
        return vm.toString(v);
    }

    function _i2s(int256 v) internal pure returns (string memory) {
        return vm.toString(v);
    }
}
