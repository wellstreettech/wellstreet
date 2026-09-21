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
///         Broadcast (USER-GATED) — path A, forge script:
///             forge script script/DeployFleetRouter.s.sol \
///                 --account wellstreet-deployer --interactive \
///                 --sender 0x62f0bcd442a70cb86c0e2ed7f66022a1f6a046e1 \
///                 --rpc-url robinhood --broadcast
///
///         ⚠ Tripwire 1 — --sender is REQUIRED on forge 1.7.x: --account supplies the
///         signer but the broadcast txs still carry Foundry's default sender unless
///         --sender is pinned, and the broadcast gate aborts with "You seem to be using
///         Foundry's default sender" (hit 2026-09-20 — refused BEFORE signing; hash:null
///         in the saved artifact = nothing was ever sent). 0x62f0…46e1 IS the
///         wellstreet-deployer keystore's address (09-09 production receipts).
///
///         ⚠ Tripwire 2 — the signing-stage prompt can reject a GOOD password (forge
///         1.7.x): with --sender pinned, keystore decryption is deferred to the prompt
///         AFTER the gas estimates, and that deferred path rejected a password proven
///         good twice the same day (cast wallet address accepted it minutes earlier; a
///         --sender-less run's startup prompt accepted it too) — identical
///         "incorrect password" both times. Two identical rejections = stop retrying
///         the script; switch to path B:
///
///         Broadcast — path B, forge create (one direct prompt, the cast-send family):
///             FOUNDRY_ETH_RPC_URL=<rpc> ETH_RPC_URL=<rpc> \
///                 forge create src/FleetRouter.sol:FleetRouter \
///                 --account wellstreet-deployer --interactive \
///                 --rpc-url https://rpc.mainnet.chain.robinhood.com \
///                 --broadcast \
///                 --constructor-args 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3 0xD55bA510533dc5a250b4D6d49Ee825113DD69342
///         (⚠ --constructor-args MUST BE LAST: a greedy multi-value flag on forge 1.7.1
///         that swallows EVERY trailing token INCLUDING other flags — args placed before
///         it surfaced as "Constructor argument count mismatch: expected 2 but got 7"
///         (it ate --account/--interactive/--rpc-url too), and the swallowed --rpc-url is
///         why the first runs died on localhost:8545. Keep the env vars as belt-and-braces.
///         ⚠ Tripwire 4 — forge create is DRY-RUN BY DEFAULT on 1.7.1 (hit 2026-09-21):
///         without --broadcast it prints the full tx JSON + "To broadcast this transaction,
///         add --broadcast" and sends NOTHING (nonce untouched — a free full dress
///         rehearsal: pins, fee constant, nonce, chainId all verifiable in the dry-run
///         input tail). No --sender on forge create — the signer IS the from. Constructor
///         arg ORDER = npm, then timelock.)
///
///         ✅ CONFIRMED DEPLOYED 2026-09-21 — RH chain 4663:
///             FleetRouter 0xAFAE77E6B13a5350682C0d1a7876A3F309EEC0C9
///             tx 0xe8b9956c5bb0a0ef6bc25b987919560117133be02215acfff85c1fdc6952f8fb
///             (block 68614089, gasUsed 804,507 @ ~0.05 gwei, deployer 0x62f0…46e1 @
///             nonce 25 → 26). The landed address matches the nonce-math prediction
///             EXACTLY. Keyless verification battery 9/9 GREEN from the live chain:
///             npm()/timelock()/fee()/MAX_FEE() == pins, code present (~3.26 KB runtime),
///             nonce 26, and a free eth_call setFee(1) from a non-timelock address
///             reverted ONLY_TIMELOCK — the fee-lane governance guard is live on the
///             deployed bytecode. Canonical ops record: docs/ops/fleet-router-runbook.md
///             (local-only). Still USER-GATED: site config/skill/registry address pins
///             and the whitepaper "router exists" lines (LOCKSTEP PDF).
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
