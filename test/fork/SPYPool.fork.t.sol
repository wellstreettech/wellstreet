// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

/// @dev Minimal surfaces for the live-chain checks (Uniswap V3 stack + the tokenized
///      stock token).
interface IUniswapV3Factory {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}

interface IUniswapV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
}

interface IERC20Metadata {
    function symbol() external view returns (string memory);
    function decimals() external view returns (uint8);
}

interface IQuoterV2Fork {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}

/// @notice SECONDARY fork tests against the live Robinhood Chain (4663) SPY/WETH
///         stack — latest-state only (the public RPC serves no archive state).
///
///         SKIPPED by default: these tests need an RPC endpoint. Set
///         WELLSTREET_ROBINHOOD_RPC_URL (the single pinned CI secret name) to run
///         them, e.g.:
///           WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
///             forge test --match-contract SPYPoolFork -vvv
///         If the public RPC flakes, the honest result is a documented skip — the
///         unit suites must pass regardless.
contract SPYPoolForkTest is Test {
    // Verified addresses (docs/ops/phase0/ evidence trail).
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address constant SPY_WETH_POOL_500 = 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    uint24 constant TIER_500 = 500;

    function _rpc() internal view returns (string memory) {
        return vm.envOr("WELLSTREET_ROBINHOOD_RPC_URL", string(""));
    }

    function setUp() public {
        string memory rpc = _rpc();
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
    }

    function test_chainIsRobinhood4663() public view {
        if (bytes(_rpc()).length == 0) return; // skipped via setUp
        assertEq(block.chainid, 4663);
    }

    function test_spyPoolExistsOnlyAtTier500() public view {
        IUniswapV3Factory factory = IUniswapV3Factory(V3_FACTORY);
        assertEq(factory.getPool(SPY, WETH, TIER_500), SPY_WETH_POOL_500);
        assertEq(factory.getPool(SPY, WETH, 100), address(0));
        assertEq(factory.getPool(SPY, WETH, 3000), address(0));
        assertEq(factory.getPool(SPY, WETH, 10000), address(0));
    }

    function test_spyPoolIdentityMatchesHarvesterConfig() public view {
        IUniswapV3Pool pool = IUniswapV3Pool(SPY_WETH_POOL_500);
        assertEq(pool.token0(), WETH);
        assertEq(pool.token1(), SPY);
        assertEq(pool.fee(), TIER_500);
        assertEq(IERC20Metadata(SPY).symbol(), "SPY");
        assertEq(IERC20Metadata(SPY).decimals(), 18);
    }

    function test_liveQuote_wethToSpyIsPositive() public {
        // QuoterV2 is stateful by design; in a fork test the swap simulation has no
        // durable effect. A positive quote proves the harvester's minOut source works
        // against the live tier-500 pool.
        (uint256 amountOut,,,) = IQuoterV2Fork(QUOTER_V2).quoteExactInputSingle(
            IQuoterV2Fork.QuoteExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: SPY,
                amountIn: 0.1e18,
                fee: TIER_500,
                sqrtPriceLimitX96: 0
            })
        );
        assertGt(amountOut, 0);
    }
}
