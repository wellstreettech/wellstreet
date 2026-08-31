// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {INonfungiblePositionManager} from "../../src/Harvester.sol";

/// @notice Mock Uniswap V3 NonfungiblePositionManager: mints positions with
///         configurable token pairs/fee tiers, seeds owed fees, and pays them out on
///         collect() — ABI-compatible with the real positions()/collect() surface the
///         harvester consumes.
contract MockPositionManager is ERC721 {
    struct Position {
        address token0;
        address token1;
        uint24 fee;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
        bool active;
    }

    uint256 internal _nextId = 1;
    mapping(uint256 => Position) internal _positions;

    constructor() ERC721("Mock Positions", "mNPM") {}

    /// @notice Mint a position NFT with an arbitrary token pair + fee tier (used both
    ///         for the legit pool and for the WrongFeeTier/WrongPositionTokens tests).
    function mintPosition(address token0, address token1, uint24 fee, address to)
        external
        returns (uint256 tokenId)
    {
        tokenId = _nextId++;
        _positions[tokenId] = Position({token0: token0, token1: token1, fee: fee, tokensOwed0: 0, tokensOwed1: 0, active: true});
        _mint(to, tokenId);
    }

    /// @notice Seed owed fees for a position. The underlying tokens must already be
    ///         held by this mock (test mints them to it) — collect() pays from here.
    function seedFees(uint256 tokenId, uint128 amount0, uint128 amount1) external {
        Position storage p = _positions[tokenId];
        require(p.active, "no position");
        p.tokensOwed0 += amount0;
        p.tokensOwed1 += amount1;
    }

    /// @notice Real-ABI view: the exact 12-field tuple the harvester decodes.
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
        )
    {
        Position storage p = _positions[tokenId];
        require(p.active, "no position");
        token0 = p.token0;
        token1 = p.token1;
        fee = p.fee;
        tokensOwed0 = p.tokensOwed0;
        tokensOwed1 = p.tokensOwed1;
    }

    function collect(INonfungiblePositionManager.CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage p = _positions[params.tokenId];
        require(p.active, "no position");
        amount0 = params.amount0Max < p.tokensOwed0 ? params.amount0Max : p.tokensOwed0;
        amount1 = params.amount1Max < p.tokensOwed1 ? params.amount1Max : p.tokensOwed1;
        p.tokensOwed0 -= uint128(amount0);
        p.tokensOwed1 -= uint128(amount1);
        if (amount0 > 0) IERC20(p.token0).transfer(params.recipient, amount0);
        if (amount1 > 0) IERC20(p.token1).transfer(params.recipient, amount1);
    }
}
