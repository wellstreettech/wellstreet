// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldShares} from "./YieldShares.sol";
import {HarvesterV4, IPoolManagerV4} from "./HarvesterV4.sol";

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
    event VaultV4Created(
        address indexed asset, address indexed vault, address indexed harvester, address poolManager
    );

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

    /// @notice One-call v4 creation config.
    /// @param asset       The vault asset (yield denomination) — must be one of the
    ///                    poolKey's two currencies.
    /// @param name        Share token name (e.g. "Wellstreet SPY").
    /// @param symbol      Share token symbol (e.g. "ws-SPY").
    /// @param poolManager The fork PoolManager (HarvesterV4 enforces the fork pin).
    /// @param poolKey     The v4 PoolKey of the target book (currency0 < currency1).
    /// @param weth        WETH9 (wraps a native-ETH fee leg before the swap).
    /// @param swapPath    v3 swap path quote-leg→asset (starts at the quote token, or
    ///                    WETH when the quote leg is the native currency; ends at
    ///                    `asset`).
    /// @param router      Uniswap V3 SwapRouter02.
    /// @param quoter      Uniswap V3 QuoterV2.
    struct V4Config {
        address asset;
        string name;
        string symbol;
        address poolManager;
        IPoolManagerV4.PoolKey poolKey;
        address weth;
        bytes swapPath;
        address router;
        address quoter;
    }

    /// @notice Deploy the canonical YieldShares vault for `asset` TOGETHER with its
    ///         HarvesterV4 — the direct-to-PoolManager harvester variant that LPs into
    ///         the RH-4663 Uniswap v4 FORK books (PoolManager pin enforced by the
    ///         harvester's own constructor: canonical v4 addresses on 4663 are scam
    ///         drainers). The vault registers in the SAME one-vault-per-asset registry
    ///         as createVault (vaultOfAsset/allVaults preserved; a v4 vault and a v3
    ///         vault for the same asset are mutually exclusive by that rule).
    ///
    ///         The harvester is NOT auto-wired: YieldShares.setHarvester is
    ///         timelock-only, so the treasury timelock queues it (48h) exactly as in
    ///         the v3 deploy flow. HarvesterV4's constructor validates the poolKey
    ///         shape (currency ordering, tickSpacing, native-vs-WETH asset collision,
    ///         the PoolManager pin) — a bad config reverts the whole creation
    ///         atomically and no registry row is written.
    /// @param cfg The v4 creation config (one calldata struct — the flat 9-argument
    ///            form overflows the legacy codegen stack budget).
    function createVaultV4(V4Config calldata cfg) external returns (address vault, address harvester) {
        if (cfg.asset == address(0)) revert ZeroAddress();
        if (vaultOfAsset[cfg.asset] != address(0)) revert VaultAlreadyExists(cfg.asset);

        vault = address(
            new YieldShares(IERC20(cfg.asset), cfg.name, cfg.symbol, timelock, initialPauser, initialFeeBps)
        );
        harvester = address(
            new HarvesterV4(
                vault, timelock, timelock, cfg.asset, cfg.poolManager, cfg.poolKey, cfg.weth, cfg.swapPath,
                cfg.router, cfg.quoter
            )
        );

        vaultOfAsset[cfg.asset] = vault;
        _allVaults.push(vault);
        emit VaultCreated(cfg.asset, vault, cfg.name, cfg.symbol);
        emit VaultV4Created(cfg.asset, vault, harvester, cfg.poolManager);
    }

    /// @notice Number of vaults created by this factory.
    function allVaultsLength() external view returns (uint256) {
        return _allVaults.length;
    }
}
