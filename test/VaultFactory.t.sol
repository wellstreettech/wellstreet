// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldShares} from "../src/YieldShares.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {WellstreetTimelock} from "../src/WellstreetTimelock.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

contract VaultFactoryTest is Test {
    VaultFactory factory;
    WellstreetTimelock timelock;
    MockERC20 spy;
    MockERC20 nvda;

    address proposer = makeAddr("wellstreet-deployer");
    address pauser = makeAddr("pause-eoa");
    address alice = makeAddr("alice");

    function setUp() public {
        vm.prank(proposer);
        timelock = new WellstreetTimelock(proposer, 48 hours);
        factory = new VaultFactory(address(timelock), pauser, 1000);
        spy = new MockERC20("SPY", "SPY");
        nvda = new MockERC20("NVDA", "NVDA");
    }

    function test_createVault_wiresConstructorArgs() public {
        vm.prank(alice); // permissionless creation
        address vault = factory.createVault(address(spy), "Wellstreet SPY", "ws-SPY");

        assertEq(factory.vaultOfAsset(address(spy)), vault);
        assertEq(factory.allVaults()[0], vault);
        assertEq(factory.allVaultsLength(), 1);

        YieldShares v = YieldShares(vault);
        assertEq(v.name(), "Wellstreet SPY");
        assertEq(v.symbol(), "ws-SPY");
        assertEq(v.asset(), address(spy));
        assertEq(v.timelock(), address(timelock));
        assertEq(v.pauser(), pauser);
        assertEq(v.feeBps(), 1000);
    }

    function test_createVault_oneVaultPerAsset() public {
        vm.prank(alice);
        address first = factory.createVault(address(spy), "Wellstreet SPY", "ws-SPY");
        vm.expectRevert(abi.encodeWithSelector(VaultFactory.VaultAlreadyExists.selector, address(spy)));
        vm.prank(alice);
        factory.createVault(address(spy), "Duplicate", "dup");

        // A different asset is fine, and the registry keeps both.
        vm.prank(alice);
        address second = factory.createVault(address(nvda), "Wellstreet NVDA", "ws-NVDA");
        assertTrue(first != second);
        assertEq(factory.vaultOfAsset(address(nvda)), second);
        assertEq(factory.allVaultsLength(), 2);
    }

    function test_createVault_registryReadableByAnyone() public {
        vm.prank(alice);
        factory.createVault(address(spy), "Wellstreet SPY", "ws-SPY");
        // Public registry read: mapping getter + full list.
        address[] memory list = factory.allVaults();
        assertEq(list.length, 1);
        assertEq(list[0], factory.vaultOfAsset(address(spy)));
    }

    function test_createVault_rejectsZeroAsset() public {
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        factory.createVault(address(0), "x", "x");
    }

    function test_factory_overCapFeeFailsAtVaultConstruction() public {
        // The cap is enforced by the vault's own constructor: an over-cap factory
        // config can never produce a live vault.
        VaultFactory bad = new VaultFactory(address(timelock), pauser, 2001);
        vm.expectRevert(abi.encodeWithSelector(YieldShares.FeeTooHigh.selector, 2001, 2000));
        bad.createVault(address(spy), "x", "x");
        assertEq(bad.allVaultsLength(), 0); // registry untouched by the failed creation
    }

    function test_factory_constructorRejectsZeroTimelock() public {
        vm.expectRevert(VaultFactory.ZeroAddress.selector);
        new VaultFactory(address(0), pauser, 1000);
    }
}
