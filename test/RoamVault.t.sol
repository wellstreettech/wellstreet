// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {RoamVault} from "../src/RoamVault.sol";
import {RoamingHarvester, IPoolManagerV4} from "../src/RoamingHarvester.sol";
import {RoamAllowlist} from "../src/RoamAllowlist.sol";
import {WellstreetTimelock} from "../src/WellstreetTimelock.sol";
import {MockERC20, MockFeeOnTransferToken} from "./mocks/MockERC20.sol";

/// @dev Test-side surfaces for the mocks etched at the PINNED fork addresses (the
///      roamer hardcodes the RH-4663 PoolManager / Quoter / StateView — the unit
///      battery etches 1:1 mocks THERE so the real code paths run unmodified; the
///      fork battery proves the LIVE stack).
interface IMockPoolManager {
    function init(address roamer_) external;
    function queueFees(
        IPoolManagerV4.PoolKey calldata key,
        int24 tickLower,
        int24 tickUpper,
        bytes32 salt,
        uint256 f0,
        uint256 f1
    ) external;
    function positionLiquidity(bytes32 kHash) external view returns (uint128);
}

interface IMockTake {
    function mockTake(address currency, address to, uint256 amount) external;
}

/// @notice ROAMVAULT unit battery — the vault + roamer wiring against the 1:1 mock
///         fork stack (real contract code paths, deterministic prices). The LIVE
///         4663 proofs live in test/fork/RoamVaultFork.t.sol. Covers the goal's
///         named tests: deposit/mint-route caps, init-pause, idle-first redemption,
///         realized-IL share-price write-down (underflow-safe), migrationFee zero on
///         the vault path, deploy-residual return-to-vault, 10% BURN-PENDING
///         conservation pre/post setWellToken, 90%-lane liveness pre-setWellToken,
///         and the custody-separation guards.
contract RoamVaultTest is Test, IMockTake {
    // Pinned fork stack (the roamer's constants — mocks are etched there).
    address constant PM_PIN = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant QUOTER_PIN = 0x076838736F90Cd1d30dED756A3B89E576BE972F8;
    address constant STATEVIEW_PIN = 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint24 constant FEE = 3000;
    int24 constant LO = -887220; // ts-60 full-range bounds (house pin)
    int24 constant HI = 887220;

    MockSixDecToken usdg;
    MockSixDecToken spy;
    WellstreetTimelock timelock;
    RoamAllowlist allowlist;
    RoamingHarvester roamer;
    RoamVault vault;

    address proposer = makeAddr("wellstreet-deployer");
    address pauser = makeAddr("pause-eoa");
    address treasuryAddr = makeAddr("roam-treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    IPoolManagerV4.PoolKey book;

    bytes32 SIG_MIGRATION_FEE = keccak256("MigrationFeeCharged(bytes32,uint256,uint256,uint32)");
    bytes32 SIG_REALIZED_IL = keccak256("RealizedIL(bytes32,int256,address)");
    bytes32 SIG_VAULT_IL = keccak256("VaultILApplied(int256,address,uint256,bool)");
    bytes32 SIG_BURNED = keccak256("Burned(address,uint256,uint256)");

    function _kHash(IPoolManagerV4.PoolKey memory k, int24 lo, int24 hi, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(k, lo, hi, salt));
    }

    function setUp() public {
        vm.warp(1_800_000_000); // sane base time: the roamer's rolling-365d math
        // (block.timestamp - MIGRATION_PERIOD) underflows at forge's t=1 default.
        usdg = new MockSixDecToken("USDG"); // 6 decimals, 1:1 raw with the SPY mock
        spy = new MockSixDecToken("SPY");
        vm.prank(proposer);
        timelock = new WellstreetTimelock(proposer, 48 hours);
        allowlist = new RoamAllowlist(address(timelock));
        roamer = new RoamingHarvester(
            address(timelock), treasuryAddr, address(allowlist),
            7 days /* MIN_HOLD start */, 4 /* cap start */, 3911 /* gain floor */, 1000 /* migrationFeeBps start */
        );
        vault = new RoamVault(IERC20(address(usdg)), "Wellstreet Roam", "ws-ROAM", address(timelock), pauser, 25_000e6);

        // Etch the 1:1 mock stack at the PINNED addresses (the roamer's constants are
        // the truth — the mock immutables survive the etch; storage is re-initialized
        // through the pinned address).
        MockPoolManager pm = new MockPoolManager(address(this));
        vm.etch(PM_PIN, address(pm).code);
        IMockPoolManager(PM_PIN).init(address(roamer));
        MockQuoter q = new MockQuoter();
        vm.etch(QUOTER_PIN, address(q).code);
        MockStateView sv = new MockStateView();
        vm.etch(STATEVIEW_PIN, address(sv).code);

        book = IPoolManagerV4.PoolKey({currency0: address(spy), currency1: address(usdg), fee: FEE, tickSpacing: 60, hooks: address(0)});

        // Governance rail: allowlist the book + BOTH bindings (setVault ONE-SHOT on
        // the roamer, setHarvester re-settable on the vault) through the 48h timelock.
        RoamAllowlist.BookMeta memory meta = RoamAllowlist.BookMeta({minTvlUsd1e6: 0, drainShockChecked: true, addedAt: 0});
        _timelockExecute(
            address(allowlist),
            abi.encodeCall(RoamAllowlist.addBook, (RoamAllowlist.PoolKey({
                currency0: address(spy), currency1: address(usdg), fee: FEE, tickSpacing: 60, hooks: address(0)
            }), meta))
        );
        _timelockExecute(address(roamer), abi.encodeCall(RoamingHarvester.setVault, (address(vault), address(usdg))));
        _timelockExecute(address(vault), abi.encodeCall(RoamVault.setHarvester, (address(roamer))));
        // Deposits OPEN (the constructor init-paused them — the safety-sequence pin).
        vm.prank(pauser);
        vault.setDepositPaused(false);

        usdg.mint(alice, 100_000e6);
        usdg.mint(bob, 100_000e6);
    }

    /// @dev Queue through the 48h timelock (proposer) -> warp -> permissionless
    ///      execute (house trust model).
    function _timelockExecute(address target, bytes memory data) internal {
        vm.prank(proposer);
        timelock.queue(target, 0, data, bytes32(0));
        vm.warp(block.timestamp + 48 hours + 1);
        timelock.execute(target, 0, data, bytes32(0));
    }

    // V-1 reentry device: armed by the regression test, the FIRST take() of an
    // in-flight egress calls back here and this contract (the mock PM's controller)
    // attempts to re-enter the vault's guarded surfaces from INSIDE the roamer
    // callback — exactly the mid-egress reentry shape the composition audit ruled on.
    bool private _reentryArmed;
    bool private _sawDepositBlocked;
    bool private _sawRedeemBlocked;
    bool private _sawHarvestBlocked;
    bytes4 private _depositErr;
    bytes4 private _redeemErr;
    bytes4 private _harvestErr;

    function mockTake(address currency, address to, uint256 amount) external {
        require(msg.sender == PM_PIN, "mockTake: not the pinned PM");
        if (_reentryArmed) {
            _reentryArmed = false; // one-shot: the first egress take attempts reentry
            (bool okDep, bytes memory retDep) = address(vault).call(abi.encodeCall(RoamVault.deposit, (1, address(this))));
            _sawDepositBlocked = !okDep;
            _depositErr = retDep.length >= 4 ? bytes4(retDep) : bytes4(0);
            (bool okRed, bytes memory retRed) = address(vault).call(abi.encodeCall(RoamVault.redeem, (1, address(this), address(this))));
            _sawRedeemBlocked = !okRed;
            _redeemErr = retRed.length >= 4 ? bytes4(retRed) : bytes4(0);
            (bool okHar, bytes memory retHar) = address(vault).call(abi.encodeCall(RoamVault.harvest, (1)));
            _sawHarvestBlocked = !okHar;
            _harvestErr = retHar.length >= 4 ? bytes4(retHar) : bytes4(0);
        }
        MockERC20(currency).mint(to, amount); // the 1:1 mock pool is an infinite faucet
    }

    function _bookKey(int24 lo, int24 hi, bytes32 salt) internal view returns (bytes memory) {
        return abi.encode(RoamingHarvester.BookKey({poolKey: book, tickLower: lo, tickUpper: hi, salt: salt}));
    }

    /// @dev Deposit from a user and deploy through the timelock (the deploy trigger
    ///      v1 — Safe-queued, permissionlessly executed).
    function _depositAndDeploy(address user, uint256 depositAmt, uint256 deployAmt)
        internal
        returns (bytes32 kHash, uint256 deployedVal, uint256 residual)
    {
        vm.startPrank(user);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(depositAmt, user);
        vm.stopPrank();
        vm.recordLogs();
        _timelockExecute(address(vault), abi.encodeCall(RoamVault.vaultDeploy, (_bookKey(LO, HI, 0), deployAmt)));
        (kHash, deployedVal, residual) = _decodeDeploy();
    }

    function _decodeDeploy() internal returns (bytes32 kHash, uint256 deployedVal, uint256 residual) {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bytes32 sig = keccak256("VaultBookDeployed(bytes32,uint256,uint256,uint256)");
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == sig && entries[i].emitter == address(roamer)) {
                uint256 capital;
                (capital, deployedVal, residual) = abi.decode(entries[i].data, (uint256, uint256, uint256));
                kHash = entries[i].topics[1];
            }
        }
    }

    // ------------------------------------------------------------------
    // Metadata + the SAFETY-SEQUENCE PIN (init-paused)
    // ------------------------------------------------------------------

    function test_metadata_and_initPaused() public {
        assertEq(vault.name(), "Wellstreet Roam");
        assertEq(vault.asset(), address(usdg));
        assertEq(vault.decimals(), 12); // 6 (asset) + 6 (virtual share offset)
        assertFalse(vault.depositsPaused(), "setUp opened deposits (constructor state proven on v2)");
        assertEq(vault.DEPOSIT_CAP(), 25_000e6, "deploy start cap");
        assertEq(vault.DEPOSIT_CAP_CEILING(), 250_000e6, "immutable ceiling");
        assertEq(vault.DEPOSITOR_BPS(), 9000, "90% depositors - named constant");
        assertEq(vault.BURN_BPS(), 1000, "10% burn - named constant");
        assertEq(vault.harvester(), address(roamer));
        // A fresh vault pauses AGAIN: redeploy and check the constructor state.
        RoamVault v2 = new RoamVault(IERC20(address(usdg)), "x", "x", address(timelock), pauser, 25_000e6);
        assertTrue(v2.depositsPaused(), "constructor never init-paused");
        vm.prank(alice);
        usdg.approve(address(v2), type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(); // maxDeposit(pause) == 0 -> ERC4626ExceededMaxDeposit gates first
        v2.deposit(1e6, alice);
    }

    // ------------------------------------------------------------------
    // Cap on BOTH routes (deposit + mint) + the immutable ceiling
    // ------------------------------------------------------------------

    function test_cap_enforcedOnBothRoutes() public {
        assertEq(vault.maxDeposit(alice), 25_000e6, "headroom = the cap");
        assertEq(vault.maxMint(alice), 25_000e6, "maxMint returns the SAME headroom");
        vm.startPrank(alice);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(25_000e6, alice);
        // Cap exhausted: BOTH routes revert.
        vm.expectRevert(); // ERC4626ExceededMaxDeposit
        vault.deposit(1, alice);
        vm.expectRevert(); // ERC4626ExceededMaxMint
        vault.mint(1, alice);
        vm.stopPrank();
    }

    function test_cap_mintRouteBlocked_too() public {
        vm.startPrank(alice);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(25_000e6, alice);
        assertEq(vault.maxMint(alice), 0, "headroom exhausted");
        vm.expectRevert(); // ERC4626ExceededMaxMint
        vault.mint(1, alice);
        vm.stopPrank();
        // Raise within the ceiling through the timelock; above it reverts.
        _timelockExecute(address(vault), abi.encodeCall(RoamVault.setDepositCap, (100_000e6)));
        assertEq(vault.maxMint(alice), 75_000e6, "headroom after the raise");
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(RoamVault.CapAboveCeiling.selector, 250_000e6 + 1, 250_000e6));
        vault.setDepositCap(250_000e6 + 1);
    }

    // ------------------------------------------------------------------
    // Idle-first redemption: a redemption covered by idle closes ZERO slices
    // ------------------------------------------------------------------

    function test_Redeem_ServesIdleFirst() public {
        (bytes32 kHash, , ) = _depositAndDeploy(alice, 2_000e6, 1_000e6);
        assertTrue(roamer.isVaultPosition(kHash), "position must be vault-tagged");
        uint256 liqBefore = roamer.positionRecord(kHash).liquidity;
        uint256 markedBefore = vault.deployedBook();
        // MORE idle on top (bob) — alice's full redeem is covered by idle.
        vm.startPrank(bob);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(3_000e6, bob);
        vm.stopPrank();
        uint256 idleBefore = vault.idleBook();
        assertGt(idleBefore, 2_000e6, "idle must cover alice's claim");

        vm.recordLogs();
        uint256 aliceShares = vault.balanceOf(alice); // hoisted: a state read consumes vm.prank
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        // ZERO slices: the position is untouched and no egress settled.
        assertEq(roamer.positionRecord(kHash).liquidity, liqBefore, "idle-covered redeem closed a slice");
        assertEq(vault.deployedBook(), markedBefore, "idle-covered redeem moved the deployed book");
        for (uint256 i = 0; i < entries.length; i++) {
            assertTrue(
                entries[i].topics[0] != keccak256("VaultEgressSettled(uint256,uint256)"),
                "idle-covered redeem must NOT settle an egress"
            );
        }
        assertEq(usdg.balanceOf(alice), 100_000e6 - 2_000e6 + 2_000e6, "alice redeemed her full claim");
        assertEq(usdg.balanceOf(bob), 100_000e6 - 3_000e6, "bob's deposit untouched");
    }

    // ------------------------------------------------------------------
    // Honest IL: the 90% harvest credit raises the share price, an IL mark
    // lowers it, underflow-safe at zero
    // ------------------------------------------------------------------

    function test_RealizedIL_WritesSharePriceDown() public {
        (bytes32 kHash, , ) = _depositAndDeploy(alice, 2_000e6, 1_000e6);
        uint256 shares = vault.balanceOf(alice);
        assertEq(vault.convertToAssets(shares), 2_000e6, "deploy marks at par (price unmoved)");

        // 90% lane credit raises the price: real fees on the vault book, the vault
        // sweep pushes 90% of the USDG fee in via the excess-bounded harvest seam.
        IMockPoolManager(PM_PIN).queueFees(book, LO, HI, bytes32(uint256(1)), 0, 100e6);
        roamer.sweepVaultYield();
        uint256 priceAfterYield = vault.convertToAssets(shares);
        assertGt(priceAfterYield, 2_000e6, "the 90% harvest credit must RAISE the share price");

        // An IL mark lowers the price (the roamer-gated seam).
        vm.startPrank(address(roamer)); // startPrank survives the expectEmit cheatcode
        vm.expectEmit(true, true, false, true, address(vault));
        emit RoamVault.VaultILApplied(200e6, address(usdg), vault.deployedBook() - 200e6, true);
        vault.applyRealizedIL(200e6, address(usdg)); // roamer convention: >= 0 is a LOSS
        vm.stopPrank();
        assertLt(vault.convertToAssets(shares), priceAfterYield, "an IL mark must LOWER the share price");

        // Underflow-safe at zero: a loss beyond the book floors it at 0, never panics.
        vm.prank(address(roamer));
        vault.applyRealizedIL(1e30, address(usdg));
        assertEq(vault.deployedBook(), 0, "the deployed book never goes negative");
        vm.prank(alice);
        vault.redeem(shares, alice, alice); // redemption still live after a total write-down
        assertGt(usdg.balanceOf(alice), 100_000e6 - 2_000e6, "redeemer recovered value");

        // A GAIN restores only up to deploy-time par (write-up above par is
        // proceeds' job, never a mark's).
        uint256 par = vault.deployedPar();
        vm.prank(address(roamer));
        vault.applyRealizedIL(-1e30, address(usdg));
        assertEq(vault.deployedBook(), par, "gain restore capped at deploy-time par");
        assertEq(vault.pendingIlByCurrency(address(spy)), 0, "sanity");

        // A foreign-denomination mark is RECORDED and surfaced, never applied.
        vm.prank(address(roamer));
        vault.applyRealizedIL(5e18, address(spy));
        assertEq(vault.pendingIlByCurrency(address(spy)), 5e18, "non-USDG mark not recorded");
        assertEq(vault.deployedBook(), par, "a non-USDG mark must NOT move the USDG book");
    }

    // ------------------------------------------------------------------
    // migrationFeeBps = STRUCTURALLY ZERO on the vault path (POL keeps it)
    // ------------------------------------------------------------------

    function test_MigrationFeeZero_VaultPath() public {
        (bytes32 vHash, , ) = _depositAndDeploy(alice, 2_000e6, 1_000e6);
        RoamingHarvester.Position memory pos = roamer.positionRecord(vHash);
        vm.warp(block.timestamp + 7 days + 1); // past the seed-anchored MIN_HOLD

        vm.recordLogs();
        vm.prank(bob); // permissionless
        roamer.migrate(
            abi.encode(RoamingHarvester.BookKey({poolKey: pos.poolKey, tickLower: pos.tickLower, tickUpper: pos.tickUpper, salt: pos.salt})),
            _bookKey(LO, HI, 0), // re-range on the same (allowlisted) book
            [uint256(1), uint256(1)],
            4000
        );
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool sawFee;
        bool sawVaultIL;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == SIG_MIGRATION_FEE) {
                (uint256 f0, uint256 f1, uint32 bps) = abi.decode(entries[i].data, (uint256, uint256, uint32));
                assertEq(f0, 0, "VAULT path charged a migration fee on leg0");
                assertEq(f1, 0, "VAULT path charged a migration fee on leg1");
                assertEq(bps, 0, "the applied take must read 0 on the vault branch");
                sawFee = true;
            }
            if (entries[i].topics[0] == SIG_VAULT_IL) sawVaultIL = true;
        }
        assertTrue(sawFee, "MigrationFeeCharged not emitted");
        assertTrue(sawVaultIL, "the vault-IL report did not land at migration completion");
        // Custody continuity: the NEW position inherits the vault tag.
        assertTrue(roamer.isVaultPosition(roamer.openKeys(0)), "the migrated position lost the vault tag");
        assertTrue(vault.deployedBook() > 0, "the deployed book emptied on a flat re-range");

        // The POL lane keeps the roaming take: seed a POL position and migrate it.
        spy.mint(address(roamer), 200_000e6);
        usdg.mint(address(roamer), 200_000e6);
        _timelockExecute(
            address(roamer), abi.encodeCall(RoamingHarvester.seedBook, (_bookKey(LO, HI, 0), 100_000e6))
        );
        RoamingHarvester.Position memory pol = roamer.positionRecord(roamer.openKeys(1));
        assertFalse(roamer.isVaultPosition(roamer.openKeys(1)), "a POL seed must NOT be vault-tagged");
        vm.warp(block.timestamp + 7 days + 1);
        vm.recordLogs();
        vm.prank(bob);
        roamer.migrate(
            abi.encode(RoamingHarvester.BookKey({poolKey: pol.poolKey, tickLower: pol.tickLower, tickUpper: pol.tickUpper, salt: pol.salt})),
            _bookKey(LO, HI, 0),
            [uint256(1), uint256(1)],
            4000
        );
        entries = vm.getRecordedLogs();
        bool sawPolFee;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == SIG_MIGRATION_FEE) {
                (uint256 f0, uint256 f1, uint32 bps) = abi.decode(entries[i].data, (uint256, uint256, uint32));
                assertGt(f0 + f1, 0, "the POL lane lost its roaming take");
                assertEq(bps, 1000, "the POL fee value moved - the branch leaked to the global");
                sawPolFee = true;
            }
        }
        assertTrue(sawPolFee, "POL MigrationFeeCharged not emitted");
    }

    // ------------------------------------------------------------------
    // Deploy residuals return to the VAULT, never the burn accrual
    // ------------------------------------------------------------------

    function test_DeployResidual_ReturnsToVault() public {
        uint256 idleBefore = vault.idleBook();
        uint256 accrualBefore = roamer.accountedAccrued(address(usdg));
        (, uint256 deployedVal, uint256 residual) = _depositAndDeploy(alice, 2_000e6, 1_000e6);
        assertGt(deployedVal, 0, "nothing deployed");
        assertGt(residual, 0, "the 1:1 sizing margin must leave a residual");
        // The idle book: debited by the capital, credited back by the residual.
        assertEq(vault.idleBook(), idleBefore + 2_000e6 - 1_000e6 + residual, "residual not credited to the idle book");
        assertEq(vault.deployedBook(), deployedVal, "the deployed book != the deployed value");
        assertEq(vault.deployedPar(), deployedVal, "deploy-time par != the deployed value");
        // No vault capital idles inside the roamer; the residual never touched the
        // burn accrual.
        assertEq(usdg.balanceOf(address(roamer)), 0, "vault USDG idled inside the roamer");
        assertEq(roamer.accountedAccrued(address(usdg)), accrualBefore, "a deploy residual entered the burn accrual");
        assertEq(roamer.vaultAccrued(address(usdg)), 0, "a deploy residual entered the vault yield bucket");
    }

    // ------------------------------------------------------------------
    // The 90/10 split: 10% BURN-PENDING conservation pre/post setWellToken,
    // 90%-lane liveness pre-setWellToken
    // ------------------------------------------------------------------

    function test_BurnPendingConserved() public {
        (bytes32 kh, , ) = _depositAndDeploy(alice, 2_000e6, 1_000e6);
        uint256 idleAfterDeploy = vault.idleBook(); // the deploy residual, by design
        assertGt(idleAfterDeploy, 0, "the deploy left no residual to observe");
        uint256 fee = 100e6;
        IMockPoolManager(PM_PIN).queueFees(book, LO, HI, bytes32(uint256(1)), 0, fee);

        // PRE setWellToken: sweepToBurn is fail-closed INERT (NoWellToken)...
        vm.expectRevert(RoamingHarvester.NoWellToken.selector);
        roamer.sweepToBurn();
        // ...but the 90% lane is LIVE (WELL-independent) and conserves the 10%.
        roamer.sweepVaultYield();
        assertEq(roamer.vaultAccrued(address(usdg)), 0, "the pushed bucket did not drain");
        assertEq(roamer.accountedAccrued(address(usdg)), fee / 10, "the 10% cut is not exactly BURN_BPS of the fee");
        assertEq(usdg.balanceOf(treasuryAddr), 0, "the 10% leaked to treasury (BURN-PENDING, not treasury)");
        assertEq(vault.idleBook(), idleAfterDeploy + (fee * 9) / 10, "the 90% push did not land as idle credit");

        // Conservation HOLDS until setWellToken: nothing burned, nothing lost.
        uint256 pendingBefore = roamer.accountedAccrued(address(usdg));
        roamer.sweepVaultYield(); // idempotent: no fees queued, nothing moves
        assertEq(roamer.accountedAccrued(address(usdg)), pendingBefore, "a no-fee sweep moved the BURN-PENDING accrual");

        // POST setWellToken: the conserved 10% burns (USDG IS the WELL stand-in).
        _timelockExecute(address(roamer), abi.encodeCall(RoamingHarvester.setWellToken, (address(usdg))));
        uint256 deadBefore = usdg.balanceOf(DEAD);
        vm.recordLogs();
        roamer.sweepToBurn();
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(usdg.balanceOf(DEAD) - deadBefore, fee / 10, "the conserved 10% did not burn");
        assertEq(roamer.accountedAccrued(address(usdg)), 0, "the accrual did not drain on the burn");
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == SIG_BURNED) {
                (uint256 bought, uint256 burnedAmt) = abi.decode(entries[i].data, (uint256, uint256));
                assertEq(bought, burnedAmt, "Burned bought != burned (nothing retained)");
                assertEq(bought, fee / 10, "the burn != the conserved 10%");
            }
        }
        assertEq(usdg.balanceOf(treasuryAddr), 0, "dev take != 0");
    }

    // ------------------------------------------------------------------
    // Custody separation: exitBook + rescueToTreasury fail closed on vault capital
    // ------------------------------------------------------------------

    function test_custody_guards_failClosed() public {
        (bytes32 vHash, , ) = _depositAndDeploy(alice, 2_000e6, 1_000e6);
        RoamingHarvester.Position memory pos = roamer.positionRecord(vHash);
        bytes memory vKey =
            abi.encode(RoamingHarvester.BookKey({poolKey: pos.poolKey, tickLower: pos.tickLower, tickUpper: pos.tickUpper, salt: pos.salt}));

        // exitBook on a VAULT position reverts (even for the timelock).
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.VaultPositionProtected.selector, vHash));
        roamer.exitBook(vKey, treasuryAddr);

        // rescueToTreasury reverts while vault-tagged positions exist.
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.VaultPositionProtected.selector, vHash));
        roamer.rescueToTreasury(address(usdg));

        // A POL position remains exitable (the guard is lane-scoped, not global).
        spy.mint(address(roamer), 200_000e6);
        usdg.mint(address(roamer), 200_000e6);
        _timelockExecute(address(roamer), abi.encodeCall(RoamingHarvester.seedBook, (_bookKey(LO, HI, 0), 100_000e6)));
        uint256 polIdx = roamer.openKeyCount() - 1;
        RoamingHarvester.Position memory pol = roamer.positionRecord(roamer.openKeys(polIdx));
        assertFalse(roamer.isVaultPosition(roamer.openKeys(polIdx)), "POL seed tagged");
        bytes memory polKey =
            abi.encode(RoamingHarvester.BookKey({poolKey: pol.poolKey, tickLower: pol.tickLower, tickUpper: pol.tickUpper, salt: pol.salt}));
        vm.prank(address(timelock));
        roamer.exitBook(polKey, treasuryAddr);
        assertGt(usdg.balanceOf(treasuryAddr), 0, "POL egress did not land at the treasury");
    }

    // ------------------------------------------------------------------
    // Egress liveness: a redeem with ZERO idle closes pro-rata slices
    // ------------------------------------------------------------------

    function test_redeem_withZeroIdle_closesSlices() public {
        (bytes32 kHash, , ) = _depositAndDeploy(alice, 2_000e6, 2_000e6); // deploy ALL idle
        // The deploy residual = the VAULT_DEPLOY_MARGIN_BPS plan headroom (5% of the
        // capital — the deficit-buy fee+impact guard) + band rounding; it credits the
        // idle book, and the egress below still settles the ~95% deployed shortfall.
        assertApproxEqAbs(vault.idleBook(), 2_000e6 * 500 / 10_000, 600_000, "the deploy residual is the plan-margin headroom + rounding");
        uint256 markedBefore = vault.deployedBook();
        uint256 claim = vault.convertToAssets(vault.balanceOf(alice));

        uint256 aliceShares = vault.balanceOf(alice); // hoisted: a state read consumes vm.prank
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);

        assertApproxEqAbs(usdg.balanceOf(alice) - (100_000e6 - 2_000e6), claim, 200_000, "payout ~= the marked claim (margin dust = the redeemer's slice)");
        assertLt(vault.deployedBook(), markedBefore, "the deployed book did not release");
        assertEq(vault.totalAssets(), 0, "the last redeemer drained the vault");
        assertEq(roamer.openKeyCount(), 0, "the slice close left a position open");
        assertEq(usdg.balanceOf(address(roamer)), 0, "egress dust stranded in the roamer");
        assertFalse(roamer.isVaultPosition(kHash), "a fully closed position kept the tag record");
    }

    function test_redeemWithMinOut_floorIsRedeemerBounded() public {
        _depositAndDeploy(alice, 2_000e6, 2_000e6);
        uint256 shares = vault.balanceOf(alice);
        uint256 claim = vault.convertToAssets(shares);
        // An achievable floor passes; an unreachable one reverts for THIS call only.
        vm.prank(alice);
        vault.redeemWithMinOut(shares / 2, alice, alice, claim / 4);
        vm.prank(alice);
        vm.expectRevert(); // PayoutBelowMin - an unreachable floor reverts THIS call only
        vault.redeemWithMinOut(shares / 2, alice, alice, claim);
        // The vault held NO floor of its own: the vanilla redeem stays live.
        vm.prank(alice);
        vault.redeem(shares / 2, alice, alice);
    }

    // ------------------------------------------------------------------
    // Fee-on-transfer rejection (audited chassis machinery, re-proven on the fork)
    // ------------------------------------------------------------------

    function test_feeOnTransferDepositReverts() public {
        MockFeeOnTransferToken fot = new MockFeeOnTransferToken();
        RoamVault fv = new RoamVault(IERC20(address(fot)), "x", "x", address(timelock), pauser, 25_000e6);
        vm.prank(pauser);
        fv.setDepositPaused(false);
        fot.mint(alice, 1_000e18); // raw amount 1000e6 (under the cap) despite 18 decimals
        vm.startPrank(alice);
        fot.approve(address(fv), type(uint256).max);
        vm.expectRevert(abi.encodeWithSelector(RoamVault.FeeOnTransferDetected.selector, 1000e6, 900e6));
        fv.deposit(1000e6, alice);
        vm.stopPrank();
    }

    // ------------------------------------------------------------------
    // Redeem is structurally UNPAUSABLE (the chassis redemptions-never pause)
    // ------------------------------------------------------------------

    function test_redemptionsNeverPausable() public {
        (bytes32 khx, , ) = _depositAndDeploy(alice, 2_000e6, 1_000e6);
        vm.prank(address(timelock));
        vault.setDepositPaused(true);
        assertTrue(vault.depositsPaused());
        assertEq(vault.maxDeposit(alice), 0, "paused deposits must read 0 headroom");
        assertEq(vault.maxMint(alice), 0, "paused mints must read 0 headroom");
        // Redemption while paused + while a position is open: LIVE.
        uint256 shares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(shares, alice, alice);
        assertGt(usdg.balanceOf(alice), 100_000e6 - 2_000e6, "a paused-state redeem failed");
    }

    // ------------------------------------------------------------------
    // The vaultDeploy reverts when the idle book cannot cover the capital
    // ------------------------------------------------------------------

    function test_vaultDeploy_cannotOverdrawIdle() public {
        vm.startPrank(alice);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(100e6, alice);
        vm.stopPrank();
        // The idle book bounds the deploy (called AS the timelock — the deploy rail).
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(RoamVault.DeployExceedsIdle.selector, 1_000e6, 100e6));
        vault.vaultDeploy(_bookKey(LO, HI, 0), 1_000e6);
        // Non-timelock deploy attempts revert.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RoamVault.NotTimelock.selector, alice));
        vault.vaultDeploy(_bookKey(LO, HI, 0), 1);
        // Unset harvester reverts.
        RoamVault v2 = new RoamVault(IERC20(address(usdg)), "x", "x", address(timelock), pauser, 25_000e6);
        vm.expectRevert(RoamVault.HarvesterRequired.selector);
        vm.prank(address(timelock));
        v2.vaultDeploy(_bookKey(LO, HI, 0), 1);
    }

    // ------------------------------------------------------------------
    // V-1 regression (COMPOSITION-AUDIT 2026-09-08, HIGH): the live redemption
    // path holds the vault's ONE ReentrancyGuard — a reentrant counterparty
    // inside the egress callback cannot re-enter ANY guarded vault surface
    // (deposit/redeem/harvest all revert on the guard), and the attempt moves
    // NOTHING. The reentry point is the mock pool's take() -> controller
    // callback, which fires mid-egress inside the roamer's own unlock frame.
    // ------------------------------------------------------------------

    function test_V1_redeemHoldsTheGuard_reentrantMidEgressAttemptsRevert() public {
        // The controller (this contract) holds USDG + approval so a reentrant
        // deposit attempt would SUCCEED were the guard not held (deposits are open,
        // cap headroom exists) — that is exactly the drain class V-1 closes.
        usdg.mint(address(this), 1_000e6);
        usdg.approve(address(vault), type(uint256).max);

        (bytes32 kHash, , ) = _depositAndDeploy(alice, 2_000e6, 2_000e6); // deploy ALL idle
        // Real fees on the vault book so the egress fee-collect takes() (which calls
        // back into this contract's mockTake — the mid-egress reentry point).
        IMockPoolManager(PM_PIN).queueFees(book, LO, HI, bytes32(uint256(1)), 0, 100e6);

        uint256 idleBefore = vault.idleBook();
        uint256 bookBefore = vault.deployedBook();
        uint256 parBefore = vault.deployedPar();
        uint256 supplyBefore = vault.totalSupply();
        uint256 controllerSharesBefore = vault.balanceOf(address(this));

        _reentryArmed = true;
        uint256 aliceShares = vault.balanceOf(alice); // hoisted: a state read consumes vm.prank
        uint256 claim = vault.convertToAssets(aliceShares);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);

        // ALL THREE reentrant attempts were blocked BY THE GUARD (the modifier fires
        // before any body logic — including harvest's NotHarvester check).
        assertTrue(_sawDepositBlocked, "a mid-egress reentrant deposit went through");
        assertEq(_depositErr, ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "deposit blocked by something other than the guard");
        assertTrue(_sawRedeemBlocked, "a mid-egress reentrant redeem went through");
        assertEq(_redeemErr, ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "redeem blocked by something other than the guard");
        assertTrue(_sawHarvestBlocked, "a mid-egress reentrant harvest went through");
        assertEq(_harvestErr, ReentrancyGuard.ReentrancyGuardReentrantCall.selector, "harvest blocked by something other than the guard");

        // The attempts moved NOTHING beyond the redeem's own settlement: no phantom
        // deposit/shares (supply = exactly the burn), the books debit EXACTLY the
        // claim, and par released exactly the shortfall — one unit, nothing extra.
        uint256 idlePaid = claim <= idleBefore ? claim : idleBefore;
        uint256 shortfall = claim - idlePaid;
        assertEq(vault.totalSupply(), supplyBefore - aliceShares, "the reentrant deposit minted shares");
        assertEq(vault.balanceOf(address(this)), controllerSharesBefore, "the reentrant deposit landed shares");
        assertEq(vault.idleBook() + vault.deployedBook(), idleBefore + bookBefore - claim, "the reentry moved the books beyond the claim");
        assertEq(vault.deployedPar(), parBefore - shortfall, "the reentry moved deploy-time par beyond the release");
        assertEq(roamer.openKeyCount(), 0, "the egress did not run to completion");
        assertFalse(roamer.isVaultPosition(kHash), "the tag survived the completed egress");
    }

    // ------------------------------------------------------------------
    // V-2 regression (COMPOSITION-AUDIT 2026-09-08, MEDIUM): once the LAST vault
    // position closes, the timelock rescue window opens — the rescue basis must
    // exclude the vaultAccrued bucket (depositor money is rescueable by NOBODY),
    // and the bucket still drains to the VAULT through the sweep lane.
    // ------------------------------------------------------------------

    function test_V2_rescueBasis_excludesVaultBucket_afterLastVaultPositionCloses() public {
        (bytes32 kHash, , ) = _depositAndDeploy(alice, 2_000e6, 2_000e6); // deploy ALL idle
        // Fees on BOTH legs: the egress fee-collect (fees FIRST, principal-side)
        // fills BOTH buckets — the SPY one has NO route once the position closes
        // (audit gap #10: the NoVaultRoute skip is conserved, never lost).
        IMockPoolManager(PM_PIN).queueFees(book, LO, HI, bytes32(uint256(1)), 50e6, 100e6);

        uint256 aliceShares = vault.balanceOf(alice); // hoisted: a state read consumes vm.prank
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);

        // The window is OPEN: the last vault position closed and its tag is gone.
        assertEq(roamer.openKeyCount(), 0, "the full exit left a position open");
        assertFalse(roamer.isVaultPosition(kHash), "the tag survived the full close");
        uint256 bucketUsdg = roamer.vaultAccrued(address(usdg));
        uint256 bucketSpy = roamer.vaultAccrued(address(spy));
        assertEq(bucketUsdg, 90e6, "the USDG 90% bucket did not fill at the egress collect");
        assertEq(bucketSpy, 45e6, "the SPY 90% bucket did not fill at the egress collect");

        // V-2: the timelock rescue runs INSIDE the window — it must NOT move the
        // buckets (the pre-fix basis, bal - accounted, physically included them).
        uint256 treasUsdgBefore = usdg.balanceOf(treasuryAddr);
        uint256 treasSpyBefore = spy.balanceOf(treasuryAddr);
        vm.prank(address(timelock));
        roamer.rescueToTreasury(address(usdg));
        vm.prank(address(timelock));
        roamer.rescueToTreasury(address(spy));
        assertEq(usdg.balanceOf(treasuryAddr), treasUsdgBefore, "the rescue swept the vault USDG bucket to treasury");
        assertEq(spy.balanceOf(treasuryAddr), treasSpyBefore, "the rescue swept the vault SPY bucket to treasury");
        assertEq(roamer.vaultAccrued(address(usdg)), bucketUsdg, "the USDG bucket moved on rescue");
        assertEq(roamer.vaultAccrued(address(spy)), bucketSpy, "the SPY bucket moved on rescue");
        // The basis is EXACT: only true junk (above accounted + the bucket) moves.
        assertEq(usdg.balanceOf(treasuryAddr) - treasUsdgBefore, _junkAbove(address(usdg)), "the USDG rescue basis != bal - accounted - vaultAccrued");
        assertEq(spy.balanceOf(treasuryAddr) - treasSpyBefore, _junkAbove(address(spy)), "the SPY rescue basis != bal - accounted - vaultAccrued");

        // The custody lane is intact: the sweep drains the USDG bucket INTO the
        // vault (idle credit), while the routeless SPY bucket is skipped+conserved.
        uint256 idleBeforeSweep = vault.idleBook();
        vm.recordLogs();
        roamer.sweepVaultYield();
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(vault.idleBook() - idleBeforeSweep, bucketUsdg, "the sweep did not push the USDG bucket into the vault");
        assertEq(roamer.vaultAccrued(address(usdg)), 0, "the pushed USDG bucket did not drain");
        assertEq(roamer.vaultAccrued(address(spy)), bucketSpy, "the routeless SPY bucket was not conserved");
        bool sawSpySkip;
        for (uint256 i = 0; i < entries.length; i++) {
            if (
                entries[i].topics[0] == keccak256("VaultYieldSkipped(address,bytes32)")
                    && entries[i].topics[1] == bytes32(uint256(uint160(address(spy))))
            ) {
                sawSpySkip = true;
            }
        }
        assertTrue(sawSpySkip, "the routeless SPY push did not emit VaultYieldSkipped");
    }

    /// @dev The junk the rescue is ALLOWED to move: raw balance above accounted
    ///      accrual + the vault bucket (the V-2-fixed rescue basis).
    function _junkAbove(address token) internal view returns (uint256) {
        uint256 bal = MockERC20(token).balanceOf(address(roamer));
        uint256 accounted = roamer.accountedAccrued(token) + roamer.vaultAccrued(token);
        return bal > accounted ? bal - accounted : 0;
    }

    // ------------------------------------------------------------------
    // V-3 regression (COMPOSITION-AUDIT 2026-09-08, MEDIUM): _deployedPar
    // DECREMENTS on egress — the IL-gain cap tracks the OUTSTANDING deploy-time
    // par (gross deployed minus par released), never the gross-ever figure.
    // ------------------------------------------------------------------

    function test_V3_parDecrementsOnEgress_gainCapTracksOutstandingPar() public {
        (bytes32 kHash, uint256 deployedVal, ) = _depositAndDeploy(alice, 2_000e6, 2_000e6);
        uint256 grossPar = vault.deployedPar();
        assertEq(grossPar, deployedVal, "deploy-time par != the deployed value");
        assertEq(vault.deployedBook(), grossPar, "the deployed book != par at deploy");
        assertTrue(roamer.isVaultPosition(kHash), "the deployed position is not tagged");
        uint256 idleBefore = vault.idleBook();

        // PARTIAL egress: redeem half the claim — the shortfall releases only a
        // slice of the position (the pro-rata decrease-only loop stops when filled).
        uint256 halfShares = vault.balanceOf(alice) / 2; // hoisted before the prank
        uint256 halfClaim = vault.previewRedeem(halfShares);
        vm.prank(alice);
        vault.redeem(halfShares, alice, alice);
        assertTrue(halfClaim > idleBefore, "test premise: the half claim must exceed idle (the egress must run)");
        uint256 released = halfClaim - idleBefore; // the egress request (the shortfall)

        // V-3: par releases WITH the book — outstanding par = gross - released.
        assertEq(vault.deployedBook(), grossPar - released, "the book did not release the shortfall");
        assertEq(vault.deployedPar(), grossPar - released, "STALE PAR: the egress release did not decrement deploy-time par");
        assertLt(vault.deployedPar(), grossPar, "par did not move on egress");
        assertEq(roamer.openKeyCount(), 1, "a partial egress closed the whole position");

        // A GENUINE GAIN restores the book only to the OUTSTANDING par — the stale
        // gross-ever par would have let the mark restore ABOVE the outstanding
        // figure (the share-price-inflation-via-marks primitive the cap exists to
        // close; DECISION 9).
        vm.prank(address(roamer));
        vault.applyRealizedIL(-1e30, address(usdg)); // a huge honest-gain mark (capped)
        assertEq(vault.deployedBook(), vault.deployedPar(), "the gain cap no longer tracks the outstanding par");
        assertEq(vault.deployedBook(), grossPar - released, "the gain restored above the outstanding par");
    }

    // ------------------------------------------------------------------
    // V-4 regression (COMPOSITION-AUDIT 2026-09-08, MEDIUM): setVault
    // cross-checks the bound vault's ACTUAL asset() against the bound
    // denomination — a mis-wired pair would mis-price every later deploy.
    // ------------------------------------------------------------------

    function test_V4_setVault_revertsOnVaultAssetMismatch() public {
        RoamingHarvester roamer2 = new RoamingHarvester(
            address(timelock), treasuryAddr, address(allowlist), 7 days, 4, 3911, 1000
        );
        // The mismatched binding reverts fail-closed (bound SPY, vault asset USDG).
        vm.prank(address(timelock));
        vm.expectRevert(
            abi.encodeWithSelector(RoamingHarvester.VaultAssetMismatch.selector, address(spy), address(usdg))
        );
        roamer2.setVault(address(vault), address(spy));
        // The failed attempt half-bound NOTHING...
        assertEq(roamer2.vault(), address(0), "the failed attempt left a binding behind");
        // ...and the CORRECT denomination still binds (the check does not break the
        // governance rail — the deploy flow's queued pair passes it).
        _timelockExecute(address(roamer2), abi.encodeCall(RoamingHarvester.setVault, (address(vault), address(usdg))));
        assertEq(roamer2.vault(), address(vault), "the correct binding failed");
        assertEq(roamer2.vaultAsset(), address(usdg), "the bound asset drifted");
        // The production binding is untouched.
        assertEq(roamer.vault(), address(vault), "the live binding moved");
        assertEq(roamer.vaultAsset(), address(usdg), "the live bound asset moved");
    }

    // ------------------------------------------------------------------
    // V-5 regression (COMPOSITION-AUDIT 2026-09-08, LOW): the clamp constant IS
    // canonical TickMath MAX_SQRT_RATIO - 1 — the TIGHTEST swap limit the fork
    // accepts (the pool rejects limits >= MAX_SQRT_RATIO with InvalidPrice). The
    // pre-fix wart sat canonical + 54,389,040 (ABOVE the rejection bound), so a
    // clamp into it could still be fork-rejected.
    // TEETH EXPOSED SUBTLETY: the pool's MAX_SQRT_RATIO is NOT
    // getSqrtRatioAtTick(MAX_TICK) — the table's own endpoint is 5,586,318 BELOW
    // the pool constant (at MIN_TICK the two coincide exactly). The table is the
    // honest TickMath; the pool constant is the rejection bound. The battery pins
    // BOTH so no future fix "corrects" the constant to either extreme.
    // ------------------------------------------------------------------

    function test_V5_maxSqrtMinusOne_isCanonicalTickMathMaxMinusOne() public {
        assertEq(
            uint256(roamer.MAX_SQRT_MINUS_1()),
            uint256(1461446703485210103287273052203988822378729556659),
            "MAX_SQRT_MINUS_1 is not canonical MAX_SQRT_RATIO - 1"
        );
        // The clamp ceiling sits ABOVE the table's own extreme output (the table
        // endpoint is canonical MAX_SQRT_RATIO - 5,586,318): a limit clamped to
        // MAX_SQRT_MINUS_1 is always INSIDE the pool's accepted range, and never
        // below what the table itself considers a valid price.
        assertGe(
            uint256(roamer.MAX_SQRT_MINUS_1()) + 1,
            uint256(roamer.sqrtRatioAtTick(887272)),
            "the clamp ceiling fell below the table's own MAX_TICK output"
        );
        // The MIN side pins the table anchor exactly (MIN_SQRT_PLUS_1 == the first
        // accepted limit above MIN_SQRT_RATIO == the table's MIN_TICK output + 1).
        assertEq(uint256(roamer.sqrtRatioAtTick(-887272)), 4295128739, "the table's MIN_TICK anchor moved");
    }

    // ------------------------------------------------------------------
    // Audit test-gap #6: the withdraw() route end-to-end (only redeem was
    // exercised everywhere; the :348 override is its own entry into _redeem).
    // ------------------------------------------------------------------

    function test_gap6_withdrawRoute_endToEnd_egress() public {
        (bytes32 kHash, , ) = _depositAndDeploy(alice, 2_000e6, 2_000e6); // deploy ALL idle
        uint256 claim = vault.convertToAssets(vault.balanceOf(alice));
        vm.prank(alice);
        vault.withdraw(claim, alice, alice); // the withdraw override — its own _redeem entry
        assertApproxEqAbs(usdg.balanceOf(alice) - (100_000e6 - 2_000e6), claim, 200_000, "the withdraw route underpaid");
        assertEq(vault.totalAssets(), 0, "the last withdrawer drained the vault");
        assertEq(roamer.openKeyCount(), 0, "the withdraw-route egress left a position open");
        assertFalse(roamer.isVaultPosition(kHash), "the tag survived the withdraw-route close");
    }

    // ------------------------------------------------------------------
    // Audit test-gap #5: MULTI-POSITION pro-rata egress — a shortfall that
    // straddles two vault books closes slices on BOTH (every prior egress
    // proof was single-position).
    // ------------------------------------------------------------------

    function test_gap5_multiPositionEgress_proRataAcrossBothBooks() public {
        (bytes32 kHashA, , ) = _depositAndDeploy(alice, 2_000e6, 2_000e6);
        (bytes32 kHashB, , ) = _depositAndDeploy(bob, 2_000e6, 2_000e6);
        assertFalse(kHashA == kHashB, "the two deploys collided on one key");

        // Alice's full exit: her shortfall releases only a SLICE of A (the deploy
        // residual idle always covers the last stretch — a remnant stays marked,
        // and B is untouched: the pro-rata loop stops when the claim is filled).
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);
        assertTrue(roamer.isVaultPosition(kHashA), "position A fully closed on a partial release");
        assertTrue(roamer.isVaultPosition(kHashB), "position B vanished early");
        assertEq(roamer.openKeyCount(), 2, "an unexpected position appeared/vanished");

        // Bob's full exit: his shortfall exceeds A's remnant mark — ONE egress
        // closes slices on BOTH books (the multi-position pro-rata loop; every
        // prior egress proof was single-position).
        uint256 bobShares = vault.balanceOf(bob);
        vm.prank(bob);
        vault.redeem(bobShares, bob, bob);

        assertEq(roamer.openKeyCount(), 0, "the multi-position egress left a position open");
        assertEq(vault.deployedBook(), 0, "the deployed book did not fully release");
        assertEq(vault.deployedPar(), 0, "par did not fully release (V-3 semantics)");
        assertEq(vault.totalAssets(), 0, "the last redeemer drained the vault");
        assertApproxEqAbs(usdg.balanceOf(bob) - (100_000e6 - 2_000e6), 2_000e6, 200_000, "bob's payout diverged beyond the house band");
    }

    // ------------------------------------------------------------------
    // Audit test-gap #8 (V-4b): the setHarvester re-wire drill — the
    // documented capital-freeze and the documented drain-first recovery,
    // PINNED in code (the GOAL declares the roamer replaceable; this pins
    // the ordering constraint the runbook must carry).
    // ------------------------------------------------------------------

    function test_gap8_harvesterRewire_freezeThenDrainFirstRecovery() public {
        (bytes32 vHash, , ) = _depositAndDeploy(alice, 2_000e6, 2_000e6); // deploy ALL idle
        RoamingHarvester.Position memory pos = roamer.positionRecord(vHash);
        bytes memory fromKey =
            abi.encode(RoamingHarvester.BookKey({poolKey: pos.poolKey, tickLower: pos.tickLower, tickUpper: pos.tickUpper, salt: pos.salt}));

        // The declared replaceability path: BOTH bindings queued — the new roamer
        // binds the vault (its own one-shot setVault) and the vault re-points
        // setHarvester.
        RoamingHarvester roamer2 = new RoamingHarvester(
            address(timelock), treasuryAddr, address(allowlist), 7 days, 4, 3911, 1000
        );
        _timelockExecute(address(roamer2), abi.encodeCall(RoamingHarvester.setVault, (address(vault), address(usdg))));
        vm.prank(address(timelock));
        vault.setHarvester(address(roamer2));

        // THE FREEZE (V-4b): a migration of the OLD roamer's vault position REVERTS —
        // its completion push applyRealizedIL lands NotHarvester (the vault now
        // trusts roamer2). exitBook/rescue are blocked by the vault tag.
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RoamVault.NotHarvester.selector, address(roamer)));
        roamer.migrate(fromKey, _bookKey(LO, HI, 0), [uint256(1), uint256(1)], 4000);
        assertTrue(roamer.isVaultPosition(vHash), "the frozen position lost its tag");

        // A redeem under the re-wired harvester pays IDLE ONLY — roamer2's mark book
        // is empty, so the shortfall egresses to nothing (fail-closed freeze).
        // (Mock-stack note: the mock PM calls unlockCallback back on the ONE roamer
        // address it stores — etch a roamer2-pointing instance at the PIN so the
        // freeze redeem's egress callback routes to roamer2. Etch swaps CODE only:
        // the PM's fee/liquidity storage at the PIN survives.)
        MockPoolManager pm2 = new MockPoolManager(address(this));
        vm.etch(PM_PIN, address(pm2).code);
        IMockPoolManager(PM_PIN).init(address(roamer2));
        uint256 idleBefore = vault.idleBook();
        uint256 halfShares = vault.balanceOf(alice) / 2; // hoisted before the prank
        vm.prank(alice);
        vault.redeem(halfShares, alice, alice);
        assertEq(usdg.balanceOf(alice) - (100_000e6 - 2_000e6), idleBefore, "the freeze redeem paid more than idle");
        assertTrue(roamer.isVaultPosition(vHash), "the frozen position moved during the freeze");

        // THE DOCUMENTED DRAIN-FIRST RECOVERY: re-point the harvester BACK — the
        // egress finds the marks again and the position drains (the runbook
        // ordering, now executable proof). Etch the mock PM's callback target back
        // to the original roamer (same etch-swap, storage preserved).
        vm.prank(address(timelock));
        vault.setHarvester(address(roamer));
        MockPoolManager pm3 = new MockPoolManager(address(this));
        vm.etch(PM_PIN, address(pm3).code);
        IMockPoolManager(PM_PIN).init(address(roamer));
        uint256 remaining = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(remaining, alice, alice);
        assertLt(roamer.positionRecord(vHash).liquidity, pos.liquidity, "the recovered egress closed no slice");
        assertEq(vault.deployedBook(), 0, "the recovered egress did not release the book");
        assertEq(vault.deployedPar(), 0, "the recovered egress did not release the par");
        assertGt(usdg.balanceOf(alice) - (100_000e6 - 2_000e6), idleBefore, "the recovery paid nothing beyond the freeze payout");
    }
}

/// @dev MockERC20 with a fixed 6-decimal supply layout (the USDG shape) — set in
///      the constructor (public state writes from outside are getter-only).
contract MockSixDecToken is MockERC20 {
    constructor(string memory name_) MockERC20(name_, name_) {
        decimals = 6;
    }
}

/// @dev A 1:1 mock of the pinned fork PoolManager (1:1 raw price between two 6-dec
///      tokens, full-range band). Tracks per-position liquidity and test-injected
///      pending fees; take() mints through the controller (infinite-faucet pool).
contract MockPoolManager {
    address public immutable controller;
    address public roamer;
    mapping(bytes32 => uint128) public positionLiquidity;
    mapping(bytes32 => uint256) public pendingFee0;
    mapping(bytes32 => uint256) public pendingFee1;
    address public lastSynced;
    uint256 public syncSnapshot;

    constructor(address controller_) {
        controller = controller_;
    }

    function init(address roamer_) external {
        roamer = roamer_;
    }

    function _kHash(IPoolManagerV4.PoolKey memory k, int24 lo, int24 hi, bytes32 salt)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(k, lo, hi, salt));
    }

    function queueFees(IPoolManagerV4.PoolKey calldata key, int24 tickLower, int24 tickUpper, bytes32 salt, uint256 f0, uint256 f1)
        external
    {
        bytes32 h = _kHash(key, tickLower, tickUpper, salt);
        pendingFee0[h] += f0;
        pendingFee1[h] += f1;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        (bool ok, bytes memory ret) = roamer.call(abi.encodeCall(RoamingHarvester.unlockCallback, (data)));
        if (!ok) {
            // Propagate the callback's OWN revert - the reason must reach the caller.
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
        // The real PM returns the callback's bytes VALUE - unwrap the dynamic return
        // encoding (offset/length header) the low-level call delivered.
        return abi.decode(ret, (bytes));
    }

    function modifyLiquidity(
        IPoolManagerV4.PoolKey calldata key,
        IPoolManagerV4.ModifyLiquidityParams calldata params,
        bytes calldata
    ) external returns (int256 callerDelta, int256 feesAccrued) {
        bytes32 h = _kHash(key, params.tickLower, params.tickUpper, params.salt);
        if (params.liquidityDelta == 0) {
            uint256 f0 = pendingFee0[h];
            uint256 f1 = pendingFee1[h];
            pendingFee0[h] = 0;
            pendingFee1[h] = 0;
            callerDelta = _pack(int128(uint128(f0)), int128(uint128(f1)));
        } else if (params.liquidityDelta > 0) {
            uint128 l = uint128(uint256(params.liquidityDelta));
            positionLiquidity[h] += l;
            callerDelta = _pack(-int128(l), -int128(l)); // 1:1: both legs owe l raw
        } else {
            uint128 rem = uint128(uint256(-params.liquidityDelta));
            uint128 stored = positionLiquidity[h];
            if (rem > stored) rem = stored;
            positionLiquidity[h] = stored - rem;
            uint256 f0 = pendingFee0[h];
            uint256 f1 = pendingFee1[h];
            pendingFee0[h] = 0;
            pendingFee1[h] = 0;
            callerDelta = _pack(int128(uint128(rem + f0)), int128(uint128(rem + f1)));
        }
        feesAccrued = 0;
    }

    function swap(IPoolManagerV4.PoolKey calldata key, IPoolManagerV4.SwapParams calldata params, bytes calldata)
        external
        returns (int256)
    {
        require(key.currency0 != address(0) || key.currency1 != address(0), "mock swap");
        if (params.amountSpecified > 0) {
            // Fork semantics: POSITIVE = EXACT OUTPUT (out leg positive, paid leg negative).
            uint256 out = uint256(uint128(int128(params.amountSpecified)));
            if (params.zeroForOne) return _pack(-int128(uint128(out)), int128(uint128(out)));
            return _pack(int128(uint128(out)), -int128(uint128(out)));
        }
        uint256 inAmt = uint256(-params.amountSpecified);
        if (params.zeroForOne) return _pack(-int128(uint128(inAmt)), int128(uint128(inAmt)));
        return _pack(int128(uint128(inAmt)), -int128(uint128(inAmt)));
    }

    function take(address currency, address to, uint256 amount) external {
        (bool ok,) = controller.call(abi.encodeCall(IMockTake.mockTake, (currency, to, amount)));
        require(ok, "mock pm: take failed");
    }

    function sync(address currency) external {
        lastSynced = currency;
        syncSnapshot = IERC20(currency).balanceOf(address(this));
    }

    function settle() external payable returns (uint256) {
        return IERC20(lastSynced).balanceOf(address(this)) - syncSnapshot;
    }

    function _pack(int128 d0, int128 d1) internal pure returns (int256) {
        return (int256(d0) << 128) | int256(uint256(uint128(d1)));
    }
}

/// @dev A 1:1 mock of the pinned fork Quoter (fork semantics mirrored exactly).
contract MockQuoter {
    function quoteSingle(IPoolManagerV4.PoolKey calldata, IPoolManagerV4.SwapParams calldata params)
        external
        pure
        returns (int256 amount0, int256 amount1, uint160 sqrtPriceX96After, uint32)
    {
        if (params.amountSpecified > 0) {
            uint256 out = uint256(uint128(int128(params.amountSpecified)));
            if (params.zeroForOne) return (-int256(uint256(uint128(out))), int256(uint256(uint128(out))), 2 ** 96, 0);
            return (int256(uint256(uint128(out))), -int256(uint256(uint128(out))), 2 ** 96, 0);
        }
        uint256 inAmt = uint256(-params.amountSpecified);
        if (params.zeroForOne) return (-int256(uint256(uint128(inAmt))), int256(uint256(uint128(inAmt))), 2 ** 96, 0);
        return (int256(uint256(uint128(inAmt))), -int256(uint256(uint128(inAmt))), 2 ** 96, 0);
    }
}

/// @dev A flat mock of the pinned fork StateView (1:1 spot, tick 0).
contract MockStateView {
    function getSlot0(bytes32) external pure returns (uint160, int24, uint24, uint24) {
        return (2 ** 96, 0, 0, 0);
    }
}
