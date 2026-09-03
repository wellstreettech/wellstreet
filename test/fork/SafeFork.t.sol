// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {ISafe, ISafeProxyFactory} from "../../src/interfaces/ISafe.sol";
import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";

/// @notice Fork test against the LIVE Robinhood Chain (4663) Safe v1.4.1 stack —
///         proves the W11 launch posture ("born under Safe") with REAL Safe bytecode:
///         a Safe created through the live SafeProxyFactory is the timelock's ONLY
///         proposer; a plain EOA cannot queue; two owner signatures can; one cannot.
///
///         SKIPPED by default: these tests need an RPC endpoint (same contract as
///         SPYPool.fork.t.sol). Set WELLSTREET_ROBINHOOD_RPC_URL to run them, e.g.:
///           WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
///             forge test --match-contract SafeFork -vvv
///         If the public RPC flakes, the honest result is a documented skip — the
///         unit suites must pass regardless.
contract SafeForkTest is Test {
    // Live Safe v1.4.1 infrastructure on 4663 (eth_getCode-verified 2026-09-02 —
    // docs/ops/phase0/safe-fork.md evidence trail).
    address constant SAFE_SINGLETON = 0x41675C099F32341bf84BFc5382aF534df5C7461a;
    address constant SAFE_PROXY_FACTORY = 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67;

    uint256 constant TIMELOCK_DELAY = 172800; // 48h
    uint256 constant THRESHOLD = 2;
    uint256 constant OWNER_COUNT = 3;

    // Throwaway signer keys for the fork SIMULATION only (vm.sign inside the forked
    // EVM; never funded, never broadcast, the simulated Safe holds no value). Decimal
    // literals — no key material in any artifact.
    uint256 constant OWNER_KEY_A = 1;
    uint256 constant OWNER_KEY_B = 2;
    uint256 constant OWNER_KEY_C = 3;

    event CallQueued(
        bytes32 indexed id,
        address indexed target,
        uint256 value,
        bytes data,
        bytes32 salt,
        uint256 readyAt
    );

    function _rpc() internal view returns (string memory) {
        return vm.envOr("WELLSTREET_ROBINHOOD_RPC_URL", string(""));
    }

    function setUp() public {
        string memory rpc = _rpc();
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
    }

    /// @dev Creates a fresh 2-of-3 Safe through the LIVE factory and a timelock whose
    ///      proposer is that Safe — the "born under Safe" posture the deploy script
    ///      pins. Distinct saltNonce per call keeps CREATE2 addresses collision-free.
    function _deploySafeAndTimelock(uint256 saltNonce)
        internal
        returns (ISafe safe, WellstreetTimelock timelock, address[] memory owners)
    {
        owners = new address[](OWNER_COUNT);
        owners[0] = vm.addr(OWNER_KEY_A);
        owners[1] = vm.addr(OWNER_KEY_B);
        owners[2] = vm.addr(OWNER_KEY_C);
        bytes memory initializer = abi.encodeCall(
            ISafe.setup,
            (owners, THRESHOLD, address(0), hex"", address(0), address(0), 0, payable(address(0)))
        );
        address safeProxy =
            ISafeProxyFactory(SAFE_PROXY_FACTORY).createProxyWithNonce(SAFE_SINGLETON, initializer, saltNonce);
        safe = ISafe(safeProxy);
        timelock = new WellstreetTimelock(safeProxy, TIMELOCK_DELAY);
    }

    /// @dev Builds the timelock `queue` call signed by the two LOWEST addresses of the
    ///      owner set. The Safe's execTransaction target is the TIMELOCK (so
    ///      `msg.sender` inside the timelock is the Safe proxy = the proposer); the
    ///      call it queues targets a plain codeless address (a harmless call that
    ///      always succeeds when anyone executes it after the delay).
    function _signedQueueCall(ISafe safe, WellstreetTimelock timelock, bytes32 salt)
        internal
        view
        returns (address queuedTarget, bytes memory queueData, bytes memory safeCallData, bytes memory signatures)
    {
        queuedTarget = vm.addr(OWNER_KEY_A); // codeless — the queued call always succeeds
        queueData = hex"";
        safeCallData = abi.encodeCall(WellstreetTimelock.queue, (queuedTarget, 0, queueData, salt));
        signatures = _twoSignatures(safe, address(timelock), safeCallData);
    }

    /// @dev Signs the Safe transaction with two owner keys and packs the signatures in
    ///      ASCENDING order of signer address (GS026); each EOA signature is 65 bytes
    ///      {r}{s}{v}.
    function _twoSignatures(ISafe safe, address to, bytes memory data) internal view returns (bytes memory) {
        bytes32 safeTxHash =
            safe.getTransactionHash(to, 0, data, ISafe.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce());
        (uint8 v0, bytes32 r0, bytes32 s0) = vm.sign(OWNER_KEY_B, safeTxHash);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(OWNER_KEY_C, safeTxHash);
        // vm.addr(2) < vm.addr(3) is deterministic, but sort defensively: ascending by signer.
        if (vm.addr(OWNER_KEY_B) > vm.addr(OWNER_KEY_C)) {
            (v0, r0, s0, v1, r1, s1) = (v1, r1, s1, v0, r0, s0);
        }
        return abi.encodePacked(r0, s0, uint8(v0), r1, s1, uint8(v1));
    }

    function test_safeConfiguration_twoOfThree() public {
        if (bytes(_rpc()).length == 0) return; // skipped via setUp
        (ISafe safe,, address[] memory owners) = _deploySafeAndTimelock(11);
        assertEq(block.chainid, 4663);
        assertEq(safe.getThreshold(), THRESHOLD);
        address[] memory got = safe.getOwners();
        assertEq(got.length, OWNER_COUNT);
        for (uint256 i = 0; i < OWNER_COUNT; i++) {
            bool found = false;
            for (uint256 j = 0; j < got.length; j++) {
                if (got[j] == owners[i]) found = true;
            }
            assertTrue(found, "owner missing from the Safe");
        }
    }

    function test_directEoaQueueRevertsNotProposer() public {
        if (bytes(_rpc()).length == 0) return; // skipped via setUp
        (, WellstreetTimelock timelock,) = _deploySafeAndTimelock(12);
        address eoa = makeAddr("plain-eoa");
        vm.prank(eoa);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.NotProposer.selector, eoa));
        timelock.queue(address(timelock), 0, hex"", bytes32(uint256(1)));
    }

    function test_twoOwnerSignaturesQueue_thenExecuteAfterDelay() public {
        if (bytes(_rpc()).length == 0) return; // skipped via setUp
        (ISafe safe, WellstreetTimelock timelock,) = _deploySafeAndTimelock(13);
        assertEq(safe.getThreshold(), THRESHOLD);

        (address queuedTarget, bytes memory queueData, bytes memory safeCallData, bytes memory signatures) =
            _signedQueueCall(safe, timelock, bytes32(uint256(7)));
        bytes32 expectedId = timelock.hashCall(queuedTarget, 0, queueData, bytes32(uint256(7)));

        vm.recordLogs();
        bool ok = safe.execTransaction(
            address(timelock), 0, safeCallData, ISafe.Operation.Call, 0, 0, 0, address(0), payable(address(0)), signatures
        );
        assertTrue(ok, "2-of-3 execTransaction must succeed");

        // The emitted CallQueued id must match hashCall of the queued call.
        bytes32 emittedId = _lastQueuedIdOn(address(timelock));
        assertEq(emittedId, expectedId, "queued id must equal hashCall");
        assertEq(timelock.readyAt(expectedId), block.timestamp + TIMELOCK_DELAY);

        // Inside the 48h window nothing can execute (detection window, not prevention).
        vm.expectRevert(
            abi.encodeWithSelector(WellstreetTimelock.NotReady.selector, expectedId, block.timestamp + TIMELOCK_DELAY)
        );
        timelock.execute(queuedTarget, 0, queueData, bytes32(uint256(7)));

        // After the delay the executor is permissionless: anyone lands the call.
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        timelock.execute(queuedTarget, 0, queueData, bytes32(uint256(7)));
        assertEq(timelock.readyAt(expectedId), 0);
    }

    function test_oneSignatureRevertsBelowThreshold() public {
        if (bytes(_rpc()).length == 0) return; // skipped via setUp
        (ISafe safe,,) = _deploySafeAndTimelock(14);
        bytes memory empty = hex"";
        bytes32 safeTxHash = safe.getTransactionHash(
            address(safe), 0, empty, ISafe.Operation.Call, 0, 0, 0, address(0), address(0), safe.nonce()
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OWNER_KEY_A, safeTxHash);
        bytes memory oneSignature = abi.encodePacked(r, s, uint8(v));

        // 65 signature bytes < threshold * 65 — live v1.4.1 bytecode reverts with GS020.
        vm.expectRevert(bytes("GS020"));
        safe.execTransaction(
            address(safe), 0, empty, ISafe.Operation.Call, 0, 0, 0, address(0), payable(address(0)), oneSignature
        );
    }

    /// @dev Pulls the id of the LAST CallQueued event emitted by `emitter` from the
    ///      recorded logs (topics: [selector, id, target]).
    function _lastQueuedIdOn(address emitter) internal view returns (bytes32) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = logs.length; i > 0; i--) {
            if (logs[i - 1].emitter == emitter && logs[i - 1].topics[0] == CallQueued.selector) {
                return logs[i - 1].topics[1];
            }
        }
        revert("CallQueued event not found");
    }
}
