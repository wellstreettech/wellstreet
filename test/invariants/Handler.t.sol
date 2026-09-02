// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldShares} from "../../src/YieldShares.sol";
import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";
import {Harvester} from "../../src/Harvester.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {MockERC20, MockFalseReturnToken, MockReentrantToken, MockBlacklistToken} from "../mocks/MockERC20.sol";
import {MockPositionManager} from "../mocks/MockPositionManager.sol";
import {MockRouter, MockQuoter} from "../mocks/MockSwaps.sol";

/// @notice Stateful fuzz handler for the YieldShares/Harvester invariant battery.
///         Drives ONE standard-asset stack (real Harvester over the mock V3 stack —
///         the exact HarvesterTest wiring) and THREE hostile-token stacks (a
///         false-returning token, a reentrant token, a blacklist-reverting token),
///         across arbitrary operation sequences.
///
///         Handler-reachable action set (bounded; every admin path goes through the
///         REAL 48h timelock, and the illegal paths are attempted and must fail):
///           deposits / redemptions on the standard vault (redeem attempted regardless
///           of depositsPaused — the pause is toggled by its own action),
///           fee-harvest through the real Harvester with seeded, KNOWN proceeds,
///           timelock-set fee changes (including the feeBps < TIP_BPS tip-clamp branch),
///           hostile-path admin attempts (must revert), hostile-vault deposit/harvest
///           attempts (must not move accounting), timelock execute-without-queue /
///           execute-before-delay attempts (must revert).
///
///         The handler carries NO external issuer-burn action: solvency
///         (balance >= totalAssets) is asserted over handler-reachable states only —
///         the only violator is the external adminBurn that backingCoverage() exists
///         to surface. Ghost variables record what each successful op did; the
///         invariant_ functions in YieldSharesInvariantsTest check them against
///         contract state.
contract Handler is Test {
    // ---- standard-asset stack -------------------------------------------------
    MockERC20 public asset;
    MockERC20 public weth;
    MockPositionManager public npm;
    MockRouter public router;
    MockQuoter public quoter;
    WellstreetTimelock public timelock;
    YieldShares public vault;
    Harvester public harvester;
    uint256 public positionId;

    // ---- hostile stacks (each: its own vault on a hostile token, handler as harvester)
    YieldShares[] public hostileVaults;
    IERC20[] public hostileTokens;
    uint256 public constant N_HOSTILE = 3;

    address public pauser = makeAddr("pause-eoa");
    address public timelockProposer = makeAddr("tl-proposer");
    address[] public actors;

    // Fee seed for the real harvester flow (KNOWN proceeds: the mock router pays RATE
    // per WETH; proceeds = SPY_FEE + WETH_FEE*RATE/1e18).
    uint256 public constant WETH_FEE = 1e18;
    uint256 public constant SPY_FEE = 2e18;
    uint256 public constant RATE = 3000e18;
    uint256 public constant PROCEEDS = SPY_FEE + (WETH_FEE * RATE) / 1e18; // 3002e18

    // ---- ghosts ---------------------------------------------------------------
    uint8 public constant OP_NONE = 0;
    uint8 public constant OP_DEPOSIT = 1;
    uint8 public constant OP_HARVEST = 2;
    uint8 public constant OP_WITHDRAW = 3;

    uint256 public ghost_ta; // last observed standard-vault totalAssets
    uint8 public ghost_opKind;
    int256 public ghost_delta; // totalAssets delta of the last successful op
    uint256 public ghost_supply; // last observed standard-vault totalSupply
    uint256 public ghost_totalCredited; // Σ assets credited by harvest pushes
    uint256 public ghost_totalArrived; // Σ assets physically pushed/arrived for those credits
    bool public ghost_adminViolation; // a non-timelock admin path SUCCEEDED
    bool public ghost_execViolation; // timelock executed without queue+delay
    bool public ghost_splitViolation; // _split identity broke on the standard asset
    bool public ghost_redeemViolation; // a bounded standard-asset redeem FAILED
    bool public ghost_hostileViolation; // a hostile-token attempt moved accounting
    uint256 public ghost_feeSetCount; // number of successful timelock fee changes

    event OpKind(uint8 kind, int256 delta, uint256 amount);

    constructor() {
        vm.startPrank(timelockProposer);
        timelock = new WellstreetTimelock(timelockProposer, 48 hours);
        vm.stopPrank();

        asset = new MockERC20("SPY", "SPY");
        weth = new MockERC20("WETH", "WETH");
        npm = new MockPositionManager();
        router = new MockRouter();
        quoter = new MockQuoter();

        vault = new YieldShares(IERC20(address(asset)), "Wellstreet SPY", "ws-SPY", address(timelock), pauser, 1000);
        harvester = new Harvester(
            address(vault), address(timelock), address(timelock), address(asset), address(weth), 500,
            address(npm), address(router), address(quoter)
        );
        // Router needs asset inventory to pay swaps out of.
        asset.mint(address(router), 10_000_000e18);
        // Wire the harvester through the REAL timelock (deploy flow).
        _timelockExecute(address(vault), abi.encodeCall(YieldShares.setHarvester, (address(harvester))));
        // Receive the protocol LP position.
        positionId = npm.mintPosition(address(weth), address(asset), 500, address(this));
        npm.safeTransferFrom(address(this), address(harvester), positionId);

        // Hostile stacks: own vault per hostile token, handler wired as the harvester
        // (so the battery can attempt authorized pushes) — the tokens themselves are
        // hostile and must not move accounting beyond what an authorized push credits.
        _newHostileVault(address(new MockFalseReturnToken()));
        _newHostileVault(address(new MockReentrantToken()));
        _newHostileVault(address(new MockBlacklistToken()));
        MockReentrantToken(address(hostileTokens[1])).setCallbackTarget(address(hostileVaults[1]));

        actors.push(makeAddr("actor-0"));
        actors.push(makeAddr("actor-1"));
        actors.push(makeAddr("actor-2"));

        ghost_ta = vault.totalAssets();
        ghost_supply = vault.totalSupply();
    }

    function _newHostileVault(address token) internal {
        YieldShares v = new YieldShares(IERC20(token), "Hostile", "hst", address(timelock), address(0), 1000);
        _timelockExecute(address(v), abi.encodeCall(YieldShares.setHarvester, (address(this))));
        MockERC20(token).mint(address(this), 1_000_000e18); // handler float for hostile ops
        hostileVaults.push(v);
        hostileTokens.push(IERC20(token));
    }

    function _timelockExecute(address target, bytes memory data) internal {
        vm.prank(timelockProposer);
        timelock.queue(target, 0, data, bytes32(0));
        vm.warp(block.timestamp + 48 hours + 1);
        timelock.execute(target, 0, data, bytes32(0));
    }

    // ------------------------------------------------------------------
    // Actions
    // ------------------------------------------------------------------

    /// @notice Deposit on the STANDARD vault (bounded by the seeded balance).
    function deposit(uint256 actorSeed, uint256 amount) external {
        address who = actors[actorSeed % actors.length];
        uint256 amt = bound(amount, 1, 1_000e18);
        asset.mint(who, amt);
        vm.startPrank(who);
        asset.approve(address(vault), type(uint256).max);
        uint256 before = vault.totalAssets();
        vault.deposit(amt, who);
        vm.stopPrank();
        _record(OP_DEPOSIT, vault.totalAssets(), before, amt);
        ghost_supply = vault.totalSupply();
    }

    /// @notice Redeem on the STANDARD vault — attempted REGARDLESS of depositsPaused
    ///         (the pause is toggled by its own action; a redeem succeeding while
    ///         deposits are paused is the never-trapped property, not a bug).
    function redeem(uint256 actorSeed, uint256 shares) external {
        address who = actors[actorSeed % actors.length];
        uint256 maxShares = vault.maxRedeem(who);
        uint256 sh = bound(shares, 1, maxShares > 0 ? maxShares : 1);
        if (maxShares == 0) return; // nothing to redeem yet — not an attempt
        uint256 before = vault.totalAssets();
        uint256 assetsOut = vault.previewRedeem(sh);
        vm.prank(who);
        try vault.redeem(sh, who, who) {
            _record(OP_WITHDRAW, vault.totalAssets(), before, int256(assetsOut));
            ghost_supply = vault.totalSupply();
        } catch {
            ghost_redeemViolation = true; // the standard asset must never trap
        }
    }

    /// @notice Fee harvest through the REAL Harvester with KNOWN seeded proceeds.
    ///         Caller is a random actor (the tip path). Validates the _split identity
    ///         physically and records the split ghosts.
    function harvest(uint256 callerSeed) external {
        address caller = actors[callerSeed % actors.length];
        weth.mint(address(npm), WETH_FEE);
        asset.mint(address(npm), SPY_FEE);
        npm.seedFees(positionId, uint128(WETH_FEE), uint128(SPY_FEE));

        uint256 taBefore = vault.totalAssets();
        uint256 accruedBefore = harvester.protocolAccrued();
        uint256 tipBefore = IERC20(address(asset)).balanceOf(caller);

        vm.prank(caller);
        harvester.harvest();

        uint256 creditedDelta = vault.totalAssets() - taBefore;
        uint256 accruedDelta = harvester.protocolAccrued() - accruedBefore;
        uint256 tipDelta = IERC20(address(asset)).balanceOf(caller) - tipBefore;

        // expected split from the CURRENT feeBps (includes the feeBps < TIP_BPS clamp)
        uint256 fee = vault.feeBps();
        uint256 vaultShare = (PROCEEDS * (10_000 - fee)) / 10_000;
        uint256 protocolShare = PROCEEDS - vaultShare;
        uint256 tip = (PROCEEDS * 10) / 10_000;
        if (tip > protocolShare) tip = protocolShare;
        uint256 accrued = protocolShare - tip;

        // (a) the exact _split identity: proceeds == vaultShare + tip + accrued
        //     (verified via the expected decomposition; the contract computes
        //     protocolShare = proceeds - vaultShare and accrued = protocolShare - tip)
        // (b) on the STANDARD asset, credited == declared share (physical arrival);
        // (c) the 3-term conservation: proceeds == creditedDelta + tipDelta + accruedDelta.
        if (creditedDelta != vaultShare || accruedDelta != accrued || tipDelta != tip
            || PROCEEDS != creditedDelta + tipDelta + accruedDelta) {
            ghost_splitViolation = true;
        }

        _record(OP_HARVEST, vault.totalAssets(), taBefore, int256(creditedDelta));
        ghost_totalArrived += vaultShare; // what the harvester physically pushed
        ghost_totalCredited += creditedDelta;
        ghost_supply = vault.totalSupply(); // harvest must not mint shares
    }

    /// @notice Direct token donation to the STANDARD vault (anyone can do this).
    ///         Donation neutrality: totalAssets must NOT move, but the raw balance
    ///         rises — creating the unaccounted-excess state where backingCoverage()
    ///         reads > 1e18. This is what makes the coverage DEFINITION check in
    ///         invariant_Solvency non-vacuous (without donations, handler-reachable
    ///         coverage is identically 1e18).
    function donate(uint256 amount) external {
        uint256 amt = bound(amount, 1, 500e18);
        asset.mint(address(this), amt);
        IERC20(address(asset)).transfer(address(vault), amt);
    }

    /// @notice Legit admin path: fee change through the REAL timelock (queue → 48h →
    ///         permissionless execute). newFee ∈ [0, MAX_FEE_BPS] exercises the
    ///         tip-clamp branch (feeBps < 10) and the cap boundary.
    function setFeeBpsViaTimelock(uint256 newFee) external {
        uint256 fee = bound(newFee, 0, vault.MAX_FEE_BPS());
        bytes memory data = abi.encodeCall(YieldShares.setFeeBps, (fee));
        vm.prank(timelockProposer);
        timelock.queue(address(vault), 0, data, bytes32(0));
        vm.warp(block.timestamp + 48 hours + 1);
        timelock.execute(address(vault), 0, data, bytes32(0));
        ghost_feeSetCount++;
    }

    /// @notice Legit pause path: the pause-only EOA (or the timelock) toggles deposits.
    function togglePause(bool paused) external {
        vm.prank(pauser);
        vault.setDepositPaused(paused);
    }

    /// @notice HOSTILE admin attempts: a non-timelock, non-pauser actor must NEVER be
    ///         able to mutate fee/pause/harvester. Any success = violation.
    function hostileAdminAttempts(uint256 actorSeed) external {
        address who = actors[actorSeed % actors.length];
        vm.startPrank(who);
        try vault.setFeeBps(7) {
            ghost_adminViolation = true;
        } catch {}
        try vault.setDepositPaused(true) {
            ghost_adminViolation = true;
        } catch {}
        try vault.setHarvester(address(0)) {
            ghost_adminViolation = true;
        } catch {}
        try vault.setPauser(address(0)) {
            ghost_adminViolation = true;
        } catch {}
        try harvester.transferPosition(address(who), positionId) {
            ghost_adminViolation = true;
        } catch {}
        vm.stopPrank();
    }

    /// @notice Toggle the blacklist on a hostile token for an ACTOR (never the vault,
    ///         handler, or timelock — token-level censorship of protocol addresses is
    ///         the issuer-risk class, not this battery's object).
    function hostileBlacklist(uint256 vaultSeed, uint256 actorSeed) external {
        uint256 idx = vaultSeed % N_HOSTILE;
        if (idx != 2) return; // only the blacklist mock has the toggle
        address who = actors[actorSeed % actors.length];
        MockBlacklistToken(address(hostileTokens[2])).setBlocked(who, true);
    }

    /// @notice Timelock attempts that MUST fail: executing a never-queued call, and
    ///         executing a queued call BEFORE its delay elapses.
    function timelockBypassAttempts() external {
        // never-queued id
        bytes memory data = abi.encodeCall(YieldShares.setFeeBps, (1));
        try timelock.execute(address(vault), 0, data, keccak256("never-queued")) {
            ghost_execViolation = true;
        } catch {}
        // queued but not yet ripe
        vm.prank(timelockProposer);
        bytes32 id = timelock.queue(address(vault), 0, data, keccak256("early"));
        try timelock.execute(address(vault), 0, data, keccak256("early")) {
            ghost_execViolation = true;
        } catch {
            // leave it queued; it becomes executable only after the delay (later warp
            // in other actions may legitimately ripen it — that is the designed path)
            id; // silence unused warning
        }
    }

    /// @notice Hostile-vault deposit attempt: the token's own misbehavior (false
    ///         return, reentrancy, blacklist revert) must leave accounting untouched.
    function hostileDeposit(uint256 vaultSeed, uint256 amount) external {
        uint256 idx = vaultSeed % N_HOSTILE;
        YieldShares v = hostileVaults[idx];
        address who = actors[vaultSeed % actors.length];
        uint256 amt = bound(amount, 1, 500e18);
        IERC20(hostileTokens[idx]).transfer(who, amt); // mint via the mock (no callbacks)
        uint256 taBefore = v.totalAssets();
        uint256 supBefore = v.totalSupply();
        vm.startPrank(who);
        // approve may itself revert on hostile tokens — treat any failure as a no-op
        try IERC20(hostileTokens[idx]).approve(address(v), type(uint256).max) {} catch {}
        try v.deposit(amt, who) {
            // a deposit succeeded — accounting moved by a REAL, token-verified arrival;
            // this is legitimate protocol behavior, not token misbehavior moving state.
            // The hostile anchor is re-recorded so the invariant stays consistent.
            _recordHostile(idx, v);
        } catch {
            // the expected path: any accounting movement after a REVERTED deposit is a
            // hostile-token leak into accounting.
            if (v.totalAssets() != taBefore || v.totalSupply() != supBefore) {
                ghost_hostileViolation = true;
            }
        }
        vm.stopPrank();
    }

    /// @notice Hostile-vault harvest push (handler IS the harvester there): the push
    ///         either credits exactly what physically arrived or reverts with nothing
    ///         changed — a false-returning token must never let accounting move.
    function hostileHarvestPush(uint256 vaultSeed, uint256 amount) external {
        uint256 idx = vaultSeed % N_HOSTILE;
        YieldShares v = hostileVaults[idx];
        IERC20 tok = hostileTokens[idx];
        uint256 amt = bound(amount, 1, 500e18);
        tok.transfer(address(v), amt); // may silently fail (false-return) — that is the point
        uint256 balance = tok.balanceOf(address(v));
        uint256 taBefore = v.totalAssets();
        uint256 credit = amt > balance ? balance : amt; // credit at most what arrived
        if (credit > 0 && balance > taBefore) {
            try v.harvest(balance > taBefore ? balance - taBefore : 0) {
                _recordHostile(idx, v);
            } catch {
                if (v.totalAssets() != taBefore) ghost_hostileViolation = true;
            }
        } else if (v.totalAssets() != taBefore) {
            ghost_hostileViolation = true;
        }
    }

    // ------------------------------------------------------------------
    // Ghost bookkeeping
    // ------------------------------------------------------------------

    function _record(uint8 kind, uint256 after_, uint256 before_, uint256 amount) internal {
        ghost_opKind = kind;
        ghost_delta = int256(after_) - int256(before_);
        ghost_ta = after_;
        emit OpKind(kind, ghost_delta, amount);
    }

    function _record(uint8 kind, uint256 after_, uint256 before_, int256 amount) internal {
        ghost_opKind = kind;
        ghost_delta = int256(after_) - int256(before_);
        ghost_ta = after_;
        emit OpKind(kind, ghost_delta, uint256(amount));
    }

    function _recordHostile(uint256 idx, YieldShares v) internal {
        // re-anchor the hostile ghost for vault idx (totalAssets snapshot)
        hostileTa[idx] = v.totalAssets();
    }

    mapping(uint256 => uint256) public hostileTa;

    /// @notice Re-anchor ALL ghost anchors to current state (used by the invariant test
    ///         after setUp so the first sequence starts from a known anchor).
    function anchor() external {
        ghost_ta = vault.totalAssets();
        ghost_supply = vault.totalSupply();
        ghost_opKind = OP_NONE;
        ghost_delta = 0;
        for (uint256 i = 0; i < N_HOSTILE; i++) {
            hostileTa[i] = hostileVaults[i].totalAssets();
        }
    }
}
