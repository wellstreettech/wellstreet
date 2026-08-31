// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {YieldShares} from "../../src/YieldShares.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {Harvester, INonfungiblePositionManager, ISwapRouter02, IQuoterV2} from "../../src/Harvester.sol";
import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";

/// @dev Mint surface of the deployed NonfungiblePositionManager (not needed by the
///      Harvester itself, so it is declared here, in the test).
interface INpmMint {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    function mint(MintParams calldata params)
        external
        payable
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

/// @dev Minimal read surfaces for the live-chain checks.
interface IUniswapV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function tickSpacing() external view returns (int24);
}

interface IAccessControlsRegistry {
    function isBlocked(address account) external view returns (bool);
}

interface ISpyPause {
    function paused() external view returns (bool);
}

/// @notice AUDIT G1 GATE — REAL-NPM fork harvest test (audit finding F-11, test gap G1
///         in docs/audits/WELLSTREET_CONTRACT_AUDIT_2026-08-30.md).
///
///         What this test gates: the harvester's entire yield path depends on a
///         NON-CANONICAL, verified behavior of the deployed Robinhood Chain (4663)
///         NonfungiblePositionManager — its collect() internally POKES the pool
///         (`if (position.liquidity > 0) { pool.burn(tickLower, tickUpper, 0); ... }`,
///         read in the Blockscout-verified source at 0x73991a25…0D3) and accrues
///         current pool-side fees into tokensOwed BEFORE collecting. The canonical
///         Uniswap v3-periphery NPM does NOT do this. The unit suite's
///         MockPositionManager collects from directly-seeded tokensOwed and models
///         neither pool-side fee growth nor the internal poke, so the 53-test suite is
///         blind to any change in this behavior. This fork test pins it end-to-end:
///         a REAL full-range LP position is minted through the REAL NPM on the REAL
///         tier-500 SPY/WETH pool, REAL swaps accrue fees pool-side (NPM-side
///         tokensOwed still zero — nothing poked), and a permissionless harvest()
///         must collect them through the real collect() code path.
///
///         FORK-ONLY: everything runs on a local anvil fork of the public Robinhood
///         Chain RPC. Zero real-chain transactions, zero broadcast, zero spend. The
///         fork only READS real state; every state change below lives in the local
///         fork and is discarded when the test ends.
///
///         SKIPPED by default (same pattern as SPYPool.fork.t.sol): set
///         WELLSTREET_ROBINHOOD_RPC_URL to run, e.g.:
///           WELLSTREET_ROBINHOOD_RPC_URL=https://rpc.mainnet.chain.robinhood.com \
///             forge test --match-contract HarvestForkTest -vvv
contract HarvestForkTest is Test {
    // Verified addresses (docs/ops/phase0/ evidence trail; identical to the deploy
    // script wiring).
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant SPY_WETH_POOL_500 = 0xDDCBBa3666f578E3F09516f21Ff85BFee859AB5e;
    address constant POSITION_MANAGER = 0x73991a25C818Bf1f1128dEAaB1492D45638DE0D3;
    address constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    uint24 constant TIER_500 = 500;
    // Full range for the tier-500 pool (tickSpacing 10): nearestUsableTick of
    // MIN_TICK/MAX_TICK (-887272/887272).
    int24 constant FULL_RANGE_LOWER = -887270;
    int24 constant FULL_RANGE_UPPER = 887270;

    uint256 constant TIMELOCK_DELAY = 48 hours + 1;
    uint256 constant INITIAL_FEE_BPS = 1000; // 10% protocol / 90% depositors

    bytes32 constant HARVESTED_SIG =
        keccak256("Harvested(uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)");
    bytes32 constant POSITION_RECEIVED_SIG = keccak256("PositionReceived(address,uint256,address)");

    WellstreetTimelock timelock;
    VaultFactory factory;
    YieldShares vault;
    Harvester harvester;
    INonfungiblePositionManager npm;
    IAccessControlsRegistry registry;

    address proposer = makeAddr("wellstreet-deployer");
    address pauser = makeAddr("pause-eoa");
    address executor = makeAddr("permissionless-executor");
    address bob = makeAddr("harvest-caller");

    struct HarvestedEvt {
        uint256 tokenId;
        address caller;
        uint256 amount0Collected;
        uint256 amount1Collected;
        uint256 swappedOut;
        uint256 proceeds;
        uint256 vaultShare;
        uint256 vaultCredited;
        uint256 tip;
        uint256 accrued;
    }

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

        // ---- Live-state preconditions -------------------------------------------
        // The issuer-controlled SPY token gates EVERY money path on (paused, blocked):
        // the fork addresses must all be unblocked or the whole flow reverts.
        assertFalse(ISpyPause(SPY).paused(), "SPY paused on the forked state");
        (bool ok, bytes memory ret) = SPY.staticcall(abi.encodeWithSignature("ACCESS_CONTROLLED_REGISTRY()"));
        assertTrue(ok && ret.length == 32, "cannot read SPY ACCESS_CONTROLLED_REGISTRY");
        registry = IAccessControlsRegistry(abi.decode(ret, (address)));
        _assertUnblocked(address(this));
        _assertUnblocked(bob);
        _assertUnblocked(executor);
        _assertUnblocked(SPY_WETH_POOL_500);
        _assertUnblocked(POSITION_MANAGER);
        _assertUnblocked(SWAP_ROUTER);

        assertEq(IUniswapV3PoolLike(SPY_WETH_POOL_500).token0(), WETH);
        assertEq(IUniswapV3PoolLike(SPY_WETH_POOL_500).token1(), SPY);
        assertEq(IUniswapV3PoolLike(SPY_WETH_POOL_500).fee(), TIER_500);
        assertEq(IUniswapV3PoolLike(SPY_WETH_POOL_500).tickSpacing(), 10); // full-range bounds below

        // ---- Deploy the protocol stack on the fork (deploy-script wiring) --------
        timelock = new WellstreetTimelock(proposer, TIMELOCK_DELAY);
        factory = new VaultFactory(address(timelock), pauser, INITIAL_FEE_BPS);
        vault = YieldShares(factory.createVault(SPY, "Wellstreet SPY", "ws-SPY"));
        harvester = new Harvester(
            address(vault),
            address(timelock), // position custody controller
            address(timelock), // treasury custody
            SPY,
            WETH,
            TIER_500,
            POSITION_MANAGER,
            SWAP_ROUTER,
            QUOTER_V2
        );
        // setHarvester is timelock-only: queue -> 48h window -> PERMISSIONLESS execute
        // (executor is NOT the proposer — pins the open-executor trust model).
        vm.prank(proposer);
        timelock.queue(address(vault), 0, abi.encodeCall(YieldShares.setHarvester, (address(harvester))), bytes32(0));
        vm.warp(block.timestamp + TIMELOCK_DELAY + 1);
        vm.prank(executor);
        timelock.execute(address(vault), 0, abi.encodeCall(YieldShares.setHarvester, (address(harvester))), bytes32(0));

        assertEq(address(timelock), factory.timelock());
        assertEq(address(vault), factory.vaultOfAsset(SPY));
        assertEq(vault.name(), "Wellstreet SPY");
        assertEq(vault.symbol(), "ws-SPY");
        assertEq(vault.feeBps(), INITIAL_FEE_BPS);
        assertEq(vault.harvester(), address(harvester));

        npm = INonfungiblePositionManager(POSITION_MANAGER);

        // Treasury (the timelock itself) and vault must be unblocked too.
        _assertUnblocked(address(timelock));
        _assertUnblocked(address(vault));
        _assertUnblocked(address(harvester));

        // Fund the test contract with WETH (cheatcode; SPY is acquired via a REAL
        // swap, never dealt). WETH is an OZ TransparentUpgradeableProxy with the
        // balances mapping deep in the implementation layout — assert the deal
        // landed loudly instead of trusting slot detection.
        deal(WETH, address(this), 20e18);
        assertEq(IERC20(WETH).balanceOf(address(this)), 20e18, "WETH deal() did not land");
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    function _assertUnblocked(address who) internal view {
        assertFalse(registry.isBlocked(who), "address is blocked on SPY");
    }

    /// @dev Real WETH->SPY swap through the deployed SwapRouter02 (classic ERC20
    ///      allowance rail — the deployed router carries no Permit2 constant).
    function _swapWethToSpy(uint256 amountIn) internal returns (uint256 amountOut) {
        (uint256 quoted,,,) = IQuoterV2(QUOTER_V2).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: SPY,
                amountIn: amountIn,
                fee: TIER_500,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(WETH).approve(SWAP_ROUTER, amountIn);
        amountOut = ISwapRouter02(SWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: SPY,
                fee: TIER_500,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: (quoted * 9900) / 10000,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @dev Real SPY->WETH swap through the deployed SwapRouter02 (the reverse
    ///      direction — accrues SPY-leg fees to in-range LPs).
    function _swapSpyToWeth(uint256 amountIn) internal returns (uint256 amountOut) {
        (uint256 quoted,,,) = IQuoterV2(QUOTER_V2).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: SPY,
                tokenOut: WETH,
                amountIn: amountIn,
                fee: TIER_500,
                sqrtPriceLimitX96: 0
            })
        );
        IERC20(SPY).approve(SWAP_ROUTER, amountIn);
        amountOut = ISwapRouter02(SWAP_ROUTER).exactInputSingle(
            ISwapRouter02.ExactInputSingleParams({
                tokenIn: SPY,
                tokenOut: WETH,
                fee: TIER_500,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: (quoted * 9900) / 10000,
                sqrtPriceLimitX96: 0
            })
        );
    }

    /// @dev Mint a REAL full-range position on the REAL tier-500 pool via the REAL
    ///      NPM (the D11 full-range pin). Only the consumed amounts are pulled from
    ///      the desired balances; the rest stays with the caller.
    function _mintFullRangePosition(uint256 wethDesired, uint256 spyDesired)
        internal
        returns (uint256 tokenId, uint128 liquidity)
    {
        IERC20(WETH).approve(POSITION_MANAGER, wethDesired);
        IERC20(SPY).approve(POSITION_MANAGER, spyDesired);
        (tokenId, liquidity,,) = INpmMint(POSITION_MANAGER).mint(
            INpmMint.MintParams({
                token0: WETH,
                token1: SPY,
                fee: TIER_500,
                tickLower: FULL_RANGE_LOWER,
                tickUpper: FULL_RANGE_UPPER,
                amount0Desired: wethDesired,
                amount1Desired: spyDesired,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 1 hours
            })
        );
    }

    /// @dev Decode the last Harvested event emitted since vm.recordLogs().
    function _lastHarvestedEvent() internal view returns (HarvestedEvt memory e) {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        bool found;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == HARVESTED_SIG && entries[i].topics.length == 3) {
                // data words: amount0Collected, amount1Collected, swappedOut,
                // proceeds, vaultShare, vaultCredited, tip, accrued
                uint256[8] memory w = abi.decode(entries[i].data, (uint256[8]));
                e.tokenId = uint256(entries[i].topics[1]);
                e.caller = address(uint160(uint256(entries[i].topics[2])));
                e.amount0Collected = w[0];
                e.amount1Collected = w[1];
                e.swappedOut = w[2];
                e.proceeds = w[3];
                e.vaultShare = w[4];
                e.vaultCredited = w[5];
                e.tip = w[6];
                e.accrued = w[7];
                found = true;
            }
        }
        assertTrue(found, "Harvested event not found");
    }

    /// @dev Count PositionReceived events since vm.recordLogs() for a given NFT.
    function _countPositionReceived(uint256 tokenId) internal view returns (uint256 count) {
        Vm.Log[] memory entries = vm.getRecordedLogs();
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == POSITION_RECEIVED_SIG && entries[i].topics.length == 4) {
                if (uint256(entries[i].topics[2]) == tokenId) count++;
            }
        }
    }

    /// @dev The shared flow up to and including the main fee harvest (harvest #1).
    ///      Returns the tokenId, the position liquidity as of JUST BEFORE harvest #1
    ///      (the principal-preservation baseline), and the decoded Harvested event of
    ///      harvest #1.
    function _flowToMainHarvest() internal returns (uint256 tokenId, uint128 liqPreHarvest, HarvestedEvt memory e1) {
        // (1) Funding swap through the REAL router: WETH -> SPY (~1 WETH). Also pins
        //     QuoterV2 <-> SwapRouter02 determinism: the real output must equal the
        //     fresh quote bit-for-bit (same deterministic pool state).
        uint256 spyBefore = IERC20(SPY).balanceOf(address(this));
        (uint256 quoted,,,) = IQuoterV2(QUOTER_V2).quoteExactInputSingle(
            IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: WETH,
                tokenOut: SPY,
                amountIn: 1e18,
                fee: TIER_500,
                sqrtPriceLimitX96: 0
            })
        );
        uint256 got = _swapWethToSpy(1e18);
        assertEq(got, quoted, "router output != fresh QuoterV2 quote");
        assertEq(IERC20(SPY).balanceOf(address(this)) - spyBefore, got, "SPY received != swap output (FoT?)");
        assertGt(got, 0);

        // (2) REAL full-range LP position via the REAL NPM (SPY side binds; the
        //     unused WETH desired is never pulled).
        (tokenId, ) = _mintFullRangePosition(2e18, (IERC20(SPY).balanceOf(address(this)) * 95) / 100);
        (, , , , , , , uint128 liquidity,,,, ) = npm.positions(tokenId);
        assertGt(liquidity, 0, "minted position has zero liquidity");
        assertEq(IERC721(POSITION_MANAGER).ownerOf(tokenId), address(this));

        // (3) Hand the NFT to the harvester — exercises the STRICT guarded
        //     onERC721Received against the REAL manager (pool identity + fee tier are
        //     validated from the real positions() data; anything else reverts the
        //     transfer).
        vm.recordLogs();
        IERC721(POSITION_MANAGER).safeTransferFrom(address(this), address(harvester), tokenId);
        assertEq(_countPositionReceived(tokenId), 1, "guarded onERC721Received did not accept the position");
        assertEq(harvester.positionId(), tokenId);

        // (4) Zero-proceeds harvest (harvest #0): NOTHING has accrued since the mint
        //     (no swap since the position was created), so collect must return
        //     (0, 0) even though it auto-pokes. This is the honest proceeds=0 path:
        //     no revert, nothing credited, no tip.
        vm.recordLogs();
        vm.prank(bob);
        harvester.harvest();
        HarvestedEvt memory e0 = _lastHarvestedEvent();
        assertEq(e0.tokenId, tokenId);
        assertEq(e0.caller, bob);
        assertEq(e0.amount0Collected, 0, "unexpected WETH leg on a zero-fee position");
        assertEq(e0.amount1Collected, 0, "unexpected SPY leg on a zero-fee position");
        assertEq(e0.swappedOut, 0);
        assertEq(e0.proceeds, 0);
        assertEq(e0.vaultShare, 0);
        assertEq(e0.vaultCredited, 0);
        assertEq(e0.tip, 0);
        assertEq(e0.accrued, 0);
        assertEq(vault.totalAssets(), 0);
        assertEq(harvester.protocolAccrued(), 0);
        assertEq(IERC20(SPY).balanceOf(bob), 0);

        // (5) REAL fee accrual: swaps in BOTH directions (~1 WETH each) through the
        //     REAL router. The fees accrue to in-range LPs pool-side; our full-range
        //     position is always in range and takes its L-proportional share.
        _swapWethToSpy(1e18); // WETH-leg fees
        uint256 spyBal = IERC20(SPY).balanceOf(address(this));
        assertGt(spyBal, 0);
        _swapSpyToWeth((spyBal * 80) / 100); // SPY-leg fees (~1 WETH of value)

        // (6) THE G1 PRECONDITION (mock-vs-real divergence): fees have accrued
        //     pool-side, but the NPM-side tokensOwed are STILL ZERO — nothing has
        //     poked the position since the mint. The canonical Uniswap NPM would
        //     collect (0, 0) here; the DEPLOYED NPM auto-pokes inside collect() and
        //     materializes the accrual (pinned by harvest #1 below).
        (, , , , , , , uint128 liq, , , uint128 owed0Pre, uint128 owed1Pre) = npm.positions(tokenId);
        liqPreHarvest = liq;
        assertEq(owed0Pre, 0, "NPM-side tokensOwed0 should be zero before any poke");
        assertEq(owed1Pre, 0, "NPM-side tokensOwed1 should be zero before any poke");

        // (7) Permissionless harvest by a NON-OWNER EOA (tip path).
        uint256 totalAssetsBefore = vault.totalAssets(); // 0 — no deposits ever
        uint256 accruedBefore = harvester.protocolAccrued(); // 0
        uint256 bobBefore = IERC20(SPY).balanceOf(bob); // 0
        uint256 vaultSpyBefore = IERC20(SPY).balanceOf(address(vault));
        assertEq(totalAssetsBefore, 0);
        assertEq(accruedBefore, 0);

        vm.recordLogs();
        vm.prank(bob);
        harvester.harvest();
        e1 = _lastHarvestedEvent();
    }

    // ------------------------------------------------------------------
    // THE G1 GATE
    // ------------------------------------------------------------------

    function testFork_harvest_endToEnd_realNpmAutoPoke() public {
        (uint256 tokenId, uint128 liqPre, HarvestedEvt memory e1) = _flowToMainHarvest();

        // ---- Split math, computed from the ACTUAL collected amounts (never from
        //      absolute dust thresholds) ---------------------------------------
        assertGt(e1.proceeds, 0, "no proceeds collected - auto-poke/accrual broken");
        // Pool orientation: token0 = WETH, token1 = SPY (asserted in setUp), so the
        // WETH leg is amount0 and the asset leg is amount1. BOTH legs must be
        // non-zero: the flow swapped in both directions.
        assertGt(e1.amount0Collected, 0, "WETH fee leg not collected through the real auto-poke");
        assertGt(e1.amount1Collected, 0, "SPY fee leg not collected through the real auto-poke");
        // proceeds = assetCollected + swappedOut
        assertEq(e1.proceeds, e1.amount1Collected + e1.swappedOut, "proceeds != asset leg + swapped WETH leg");
        // vault share = floor(proceeds * 9000 / 10000)
        assertEq(vault.feeBps(), INITIAL_FEE_BPS);
        assertEq(e1.vaultShare, (e1.proceeds * 9000) / 10000, "vault share != 90% of proceeds");
        // The credited amount (F-03b empirical delta) equals the declared share on a
        // clean (non-fee-on-transfer) token — the discrepancy path is not exercised.
        assertEq(e1.vaultCredited, e1.vaultShare, "credited != declared share on a clean token");
        // tip = floor(proceeds * 10 / 10000) = floor(proceeds / 1000)
        assertEq(e1.tip, (e1.proceeds * 10) / 10000, "tip != 0.1% of proceeds");
        assertGt(e1.tip, 0, "caller tip is zero");
        // protocol accrual = proceeds - vaultShare - tip
        assertEq(e1.accrued, e1.proceeds - e1.vaultShare - e1.tip, "accrual != proceeds - vault - tip");

        // ---- Vault accounting: totalAssets rises by EXACTLY the vault share, no
        //      shares minted -----------------------------------------------
        assertEq(vault.totalAssets(), e1.vaultShare, "totalAssets != vault share");
        assertEq(IERC20(SPY).balanceOf(address(vault)), e1.vaultShare, "vault SPY balance != vault share");
        assertEq(vault.totalSupply(), 0, "yield must mint NO shares");

        // ---- Protocol accrual + caller tip -----------------------------------
        assertEq(harvester.protocolAccrued(), e1.accrued, "protocolAccrued != accrued");
        assertEq(IERC20(SPY).balanceOf(bob), e1.tip, "caller SPY balance != tip");

        // ---- Harvester bookkeeping: everything placed exactly ----------------
        assertEq(IERC20(SPY).balanceOf(address(harvester)), e1.accrued, "harvester holds != accrued");
        assertEq(IERC20(WETH).balanceOf(address(harvester)), 0, "collected WETH leg not fully swapped");

        // ---- LP principal untouched; accrual consumed (the G1 point) ----------
        assertEq(harvester.positionId(), tokenId, "positionId changed");
        assertEq(IERC721(POSITION_MANAGER).ownerOf(tokenId), address(harvester), "NFT custody changed");
        (, , , , , , , uint128 liqPost, , , uint128 owed0Post, uint128 owed1Post) = npm.positions(tokenId);
        assertEq(uint256(liqPost), uint256(liqPre), "position liquidity changed (principal touched)");
        assertEq(owed0Post, 0, "tokensOwed0 not consumed by collect");
        assertEq(owed1Post, 0, "tokensOwed1 not consumed by collect");

        // ---- Event identity ---------------------------------------------------
        assertEq(e1.tokenId, tokenId);
        assertEq(e1.caller, bob);
    }

    /// @notice The harvest-after-harvest reality on the REAL stack: the auto-poke
    ///         makes the literal zero-proceeds path unreachable after ANY successful
    ///         harvest whose WETH leg was swapped — the harvest's OWN swap leg pays
    ///         fees INTO the pool, which re-seed the position until the next poke.
    ///         (The true zero-proceeds path is pinned in
    ///         testFork_harvest_endToEnd_realNpmAutoPoke step (4), where nothing has
    ///         been swapped since the position was created.) Here we pin that the
    ///         second harvest does not revert and that whatever dust it collects is
    ///         split by exactly the same formula.
    function testFork_harvest_secondHarvestNoRevertSameMath() public {
        (uint256 tokenId, uint128 liqPre, HarvestedEvt memory e1) = _flowToMainHarvest();

        uint256 totalAssetsAfter1 = vault.totalAssets();
        uint256 accruedAfter1 = harvester.protocolAccrued();
        uint256 bobAfter1 = IERC20(SPY).balanceOf(bob);

        // No swaps since harvest #1 — the only possible accrual is the dust
        // re-seeded by harvest #1's own swap leg.
        vm.recordLogs();
        vm.prank(bob);
        harvester.harvest(); // must NOT revert
        HarvestedEvt memory e2 = _lastHarvestedEvent();

        // Dust-scale: far below harvest #1's proceeds (it is only the fee on
        // harvest #1's own tiny swap leg, re-seeded pool-side).
        assertLt(e2.proceeds, e1.proceeds / 100, "second harvest collected more than re-seed dust");
        // The same exact split math holds for whatever was collected (all terms
        // are zero-safe, so a fully-truncated re-seed also passes honestly).
        assertEq(e2.proceeds, e2.amount1Collected + e2.swappedOut, "proceeds != asset leg + swapped WETH leg");
        assertEq(e2.vaultShare, (e2.proceeds * 9000) / 10000, "vault share formula broken on second harvest");
        assertEq(e2.vaultCredited, e2.vaultShare, "credited != declared share on second harvest");
        assertEq(e2.tip, (e2.proceeds * 10) / 10000, "tip formula broken on second harvest");
        assertEq(e2.accrued, e2.proceeds - e2.vaultShare - e2.tip, "accrual formula broken on second harvest");
        assertEq(vault.totalAssets() - totalAssetsAfter1, e2.vaultShare, "totalAssets delta != second vault share");
        assertEq(harvester.protocolAccrued() - accruedAfter1, e2.accrued, "accrual delta != second accrual");
        assertEq(IERC20(SPY).balanceOf(bob) - bobAfter1, e2.tip, "tip delta != second tip");

        // Principal STILL untouched (liquidity unchanged across BOTH harvests),
        // accrual STILL consumed.
        assertEq(harvester.positionId(), tokenId);
        (, , , , , , , uint128 liqAfter2, , , uint128 owed0After2, uint128 owed1After2) = npm.positions(tokenId);
        assertEq(uint256(liqAfter2), uint256(liqPre), "position liquidity changed across the harvests");
        assertEq(owed0After2, 0);
        assertEq(owed1After2, 0);
    }
}
