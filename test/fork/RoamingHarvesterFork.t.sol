// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RoamingHarvester, IPoolManagerV4, IForkQuoter} from "../../src/RoamingHarvester.sol";
import {RoamAllowlist} from "../../src/RoamAllowlist.sol";
import {WellstreetTimelock} from "../../src/WellstreetTimelock.sol";
import {ISwapRouter02V4, IQuoterV2Path} from "../../src/HarvesterV4.sol";

/// @dev Fork-stack StateView (canonical v4-periphery lens, ctor-arg-bound to OUR
///      PoolManager — GOAL §S0.5). The observable-state spot reads (NO oracle).
interface IStateView {
    function getSlot0(bytes32 poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee);

    function getLiquidity(bytes32 poolId) external view returns (uint128 liquidity);

    function getPositionInfo(bytes32 poolId, address owner, int24 tickLower, int24 tickUpper, bytes32 salt)
        external
        view
        returns (uint128 liquidity, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128);
}

/// @dev The one extra PoolManager surface the TEST needs (the roamer itself never
///      donates — donation is a fork-test accrual device, house HarvesterV4Fork pattern).
interface IPM4Donate {
    function donate(
        IPoolManagerV4.PoolKey calldata key,
        uint256 amount0,
        uint256 amount1,
        bytes calldata hookData
    ) external;
}

/// @dev ERC-20 metadata (decimals for human-unit test funding amounts).
interface IERC20MetadataLite {
    function decimals() external view returns (uint8);
}

/// @notice ROAMING-HARVESTER-POL fork battery — the POL roamer against LIVE Robinhood
///         Chain (4663) state, proving the migrate/burn/exit loop end-to-end on the
///         pinned fork PoolManager:
///           T1  DIRECTION-CHECK anchor mechanics (both directions, the goal's anchor
///               pairs): seed a full-range SPY/USDG position THROUGH the 48h timelock →
///               vm.warp(+7d) past the seed's CREATION anchor (the ratified later-of
///               MIN_HOLD anchor hold-locks a fresh seed from seed time) → migrate
///               SPY/USDG → USDG/ETH (the dynamic-fee hook book, testFork_T4's hard
///               shape) → vm.warp(+7d) past the migration re-anchor → migrate BACK.
///               Migration mechanics proven BOTH ways; the reversal BLOCK-ALL is an
///               OFF-CHAIN policy check per 07 §4 — never an on-chain revert assertion.
///               The first migrate runs as a random EOA: migrate() is permissionless
///               with NO tip (fail-closed form).
///           T2  minOut is FAIL-CLOSED: an unreachable floor reverts the WHOLE
///               migration atomically — the from-position survives, nothing is
///               stranded, and the rolling cap is NOT consumed by a reverted call.
///           T3  the 07 §1 deterministic guardrails, on-chain and fail-closed:
///               MIN_HOLD (creation anchor AND the migration re-anchor), the
///               MIN_EXPECTED_GAIN_BPS attestation (zero → missing, below-floor →
///               below), the rolling-365d MAX_MIGRATIONS_PER_PERIOD counter (re-ranges
///               count; a reverted migration does not), the toKey-ONLY allowlist rail
///               (an unlisted target reverts; fromKey is never railed), and toKey
///               salt-MUST-be-zero (the roamer assigns monotone nonces).
///           T4  the AMENDMENT B buyback-burn tail, live: the tail is INERT until the
///               one-shot setWellToken; the accounted accrual (a real pool-accounting
///               donate share) is swapped to the WELL stand-in on the live book through
///               the pinned fork Quoter and burned to 0x…dEaD; force-sent JUNK of a
///               known token routes to the TREASURY, never the burn stream; NOTHING is
///               retained (dev take structurally 0); SWEEP_MIN_ACCRUED gates the
///               trigger; and NO accrual-registration surface exists for anyone (the
///               distributor's total-drain primitive is structurally absent —
///               AMENDMENT B deleted the machinery). (A missing sweep route now SKIPS
///               the token per F-3 — the liveness shape is T8's.)
///           T5  exitBook — timelock-gated FULL capital egress: both legs (principal +
///               final fees) land at `to`, the position record is deleted, and the
///               migration cap is NEVER consumed (it removes capital, never roams it).
///           T6  AMENDMENT A band-shape disclosure: a ONE-SIDED upper-max band seeds
///               fine and emits DirectionalRange(book, tickLower, tickUpper, spotTick);
///               a spot-bracketing band emits nothing.
///           T7  ROAMER-AUDIT F-1 (CRITICAL) regression — the FUNDING GATE: a
///               permissionless migrate to a band entirely BELOW the live spot
///               (all-token1, minOuts [0,0]) must deploy ≈ the WHOLE released capital —
///               the dust credited as accounted accrual is bounded by the 0.01% sizing
///               margin. (Pre-fix the sizing used the in-range a1L formula above range
///               and credited ~97% of principal as accrual → sweepToBurn burned it.)
///               Also polices F-2: the RealizedIL mark must value BOTH fee legs.
///           T8  ROAMER-AUDIT F-3 regression — sweep LIVENESS: one unrouteable token
///               must NOT brick the whole burn tail. The routed side still burns, the
///               stuck token is skipped (SweepSkipped, reason = NoSweepRoute selector)
///               with its accrual intact, and the tail recovers on the next sweep once
///               the Safe routes it.
///           T9  ROAMER-AUDIT F-4 — the promised live TickMath cross-check: the table
///               brackets both anchor books' live slot0, stays strictly monotonic
///               across the money-path neighborhood, and matches the canonical
///               MIN_TICK anchor exactly.
///           T10 ROAMER-AUDIT F-5 — rescueToTreasury is clamped to the junk guard's
///               own rule: ONLY the unaccounted excess (raw − accountedAccrued) moves,
///               ERC-20 and native — the accounted accrual is untouchable, so a rescue
///               can never strand accounted > raw (junk-guard blindness + zero-balance
///               sweep revert). Sweep liveness is preserved after a rescue.
///
///         Fork addresses are the GOAL §STEP-0 pins (verified live 2026-09-04/06/07):
///         the custom fork PoolManager (NEVER canonical v4 — on 4663 those are scam
///         drainers), fork BalanceDelta packing amount0 HIGH / amount1 LOW, the fork
///         swap semantics POSITIVE amountSpecified = EXACT OUTPUT (QuoterProbe evidence).
///
///         RPC: the keyless public 4663 endpoint from foundry.toml ([rpc_endpoints]
///         alias "robinhood") — override with WELLSTREET_ROBINHOOD_RPC_URL (house
///         HarvesterV4Fork envOr alias-fallback pattern: RUNS in both configs). Zero
///         broadcast, zero spend: every state change lives in the local fork.
contract RoamingHarvesterForkTest is Test {
    // ------------------------------------------------------------------
    // GOAL §STEP-0 pins (live 4663 fork stack + target books)
    // ------------------------------------------------------------------
    address constant FORK_PM = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address constant STATE_VIEW = 0x0284Cb0bcbaa8B87A8AA409D0e41afA7a76355F2;
    address constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    address constant SWAP_ROUTER = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address constant DYNAMIC_HOOK = 0x06a889870C8f83640D6816319f72e2aA579b6080;

    /// @dev The burn address (AMENDMENT B: a plain transfer works with or without a
    ///      native burn()).
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    bytes32 constant SPY_USDG_POOL_ID = 0xfe2a80bb5618fd14984b92ca6d45bf5ba67443ddb1435e28b2e48df2fc1526cd;
    bytes32 constant USDG_ETH_POOL_ID = 0xbac3aa3b91584a53a579b3c999a56756e954e59247e497bad1d25a4334bde551;

    uint24 constant FEE_DYNAMIC_FLAG = 0x800000;

    uint256 constant TIMELOCK_DELAY = 48 hours + 1;
    uint32 constant EXPECTED_GAIN = 4000; // > the 3911 operating floor

    // Event signatures (the honest-ledger surface the battery decodes).
    // NOTE: vm.getRecordedLogs() DRAINS the buffer on read (forge pin, 2026-09-07) —
    // every scan below captures ONCE into an array and re-scans the array.
    bytes32 constant SIG_MIGRATION_EXECUTED =
        keccak256("MigrationExecuted(bytes32,bytes32,int24,int24,uint256,uint256,uint256,uint256,uint32,uint256,uint256,uint128)");
    bytes32 constant SIG_FEES_COLLECTED = keccak256("FeesCollected(bytes32,bytes32,uint256,uint256)");
    bytes32 constant SIG_MIGRATION_FEE = keccak256("MigrationFeeCharged(bytes32,uint256,uint256,uint32)");
    bytes32 constant SIG_REALIZED_IL = keccak256("RealizedIL(bytes32,int256,address)");
    bytes32 constant SIG_DIRECTIONAL = keccak256("DirectionalRange(bytes32,int24,int24,int24)");
    bytes32 constant SIG_BURNED = keccak256("Burned(address,uint256,uint256)");
    bytes32 constant SIG_BOOK_EXITED = keccak256("BookExited(address,bytes32,uint128,uint256,uint256)");
    bytes32 constant SIG_SWEEP_SKIPPED = keccak256("SweepSkipped(address,bytes32)");

    // Well-formed but NEVER allowlisted target key (fee 500 / ts 80 matches no
    // initialized pool — the QuoterProbe wrong-key pair; ticks ts-80-aligned so the
    // allowlist rail is what fires, not band validation).
    IPoolManagerV4.PoolKey unlistedKey =
        IPoolManagerV4.PoolKey({currency0: SPY, currency1: USDG, fee: 500, tickSpacing: 80, hooks: address(0)});
    int24 constant UNLISTED_LO = -887200; // 80 × −11090 (ts-80 aligned)
    int24 constant UNLISTED_HI = 887200; // 80 × 11090

    // The two anchor books (07 §5(iv): the SPY family is a MECHANICAL anchor only —
    // never the operating allowlist).
    IPoolManagerV4.PoolKey spyUsdgKey =
        IPoolManagerV4.PoolKey({currency0: SPY, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: address(0)});
    IPoolManagerV4.PoolKey usdgEthKey =
        IPoolManagerV4.PoolKey({currency0: address(0), currency1: USDG, fee: FEE_DYNAMIC_FLAG, tickSpacing: 10, hooks: DYNAMIC_HOOK});

    int24 constant SPY_USDG_LO = -887220; // ts-60 full-range bounds (house pin)
    int24 constant SPY_USDG_HI = 887220;
    int24 constant USDG_ETH_LO = -887270; // ts-10 full-range bounds (house pin)
    int24 constant USDG_ETH_HI = 887270;

    WellstreetTimelock timelock;
    RoamAllowlist allowlist;
    RoamingHarvester harvester;
    address treasuryAddr;

    address proposer = makeAddr("wellstreet-deployer");
    address executor = makeAddr("permissionless-executor");
    address bob = makeAddr("roam-caller");

    // Donate-accrual device state (executed by THIS contract's unlockCallback below).
    uint8 private _donateArmed;
    IPoolManagerV4.PoolKey private _donateKey;
    uint256 private _donate0;
    uint256 private _donate1;

    // ------------------------------------------------------------------
    // Setup (single fork per contract — house HarvesterV4Fork pattern)
    // ------------------------------------------------------------------

    function _rpc() internal view returns (string memory) {
        return vm.envOr("WELLSTREET_ROBINHOOD_RPC_URL", string("robinhood"));
    }

    function setUp() public {
        vm.createSelectFork(_rpc());

        assertGt(FORK_PM.code.length, 0, "fork PoolManager has no code");
        assertGt(IStateView(STATE_VIEW).getLiquidity(SPY_USDG_POOL_ID), 0, "SPY/USDG book is not live");
        (uint160 spySqrt,,,) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);
        assertGt(spySqrt, 0, "SPY/USDG book has no price");

        timelock = new WellstreetTimelock(proposer, 48 hours);
        allowlist = new RoamAllowlist(address(timelock));
        treasuryAddr = makeAddr("roam-treasury");
        harvester = new RoamingHarvester(
            address(timelock), treasuryAddr, address(allowlist),
            7 days /* MIN_HOLD operating start */, 4 /* cap operating start */,
            3911 /* MIN_EXPECTED_GAIN_BPS start */, 1000 /* migrationFeeBps start */
        );

        // Issuer-gated SPY: every fork address in a money path must be unblocked
        // (house pattern, HarvestFork.t.sol / HarvesterV4Fork.t.sol).
        _assertUnblockedSpy(address(this));
        _assertUnblockedSpy(address(timelock));
        _assertUnblockedSpy(address(harvester));
        _assertUnblockedSpy(SWAP_ROUTER);
        _assertUnblockedSpy(FORK_PM);
        _assertUnblockedSpy(QUOTER_V2);

        // Allowlist the two anchor books THROUGH the timelock (house governance rail).
        RoamAllowlist.BookMeta memory meta =
            RoamAllowlist.BookMeta({minTvlUsd1e6: 0, drainShockChecked: true, addedAt: 0});
        _queueAndExecute(
            address(allowlist), 0, abi.encodeCall(RoamAllowlist.addBook, (RoamAllowlist.PoolKey({
                currency0: SPY, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: address(0)
            }), meta))
        );
        _queueAndExecute(
            address(allowlist), 0, abi.encodeCall(RoamAllowlist.addBook, (RoamAllowlist.PoolKey({
                currency0: address(0), currency1: USDG, fee: FEE_DYNAMIC_FLAG, tickSpacing: 10, hooks: DYNAMIC_HOOK
            }), meta))
        );
        assertTrue(allowlist.isListed(SPY_USDG_POOL_ID), "SPY/USDG not allowlisted");
        assertTrue(allowlist.isListed(USDG_ETH_POOL_ID), "USDG/ETH not allowlisted");
        assertFalse(allowlist.isListed(keccak256(abi.encode(unlistedKey))), "probe key must NOT be listed");

        // Fund: USDG dealt (OZ balances layout — asserted loudly); SPY acquired via a
        // REAL v3 swap (the issuer-gated stock token is NEVER dealt — house rule);
        // native ETH dealt for the USDG/ETH book's currency0 leg.
        deal(USDG, address(this), 6000 * _dec(USDG));
        assertGt(IERC20(USDG).balanceOf(address(this)), 0, "USDG deal did not land");
        _swapV3(USDG, SPY, 500, 3000 * _dec(USDG));
        uint256 spyGot = IERC20(SPY).balanceOf(address(this));
        assertGt(spyGot, 0, "v3 swap produced no SPY");
        IERC20(SPY).transfer(address(harvester), (spyGot * 4) / 5); // 80% seed funding, 20% junk donor
        IERC20(USDG).transfer(address(harvester), 2500 * _dec(USDG));
        vm.deal(address(harvester), 2 ether);
    }

    // ------------------------------------------------------------------
    // Helpers — timelock rail / book keys / funding / sizing
    // ------------------------------------------------------------------

    /// @dev Queue through the 48h timelock (proposer) → warp past the delay →
    ///      PERMISSIONLESS execute (house trust model).
    function _queueAndExecute(address target, uint256 value, bytes memory data) internal {
        vm.prank(proposer);
        timelock.queue(target, value, data, bytes32(0));
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.prank(executor);
        timelock.execute(target, value, data, bytes32(0));
    }

    /// @dev The ABI-encoded BookKey payload the roamer's key/seed/migrate surfaces take.
    function _bookKey(IPoolManagerV4.PoolKey memory k, int24 lo, int24 hi, bytes32 salt)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(
            RoamingHarvester.BookKey({poolKey: k, tickLower: lo, tickUpper: hi, salt: salt})
        );
    }

    function _assertUnblockedSpy(address who) internal view {
        (bool ok, bytes memory ret) = SPY.staticcall(abi.encodeWithSignature("ACCESS_CONTROLLED_REGISTRY()"));
        assertTrue(ok && ret.length == 32, "cannot read SPY ACCESS_CONTROLLED_REGISTRY");
        address registry = abi.decode(ret, (address));
        assertFalse(IAccessControlsRegistryless(registry).isBlocked(who), "address is blocked on SPY");
    }

    function _dec(address token) internal view returns (uint256) {
        return 10 ** IERC20MetadataLite(token).decimals();
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

    /// @dev Full-range liquidity affordable by BOTH funded legs (90% margin — house
    ///      HarvesterV4Fork shape: amount0 ≈ L·2^96/√P, amount1 ≈ L·√P/2^96 at slot0).
    function _affordableLiquidity(uint256 funded0, uint256 funded1, uint160 sqrtP)
        internal
        pure
        returns (uint128 l)
    {
        uint256 l0 = Math.mulDiv(funded0, sqrtP, 1 << 96);
        uint256 l1 = Math.mulDiv(funded1, 1 << 96, sqrtP);
        uint256 min = l0 < l1 ? l0 : l1;
        l = uint128((min * 90) / 100);
    }

    /// @dev Seed a full-range SPY/USDG position THROUGH the timelock and return the
    ///      live position record (the roamer assigns the monotone nonce salt).
    function _seedSpyUsdgFullRange() internal returns (RoamingHarvester.Position memory pos, bytes32 kHash) {
        (uint160 sqrtP,,,) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);
        uint128 l = _affordableLiquidity(
            IERC20(SPY).balanceOf(address(harvester)), IERC20(USDG).balanceOf(address(harvester)), sqrtP
        );
        assertGt(l, 0, "computed zero affordable liquidity");
        _queueAndExecute(
            address(harvester), 0, abi.encodeCall(RoamingHarvester.seedBook, (_bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, 0), l))
        );
        kHash = harvester.openKeys(0);
        pos = harvester.positionRecord(kHash);
        assertEq(uint256(pos.salt), 1, "first seed must take the nonce-1 salt");
        assertGt(pos.liquidity, 0, "seeded position has no liquidity");
    }

    /// @dev The live position's fromKey payload (salt from the record).
    function _fromKeyOf(RoamingHarvester.Position memory pos) internal view returns (bytes memory) {
        return _bookKey(pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt);
    }

    // ------------------------------------------------------------------
    // Helpers — donate accrual (fork-only; executed via OUR unlockCallback)
    // ------------------------------------------------------------------

    function unlockCallback(bytes calldata) external returns (bytes memory) {
        require(msg.sender == FORK_PM, "fork: unlockCallback not from PM");
        if (_donateArmed == 1) {
            IPM4Donate(FORK_PM).donate(_donateKey, _donate0, _donate1, "");
            if (_donate0 > 0) _payC(_donateKey.currency0, _donate0);
            if (_donate1 > 0) _payC(_donateKey.currency1, _donate1);
        }
        return "";
    }

    function _payC(address currency, uint256 amount) internal {
        if (currency == address(0)) {
            IPoolManagerV4(FORK_PM).settle{value: amount}();
        } else {
            IPoolManagerV4(FORK_PM).sync(currency);
            IERC20(currency).transfer(FORK_PM, amount);
            IPoolManagerV4(FORK_PM).settle();
        }
    }

    function _donate(IPoolManagerV4.PoolKey memory key, uint256 a0, uint256 a1) internal {
        _donateArmed = 1;
        _donateKey = key;
        _donate0 = a0;
        _donate1 = a1;
        IPoolManagerV4(FORK_PM).unlock("");
        _donateArmed = 0;
    }

    // ------------------------------------------------------------------
    // Helpers — event scan (SINGLE-CAPTURE: vm.getRecordedLogs() drains the
    // buffer on read, so every scan consumes a pre-captured array)
    // ------------------------------------------------------------------

    function _scanCount(Vm.Log[] memory entries, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == sig) n++;
        }
    }

    function _scanHas(Vm.Log[] memory entries, bytes32 sig, bytes32 topic1) internal pure returns (bool) {
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == sig && entries[i].topics.length > 1 && entries[i].topics[1] == topic1) {
                return true;
            }
        }
        return false;
    }

    // ------------------------------------------------------------------
    // T1 — the DIRECTION-CHECK anchor mechanics, BOTH directions
    // ------------------------------------------------------------------

    function testFork_T1_seedMigrateRoundTrip_spyUsdg_usdgEth() public {
        (RoamingHarvester.Position memory pos,) = _seedSpyUsdgFullRange();
        assertEq(harvester.openKeyCount(), 1, "openKeys after seed");
        assertEq(harvester.migrationsThisPeriod(), 0, "a seed is NOT a migration");
        assertEq(uint256(pos.createdAt), block.timestamp, "creation anchor != seed time");
        assertEq(uint256(pos.lastMigrationAt), 0, "fresh seed carries a migration stamp");

        // Guardrail 1 pre-proof: an IMMEDIATE migrate is hold-locked from SEED time
        // (the ratified later-of anchor — a Safe seed is never instantly roamed).
        vm.expectRevert(
            abi.encodeWithSelector(
                RoamingHarvester.HoldLocked.selector, uint256(pos.createdAt) + 7 days, block.timestamp
            )
        );
        harvester.migrate(
            _fromKeyOf(pos), _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0), [uint256(1), uint256(1)], EXPECTED_GAIN
        );

        // Past the CREATION anchor: migrate SPY/USDG → USDG/ETH, PERMISSIONLESS (no
        // tip — a random EOA may roam, and can take nothing but the roam itself).
        vm.warp(block.timestamp + 7 days + 1);
        vm.recordLogs();
        vm.prank(bob);
        harvester.migrate(
            _fromKeyOf(pos), _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0), [uint256(1), uint256(1)], EXPECTED_GAIN
        );

        // The new position is on USDG/ETH (the dynamic-fee hook book — the hard
        // shape), with the roamer's next nonce, re-anchored at THIS migration.
        assertEq(harvester.openKeyCount(), 1, "migrate must close-then-open exactly one position");
        RoamingHarvester.Position memory pos2 = harvester.positionRecord(harvester.openKeys(0));
        assertEq(pos2.poolKey.currency0, address(0), "migrated position is not on USDG/ETH");
        assertEq(pos2.poolKey.hooks, DYNAMIC_HOOK, "dynamic hook not carried byte-exact");
        assertEq(uint256(pos2.salt), 1, "target position must take the to-book nonce-1 salt");
        assertGt(pos2.liquidity, 0, "migrated position has no liquidity");
        assertEq(uint256(pos2.createdAt), block.timestamp, "createdAt != migration time");
        assertEq(uint256(pos2.lastMigrationAt), block.timestamp, "MIN_HOLD not re-anchored at the migration");
        assertEq(harvester.migrationsThisPeriod(), 1, "rolling cap counter after migrate 1");
        assertEq(uint256(harvester.positionRecord(keccak256(abi.encode(
            pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt))).liquidity), 0, "from-position not deleted");
        // The honest-ledger event surface of ONE migration (single capture — the
        // recorded-logs buffer drains on read).
        Vm.Log[] memory logs1 = vm.getRecordedLogs();
        assertEq(_scanCount(logs1, SIG_MIGRATION_EXECUTED), 1, "MigrationExecuted not emitted");
        assertEq(_scanCount(logs1, SIG_FEES_COLLECTED), 1, "FeesCollected (harvest-before-move) not emitted");
        assertEq(_scanCount(logs1, SIG_MIGRATION_FEE), 1, "MigrationFeeCharged not emitted");
        assertEq(_scanCount(logs1, SIG_REALIZED_IL), 1, "RealizedIL (honest ledger) not emitted");
        // The migration charged the roaming take into the accounted accrual (burn tail).
        assertGt(harvester.accountedAccrued(SPY), 0, "SPY migration fee not accrued");
        assertGt(harvester.accountedAccrued(USDG), 0, "USDG migration fee not accrued");
        // A spot-bracketing full-range band is NOT directional: no disclosure event.
        assertEq(_scanCount(logs1, SIG_DIRECTIONAL), 0, "spurious DirectionalRange");

        // Past the re-anchor: migrate BACK (the reversal direction — mechanics only;
        // the BLOCK-ALL reversal ruling is an OFF-CHAIN policy check, never a revert).
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);
        harvester.migrate(
            _fromKeyOf(pos2), _bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, 0), [uint256(1), uint256(1)], EXPECTED_GAIN
        );
        assertEq(harvester.openKeyCount(), 1, "openKeys after the return migration");
        RoamingHarvester.Position memory pos3 = harvester.positionRecord(harvester.openKeys(0));
        assertEq(pos3.poolKey.currency0, SPY, "return migration is not on SPY/USDG");
        assertEq(uint256(pos3.salt), 2, "re-seeded SPY/USDG position must take nonce-2 (re-ranges count)");
        assertEq(harvester.migrationsThisPeriod(), 2, "rolling cap counter after migrate 2");
        assertGt(pos3.liquidity, 0, "return position has no liquidity");
        // The same-pool re-range COUNT ruling is proven by the counter, and the
        // 1%-allowance deployment kept the principal off the floor both ways.
        assertGt(harvester.accountedAccrued(USDG), 0, "USDG accrual after round trip");
    }

    // ------------------------------------------------------------------
    // T2 — minOut is fail-closed (atomic rollback, cap NOT consumed)
    // ------------------------------------------------------------------

    function testFork_T2_minOutFailClosed_atomicRollback() public {
        (RoamingHarvester.Position memory pos,) = _seedSpyUsdgFullRange();
        vm.warp(block.timestamp + 7 days + 1);

        bytes32 fromHash = keccak256(abi.encode(pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt));
        (uint128 liqPre, uint256 fg0Pre, uint256 fg1Pre) =
            IStateView(STATE_VIEW).getPositionInfo(SPY_USDG_POOL_ID, address(harvester), pos.tickLower, pos.tickUpper, pos.salt);

        // An unreachable deployed-amount floor reverts the WHOLE migration (the
        // deployed amount is pool-derived, so the revert is matched bare — the
        // atomic-rollback asserts below prove the failure class).
        vm.expectRevert();
        harvester.migrate(
            _fromKeyOf(pos),
            _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0),
            [uint256(1) << 200, uint256(0)],
            EXPECTED_GAIN
        );

        // Atomic rollback: the from-position (liquidity AND fee accounting) is
        // untouched, nothing was opened, and the rolling cap was NOT consumed.
        (uint128 liqPost, uint256 fg0Post, uint256 fg1Post) =
            IStateView(STATE_VIEW).getPositionInfo(SPY_USDG_POOL_ID, address(harvester), pos.tickLower, pos.tickUpper, pos.salt);
        assertEq(uint256(liqPost), uint256(liqPre), "position liquidity changed on a failed migration");
        assertEq(fg0Post, fg0Pre, "fee-growth-inside0 changed on a failed migration");
        assertEq(fg1Post, fg1Pre, "fee-growth-inside1 changed on a failed migration");
        assertEq(harvester.openKeyCount(), 1, "a failed migration left an open position");
        assertGt(uint256(harvester.positionRecord(fromHash).liquidity), 0, "from-position lost on a failed migration");
        assertEq(harvester.migrationsThisPeriod(), 0, "a REVERTED migration consumed the cap");
    }

    // ------------------------------------------------------------------
    // T3 — the 07 §1 deterministic guardrails, on-chain and fail-closed
    // ------------------------------------------------------------------

    function testFork_T3_guardrails_hold_attestation_cap_rails() public {
        (RoamingHarvester.Position memory pos,) = _seedSpyUsdgFullRange();

        // --- MIN_EXPECTED_GAIN_BPS attestation, FAIL-CLOSED (checked only past the
        //     hold, so warp first — 07 §1: absence/zero is never admitted).
        vm.warp(block.timestamp + 7 days + 1);
        vm.expectRevert(RoamingHarvester.GainAttestationMissing.selector);
        harvester.migrate(
            _fromKeyOf(pos), _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0), [uint256(1), uint256(1)], 0
        );
        vm.expectRevert(
            abi.encodeWithSelector(RoamingHarvester.GainAttestationBelowFloor.selector, uint32(3000), uint32(3911))
        );
        harvester.migrate(
            _fromKeyOf(pos), _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0), [uint256(1), uint256(1)], 3000
        );

        // --- The toKey-ONLY allowlist rail: an unlisted (well-formed) target reverts.
        //     fromKey is NEVER railed (a dead book can always be migrated OUT of).
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.UnknownPosition.selector, keccak256(abi.encode(unlistedKey))));
        harvester.migrate(_fromKeyOf(pos), _bookKey(unlistedKey, UNLISTED_LO, UNLISTED_HI, 0), [uint256(1), uint256(1)], EXPECTED_GAIN);

        // --- toKey salt MUST be zero: the roamer assigns the monotone nonce.
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.SaltMustBeZero.selector, bytes32(uint256(7))));
        harvester.migrate(
            _fromKeyOf(pos), _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, bytes32(uint256(7))), [uint256(1), uint256(1)], EXPECTED_GAIN
        );

        // --- The rolling-365d cap, Safe-settable through the timelock: 1 → exactly one
        //     migration lands, and the migration RE-ANCHOR is judged against
        //     lastMigrationAt (not the seed's createdAt — the later-of anchor).
        _queueAndExecute(address(harvester), 0, abi.encodeCall(RoamingHarvester.setMaxMigrationsPerPeriod, (1)));
        vm.prank(bob);
        harvester.migrate(
            _fromKeyOf(pos), _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0), [uint256(1), uint256(1)], EXPECTED_GAIN
        );
        assertEq(harvester.migrationsThisPeriod(), 1, "cap counter after the capped migrate");
        RoamingHarvester.Position memory pos2 = harvester.positionRecord(harvester.openKeys(0));

        // 3 days after the MIGRATION (< MIN_HOLD vs the re-anchor): the hold fires
        // first (preflight order: MIN_HOLD before the cap check; the cap is 1/1).
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(
            abi.encodeWithSelector(
                RoamingHarvester.HoldLocked.selector,
                uint256(pos2.lastMigrationAt) + 7 days,
                block.timestamp
            )
        );
        harvester.migrate(
            _fromKeyOf(pos2), _bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, 0), [uint256(1), uint256(1)], EXPECTED_GAIN
        );

        // A full MIN_HOLD window past the re-anchor STILL cannot lift the cap.
        vm.warp(block.timestamp + 4 days + 1);
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.MigrationCapReached.selector, uint256(1)));
        harvester.migrate(
            _fromKeyOf(pos2), _bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, 0), [uint256(1), uint256(1)], EXPECTED_GAIN
        );
    }

    // ------------------------------------------------------------------
    // T4 — the AMENDMENT B buyback-burn tail, live
    // ------------------------------------------------------------------

    function testFork_T4_burnPath_accountedAccrual_junkSplit_devZero() public {
        // The tail is FAIL-CLOSED INERT before the one-shot WELL init: fees accumulate,
        // never lost, never burned-by-accident.
        vm.expectRevert(RoamingHarvester.NoWellToken.selector);
        harvester.sweepToBurn();

        (RoamingHarvester.Position memory pos,) = _seedSpyUsdgFullRange();

        // Snapshot the seed leftovers (unaccounted overfunding — the house
        // force-sent-token pattern routes them to the TREASURY at sweep time).
        uint256 leftoverSpy = IERC20(SPY).balanceOf(address(harvester));
        uint256 leftoverUsdg = IERC20(USDG).balanceOf(address(harvester));

        // REAL accrual on the pool's OWN accounting: donate both legs (fork-only
        // device) — the expected share is donated * L_ours / L_total.
        uint256 donatedSpy = IERC20(SPY).balanceOf(address(this)) / 2;
        uint256 donatedUsdg = 500 * _dec(USDG);
        _donate(spyUsdgKey, donatedSpy, donatedUsdg);
        (uint256 expShare0, uint256 expShare1) = _assertDonateShares(pos.liquidity, donatedSpy, donatedUsdg);

        // WELL stand-in = USDG (the only real pool pairing with the source token —
        // the same mechanical-anchor ruling as the book itself); route = the LIVE
        // SPY/USDG book. One-shot init + route, both through the timelock.
        _configureWellAndRoute();

        // Force-sent JUNK of a KNOWN token: raw excess above the accounted accrual
        // forwards to the TREASURY — it never enters the burn stream.
        uint256 junkSpy = IERC20(SPY).balanceOf(address(this));
        IERC20(SPY).transfer(address(harvester), junkSpy);

        bytes32 fromHash = keccak256(abi.encode(pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt));
        _sweepAndAssertBurn(fromHash, junkSpy, leftoverSpy, leftoverUsdg);
        _assertSweepGate();
        _assertNoRegistrationSurface();
    }

    /// @dev The donate-share asserts (own frame for the codegen stack budget).
    function _assertDonateShares(uint128 liquidity, uint256 donatedSpy, uint256 donatedUsdg)
        internal
        view
        returns (uint256 expShare0, uint256 expShare1)
    {
        uint128 lTotal = IStateView(STATE_VIEW).getLiquidity(SPY_USDG_POOL_ID);
        expShare0 = Math.mulDiv(donatedSpy, liquidity, lTotal);
        expShare1 = Math.mulDiv(donatedUsdg, liquidity, lTotal);
        assertGt(expShare0, 0, "SPY donate share rounds to zero");
        assertGt(expShare1, 0, "USDG donate share rounds to zero");
    }

    /// @dev The one-shot WELL init + the sweep-route wiring (own frame).
    function _configureWellAndRoute() internal {
        vm.prank(address(timelock));
        vm.expectRevert(RoamingHarvester.ZeroAddress.selector);
        harvester.setWellToken(address(0));
        _queueAndExecute(address(harvester), 0, abi.encodeCall(RoamingHarvester.setWellToken, (USDG)));
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.WellTokenAlreadySet.selector, USDG));
        harvester.setWellToken(USDG); // one-shot: re-set reverts

        // NOTE (ROAMER-AUDIT F-3): the pre-fix battery asserted here that a missing
        // sweep route reverts the WHOLE sweep — that was the all-or-nothing liveness
        // finding. Post-fix an unrouteable token is SKIPPED (SweepSkipped) and the
        // tail stays live; that behavior is T8's regression subject.

        _queueAndExecute(address(harvester), 0, abi.encodeCall(RoamingHarvester.setSweepRoute, (SPY, IPoolManagerV4.PoolKey({
            currency0: SPY, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: address(0)
        }))));
    }

    /// @dev The sweep itself + the junk-split / burn / dev-zero assertions (own frame;
    ///      the Burned events are DECODED so every leg's magnitude is asserted).
    function _sweepAndAssertBurn(bytes32 fromHash, uint256 junkSpy, uint256 leftoverSpy, uint256 leftoverUsdg)
        internal
    {
        uint256 deadUsdgBefore = IERC20(USDG).balanceOf(DEAD);
        uint256 treasurySpyBefore = IERC20(SPY).balanceOf(treasuryAddr);
        uint256 treasuryUsdgBefore = IERC20(USDG).balanceOf(treasuryAddr);

        vm.recordLogs();
        harvester.sweepToBurn();

        // JUNK SPLIT: treasury SPY = the force-sent junk + the unaccounted seed
        // leftover (both raw-excess); treasury USDG = the seed leftover.
        assertEq(
            IERC20(SPY).balanceOf(treasuryAddr) - treasurySpyBefore,
            junkSpy + leftoverSpy,
            "treasury SPY != junk + seed leftover"
        );
        assertEq(
            IERC20(USDG).balanceOf(treasuryAddr) - treasuryUsdgBefore,
            leftoverUsdg,
            "treasury USDG != seed leftover"
        );

        // BURN: the accounted SPY accrual was swapped to the WELL stand-in on the live
        // book (pinned fork Quoter) and burned; the accounted USDG accrual IS the WELL
        // stand-in → burned directly. dEaD received BOTH streams, one Burned per source.
        uint256 burnedTotal = IERC20(USDG).balanceOf(DEAD) - deadUsdgBefore;
        uint256 burnedFromSpy;
        uint256 burnedDirect;
        Vm.Log[] memory entries = vm.getRecordedLogs();
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] != SIG_BURNED) continue;
            (uint256 bought, uint256 burnedAmt) = abi.decode(entries[i].data, (uint256, uint256));
            assertEq(bought, burnedAmt, "Burned bought != burned (nothing retained)");
            if (entries[i].topics[1] == bytes32(uint256(uint160(SPY)))) {
                burnedFromSpy = bought; // the pinned-Quoter swap leg
            } else if (entries[i].topics[1] == bytes32(uint256(uint160(USDG)))) {
                burnedDirect = bought; // the direct (source == WELL) leg
            }
        }
        assertGt(burnedFromSpy, 0, "the accounted SPY accrual was not swapped-to-WELL and burned");
        assertGt(burnedDirect, 0, "the direct USDG (source == WELL) leg did not burn");
        assertEq(burnedTotal, burnedFromSpy + burnedDirect, "dEaD delta != the two Burned legs");
        assertEq(_scanCount(entries, SIG_BURNED), 2, "expected one Burned per source token");

        // DEV TAKE STRUCTURALLY 0: nothing is retained anywhere — every wei of the
        // accounted revenue became burned WELL-stand-in (or sits as the exact
        // unconsumed accrual remainder), and the harvester holds no burn output.
        assertEq(IERC20(USDG).balanceOf(address(harvester)), 0, "harvester retained WELL-stand-in (dev take != 0)");
        uint256 accountedSpyAfter = harvester.accountedAccrued(SPY);
        assertEq(IERC20(SPY).balanceOf(address(harvester)), accountedSpyAfter, "raw SPY != accounted remainder");
        assertEq(harvester.accountedAccrued(USDG), 0, "USDG accrual not fully burned");
        // The position itself is untouched by the sweep (fees only, never principal).
        assertGt(uint256(harvester.positionRecord(fromHash).liquidity), 0, "sweep touched the principal");
    }

    /// @dev The SWEEP_MIN_ACCRUED trigger gate (own frame).
    function _assertSweepGate() internal {
        _queueAndExecute(address(harvester), 0, abi.encodeCall(RoamingHarvester.setSweepMinAccrued, (SPY, type(uint256).max / 2)));
        uint256 deadBefore = IERC20(USDG).balanceOf(DEAD);
        harvester.sweepToBurn();
        assertEq(IERC20(USDG).balanceOf(DEAD), deadBefore, "sweep below SWEEP_MIN_ACCRUED must not burn");
    }

    /// @dev The total-drain guard in its AMENDMENT B form: there is NO accrual-registration
    ///      surface for ANYONE (the distributor machinery was deleted, not gated) — a
    ///      registration call must fail outright, so the burn stream is only ever fed by
    ///      the harvester's own internal accounting paths.
    function _assertNoRegistrationSurface() internal {
        (bool okReg,) = address(harvester).call(abi.encodeWithSignature("registerAccrual(address,uint256)", SPY, 1e18));
        assertFalse(okReg, "an accrual-registration surface exists");
        (bool okCredit,) = address(harvester).call(abi.encodeWithSignature("creditAccrued(address,uint256)", SPY, 1e18));
        assertFalse(okCredit, "an accrual-credit surface exists");
        (bool okSet,) = address(harvester).call(abi.encodeWithSignature("setAccountedAccrued(address,uint256)", SPY, 1e18));
        assertFalse(okSet, "an accrual-setter surface exists");
    }

    // ------------------------------------------------------------------
    // T5 — exitBook: timelock-gated FULL capital egress (never a migration)
    // ------------------------------------------------------------------

    function testFork_T5_exitBook_fullEgress_neverConsumesCap() public {
        // Funded principal snapshots (the seed consumes exactly what the pool demands;
        // the rest is unaccounted overfunding that stays put through the egress).
        uint256 fundedSpy = IERC20(SPY).balanceOf(address(harvester));
        uint256 fundedUsdg = IERC20(USDG).balanceOf(address(harvester));
        (RoamingHarvester.Position memory pos,) = _seedSpyUsdgFullRange();
        bytes32 fromHash = keccak256(abi.encode(pos.poolKey, pos.tickLower, pos.tickUpper, pos.salt));
        uint256 leftoverSpy = IERC20(SPY).balanceOf(address(harvester));
        uint256 leftoverUsdg = IERC20(USDG).balanceOf(address(harvester));
        assertLt(leftoverSpy, fundedSpy, "seed consumed no SPY");
        assertLt(leftoverUsdg, fundedUsdg, "seed consumed no USDG");

        // Custody is timelock-only (house closePosition pattern).
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.NotTimelock.selector, bob));
        harvester.exitBook(_fromKeyOf(pos), treasuryAddr);

        vm.prank(address(timelock));
        vm.expectRevert(RoamingHarvester.ZeroAddress.selector);
        harvester.exitBook(_fromKeyOf(pos), address(0));

        uint256 treasurySpyBefore = IERC20(SPY).balanceOf(treasuryAddr);
        uint256 treasuryUsdgBefore = IERC20(USDG).balanceOf(treasuryAddr);
        vm.recordLogs();
        vm.prank(address(timelock));
        harvester.exitBook(_fromKeyOf(pos), treasuryAddr);

        // BOTH legs (principal + final accrued fees — zero here: no swaps on a static
        // fork) landed at `to` — the disclosed wind-down custody event. The principal
        // returned equals the principal the seed paid in (± the pool's own wei
        // rounding on the decrease leg).
        assertApproxEqAbs(
            IERC20(SPY).balanceOf(treasuryAddr) - treasurySpyBefore, fundedSpy - leftoverSpy, 10, "SPY leg != seed principal"
        );
        assertApproxEqAbs(
            IERC20(USDG).balanceOf(treasuryAddr) - treasuryUsdgBefore, fundedUsdg - leftoverUsdg, 10, "USDG leg != seed principal"
        );
        // The position record is gone; nothing NEW is stranded in the harvester.
        assertEq(uint256(harvester.positionRecord(fromHash).liquidity), 0, "exitBook left the position open");
        assertEq(harvester.openKeyCount(), 0, "openKeys not emptied by the full egress");
        assertEq(IERC20(SPY).balanceOf(address(harvester)), leftoverSpy, "SPY egress incomplete");
        assertEq(IERC20(USDG).balanceOf(address(harvester)), leftoverUsdg, "USDG egress incomplete");
        // It removes capital, never roams it: the migration cap is NEVER consumed.
        assertEq(harvester.migrationsThisPeriod(), 0, "exitBook consumed the migration cap");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertTrue(
            _scanHas(logs, SIG_BOOK_EXITED, bytes32(uint256(uint160(treasuryAddr)))),
            "BookExited (capital-egress event) not emitted"
        );

        // Unknown key reverts (no position, no egress) — with the key's REAL hash.
        bytes32 unknownHash = keccak256(abi.encode(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, bytes32(uint256(9))));
        vm.prank(address(timelock));
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.UnknownPosition.selector, unknownHash));
        harvester.exitBook(_bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, bytes32(uint256(9))), treasuryAddr);
    }

    // ------------------------------------------------------------------
    // T6 — AMENDMENT A: the directional-band disclosure surface
    // ------------------------------------------------------------------

    function testFork_T6_directionalRange_disclosure() public {
        (, int24 spotTick,,) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);

        // A ONE-SIDED upper-max band whose lower bound sits AT/ABOVE the live spot:
        // the requested band does NOT bracket the spot → DirectionalRange fires.
        int24 lower = ((spotTick / 60) + 1) * 60; // one spacing-step strictly above spot
        assertGt(lower, spotTick, "band must not bracket spot");
        assertTrue(lower <= 887220, "degenerate directional band");

        (uint160 sqrtP,,,) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);
        uint128 l = _affordableLiquidity(
            IERC20(SPY).balanceOf(address(harvester)), IERC20(USDG).balanceOf(address(harvester)), sqrtP
        );
        vm.recordLogs();
        _queueAndExecute(
            address(harvester), 0, abi.encodeCall(RoamingHarvester.seedBook, (_bookKey(spyUsdgKey, lower, 887220, 0), l))
        );
        bytes32 pid = keccak256(abi.encode(spyUsdgKey));
        // SINGLE capture (the recorded-logs buffer drains on read) — scan + decode
        // from the same array.
        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertTrue(_scanHas(entries, SIG_DIRECTIONAL, pid), "DirectionalRange not emitted for a one-sided band");

        // The disclosure carries the honest fields (spotTick outside the band).
        bool decoded;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == SIG_DIRECTIONAL && entries[i].topics[1] == pid) {
                (int24 lo, int24 hi, int24 spot) = abi.decode(entries[i].data, (int24, int24, int24));
                assertEq(lo, lower, "DirectionalRange tickLower mismatch");
                assertEq(hi, 887220, "DirectionalRange tickUpper mismatch");
                assertEq(uint256(int256(spot)), uint256(int256(spotTick)), "DirectionalRange spotTick mismatch");
                assertTrue(spot <= lo, "spot inside the disclosed band");
                decoded = true;
            }
        }
        assertTrue(decoded, "DirectionalRange event not found for field decode");

        // A spot-BRACKETING band emits nothing (the honest disclosure is directional-
        // only, never noise). Sized from the CURRENT balances (the directional seed
        // consumed the SPY leg).
        (uint160 sqrtP2,,,) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);
        uint128 l2 = _affordableLiquidity(
            IERC20(SPY).balanceOf(address(harvester)), IERC20(USDG).balanceOf(address(harvester)), sqrtP2
        );
        assertGt(l2, 0, "no affordable liquidity left for the bracketing band");
        vm.recordLogs();
        _queueAndExecute(
            address(harvester), 0,
            abi.encodeCall(RoamingHarvester.seedBook, (_bookKey(spyUsdgKey, SPY_USDG_LO, SPY_USDG_HI, 0), l2))
        );
        Vm.Log[] memory entries2 = vm.getRecordedLogs();
        assertEq(_scanCount(entries2, SIG_DIRECTIONAL), 0, "bracketing band disclosed as directional");
        assertEq(harvester.openKeyCount(), 2, "both bands open");
    }

    // ------------------------------------------------------------------
    // T7 — ROAMER-AUDIT F-1 (CRITICAL) regression — the FUNDING GATE: a
    //      permissionless migrate to a band entirely BELOW the live spot
    //      (all-token1) deploys ≈ the WHOLE released capital; the dust credited
    //      as accounted accrual is bounded by the 0.01% sizing margin. Pre-fix
    //      the above-range sizing used the in-range a1L formula and credited
    //      ~97% of principal as accrual → sweepToBurn burned it, one call, no
    //      profit needed.
    // ------------------------------------------------------------------

    function testFork_T7_aboveBandMigration_dustBoundedBySizingMargin() public {
        uint256 fundedSpy = IERC20(SPY).balanceOf(address(harvester));
        uint256 fundedUsdg = IERC20(USDG).balanceOf(address(harvester));
        (RoamingHarvester.Position memory pos,) = _seedSpyUsdgFullRange();
        uint256 principal0 = fundedSpy - IERC20(SPY).balanceOf(address(harvester));
        uint256 principal1 = fundedUsdg - IERC20(USDG).balanceOf(address(harvester));
        assertGt(principal0, 0, "no SPY principal seeded");
        assertGt(principal1, 0, "no USDG principal seeded");

        // The from-spot anchors the IL mark (read pre-migration — the close moves
        // nothing and the contract snapshots before its own conversion swaps).
        (uint160 fromSqrt, , , ) = IStateView(STATE_VIEW).getSlot0(SPY_USDG_POOL_ID);

        vm.warp(block.timestamp + 7 days + 1);

        // The EXPLOIT shape: permissionless caller, caller-supplied minOuts [0,0], and
        // a toKey on the allowlisted USDG/ETH book whose narrow band sits far BELOW the
        // live spot (band top ≈ 13.5% of spot). The shared capital (USDG) needs NO
        // deficit buy, so the sizing math alone decides deployed-vs-credited.
        (, int24 spotTick, , ) = IStateView(STATE_VIEW).getSlot0(USDG_ETH_POOL_ID);
        int24 hi = ((spotTick - 20000) / 10) * 10; // ts-10 aligned, far below the spot
        int24 lo = hi - 2000;
        assertGt(int256(lo), -887272, "band below MIN_TICK - live fork drifted");

        vm.recordLogs();
        vm.prank(bob);
        harvester.migrate(_fromKeyOf(pos), _bookKey(usdgEthKey, lo, hi, 0), [uint256(0), uint256(0)], EXPECTED_GAIN);

        Vm.Log[] memory entries = vm.getRecordedLogs();
        assertEq(_scanCount(entries, SIG_MIGRATION_EXECUTED), 1, "MigrationExecuted not emitted");
        assertTrue(_scanHas(entries, SIG_DIRECTIONAL, USDG_ETH_POOL_ID), "one-sided band must disclose DirectionalRange");
        _assertF1LedgerBounds(entries);
        _assertIlMarkBothFeeLegs(entries, principal0, principal1, fromSqrt);
    }

    /// @dev The F-1 regression tooth (own frame for the codegen stack budget): the
    ///      accounted accrual must be the take leg + dust bounded by the 0.01% sizing
    ///      margin — NEVER the principal. Identity: dust = bal1 − owed1, and the fixed
    ///      sizing sets owed1 = bal1·(BPS − SIZE_MARGIN_BPS)/BPS.
    function _assertF1LedgerBounds(Vm.Log[] memory entries) internal view {
        uint256 collected0;
        uint256 collected1;
        uint256 fee0;
        uint256 fee1;
        uint256 dep0;
        uint256 dep1;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] != SIG_MIGRATION_EXECUTED) continue;
            (, , collected0, collected1, fee0, fee1, , dep0, dep1, ) =
                abi.decode(entries[i].data, (int24, int24, uint256, uint256, uint256, uint256, uint32, uint256, uint256, uint128));
        }
        assertEq(collected0, 0, "a static fork must collect nothing");
        assertEq(collected1, 0, "a static fork must collect nothing");
        assertEq(dep0, 0, "an above-range band holds NO token0");
        assertGt(dep1, 0, "nothing deployed into the band");
        assertGt(fee1, 0, "the roaming take on the USDG leg is missing");

        uint256 sizeMarginBps = harvester.SIZE_MARGIN_BPS();
        uint256 bps = harvester.BPS();
        assertEq(sizeMarginBps, 1, "SIZE_MARGIN_BPS moved - re-derive the dust bound");
        assertEq(bps, 10000, "BPS moved - re-derive the dust bound");
        uint256 dust = harvester.accountedAccrued(USDG) - fee1;
        uint256 maxDust = Math.mulDiv(dep1, sizeMarginBps, bps - sizeMarginBps) + 1000;
        assertLe(dust, maxDust, "F-1: above-band dust exceeds the sizing margin - principal credited as accrual");
        // The funding gate in its deployed≈released form: ≥ 99.99% of the capital
        // entering the band is IN the position (pre-fix deployed ~3.6%).
        assertGe(
            dep1,
            Math.mulDiv(dep1 + dust, bps - sizeMarginBps, bps) - 1000,
            "deployed share below the sizing margin"
        );
        // Nothing else was credited: an all-token1 band owes no token0, and the SPY
        // take leg is the ONLY SPY accrual (SPY is not a to-book currency).
        assertEq(harvester.accountedAccrued(address(0)), 0, "native credited on an all-token1 band");
        assertEq(harvester.accountedAccrued(SPY), fee0, "SPY accrual != the take leg");
    }

    /// @dev The F-2 police (own frame): the RealizedIL mark must value BOTH fee legs
    ///      at the from-spot. Exact-shape recompute of the contract's mark (the close's
    ///      decrease rounding is ≤ ~10 wei — T5 — hence the 1000-wei tolerance).
    function _assertIlMarkBothFeeLegs(
        Vm.Log[] memory entries,
        uint256 principal0,
        uint256 principal1,
        uint160 fromSqrt
    ) internal pure {
        uint256 fee0;
        uint256 fee1;
        uint256 dep1;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] != SIG_MIGRATION_EXECUTED) continue;
            (, , , , fee0, fee1, , , dep1, ) =
                abi.decode(entries[i].data, (int24, int24, uint256, uint256, uint256, uint256, uint32, uint256, uint256, uint128));
        }
        // released = principal0·(fs/2^96)² + principal1 (s == USDG, the from-book c1);
        // net = deployed (dep1; dep0 == 0) + BOTH fee legs valued at the from-spot.
        uint256 released = _c0ToC1Test(principal0, fromSqrt) + principal1;
        uint256 net = dep1 + _c0ToC1Test(fee0, fromSqrt) + fee1;
        int256 expected;
        if (released >= net) {
            expected = int256(released - net);
        } else {
            expected = -int256(net - released);
        }
        int256 il;
        address ilC;
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] != SIG_REALIZED_IL) continue;
            (il, ilC) = abi.decode(entries[i].data, (int256, address));
        }
        assertEq(ilC, USDG, "IL mark not in the shared currency");
        assertApproxEqAbs(il, expected, 1000, "RealizedIL != the both-fee-leg honest mark (F-2)");
    }

    /// @dev The contract's _c0ToC1 (test-side copy for the F-2 recompute).
    function _c0ToC1Test(uint256 amt, uint160 sqrtP) internal pure returns (uint256) {
        return Math.mulDiv(Math.mulDiv(amt, sqrtP, 1 << 96), sqrtP, 1 << 96);
    }

    // ------------------------------------------------------------------
    // T8 — ROAMER-AUDIT F-3 regression — sweep LIVENESS: one unrouteable
    //      token must NOT brick the whole burn tail. The routed side still
    //      burns; the stuck token is skipped (SweepSkipped, reason = the
    //      NoSweepRoute selector) with its accrual intact; the tail recovers
    //      on the next sweep once the Safe routes it.
    // ------------------------------------------------------------------

    function testFork_T8_sweepLiveness_oneStuckTokenDoesNotBrickTail() public {
        (RoamingHarvester.Position memory pos,) = _seedSpyUsdgFullRange();
        uint256 leftoverSpy = IERC20(SPY).balanceOf(address(harvester));
        uint256 donatedSpy = IERC20(SPY).balanceOf(address(this)) / 2;
        uint256 donatedUsdg = 500 * _dec(USDG);
        _donate(spyUsdgKey, donatedSpy, donatedUsdg);
        (, uint256 share1) = _assertDonateShares(pos.liquidity, donatedSpy, donatedUsdg);

        // WELL stand-in set, but NO route for SPY — the audit's stuck-token shape
        // (the Safe merely being slow to route one fee currency).
        _queueAndExecute(address(harvester), 0, abi.encodeCall(RoamingHarvester.setWellToken, (USDG)));

        uint256 deadBefore = IERC20(USDG).balanceOf(DEAD);
        uint256 treasurySpyBefore = IERC20(SPY).balanceOf(treasuryAddr);
        vm.recordLogs();
        harvester.sweepToBurn(); // PRE-FIX this reverted NoSweepRoute(SPY): the whole tail bricked
        Vm.Log[] memory entries = vm.getRecordedLogs();

        // The ROUTED side still burned: the WELL stand-in (USDG == well) burned directly.
        assertGt(harvester.accountedAccrued(SPY), 0, "the donate share was not collected into the accrual");
        assertApproxEqAbs(IERC20(USDG).balanceOf(DEAD) - deadBefore, share1, 100, "the routed token's accrual did not burn");
        assertEq(harvester.accountedAccrued(USDG), 0, "routed accrual not consumed");

        // The STUCK token was skipped, not fatal: accrual AND junk stay put (its whole
        // pass reverted as a unit) — nothing entered or left for SPY.
        assertEq(
            IERC20(SPY).balanceOf(address(harvester)) - harvester.accountedAccrued(SPY),
            leftoverSpy,
            "skipped token's raw/accounted split disturbed"
        );
        assertEq(IERC20(SPY).balanceOf(treasuryAddr), treasurySpyBefore, "a skipped token's junk must not move while skipped");
        assertTrue(_scanHas(entries, SIG_SWEEP_SKIPPED, bytes32(uint256(uint160(SPY)))), "SweepSkipped(SPY) not emitted");
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].topics[0] == SIG_SWEEP_SKIPPED && entries[i].topics[1] == bytes32(uint256(uint160(SPY)))) {
                bytes32 reason = abi.decode(entries[i].data, (bytes32));
                assertEq(
                    reason,
                    bytes32(uint256(uint32(RoamingHarvester.NoSweepRoute.selector)) << 224),
                    "skip reason != the NoSweepRoute selector"
                );
            }
        }

        // Route it → the tail RECOVERS: the deferred accrual burns on the next sweep.
        _queueAndExecute(
            address(harvester), 0,
            abi.encodeCall(RoamingHarvester.setSweepRoute, (SPY, IPoolManagerV4.PoolKey({
                currency0: SPY, currency1: USDG, fee: 3000, tickSpacing: 60, hooks: address(0)
            })))
        );
        deadBefore = IERC20(USDG).balanceOf(DEAD);
        vm.recordLogs();
        harvester.sweepToBurn();
        entries = vm.getRecordedLogs();
        assertGt(IERC20(USDG).balanceOf(DEAD) - deadBefore, 0, "recovered SPY accrual did not burn");
        assertEq(_scanCount(entries, SIG_SWEEP_SKIPPED), 0, "no skips once the route exists");
        assertEq(
            harvester.accountedAccrued(SPY),
            IERC20(SPY).balanceOf(address(harvester)),
            "post-recovery raw != accounted remainder"
        );
    }

    // ------------------------------------------------------------------
    // T9 — ROAMER-AUDIT F-4: the promised live TickMath cross-check. The
    //      table feeds every band-sizing and price-limit computation: it must
    //      bracket both anchor books' live slot0, stay strictly monotonic
    //      across the money-path neighborhood, and match the canonical
    //      MIN_TICK anchor exactly.
    // ------------------------------------------------------------------

    function testFork_T9_tickMath_matchesLiveSlot0_bothAnchorBooks() public {
        // The canonical TickMath anchors, exactly: getSqrtRatioAtTick(MIN_TICK) ==
        // MIN_SQRT_RATIO and getSqrtRatioAtTick(MAX_TICK) == MAX_SQRT_RATIO (both
        // standard constant values — probed 2026-09-07).
        assertEq(uint256(harvester.sqrtRatioAtTick(-887272)), 4295128739, "MIN_TICK anchor != canonical TickMath MIN_SQRT_RATIO");
        assertEq(
            uint256(harvester.sqrtRatioAtTick(887272)),
            1461446703485210103287273052203988822378723970342,
            "MAX_TICK anchor != canonical TickMath MAX_SQRT_RATIO"
        );
        _assertTableBracketsLive(SPY_USDG_POOL_ID);
        _assertTableBracketsLive(USDG_ETH_POOL_ID);
    }

    function _assertTableBracketsLive(bytes32 pid) internal view {
        (uint160 sqrtP, int24 tick, , ) = IStateView(STATE_VIEW).getSlot0(pid);
        assertGt(sqrtP, 0, "pool has no live price");
        // getTickAtSqrtRatio floors the tick: table(tick) <= live < table(tick + 1).
        assertLe(uint256(harvester.sqrtRatioAtTick(tick)), uint256(sqrtP), "table(tick) > live sqrtP");
        assertLt(uint256(sqrtP), uint256(harvester.sqrtRatioAtTick(tick + 1)), "live sqrtP >= table(tick+1)");
        // Strict local monotonicity around the live price.
        uint160 prev = harvester.sqrtRatioAtTick(tick);
        for (int24 t = tick + 1; t <= tick + 100; t++) {
            uint160 cur = harvester.sqrtRatioAtTick(t);
            assertGt(uint256(cur), uint256(prev), "table not strictly increasing");
            prev = cur;
        }
    }

    // ------------------------------------------------------------------
    // T10 — ROAMER-AUDIT F-5: rescueToTreasury is clamped to the junk guard's
    //       own rule — ONLY the unaccounted excess (raw − accountedAccrued)
    //       moves, ERC-20 AND native. The accounted accrual is untouchable, so
    //       a rescue can never strand accounted > raw (junk-guard blindness +
    //       zero-balance sweep revert), and sweep liveness survives a rescue.
    // ------------------------------------------------------------------

    function testFork_T10_rescueToTreasury_respectsAccountedAccrual() public {
        // Custody: timelock-only (house closePosition pattern).
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RoamingHarvester.NotTimelock.selector, bob));
        harvester.rescueToTreasury(SPY);

        // --- Seed, donate, sweep with NO routes: the donate shares are COLLECTED into
        //     the accounted ledger; SPY is skipped (no route) with accrual + junk
        //     intact; USDG (== the WELL stand-in) burns directly.
        (RoamingHarvester.Position memory pos,) = _seedSpyUsdgFullRange();
        uint256 leftoverSpy = IERC20(SPY).balanceOf(address(harvester));
        uint256 donatedSpy = IERC20(SPY).balanceOf(address(this)) / 2;
        uint256 donatedUsdg = 500 * _dec(USDG);
        _donate(spyUsdgKey, donatedSpy, donatedUsdg);
        _assertDonateShares(pos.liquidity, donatedSpy, donatedUsdg);
        _queueAndExecute(address(harvester), 0, abi.encodeCall(RoamingHarvester.setWellToken, (USDG)));
        harvester.sweepToBurn();
        uint256 accSpy = harvester.accountedAccrued(SPY);
        assertGt(accSpy, 0, "donate share not collected");
        assertEq(IERC20(SPY).balanceOf(address(harvester)) - accSpy, leftoverSpy, "raw/accounted split after the skipped sweep");

        // --- ERC-20 clamp: the rescue forwards ONLY the unaccounted excess.
        uint256 treasurySpyBefore = IERC20(SPY).balanceOf(treasuryAddr);
        vm.prank(address(timelock));
        harvester.rescueToTreasury(SPY);
        assertEq(
            IERC20(SPY).balanceOf(treasuryAddr) - treasurySpyBefore,
            leftoverSpy,
            "rescue forwarded != the UNACCOUNTED excess (F-5)"
        );
        assertEq(harvester.accountedAccrued(SPY), accSpy, "rescue touched the accounted accrual (F-5)");
        assertEq(IERC20(SPY).balanceOf(address(harvester)), accSpy, "post-rescue raw != accounted");

        // --- Native clamp: roam to the native book, donate native, collect via the
        //     sweep (no native route → skipped, accrual intact) — then rescue: ONLY
        //     raw − accounted moves.
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(bob);
        harvester.migrate(
            _fromKeyOf(pos), _bookKey(usdgEthKey, USDG_ETH_LO, USDG_ETH_HI, 0), [uint256(1), uint256(1)], EXPECTED_GAIN
        );
        vm.deal(address(this), 10 ether);
        _donate(usdgEthKey, 5 ether, 0);
        harvester.sweepToBurn(); // collects the native donate share; no native route → skipped
        uint256 accNat = harvester.accountedAccrued(address(0));
        assertGt(accNat, 0, "native donate share not collected");
        vm.deal(address(harvester), address(harvester).balance + 1 ether);
        uint256 rawNatPre = address(harvester).balance;
        uint256 treasuryNatBefore = treasuryAddr.balance;
        vm.prank(address(timelock));
        harvester.rescueToTreasury(address(0));
        assertEq(treasuryAddr.balance - treasuryNatBefore, rawNatPre - accNat, "native rescue forwarded != raw minus accounted (F-5)");
        assertEq(harvester.accountedAccrued(address(0)), accNat, "native rescue touched the accounted accrual (F-5)");
        assertEq(address(harvester).balance, accNat, "post-rescue native raw != accounted");

        // --- Liveness preserved after a rescue: the sweep still runs end-to-end.
        harvester.sweepToBurn();
    }
}

/// @dev Minimal registry read surface (self-contained, house HarvesterV4Fork pattern).
interface IAccessControlsRegistryless {
    function isBlocked(address account) external view returns (bool);
}
