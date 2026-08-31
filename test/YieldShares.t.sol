// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {YieldShares} from "../src/YieldShares.sol";
import {WellstreetTimelock} from "../src/WellstreetTimelock.sol";
import {MockERC20, MockFeeOnTransferToken} from "./mocks/MockERC20.sol";

/// @notice Unit tests for the YieldShares vault invariants. The timelock is used for
///         real in the admin flows (queue -> 48h warp -> permissionless execute).
contract YieldSharesTest is Test {
    MockERC20 spy;
    WellstreetTimelock timelock;
    YieldShares vault;

    address proposer = makeAddr("wellstreet-deployer"); // not the test contract: exercises prank paths
    address pauser = makeAddr("pause-eoa");
    address alice = makeAddr("alice");
    address attacker = makeAddr("attacker");

    function setUp() public {
        vm.prank(proposer);
        timelock = new WellstreetTimelock(proposer, 48 hours);
        spy = new MockERC20("SPY", "SPY");
        vault = new YieldShares(IERC20(address(spy)), "Wellstreet SPY", "ws-SPY", address(timelock), pauser, 1000);
    }

    /// @dev Queue a call on the timelock, warp past the 48h window, execute
    ///      permissionlessly.
    function _timelockExecute(address target, bytes memory data) internal {
        vm.prank(proposer);
        timelock.queue(target, 0, data, bytes32(0));
        vm.warp(block.timestamp + 48 hours);
        timelock.execute(target, 0, data, bytes32(0));
    }

    function test_metadata() public view {
        assertEq(vault.name(), "Wellstreet SPY");
        assertEq(vault.symbol(), "ws-SPY");
        assertEq(vault.asset(), address(spy));
        assertEq(vault.decimals(), 24); // 18 (asset) + 6 (virtual share offset)
        assertEq(vault.timelock(), address(timelock));
        assertEq(vault.pauser(), pauser);
        assertEq(vault.feeBps(), 1000);
        assertEq(vault.totalAssets(), 0);
    }

    // ------------------------------------------------------------------
    // Invariant 1: first-depositor inflation fails
    // ------------------------------------------------------------------

    function test_firstDepositorInflationFails() public {
        // Classic attack: deposit 1 wei, donate a huge amount directly to the vault,
        // wait for the next depositor to mint a dust share, redeem.
        spy.mint(attacker, 10e24 + 1);
        vm.startPrank(attacker);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(1, attacker); // mints 1e6 shares (virtual offset)
        spy.transfer(address(vault), 10e24); // 10M SPY donation
        vm.stopPrank();

        // Donation is INVISIBLE to accounting — the attack never even starts.
        assertEq(vault.totalAssets(), 1);

        // Victim deposits 1 SPY: gets a full-value share, never dust.
        spy.mint(alice, 1e18);
        vm.startPrank(alice);
        spy.approve(address(vault), type(uint256).max);
        uint256 victimShares = vault.deposit(1e18, alice);
        assertEq(victimShares, 1e24); // 1.0 ws-SPY — not a dust amount
        uint256 back = vault.redeem(victimShares, alice, alice);
        assertEq(back, 1e18); // victim exits whole
        vm.stopPrank();

        // Attacker redeems: recovers their 1 wei deposit, NEVER the donation.
        uint256 attackerShares = vault.balanceOf(attacker); // read BEFORE the prank (arg evaluation)
        vm.prank(attacker);
        uint256 attackerOut = vault.redeem(attackerShares, attacker, attacker);
        assertEq(attackerOut, 1); // the attack is a total loss of the donation
        assertEq(spy.balanceOf(address(vault)), 10e24); // donation still in the vault
    }

    // ------------------------------------------------------------------
    // Invariant 2: donation neutrality (storage-based totalAssets)
    // ------------------------------------------------------------------

    function test_donationNeutrality() public {
        spy.mint(alice, 200e18);
        vm.startPrank(alice);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(100e18, alice);
        vm.stopPrank();

        uint256 taBefore = vault.totalAssets();
        uint256 priceBefore = vault.previewRedeem(10e24);

        // Force-send 50 SPY straight to the vault (no deposit call).
        spy.mint(attacker, 50e18);
        vm.prank(attacker);
        spy.transfer(address(vault), 50e18);

        // Price and accounting do not move; the excess is unaccounted.
        assertEq(vault.totalAssets(), taBefore);
        assertEq(vault.previewRedeem(10e24), priceBefore);
        assertEq(vault.unaccountedAssets(), 50e18);
        assertGt(spy.balanceOf(address(vault)), vault.totalAssets());
    }

    // ------------------------------------------------------------------
    // Invariant 3: fee-on-transfer deposits revert
    // ------------------------------------------------------------------

    function test_feeOnTransferDepositReverts() public {
        MockFeeOnTransferToken fot = new MockFeeOnTransferToken();
        YieldShares fotVault =
            new YieldShares(IERC20(address(fot)), "Wellstreet FOT", "ws-FOT", address(timelock), pauser, 1000);

        fot.mint(alice, 1e18);
        vm.startPrank(alice);
        fot.approve(address(fotVault), type(uint256).max);
        // 10% tax: vault would receive 0.9e18 for a 1e18 debit -> revert, no shares.
        vm.expectRevert(
            abi.encodeWithSelector(YieldShares.FeeOnTransferDetected.selector, 1e18, 9e17)
        );
        fotVault.deposit(1e18, alice);
        vm.stopPrank();

        assertEq(fotVault.totalSupply(), 0);
        assertEq(fotVault.totalAssets(), 0);
        // A clean token still deposits fine into its own vault.
        spy.mint(alice, 1e18);
        vm.startPrank(alice);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(1e18, alice);
        vm.stopPrank();
        assertEq(vault.totalAssets(), 1e18);
    }

    // ------------------------------------------------------------------
    // Skim protection: the unaccounted excess cannot be claimed by anyone
    // ------------------------------------------------------------------

    function test_skimCannotStealBacking() public {
        spy.mint(alice, 20e18);
        vm.startPrank(alice);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(10e18, alice);
        vm.stopPrank();

        // Attacker force-sends 100 SPY to the vault, then cycles a deposit/redeem
        // trying to mint shares against the inflated balance.
        spy.mint(attacker, 101e18);
        vm.prank(attacker);
        spy.transfer(address(vault), 100e18);
        assertEq(vault.totalAssets(), 10e18); // accounting unmoved

        spy.mint(attacker, 1e18);
        vm.startPrank(attacker);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(1e18, attacker);
        uint256 out = vault.redeem(vault.balanceOf(attacker), attacker, attacker);
        vm.stopPrank();

        // The attacker got back only their own deposit (pro-rata of ACCOUNTED assets),
        // not the 100 SPY excess.
        assertEq(out, 1e18);
        // The excess is still there, still claimable by nobody.
        assertEq(spy.balanceOf(address(vault)) - vault.totalAssets(), 100e18);
    }

    // ------------------------------------------------------------------
    // Invariant 4: harvest-gated yield
    // ------------------------------------------------------------------

    function test_harvest_onlyHarvesterCanRaiseTotalAssets() public {
        address fakeHarvester = makeAddr("fake-harvester");
        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setHarvester, (fakeHarvester)));

        // Anyone who is not the harvester cannot credit yield — even after pushing
        // tokens into the vault by force.
        spy.mint(attacker, 5e18);
        vm.prank(attacker);
        spy.transfer(address(vault), 5e18);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.NotHarvester.selector, attacker));
        vault.harvest(5e18);
        assertEq(vault.totalAssets(), 0);
        assertEq(vault.unaccountedAssets(), 5e18); // stayed a donation

        // The designated harvester can, bounded by what actually arrived.
        vm.prank(fakeHarvester);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.ExcessTooSmall.selector, 6e18, 5e18));
        vault.harvest(6e18); // cannot overstate
        vm.prank(fakeHarvester);
        vault.harvest(5e18);
        assertEq(vault.totalAssets(), 5e18);
        assertEq(vault.unaccountedAssets(), 0);

        // Zero-credit calls are rejected.
        vm.prank(fakeHarvester);
        vm.expectRevert(YieldShares.ZeroHarvest.selector);
        vault.harvest(0);
    }

    function test_harvesterStartsUnset() public {
        assertEq(vault.harvester(), address(0));
        spy.mint(alice, 1e18);
        vm.startPrank(alice);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(1e18, alice);
        vm.stopPrank();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.NotHarvester.selector, alice));
        vault.harvest(1);
    }

    // ------------------------------------------------------------------
    // Invariant 5: pause semantics — deposits blockable, redemptions NEVER
    // ------------------------------------------------------------------

    function test_pause_byTimelock_depositsBlocked_redeemsNever() public {
        spy.mint(alice, 20e18);
        vm.startPrank(alice);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(10e18, alice);
        vm.stopPrank();

        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setDepositPaused, (true)));
        assertTrue(vault.depositsPaused());
        assertEq(vault.maxDeposit(alice), 0);
        assertEq(vault.maxMint(alice), 0);

        vm.startPrank(alice);
        // With maxDeposit/maxMint reporting 0 while paused, the public entries revert
        // with the ERC-4626 max-exceeded error (the internal DepositsPaused error
        // stays as a backstop on the _deposit path).
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, alice, 1e18, 0)
        );
        vault.deposit(1e18, alice);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxMint.selector, alice, 1e24, 0)
        );
        vault.mint(1e24, alice);

        // THE critical guarantee: redeem/withdraw are fully functional while paused.
        uint256 shares = vault.balanceOf(alice);
        uint256 out = vault.redeem(shares, alice, alice);
        assertEq(out, 10e18);
        vm.stopPrank();

        // Timelock can unpause again.
        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setDepositPaused, (false)));
        assertFalse(vault.depositsPaused());
        assertEq(vault.maxDeposit(alice), type(uint256).max);
    }

    function test_pause_byPauserEoa() public {
        spy.mint(alice, 10e18);
        vm.startPrank(alice);
        spy.approve(address(vault), type(uint256).max);
        vault.deposit(10e18, alice);
        vm.stopPrank();

        // The function-limited pause EOA can pause AND unpause — and nothing else is
        // reachable through it (this is its only function).
        vm.prank(pauser);
        vault.setDepositPaused(true);
        assertTrue(vault.depositsPaused());
        // Deposits blocked while the pauser EOA holds the pause...
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxDeposit.selector, alice, 1e18, 0)
        );
        vault.deposit(1e18, alice);

        vm.prank(pauser);
        vault.setDepositPaused(false);
        assertFalse(vault.depositsPaused());
        spy.mint(alice, 1e18);
        vm.prank(alice);
        vault.deposit(1e18, alice); // ...and work again after unpause

        // A random account is not a pauser.
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.NotPauser.selector, attacker));
        vault.setDepositPaused(true);
    }

    function test_pause_roleRevocableByTimelock() public {
        // The compromised-pause-key scenario: the timelock strips the role, after
        // which the old EOA can no longer touch the flag — but the timelock still can.
        vm.prank(pauser);
        vault.setDepositPaused(true);
        vm.prank(pauser);
        vault.setDepositPaused(false);

        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setPauser, (address(0))));
        assertEq(vault.pauser(), address(0));

        vm.prank(pauser);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.NotPauser.selector, pauser));
        vault.setDepositPaused(true);

        // Timelock retains the pause power after revoking the EOA.
        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setDepositPaused, (true)));
        assertTrue(vault.depositsPaused());
    }

    function test_pause_nonTimelockCannotSetFeeOrHarvesterOrPauser() public {
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.NotTimelock.selector, attacker));
        vault.setFeeBps(500);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.NotTimelock.selector, attacker));
        vault.setHarvester(attacker);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.NotTimelock.selector, attacker));
        vault.setPauser(attacker);
    }

    // ------------------------------------------------------------------
    // Invariant 6: fee cap, timelock-only
    // ------------------------------------------------------------------

    function test_feeCap() public {
        // Direct as the timelock sender: the cap reverts at the vault.
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(YieldShares.FeeTooHigh.selector, 2001, 2000));
        vault.setFeeBps(2001);

        // Through the real 48h queue: an over-cap queued call simply fails to execute.
        bytes memory data = abi.encodeCall(YieldShares.setFeeBps, (2001));
        vm.prank(proposer);
        bytes32 id = timelock.queue(address(vault), 0, data, bytes32(0));
        vm.warp(block.timestamp + 48 hours);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.ExecutionFailed.selector, id));
        timelock.execute(address(vault), 0, data, bytes32(0));
        assertEq(vault.feeBps(), 1000);

        // Valid values at and below the cap go through (and 0 = fully depositor-owned).
        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setFeeBps, (2000)));
        assertEq(vault.feeBps(), 2000);
        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setFeeBps, (0)));
        assertEq(vault.feeBps(), 0);

        // Constructor rejects an over-cap initial fee.
        vm.expectRevert(abi.encodeWithSelector(YieldShares.FeeTooHigh.selector, 2001, 2000));
        new YieldShares(IERC20(address(spy)), "x", "x", address(timelock), pauser, 2001);
    }
}
