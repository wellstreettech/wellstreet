// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title RoamAllowlist — the timelock-gated book registry the RoamingHarvester's
///        migrate() validates its target books against (07_ROAM_POLICY_BACKTEST §3:
///        "toKey must be in the timelock-gated poolKey allowlist (scam-pool rail)").
/// @notice Clean-room, house-shaped (WellstreetTimelock is the only admin caller).
///         The 48h-timelock Safe queues every add/remove/metadata update; execution is
///         permissionless after the delay (house trust model: a public detection window,
///         never represented as "no single key can act alone").
///
///         REGISTRY METADATA (deep-dive rank-8 viability pre-check, DEMOTED to
///         off-chain metadata by the ratified design — see the goal contract + the
///         SPEC amendment supersession record): min-book TVL floor and the arXiv
///         2608.30957 drain-shock viability pre-check ride as ADVISORY registry fields.
///         No on-chain enforcement reads them — the on-chain deterministic guardrails
///         (MIN_HOLD / MAX_MIGRATIONS_PER_PERIOD / MIN_EXPECTED_GAIN_BPS) live on the
///         harvester; the metadata is the off-chain policy layer's input surface.
contract RoamAllowlist {
    /// @dev The fork PoolManager a listed book's key must resolve on. Canonical v4
    ///      addresses on RH-4663 are scam drainers — every add is fail-closed on this
    ///      pin (house HarvesterV4 constructor pin, mirrored at the registry layer).
    address public constant FORK_POOL_MANAGER_4663 = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    /// @notice Advisory registry metadata (off-chain policy input — never enforced
    ///         on-chain; the demoted min-book TVL cap and the drain-shock pre-check).
    struct BookMeta {
        uint128 minTvlUsd1e6; // demoted rank-8 floor: advisory minimum book TVL (USD, 1e6 precision)
        bool drainShockChecked; // arXiv 2608.30957 one-sided 5/10/20x-Q shock pre-check performed off-chain
        uint64 addedAt;
    }

    /// @notice The 48h treasury timelock — the only address that may mutate the registry.
    address public immutable timelock;

    mapping(bytes32 => bool) public listed;
    mapping(bytes32 => BookMeta) public meta;
    bytes32[] public bookIds;

    event BookAdded(bytes32 indexed poolId, PoolKey key, BookMeta bookMeta);
    event BookRemoved(bytes32 indexed poolId);
    event BookMetaUpdated(bytes32 indexed poolId, BookMeta bookMeta);

    error ZeroAddress();
    error NotTimelock(address caller);
    error WrongPoolManager(address provided);
    error CurrenciesOutOfOrder(address currency0, address currency1);
    error BadTickSpacing(int24 tickSpacing);
    error AlreadyListed(bytes32 poolId);
    error NotListed(bytes32 poolId);

    /// @param timelock_ The 48h treasury timelock (WellstreetTimelock).
    constructor(address timelock_) {
        if (timelock_ == address(0)) revert ZeroAddress();
        timelock = timelock_;
    }

    modifier onlyTimelock() {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        _;
    }

    /// @dev The fork's PoolId derivation: keccak256(abi.encode(poolKey)) — verified
    ///      exact on the live books (HarvesterV4.poolId / GOAL §S0.2).
    function poolId(PoolKey calldata key) public pure returns (bytes32 id) {
        id = keccak256(abi.encode(key));
    }

    /// @notice Queue-through-timelock add of a book: key must be a well-formed fork
    ///         book (currency order, positive spacing, pinned PoolManager — hooks
    ///         address(0) and dynamic-fee flags are both valid, byte-matched as-is).
    function addBook(PoolKey calldata key, BookMeta calldata bookMeta) external onlyTimelock {
        if (key.currency0 >= key.currency1) revert CurrenciesOutOfOrder(key.currency0, key.currency1);
        if (key.tickSpacing <= 0) revert BadTickSpacing(key.tickSpacing);
        bytes32 id = poolId(key);
        if (listed[id]) revert AlreadyListed(id);
        listed[id] = true;
        meta[id] = bookMeta;
        bookIds.push(id);
        emit BookAdded(id, key, bookMeta);
    }

    /// @notice Queue-through-timelock removal. migrate() rails on toKey ONLY, so a
    ///         removed (dead/wound-down) book can always be migrated OUT of while any
    ///         live book remains; exitBook is the total-egress path when none does.
    function removeBook(bytes32 id) external onlyTimelock {
        if (!listed[id]) revert NotListed(id);
        listed[id] = false;
        emit BookRemoved(id);
    }

    /// @notice Queue-through-timelock metadata refresh (off-chain re-screen outputs:
    ///         fresh min-book TVL figure, drain-shock re-check flag — advisory only).
    function setBookMeta(bytes32 id, BookMeta calldata bookMeta) external onlyTimelock {
        if (!listed[id]) revert NotListed(id);
        meta[id] = bookMeta;
        emit BookMetaUpdated(id, bookMeta);
    }

    /// @notice The registry read migrate() rails against.
    function isListed(bytes32 id) external view returns (bool) {
        return listed[id];
    }

    /// @notice Enumerable listed-book count (off-chain fleet screens).
    function bookCount() external view returns (uint256) {
        return bookIds.length;
    }
}
