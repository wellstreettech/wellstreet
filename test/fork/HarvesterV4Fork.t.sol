// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {YieldShares} from "../../src/YieldShares.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {HarvesterV4, IPoolManagerV4, ISwapRouter02V4, IQuoterV2Path} from "../../src/HarvesterV4.sol";
import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";

/// @dev Fork-stack StateView (canonical v4-periphery lens, ctor-arg-bound to OUR
///      PoolManager — GOAL §S0.5).
interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);

    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);

    function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        external
        view
        returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128);
}

/// @dev The one extra PoolManager surface the TEST needs (the harvester itself never
///      donates — donation is a fork-test accrual device, GOAL §S0.7).
interface IPM4Donate {
    function donate(
        IPoolManagerV4.PoolKey calldata key,
        uint256 amount0,
        uint256 amount1,
        bytes calldata hookData
    ) external;
}

/// @dev ERC-20 metadata (decimals for human-unit test funding amounts).
interface IERC20MetadataLite {
    function decimals() external view returns (uint8);
}

/// @dev A quoter mock that returns an ABSURDLY inflated quote — used to force the
///      harvest's swap leg into a too-tight minOut (T3 fail-closed proof).
contract InflatedQuoteMockV4 {
    function quoteExactInput(bytes calldata, uint256)
        external
        pure
        returns (uint256, uint160[] memory, uint32[] memory, uint256)
    {
        return (1 << 250, new uint160[](0), new uint32[](0), 0);
    }
}

/// @notice WS-V4-HARVESTER fork battery — HarvesterV4 against LIVE Robinhood Chain
///         (4663) state, proving the fork-PoolManager LP loop end-to-end:
///           T1  open a FULL-RANGE position on the live SPY/USDG book through the
///               48h timelock governance rail; position accounting verified through
///               the live StateView (liquidity + position key).
///           T2  fee collection is the pool's OWN accounting: a real donate (local
///               accrual, fork-only) is collected by the zero-delta path at EXACTLY
///               the donate share implied by live liquidity — a static-rate model
///               cannot reproduce that number. The live charged-fee STREAM is probed
///               (per-swap uint24, fork Swap topic0, data word[5]) and every sampled
///               fee must be nonzero; the split math is asserted exactly.
///           T3  the quote→asset swap leg is FAIL-CLOSED: an inflated (stale/corrupt)
///               quote reverts the WHOLE harvest, nothing is stranded, and a
///               subsequent honest harvest re-collects the same fees.
///           T4  the PACK/NVDA (hookless, ts 200) and USDG/ETH (dynamic-fee hook
///               book, ts 10, native-ETH quote leg → wrap) books open/collect/harvest
///               cleanly — the native leg is wrapped at EXACTLY the collected amount.
///           T5  unauthorized actions revert: non-timelock open/close, harvest on no
///               position, a third-party-steered unlockCallback, zero liquidity,
///               foreign vault.harvest() credit (the yield push is harvester-gated),
///               duplicate-asset factory creation, and a non-fork PoolManager pin.
///               NOTE: a successful harvest itself is intentionally PERMISSIONLESS
///               (caller-tip model, same as the v3 Harvester) — anyone may harvest;
///               the caller is paid a 0.1% tip FROM the protocol share, so an
///               unauthorized call cannot take value beyond that tip.
///
///         Fork addresses are the GOAL §STEP-0 pins (verified live 2026-09-04): the
///         custom fork PoolManager (NEVER canonical v4 addresses — on 4663 those are
///         scam drainers), fork BalanceDelta packing amount0 HIGH / amount1 LOW.
///
///         RPC: the keyless public 4663 endpoint from foundry.toml ([rpc_endpoints]
///         alias "robinhood") — override with WELLSTREET_ROBINHOOD_RPC_URL. Zero
///         broadcast, zero spend: every state change below lives in the local fork
///         and is discarded when the test ends.
contract HarvesterV4ForkTest is Test {
    // ------------------------------------------------------------------
    // GOAL §STEP-0 pins (live 4663 fork stack + target books)
    // ------------------------------------------------------------------
    address constant FORK_PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant STATE_VIEW = 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2;
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant PACK = 0x0145AcbcceFbEd6F303C420bEeaaAc72E905430b;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address constant DYNAMIC_HOOK = 0x06a889870C8f83640D6816319f72e2aA579b6080;

    bytes32 constant SPY_USDG_POOL_ID = 0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd;
    bytes32 constant PACK_NVDA_POOL_ID = 0x4900c6d3f31ff1e1545a487469c134cdbd9f1499f938054c0c77a14728b3f150;
    bytes32 constant USDG_ETH_POOL_ID = 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551;

    /// @dev Fork Swap topic0 (matches NEITHER canonical v4 revision — never reuse
    ///      canonical topic hashes); data word[5] = the trailing per-swap uint24 fee.
    bytes32 constant SWAP_TOPIC0 = 0x40e9cecb9f5f1f1c5b9c97dec2917b7ee92e57ba5563708daca94dd84ad7112f;

    uint24 constant FEE_DYNAMIC_FLAG = 0x800000;

    uint256 constant TIMELOCK_DELAY = 48 hours + 1;
    uint256 constant INITIAL_FEE_BPS = 1000; // 10% protocol / 90% depositors

    bytes32 constant HARVESTED_SIG = keccak256(
        "Harvested(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)"
    );

    WellstreetTimelock timelock;
    VaultFactory factory;
    YieldShares vault;
    HarvesterV4 harvester;

    address proposer = makeAddr("wellstreet-deployer");
    address pauser = makeAddr("pause-eoa");
    address executor = makeAddr("permissionless-executor");
    address bob = makeAddr("harvest-caller");

    struct HarvestedEvt {
        address caller;
        uint256 amount0Collected;
        uint256 amount1Collected;
        uint256 swappedOut;
        uint256 proceeds;
        uint256 vaultShare;
        uint256 vaultCredited;
        uint256 tip;
        uint256 accrued;
    }

    // Donate-acrual device state (executed by THIS contract's unlockCallback below).
    uint8 private _donateArmed;
    IPoolManagerV4.PoolKey private _donateKey;
    uint256 private _donate0;
    uint256 private _donate1;

    // ------------------------------------------------------------------
    // Setup
    // ------------------------------------------------------------------

    function _rpc() internal view returns (string memory) {
        return vm.envOr("WELLSTREET_ROBINHOOD_RPC_URL", string("robinhood"));
    }

    function setUp() public {
        vm.createSelectFork(_rpc());

        // Live fork-stack preconditions.
        assertGt(FORK_PM.code.length, 0, "fork PoolManager has no code");
        assertGt(
            IStateView(STATE_VIEW).getLiquidity(SPY_USDG_POOL_ID),
            0,
            "SPY/USDG book is not live"
        );

        // Issuer-gated stock tokens: every fork address in a money path must be
        // unblocked (house pattern, HarvestFork.t.sol).
        _assertUnblockedSpy(address(this));
        _assertUnblockedSpy(bob);
        _assertUnblockedSpy(executor);
        _assertUnblockedSpy(SWAP_ROUTER);
        _assertUnblockedSpy(FORK_PM);
        _assertUnblockedSpy(QUOTER_V2);
    }

    // ------------------------------------------------------------------
    // Helpers — stack deploy / funding / sizing
    // ------------------------------------------------------------------

    function _assertUnblocked(address token, address who) internal view {
        (bool ok, bytes memory ret) = token.staticcall(abi.encodeWithSignature("ACCESS_CONTROLLED_REGISTRY()"));
        if (ok && ret.length == 32) {
            address registry = abi.decode(ret, (address));
            assertFalse(IAccessControlsRegistryless(registry).isBlocked(who), "address is blocked on the token");
        }
        // Tokens without an issuer ACL (USDG, PACK, ...) simply have nothing to check.
    }

    /// @dev Hard variant for the issuer-gated SPY (house pattern: the registry MUST exist).
    function _assertUnblockedSpy(address who) internal view {
        (bool ok, bytes memory ret) = SPY.staticcall(abi.encodeWithSignature("ACCESS_CONTROLLED_REGISTRY()"));
        assertTrue(ok && ret.length == 32, "cannot read SPY ACCESS_CONTROLLED_REGISTRY");
        address registry = abi.decode(ret, (address));
        assertFalse(IAccessControlsRegistryless(registry).isBlocked(who), "address is blocked on SPY");
    }

    function _dec(address token) internal view returns (uint256) {
        return 10 ** IERC20MetadataLite(token).decimals();
    }

    function _v4Config(address assetC, IPoolManagerV4.PoolKey memory key, bytes memory path)
        internal
        view
        returns (VaultFactory.V4Config memory cfg)
    {
        cfg = VaultFactory.V4Config({
            asset: assetC,
            name: "Wellstreet Fork",
            symbol: "ws-FORK",
            poolManager: FORK_PM,
            poolKey: key,
            weth: WETH,
            swapPath: path,
            router: SWAP_ROUTER,
            quoter: QUOTER_V2
        });
    }

    /// @dev Deploy a full vault+harvesterV4 stack through the FACTORY (the deliverable-2
    ///      path) and wire the harvester through the 48h timelock rail (queue -> warp ->
    ///      permissionless execute — the house trust model).
    function _deployStack(address assetC, IPoolManagerV4.PoolKey memory key, bytes memory path)
        internal
        returns (WellstreetTimelock tl, YieldShares v, HarvesterV4 h)
    {
        tl = new WellstreetTimelock(proposer, TIMELOCK_DELAY);
        factory = new VaultFactory(address(tl), pauser, INITIAL_FEE_BPS);
        (address vAddr, address hAddr) = factory.createVaultV4(_v4Config(assetC, key, path));
        v = YieldShares(payable(vAddr));
        h = HarvesterV4(payable(hAddr));

        assertEq(factory.vaultOfAsset(assetC), vAddr, "factory registry missing the vault");
        assertEq(v.harvester(), address(0), "harvester pre-wired (impossible: timelock-only)");

        vm.prank(proposer);
        tl.queue(address(v), 0, abi.encodeCall(YieldShares.setHarvester, (address(h))), bytes32(0));
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        vm.prank(executor);
        tl.execute(address(v), 0, abi.encodeCall(YieldShares.setHarvester, (address(h))), bytes32(0));
        assertEq(v.harvester(), address(h), "harvester not wired");
        _assertUnblocked(assetC, address(tl));
        _assertUnblocked(assetC, vAddr);
        _assertUnblocked(assetC, hAddr);
    }

    /// @dev Real v3 swap through the deployed SwapRouter02 (QuoterV2-derived minOut).
    function _swapV3(address tokenIn, address tokenOut, uint24 feeTier, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        bytes memory path = abi.encodePacked(tokenIn, feeTier, tokenOut);
        (uint256 quoted,,,) = IQuoterV2Path(QUOTER_V2).quoteExactInput(path, amountIn);
        assertGt(quoted, 0, "v3 route quoted zero output");
        IERC20(tokenIn).approve(SWAP_ROUTER, amountIn);
        amountOut = ISwapRouter02V4(SWAP_ROUTER).exactInput(
            ISwapRouter02V4.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: (quoted * 9900) / 10000
            })
        );
    }

    /// @dev Full-range liquidity affordable by BOTH funded legs (10% margin for the
    ///      boundary terms and fixed-point rounding): amount0 ≈ L·2^96/√P,
    ///      amount1 ≈ L·√P/2^96 at live slot0.
    function _affordableLiquidity(uint256 funded0, uint256 funded1, uint160 sqrtP)
        internal
        pure
        returns (uint128 l)
    {
        uint256 l0 = Math.mulDiv(funded0, sqrtP, 1 << 96);
        uint256 l1 = Math.mulDiv(funded1, 1 << 96, sqrtP);
        uint256 min = l0 < l1 ? l0 : l1;
        l = uint128((min * 90) / 100);
    }

    function _estAmounts(uint128 l, uint160 sqrtP) internal pure returns (uint256 a0, uint256 a1) {
        a0 = Math.mulDiv(uint256(l), 1 << 96, sqrtP);
        a1 = Math.mulDiv(uint256(l), sqrtP, 1 << 96);
    }

    // ------------------------------------------------------------------
    // Helpers — donate accrual (fork-only; executed via OUR unlockCallback)
    // ------------------------------------------------------------------

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == FORK_PM, "fork: unlockCallback not from PM");
        if (_donateArmed == 1) {
            IPM4Donate(FORK_PM).donate(_donateKey, _donate0, _donate1, "");
            if (_donate0 > 0) _payC(_donateKey.currency0, _donate0);
            if (_donate1 > 0) _payC(_donateKey.currency1, _donate1);
        }
        return "";
    }

    function _payC(address currency, uint256 amount) internal {
        if (currency == address(0)) {
            IPoolManagerV4(FORK_PM).settle{value: amount}();
        } else {
            IPoolManagerV4(FORK_PM).sync(currency);
            IERC20(currency).transfer(FORK_PM, amount);
            IPoolManagerV4(FORK_PM).settle();
        }
    }

    function _donate(IPoolManagerV4.PoolKey memory key, uint256 a0, uint256 a1) internal {
        _donateArmed = 1;
        _donateKey = key;
        _donate0 = a0;
        _donate1 = a1;
        IPoolManagerV4(FORK_PM).unlock("");
        _donateArmed = 0;
    }

    // ------------------------------------------------------------------
    // Helpers — event decode / live reads
    // ------------------------------------------------------------------

    function _lastHarvestedEvent() internal view returns (HarvestedEvt memory e) {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == HARVESTED_SIG && entries[i].topics.length == 2) {
                uint256[8] memory w = abi.decode(entries[i].data, (uint256[8]));
                e.caller = address(uint160(uint256(entries[i].topics[1])));
                e.amount0Collected = w[0];
                e.amount1Collected = w[1];
                e.swappedOut = w[2];
                e.proceeds = w[3];
                e.vaultShare = w[4];
                e.vaultCredited = w[5];
                e.tip = w[6];
                e.accrued = w[7];
                found = true;
            }
        }
        assertTrue(found, "Harvested event not found");
    }

    function _positionLiquidity(bytes32 poolId, HarvesterV4 h, int24 tickLower, int24 tickUpper)
        internal
        view
        returns (uint128)
    {
        (uint128 liq,,) = IStateView(STATE_VIEW).getPositionInfo(poolId, address(h), tickLower, tickUpper, bytes32(0));
        return liq;
    }

    function _assertSplitMath(HarvestedEvt memory e, YieldShares v, HarvesterV4 h) internal view {
        assertEq(e.proceeds, e.amount0Collected + e.swappedOut, "proceeds != asset leg + swapped quote leg");
        assertEq(v.feeBps(), INITIAL_FEE_BPS, "feeBps drifted");
        assertEq(e.vaultShare, (e.proceeds * (10_000 - INITIAL_FEE_BPS)) / 10_000, "vault share formula broken");
        assertEq(e.vaultCredited, e.vaultShare, "credited != declared share on a clean token");
        assertEq(e.tip, (e.proceeds * 10) / 10_000, "tip != 0.1% of proceeds");
        assertEq(e.accrued, e.proceeds - e.vaultShare - e.tip, "accrual != proceeds - vault - tip");
        assertEq(v.totalAssets(), e.vaultCredited, "totalAssets != credited");
        assertEq(v.totalSupply(), 0, "yield minted shares");
        assertEq(h.protocolAccrued(), e.accrued, "protocolAccrued != accrued");
        assertEq(IERC20(v.asset()).balanceOf(address(h)), e.accrued, "harvester holds != accrued");
        assertEq(IERC20(v.asset()).balanceOf(bob), e.tip, "caller tip not paid");
    }

    /// @dev Probes the LIVE charged-fee stream for a book: per-swap uint24 at Swap
    ///      data word[5] over the trailing 50k blocks. Returns the log count and up
    ///      to 20 sampled fees. This is the yield-model INPUT (a stream, never a
    ///      static rate — GOAL §S0.4).
    function _swapFeeStream(bytes32 poolId) internal view returns (uint256 count, uint24[] memory fees) {
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = SWAP_TOPIC0;
        topics[1] = poolId;
        Vm.EthGetLogs[] memory logs = vm.eth_getLogs(block.number - 50_000, block.number, FORK_PM, topics);
        count = logs.length;
        uint256 n = count < 20 ? count : 20;
        fees = new uint24[](n);
        for (uint256 i = 0; i < n; i++) {
            bytes memory data = logs[i].data;
            assertTrue(data.length >= 192, "fork Swap event data shorter than 6 words");
            uint256 word5;
            for (uint256 j = 0; j < 32; j++) {
                word5 = (word5 << 8) | uint256(uint8(data[160 + j]));
            }
            fees[i] = uint24(word5);
        }
    }

    // ------------------------------------------------------------------
    // T1 — full-range open on the live SPY/USDG book through the timelock
    // ------------------------------------------------------------------

    function testFork_T1_openFullRange_spyUsdg_throughTimelock() public {
        IPoolManagerV4.PoolKey memory key = IPoolManagerV4.PoolKey({
            currency0: SPY,
            currency1: USDG,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes memory path = abi.encodePacked(USDG, uint24(500), SPY);
        (timelock, vault, harvester) = _deployStack(SPY, key, path);

        // Fund: USDG dealt (OZ balances layout — asserted loudly), SPY acquired via a
        // REAL v3 swap (house rule: the issuer-gated stock token is never dealt).
        deal(USDG, address(this), 3000 * _dec(USDG));
        _swapV3(USDG, SPY, 500, 2000 * _dec(USDG));
        IERC20(USDG).transfer(address(harvester), 500 * _dec(USDG));
        IERC20(SPY).transfer(address(harvester), IERC20(SPY).balanceOf(address(this)));

        (uint160 sqrtP, , , ) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);
        uint256 funded0 = IERC20(SPY).balanceOf(address(harvester));
        uint256 funded1 = IERC20(USDG).balanceOf(address(harvester));
        uint128 l = _affordableLiquidity(funded0, funded1, sqrtP);
        assertGt(l, 0, "computed zero affordable liquidity");

        // Full-range pin + poolId pin (fork PoolId derivation, GOAL §S0.2).
        (int24 tickLower, int24 tickUpper) = harvester.fullRangeTicks();
        assertEq(tickLower, -887220, "ts-60 full-range lower tick wrong");
        assertEq(tickUpper, 887220, "ts-60 full-range upper tick wrong");
        assertEq(harvester.poolId(), SPY_USDG_POOL_ID, "in-contract poolId != live documented poolId");

        // Open through the 48h timelock (queue -> warp -> PERMISSIONLESS execute).
        uint128 lTotalBefore = IStateView(STATE_VIEW).getLiquidity(SPY_USDG_POOL_ID);
        vm.prank(proposer);
        timelock.queue(address(harvester), 0, abi.encodeCall(HarvesterV4.openPosition, (l)), bytes32(0));
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        vm.prank(executor);
        timelock.execute(address(harvester), 0, abi.encodeCall(HarvesterV4.openPosition, (l)), bytes32(0));

        // The pool's TOTAL live liquidity must have grown by exactly our mint.
        assertEq(
            uint256(IStateView(STATE_VIEW).getLiquidity(SPY_USDG_POOL_ID)),
            uint256(lTotalBefore) + uint256(l),
            "pool total liquidity did not grow by our mint"
        );

        assertTrue(harvester.hasPosition(), "position not open");
        assertEq(harvester.positionLiquidity(), l, "positionLiquidity != opened liquidity");
        assertEq(
            _positionLiquidity(SPY_USDG_POOL_ID, harvester, tickLower, tickUpper),
            l,
            "StateView position liquidity != opened liquidity"
        );
        // The principal left the harvester into the pool (whatever the pool's own math
        // required — never a hardcoded ratio): the full-range estimates for the chosen
        // liquidity were affordable by the funded legs (the sizing helper's contract —
        // a too-small funding would have reverted the open atomically instead).
        (uint256 estA0, uint256 estA1) = _estAmounts(l, sqrtP);
        assertLe(estA0, funded0, "asset-leg estimate exceeded funding");
        assertLe(estA1, funded1, "quote-leg estimate exceeded funding");
    }

    // ------------------------------------------------------------------
    // T2 — collect = the pool's own accounting (donate share, never a rate)
    // ------------------------------------------------------------------

    function testFork_T2_collectMatchesPoolAccounting_notAStaticRate() public {
        IPoolManagerV4.PoolKey memory key = IPoolManagerV4.PoolKey({
            currency0: SPY,
            currency1: USDG,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes memory path = abi.encodePacked(USDG, uint24(500), SPY);
        (timelock, vault, harvester) = _deployStack(SPY, key, path);

        deal(USDG, address(this), 3000 * _dec(USDG));
        _swapV3(USDG, SPY, 500, 2000 * _dec(USDG));
        IERC20(USDG).transfer(address(harvester), 500 * _dec(USDG));
        IERC20(SPY).transfer(address(harvester), IERC20(SPY).balanceOf(address(this)));

        (uint160 sqrtP, , , ) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);
        uint128 l = _affordableLiquidity(
            IERC20(SPY).balanceOf(address(harvester)), IERC20(USDG).balanceOf(address(harvester)), sqrtP
        );

        // The charged-fee STREAM on this book: every sampled per-swap fee must be
        // nonzero (this is the stream a yield model MUST replay — GOAL §S0.4).
        (uint256 swapCount, uint24[] memory fees) = _swapFeeStream(SPY_USDG_POOL_ID);
        assertGt(swapCount, 0, "no swaps observed on the flagship book (expected active)");
        for (uint256 i = 0; i < fees.length; i++) {
            assertGt(uint256(fees[i]), 0, "zero charged fee sampled (book pays LPs nothing)");
        }

        vm.prank(address(timelock));
        harvester.openPosition(l);
        // The open left over funded principal it did not need (the pool's own math
        // dictates the exact principal) — sweep it to the treasury BEFORE harvesting
        // (the force-sent-token pattern: donations/overfunding are forwarded
        // UNSWAPPED, never dumped into the pool and never counted as yield).
        harvester.sweepToTreasury();
        uint128 lTotal = IStateView(STATE_VIEW).getLiquidity(SPY_USDG_POOL_ID);

        // Zero-accrual collect BEFORE any donate: the pool's accounting owes nothing
        // (no swaps occur on a static fork), so the harvest must produce (0, 0) —
        // proof the harvester invents NO income from any rate constant.
        vm.recordLogs();
        vm.prank(bob);
        harvester.harvest();
        HarvestedEvt memory e0 = _lastHarvestedEvent();
        assertEq(e0.amount0Collected, 0, "fabricated asset-leg income on a zero-fee position");
        assertEq(e0.amount1Collected, 0, "fabricated quote-leg income on a zero-fee position");
        assertEq(e0.proceeds, 0, "fabricated proceeds");
        assertEq(vault.totalAssets(), 0, "vault credited on a zero-fee position");

        // REAL accrual: donate (fork-only) on the quote leg. The expected share is the
        // pool's OWN proportional accounting: donated * L_ours / L_total.
        uint256 donated = 50 * _dec(USDG);
        _donate(key, 0, donated);
        uint256 expected1 = Math.mulDiv(donated, l, lTotal);
        assertGt(expected1, 0, "donate share rounds to zero");

        // minOut basis: quote the harvester's own swap path for the expected leg.
        (uint256 quoted,,,) = IQuoterV2Path(QUOTER_V2).quoteExactInput(path, expected1);

        vm.recordLogs();
        vm.prank(bob);
        harvester.harvest();
        HarvestedEvt memory e1 = _lastHarvestedEvent();

        // The collected amount IS the pool-accounting share — a static-rate model
        // (fee_label x volume) cannot reproduce an exact donate share.
        assertEq(e1.amount0Collected, 0, "unexpected asset leg (donation was quote-leg only)");
        assertApproxEqRel(e1.amount1Collected, expected1, 0.01e18, "collected != donate share (pool accounting)");
        // Swap leg: the router paid within quote − 2×slippage-band of the pre-quote.
        assertLe(e1.swappedOut, (quoted * 10100) / 10000, "swappedOut above the quote (impossible)");
        assertGe(e1.swappedOut, (quoted * 9700) / 10000, "swappedOut far below the fresh quote");
        // Exact split math (house pattern).
        _assertSplitMath(e1, vault, harvester);
        // Principal untouched by harvest (there is no decrease path at all).
        assertEq(harvester.positionLiquidity(), l, "position liquidity changed at harvest");
    }

    // ------------------------------------------------------------------
    // T3 — the swap leg is fail-closed: a corrupt quote reverts the WHOLE harvest
    // ------------------------------------------------------------------

    function testFork_T3_swapLegFailClosed_nothingStranded() public {
        IPoolManagerV4.PoolKey memory key = IPoolManagerV4.PoolKey({
            currency0: SPY,
            currency1: USDG,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes memory path = abi.encodePacked(USDG, uint24(500), SPY);
        (timelock, vault, harvester) = _deployStack(SPY, key, path);

        deal(USDG, address(this), 3000 * _dec(USDG));
        _swapV3(USDG, SPY, 500, 2000 * _dec(USDG));
        IERC20(USDG).transfer(address(harvester), 500 * _dec(USDG));
        IERC20(SPY).transfer(address(harvester), IERC20(SPY).balanceOf(address(this)));

        (uint160 sqrtP, , , ) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);
        uint128 l = _affordableLiquidity(
            IERC20(SPY).balanceOf(address(harvester)), IERC20(USDG).balanceOf(address(harvester)), sqrtP
        );
        vm.prank(address(timelock));
        harvester.openPosition(l);
        harvester.sweepToTreasury(); // clear the open's leftover principal (see T2)

        uint256 donated = 50 * _dec(USDG);
        _donate(key, 0, donated);

        (uint128 liqPre, uint256 fg0Pre, uint256 fg1Pre) =
            IStateView(STATE_VIEW).getPositionInfo(SPY_USDG_POOL_ID, address(harvester), -887220, 887220, bytes32(0));

        // Corrupt the oracle: an absurdly inflated quote → an unreachable minOut.
        bytes memory honestQuoterCode = QUOTER_V2.code;
        vm.etch(QUOTER_V2, address(new InflatedQuoteMockV4()).code);
        vm.prank(bob);
        vm.expectRevert();
        harvester.harvest();

        // Atomic rollback: the position (liquidity AND fee accounting) is untouched,
        // nothing was credited, nothing stranded outside the LP position.
        (uint128 liqPost, uint256 fg0Post, uint256 fg1Post) =
            IStateView(STATE_VIEW).getPositionInfo(SPY_USDG_POOL_ID, address(harvester), -887220, 887220, bytes32(0));
        assertEq(uint256(liqPost), uint256(liqPre), "position liquidity changed on a failed harvest");
        assertEq(fg0Post, fg0Pre, "fee-growth-inside0 changed on a failed harvest");
        assertEq(fg1Post, fg1Pre, "fee-growth-inside1 changed on a failed harvest");
        assertEq(vault.totalAssets(), 0, "vault credited on a failed harvest");
        assertEq(harvester.protocolAccrued(), 0, "protocol accrual on a failed harvest");
        assertEq(IERC20(SPY).balanceOf(bob), 0, "tip paid on a failed harvest");

        // Restore the honest quoter: the SAME fees re-collect (nothing was lost).
        vm.etch(QUOTER_V2, honestQuoterCode);
        vm.recordLogs();
        vm.prank(bob);
        harvester.harvest();
        HarvestedEvt memory e = _lastHarvestedEvent();
        assertGt(e.amount1Collected, 0, "accrued fees lost after the failed harvest");
        _assertSplitMath(e, vault, harvester);
    }

    // ------------------------------------------------------------------
    // T4 — PACK/NVDA (hookless, ts 200) + USDG/ETH (dynamic-fee hook, ts 10, native leg)
    // ------------------------------------------------------------------

    function testFork_T4_packNvda_bookOpenCollectHarvest() public {
        // LIVE-STATE FINDING (closes the S0.6 evidence gap): EVERY v3 PACK pool has
        // ZERO liquidity (factory sweep 2026-09-04: PACK/WETH @3000 0xBfA212ea…89de
        // liq=0 with 9 wei PACK / 5 wei WETH in the pool; PACK/WETH @10000 liq=0;
        // PACK/USDG @10000 liq=0). The S0.6 quote->asset route (PACK->WETH->NVDA)
        // exists but is UNSWAPPABLE today. Consequence, pinned below: the harvester
        // OPENS the PACK/NVDA book fine, accrues fees fine, and its harvest
        // FAIL-CLOSED reverts on the dead swap leg — the protocol can never dump
        // into a dead pool, and collected fees stay in the LP position (re-collectable
        // when a live route appears). PACK itself is acquired here via deal() (fork
        // only) because it cannot be bought anywhere on the chain right now.
        IPoolManagerV4.PoolKey memory key = IPoolManagerV4.PoolKey({
            currency0: PACK,
            currency1: NVDA,
            fee: 10000,
            tickSpacing: 200,
            hooks: address(0)
        });
        // The S0.6 route (kept byte-exact: it is what the configured harvester will
        // one day execute when liquidity exists): PACK -> WETH(@3000) -> NVDA(@500).
        bytes memory path = abi.encodePacked(PACK, uint24(3000), WETH, uint24(500), NVDA);
        YieldShares v;
        HarvesterV4 h;
        (timelock, v, h) = _deployStack(NVDA, key, path);

        // Funding: NVDA via a REAL v3 swap (its @500 pool is live); PACK via deal()
        // (no live route — documented above). Assert every deal landed loudly.
        deal(WETH, address(this), 2 * _dec(WETH));
        _swapV3(WETH, NVDA, 500, 5 * _dec(WETH) / 100);
        deal(PACK, address(this), 1_000_000 * _dec(PACK));
        assertGt(IERC20(PACK).balanceOf(address(this)), 0, "PACK deal did not land");
        IERC20(PACK).transfer(address(h), IERC20(PACK).balanceOf(address(this)) / 2);
        IERC20(NVDA).transfer(address(h), IERC20(NVDA).balanceOf(address(this)));

        (uint160 sqrtP, , , ) = IStateView(STATE_VIEW).getSlot0(PACK_NVDA_POOL_ID);
        uint128 l = _affordableLiquidity(
            IERC20(PACK).balanceOf(address(h)), IERC20(NVDA).balanceOf(address(h)), sqrtP
        );
        assertGt(l, 0, "computed zero affordable liquidity on PACK/NVDA");

        (int24 tickLower, int24 tickUpper) = h.fullRangeTicks();
        assertEq(tickLower, -887200, "ts-200 full-range lower tick wrong");
        assertEq(tickUpper, 887200, "ts-200 full-range upper tick wrong");
        assertEq(h.poolId(), PACK_NVDA_POOL_ID, "in-contract poolId != live PACK/NVDA poolId");

        // OPEN: the position mints cleanly on the live book.
        vm.prank(address(timelock));
        h.openPosition(l);
        assertTrue(h.hasPosition(), "PACK/NVDA position not open");
        assertEq(
            _positionLiquidity(PACK_NVDA_POOL_ID, h, tickLower, tickUpper),
            l,
            "StateView PACK/NVDA position liquidity mismatch"
        );

        // Donate on the PACK leg (c0) — the pool's OWN accounting accrues it to our
        // position (observable through StateView without collecting).
        uint256 donated = IERC20(PACK).balanceOf(address(this)) / 2;
        _donate(key, donated, 0);
        uint128 lTotal = IStateView(STATE_VIEW).getLiquidity(PACK_NVDA_POOL_ID);
        uint256 expected0 = Math.mulDiv(donated, l, lTotal);
        (, uint256 fg0AfterDonate, uint256 fg1AfterDonate) =
            IStateView(STATE_VIEW).getPositionInfo(PACK_NVDA_POOL_ID, address(h), tickLower, tickUpper, bytes32(0));

        // HARVEST: the dead quote->asset route reverts the WHOLE harvest (fail-closed).
        vm.prank(bob);
        vm.expectRevert();
        h.harvest();

        // Nothing stranded: the position (liquidity AND accrued fee accounting) is
        // untouched, the vault was never credited, no tip was paid.
        (uint128 liqPost, uint256 fg0Post, uint256 fg1Post) =
            IStateView(STATE_VIEW).getPositionInfo(PACK_NVDA_POOL_ID, address(h), tickLower, tickUpper, bytes32(0));
        assertEq(uint256(liqPost), uint256(l), "position liquidity changed on the failed harvest");
        assertEq(fg0Post, fg0AfterDonate, "accrued fees lost on the failed harvest");
        assertEq(fg1Post, fg1AfterDonate, "accrued fees lost on the failed harvest");
        assertGt(fg0AfterDonate, 0, "donate did not accrue on the PACK leg");
        assertEq(v.totalAssets(), 0, "vault credited on the failed harvest");
        assertEq(h.protocolAccrued(), 0, "protocol accrual on the failed harvest");
        assertEq(IERC20(NVDA).balanceOf(bob), 0, "tip paid on the failed harvest");
    }

    function testFork_T4_usdgEth_dynamicFeeBook_nativeLegWrapped() public {
        IPoolManagerV4.PoolKey memory key = IPoolManagerV4.PoolKey({
            currency0: address(0),
            currency1: USDG,
            fee: FEE_DYNAMIC_FLAG,
            tickSpacing: 10,
            hooks: DYNAMIC_HOOK
        });
        // Quote leg = native ETH: taken native fees are wrapped to WETH at EXACTLY the
        // collected amount, then swapped WETH -> USDG(@500) (GOAL §S0.6).
        bytes memory path = abi.encodePacked(WETH, uint24(500), USDG);
        YieldShares v;
        HarvesterV4 h;
        (timelock, v, h) = _deployStack(USDG, key, path);

        vm.deal(address(h), 2 ether);
        deal(USDG, address(h), 200 * _dec(USDG));

        (uint160 sqrtP, , , ) = IStateView(STATE_VIEW).getSlot0(USDG_ETH_POOL_ID);
        uint128 l = _affordableLiquidity(2 ether, 200 * _dec(USDG), sqrtP);
        assertGt(l, 0, "computed zero affordable liquidity on USDG/ETH");

        (int24 tickLower, int24 tickUpper) = h.fullRangeTicks();
        assertEq(tickLower, -887270, "ts-10 full-range lower tick wrong");
        assertEq(tickUpper, 887270, "ts-10 full-range upper tick wrong");
        assertEq(h.poolId(), USDG_ETH_POOL_ID, "in-contract poolId != live USDG/ETH poolId");
        assertEq(h.fee(), FEE_DYNAMIC_FLAG, "dynamic-fee flag not stored byte-exact");
        assertEq(h.hooks(), DYNAMIC_HOOK, "hook address not stored byte-exact");

        vm.prank(address(timelock));
        h.openPosition(l);
        // Clear the open's leftover principal (the pool's math dictates the exact
        // principal; overfunding is forwarded UNSWAPPED by the sweep — see T2).
        h.sweepToTreasury();
        assertTrue(h.hasPosition(), "USDG/ETH position not open");
        assertEq(
            _positionLiquidity(USDG_ETH_POOL_ID, h, tickLower, tickUpper),
            l,
            "StateView USDG/ETH position liquidity mismatch"
        );

        // Donate native ETH (c0) — exercises the wrap path on collect.
        vm.deal(address(this), 1 ether);
        uint256 donatedEth = 0.05 ether;
        _donate(key, donatedEth, 0);
        uint128 lTotal = IStateView(STATE_VIEW).getLiquidity(USDG_ETH_POOL_ID);
        uint256 expected0 = Math.mulDiv(donatedEth, l, lTotal);

        vm.recordLogs();
        vm.prank(bob);
        h.harvest();
        HarvestedEvt memory e = _lastHarvestedEvent();
        assertEq(e.amount1Collected, 0, "unexpected USDG leg (donation was native ETH)");
        assertApproxEqRel(e.amount0Collected, expected0, 0.02e18, "native-ETH collect != donate share");
        assertGt(e.swappedOut, 0, "wrapped-ETH -> USDG swap produced nothing");
        // The wrap consumed EXACTLY the collected leg; the swap consumed EXACTLY the wrap.
        assertEq(address(h).balance, 0, "native ETH leftover in the harvester at harvest");
        assertEq(IERC20(WETH).balanceOf(address(h)), 0, "WETH leftover in the harvester at harvest");
        _assertSplitMathT4(e, v, h);
    }

    /// @dev Split-math asserts against a non-SPY vault (no SPY-registry precondition).
    ///      The asset leg is derived from the harvester's own currency orientation
    ///      (asset == currency0 for SPY/USDG; asset == currency1 for PACK/NVDA and
    ///      USDG/ETH), so the identity holds for every book.
    function _assertSplitMathT4(HarvestedEvt memory e, YieldShares v, HarvesterV4 h) internal view {
        uint256 assetLeg = h.asset() == h.currency0() ? e.amount0Collected : e.amount1Collected;
        assertEq(e.proceeds, assetLeg + e.swappedOut, "proceeds != asset leg + swapped quote leg");
        assertEq(v.feeBps(), INITIAL_FEE_BPS, "feeBps drifted");
        assertEq(e.vaultShare, (e.proceeds * (10_000 - INITIAL_FEE_BPS)) / 10_000, "vault share formula broken");
        assertEq(e.vaultCredited, e.vaultShare, "credited != declared share on a clean token");
        assertEq(e.tip, (e.proceeds * 10) / 10_000, "tip != 0.1% of proceeds");
        assertEq(e.accrued, e.proceeds - e.vaultShare - e.tip, "accrual != proceeds - vault - tip");
        assertEq(v.totalAssets(), e.vaultCredited, "totalAssets != credited");
        assertEq(h.protocolAccrued(), e.accrued, "protocolAccrued != accrued");
        assertEq(IERC20(v.asset()).balanceOf(address(h)), e.accrued, "harvester holds != accrued");
        assertEq(IERC20(v.asset()).balanceOf(bob), e.tip, "caller tip not paid");
    }

    // ------------------------------------------------------------------
    // T5 — unauthorized actions revert
    // ------------------------------------------------------------------

    function testFork_T5_unauthorizedActionsRevert() public {
        IPoolManagerV4.PoolKey memory key = IPoolManagerV4.PoolKey({
            currency0: SPY,
            currency1: USDG,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });
        bytes memory path = abi.encodePacked(USDG, uint24(500), SPY);
        (timelock, vault, harvester) = _deployStack(SPY, key, path);

        // Position custody is timelock-only.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(HarvesterV4.NotTimelock.selector, bob));
        harvester.openPosition(1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(HarvesterV4.NotTimelock.selector, bob));
        harvester.closePosition(bob);
        vm.prank(address(timelock));
        vm.expectRevert(HarvesterV4.ZeroLiquidity.selector);
        harvester.openPosition(0);

        // Harvest with no position reverts; a third party cannot steer PM.unlock.
        vm.prank(bob);
        vm.expectRevert(HarvesterV4.NoPosition.selector);
        harvester.harvest();
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(HarvesterV4.CallbackNotActive.selector, bob, 0));
        harvester.unlockCallback("");

        // The yield push itself is harvester-gated on the vault (a foreign account can
        // never raise totalAssets) — the "harvester-only" credit rail.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.NotHarvester.selector, bob));
        vault.harvest(1);

        // The factory registry is one-vault-per-asset FOREVER (v3 and v4 share it).
        VaultFactory.V4Config memory cfg = _v4Config(SPY, key, path);
        vm.expectRevert(abi.encodeWithSelector(VaultFactory.VaultAlreadyExists.selector, SPY));
        factory.createVaultV4(cfg);

        // The fork PoolManager pin: a non-fork (e.g. canonical/scam-drainer) manager
        // reverts the whole creation — no registry row is written. Uses the USDG asset
        // (not yet created in this factory) so the WrongPoolManager guard is what fires,
        // not the duplicate-asset guard.
        cfg.asset = USDG;
        cfg.poolManager = address(uint160(0xdEAd));
        vm.expectRevert(abi.encodeWithSelector(HarvesterV4.WrongPoolManager.selector, address(uint160(0xdEAd))));
        factory.createVaultV4(cfg);
        assertEq(factory.vaultOfAsset(USDG), address(0), "registry row written for a reverted creation");
    }
}

/// @dev Minimal registry read surface (separate declaration from HarvestFork's to keep
///      this file self-contained).
interface IAccessControlsRegistryless {
    function isBlocked(address account) external view returns (bool);
}
