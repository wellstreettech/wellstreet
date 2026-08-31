// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Minimal Uniswap V3 NonfungiblePositionManager surface used by the harvester.
interface INonfungiblePositionManager {
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96 nonce,
            address operator,
            address token0,
            address token1,
            uint24 fee,
            int24 tickLower,
            int24 tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );

    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
}

/// @dev Uniswap V3 SwapRouter02 surface.
interface ISwapRouter02 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

/// @dev Uniswap V3 QuoterV2 surface.
interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (
            uint256 amountOut,
            uint160 sqrtPriceX96After,
            uint32 initializedTicksCrossed,
            uint256 gasEstimate
        );
}

/// @dev The YieldShares vault surface the harvester needs.
interface IYieldSharesVault {
    /// @notice Current protocol fee in bps (read live at every harvest — the timelock
    ///         may change it).
    function feeBps() external view returns (uint256);

    /// @notice Credit harvested yield to the vault (raises totalAssets, mints no
    ///         shares). Only callable by this harvester.
    function harvest(uint256 assets) external;
}

/// @title Harvester — owns the protocol LP position on the target stock/WETH pool and
///        converts accrued LP fees into vault yield.
/// @notice Mechanics (all permissionless unless stated):
///          - The LP position NFT is received via onERC721Received and is STRICTLY
///            validated: only a position on the configured (WETH, asset, poolFee)
///            pool is accepted — any other token pair or fee tier reverts (a wrong
///            tier would conflate accounting and route swaps through the wrong pool).
///            Only ONE position is held at a time.
///          - harvest() collects BOTH fee legs (WETH + asset) from the position, swaps
///            the collected WETH leg to the asset via SwapRouter02 using a
///            QuoterV2-derived minOut (fresh on-chain quote minus a fixed slippage
///            allowance), then splits the proceeds:
///              * vault share  = proceeds * (10000 - vault.feeBps()) / 10000
///                -> transferred to the vault, then credited via vault.harvest() —
///                totalAssets rises, NO shares are minted. The CREDITED amount is
///                the vault's actual balance delta (what physically arrived), not
///                the declared share: a fee-on-transfer upgrade or any transfer
///                loss can never diverge the accounting from the arrival (the
///                discrepancy is emitted in the Harvested event).
///              * protocol share = the remainder, minus the caller tip.
///              * caller tip = 0.1% of the total proceeds (TIP_BPS = 10), deducted
///                FROM the protocol share (the treasury net receives
///                protocolShare - tip); paid to msg.sender immediately.
///              * the rest accrues in this contract (protocolAccrued) until
///                sweepToTreasury() — permissionless — moves it to the treasury.
///          - ATOMICITY: a failed swap leg (stale quote, router failure) reverts the
///            WHOLE harvest — the collect is rolled back with it, so fees remain in
///            the LP position and are re-collectable by the next harvest with a fresh
///            quote. No harvest outcome can strand fees outside the position.
///          - FORCE-SENT TOKENS: any WETH/asset/junk balance held by this contract
///            beyond what the harvest flow itself produced is DONATED. Donations are
///            forwarded to the treasury UNSWAPPED, never dumped into the pool
///            (donated WETH at harvest time; donated asset + junk via sweepToTreasury
///            / forwardToken).
///          - The LP principal (the position's liquidity) is protocol-owned and is
///            EXCLUDED from vault accounting — only fee income flows in. The position
///            NFT can be moved ONLY by the treasury timelock (transferPosition); there
///            is no decreaseLiquidity path in this contract, so harvest() can never
///            touch the principal.
///        Trust model: single 48h timelock (see WellstreetTimelock) + one
///        function-limited pause authority on the vault; never represent this as
///        "no single key can act alone".
contract Harvester is IERC721Receiver, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant BPS = 10_000;
    /// @notice Caller tip: 0.1% of total harvest proceeds, deducted from the protocol
    ///         share (10 bps).
    uint256 public constant TIP_BPS = 10;
    /// @notice Slippage allowance applied to the QuoterV2 quote to derive minOut for
    ///         the swap leg (1%).
    uint256 public constant SWAP_SLIPPAGE_BPS = 100;

    /// @notice The vault whose totalAssets this harvester raises.
    address public immutable vault;
    /// @notice The 48h treasury timelock — the only address that can move the LP
    ///         position NFT (custody/removal control of the LP principal).
    address public immutable timelock;
    /// @notice Treasury custody address for accrued protocol fees and forwarded
    ///         donations (the timelock itself in the reference deployment).
    address public immutable treasury;
    /// @notice The vault asset (the tokenized stock token, e.g. SPY) — the yield
    ///         denomination; the non-asset fee leg is swapped INTO this.
    address public immutable asset;
    /// @notice The pool's other token (WETH on Robinhood Chain 4663).
    address public immutable weth;
    /// @notice The fee tier of the configured pool (SPY/WETH = 500).
    uint24 public immutable poolFee;
    /// @notice Uniswap V3 NonfungiblePositionManager.
    INonfungiblePositionManager public immutable positionManager;
    /// @notice Uniswap V3 SwapRouter02.
    ISwapRouter02 public immutable swapRouter;
    /// @notice Uniswap V3 QuoterV2 (minOut source).
    IQuoterV2 public immutable quoter;

    /// @notice The owned LP position (0 = none).
    uint256 public positionId;
    bool private _hasPosition;

    /// @notice Protocol fee share accrued in this contract awaiting sweepToTreasury().
    uint256 public protocolAccrued;

    event PositionReceived(address indexed npm, uint256 indexed tokenId, address indexed from);
    event PositionTransferred(address indexed to, uint256 indexed tokenId);
    event Harvested(
        uint256 indexed tokenId,
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

    error NotThePositionManager(address nftContract);
    error AlreadyHasPosition(uint256 currentTokenId);
    error NoPosition();
    error WrongPositionTokens(address token0, address token1);
    error WrongFeeTier(uint24 fee, uint24 expected);
    error ZeroAddress();
    error NotTimelock(address caller);
    error NotHarvestableToken(address token);
    error SwapBelowQuote();

    /// @param vault_      The YieldShares vault.
    /// @param timelock_   The 48h treasury timelock (position custody controller).
    /// @param treasury_   Recipient of accrued protocol fees and forwarded donations.
    /// @param asset_      The vault asset (yield denomination, e.g. SPY).
    /// @param weth_       The pool's other token.
    /// @param poolFee_    The configured pool's fee tier (SPY/WETH = 500).
    /// @param npm_        Uniswap V3 NonfungiblePositionManager.
    /// @param router_     Uniswap V3 SwapRouter02.
    /// @param quoter_     Uniswap V3 QuoterV2.
    constructor(
        address vault_,
        address timelock_,
        address treasury_,
        address asset_,
        address weth_,
        uint24 poolFee_,
        address npm_,
        address router_,
        address quoter_
    ) ReentrancyGuard() {
        if (
            vault_ == address(0) || timelock_ == address(0) || treasury_ == address(0)
                || asset_ == address(0) || weth_ == address(0) || npm_ == address(0)
                || router_ == address(0) || quoter_ == address(0)
        ) {
            revert ZeroAddress();
        }
        vault = vault_;
        timelock = timelock_;
        treasury = treasury_;
        asset = asset_;
        weth = weth_;
        poolFee = poolFee_;
        positionManager = INonfungiblePositionManager(npm_);
        swapRouter = ISwapRouter02(router_);
        quoter = IQuoterV2(quoter_);
    }

    // ------------------------------------------------------------------
    // LP position custody
    // ------------------------------------------------------------------

    /// @notice Accept the protocol LP position via safeTransferFrom. STRICT guard: the
    ///         NFT must come from the configured position manager and must be a
    ///         position on the configured (WETH, asset, poolFee) pool — a foreign NFT,
    ///         a wrong token pair, or a wrong fee tier reverts the transfer (the NFT
    ///         stays with its sender). Only ONE position is accepted.
    function onERC721Received(address, address from, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        if (msg.sender != address(positionManager)) revert NotThePositionManager(msg.sender);
        _validatePosition(tokenId); // pool identity first, so a wrong NFT reports its own error
        if (_hasPosition) revert AlreadyHasPosition(positionId);
        _hasPosition = true;
        positionId = tokenId;
        emit PositionReceived(msg.sender, tokenId, from);
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Move the LP position NFT out of the harvester. ONLY the treasury
    ///         timelock (via its 48h queue) — this is the single custody/removal
    ///         control over the protocol-owned LP principal. There is no
    ///         decreaseLiquidity path in this contract, so fee-harvest never touches
    ///         the principal.
    function transferPosition(address to, uint256 tokenId) external {
        if (msg.sender != timelock) revert NotTimelock(msg.sender);
        if (!_hasPosition || tokenId != positionId) revert NoPosition();
        if (to == address(0)) revert ZeroAddress();
        _hasPosition = false;
        positionId = 0;
        IERC721(address(positionManager)).safeTransferFrom(address(this), to, tokenId);
        emit PositionTransferred(to, tokenId);
    }

    // ------------------------------------------------------------------
    // Harvest
    // ------------------------------------------------------------------

    /// @notice Permissionless harvest: collect both fee legs from the owned position,
    ///         swap the WETH leg to the asset with a QuoterV2-derived minOut, split
    ///         proceeds between the vault (raises totalAssets, no shares minted) and
    ///         the protocol share (caller tip deducted), and forward donated WETH to
    ///         the treasury unswapped. A failing swap leg reverts the WHOLE harvest —
    ///         fees stay in the LP position, re-collectable later.
    function harvest() external nonReentrant {
        if (!_hasPosition) revert NoPosition();

        (address token0, address token1) = _positionTokens(positionId); // re-validates the pool identity
        (uint256 amount0, uint256 amount1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams(positionId, address(this), type(uint128).max, type(uint128).max)
        );

        uint256 wethCollected = token0 == weth ? amount0 : amount1;
        uint256 assetCollected = token0 == weth ? amount1 : amount0;

        // Swap ONLY the freshly collected WETH leg — never a balance-derived amount,
        // so force-sent/donated WETH is never dumped into the pool.
        uint256 swappedOut = 0;
        if (wethCollected > 0) {
            swappedOut = _swapWethToAsset(wethCollected);
        }

        uint256 proceeds = assetCollected + swappedOut;
        (uint256 vaultShare, uint256 vaultCredited, uint256 tip, uint256 accrued) =
            proceeds > 0 ? _split(proceeds) : (0, 0, 0, 0);

        // Force-sent/donated WETH (anything beyond the collected leg) goes to the
        // treasury UNSWAPPED, never dumped.
        _forwardDonations(weth, 0);

        emit Harvested(
            positionId, msg.sender, amount0, amount1, swappedOut, proceeds, vaultShare, vaultCredited, tip, accrued
        );
    }

    // ------------------------------------------------------------------
    // Sweep / forwarding
    // ------------------------------------------------------------------

    /// @notice Permissionless sweep: moves accrued protocol fees to the treasury and
    ///         forwards any force-sent/donated asset or WETH along with them,
    ///         UNSWAPPED (donations are never dumped into the pool).
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
    }

    /// @notice Permissionless forward of a force-sent token that is neither the asset
    ///         nor WETH (junk airdrops) to the treasury, unswapped.
    function forwardToken(address token) external nonReentrant {
        if (token == asset || token == weth) revert NotHarvestableToken(token);
        _forwardDonations(token, 0);
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    function _swapWethToAsset(uint256 amountIn) internal returns (uint256 amountOut) {
        // QuoterV2-derived minOut: fresh on-chain quote minus a fixed slippage
        // allowance. A stale quote or a router failure reverts the whole harvest.
        (uint256 quoted,,,) = quoter.quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: weth,
                tokenOut: asset,
                amountIn: amountIn,
                fee: poolFee,
                sqrtPriceLimitX96: 0
            })
        );
        if (quoted == 0) revert SwapBelowQuote();
        uint256 minOut = (quoted * (BPS - SWAP_SLIPPAGE_BPS)) / BPS;

        IERC20(weth).forceApprove(address(swapRouter), amountIn);
        amountOut = swapRouter.exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: weth,
                tokenOut: asset,
                fee: poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: minOut,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(weth).forceApprove(address(swapRouter), 0);
    }

    /// @dev Split proceeds: vault share raises totalAssets (no shares minted); the
    ///      protocol share accrues for the treasury, with the 0.1% caller tip deducted
    ///      FROM it (the tip is 0.1% of total proceeds, never more than the protocol
    ///      share). The vault is credited its ACTUAL balance delta (audit F-03b): the
    ///      split arithmetic still targets `vaultShare`, but what gets credited is
    ///      what physically arrived — a fee-on-transfer surprise or any transfer loss
    ///      can never create an accounting divergence between what arrived and what
    ///      was credited (crediting the declared amount would instead revert the whole
    ///      harvest at the vault's excess bound and freeze yield accrual). Any
    ///      discrepancy is emitted in the Harvested event (vaultShare vs
    ///      vaultCredited).
    function _split(uint256 proceeds)
        internal
        returns (uint256 vaultShare, uint256 vaultCredited, uint256 tip, uint256 accrued)
    {
        uint256 fee = IYieldSharesVault(vault).feeBps();
        vaultShare = (proceeds * (BPS - fee)) / BPS;
        uint256 protocolShare = proceeds - vaultShare;
        tip = (proceeds * TIP_BPS) / BPS;
        if (tip > protocolShare) tip = protocolShare; // feeBps < TIP_BPS would underflow the treasury share
        accrued = protocolShare - tip;

        if (vaultShare > 0) {
            uint256 vaultBalanceBefore = IERC20(asset).balanceOf(vault);
            IERC20(asset).safeTransfer(vault, vaultShare);
            vaultCredited = IERC20(asset).balanceOf(vault) - vaultBalanceBefore;
            IYieldSharesVault(vault).harvest(vaultCredited);
        }
        if (tip > 0) {
            IERC20(asset).safeTransfer(msg.sender, tip);
        }
        protocolAccrued += accrued;
    }

    /// @dev Validate the position is OUR (weth, asset, poolFee) position — not a
    ///      foreign NFT, wrong token pair, or a different fee tier (a cross-tier
    ///      collection would conflate accounting and route the swap through the wrong
    ///      pool).
    function _validatePosition(uint256 tokenId) internal view {
        _positionTokens(tokenId);
    }

    function _positionTokens(uint256 tokenId) internal view returns (address token0, address token1) {
        uint24 feeTier;
        (, , token0, token1, feeTier, , , , , , , ) = positionManager.positions(tokenId);
        bool matches = (token0 == asset && token1 == weth) || (token0 == weth && token1 == asset);
        if (!matches) revert WrongPositionTokens(token0, token1);
        if (feeTier != poolFee) revert WrongFeeTier(feeTier, poolFee);
    }

    /// @dev Forward the DONATED portion of `token`'s balance (balance above
    ///      `accounted`) to the treasury, unswapped.
    function _forwardDonations(address token, uint256 accounted) internal {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > accounted) {
            uint256 donation = balance - accounted;
            IERC20(token).safeTransfer(treasury, donation);
            emit Forwarded(token, donation, treasury);
        }
    }
}
