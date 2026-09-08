// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RoamVault} from "../../src/RoamVault.sol";
import {RoamingHarvester, IPoolManagerV4} from "../../src/RoamingHarvester.sol";
import {RoamAllowlist} from "../../src/RoamAllowlist.sol";
import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockPoolManager, MockQuoter, MockStateView, MockSixDecToken, IMockPoolManager, IMockTake} from "../RoamVault.t.sol";

/// @dev The 1:1 mock stack is imported from the unit battery (etched at the PINNED
///      fork addresses there); the handler replays the same wiring.
///
/// @notice ROAMVAULT stateful invariant battery. The handler drives the vault through
///         its FULL reachable state: deposits (both routes), the deposit-pause
///         toggle, Safe-queued timelock deploys into the allowlisted book (the
///         DEPLOYED-CAPITAL state), roamer-gated IL marks (losses AND gains), and
///         redemptions — while positions are open AND while deposits are paused.
///         TWO hand-written invariants:
///          1. invariant_RedeemNeverTrapped — the house invariant EXTENDED with the
///             deployed-capital state: every handler-reachable redeem of a user's
///             OWN shares succeeds (idle-first serving + pro-rata decrease-only
///             egress), including while deposits are PAUSED and while vault-tagged
///             positions are OPEN. Redemptions are structurally unpausable; depositor
///             exits are never gated by roamer MIN_HOLD. (Precedent:
///             YieldSharesInvariants.t.sol:33.)
///          2. invariant_BooksConsistent — the idle book is always physically
///             covered (idle <= raw balance), the deployed book never exceeds its
///             deploy-time par (IL gains restore only up to par), and the accounted
///             total is exactly idle + deployed.
contract RoamVaultInvariantsTest is Test {
    Handler internal handler;

    function setUp() public {
        handler = new Handler();
        handler.anchor();
        targetContract(address(handler));
        // Restrict the fuzzer to the REAL state-machine ops (a re-run of the
        // constructor wiring mid-sequence is not a reachable protocol state).
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = Handler.deposit.selector;
        selectors[1] = Handler.mint.selector;
        selectors[2] = Handler.redeem.selector;
        selectors[3] = Handler.togglePause.selector;
        selectors[4] = Handler.timelockDeploy.selector;
        selectors[5] = Handler.applyIl.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_RedeemNeverTrapped() public view {
        assertFalse(
            handler.ghost_redeemViolation(),
            handler.ghost_redeemReason().length > 0 ? string(handler.ghost_redeemReason()) : "a bounded standard-asset redeem failed"
        );
        assertTrue(handler.vault().harvester() != address(0), "the handler never wired the roamer");
    }

    function invariant_BooksConsistent() public view {
        RoamVault vault = handler.vault();
        assertLe(vault.idleBook(), IERC20(vault.asset()).balanceOf(address(vault)), "idle book exceeds the raw balance");
        assertLe(vault.deployedBook(), vault.deployedPar(), "the deployed book exceeded deploy-time par");
        assertEq(vault.totalAssets(), vault.idleBook() + vault.deployedBook(), "totalAssets != idle + deployed");
    }
}

/// @dev The bounded state machine. Every op bounds its inputs against live views;
///      the ONLY recorded violation class is a failed bounded redeem.
contract Handler is Test, IMockTake {
    // Pinned fork addresses (the mocks are etched here — shared with the unit battery).
    address constant PM_PIN = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant QUOTER_PIN = 0x076838736F90Cd1d30dED756A3B89E576BE972F8;
    address constant STATEVIEW_PIN = 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2;

    uint24 constant FEE = 3000;
    int24 constant LO = -887220;
    int24 constant HI = 887220;

    MockSixDecToken usdg;
    MockSixDecToken spy;
    WellstreetTimelock timelock;
    RoamAllowlist allowlist;
    RoamingHarvester roamer;
    RoamVault public vault;

    address proposer = makeAddr("wellstreet-deployer");
    address pauser = makeAddr("pause-eoa");
    address[3] users;

    bool public ghost_redeemViolation;
    bytes public ghost_redeemReason;

    event RedeemFailed(address user, uint256 shares, bytes reason);

    IPoolManagerV4.PoolKey book;

    /// @dev Called from setUp (AFTER construction - the mock pool's take() calls
    ///      back into THIS contract's mockTake, which needs the deployed code).
    ///      NOT a fuzz target: targetSelector restricts the fuzzer to the ops.
    function anchor() public {
        vm.warp(1_800_000_000); // the rolling-365d math needs a sane base time
        usdg = new MockSixDecToken("USDG");
        spy = new MockSixDecToken("SPY");
        vm.prank(proposer);
        timelock = new WellstreetTimelock(proposer, 48 hours);
        allowlist = new RoamAllowlist(address(timelock));
        roamer = new RoamingHarvester(address(timelock), makeAddr("roam-treasury"), address(allowlist), 7 days, 4, 3911, 1000);
        vault = new RoamVault(IERC20(address(usdg)), "Wellstreet Roam", "ws-ROAM", address(timelock), pauser, 25_000e6);

        MockPoolManager pm = new MockPoolManager(address(this));
        vm.etch(PM_PIN, address(pm).code);
        IMockPoolManager(PM_PIN).init(address(roamer));
        MockQuoter q = new MockQuoter();
        vm.etch(QUOTER_PIN, address(q).code);
        MockStateView sv = new MockStateView();
        vm.etch(STATEVIEW_PIN, address(sv).code);

        book = IPoolManagerV4.PoolKey({currency0: address(spy), currency1: address(usdg), fee: FEE, tickSpacing: 60, hooks: address(0)});

        RoamAllowlist.BookMeta memory meta = RoamAllowlist.BookMeta({minTvlUsd1e6: 0, drainShockChecked: true, addedAt: 0});
        _timelockExecute(
            address(allowlist),
            abi.encodeCall(RoamAllowlist.addBook, (RoamAllowlist.PoolKey({
                currency0: address(spy), currency1: address(usdg), fee: FEE, tickSpacing: 60, hooks: address(0)
            }), meta))
        );
        _timelockExecute(address(roamer), abi.encodeCall(RoamingHarvester.setVault, (address(vault), address(usdg))));
        _timelockExecute(address(vault), abi.encodeCall(RoamVault.setHarvester, (address(roamer))));
        vm.prank(pauser);
        vault.setDepositPaused(false);

        for (uint256 i = 0; i < 3; i++) {
            users[i] = makeAddr(string.concat("roam-user-", vm.toString(i)));
            usdg.mint(users[i], 1_000_000e6);
            vm.startPrank(users[i]);
            usdg.approve(address(vault), type(uint256).max);
            vault.deposit(1_000e6, users[i]); // seed balances so redeems are reachable
            vm.stopPrank();
        }
        _timelockDeploy(2_000e6); // enter the DEPLOYED-CAPITAL state from the start
    }

    function mockTake(address currency, address to, uint256 amount) external {
        require(msg.sender == PM_PIN, "mockTake: not the pinned PM");
        MockERC20(currency).mint(to, amount);
    }

    // ------------------------------------------------------------------
    // Ops (forge fuzzer driven; every input bounded against live views)
    // ------------------------------------------------------------------

    /// @notice Deposit via the deposit route (headroom-bounded).
    function deposit(uint256 userSeed, uint256 assets) external {
        address user = users[userSeed % 3];
        uint256 headroom = vault.maxDeposit(user);
        if (headroom == 0) return;
        assets = bound(assets, 1, Math.min(headroom, 2_000e6));
        vm.prank(user);
        vault.deposit(assets, user);
    }

    /// @notice Deposit via the MINT route (the same cap, by construction).
    function mint(uint256 userSeed, uint256 shares) external {
        address user = users[userSeed % 3];
        uint256 headroom = vault.maxMint(user);
        if (headroom == 0) return;
        shares = bound(shares, 1, Math.min(headroom, 2_000e6));
        vm.prank(user);
        vault.mint(shares, user);
    }

    /// @notice Toggle the DEPOSIT pause. Redemptions stay live (the invariant).
    function togglePause() external {
        bool paused = vault.depositsPaused(); // hoisted: a staticcall consumes vm.prank
        vm.prank(pauser);
        vault.setDepositPaused(!paused);
    }

    /// @notice Safe-queued timelock deploy: moves idle capital into the book (the
    ///         DEPLOYED-CAPITAL state — positions open while deposits may be paused).
    function timelockDeploy(uint256 assets) external {
        _timelockDeploy(assets);
    }

    /// @notice A roamer-gated realized-IL mark: losses write the share price DOWN
    ///         (floored at zero), gains restore only up to deploy-time par.
    function applyIl(int256 il) external {
        uint256 book0 = vault.deployedBook();
        int256 bounded = il;
        if (bounded >= 0) {
            bounded = int256(bound(uint256(bounded), 0, Math.max(book0, 1) * 2)); // can over-debit (floored)
        } else {
            bounded = -int256(bound(uint256(-bounded), 0, 500e6)); // gains restore toward par
        }
        vm.prank(address(roamer));
        vault.applyRealizedIL(bounded, address(usdg));
    }

    /// @notice REDEEM a user's OWN shares — never may fail (idle-first + pro-rata
    ///         decrease-only egress), never gated by the pause, never gated by
    ///         MIN_HOLD. Any revert is the invariant violation.
    function redeem(uint256 userSeed, uint256 pct) external {
        address user = users[userSeed % 3];
        uint256 bal = vault.balanceOf(user);
        if (bal == 0) return;
        uint256 shares = bound(pct, 1, bal);
        vm.prank(user); // the user redeems their OWN shares (caller == owner)
        try vault.redeem(shares, user, user) {
            // served: idle-first, then pro-rata slice closes
        } catch (bytes memory reason) {
            ghost_redeemViolation = true;
            ghost_redeemReason = reason;
            emit RedeemFailed(user, shares, reason);
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _timelockDeploy(uint256 assets) internal {
        uint256 idle = vault.idleBook();
        if (idle < 100e6) return; // below the dust floor the band math rejects (lFinal == 0)
        assets = bound(assets, 100e6, Math.min(idle, 1_000e6));
        bytes memory key =
            abi.encode(RoamingHarvester.BookKey({poolKey: book, tickLower: LO, tickUpper: HI, salt: 0}));
        _timelockExecute(address(vault), abi.encodeCall(RoamVault.vaultDeploy, (key, assets)));
    }

    function _timelockExecute(address target, bytes memory data) internal {
        vm.prank(proposer);
        timelock.queue(target, 0, data, bytes32(0));
        vm.warp(block.timestamp + 48 hours + 1);
        timelock.execute(target, 0, data, bytes32(0));
    }
}
