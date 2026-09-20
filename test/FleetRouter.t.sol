// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FleetRouter} from "../src/FleetRouter.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockERC20, MockFeeOnTransferToken} from "./mocks/MockERC20.sol";
import {MockForkNPM, MockFeeReceiver, MockReenteringOpenToken} from "./mocks/MockForkNPM.sol";

/// @notice FLEET-ROUTER unit battery — the one-tx self-custodied LP entry router against
///         a 1:1 mock of the pinned fork NPM (payer semantics pinned from the verified
///         deployed source: docs/ops/phase0/npm-mint-payer-semantics.md). Covers the
///         goal's named teeth: verbatim-mint equivalence vs direct NPM, fee accrual to
///         the TreasuryTimelock (exact value, wrong-value reverts), the end-of-tx
///         zero-balance invariant on EVERY mint path (full-consume + refund), the
///         timelock-only setFee with the MAX_FEE ceiling, no payable fallback (stray
///         ETH reverts), and the FleetPositionOpened emission with caller + book
///         identity — plus model-fidelity teeth (deadline/slippage enforced inside the
///         NPM; fee-on-transfer opens revert whole with nothing stranded) and the
///         reentrancy-guard proof (a reentrant open from inside the token pull reverts
///         with the guard's own selector while the outer open completes).
contract FleetRouterTest is Test {
    MockERC20 token0;
    MockERC20 token1;
    MockForkNPM npm;
    MockFeeReceiver treasury;
    FleetRouter router;

    address alice = makeAddr("alice");
    address mallory = makeAddr("mallory");

    uint256 constant FEE = 0.0005 ether;
    uint256 constant AMT0 = 1_000e18;
    uint256 constant AMT1 = 500e18;
    uint24 constant FEE_TIER = 3000;
    int24 constant TICK_LOWER = -887220;
    int24 constant TICK_UPPER = 887220;

    function setUp() public {
        token0 = new MockERC20("Book Token 0", "BT0");
        token1 = new MockERC20("Book Token 1", "BT1");
        npm = new MockForkNPM();
        treasury = new MockFeeReceiver();
        router = new FleetRouter(address(npm), address(treasury));
        token0.mint(alice, 1_000_000e18);
        token1.mint(alice, 1_000_000e18);
        vm.deal(alice, 1_000 ether);
        vm.deal(mallory, 1_000 ether);
    }

    function _params() internal view returns (FleetRouter.PositionParams memory p) {
        p = FleetRouter.PositionParams({
            token0: address(token0),
            token1: address(token1),
            feeTier: FEE_TIER,
            tickLower: TICK_LOWER,
            tickUpper: TICK_UPPER,
            amount0Desired: AMT0,
            amount1Desired: AMT1,
            amount0Min: 0,
            amount1Min: 0,
            deadline: block.timestamp + 300
        });
    }

    function _approveRouter(address who, uint256 amt0, uint256 amt1) internal {
        vm.startPrank(who);
        token0.approve(address(router), amt0);
        token1.approve(address(router), amt1);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Tooth 1: verbatim-mint equivalence vs direct NPM (same calldata shape
    // -> same position outcome), including the payer-identity proof.
    // ---------------------------------------------------------------------
    function test_VerbatimMint_EquivalenceVsDirectNpm() public {
        FleetRouter.PositionParams memory p = _params();
        _approveRouter(alice, AMT0, AMT1);

        // Path A — through the router: the NPM pulls from the ROUTER (msg.sender at
        // the mint boundary), the router pre-pulled from alice.
        vm.prank(alice);
        (uint256 tidA,, uint256 used0, uint256 used1) = router.openPosition{value: FEE}(p);
        assertEq(npm.lastPayer(), address(router), "payer must be the router on the routed path");
        assertEq(used0, AMT0);
        assertEq(used1, AMT1);

        // Path B — direct NPM mint with the SAME calldata shape (recipient = alice).
        MockForkNPM.MintParams memory dp = MockForkNPM.MintParams({
            token0: p.token0,
            token1: p.token1,
            fee: p.feeTier,
            tickLower: p.tickLower,
            tickUpper: p.tickUpper,
            amount0Desired: p.amount0Desired,
            amount1Desired: p.amount1Desired,
            amount0Min: p.amount0Min,
            amount1Min: p.amount1Min,
            recipient: alice,
            deadline: p.deadline
        });
        vm.startPrank(alice);
        token0.approve(address(npm), AMT0);
        token1.approve(address(npm), AMT1);
        (uint256 tidB,,, ) = npm.mint(dp);
        vm.stopPrank();
        assertEq(npm.lastPayer(), alice, "payer must be the caller on the direct path");

        // Same position outcome: owner, book identity, and liquidity.
        (address ownA, address t0A, address t1A, uint24 feeA, int24 loA, int24 hiA, uint128 liqA) = npm.positions(tidA);
        (address ownB, address t0B, address t1B, uint24 feeB, int24 loB, int24 hiB, uint128 liqB) = npm.positions(tidB);
        assertEq(ownA, alice, "router path: NFT to the caller");
        assertEq(ownB, alice, "direct path: NFT to the caller");
        assertEq(t0A, t0B);
        assertEq(t1A, t1B);
        assertEq(feeA, feeB);
        assertEq(loA, loB);
        assertEq(hiA, hiB);
        assertEq(liqA, liqB, "same calldata -> same liquidity");
    }

    // ---------------------------------------------------------------------
    // Tooth 2: fee accrual — exact 0.0005 ETH lands at the TreasuryTimelock.
    // ---------------------------------------------------------------------
    function test_FeeAccrual_ExactFeeLandsAtTreasuryTimelock() public {
        FleetRouter.PositionParams memory p = _params();
        _approveRouter(alice, AMT0, AMT1);
        assertEq(address(treasury).balance, 0);

        vm.prank(alice);
        router.openPosition{value: FEE}(p);

        assertEq(address(treasury).balance, FEE, "flat fee must land at the timelock");
        assertEq(treasury.totalReceived(), FEE);
        assertEq(address(router).balance, 0, "router retains nothing");
    }

    // ---------------------------------------------------------------------
    // Tooth 2b: wrong value reverts — under AND over (no refund path).
    // ---------------------------------------------------------------------
    function test_FeeAccrual_WrongValueReverts_NoRefundPath() public {
        FleetRouter.PositionParams memory p = _params();
        _approveRouter(alice, AMT0, AMT1);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FleetRouter.WrongFee.selector, FEE, 0));
        router.openPosition{value: 0}(p);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FleetRouter.WrongFee.selector, FEE, FEE + 1 wei));
        router.openPosition{value: FEE + 1 wei}(p);

        assertEq(address(treasury).balance, 0, "no fee on failed opens");
        assertEq(token0.balanceOf(alice), 1_000_000e18, "no tokens moved on failed opens");
    }

    // ---------------------------------------------------------------------
    // Tooth 3a: end-of-tx zero-balance invariant — FULL-CONSUME path.
    // ---------------------------------------------------------------------
    function test_ZeroBalance_Invariant_FullConsumePath() public {
        FleetRouter.PositionParams memory p = _params();
        npm.setConsumeCaps(0, 0); // consume the full desired on both sides
        _approveRouter(alice, AMT0, AMT1);

        vm.prank(alice);
        router.openPosition{value: FEE}(p);

        assertEq(token0.balanceOf(address(router)), 0, "token0 dust on the router");
        assertEq(token1.balanceOf(address(router)), 0, "token1 dust on the router");
        assertEq(address(router).balance, 0, "native dust on the router");
        assertEq(token0.balanceOf(address(npm)), AMT0);
        assertEq(token1.balanceOf(address(npm)), AMT1);
        assertEq(token0.balanceOf(alice), 1_000_000e18 - AMT0, "caller spent exactly the consumed amount");
        assertEq(token1.balanceOf(alice), 1_000_000e18 - AMT1, "caller spent exactly the consumed amount");
        assertEq(address(treasury).balance, FEE);
    }

    // ---------------------------------------------------------------------
    // Tooth 3b: end-of-tx zero-balance invariant — REFUND path (one side
    // binds at the pool price; desired-minus-owed comes back same-tx).
    // ---------------------------------------------------------------------
    function test_ZeroBalance_Invariant_RefundPath() public {
        FleetRouter.PositionParams memory p = _params();
        npm.setConsumeCaps(AMT0 / 2, 0); // token0 binds at half; token1 fully consumed
        _approveRouter(alice, AMT0, AMT1);

        vm.prank(alice);
        (, uint128 liquidity, uint256 used0, uint256 used1) = router.openPosition{value: FEE}(p);

        assertEq(used0, AMT0 / 2, "consumed token0 capped");
        assertEq(used1, AMT1);
        assertEq(liquidity, AMT0 / 2 + AMT1);

        assertEq(token0.balanceOf(address(router)), 0, "refund left token0 dust");
        assertEq(token1.balanceOf(address(router)), 0);
        assertEq(address(router).balance, 0);
        assertEq(token0.balanceOf(alice), 1_000_000e18 - AMT0 / 2, "half of token0 refunded to the caller");
        assertEq(token1.balanceOf(alice), 1_000_000e18 - AMT1);
        assertEq(token0.balanceOf(address(npm)), AMT0 / 2);
        assertEq(token1.balanceOf(address(npm)), AMT1);
        assertEq(address(treasury).balance, FEE, "fee forwarded on the refund path too");
    }

    // ---------------------------------------------------------------------
    // Tooth 4: setFee — timelock only, MAX_FEE ceiling enforced.
    // ---------------------------------------------------------------------
    function test_SetFee_TimelockOnly() public {
        vm.prank(alice);
        vm.expectRevert("ONLY_TIMELOCK");
        router.setFee(0.001 ether);

        vm.prank(address(treasury));
        router.setFee(0.001 ether);
        assertEq(router.fee(), 0.001 ether, "timelock can raise the fee");
    }

    function test_SetFee_CeilingEnforced_BoundaryAllowed() public {
        uint256 maxFee = router.MAX_FEE(); // read BEFORE vm.prank — the getter call would consume it

        vm.prank(address(treasury));
        router.setFee(maxFee);
        assertEq(router.fee(), maxFee, "fee AT the ceiling is allowed");

        vm.prank(address(treasury));
        vm.expectRevert(abi.encodeWithSelector(FleetRouter.FeeAboveCeiling.selector, maxFee + 1, maxFee));
        router.setFee(maxFee + 1);
    }

    function test_SetFee_NewFeeIsTheNextOpenRequirement() public {
        FleetRouter.PositionParams memory p = _params();
        _approveRouter(alice, AMT0, AMT1);

        vm.prank(address(treasury));
        router.setFee(0.001 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(FleetRouter.WrongFee.selector, 0.001 ether, FEE));
        router.openPosition{value: FEE}(p);

        vm.prank(alice);
        router.openPosition{value: 0.001 ether}(p);
        assertEq(address(treasury).balance, 0.001 ether);
    }

    // ---------------------------------------------------------------------
    // Tooth 5: no payable fallback — plain ETH sends revert, nothing moves.
    // ---------------------------------------------------------------------
    function test_NoPayableReceive_PlainEthSendReverts() public {
        vm.prank(alice);
        (bool ok,) = address(router).call{value: 1 ether}("");
        assertFalse(ok, "stray ETH must revert (no payable fallback)");
        assertEq(alice.balance, 1_000 ether, "nothing moved");
        assertEq(address(router).balance, 0);
    }

    // ---------------------------------------------------------------------
    // Tooth 6: FleetPositionOpened emitted with the caller + book identity.
    // ---------------------------------------------------------------------
    function test_FleetPositionOpened_EmittedWithCallerAndBookIdentity() public {
        FleetRouter.PositionParams memory p = _params();
        _approveRouter(alice, AMT0, AMT1);

        vm.expectEmit(true, true, true, true, address(router));
        emit FleetRouter.FleetPositionOpened(
            alice, address(token0), address(token1), FEE_TIER, TICK_LOWER, TICK_UPPER, 1, uint128(AMT0 + AMT1), AMT0, AMT1
        );
        vm.prank(alice);
        router.openPosition{value: FEE}(p);
    }

    // ---------------------------------------------------------------------
    // Model-fidelity teeth: deadline and slippage are enforced INSIDE the
    // NPM (periphery messages) — the router forwards them verbatim.
    // ---------------------------------------------------------------------
    function test_DeadlineEnforcedInsideNpm_ModelsRealNpm() public {
        FleetRouter.PositionParams memory p = _params();
        p.deadline = block.timestamp - 1;
        _approveRouter(alice, AMT0, AMT1);

        vm.prank(alice);
        vm.expectRevert("Transaction too old");
        router.openPosition{value: FEE}(p);
    }

    function test_SlippageEnforcedInsideNpm_ModelsRealNpm() public {
        FleetRouter.PositionParams memory p = _params();
        p.amount0Min = AMT0 / 2 + 1;
        npm.setConsumeCaps(AMT0 / 2, 0); // consumed0 < amount0Min
        _approveRouter(alice, AMT0, AMT1);

        vm.prank(alice);
        vm.expectRevert("Price slippage check");
        router.openPosition{value: FEE}(p);
    }

    // ---------------------------------------------------------------------
    // Honest-tape tooth: fee-on-transfer tokens break the refund math and
    // the open REVERTS WHOLE — nothing stranded on the router or the caller.
    // ---------------------------------------------------------------------
    function test_FeeOnTransferToken_OpenRevertsWhole_NothingStranded() public {
        MockFeeOnTransferToken fot = new MockFeeOnTransferToken();
        fot.mint(alice, AMT0);

        FleetRouter.PositionParams memory p = _params();
        p.token0 = address(fot);
        _approveRouter(alice, AMT0, AMT1);

        uint256 fotBefore = fot.balanceOf(alice);

        vm.prank(alice);
        vm.expectRevert(); // pull shortfall / refund shortfall — either way the open reverts whole
        router.openPosition{value: FEE}(p);

        assertEq(fot.balanceOf(alice), fotBefore, "caller made whole on the reverted open");
        assertEq(fot.balanceOf(address(router)), 0, "no token stranded on the router");
        assertEq(address(router).balance, 0, "no native stranded on the router");
        assertEq(address(treasury).balance, 0, "no fee on a reverted open");
    }

    // ---------------------------------------------------------------------
    // Guard tooth: the mint path is reentrancy-guarded. A hostile token
    // re-enters openPosition from inside the router's token pull WITH the
    // correct fee — the inner call must revert with the guard's own selector
    // (ReentrancyGuardReentrantCall), while the OUTER open completes.
    // ---------------------------------------------------------------------
    function test_ReentrancyGuard_InnerOpenRevertsOuterOpenCompletes() public {
        MockReenteringOpenToken hostile = new MockReenteringOpenToken();
        hostile.mint(alice, AMT0);
        vm.deal(address(hostile), FEE); // funds the re-entry attempt's fee value

        FleetRouter.PositionParams memory innerParams = _params(); // guard fires before any logic — params are irrelevant
        hostile.setAttack(
            address(router),
            FEE,
            abi.encodeWithSelector(FleetRouter.openPosition.selector, innerParams)
        );

        FleetRouter.PositionParams memory p = _params();
        p.token0 = address(hostile);
        vm.startPrank(alice);
        hostile.approve(address(router), AMT0);
        token1.approve(address(router), AMT1);
        (, , uint256 used0, uint256 used1) = router.openPosition{value: FEE}(p);
        vm.stopPrank();

        // The outer open completed end-to-end.
        assertEq(used0, AMT0);
        assertEq(used1, AMT1);
        assertEq(address(treasury).balance, FEE, "outer open fee forwarded");
        assertEq(token0.balanceOf(address(router)), 0);
        assertEq(token1.balanceOf(address(router)), 0);

        // The inner open was BLOCKED by the guard — precisely its own selector.
        assertFalse(hostile.lastAttackOk(), "inner open must fail");
        assertEq(
            keccak256(hostile.lastAttackReturndata()),
            keccak256(abi.encodeWithSelector(ReentrancyGuard.ReentrancyGuardReentrantCall.selector)),
            "inner open must revert with the guard selector"
        );
    }

    // ---------------------------------------------------------------------
    // Second-caller hygiene: a second user's open is independent (no state
    // bleed through the router between callers).
    // ---------------------------------------------------------------------
    function test_IndependentCallers_NoStateBleed() public {
        FleetRouter.PositionParams memory p = _params();
        _approveRouter(alice, AMT0, AMT1);
        _approveRouter(mallory, AMT0, AMT1);
        token0.mint(mallory, 1_000_000e18);
        token1.mint(mallory, 1_000_000e18);

        vm.prank(alice);
        (uint256 tidA, , , ) = router.openPosition{value: FEE}(p);
        vm.prank(mallory);
        (uint256 tidB, , , ) = router.openPosition{value: FEE}(p);

        (address ownA, , , , , , uint128 liqA) = npm.positions(tidA);
        (address ownB, , , , , , uint128 liqB) = npm.positions(tidB);
        assertEq(ownA, alice);
        assertEq(ownB, mallory);
        assertEq(liqA, liqB, "identical params -> identical liquidity for both callers");
        assertEq(address(treasury).balance, 2 * FEE, "one fee per open");
        assertEq(token0.balanceOf(address(router)), 0);
        assertEq(token1.balanceOf(address(router)), 0);
    }
}
