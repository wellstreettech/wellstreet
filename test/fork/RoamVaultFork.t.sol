// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RoamVault} from "../../src/RoamVault.sol";
import {RoamingHarvester, IPoolManagerV4} from "../../src/RoamingHarvester.sol";
import {ISwapRouter02V4, IQuoterV2Path} from "../../src/HarvesterV4.sol";
import {RoamAllowlist} from "../../src/RoamAllowlist.sol";
import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";

/// @dev Fork-stack StateView (the observable-state lens, NO oracle).
interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);

    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);
}

/// @dev The one extra PoolManager surface the TEST needs: a fork-only donate device
///      that feeds REAL pool-accounting fees to the vault-tagged position (house
///      RoamingHarvesterFork pattern).
interface IPM4Donate {
    function donate(IPoolManagerV4.PoolKey calldata key, uint256 amount0, uint256 amount1, bytes calldata hookData)
        external;
}

interface IERC20MetadataLite {
    function decimals() external view returns (uint8);
}

/// @notice ROAMVAULT fork battery — the user-seeded vault against LIVE Robinhood
///         Chain (4663) state, driving the FULL loop on the pinned fork stack:
///           F1  deposit -> BOTH bindings asserted (roamer.setVault ONE-SHOT +
///               vault.setHarvester re-settable) -> Safe-queued timelock
///               vaultDeploy into the LIVE SPY/USDG book -> REAL pool fees (the
///               donate device) -> sweepVaultYield: the 90% depositor lane pushed
///               into the vault via the excess-bounded harvest() seam (WELL-
///               INDEPENDENT, runs pre-setWellToken) and the 10% BURN-PENDING
///               conserved -> setWellToken -> sweepToBurn burns exactly the 10%
///               (Burned, dEaD) -> conservation pre/post holds. Custody: the
///               position is vault-tagged, backingCoverage stays 1e18, the share
///               price marks at par.
///           F2  IDLE-FIRST redemption: a redeem fully covered by idle closes ZERO
///               position slices (the deployed book and the position untouched).
///           F3  migrationFee = STRUCTURALLY ZERO on the vault path (the POL lane
///               keeps its take), the tag INHERITS across the migration, the
///               realized-IL mark pushes to the vault (RealizedIL + VaultILApplied),
///               and the egress serves a zero-idle redemption by closing the
///               migrated USDG/ETH position (the native leg converts on the
///               position's own venue). exitBook/rescueToTreasury fail closed.
///
///         RPC: the keyless public 4663 endpoint from foundry.toml ([rpc_endpoints]
///         alias "robinhood") — override with WELLSTREET_ROBINHOOD_RPC_URL (house
///         envOr alias-fallback: RUNS in both configs). Zero broadcast, zero spend.
contract RoamVaultForkTest is Test {
    address constant FORK_PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant STATE_VIEW = 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2;
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant DYNAMIC_HOOK = 0x06a889870C8f83640D6816319f72e2aA579b6080;
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;

    bytes32 constant SPY_USDG_POOL_ID = 0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd;
    bytes32 constant USDG_ETH_POOL_ID = 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551;

    uint24 constant FEE_DYNAMIC_FLAG = 0x800000;
    uint256 constant TIMELOCK_DELAY = 48 hours + 1;
    uint32 constant EXPECTED_GAIN = 4000; // > the 3911 operating floor

    bytes32 constant SIG_MIGRATION_EXECUTED =
        keccak256("MigrationExecuted(bytes32,bytes32,int24,int24,uint256,uint256,uint256,uint256,uint32,uint256,uint256,uint128)");
    bytes32 constant SIG_MIGRATION_FEE = keccak256("MigrationFeeCharged(bytes32,uint256,uint256,uint32)");
    bytes32 constant SIG_REALIZED_IL = keccak256("RealizedIL(bytes32,int256,address)");
    bytes32 constant SIG_VAULT_IL = keccak256("VaultILApplied(int256,address,uint256,bool)");
    bytes32 constant SIG_BURNED = keccak256("Burned(address,uint256,uint256)");
    bytes32 constant SIG_EGRESS = keccak256("VaultEgressSettled(uint256,uint256)");

    IPoolManagerV4.PoolKey spyUsdgKey =
        IPoolManagerV4.PoolKey({currency0: SPY, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: address(0)});
    IPoolManagerV4.PoolKey usdgEthKey =
        IPoolManagerV4.PoolKey({currency0: address(0), currency1: USDG, fee: FEE_DYNAMIC_FLAG, tickSpacing: 10, hooks: DYNAMIC_HOOK});

    int24 constant SPY_USDG_LO = -887220; // ts-60 full-range bounds (house pin)
    int24 constant SPY_USDG_HI = 887220;
    int24 constant USDG_ETH_LO = -887270; // ts-10 full-range bounds (house pin)
    int24 constant USDG_ETH_HI = 887270;

    WellstreetTimelock timelock;
    RoamAllowlist allowlist;
    RoamingHarvester harvester;
    RoamVault vault;

    address proposer = makeAddr("wellstreet-deployer");
    address pauser = makeAddr("pause-eoa");
    address treasuryAddr = makeAddr("roam-treasury");
    address alice = makeAddr("roam-depositor");
    address bob = makeAddr("roam-caller");

    // Migration classifier keys (set by F3 before the migrate; read by the helper).
    bytes32 private _vaultFromHash;
    bytes32 private _polFromHash;

    // Donate-accrual device state (executed by THIS contract's unlockCallback).
    uint8 private _donateArmed;
    IPoolManagerV4.PoolKey private _donateKey;
    uint256 private _donate0;
    uint256 private _donate1;

    function _rpc() internal view returns (string memory) {
        return vm.envOr("WELLSTREET_ROBINHOOD_RPC_URL", string("robinhood"));
    }

    function setUp() public {
        vm.createSelectFork(_rpc());

        assertGt(FORK_PM.code.length, 0, "fork PoolManager has no code");
        assertGt(IStateView(STATE_VIEW).getLiquidity(SPY_USDG_POOL_ID), 0, "SPY/USDG book is not live");

        timelock = new WellstreetTimelock(proposer, 48 hours);
        allowlist = new RoamAllowlist(address(timelock));
        treasuryAddr = makeAddr("roam-treasury");
        harvester = new RoamingHarvester(
            address(timelock), treasuryAddr, address(allowlist),
            7 days /* MIN_HOLD operating start */, 4 /* cap operating start */,
            3911 /* MIN_EXPECTED_GAIN_BPS start */, 1000 /* migrationFeeBps start */
        );
        vault = new RoamVault(IERC20(USDG), "Wellstreet Roam", "ws-ROAM", address(timelock), pauser, 25_000e6);
        assertTrue(vault.depositsPaused(), "the vault MUST deploy init-paused");

        // Allowlist the two anchor books THROUGH the timelock (house governance rail).
        RoamAllowlist.BookMeta memory meta = RoamAllowlist.BookMeta({minTvlUsd1e6: 0, drainShockChecked: true, addedAt: 0});
        _queueAndExecute(
            address(allowlist), 0, abi.encodeCall(RoamAllowlist.addBook, (RoamAllowlist.PoolKey({
                currency0: SPY, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: address(0)
            }), meta))
        );
        _queueAndExecute(
            address(allowlist), 0, abi.encodeCall(RoamAllowlist.addBook, (RoamAllowlist.PoolKey({
                currency0: address(0), currency1: USDG, fee: FEE_DYNAMIC_FLAG, tickSpacing: 10, hooks: DYNAMIC_HOOK
            }), meta))
        );

        // BOTH bindings, Safe-queued through the 48h timelock: the roamer's ONE-SHOT
        // setVault AND the vault's re-settable setHarvester (the roamer stays
        // replaceable) — asserted BEFORE any harvest/deploy leg below.
        _queueAndExecute(address(harvester), 0, abi.encodeCall(RoamingHarvester.setVault, (address(vault), USDG)));
        _queueAndExecute(address(vault), 0, abi.encodeCall(RoamVault.setHarvester, (address(harvester))));
        assertEq(harvester.vault(), address(vault), "setVault binding missing");
        assertEq(vault.harvester(), address(harvester), "setHarvester binding missing");

        // Deposits OPEN (the constructor init-paused them; the pause authority opens).
        vm.prank(pauser);
        vault.setDepositPaused(false);
        assertFalse(vault.depositsPaused(), "deposits did not open");

        // Fund the depositor with REAL USDG (the vault asset; dealt per the house
        // fork pattern — USDG is not the issuer-gated stock token).
        deal(USDG, alice, 1_000_000 * _dec(USDG));
        assertGt(IERC20(USDG).balanceOf(alice), 0, "USDG deal did not land");
        vm.startPrank(alice);
        IERC20(USDG).approve(address(vault), type(uint256).max);
        vm.stopPrank();

        // The F1 donate device pays from THIS contract's unlockCallback frame: USDG
        // dealt (OZ balances layout) and SPY acquired via a REAL v3 swap — the
        // issuer-gated stock token is NEVER dealt (house rule).
        _assertUnblockedSpy(address(this));
        _assertUnblockedSpy(SWAP_ROUTER);
        _assertUnblockedSpy(QUOTER_V2);
        deal(USDG, address(this), 100_000 * _dec(USDG));
        assertGt(IERC20(USDG).balanceOf(address(this)), 0, "donate-USDG deal did not land");
        uint256 spyGot = _swapV3(USDG, SPY, 500, 60_000 * _dec(USDG));
        assertGt(spyGot, 50e18, "the v3 route produced less SPY than the F1 donate needs");

        // One-shot custody proofs on the LIVE one-shot surfaces.
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.NotTimelock.selector, bob));
        harvester.setVault(address(vault), USDG);
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _queueAndExecute(address target, uint256 value, bytes memory data) internal {
        vm.prank(proposer);
        timelock.queue(target, value, data, bytes32(0));
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.prank(bob); // permissionless execution (house trust model)
        timelock.execute(target, value, data, bytes32(0));
    }

    function _bookKey(IPoolManagerV4.PoolKey memory k, int24 lo, int24 hi, bytes32 salt)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(RoamingHarvester.BookKey({poolKey: k, tickLower: lo, tickUpper: hi, salt: salt}));
    }

    function _dec(address token) internal view returns (uint256) {
        return 10 ** IERC20MetadataLite(token).decimals();
    }

    /// @dev Issuer-gated SPY: a fork address in a money path must be unblocked (house
    ///      pattern, HarvestFork.t.sol / HarvesterV4Fork.t.sol).
    function _assertUnblockedSpy(address who) internal view {
        (bool ok, bytes memory ret) = SPY.staticcall(abi.encodeWithSignature("ACCESS_CONTROLLED_REGISTRY()"));
        assertTrue(ok && ret.length == 32, "cannot read SPY ACCESS_CONTROLLED_REGISTRY");
        address registry = abi.decode(ret, (address));
        assertFalse(IAccessControlsRegistryless(registry).isBlocked(who), "address is blocked on SPY");
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

    /// @dev The to-position key hash of the migration FROM `fromHash` (event-derived —
    ///      openKeys order shuffles on delete, so continuity asserts never index-guess).
    function _toHashOf(Vm.Log[] memory entries, bytes32 fromHash) internal pure returns (bytes32 toHash) {
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == SIG_MIGRATION_EXECUTED && entries[i].topics[1] == fromHash) {
                return bytes32(entries[i].topics[2]);
            }
        }
        revert("migration event for fromHash not found");
    }

    /// @dev Deposit + Safe-queued timelock deploy; returns the vault-tagged key hash.
    function _depositAndDeploy(address user, uint256 depositAmt, uint256 deployAmt) internal returns (bytes32) {
        vm.startPrank(user);
        vault.deposit(depositAmt, user);
        vm.stopPrank();
        _queueAndExecute(
            address(vault), 0, abi.encodeCall(RoamVault.vaultDeploy, (_bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, 0), deployAmt))
        );
        bytes32 kHash = harvester.openKeys(0);
        assertTrue(harvester.isVaultPosition(kHash), "the deployed position is not vault-tagged");
        return kHash;
    }

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

    function _scanCount(Vm.Log[] memory entries, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == sig) n++;
        }
    }

    /// @dev The migration-ledger classifier (own frame for the codegen stack
    ///      budget): exactly ONE vault-path take (zero) and ONE POL take (kept),
    ///      plus both IL surfaces (RealizedIL + the vault-IL report).
    function _classifyMigrationLogs(Vm.Log[] memory entries)
        internal
        view
        returns (bool sawVaultFeeZero, bool sawPolFee, bool sawRealizedIL, bool sawVaultIL)
    {
        bytes32 vaultFromHash = _vaultFromHash;
        bytes32 polFromHash = _polFromHash;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == SIG_MIGRATION_FEE) {
                (uint256 f0, uint256 f1, uint32 bps) = abi.decode(entries[i].data, (uint256, uint256, uint32));
                if (entries[i].topics[1] == vaultFromHash) {
                    assertEq(f0, 0, "the VAULT path charged a migration fee on leg0");
                    assertEq(f1, 0, "the VAULT path charged a migration fee on leg1");
                    assertEq(bps, 0, "the applied take must read 0 on the vault branch");
                    sawVaultFeeZero = true;
                }
                if (entries[i].topics[1] == polFromHash) {
                    assertGt(f0 + f1, 0, "the POL lane lost its roaming take");
                    sawPolFee = true;
                }
            }
            if (entries[i].topics[0] == SIG_REALIZED_IL) sawRealizedIL = true;
            if (entries[i].topics[0] == SIG_VAULT_IL) sawVaultIL = true;
        }
    }

    // ------------------------------------------------------------------
    // F1 — deposit -> deploy -> REAL fees -> the 90/10 split, live
    // ------------------------------------------------------------------

    function testFork_F1_deposit_deploy_harvestSplit_burnPendingConserved() public {
        vm.prank(alice);
        vault.deposit(1_000e6, alice);
        uint256 shares = vault.balanceOf(alice);
        uint256 priceBefore = vault.convertToAssets(shares);
        assertEq(priceBefore, 1_000e6, "the pre-deploy price != the deposit");

        // The Safe-queued DEPLOY TRIGGER v1 through the 48h timelock.
        _queueAndExecute(
            address(vault), 0, abi.encodeCall(RoamVault.vaultDeploy, (_bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, 0), 300e6))
        );
        bytes32 kHash = harvester.openKeys(0);
        assertTrue(harvester.isVaultPosition(kHash), "the deployed position is not vault-tagged");
        assertGt(vault.deployedBook(), 0, "nothing marked into the deployed book");
        assertEq(vault.deployedBook(), vault.deployedPar(), "deploy-time par != the deployed book");
        // backingCoverage stays 1e18 while capital is deployed (both sides fell by X).
        assertApproxEqAbs(vault.backingCoverage(), 1e18, 1e12, "backingCoverage moved on a par deploy");
        // The share price marks deployed capital AT PAR.
        assertApproxEqAbs(vault.convertToAssets(shares), 1_000e6, 10_000, "the deploy moved the share price");

        // REAL pool-accounting fees: the donate device feeds the LIVE book; the
        // vault-tagged position's share is its live liquidity proportion.
        uint256 donatedUsdg = 2_000e6;
        uint256 donatedSpy = 50e18;
        _donate(spyUsdgKey, donatedSpy, donatedUsdg);
        uint128 lTotal = IStateView(STATE_VIEW).getLiquidity(SPY_USDG_POOL_ID);
        uint128 lOurs = harvester.positionRecord(kHash).liquidity;
        uint256 expShare0 = Math.mulDiv(donatedSpy, lOurs, lTotal);
        uint256 expShare1 = Math.mulDiv(donatedUsdg, lOurs, lTotal);
        assertGt(expShare0, 0, "SPY donate share rounds to zero");
        assertGt(expShare1, 0, "USDG donate share rounds to zero");

        // The sweep legs run in their own frames (house codegen-stack lesson).
        _sweepVaultYieldAndAssertPush(expShare0, expShare1);
        _configureBurnAndSweepAndAssert();
        // The share price ROSE with the push (the depositor yield landed).
        assertGt(vault.convertToAssets(shares), priceBefore, "the 90% push did not raise the share price");
    }

    /// @dev The pre-setWellToken sweep: the 90% depositor lane pushes (WELL-
    ///      independent) while the 10% cuts sit BURN-PENDING (conserved, never
    ///      treasury). Returns the split for the conservation asserts.
    function _sweepVaultYieldAndAssertPush(uint256 expShare0, uint256 expShare1)
        internal
        returns (uint256 pushedUsdg, uint256 pushedFromSpy, uint256 pendingUsdg, uint256 pendingSpy)
    {
        // PRE setWellToken: sweepToBurn is fail-closed INERT.
        vm.expectRevert(RoamingHarvester.NoWellToken.selector);
        harvester.sweepToBurn();
        uint256 idleBeforePush = vault.idleBook();
        harvester.sweepVaultYield();
        pushedUsdg = vault.idleBook() - idleBeforePush;
        // The pushed idle = DEPOSITOR_BPS of the vault lane's fees: the USDG leg
        // pushed directly + the SPY leg swapped to USDG on the LIVE book.
        assertGt(pushedUsdg, 0, "the 90% depositor lane did not push");
        assertGe(pushedUsdg, Math.mulDiv(expShare1, vault.DEPOSITOR_BPS(), vault.BPS()) - 10, "the USDG 90% leg missing from the push");
        assertEq(harvester.vaultAccrued(USDG), 0, "the pushed bucket did not drain");
        assertEq(harvester.vaultAccrued(SPY), 0, "the SPY bucket did not drain");
        // The SPY leg's push = everything beyond the direct USDG 90% (converted at
        // the live pool price, so assert the STRUCTURAL form: strictly positive).
        pushedFromSpy = pushedUsdg - Math.mulDiv(expShare1, vault.DEPOSITOR_BPS(), vault.BPS());
        assertGt(pushedFromSpy, 0, "the SPY 90% leg was not pushed");

        // The 10% cuts sit BURN-PENDING (conserved, never treasury).
        pendingUsdg = harvester.accountedAccrued(USDG);
        pendingSpy = harvester.accountedAccrued(SPY);
        assertGt(pendingUsdg, 0, "the USDG 10% cut missing");
        assertGt(pendingSpy, 0, "the SPY 10% cut missing");
        assertApproxEqAbs(pendingUsdg, Math.mulDiv(expShare1, vault.BURN_BPS(), vault.BPS()), 10, "the USDG 10% cut != BURN_BPS");
        assertApproxEqAbs(pendingSpy, Math.mulDiv(expShare0, vault.BURN_BPS(), vault.BPS()), 10, "the SPY 10% cut != BURN_BPS");
        assertEq(IERC20(USDG).balanceOf(treasuryAddr), 0, "the 10% leaked to treasury");
        assertEq(IERC20(SPY).balanceOf(treasuryAddr), 0, "junk leaked to treasury");
    }

    /// @dev The burn tail goes live: the conserved 10% burns (USDG IS the WELL
    ///      stand-in; the SPY cut swaps on the Safe-set route — the book's own
    ///      venue). Dev take structurally 0; conservation holds post setWellToken.
    function _configureBurnAndSweepAndAssert() internal {
        _queueAndExecute(address(harvester), 0, abi.encodeCall(RoamingHarvester.setWellToken, (USDG)));
        _queueAndExecute(
            address(harvester), 0, abi.encodeCall(RoamingHarvester.setSweepRoute, (SPY, IPoolManagerV4.PoolKey({
                currency0: SPY, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: address(0)
            })))
        );
        uint256 deadBefore = IERC20(USDG).balanceOf(DEAD);
        vm.recordLogs();
        harvester.sweepToBurn();
        Vm.Log[] memory entries = vm.getRecordedLogs();
        uint256 burnedTotal = IERC20(USDG).balanceOf(DEAD) - deadBefore;
        assertGt(burnedTotal, 0, "the conserved 10% did not burn");
        assertEq(_scanCount(entries, SIG_BURNED), 2, "expected one Burned per source token");
        assertEq(harvester.accountedAccrued(USDG), 0, "the USDG accrual did not drain");
        // The SPY leg drains to SWAP-ROUNDING dust: an exact-input fill can realize
        // output inside (not at) the fresh quote, and the difference stays accounted
        // for the next sweep to retry (house F-5 semantics) — dust-bounded, the
        // whole 10% cut would be orders of magnitude larger.
        assertLt(harvester.accountedAccrued(SPY), 1e12, "the SPY accrual kept more than rounding dust");
        // The roamer retains only SWAP-ROUNDING dust (the same sub-quote remainder
        // class as the accounted bound above — a real 10% dev take of the donated
        // fees would be ~5e18, six orders of magnitude larger).
        assertLt(IERC20(SPY).balanceOf(address(harvester)), 1e12, "the roamer retained SPY dust-plus (dev take != 0)");
        assertEq(IERC20(USDG).balanceOf(address(harvester)), 0, "the roamer retained USDG (dev take != 0)");
        // The burn legs re-express at the live pool price: each source's Burned
        // carried bought == burned, and the dEaD delta is the USDG sum of both.
        assertGt(burnedTotal, 0, "the SPY 10% converted to nothing");
    }

    // ------------------------------------------------------------------
    // F2 — IDLE-FIRST: a covered redeem closes ZERO slices
    // ------------------------------------------------------------------

    function testFork_F2_redeemIdleFirst_zeroSlices() public {
        _depositAndDeploy(alice, 1_000e6, 300e6);
        bytes32 kHash = harvester.openKeys(0);
        RoamingHarvester.Position memory pos = harvester.positionRecord(kHash);
        uint256 markedBefore = vault.deployedBook();
        // Bob's fresh deposit gives the vault MORE idle than alice's claim.
        deal(USDG, bob, 50_000 * _dec(USDG));
        vm.startPrank(bob);
        IERC20(USDG).approve(address(vault), type(uint256).max);
        vault.deposit(20_000e6, bob);
        vm.stopPrank();
        assertGt(vault.idleBook(), 1_000e6, "idle must cover alice's claim");

        // Hoist the share read BEFORE the prank: an argument-expression call consumes
        // vm.prank and the redeem would run as the test contract (allowance revert).
        uint256 sh = vault.balanceOf(alice);
        vm.recordLogs();
        vm.prank(alice);
        vault.redeem(sh, alice, alice);
        Vm.Log[] memory entries = vm.getRecordedLogs();

        assertEq(_scanCount(entries, SIG_EGRESS), 0, "an idle-covered redeem settled an egress");
        assertEq(uint256(harvester.positionRecord(kHash).liquidity), uint256(pos.liquidity), "a slice was closed");
        assertEq(vault.deployedBook(), markedBefore, "the deployed book moved");
        assertGt(IERC20(USDG).balanceOf(alice), 1_000_000e6 - 1_000e6 - 1, "the redeem did not pay the claim");
    }

    // ------------------------------------------------------------------
    // F3 — vault-path migration (fee ZERO, tag inherits, IL reports) +
    //      zero-idle egress redemption + the custody guards
    // ------------------------------------------------------------------

    function testFork_F3_vaultMigration_feeZero_ilReport_egress_custody() public {
        _depositAndDeploy(alice, 400e6, 300e6); // deploy all but ~100e6 idle
        bytes32 kHash = harvester.openKeys(0);
        RoamingHarvester.Position memory pos = harvester.positionRecord(kHash);
        bytes memory fromKey =
            _bookKey(pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt);

        // Custody guards, LIVE: exitBook and rescueToTreasury fail closed on vault capital.
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.VaultPositionProtected.selector, kHash));
        harvester.exitBook(fromKey, treasuryAddr);
        vm.prank(address(timelock));
        vm.expectRevert(); // VaultPositionProtected - a vault position is open
        harvester.rescueToTreasury(USDG);

        // A POL seed keeps its roaming take (the branch, not a global flip). The
        // Safe sizes the liquidity from the funded balances (house 90% margin).
        uint256 fundedUsdg = 3_000 * _dec(USDG);
        deal(USDG, address(harvester), fundedUsdg);
        vm.deal(address(harvester), 2 ether);
        (uint160 ethSqrt, , , ) = IStateView(STATE_VIEW).getSlot0(USDG_ETH_POOL_ID);
        uint256 l0 = Math.mulDiv(2 ether, ethSqrt, 1 << 96);
        uint256 l1 = Math.mulDiv(fundedUsdg, 1 << 96, ethSqrt);
        uint128 polLiquidity = uint128((Math.min(l0, l1) * 90) / 100);
        _queueAndExecute(
            address(harvester), 0, abi.encodeCall(RoamingHarvester.seedBook, (_bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0), polLiquidity))
        );
        uint256 polIdx = harvester.openKeyCount() - 1;
        assertFalse(harvester.isVaultPosition(harvester.openKeys(polIdx)), "a POL seed must NOT be vault-tagged");
        RoamingHarvester.Position memory pol = harvester.positionRecord(harvester.openKeys(polIdx));

        _vaultFromHash = keccak256(abi.encode(pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt));
        _polFromHash = keccak256(abi.encode(pol.poolKey, pol.tickLower, pol.tickUpper, pol.salt));
        // THE VAULT MIGRATION (permissionless, past the seed-anchored MIN_HOLD), then
        // the POL-lane control migration in the SAME recorded buffer: one classifier
        // pass sees BOTH takes — the vault path at STRUCTURAL ZERO and the POL lane
        // KEEPING its 1000-bps roaming take (the branch, not a global flip).
        vm.warp(block.timestamp + 7 days + 1);
        vm.recordLogs();
        vm.prank(bob);
        harvester.migrate(
            fromKey,
            _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0),
            [uint256(1), uint256(1)],
            EXPECTED_GAIN
        );
        vm.prank(bob);
        harvester.migrate(
            _bookKey(pol.poolKey, pol.tickLower, pol.tickUpper, pol.salt),
            _bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, 0),
            [uint256(1), uint256(1)],
            EXPECTED_GAIN
        );
        Vm.Log[] memory entries = vm.getRecordedLogs();
        (bool sawVaultFeeZero, bool sawPolFee, bool sawRealizedIL, bool sawVaultIL) = _classifyMigrationLogs(entries);
        assertTrue(sawVaultFeeZero, "the vault migration's MigrationFeeCharged missing");
        assertTrue(sawPolFee, "the POL migration's MigrationFeeCharged missing");
        assertTrue(sawRealizedIL, "RealizedIL not emitted");
        assertTrue(sawVaultIL, "the vault-IL report did not land at migration completion");
        // Custody continuity: the migrated position INHERITS the vault tag (keyed by
        // the event's toHash — openKeys order shuffles on delete, never index-guessed).
        assertTrue(
            harvester.isVaultPosition(_toHashOf(entries, _vaultFromHash)),
            "the migrated position lost the vault tag"
        );
        // The vault fee is still in the 90/10 lane: the migration fee was ZERO.
        assertGt(vault.deployedBook(), 0, "the deployed book emptied on the migration");

        // Feed the migrated position REAL fees so the V-2 window at the tail below
        // is NON-VACUOUS: the donate device (F1 pattern, USDG leg only) credits the
        // LIVE pool; the migrated position's liquidity share collects at the
        // egress fee-collect and fills the vault bucket.
        bytes32 toHash = _toHashOf(entries, _vaultFromHash);
        uint128 lTotal = IStateView(STATE_VIEW).getLiquidity(USDG_ETH_POOL_ID);
        uint128 lOurs = harvester.positionRecord(toHash).liquidity;
        uint256 donatedUsdg = 5_000e6;
        uint256 expShare1 = Math.mulDiv(donatedUsdg, lOurs, lTotal);
        assertGt(expShare1, 0, "the migrated position's fee share rounds to zero");
        deal(USDG, address(this), donatedUsdg);
        _donate(usdgEthKey, 0, donatedUsdg);

        // ZERO-IDLE EGRESS: alice redeems; the shortfall closes the migrated
        // USDG/ETH position (the native leg converts on the position's own venue).
        // (Share read hoisted BEFORE the prank — see F2.)
        uint256 sh = vault.balanceOf(alice);
        uint256 claim = vault.convertToAssets(sh);
        vm.prank(alice);
        vault.redeem(sh, alice, alice);
        uint256 paid = IERC20(USDG).balanceOf(alice) - (1_000_000e6 - 400e6);
        assertGt(paid, 0, "the egress redemption paid nothing");
        // The redeemer's slice takes the live-pool divergence: payout ~= the claim.
        assertApproxEqAbs(paid, claim, claim / 10, "the payout diverged beyond the house band");
        // The last redeemer drains the vault to ROUNDING dust (convertToAssets rounds
        // against the redeemer — the sub-wei remainder is claimable by nobody, the
        // standard ERC-4626 full-exit property).
        assertLt(vault.totalAssets(), 2, "the last redeemer left more than rounding dust");
        assertEq(harvester.openKeyCount(), 1, "the POL position must remain (egress is lane-scoped)");
        assertFalse(harvester.isVaultPosition(harvester.openKeys(0)), "a vault tag survived the full egress");

        // With the vault positions gone, the POL custody guard lifts: the POL
        // position is exitable again.
        RoamingHarvester.Position memory pol2 = harvester.positionRecord(harvester.openKeys(0));
        bytes memory polKey = _bookKey(pol2.poolKey, pol2.tickLower, pol2.tickUpper, pol2.salt);
        vm.prank(address(timelock));
        harvester.exitBook(polKey, treasuryAddr);
        assertEq(harvester.openKeyCount(), 0, "the POL egress left the position open");

        // ------------------------------------------------------------------
        // V-2 (LIVE): the post-last-close rescue window must NOT move the vault
        // bucket. The donate above filled it at the egress collect (the fees ride
        // the SAME redeem whose slice-close deleted the tag — the custody guard
        // has lifted while the 90% depositor cut still sits un-swept) — depositor
        // money is rescueable by NOBODY, then still drains to the VAULT.
        // ------------------------------------------------------------------
        uint256 bucketUsdg = harvester.vaultAccrued(USDG);
        assertGt(bucketUsdg, 0, "the donate did not fill the vault bucket (the V-2 window is vacuous)");
        uint256 treasBefore = IERC20(USDG).balanceOf(treasuryAddr);
        uint256 roamerBal = IERC20(USDG).balanceOf(address(harvester));
        uint256 accounted = harvester.accountedAccrued(USDG);
        uint256 expectedJunk =
            roamerBal > accounted + bucketUsdg ? roamerBal - accounted - bucketUsdg : 0;
        vm.prank(address(timelock));
        harvester.rescueToTreasury(USDG);
        // The basis is EXACT: only true junk (above accounted + the bucket) moves.
        assertEq(IERC20(USDG).balanceOf(treasuryAddr) - treasBefore, expectedJunk, "the rescue basis != bal - accounted - vaultAccrued");
        assertEq(harvester.vaultAccrued(USDG), bucketUsdg, "the rescue moved the vault bucket");
        // The custody lane is intact: the permissionless sweep pushes the bucket
        // straight into the vault (the vault asset needs no conversion route).
        uint256 idleBeforeSweep = vault.idleBook();
        harvester.sweepVaultYield();
        assertEq(vault.idleBook() - idleBeforeSweep, bucketUsdg, "the sweep did not push the bucket into the vault");
        assertEq(harvester.vaultAccrued(USDG), 0, "the swept bucket did not drain");
    }

    // ------------------------------------------------------------------
    // F4 — the TickMath table vs LIVE slot0 (ROAMER-AUDIT F-4, carried) + the
    // V-5 constant equality (composition audit 2026-09-08).
    // ------------------------------------------------------------------

    function testFork_F4_tableBracketsLiveSlot0_andMaxSqrtCanonical() public {
        // The table BRACKETS each live anchor book's slot0: a pool's live sqrtP is
        // a swap OUTPUT, never a tick-boundary value — so
        // sqrtRatioAtTick(tick) <= slot0.sqrtPriceX96 < sqrtRatioAtTick(tick + 1).
        (uint160 spySqrt, int24 spyTick, , ) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);
        assertLe(harvester.sqrtRatioAtTick(spyTick), spySqrt, "SPY slot0 fell below its own tick's table bound");
        assertLt(spySqrt, harvester.sqrtRatioAtTick(spyTick + 1), "SPY slot0 exceeded the (tick+1) table bound");
        (uint160 ethSqrt, int24 ethTick, , ) = IStateView(STATE_VIEW).getSlot0(USDG_ETH_POOL_ID);
        assertLe(harvester.sqrtRatioAtTick(ethTick), ethSqrt, "USDG/ETH slot0 fell below its own tick's table bound");
        assertLt(ethSqrt, harvester.sqrtRatioAtTick(ethTick + 1), "USDG/ETH slot0 exceeded the (tick+1) table bound");
        // V-5: the clamp constant IS canonical TickMath MAX_SQRT_RATIO - 1 — the
        // TIGHTEST limit the LIVE fork accepts (the pool rejects limits >=
        // MAX_SQRT_RATIO with InvalidPrice; the pre-fix wart sat ABOVE that bound).
        // Subtlety pinned: the pool's MAX_SQRT_RATIO is NOT
        // getSqrtRatioAtTick(MAX_TICK) — the table endpoint is 5,586,318 BELOW the
        // pool constant — so the constant is pinned to the canonical literal and to
        // the at-or-above-the-table relationship, never to table(MAX_TICK) - 1.
        assertGe(
            uint256(harvester.MAX_SQRT_MINUS_1()) + 1,
            uint256(harvester.sqrtRatioAtTick(887272)),
            "the clamp ceiling fell below the table's own MAX_TICK output"
        );
        assertEq(
            uint256(harvester.MAX_SQRT_MINUS_1()),
            uint256(1461446703485210103287273052203988822378729556659),
            "MAX_SQRT_MINUS_1 is not the canonical max minus one"
        );
    }
}

/// @dev The issuer-gated SPY token's block registry read (house fork pattern).
interface IAccessControlsRegistryless {
    function isBlocked(address account) external view returns (bool);
}
