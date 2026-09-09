// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {RoamAllowlist} from "../src/RoamAllowlist.sol";
import {RoamingHarvester} from "../src/RoamingHarvester.sol";
import {RoamVault} from "../src/RoamVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title DeployRoamers — the POL roamer + allowlist + RoamVault deployment
/// @notice Deploys, in order: RoamAllowlist (timelock-governed book registry) →
///         RoamingHarvester (the POL roamer, capital-inert until seeded) →
///         RoamVault (the USDG-anchored user vault, init-paused, capped 25k start).
///         EVERY post-deploy activation is Safe → 48h timelock:
///           P1 roamer.setVault(vault, USDG)        (one-shot binding)
///           P2 vault.setDepositPaused(false)       (open deposits)
///           P3 timelock: vault.vaultDeploy(key, capitalUsdg)   (the seed deploy)
///           P4 roamer.setWellToken($WELL)          (post-$WELL-launch, one-shot)
///         Guardrail starts (Safe-tunable within immutable ceilings):
///           MIN_HOLD 7d (ceiling 30d) · MAX_MIGRATIONS 4/rolling-365d (ceiling 52)
///           MIN_EXPECTED_GAIN_BPS 3911 (ceiling 31286) · migrationFeeBps 0 (cap 2000)
///
/// Env required: TIMELOCK, TREASURY, PAUSER, USDG, DEPOSIT_CAP (raw 6-dec)
/// Broadcast: forge script script/DeployRoamers.s.sol \
///   --account wellstreet-deployer --interactive --rpc-url robinhood --broadcast
contract DeployRoamers is Script {
    /// @dev Guardrail starts — the ratified defaults (GOAL_ROAMING_HARVESTER lock).
    uint32 constant MIN_HOLD_START = 604_800;        // 7 days (ceiling 30d)
    uint16 constant MAX_MIG_START = 4;               // per rolling 365d (ceiling 52)
    uint32 constant MIN_GAIN_START = 3_911;          // bps (ceiling 31_286)
    uint32 constant MIGRATION_FEE_START = 0;         // zero until the Safe sets the
                                                     // operating value (cap 2000)

    function run() external {
        address timelock = vm.envAddress("TIMELOCK");
        address treasury = vm.envAddress("TREASURY");
        address pauser = vm.envAddress("PAUSER");
        address usdg = vm.envAddress("USDG");
        uint256 depositCap = vm.envUint("DEPOSIT_CAP");

        require(timelock != address(0) && treasury != address(0) && pauser != address(0) && usdg != address(0), "env missing");
        require(depositCap <= 250_000 * 1e6, "cap above immutable ceiling");

        vm.startBroadcast();

        // 1. The book registry — governed by the SAME timelock as the roamer
        //    (RoamingHarvester enforces AllowlistTimelockMismatch at its constructor).
        RoamAllowlist allowlist = new RoamAllowlist(timelock);

        // 2. The POL roamer — capital-inert: no positions, no Well token, nothing
        //    at risk until the Safe seeds and binds.
        RoamingHarvester roamer = new RoamingHarvester(
            timelock,
            treasury,
            address(allowlist),
            MIN_HOLD_START,
            MAX_MIG_START,
            MIN_GAIN_START,
            MIGRATION_FEE_START
        );

        // 3. The anchor vault — init-paused, capped 25,000 USDG start.
        RoamVault vault = new RoamVault(
            IERC20(usdg),
            "Wellstreet Roam USDG",
            "wsrUSDG",
            timelock,
            pauser,
            depositCap
        );

        vm.stopBroadcast();

        // Registry echo for the runbook record — verify each on the explorer:
        //   allowlist.timelock() == TIMELOCK
        //   roamer.poolManager() == FORK_POOL_MANAGER_4663 (the pin IS the value)
        //   roamer.allowlist() == address(allowlist)
        //   roamer.minHoldSeconds() == 604_800 · roamer.maxMigrationsPerPeriod() == 4
        //   roamer.minExpectedGainBps() == 3_911 · roamer.migrationFeeBps() == 0
        //   vault.asset() == USDG · vault.depositsPaused() == true
        console.log("DEPLOYED RoamAllowlist:", address(allowlist));
        console.log("DEPLOYED RoamingHarvester:", address(roamer));
        console.log("DEPLOYED RoamVault:", address(vault));
        console.log("NEXT: Safe proposals P1-P3 (see docs/ops/roamer-deploy-runbook.md)");
    }
}
