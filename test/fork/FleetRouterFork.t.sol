// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {FleetRouter} from "../../src/FleetRouter.sol";
import {ISwapRouter02V4, IQuoterV2Path} from "../../src/HarvesterV4.sol";

/// @dev The REAL deployed NPM's public surfaces the smoke test reads: the canonical
///      12-field positions() (the unit battery's mock exposes a 7-field shape — audit
///      F-4/F-5) and ownerOf. A decode failure here is ITSELF a finding: it would mean
///      the deployed NPM's ABI diverges from the verified canonical source.
interface IRealNPM {
    function ownerOf(uint256 tokenId) external view returns (address);

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
}

/// @dev The issuer-gate registry read (house pattern — see RoamingHarvesterFork).
interface IAccessControlsRegistryless {
    function isBlocked(address who) external view returns (bool);
}

/// @dev ERC-20 metadata (decimals for human-unit funding amounts).
interface IERC20MetadataLite {
    function decimals() external view returns (uint8);
}

/// @notice FLEET-ROUTER-AUDIT F-5 — the fork smoke test, the one EMPIRICAL close of the
///         router's ABI-boundary risk: a tiny REAL open through the router against the
///         DEPLOYED fork NPM (0x73991a25…0D3) on a LIVE v3 book (SPY/USDG tier-500 —
///         the same proven tier-500 v3 route the roamer battery uses to acquire SPY;
///         the router is book-agnostic — params carry the pool — so any live book
///         proves the boundary). Asserts, post-open:
///           1. the NFT is minted to the CALLER (real ownerOf + the real 12-field
///              positions() read: book identity + liquidity match the params),
///           2. the payer-pull happened FROM the caller (caller balance delta ==
///              the router's returned consumed amounts — refund included),
///           3. the flat fee landed at the REAL TreasuryTimelock (0xD55bA510…342),
///           4. the router's balances are UNCHANGED (token0/token1/native — the
///              delta invariant holds against live tokens, fresh deploy so delta ==
///              absolute zero).
///         Zero broadcast, zero spend: every state change lives in the local fork.
contract FleetRouterForkTest is Test {
    // ------------------------------------------------------------------
    // Pins — the same verified addresses the deploy script and Deploy.s.sol
    // carry. Canonical Uniswap addresses on 4663 are SCAM DRAINERS — only
    // these pins are real.
    // ------------------------------------------------------------------
    address constant NPM = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant TIMELOCK = 0xD55bA510533dc5a250b4D6d49Ee825113DD69342;
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;

    uint24 constant BOOK_FEE = 500; // the SPY/USDG tier-500 v3 book
    int24 constant LO = -887220; // full range, tickSpacing 10
    int24 constant HI = 887220;

    function _rpc() internal view returns (string memory) {
        return vm.envOr("WELLSTREET_ROBINHOOD_RPC_URL", string("robinhood"));
    }

    function setUp() public {
        vm.createSelectFork(_rpc());
        assertGt(NPM.code.length, 0, "deployed fork NPM has no code");
        assertGt(TIMELOCK.code.length, 0, "treasury timelock has no code");
    }

    // ------------------------------------------------------------------
    // Helpers (house RoamingHarvesterFork machinery, verbatim shapes)
    // ------------------------------------------------------------------

    function _dec(address token) internal view returns (uint256) {
        return 10 ** IERC20MetadataLite(token).decimals();
    }

    /// @dev Issuer-gated SPY: every fork address in a money path must be unblocked.
    function _assertUnblockedSpy(address who) internal view {
        (bool ok, bytes memory ret) = SPY.staticcall(abi.encodeWithSignature("ACCESS_CONTROLLED_REGISTRY()"));
        assertTrue(ok && ret.length == 32, "cannot read SPY ACCESS_CONTROLLED_REGISTRY");
        address registry = abi.decode(ret, (address));
        assertFalse(IAccessControlsRegistryless(registry).isBlocked(who), "address is blocked on SPY");
    }

    /// @dev Real v3 swap through the deployed SwapRouter02 (QuoterV2-derived minOut).
    function _swapV3(address tokenIn, address tokenOut, uint24 feeTier, uint256 amountIn)
        internal
        returns (uint256 amountOut)
    {
        bytes memory path = abi.encodePacked(tokenIn, feeTier, tokenOut);
        (uint256 quoted,,,) = IQuoterV2Path(QUOTER_V2).quoteExactInput(path, amountIn);
        assertGt(quoted, 0, "v3 route quoted zero output");
        IERC20(tokenIn).approve(SWAP_ROUTER, amountIn);
        amountOut = ISwapRouter02V4(SWAP_ROUTER).exactInput(
            ISwapRouter02V4.ExactInputParams({
                path: path,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: (quoted * 9900) / 10000
            })
        );
    }

    // ------------------------------------------------------------------
    // The smoke open
    // ------------------------------------------------------------------
    function testFork_RouterSmokeTinyOpen_RealNpm_RealTimelock() public {
        // Deploy the router EXACTLY as the broadcast will (pins; the deploy script
        // asserts the same literals — here they ARE the deployed-truth args).
        FleetRouter router = new FleetRouter(NPM, TIMELOCK);
        assertEq(router.npm(), NPM, "router.npm pin");
        assertEq(router.timelock(), TIMELOCK, "router.timelock pin");
        assertEq(router.fee(), 0.0005 ether, "starting fee");

        // Issuer-gate tripwires on every SPY money-path address.
        _assertUnblockedSpy(address(this));
        _assertUnblockedSpy(address(router));
        _assertUnblockedSpy(NPM);
        _assertUnblockedSpy(SWAP_ROUTER);

        // Fund: USDG dealt (OZ balances layout — asserted loudly); SPY acquired via a
        // REAL v3 swap (the issuer-gated stock token is NEVER dealt — house rule).
        deal(USDG, address(this), 6000 * _dec(USDG));
        assertGt(IERC20(USDG).balanceOf(address(this)), 0, "USDG deal did not land");
        _swapV3(USDG, SPY, BOOK_FEE, 3000 * _dec(USDG));
        uint256 spyHeld = IERC20(SPY).balanceOf(address(this));
        uint256 usdgHeld = IERC20(USDG).balanceOf(address(this));
        assertGt(spyHeld, 0, "v3 swap produced no SPY");
        assertGt(usdgHeld, 0, "funding left no USDG for leg 1");

        // Generous desireds, zero mins → the pool price binds one leg and the REFUND
        // path fires on the surplus (or both consume fully — either way the caller's
        // balance delta must equal the router's returned consumed amounts).
        uint256 desired0 = (spyHeld * 8) / 10;
        uint256 desired1 = (usdgHeld * 5) / 10;
        IERC20(SPY).approve(address(router), desired0);
        IERC20(USDG).approve(address(router), desired1);

        uint256 timelockBefore = TIMELOCK.balance;
        uint256 callerSpyBefore = IERC20(SPY).balanceOf(address(this));
        uint256 callerUsdgBefore = IERC20(USDG).balanceOf(address(this));
        assertEq(address(router).balance, 0, "router starts native-empty");

        (uint256 tokenId, uint128 liquidity, uint256 used0, uint256 used1) = router.openPosition{value: 0.0005 ether}(
            FleetRouter.PositionParams({
                token0: SPY, // 0x117c… < 0x5fc5… — sorted
                token1: USDG,
                feeTier: BOOK_FEE,
                tickLower: LO,
                tickUpper: HI,
                amount0Desired: desired0,
                amount1Desired: desired1,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 300
            })
        );

        // 1. Payer-pull evidence: the caller paid EXACTLY the router's returned
        //    consumed amounts — the NPM pulled via the router, refund included.
        assertEq(callerSpyBefore - IERC20(SPY).balanceOf(address(this)), used0, "caller must pay exactly used0");
        assertEq(callerUsdgBefore - IERC20(USDG).balanceOf(address(this)), used1, "caller must pay exactly used1");
        assertGt(liquidity, 0, "smoke position minted no liquidity");
        assertLe(used0, desired0, "consumed0 cannot exceed desired0");
        assertLe(used1, desired1, "consumed1 cannot exceed desired1");

        // 2. NFT to the caller — real ownerOf + the real 12-field positions() read.
        assertEq(IRealNPM(NPM).ownerOf(tokenId), address(this), "NFT must be minted to the caller");
        (
            ,
            ,
            address pt0,
            address pt1,
            uint24 pfee,
            int24 plo,
            int24 phi,
            uint128 pliq,
            ,
            ,
            ,

        ) = IRealNPM(NPM).positions(tokenId);
        assertEq(pt0, SPY, "position token0");
        assertEq(pt1, USDG, "position token1");
        assertEq(pfee, BOOK_FEE, "position fee tier");
        assertEq(plo, LO, "position tickLower");
        assertEq(phi, HI, "position tickUpper");
        assertEq(pliq, liquidity, "position liquidity matches the mint return");

        // 3. Fee lane: the flat fee landed at the REAL TreasuryTimelock.
        assertEq(TIMELOCK.balance - timelockBefore, 0.0005 ether, "fee must land at the real timelock");

        // 4. Router retains NOTHING (fresh deploy → delta == absolute zero).
        assertEq(IERC20(SPY).balanceOf(address(router)), 0, "token0 stranded on the router");
        assertEq(IERC20(USDG).balanceOf(address(router)), 0, "token1 stranded on the router");
        assertEq(address(router).balance, 0, "native stranded on the router");
    }
}
