// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {WellstreetTimelock} from "../src/WellstreetTimelock.sol";

contract TimelockSink {
    uint256 public lastValue;
    uint256 public lastNumber;
    bool public broken = true;

    function ping(uint256 number) external payable {
        lastValue = msg.value;
        lastNumber = number;
    }

    function boom() external payable {
        if (broken) revert("sink boom");
    }

    function unbreak() external {
        broken = false;
    }
}

contract WellstreetTimelockTest is Test {
    WellstreetTimelock timelock;
    TimelockSink sink;

    address proposer = makeAddr("wellstreet-deployer");
    address anyone = makeAddr("anyone");

    function setUp() public {
        timelock = new WellstreetTimelock(proposer, 48 hours);
        sink = new TimelockSink();
    }

    function _queuedId() internal returns (bytes32 id, bytes memory data) {
        data = abi.encodeCall(TimelockSink.ping, (7));
        vm.prank(proposer);
        id = timelock.queue(address(sink), 1 ether, data, bytes32(0));
        vm.deal(proposer, 1 ether);
        vm.prank(proposer);
        (bool ok,) = address(timelock).call{value: 1 ether}("");
        assertTrue(ok);
    }

    // ---- constructor ----

    function test_constructor_pinsProposerAndDelay() public view {
        assertEq(timelock.proposer(), proposer);
        assertEq(timelock.delay(), 48 hours);
    }

    function test_constructor_rejectsDelayBelow48h() public {
        vm.expectRevert(
            abi.encodeWithSelector(WellstreetTimelock.DelayTooShort.selector, 47 hours, 48 hours)
        );
        new WellstreetTimelock(proposer, 47 hours);
    }

    function test_constructor_rejectsZeroProposer() public {
        vm.expectRevert(WellstreetTimelock.ZeroAddress.selector);
        new WellstreetTimelock(address(0), 48 hours);
    }

    function test_constructor_accepts48hExactly() public {
        vm.prank(proposer);
        WellstreetTimelock t = new WellstreetTimelock(proposer, 48 hours);
        assertEq(t.delay(), 48 hours);
    }

    // ---- queue ----

    function test_queue_onlyProposer() public {
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.NotProposer.selector, anyone));
        timelock.queue(address(sink), 0, "", bytes32(0));
    }

    function test_queue_setsReadyAtAndEmits() public {
        bytes memory data = abi.encodeCall(TimelockSink.ping, (1));
        vm.prank(proposer);
        bytes32 id = timelock.queue(address(sink), 0, data, bytes32(0));
        assertEq(timelock.readyAt(id), block.timestamp + 48 hours);
        assertEq(id, timelock.hashCall(address(sink), 0, data, bytes32(0)));
    }

    function test_queue_duplicateReverts() public {
        (bytes32 id,) = _queuedId();
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.AlreadyQueued.selector, id));
        timelock.queue(address(sink), 1 ether, abi.encodeCall(TimelockSink.ping, (7)), bytes32(0));
    }

    function test_queue_saltDifferentiatesIdenticalCalls() public {
        bytes memory data = abi.encodeCall(TimelockSink.ping, (7));
        vm.startPrank(proposer);
        timelock.queue(address(sink), 0, data, bytes32(uint256(1)));
        timelock.queue(address(sink), 0, data, bytes32(uint256(2)));
        vm.stopPrank();
    }

    // ---- execute ----

    function test_execute_beforeDelayReverts() public {
        (bytes32 id,) = _queuedId();
        vm.warp(block.timestamp + 48 hours - 1);
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.NotReady.selector, id, block.timestamp + 1));
        timelock.execute(address(sink), 1 ether, abi.encodeCall(TimelockSink.ping, (7)), bytes32(0));
    }

    function test_execute_unqueuedReverts() public {
        bytes32 id = timelock.hashCall(address(sink), 0, "", bytes32(0));
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.NotQueued.selector, id));
        timelock.execute(address(sink), 0, "", bytes32(0));
    }

    function test_execute_isPermissionlessAfterDelay() public {
        (bytes32 id, bytes memory data) = _queuedId();
        vm.warp(block.timestamp + 48 hours);
        vm.prank(anyone); // executor is OPEN — not the proposer
        timelock.execute(address(sink), 1 ether, data, bytes32(0));
        assertEq(sink.lastNumber(), 7);
        assertEq(sink.lastValue(), 1 ether);
        assertEq(timelock.readyAt(id), 0); // consumed
    }

    function test_execute_cannotReplay() public {
        (, bytes memory data) = _queuedId();
        vm.warp(block.timestamp + 48 hours);
        timelock.execute(address(sink), 1 ether, data, bytes32(0));
        vm.prank(anyone);
        vm.expectRevert();
        timelock.execute(address(sink), 1 ether, data, bytes32(0));
    }

    function test_execute_failingCallStaysQueuedAndRetryable() public {
        // A reverting target rolls the whole execute tx back — the queue entry is NOT
        // consumed, so a transiently failing call stays queued and can be retried.
        bytes memory data = abi.encodeCall(TimelockSink.boom, ());
        vm.prank(proposer);
        bytes32 id = timelock.queue(address(sink), 0, data, bytes32(0));
        uint256 ready = block.timestamp + 48 hours;
        vm.warp(ready);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.ExecutionFailed.selector, id));
        timelock.execute(address(sink), 0, data, bytes32(0));
        assertEq(timelock.readyAt(id), ready); // still queued

        // The target fixed itself (its own bug) -> the retry lands.
        sink.unbreak();
        timelock.execute(address(sink), 0, data, bytes32(0));
        assertEq(timelock.readyAt(id), 0);
    }

    // ---- cancel ----

    function test_cancel_byProposer() public {
        (bytes32 id,) = _queuedId();
        vm.prank(proposer);
        timelock.cancel(id);
        assertEq(timelock.readyAt(id), 0);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.NotQueued.selector, id));
        timelock.execute(address(sink), 1 ether, abi.encodeCall(TimelockSink.ping, (7)), bytes32(0));
    }

    function test_cancel_onlyProposer() public {
        (bytes32 id,) = _queuedId();
        vm.prank(anyone);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.NotProposer.selector, anyone));
        timelock.cancel(id);
    }

    function test_cancel_unqueuedReverts() public {
        vm.prank(proposer);
        vm.expectRevert(abi.encodeWithSelector(WellstreetTimelock.NotQueued.selector, bytes32(0)));
        timelock.cancel(bytes32(0));
    }
}
