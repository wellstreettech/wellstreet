// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";

/// @notice A trivial proposer CONTRACT (no Safe dependency). Pins the semantics the
///         W11 launch posture relies on: the timelock's proposer is just an address,
///         and ANY contract can hold the role — `queue` from inside the contract
///         succeeds because `msg.sender` is the contract itself. The production role
///         is held by a 2-of-3 Safe multisig; the real Safe flow is measured against
///         live bytecode in test/fork/SafeFork.t.sol.
contract MockProposer {
    address public timelock;

    /// @dev Two-phase wiring: the timelock's constructor needs the proposer's address,
    ///      so the mock cannot take it at its own construction. Test-only, no access
    ///      control needed.
    function setTimelock(address timelock_) external {
        timelock = timelock_;
    }

    /// @dev Forwards to the timelock — `msg.sender` inside the timelock is THIS
    ///      contract, so the `onlyProposer` check passes.
    function queue(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        returns (bytes32)
    {
        return WellstreetTimelock(payable(timelock)).queue(target, value, data, salt);
    }
}
