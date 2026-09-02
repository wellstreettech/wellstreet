// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {YieldShares} from "../../src/YieldShares.sol";
import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";
import {Handler} from "./Handler.t.sol";

/// @notice Stateful invariant battery for the YieldShares vault + Harvester
///         (arXiv:2404.14580's taxonomy instantiated as Wellstreet RELATIONAL
///         invariants — relations, never static bounds on drifting values — merged
///         with the deep-dive rank-2 harvester-side invariants and rank-6's
///         backingCoverage DEFINITION check). EIGHT hand-written invariant_ functions:
///
///          1. invariant_Solvency — vault asset balance >= Σ accounted deposits
///             (handler-reachable states only; the Handler carries NO issuer-burn
///             action — the only violator is the external adminBurn that
///             backingCoverage() exists to surface), folding in the P3 adoption's
///             backingCoverage() DEFINITION check (the view equals the pinned ratio;
///             NEVER coverage >= 1).
///          2. invariant_TotalAssetsDeltaBounded — totalAssets deltas are in
///             {+deposit, +harvest credit, -withdraw} only (no share mint on yield,
///             no unexplained drift).
///          3. invariant_HarvestBoundedByExcess — ghost totalCredited <=
///             totalPhysicallyArrived across arbitrary sequences (the ExcessTooSmall
///             bound proven sequence-safe, not just single-call-safe), and harvest
///             mints no shares (supply changes only on deposit/redeem ops).
///          4. invariant_AdminPathsTimelockOnly — fee/pause/harvester/pauser changes
///             only via the timelock or the pause-only role (any other success is a
///             recorded violation), and feeBps <= MAX_FEE_BPS (2000) invariantly.
///          5. invariant_RedeemNeverTrapped — SCOPED to the standard asset: every
///             handler redeem attempt (including while deposits are paused and after
///             admin churn/timelock operations) succeeds; hostile-asset reverts are
///             token-level censorship, out of scope by pin.
///          6. invariant_ExecuteRequiresQueuedPlusDelay — the timelock never executes
///             a call that was not queued, and never before its delay; delay >= 48h.
///          7. invariant_SplitConservation — over Harvester._split: the exact identity
///             proceeds == vaultShare + tip + accrued (any feeBps, including the
///             feeBps < TIP_BPS tip-clamp branch), and on the STANDARD asset
///             vaultCredited == vaultShare, yielding the deep-dive 3-term conservation
///             proceeds == vaultCredited + tip + accrued exactly. (The earlier draft's
///             4-term form double-counted the vault leg and is never shipped.)
///          8. invariant_HostileTokenInertness — a false-returning / reentrant /
///             blacklist-reverting token can neither move vault accounting (outside an
///             authorized, arrival-bounded credit) nor reach the LP principal.
contract YieldSharesInvariantsTest is Test {
    Handler internal handler;

    function setUp() public {
        handler = new Handler();
        handler.anchor();
        targetContract(address(handler));
    }

    // ------------------------------------------------------------------
    // 1. Solvency + backingCoverage definition (never coverage >= 1)
    // ------------------------------------------------------------------

    function invariant_Solvency() public view {
        YieldShares vault = handler.vault();
        uint256 ta = vault.totalAssets();
        uint256 balance = IERC20(address(handler.asset())).balanceOf(address(vault));
        // handler-reachable states: the vault always holds at least its accounted assets
        assertGe(balance, ta, "vault balance below accounted assets");
        // backingCoverage() must equal the pinned definition, exactly:
        //   ta == 0 -> 1e18 (degenerate-safe sentinel); else balance*1e18/ta (mulDiv)
        uint256 expected = ta == 0 ? 1e18 : Math.mulDiv(balance, 1e18, ta);
        assertEq(vault.backingCoverage(), expected, "backingCoverage != pinned definition");
    }

    // ------------------------------------------------------------------
    // 2. totalAssets deltas are bounded to the three accounting paths
    // ------------------------------------------------------------------

    function invariant_TotalAssetsDeltaBounded() public view {
        YieldShares vault = handler.vault();
        assertEq(vault.totalAssets(), handler.ghost_ta(), "totalAssets drifted outside a recorded op");
        uint8 kind = handler.ghost_opKind();
        int256 delta = handler.ghost_delta();
        if (kind == handler.OP_DEPOSIT()) {
            assertGe(delta, 0, "deposit recorded a negative delta");
        } else if (kind == handler.OP_HARVEST()) {
            assertGe(delta, 0, "harvest credit recorded a negative delta");
        } else if (kind == handler.OP_WITHDRAW()) {
            assertLe(delta, 0, "withdraw recorded a positive delta");
        }
    }

    // ------------------------------------------------------------------
    // 3. harvest is bounded by the physical excess; mints no shares
    // ------------------------------------------------------------------

    function invariant_HarvestBoundedByExcess() public view {
        // every credited asset was physically arrived first (sequence-safe Excess bound)
        assertLe(handler.ghost_totalCredited(), handler.ghost_totalArrived(), "credited exceeded physically arrived");
        // harvest mints no shares: supply moves only on deposit/redeem ops, and the
        // handler re-anchors the supply ghost after every op — equality proves no
        // unaccounted supply change (a harvest minting shares would break it).
        assertEq(handler.vault().totalSupply(), handler.ghost_supply(), "share supply changed outside deposit/redeem");
    }

    // ------------------------------------------------------------------
    // 4. admin paths are timelock-only; fee capped
    // ------------------------------------------------------------------

    function invariant_AdminPathsTimelockOnly() public view {
        assertFalse(handler.ghost_adminViolation(), "a non-timelock admin path succeeded");
        assertLe(handler.vault().feeBps(), handler.vault().MAX_FEE_BPS(), "feeBps above the hard cap");
    }

    // ------------------------------------------------------------------
    // 5. redemption is never trapped (standard asset; pause-proof)
    // ------------------------------------------------------------------

    function invariant_RedeemNeverTrapped() public view {
        assertFalse(handler.ghost_redeemViolation(), "a bounded standard-asset redeem failed");
    }

    // ------------------------------------------------------------------
    // 6. timelock executes only queued calls, only after the delay
    // ------------------------------------------------------------------

    function invariant_ExecuteRequiresQueuedPlusDelay() public view {
        assertFalse(handler.ghost_execViolation(), "timelock executed unqueued or before delay");
        WellstreetTimelock tl = handler.timelock();
        assertGe(tl.delay(), tl.MIN_DELAY(), "timelock delay below the 48h floor");
    }

    // ------------------------------------------------------------------
    // 7. _split conservation (3-term, any feeBps incl. the tip clamp)
    // ------------------------------------------------------------------

    function invariant_SplitConservation() public view {
        assertFalse(handler.ghost_splitViolation(), "the _split identity or the credited==declared equality broke");
    }

    // ------------------------------------------------------------------
    // 8. hostile tokens are inert (accounting + LP principal)
    // ------------------------------------------------------------------

    function invariant_HostileTokenInertness() public view {
        assertFalse(handler.ghost_hostileViolation(), "a hostile-token attempt moved vault accounting");
        for (uint256 i = 0; i < handler.N_HOSTILE(); i++) {
            assertEq(
                handler.hostileVaults(i).totalAssets(),
                handler.hostileTa(i),
                "hostile vault accounting drifted outside recorded ops"
            );
        }
        // the LP principal is unreachable from the hostile stacks: the standard
        // harvester's position is byte-identical to its deployment anchor.
        assertEq(handler.harvester().positionId(), handler.positionId(), "LP principal touched");
    }
}
