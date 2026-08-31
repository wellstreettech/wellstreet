// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title WellstreetTimelock — 48-hour timelock for all Wellstreet protocol owner
///        controls (vault fee, deposit pause policy, pause-role revocation, harvester
///        wiring, LP-position custody).
/// @notice Clean-room implementation (no governance framework dependency). Trust model,
///         disclosed on purpose: a SINGLE proposer key (the Wellstreet deployer EOA)
///         with an OPEN executor — anyone can execute a queued call once its delay has
///         elapsed. The 48-hour window is a public detection window, not prevention:
///         every queued call is visible on-chain (CallQueued event) for the whole delay
///         before it can land. Never represent this as "no single key can act alone".
///
/// Flow:
///   1. The proposer queues (target, value, data, salt) — id = hashCall(...).
///   2. `delay` seconds pass (anyone can watch CallQueued / readyAt).
///   3. ANYONE executes the call. A cancelled or unqueued id can never execute.
contract WellstreetTimelock {
    /// @notice Floor for the configured delay: 48 hours. Enforced on-chain so a
    ///         deployment can never ship a shorter window than the announced commitment.
    uint256 public constant MIN_DELAY = 48 hours;

    /// @notice The only address that can queue or cancel calls (the Wellstreet deployer EOA).
    address public immutable proposer;

    /// @notice Seconds a queued call must wait before it can be executed.
    uint256 public immutable delay;

    /// @notice id -> timestamp at which the call becomes executable (0 = not queued).
    mapping(bytes32 => uint256) public readyAt;

    event CallQueued(
        bytes32 indexed id,
        address indexed target,
        uint256 value,
        bytes data,
        bytes32 salt,
        uint256 readyAt
    );
    event CallCancelled(bytes32 indexed id);
    event CallExecuted(bytes32 indexed id, address indexed target, uint256 value, bytes data);

    error ZeroAddress();
    error DelayTooShort(uint256 requested, uint256 minDelay);
    error NotProposer(address caller);
    error NotQueued(bytes32 id);
    error AlreadyQueued(bytes32 id);
    error NotReady(bytes32 id, uint256 readyAt);
    error ExecutionFailed(bytes32 id);

    /// @param proposer_ The single proposer (Wellstreet deployer EOA).
    /// @param delay_    The queue delay; must be >= MIN_DELAY (48h).
    constructor(address proposer_, uint256 delay_) {
        if (proposer_ == address(0)) revert ZeroAddress();
        if (delay_ < MIN_DELAY) revert DelayTooShort(delay_, MIN_DELAY);
        proposer = proposer_;
        delay = delay_;
    }

    modifier onlyProposer() {
        if (msg.sender != proposer) revert NotProposer(msg.sender);
        _;
    }

    /// @notice Deterministic operation id. The data is hashed before encoding so the id
    ///         is independent of ABI padding choices; `salt` lets the proposer queue the
    ///         same call twice at different times (e.g. a repeat of an expired pattern).
    function hashCall(address target, uint256 value, bytes calldata data, bytes32 salt)
        public
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(target, value, keccak256(data), salt));
    }

    /// @notice Queue a call. Only the proposer.
    function queue(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        onlyProposer
        returns (bytes32 id)
    {
        if (target == address(0)) revert ZeroAddress();
        id = hashCall(target, value, data, salt);
        if (readyAt[id] != 0) revert AlreadyQueued(id);
        uint256 ready = block.timestamp + delay;
        readyAt[id] = ready;
        emit CallQueued(id, target, value, data, salt, ready);
    }

    /// @notice Cancel a queued call before execution. Only the proposer.
    function cancel(bytes32 id) external onlyProposer {
        if (readyAt[id] == 0) revert NotQueued(id);
        delete readyAt[id];
        emit CallCancelled(id);
    }

    /// @notice Execute a queued call. PERMISSIONLESS: no caller restriction — after the
    ///         delay, anyone may land a queued call (including the target of scrutiny).
    function execute(address target, uint256 value, bytes calldata data, bytes32 salt)
        external
        returns (bytes memory returndata)
    {
        bytes32 id = hashCall(target, value, data, salt);
        uint256 ready = readyAt[id];
        if (ready == 0) revert NotQueued(id);
        if (block.timestamp < ready) revert NotReady(id, ready);
        delete readyAt[id];
        bool ok;
        (ok, returndata) = target.call{value: value}(data);
        if (!ok) revert ExecutionFailed(id);
        emit CallExecuted(id, target, value, data);
    }

    /// @notice Accept native ETH so the timelock can custody treasury value and fund
    ///         queued calls that carry a value.
    receive() external payable {}
}
