// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter02, IQuoterV2} from "../../src/Harvester.sol";

/// @notice Mock SwapRouter02: pulls tokenIn from the caller (the harvester approves
///         it, like the real router), enforces amountOutMinimum exactly like the real
///         router, and pays out at a configurable rate (asset wei per 1e18 tokenIn).
///         Can be flagged to hard-revert (router failure scenario).
contract MockRouter is ISwapRouter02 {
    uint256 public rateOutPerIn = 3000e18; // e.g. 3000 SPY-wei per 1 WETH-wei * 1e18 scale
    bool public fail;

    error MockRouterFailure();
    error MockRouterMinOutBreached(uint256 amountOut, uint256 amountOutMinimum);

    function setRateOutPerIn(uint256 rate) external {
        rateOutPerIn = rate;
    }

    function setFail(bool shouldFail) external {
        fail = shouldFail;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        if (fail) revert MockRouterFailure();
        IERC20(params.tokenIn).transferFrom(msg.sender, address(this), params.amountIn);
        amountOut = (params.amountIn * rateOutPerIn) / 1e18;
        if (amountOut < params.amountOutMinimum) {
            revert MockRouterMinOutBreached(amountOut, params.amountOutMinimum);
        }
        IERC20(params.tokenOut).transfer(params.recipient, amountOut);
    }
}

/// @notice Mock QuoterV2: quotes at a configurable rate (normally identical to the
///         router rate; a stale-quote scenario sets a higher quote than the router
///         actually pays, which must revert the harvest via minOut).
contract MockQuoter is IQuoterV2 {
    uint256 public rateOutPerIn = 3000e18;
    bool public fail;

    function setRateOutPerIn(uint256 rate) external {
        rateOutPerIn = rate;
    }

    function setFail(bool shouldFail) external {
        fail = shouldFail;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        view
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)
    {
        if (fail) revert MockQuoterFailure();
        amountOut = (params.amountIn * rateOutPerIn) / 1e18;
    }

    error MockQuoterFailure();
}
