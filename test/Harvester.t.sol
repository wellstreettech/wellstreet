// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldShares} from "../src/YieldShares.sol";
import {WellstreetTimelock} from "../src/WellstreetTimelock.sol";
import {Harvester} from "../src/Harvester.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPositionManager} from "./mocks/MockPositionManager.sol";
import {MockRouter, MockQuoter} from "./mocks/MockSwaps.sol";

/// @notice Full harvester flow over mocks that behave like the verified Robinhood
///         Chain (4663) V3 stack: tier-500 SPY/WETH position, SwapRouter02 swap with
///         minOut enforcement, QuoterV2 quoting. All admin actions go through the
///         real 48h timelock (queue -> warp -> permissionless execute).
contract HarvesterTest is Test {
    MockERC20 spy;
    MockERC20 weth;
    MockPositionManager npm;
    MockRouter router;
    MockQuoter quoter;
    WellstreetTimelock timelock;
    YieldShares vault;
    Harvester harvester;

    address proposer = makeAddr("wellstreet-deployer");
    address pauser = makeAddr("pause-eoa");
    address alice = makeAddr("alice"); // LP position holder (protocol operator)
    address bob = makeAddr("bob"); // permissionless harvest caller
    address depositor = makeAddr("depositor");

    uint256 tokenId;

    // Fee seed: 1 WETH leg + 2 SPY leg; router/quoter rate 3000 SPY per WETH.
    uint256 constant WETH_FEE = 1e18;
    uint256 constant SPY_FEE = 2e18;
    uint256 constant RATE = 3000e18;
    // proceeds = 2e18 + 3000e18 = 3002e18; feeBps 1000:
    //   vaultShare = 2701.8e18, protocolShare = 300.2e18, tip = 3.002e18, accrued = 297.198e18
    uint256 constant VAULT_SHARE = 2_701.8e18;
    uint256 constant TIP = 3.002e18;
    uint256 constant ACCRUED = 297.198e18;

    function setUp() public {
        vm.prank(proposer);
        timelock = new WellstreetTimelock(proposer, 48 hours);
        spy = new MockERC20("SPY", "SPY");
        weth = new MockERC20("WETH", "WETH");
        npm = new MockPositionManager();
        router = new MockRouter();
        quoter = new MockQuoter();

        vault = new YieldShares(IERC20(address(spy)), "Wellstreet SPY", "ws-SPY", address(timelock), pauser, 1000);
        harvester = new Harvester(
            address(vault),
            address(timelock),
            address(timelock), // treasury custody
            address(spy),
            address(weth),
            500,
            address(npm),
            address(router),
            address(quoter)
        );

        // Router needs SPY inventory to pay swaps out of.
        spy.mint(address(router), 1_000_000e18);

        // Wire the harvester to the vault through the timelock (as in the deploy flow).
        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setHarvester, (address(harvester))));

        // Receive the protocol LP position: a legit tier-500 SPY/WETH position.
        tokenId = npm.mintPosition(address(weth), address(spy), 500, alice);
        vm.prank(alice);
        npm.safeTransferFrom(alice, address(harvester), tokenId);
        assertEq(harvester.positionId(), tokenId);
    }

    function _timelockExecute(address target, bytes memory data) internal {
        vm.prank(proposer);
        timelock.queue(target, 0, data, bytes32(0));
        vm.warp(block.timestamp + 48 hours);
        timelock.execute(target, 0, data, bytes32(0));
    }

    function _seedFees() internal {
        weth.mint(address(npm), WETH_FEE);
        spy.mint(address(npm), SPY_FEE);
        npm.seedFees(tokenId, uint128(WETH_FEE), uint128(SPY_FEE));
    }

    function _depositToVault(uint256 amount) internal {
        spy.mint(depositor, amount);
        vm.startPrank(depositor);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(amount, depositor);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Position custody guards
    // ------------------------------------------------------------------

    function test_positionGuard_wrongFeeTierRejected() public {
        uint256 badId = npm.mintPosition(address(weth), address(spy), 3000, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Harvester.WrongFeeTier.selector, 3000, 500));
        npm.safeTransferFrom(alice, address(harvester), badId);
        assertEq(npm.ownerOf(badId), alice); // NFT never left the sender
    }

    function test_positionGuard_wrongTokensRejected() public {
        MockERC20 other = new MockERC20("OTHER", "OTHER");
        uint256 badId = npm.mintPosition(address(spy), address(other), 500, alice);
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(Harvester.WrongPositionTokens.selector, address(spy), address(other))
        );
        npm.safeTransferFrom(alice, address(harvester), badId);
    }

    function test_positionGuard_tokenOrderIrrelevant() public {
        // The pool pair in either orientation is the same pool — both must be accepted.
        MockPositionManager npm2 = new MockPositionManager();
        uint256 badId = npm2.mintPosition(address(weth), address(spy), 500, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Harvester.NotThePositionManager.selector, address(npm2)));
        npm2.safeTransferFrom(alice, address(harvester), badId); // foreign NPM rejected

        // Same NPM, reversed order: accepted by a fresh harvester (the setUp harvester
        // already holds one position).
        Harvester h2 = new Harvester(
            address(vault), address(timelock), address(timelock), address(spy), address(weth), 500,
            address(npm), address(router), address(quoter)
        );
        uint256 revId = npm.mintPosition(address(spy), address(weth), 500, alice);
        vm.prank(alice);
        npm.safeTransferFrom(alice, address(h2), revId);
        assertEq(h2.positionId(), revId);
    }

    function test_positionGuard_onlyOnePosition() public {
        uint256 secondId = npm.mintPosition(address(weth), address(spy), 500, alice);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Harvester.AlreadyHasPosition.selector, tokenId));
        npm.safeTransferFrom(alice, address(harvester), secondId);
    }

    function test_positionGuard_harvestBeforeAnyPositionReverts() public {
        // Fresh harvester with no position: harvest is a no-op guard revert.
        Harvester h2 = new Harvester(
            address(vault), address(timelock), address(timelock), address(spy), address(weth), 500,
            address(npm), address(router), address(quoter)
        );
        vm.expectRevert(Harvester.NoPosition.selector);
        h2.harvest();
    }

    // ------------------------------------------------------------------
    // Split math: 90/10 + 0.1% tip deducted from the protocol share
    // ------------------------------------------------------------------

    function test_harvestSplitMath_9010_withTip() public {
        _seedFees();
        uint256 callerSpyBefore = spy.balanceOf(bob);

        vm.prank(bob); // permissionless — any caller earns the tip
        harvester.harvest();

        // Vault share: transferred AND credited (totalAssets rises, no shares minted).
        assertEq(spy.balanceOf(address(vault)), VAULT_SHARE);
        assertEq(vault.totalAssets(), VAULT_SHARE);
        assertEq(vault.totalSupply(), 0); // NO shares minted by yield

        // Caller tip = 0.1% of total proceeds (3002e18 * 10 / 10000).
        assertEq(spy.balanceOf(bob) - callerSpyBefore, TIP);

        // Protocol share accrues for the treasury (300.2e18 - 3.002e18).
        assertEq(harvester.protocolAccrued(), ACCRUED);

        // LP position fees fully collected.
        (,,,,,,,,,, uint128 owed0, uint128 owed1) = npm.positions(tokenId);
        assertEq(owed0, 0);
        assertEq(owed1, 0);
    }

    function test_harvest_raisesSharePrice_withoutMinting() public {
        _depositToVault(100e18);
        uint256 supplyBefore = vault.totalSupply();
        uint256 priceBefore = vault.previewRedeem(vault.balanceOf(depositor));

        _seedFees();
        vm.prank(bob);
        harvester.harvest();

        assertEq(vault.totalSupply(), supplyBefore); // no dilution, no minting
        assertGt(vault.previewRedeem(vault.balanceOf(depositor)), priceBefore);
        // Depositor's claim = deposit + 90% of the fee proceeds (floor-rounding dust
        // of a few wei from the ERC-4626 conversion is tolerated).
        assertApproxEqAbs(vault.previewRedeem(vault.balanceOf(depositor)), 100e18 + VAULT_SHARE, 100);
    }

    function test_sweepToTreasury_permissionless() public {
        _seedFees();
        vm.prank(bob);
        harvester.harvest();
        assertEq(harvester.protocolAccrued(), ACCRUED);

        address treasury = address(timelock);
        uint256 treasurySpyBefore = spy.balanceOf(treasury);

        vm.prank(makeAddr("random-sweeper")); // permissionless
        harvester.sweepToTreasury();

        assertEq(spy.balanceOf(treasury) - treasurySpyBefore, ACCRUED);
        assertEq(harvester.protocolAccrued(), 0);
    }

    function test_feeChangeByTimelock_reflectedInNextHarvest() public {
        // Timelock raises the fee to the 2000 cap (20%): next split must be 80/20.
        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setFeeBps, (2000)));
        assertEq(vault.feeBps(), 2000);

        _seedFees();
        vm.prank(bob);
        harvester.harvest();

        uint256 proceeds = SPY_FEE + RATE; // 3002e18
        assertEq(vault.totalAssets(), (proceeds * 8000) / 10_000);
        assertEq(harvester.protocolAccrued(), (proceeds * 2000) / 10_000 - TIP);
    }

    // ------------------------------------------------------------------
    // Atomicity: a failed swap leg reverts the WHOLE harvest; fees stay collectable
    // ------------------------------------------------------------------

    function test_harvestAtomicRevert_routerFailure_leavesFeesCollectable() public {
        _seedFees();
        router.setFail(true);

        vm.prank(bob);
        vm.expectRevert(MockRouter.MockRouterFailure.selector);
        harvester.harvest();

        // Nothing moved: vault accounting, treasury accrual, caller balance, and the
        // fees are STILL owed by the position.
        assertEq(vault.totalAssets(), 0);
        assertEq(harvester.protocolAccrued(), 0);
        (,,,,,,,,,, uint128 owed0, uint128 owed1) = npm.positions(tokenId);
        assertEq(owed0, WETH_FEE);
        assertEq(owed1, SPY_FEE);

        // Router fixed -> the next permissionless harvest re-collects the full fees.
        router.setFail(false);
        vm.prank(bob);
        harvester.harvest();
        assertEq(vault.totalAssets(), VAULT_SHARE);
        assertEq(harvester.protocolAccrued(), ACCRUED);
    }

    function test_harvestAtomicRevert_staleQuoteMinOut_leavesFeesCollectable() public {
        _seedFees();
        // Quoter quotes at 3000 (minOut = 2970e18) but the router only pays 2900 —
        // the QuoterV2-derived minOut must revert the harvest.
        router.setRateOutPerIn(2900e18);

        vm.prank(bob);
        vm.expectRevert(
            abi.encodeWithSelector(MockRouter.MockRouterMinOutBreached.selector, 2900e18, 2970e18)
        );
        harvester.harvest();

        assertEq(vault.totalAssets(), 0);
        (,,,,,,,,,, uint128 owed0, uint128 owed1) = npm.positions(tokenId);
        assertEq(owed0, WETH_FEE);
        assertEq(owed1, SPY_FEE);

        // Rates re-align -> harvest succeeds with the full proceeds.
        router.setRateOutPerIn(RATE);
        vm.prank(bob);
        harvester.harvest();
        assertEq(vault.totalAssets(), VAULT_SHARE);
    }

    function test_harvestAtomicRevert_quoterFailure() public {
        _seedFees();
        quoter.setFail(true);
        vm.prank(bob);
        vm.expectRevert(); // MockQuoter.MockQuoterFailure bubbles up as a reverted harvest
        harvester.harvest();
        assertEq(vault.totalAssets(), 0);
        (,,,,,,,,,, uint128 owed0, ) = npm.positions(tokenId);
        assertEq(owed0, WETH_FEE); // fees still in the position
    }

    // ------------------------------------------------------------------
    // Force-sent / donated tokens: forwarded unswapped, never dumped
    // ------------------------------------------------------------------

    function test_forceSentWeth_forwardedToTreasuryUnswapped() public {
        _seedFees();
        // Mallory force-sends 5 WETH straight to the harvester (a donation).
        address mallory = makeAddr("mallory");
        weth.mint(mallory, 5e18);
        vm.prank(mallory);
        weth.transfer(address(harvester), 5e18);

        vm.prank(bob);
        harvester.harvest();

        // The donation was NOT swapped into proceeds: proceeds are exactly the fee
        // seed's worth (3002e18), same as the clean-run split.
        assertEq(vault.totalAssets(), VAULT_SHARE);
        // Donated WETH landed in the treasury untouched (the router never saw it).
        assertEq(weth.balanceOf(address(timelock)), 5e18);
        assertEq(weth.balanceOf(address(harvester)), 0);
    }

    function test_forceSentSpy_forwardedToTreasuryUnswapped() public {
        _seedFees();
        vm.prank(bob);
        harvester.harvest(); // accrues ACCRUED for the treasury

        address mallory = makeAddr("mallory");
        spy.mint(mallory, 7e18);
        vm.prank(mallory);
        spy.transfer(address(harvester), 7e18);

        vm.prank(mallory);
        harvester.sweepToTreasury();

        // Accrued protocol fees + the donated SPY, both unswapped.
        assertEq(spy.balanceOf(address(timelock)), ACCRUED + 7e18);
        assertEq(harvester.protocolAccrued(), 0);
        assertEq(spy.balanceOf(address(harvester)), 0);
        // The donation never reached the vault accounting.
        assertEq(vault.totalAssets(), VAULT_SHARE);
    }

    function test_forwardToken_junkToTreasury() public {
        MockERC20 junk = new MockERC20("JUNK", "JUNK");
        junk.mint(address(harvester), 42);
        vm.prank(makeAddr("anyone"));
        harvester.forwardToken(address(junk));
        assertEq(junk.balanceOf(address(timelock)), 42);
        assertEq(junk.balanceOf(address(harvester)), 0);

        // The pool tokens themselves are not sweepable via forwardToken — they have
        // their own accounted paths (accrual/donations).
        vm.expectRevert(abi.encodeWithSelector(Harvester.NotHarvestableToken.selector, address(spy)));
        harvester.forwardToken(address(spy));
        vm.expectRevert(abi.encodeWithSelector(Harvester.NotHarvestableToken.selector, address(weth)));
        harvester.forwardToken(address(weth));
    }

    // ------------------------------------------------------------------
    // LP principal custody: removable ONLY by the treasury timelock
    // ------------------------------------------------------------------

    function test_transferPosition_onlyByTimelock() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Harvester.NotTimelock.selector, bob));
        harvester.transferPosition(bob, tokenId);

        _timelockExecute(address(harvester), abi.encodeCall(Harvester.transferPosition, (bob, tokenId)));
        assertEq(npm.ownerOf(tokenId), bob);
        assertEq(harvester.positionId(), 0);

        // With no position, harvest reverts — the principal is out of reach of the
        // permissionless harvest path entirely.
        vm.expectRevert(Harvester.NoPosition.selector);
        harvester.harvest();
    }

    // ------------------------------------------------------------------
    // Edge flows
    // ------------------------------------------------------------------

    function test_harvest_withZeroFees_isANoOpThatStillForwardsDonations() public {
        weth.mint(address(harvester), 1e18); // donation only
        uint256 treasuryWethBefore = weth.balanceOf(address(timelock));

        vm.prank(bob);
        harvester.harvest(); // collect returns (0, 0): no swap, no split, no revert

        assertEq(vault.totalAssets(), 0);
        assertEq(harvester.protocolAccrued(), 0);
        assertEq(weth.balanceOf(address(timelock)) - treasuryWethBefore, 1e18);
    }

    function test_harvest_isPermissionless() public {
        _seedFees();
        uint256 bobBefore = spy.balanceOf(bob);
        vm.prank(bob);
        harvester.harvest();
        assertGt(spy.balanceOf(bob), bobBefore); // tip earned by the caller

        // A second caller gets only their own future tip — fees are already collected.
        _seedFees();
        uint256 carolBefore = spy.balanceOf(makeAddr("carol"));
        vm.prank(makeAddr("carol"));
        harvester.harvest();
        assertGt(spy.balanceOf(makeAddr("carol")), carolBefore);
    }
}
