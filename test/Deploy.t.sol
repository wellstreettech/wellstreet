// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldShares} from "../src/YieldShares.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {Harvester} from "../src/Harvester.sol";
import {WellstreetTimelock} from "../src/WellstreetTimelock.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockPositionManager} from "./mocks/MockPositionManager.sol";
import {MockRouter, MockQuoter} from "./mocks/MockSwaps.sol";

/// @notice Verifies the exact wiring sequence script/Deploy.s.sol performs
///         (timelock -> factory -> vault -> harvester -> queued setHarvester), then
///         proves the end state: after the 48h window the harvester is wired, and a
///         real LP position received by the harvester flows fee income into the vault.
/// @dev The script itself is broadcast-only (never executed here — no deploys, no key
///      material); this test replicates its steps with mocks standing in for the
///      verified 4663 contracts.
contract DeployWiringTest is Test {
    address proposer = makeAddr("wellstreet-deployer");
    address pauser = makeAddr("pause-eoa");

    function test_deployWiring_endToEnd() public {
        // 1. Timelock: 48h, single proposer, executor open.
        vm.prank(proposer);
        WellstreetTimelock timelock = new WellstreetTimelock(proposer, 172800);
        assertEq(timelock.delay(), 48 hours);
        assertEq(timelock.proposer(), proposer);

        // 2. Factory with the timelock, pause-only EOA and initial fee.
        VaultFactory factory = new VaultFactory(address(timelock), pauser, 1000);

        // 3. The canonical vault: name/symbol pinned exactly as the script pins them.
        MockERC20 spy = new MockERC20("SPY", "SPY");
        address vault = factory.createVault(address(spy), "Wellstreet SPY", "ws-SPY");
        assertEq(YieldShares(vault).name(), "Wellstreet SPY");
        assertEq(YieldShares(vault).symbol(), "ws-SPY");
        assertEq(YieldShares(vault).feeBps(), 1000);
        assertEq(YieldShares(vault).pauser(), pauser);

        // 4. Harvester configured for the tier-500 pool, treasury = the timelock.
        MockERC20 weth = new MockERC20("WETH", "WETH");
        MockPositionManager npm = new MockPositionManager();
        MockRouter router = new MockRouter();
        MockQuoter quoter = new MockQuoter();
        Harvester harvester = new Harvester(
            vault, address(timelock), address(timelock), address(spy), address(weth), 500,
            address(npm), address(router), address(quoter)
        );
        assertEq(harvester.poolFee(), 500);
        assertEq(harvester.treasury(), address(timelock));

        // 5. setHarvester is timelock-only: queue it like the script does.
        vm.prank(proposer);
        bytes32 id = timelock.queue(
            vault, 0, abi.encodeCall(YieldShares.setHarvester, (address(harvester))), bytes32(0)
        );
        assertEq(timelock.readyAt(id), block.timestamp + 48 hours);
        // Not wired until the delay passes:
        assertEq(YieldShares(vault).harvester(), address(0));

        // 48h later anyone lands the queued call.
        vm.warp(block.timestamp + 48 hours);
        timelock.execute(vault, 0, abi.encodeCall(YieldShares.setHarvester, (address(harvester))), bytes32(0));
        assertEq(YieldShares(vault).harvester(), address(harvester));

        // 6. (Launch-prep step the script leaves out) the LP position arrives and fees
        //    flow: collect -> swap -> 90% into the vault, 10% accrued for the treasury.
        uint256 tokenId = npm.mintPosition(address(weth), address(spy), 500, proposer);
        vm.prank(proposer);
        npm.safeTransferFrom(proposer, address(harvester), tokenId);
        weth.mint(address(npm), 1e18);
        spy.mint(address(npm), 2e18);
        npm.seedFees(tokenId, 1e18, 2e18);
        spy.mint(address(router), 1_000_000e18);

        harvester.harvest();

        assertEq(YieldShares(vault).totalAssets(), 2_701.8e18); // 90% of 3002e18
        assertEq(harvester.protocolAccrued(), 297.198e18); // 10% minus the 0.1% tip
        vm.prank(makeAddr("anyone"));
        harvester.sweepToTreasury();
        assertEq(spy.balanceOf(address(timelock)), 297.198e18); // treasury custody
    }
}
