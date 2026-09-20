// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {FleetRouter} from "../src/FleetRouter.sol";

/// @notice Deploy FleetRouter v1 — the self-custodied one-tx LP entry router
///         (audit 2026-09-20 F-2: the constructor args are IMMUTABLE and unfixable
///         post-deploy, so the pins are ECHOED and ASSERTED in-script — never trusted
///         to a comment. Typo modes this guards: npm_ → an EOA = every open reverts at
///         decode (total DoS); timelock_ → a receive-less contract = FeeForwardFailed
///         on every open; timelock_ → the Safe proxy = a SILENT fee-lane governance
///         bypass, because the Safe has a payable receive and setFee becomes
///         Safe-executable (still MAX_FEE-capped).)
///
///         Dry run (no broadcast):  forge script script/DeployFleetRouter.s.sol --rpc-url robinhood
///         Broadcast (USER-GATED):
///             forge script script/DeployFleetRouter.s.sol \
///                 --account wellstreet-deployer --interactive \
///                 --rpc-url robinhood --broadcast
///
///         Post-broadcast (runbook): keyless reads of router.npm()/timelock()/fee()
///         diffed against the pins — the script re-reads them below, but the runbook
///         re-proves them from the chain afterward (never trust the simulation alone).
contract DeployFleetRouter is Script {
    // A11(iv) pins — the CONSTRUCTOR ARGS, asserted against the literals below so a
    // drifted constant can never reach a broadcast. Do NOT move these asserts into the
    // contract constructor: hardcoding the pins there would defeat A11(iv)'s whole
    // point (the constructor args ARE the pin mechanism).
    address constant NPM_PIN = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant TIMELOCK_PIN = 0xD55bA510533dc5a250b4D6d49Ee825113DD69342;

    uint256 constant FEE_START = 0.0005 ether;

    function run() external {
        require(block.chainid == 4663, "wrong chain: expected 4663");

        // F-2 asserts — echo + assert BEFORE any broadcast.
        console2.log("npm pin     :", NPM_PIN);
        console2.log("timelock pin:", TIMELOCK_PIN);
        require(NPM_PIN == 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3, "NPM_PIN_MISMATCH");
        require(TIMELOCK_PIN == 0xD55bA510533dc5a250b4D6d49Ee825113DD69342, "TIMELOCK_PIN_MISMATCH");
        require(NPM_PIN.code.length > 0, "NPM_PIN has no code");
        require(TIMELOCK_PIN.code.length > 0, "TIMELOCK_PIN has no code");

        vm.startBroadcast();
        FleetRouter router = new FleetRouter(NPM_PIN, TIMELOCK_PIN);
        vm.stopBroadcast();

        // Post-deploy read-backs in the same run (the runbook re-proves from the
        // chain later — these catch a wrong-arg deploy at simulation time too).
        console2.log("FleetRouter    :", address(router));
        console2.log("router.npm     :", router.npm());
        console2.log("router.timelock:", router.timelock());
        console2.log("router.fee wei :", router.fee());
        require(router.npm() == NPM_PIN, "POSTDEPLOY_NPM_MISMATCH");
        require(router.timelock() == TIMELOCK_PIN, "POSTDEPLOY_TIMELOCK_MISMATCH");
        require(router.fee() == FEE_START, "POSTDEPLOY_FEE_MISMATCH");
    }
}
