// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title ISafe + ISafeProxyFactory — vendored minimal interface for Safe v1.4.1.
/// @notice Hand-vendored (no npm/submodule dependency) and covering only the surface
///         this repo needs: proxy creation through the LIVE SafeProxyFactory, owner-
///         signature transaction execution, and the view getters used to inspect and
///         hash a Safe transaction. Source of truth: safe-global/safe-contracts v1.4.1.
///         Safe facts this interface relies on:
///           - `setup` initializes the proxy through the factory's `initializer`
///             calldata; v1.4.1 imposes NO ordering requirement on the owners array.
///           - `execTransaction` signatures must be concatenated in ASCENDING order of
///             signer address (enforced by GS026); each EOA signature is 65 bytes
///             packed {r}{s}{v}.
///           - Fewer signature bytes than `threshold * 65` reverts with GS020.
interface ISafe {
    enum Operation {
        Call,
        DelegateCall
    }

    /// @notice One-time Safe initialization (invoked through the fresh proxy as the
    ///         factory's `initializer` calldata). `to`/`data` set up modules (unused
    ///         here); `fallbackHandler` address(0) means none (the core
    ///         propose/confirm/execute flow does not require one).
    function setup(
        address[] calldata _owners,
        uint256 _threshold,
        address to,
        bytes calldata data,
        address fallbackHandler,
        address paymentToken,
        uint256 payment,
        address payable paymentReceiver
    ) external;

    /// @notice Executes a transaction once `threshold` valid signatures are provided.
    ///         With `gasPrice = 0` no gas refund is paid and the Safe needs no balance.
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        ISafe.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success);

    /// @notice Number of signatures required for `execTransaction` (2 = the 2-of-3 posture).
    function getThreshold() external view returns (uint256);

    /// @notice The Safe's owner addresses.
    function getOwners() external view returns (address[] memory);

    /// @notice The Safe's transaction nonce (each `execTransaction` increments it).
    function nonce() external view returns (uint256);

    /// @notice EIP-712 hash a Safe transaction signs. Available through the proxy (the
    ///         proxy delegatecalls the singleton). Used instead of hand-rolling the
    ///         EIP-712 domain/typed-data encoding.
    function getTransactionHash(
        address to,
        uint256 value,
        bytes calldata data,
        ISafe.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) external view returns (bytes32);
}

/// @notice Minimal surface of the LIVE SafeProxyFactory (v1.4.1) on Robinhood Chain 4663.
interface ISafeProxyFactory {
    /// @notice Deploys a new Safe proxy whose singleton is `_singleton`, running
    ///         `initializer` (e.g. an `ISafe.setup` call) against it at creation, with
    ///         CREATE2-derived address from `saltNonce`.
    function createProxyWithNonce(address _singleton, bytes memory initializer, uint256 saltNonce)
        external
        returns (address proxy);
}
