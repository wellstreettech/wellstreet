// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal RH-4663 v4-fork PoolManager surface used by the harvester. Shapes are
///      pinned from the fork's VERIFIED source (Blockscout 45-file bundle; GOAL doc
///      §STEP-0) — this is a custom fork: the Swap event carries a trailing per-swap
///      uint24 fee, hook permission bits are remapped, and BalanceDelta packs amount0
///      in the HIGH 128 bits (amount1 LOW) — the reverse of canonical v4-core.
///      Currency / IHooks are plain `address` at the ABI level.
interface IPoolManagerV4 {
    struct PoolKey {
        address currency0;
        address currency1;
        uint24 fee;
        int24 tickSpacing;
        address hooks;
    }

    struct ModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        bytes32 salt;
    }

    function unlock(bytes calldata data) external returns (bytes memory);

    function modifyLiquidity(PoolKey calldata key, ModifyLiquidityParams calldata params, bytes calldata hookData)
        external
        returns (int256 callerDelta, int256 feesAccrued);

    function take(address currency, address to, uint256 amount) external;

    function sync(address currency) external;

    function settle() external payable returns (uint256);
}

/// @dev Uniswap V3 SwapRouter02 surface (4663 deploy: no-deadline structs, ABI-verified).
interface ISwapRouter02V4 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

/// @dev Uniswap V3 QuoterV2 surface (minOut source for the swap leg).
interface IQuoterV2Path {
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        returns (
            uint256 amountOut,
            uint160[] memory sqrtPriceX96AfterList,
            uint32[] memory initializedTicksCrossedList,
            uint256 gasEstimate
        );
}

/// @dev WETH9 (native-ETH wrapping for pools whose quote leg is the native currency).
interface IWETH9 {
    function deposit() external payable;
}

/// @dev The YieldShares vault surface the harvester needs (v3 shape).
interface IYieldSharesVaultV4 {
    /// @notice Current protocol fee in bps (read live at every harvest).
    function feeBps() external view returns (uint256);

    /// @notice Credit harvested yield to the vault (raises totalAssets, mints no
    ///         shares). Harvester-gated: only this contract can call it.
    function harvest(uint256 assets) external;
}

/// @title HarvesterV4 — holds the protocol LP position DIRECTLY on the RH-4663 v4-fork
///        PoolManager and converts accrued LP fees into vault yield.
/// @notice v4 sibling of Harvester (v3): same trust model, same fail-closed rails, one
///         harvester per vault — but no NPM NFT exists for the target books (all live
///         NFTs sit on 1% hookless pools, GOAL §S0/04 §5.2), so the position is held
///         direct-to-PoolManager:
///          - OPEN: timelock-only openPosition(liquidity) mints a FULL-RANGE position on
///            the configured poolKey via modifyLiquidity inside unlockCallback; the
///            required principal (whatever the pool's own math says) is paid from THIS
///            contract's balances via sync→transfer→settle (native: settle{value}) —
///            underfunding reverts the whole open atomically. The principal is
///            protocol-owned and EXCLUDED from vault accounting.
///          - HARVEST: permissionless (caller-tip model, like v3). A zero-delta
///            modifyLiquidity returns the position's accrued fee legs (the pool's
///            feeGrowth accounting is the single source of truth — this contract never
///            computes fees from any static rate; the fork charges per-swap fees that
///            deviate from every label, GOAL §S0.4). Fees are taken out via take(),
///            the non-asset leg is swapped to the asset via SwapRouter02 with a
///            QuoterV2-derived minOut (fresh on-chain quote − SWAP_SLIPPAGE_BPS; the
///            quote and the swap run atomically in one harvest so a stale quote
///            reverts the WHOLE harvest), and the proceeds split:
///              * vault share  = proceeds * (10000 − vault.feeBps()) / 10000 →
///                transferred to the vault and credited via vault.harvest() with the
///                vault's ACTUAL balance delta (v3 audit F-03b pattern).
///              * protocol share = the remainder, minus the 0.1% caller tip
///                (TIP_BPS = 10, deducted FROM the protocol share), accruing in
///                protocolAccrued until sweepToTreasury().
///          - CLOSE: timelock-only closePosition(to) removes the full position and
///            takes both legs to `to` — the single custody/removal control over the
///            principal (v3 transferPosition analog; there is no partial-decrease path,
///            so harvest can never touch principal).
///          - NATIVE-ETH BOOKS: a pool whose currency0 is the native currency pays its
///            fees in native ETH; harvest wraps the collected leg to WETH (exactly the
///            collected amount — never a balance-derived amount) before the swap.
///          - FORCE-SENT TOKENS: anything beyond what the harvest flow itself produced
///            is DONATED — forwarded to the treasury UNSWAPPED (sweepToTreasury /
///            forwardToken / native sweep), never dumped into the pool.
///          - CALLBACK SAFETY: unlockCallback only executes while THIS contract has an
///            in-flight unlock (msg.sender == poolManager && action flag set), so a
///            third party cannot steer PoolManager.unlock against it. All state-changing
///            flows are nonReentrant.
///        Fee-economics honesty (GOAL deliverable 4): the fork's charged fee is a
///        per-swap stream (e.g. SPY/USDG charges 3499 on every observed swap vs a 3000
///        init label; USDG/ETH re-prices dynamically by hook) — yield models MUST
///        replay the emitted Swap stream (topic0 0x40e9cecb…112f, data word[5]); any
///        static-rate claim about these books is wrong by construction. Merkl
///        incentives are an agent-layer leg, never in-contract.
///        Trust model: single 48h timelock (WellstreetTimelock) + one function-limited
///        pause authority on the vault; never represent this as "no single key can act
///        alone".
contract HarvesterV4 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev The ONLY PoolManager this contract may ever be deployed against: the
    ///      RH-4663 v4 FORK PoolManager. Canonical Uniswap v4 addresses on 4663 are
    ///      scam drainers — the constructor enforces this pin (fail-closed).
    address public constant FORK_POOL_MANAGER_4663 = 0x8366a39CC670B4001A1121B8F6A443A643e40951;

    /// @dev v4 TickMath bounds (fork source) for full-range tick derivation.
    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    uint256 public constant BPS = 10_000;
    /// @notice Caller tip: 0.1% of total harvest proceeds, deducted from the protocol
    ///         share (10 bps) — v3 shape.
    uint256 public constant TIP_BPS = 10;
    /// @notice Slippage allowance applied to the QuoterV2 quote to derive minOut for the
    ///         swap leg (1%) — v3 shape.
    uint256 public constant SWAP_SLIPPAGE_BPS = 100;

    uint8 internal constant ACTION_NONE = 0;
    uint8 internal constant ACTION_OPEN = 1;
    uint8 internal constant ACTION_COLLECT = 2;
    uint8 internal constant ACTION_CLOSE = 3;

    /// @notice The vault whose totalAssets this harvester raises.
    address public immutable vault;
    /// @notice The 48h treasury timelock — the only address that can open/move/close
    ///         the LP position (custody control of the protocol-owned principal).
    address public immutable timelock;
    /// @notice Treasury custody address for accrued protocol fees and forwarded
    ///         donations.
    address public immutable treasury;
    /// @notice The vault asset (yield denomination, e.g. SPY) — one of the pool's two
    ///         currencies; the non-asset fee leg is swapped INTO this.
    address public immutable asset;
    /// @notice The fork PoolManager (constructor-enforced == FORK_POOL_MANAGER_4663).
    address public immutable poolManager;
    /// @notice The configured poolKey (currency0 < currency1, matching the live book).
    address public immutable currency0;
    address public immutable currency1;
    uint24 public immutable fee;
    int24 public immutable tickSpacing;
    address public immutable hooks;
    /// @notice WETH9 — used ONLY to wrap a native-ETH fee leg before the swap.
    address public immutable weth;
    /// @notice SwapRouter02 (v3) executing the quote→asset conversion leg.
    address public immutable swapRouter;
    /// @notice QuoterV2 (v3) — minOut source for the swap leg.
    address public immutable quoter;
    /// @notice The v3 swap path converting the quote leg into the asset (starts at the
    ///         quote token, or WETH when the quote leg is the native currency; ends at
    ///         `asset`). Written once at construction (bytes cannot be immutable).
    bytes public swapPath;

    /// @notice Whether the protocol position is open.
    bool public hasPosition;
    /// @notice Liquidity of the open position (full-range bounds, salt 0).
    uint128 public positionLiquidity;
    /// @notice Protocol fee share accrued in this contract awaiting sweepToTreasury().
    uint256 public protocolAccrued;

    uint8 internal _activeAction;
    /// @dev The liquidity for the IN-FLIGHT unlock action — set by openPosition /
    ///      closePosition before the unlock, consumed by the callback, cleared after.
    uint128 internal positionLiquidityToBe;

    event PositionOpened(uint128 liquidity, int24 tickLower, int24 tickUpper);
    event PositionClosed(address indexed to, uint128 liquidity);
    event Harvested(
        address indexed caller,
        uint256 amount0Collected,
        uint256 amount1Collected,
        uint256 swappedOut,
        uint256 proceeds,
        uint256 vaultShare,
        uint256 vaultCredited,
        uint256 tip,
        uint256 accrued
    );
    event Swept(address indexed token, uint256 amount, address indexed to);
    event Forwarded(address indexed token, uint256 amount, address indexed to);

    error ZeroAddress();
    error WrongPoolManager(address provided);
    error CurrenciesOutOfOrder(address currency0, address currency1);
    error WrongPoolTokens(address asset);
    error NativeAsset();
    error BadTickSpacing(int24 tickSpacing);
    error NotTimelock(address caller);
    error NoPosition();
    error AlreadyHasPosition();
    error ZeroLiquidity();
    error CallbackNotActive(address caller, uint8 action);
    error SwapBelowQuote();
    error NativeForwardFailed();
    error InsufficientNativeBalance(uint256 required, uint256 available);
    error WethAssetNativeQuote();
    error BadSwapPath(address firstToken, address expectedStart, address lastToken, address asset);

    /// @param vault_         The YieldShares vault.
    /// @param timelock_      The 48h treasury timelock (position custody controller).
    /// @param treasury_      Recipient of accrued protocol fees and forwarded donations.
    /// @param asset_         The vault asset (yield denomination, e.g. SPY) — must be
    ///                       one of the pool's two currencies and an ERC-20 (never the
    ///                       native currency).
    /// @param poolManager_   The fork PoolManager — MUST be FORK_POOL_MANAGER_4663.
    /// @param poolKey_       The configured v4 PoolKey — currency0 (native ETH =
    ///                       address(0)) MUST be < currency1; fee (dynamic-fee books
    ///                       carry the 0x800000 flag — stored as-is, it must byte-match
    ///                       the live book's key); tickSpacing > 0; hooks = address(0)
    ///                       for hookless books (valid). Passed as ONE struct both for
    ///                       v4 shape and to keep the constructor's stack frame within
    ///                       the legacy codegen budget.
    /// @param weth_          WETH9 (wraps a native-ETH fee leg before the swap).
    /// @param swapPath_      v3 swap path quote-leg→asset: starts at the quote token
    ///                       (or WETH_ when the quote leg is the native currency) and
    ///                       ends at asset_. Each intermediate hop is 20-byte token +
    ///                       3-byte fee.
    /// @param router_        Uniswap V3 SwapRouter02.
    /// @param quoter_        Uniswap V3 QuoterV2.
    constructor(
        address vault_,
        address timelock_,
        address treasury_,
        address asset_,
        address poolManager_,
        IPoolManagerV4.PoolKey memory poolKey_,
        address weth_,
        bytes memory swapPath_,
        address router_,
        address quoter_
    ) ReentrancyGuard() {
        if (
            vault_ == address(0) || timelock_ == address(0) || treasury_ == address(0) || asset_ == address(0)
                || poolManager_ == address(0) || weth_ == address(0) || router_ == address(0) || quoter_ == address(0)
        ) {
            revert ZeroAddress();
        }
        if (poolManager_ != FORK_POOL_MANAGER_4663) revert WrongPoolManager(poolManager_);
        if (!(poolKey_.currency0 < poolKey_.currency1)) {
            revert CurrenciesOutOfOrder(poolKey_.currency0, poolKey_.currency1);
        }
        if (poolKey_.tickSpacing <= 0) revert BadTickSpacing(poolKey_.tickSpacing);
        if (asset_ != poolKey_.currency0 && asset_ != poolKey_.currency1) revert WrongPoolTokens(asset_);
        if (asset_ == address(0)) revert NativeAsset();
        // A native-ETH-quote book wraps its collected fee leg to WETH before the swap;
        // an asset==WETH config would collide the wrapped leg with the asset
        // accounting (fail-closed at construction).
        if (asset_ == weth_ && poolKey_.currency0 == address(0)) revert WethAssetNativeQuote();

        vault = vault_;
        timelock = timelock_;
        treasury = treasury_;
        asset = asset_;
        poolManager = poolManager_;
        currency0 = poolKey_.currency0;
        currency1 = poolKey_.currency1;
        fee = poolKey_.fee;
        tickSpacing = poolKey_.tickSpacing;
        hooks = poolKey_.hooks;
        weth = weth_;
        swapRouter = router_;
        quoter = quoter_;

        _setSwapPath(swapPath_);
    }

    /// @dev Stores + validates the swap path. Kept out of the constructor's frame:
    ///      the bytes storage copy (memcpy temporaries) plus validation overflow the
    ///      14-parameter constructor stack otherwise.
    function _setSwapPath(bytes memory path_) internal {
        swapPath = path_;
        // The path must START at the ERC-20 the swap leg actually spends: the quote
        // token itself, or WETH when the quote leg is the native currency.
        _validateSwapPath(path_, _quoteTokenOrWeth());
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    /// @notice The pool's other currency (the leg swapped into the asset at harvest).
    function quote() external view returns (address) {
        return _quote();
    }

    /// @notice Full-range tick bounds for the configured tickSpacing (v4 TickMath:
    ///         MIN_TICK −887272 / MAX_TICK 887272, spacing-aligned).
    function fullRangeTicks() external view returns (int24 tickLower, int24 tickUpper) {
        return _fullRangeTicks();
    }

    /// @notice The configured pool's id — keccak256(abi.encode(poolKey)), verified to
    ///         match the fork's PoolId derivation (GOAL §S0.2).
    function poolId() external view returns (bytes32 id) {
        return _poolId();
    }

    // ------------------------------------------------------------------
    // LP position custody (timelock-only)
    // ------------------------------------------------------------------

    /// @notice Open the protocol's FULL-RANGE position with `liquidity` on the
    ///         configured poolKey. ONLY the treasury timelock (via its 48h queue). The
    ///         principal tokens must already sit in this contract — the pool's own math
    ///         dictates the required amounts (returned as negative deltas) and they are
    ///         paid here via sync→transfer→settle (native: settle{value}); any
    ///         underfunding reverts the whole open atomically. Only ONE position.
    function openPosition(uint128 liquidity) external nonReentrant {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        if (liquidity == 0) revert ZeroLiquidity();
        if (hasPosition) revert AlreadyHasPosition();

        positionLiquidityToBe = liquidity;
        _activeAction = ACTION_OPEN;
        // The callback for OPEN returns "" — the return value is ignored (it is this
        // contract's own encoding, delivered through the pinned PoolManager).
        IPoolManagerV4(poolManager).unlock("");
        _activeAction = ACTION_NONE;
        positionLiquidityToBe = 0;

        hasPosition = true;
        positionLiquidity = liquidity;
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks();
        emit PositionOpened(liquidity, tickLower, tickUpper);
    }

    /// @notice Remove the FULL position and take both legs (principal + any final
    ///         accrued fees) to `to`. ONLY the treasury timelock (via its 48h queue) —
    ///         the single custody/removal control over the LP principal (v3
    ///         transferPosition analog).
    function closePosition(address to) external nonReentrant {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        if (!hasPosition) revert NoPosition();
        if (to == address(0)) revert ZeroAddress();

        uint128 liquidity = positionLiquidity;
        hasPosition = false;
        positionLiquidity = 0;

        positionLiquidityToBe = liquidity;
        _activeAction = ACTION_CLOSE;
        IPoolManagerV4(poolManager).unlock(abi.encode(to));
        _activeAction = ACTION_NONE;
        positionLiquidityToBe = 0;

        emit PositionClosed(to, liquidity);
    }

    // ------------------------------------------------------------------
    // Harvest
    // ------------------------------------------------------------------

    /// @notice Permissionless harvest (caller-tip model, like v3): zero-delta collect of
    ///         BOTH fee legs from the protocol position, swap the non-asset leg to the
    ///         asset with a QuoterV2-derived minOut, split proceeds between the vault
    ///         (raises totalAssets, no shares minted) and the protocol share (caller tip
    ///         deducted), and forward donated quote/WETH/native tokens to the treasury
    ///         UNSWAPPED. A failing swap leg reverts the WHOLE harvest — fees stay in
    ///         the LP position, re-collectable later.
    function harvest() external nonReentrant {
        if (!hasPosition) revert NoPosition();

        _activeAction = ACTION_COLLECT;
        (uint256 collected0, uint256 collected1) =
            abi.decode(IPoolManagerV4(poolManager).unlock(""), (uint256, uint256));
        _activeAction = ACTION_NONE;

        _finishHarvest(collected0, collected1);
    }

    /// @dev The post-collect harvest flow, split out to keep harvest()'s frame shallow
    ///      (the dynamic unlock() return copy is stack-hungry).
    function _finishHarvest(uint256 collected0, uint256 collected1) internal {
        (uint256 assetCollected, uint256 quoteCollected) =
            asset == currency0 ? (collected0, collected1) : (collected1, collected0);

        // Swap ONLY the freshly collected quote leg — never a balance-derived amount,
        // so force-sent/donated quote tokens are never dumped into the pool.
        uint256 swappedOut = 0;
        if (quoteCollected > 0) {
            swappedOut = _swapQuoteToAsset(quoteCollected);
        }

        uint256 proceeds = assetCollected + swappedOut;
        (uint256 vaultShare, uint256 vaultCredited, uint256 tip, uint256 accrued) =
            proceeds > 0 ? _split(proceeds) : (0, 0, 0, 0);

        // Force-sent/donated quote tokens (anything beyond the collected leg, which the
        // swap consumed in full) go to the treasury UNSWAPPED, never dumped.
        _forwardDonations(_quoteTokenOrWeth(), 0);
        // Donated native ETH (beyond the wrapped leg, which the wrap consumed in full).
        _forwardNativeDonations();

        emit Harvested(
            msg.sender, collected0, collected1, swappedOut, proceeds, vaultShare, vaultCredited, tip, accrued
        );
    }

    /// @notice PoolManager callback — executes the LP action while this contract is
    ///         inside its own unlock. Guarded fail-closed: only the pinned PoolManager,
    ///         only during an in-flight action of THIS contract (a third party cannot
    ///         steer PoolManager.unlock against this contract).
    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != poolManager || _activeAction == ACTION_NONE) {
            revert CallbackNotActive(msg.sender, _activeAction);
        }

        uint8 action = _activeAction;
        if (action == ACTION_OPEN) {
            _openCallback();
            return "";
        }
        if (action == ACTION_CLOSE) {
            _closeCallback(abi.decode(data, (address)));
            return "";
        }
        if (action == ACTION_COLLECT) {
            return _collectCallback();
        }
        revert CallbackNotActive(msg.sender, action);
    }

    // ------------------------------------------------------------------
    // Sweep / forwarding
    // ------------------------------------------------------------------

    /// @notice Permissionless sweep: moves accrued protocol fees to the treasury and
    ///         forwards any force-sent/donated asset, quote-token, WETH or native ETH
    ///         along with them, UNSWAPPED (donations are never dumped into the pool).
    function sweepToTreasury() external nonReentrant {
        uint256 accrued = protocolAccrued;
        if (accrued > 0) {
            protocolAccrued = 0;
            IERC20(asset).safeTransfer(treasury, accrued);
            emit Swept(asset, accrued, treasury);
        }
        // Donated asset: balance above the accounted accrual.
        _forwardDonations(asset, protocolAccrued);
        // Donated WETH: none of it is ever accounted here.
        _forwardDonations(weth, 0);
        // Donated quote token (when it is an ERC-20 distinct from asset/WETH).
        address q = _quote();
        if (q != address(0) && q != asset && q != weth) {
            _forwardDonations(q, 0);
        }
        // Donated native ETH.
        _forwardNativeDonations();
    }

    /// @notice Permissionless forward of a force-sent token that is neither the asset,
    ///         WETH nor the quote token (junk airdrops) to the treasury, unswapped.
    function forwardToken(address token) external nonReentrant {
        if (token == asset || token == weth || token == _quote()) {
            revert BadSwapPath(token, _quoteTokenOrWeth(), token, asset);
        }
        _forwardDonations(token, 0);
    }

    /// @notice Accept native ETH: taken native-ETH fee legs and force-sent donations.
    ///         Anything unaccounted is forwarded by the harvest/sweep flows.
    receive() external payable {}

    // ------------------------------------------------------------------
    // Internals — LP actions inside the unlock
    // ------------------------------------------------------------------

    /// @dev The ONE modifyLiquidity call shape (full-range bounds, salt 0) shared by
    ///      all three LP actions. Kept in a dedicated frame: the PoolKey +
    ///      ModifyLiquidityParams encoding overflows the callback frames otherwise
    ///      (legacy codegen stack limit).
    function _modifyLiquidity(int256 liquidityDelta) internal returns (int256 callerDelta) {
        (int24 tickLower, int24 tickUpper) = _fullRangeTicks();
        (callerDelta, ) = IPoolManagerV4(poolManager).modifyLiquidity(
            _poolKey(),
            IPoolManagerV4.ModifyLiquidityParams({
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: liquidityDelta,
                salt: bytes32(0)
            }),
            ""
        );
    }

    /// @dev Mints the full-range position; pays the pool's required principal from THIS
    ///      contract's balances.
    function _openCallback() internal {
        // The fork returns the PACKED caller delta (amount0 HIGH, amount1 LOW — fork
        // packing, GOAL §STEP-0); it already includes feesAccrued. For a fresh
        // position the delta is the negative principal this contract owes.
        (int128 d0, int128 d1) = _decodeDeltas(_modifyLiquidity(int256(uint256(positionLiquidityToBe))));
        _settleDeltas(d0, d1);
    }

    /// @dev Zero-delta modifyLiquidity → the position's accrued fees; take()s them out.
    function _collectCallback() internal returns (bytes memory) {
        // Zero-delta call ⇒ callerDelta IS the accrued-fee pair (GOAL §STEP-0).
        (int128 d0, int128 d1) = _decodeDeltas(_modifyLiquidity(0));
        (uint256 collected0, uint256 collected1) = _settleDeltas(d0, d1);
        return abi.encode(collected0, collected1);
    }

    /// @dev Removes the full position; takes every leg to `to`.
    function _closeCallback(address to) internal {
        (int128 d0, int128 d1) = _decodeDeltas(_modifyLiquidity(-int256(uint256(positionLiquidityToBe))));
        _takeDeltas(to, d0, d1);
    }

    /// @dev Settles NEGATIVE deltas (amounts this contract owes the pool) from its own
    ///      balances: ERC-20 via sync→transfer→settle, native via settle{value}. Any
    ///      positive remainder (unexpected accrual on re-open) is taken to this
    ///      contract. Returns the taken (positive) amounts per currency.
    function _settleDeltas(int128 d0, int128 d1) internal returns (uint256 taken0, uint256 taken1) {
        if (d0 < 0) {
            _pay(currency0, uint128(-d0));
        } else if (d0 > 0) {
            IPoolManagerV4(poolManager).take(currency0, address(this), uint256(uint128(d0)));
            taken0 = uint256(uint128(d0));
        }
        if (d1 < 0) {
            _pay(currency1, uint128(-d1));
        } else if (d1 > 0) {
            IPoolManagerV4(poolManager).take(currency1, address(this), uint256(uint128(d1)));
            taken1 = uint256(uint128(d1));
        }
    }

    /// @dev Pays `amount` of `currency` to the pool from this contract's balance.
    function _pay(address currency, uint128 amount) internal {
        if (currency == address(0)) {
            if (address(this).balance < amount) revert InsufficientNativeBalance(amount, address(this).balance);
            IPoolManagerV4(poolManager).settle{value: amount}();
        } else {
            IPoolManagerV4(poolManager).sync(currency);
            IERC20(currency).safeTransfer(poolManager, amount);
            IPoolManagerV4(poolManager).settle();
        }
    }

    /// @dev Takes positive deltas out to `to` (close path: principal + final fees).
    function _takeDeltas(address to, int128 d0, int128 d1) internal returns (uint256 taken0, uint256 taken1) {
        if (d0 > 0) {
            taken0 = uint256(uint128(d0));
            IPoolManagerV4(poolManager).take(currency0, to, taken0);
        }
        if (d1 > 0) {
            taken1 = uint256(uint128(d1));
            IPoolManagerV4(poolManager).take(currency1, to, taken1);
        }
    }

    /// @dev Decodes the fork's PACKED BalanceDelta word. FORK PIN (GOAL §STEP-0,
    ///      verified in the fork's BalanceDeltaLibrary assembly): amount0 = HIGH 128
    ///      bits, amount1 = LOW 128 bits — the REVERSE of canonical v4-core; decoding
    ///      canonically would sign-flip the legs (money-critical). The source of the
    ///      word is the modifyLiquidity RETURN VALUE, whose semantics the fork keeps
    ///      canonical: callerDelta = principalDelta + feesAccrued (GOAL §STEP-0) and
    ///      it is the exact pair the PoolManager accounts against this caller.
    ///      (Draft note: an earlier banked draft masked the low word's sign bit,
    ///      which corrupts negative legs — a plain 128-bit reinterpret is correct.)
    function _decodeDeltas(int256 delta) internal pure returns (int128 d0, int128 d1) {
        d0 = int128(delta >> 128);
        d1 = int128(uint128(uint256(delta)));
    }

    // ------------------------------------------------------------------
    // Internals — configuration helpers
    // ------------------------------------------------------------------

    /// @dev The configured poolKey (constructor-frozen fields).
    function _poolKey() internal view returns (IPoolManagerV4.PoolKey memory key) {
        key = IPoolManagerV4.PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: fee,
            tickSpacing: tickSpacing,
            hooks: hooks
        });
    }

    /// @dev The configured pool's id — keccak256(abi.encode(poolKey)), the fork's
    ///      PoolId derivation (GOAL §S0.2, verified exact on all three live books).
    function _poolId() internal view returns (bytes32 id) {
        id = keccak256(abi.encode(_poolKey()));
    }

    /// @dev Full-range tick bounds for the configured spacing: v4 TickMath bounds
    ///      MIN_TICK −887272 / MAX_TICK 887272 aligned to spacing multiples
    ///      (Solidity int division truncates toward zero: ts 60 ⇒ [−887220, 887220],
    ///      ts 200 ⇒ [−887200, 887200], ts 10 ⇒ [−887270, 887270]; GOAL §S0.1).
    function _fullRangeTicks() internal view returns (int24 tickLower, int24 tickUpper) {
        tickLower = (MIN_TICK / tickSpacing) * tickSpacing;
        tickUpper = (MAX_TICK / tickSpacing) * tickSpacing;
    }

    /// @dev The pool's non-asset currency — the leg swapped INTO the asset at harvest.
    function _quote() internal view returns (address) {
        return asset == currency0 ? currency1 : currency0;
    }

    /// @dev The ERC-20 the swap leg starts from: the quote token itself, or WETH when
    ///      the quote leg is the native currency (wrapped at exactly the collected
    ///      amount before the swap — never a balance-derived amount).
    function _quoteTokenOrWeth() internal view returns (address) {
        address q = _quote();
        return q == address(0) ? weth : q;
    }

    // ------------------------------------------------------------------
    // Internals — swap leg
    // ------------------------------------------------------------------

    /// @dev Swaps `amountIn` of the quote leg to the asset through the configured v3
    ///      path, with a QuoterV2-derived minOut (fresh on-chain quote −
    ///      SWAP_SLIPPAGE_BPS). The quote and the swap run in the SAME harvest, so a
    ///      stale quote reverts the WHOLE harvest atomically (fail-closed, v3 shape).
    ///      For a native-ETH quote leg, wraps EXACTLY `amountIn` (the freshly
    ///      collected amount) to WETH first — force-sent native ETH is never dumped.
    function _swapQuoteToAsset(uint256 amountIn) internal returns (uint256 amountOut) {
        address tokenIn = _quoteTokenOrWeth();
        if (_quote() == address(0)) {
            IWETH9(weth).deposit{value: amountIn}();
        }
        (uint256 quoted,,,) = IQuoterV2Path(quoter).quoteExactInput(swapPath, amountIn);
        if (quoted == 0) revert SwapBelowQuote();
        uint256 minOut = (quoted * (BPS - SWAP_SLIPPAGE_BPS)) / BPS;

        IERC20(tokenIn).forceApprove(swapRouter, amountIn);
        amountOut = ISwapRouter02V4(swapRouter).exactInput(
            ISwapRouter02V4.ExactInputParams({
                path: swapPath,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut
            })
        );
        IERC20(tokenIn).forceApprove(swapRouter, 0);
    }

    // ------------------------------------------------------------------
    // Internals — split / forwarding
    // ------------------------------------------------------------------

    /// @dev Split proceeds: vault share raises totalAssets (no shares minted); the
    ///      protocol share accrues for the treasury, with the 0.1% caller tip deducted
    ///      FROM it (the tip is 0.1% of total proceeds, never more than the protocol
    ///      share). The vault is credited its ACTUAL balance delta (v3 audit F-03b):
    ///      a fee-on-transfer surprise or any transfer loss can never create an
    ///      accounting divergence between what arrived and what was credited. Any
    ///      discrepancy is emitted in the Harvested event (vaultShare vs
    ///      vaultCredited).
    function _split(uint256 proceeds)
        internal
        returns (uint256 vaultShare, uint256 vaultCredited, uint256 tip, uint256 accrued)
    {
        uint256 feeBps = IYieldSharesVaultV4(vault).feeBps();
        vaultShare = (proceeds * (BPS - feeBps)) / BPS;
        uint256 protocolShare = proceeds - vaultShare;
        tip = (proceeds * TIP_BPS) / BPS;
        if (tip > protocolShare) tip = protocolShare; // feeBps < TIP_BPS would underflow the treasury share
        accrued = protocolShare - tip;

        if (vaultShare > 0) {
            uint256 vaultBalanceBefore = IERC20(asset).balanceOf(vault);
            IERC20(asset).safeTransfer(vault, vaultShare);
            vaultCredited = IERC20(asset).balanceOf(vault) - vaultBalanceBefore;
            IYieldSharesVaultV4(vault).harvest(vaultCredited);
        }
        if (tip > 0) {
            IERC20(asset).safeTransfer(msg.sender, tip);
        }
        protocolAccrued += accrued;
    }

    /// @dev Forward the DONATED portion of `token`'s balance (balance above
    ///      `accounted`) to the treasury, UNSWAPPED — donations are never dumped into
    ///      the pool (force-sent-token pattern, v3 shape).
    function _forwardDonations(address token, uint256 accounted) internal {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > accounted) {
            uint256 donation = balance - accounted;
            IERC20(token).safeTransfer(treasury, donation);
            emit Forwarded(token, donation, treasury);
        }
    }

    /// @dev Forward unaccounted native ETH (force-sent donations, open overfunding) to
    ///      the treasury. The reference treasury is the treasury timelock, which
    ///      accepts native ETH (WellstreetTimelock.receive()).
    function _forwardNativeDonations() internal {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool ok,) = treasury.call{value: balance}("");
            if (!ok) revert NativeForwardFailed();
            emit Forwarded(address(0), balance, treasury);
        }
    }

    /// @dev Validate the swap path's shape and endpoints: 20-byte tokens separated by
    ///      3-byte pool fees, starting at `expectedStart` (the quote token, or WETH
    ///      for a native-ETH quote leg) and ending at `asset` (v3 exactInput path
    ///      encoding).
    function _validateSwapPath(bytes memory path, address expectedStart) internal view {
        uint256 len = path.length;
        if (len < 43 || (len - 20) % 23 != 0) {
            revert BadSwapPath(address(0), expectedStart, address(0), asset);
        }
        uint256 firstW;
        uint256 lastW;
        for (uint256 i = 0; i < 20; i++) {
            firstW = (firstW << 8) | uint256(uint8(path[i]));
            lastW = (lastW << 8) | uint256(uint8(path[len - 20 + i]));
        }
        address first = address(uint160(firstW));
        address last = address(uint160(lastW));
        if (first != expectedStart) revert BadSwapPath(first, expectedStart, last, asset);
        if (last != asset) revert BadSwapPath(first, expectedStart, last, asset);
    }
}
