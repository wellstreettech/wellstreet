// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldShares} from "./YieldShares.sol";

/// @title VaultFactory — deploys YieldShares vaults and keeps the public on-chain
///        registry (one vault per asset).
/// @notice Permissionless creation, but ONE vault per asset forever: the canonical
///         vault for a stock token is discoverable by anyone via vaultOfAsset(asset)
///         and the allVaults() list — no off-chain registry needed (serverless-clean
///         frontend reads this directly via eth_call).
contract VaultFactory {
    /// @notice The 48h treasury timelock every created vault answers to.
    address public immutable timelock;
    /// @notice Initial function-limited pause-only EOA granted to created vaults
    ///         (revocable per-vault by the timelock).
    address public immutable initialPauser;
    /// @notice Initial protocol fee (bps) applied to created vaults. The fee cap is
    ///         enforced by the vault's own constructor (YieldShares.FeeTooHigh) —
    ///         an over-cap value passes through the factory but can never become a
    ///         live vault (createVault reverts at vault construction).
    uint256 public immutable initialFeeBps;

    /// @notice asset => vault (zero address = no vault yet).
    mapping(address => address) public vaultOfAsset;

    address[] private _allVaults;

    event VaultCreated(address indexed asset, address indexed vault, string name, string symbol);

    error ZeroAddress();
    error VaultAlreadyExists(address asset);

    /// @param timelock_      The 48h treasury timelock (sole vault admin).
    /// @param initialPauser_ Initial pause-only EOA for created vaults.
    /// @param initialFeeBps_ Initial protocol fee in bps for created vaults.
    constructor(address timelock_, address initialPauser_, uint256 initialFeeBps_) {
        if (timelock_ == address(0)) revert ZeroAddress();
        timelock = timelock_;
        initialPauser = initialPauser_;
        initialFeeBps = initialFeeBps_;
    }

    /// @notice Deploy the canonical YieldShares vault for `asset`. Reverts if a vault
    ///         for this asset already exists (one vault per asset, enforced on-chain).
    /// @param asset  The tokenized stock token to wrap.
    /// @param name   Share token name (e.g. "Wellstreet SPY").
    /// @param symbol Share token symbol (e.g. "ws-SPY").
    function createVault(address asset, string calldata name, string calldata symbol)
        external
        returns (address vault)
    {
        if (asset == address(0)) revert ZeroAddress();
        if (vaultOfAsset[asset] != address(0)) revert VaultAlreadyExists(asset);

        vault = address(
            new YieldShares(IERC20(asset), name, symbol, timelock, initialPauser, initialFeeBps)
        );

        vaultOfAsset[asset] = vault;
        _allVaults.push(vault);
        emit VaultCreated(asset, vault, name, symbol);
    }

    /// @notice Full public registry read.
    function allVaults() external view returns (address[] memory) {
        return _allVaults;
    }

    /// @notice Number of vaults created by this factory.
    function allVaultsLength() external view returns (uint256) {
        return _allVaults.length;
    }
}
