// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Base} from "./Base.t.sol";
import {RationHub} from "../src/RationHub.sol";
import {RationVault} from "../src/RationVault.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";

/// @dev The promise under test: an old slice and a new slice are never spendable at the same time,
///      whether a period ends on its own or the owner starts a new one early.
contract EpochChangeTest is Base {
    function _live(RationVault v) internal view returns (bool) {
        return block.timestamp >= v.epochStart() && block.timestamp < v.epochEnd();
    }

    function _noOverlap() internal view {
        if (_live(vaultA) && _live(vaultB)) assertEq(vaultA.epochId(), vaultB.epochId(), "two live periods");
    }

    // ---------------------------------------------------------------- forced start

    function test_forcedStart_waitsForEveryVaultToClose() public {
        uint256 n = sys.count();
        hub.startEpoch();
        assertTrue(hub.closing());
        assertEq(hub.epochId(), 1, "new period not begun yet");
        assertEq(sys.count(), n + 2, "only the two close requests");

        _deliver(n); // vault A closes
        assertFalse(_live(vaultA));
        assertTrue(_live(vaultB), "B is still on the old period");
        assertEq(sys.count(), n + 2, "no new slices while B is open");
        _noOverlap();

        _deliver(n + 1); // vault B closes: now the hub may issue new slices
        assertFalse(hub.closing());
        assertEq(hub.epochId(), 2);
        assertEq(sys.count(), n + 4);
        _noOverlap();

        _deliver(n + 2);
        _deliver(n + 3);
        delivered = sys.count();
        assertEq(vaultA.epochId(), 2);
        assertFalse(_live(vaultA), "new slice waits for the start delay");
        _noOverlap();

        _afterStart();
        assertTrue(_live(vaultA) && _live(vaultB));
        assertEq(vaultA.slice() + vaultB.slice(), BUDGET);
        _spend(vaultA, 10e6);
    }

    function test_forcedStart_closesInEitherOrder() public {
        uint256 n = sys.count();
        hub.startEpoch();
        _deliver(n + 1); // B first
        assertFalse(_live(vaultB));
        assertTrue(_live(vaultA));
        _noOverlap();
        assertEq(hub.epochId(), 1);
        _deliver(n); // then A
        assertEq(hub.epochId(), 2);
        _noOverlap();
    }

    function test_forcedStart_repeatedCloseDeliveryChangesNothing() public {
        uint256 n = sys.count();
        hub.startEpoch();
        _deliver(n);
        _deliver(n);
        _deliver(n);
        assertTrue(hub.closing());
        assertEq(hub.epochId(), 1);
        _deliver(n + 1);
        assertEq(hub.epochId(), 2);
        uint256 after_ = sys.count();
        _deliver(n + 1); // late duplicate: the hub is no longer closing
        assertEq(sys.count(), after_);
        assertEq(hub.epochId(), 2);
    }

    function test_forcedStart_lostCloseFallsBackToTheNaturalEnd() public {
        uint256 n = sys.count();
        hub.startEpoch();
        _deliver(n); // only A closes; B's close is lost
        _cron();
        assertTrue(hub.closing(), "still waiting for B");
        assertEq(hub.epochId(), 1);
        _noOverlap();

        vm.warp(hub.epochEnd()); // old period ends on its own: B's slice expires by time
        _cron();
        assertEq(hub.epochId(), 2);
        assertFalse(hub.closing());
        _noOverlap();
    }

    function test_forcedStart_cannotStartTwice() public {
        hub.startEpoch();
        vm.expectRevert(RationHub.AlreadyClosing.selector);
        hub.startEpoch();
    }

    function test_forcedStart_badWeightsRevertsBeforeClosing() public {
        hub.setLaneParams(CHAIN_A, 4000, 2000);
        uint256 n = sys.count();
        vm.expectRevert(abi.encodeWithSelector(RationHub.BadWeights.selector, 9000));
        hub.startEpoch();
        assertFalse(hub.closing());
        assertEq(sys.count(), n, "nothing was closed");
    }

    function test_closingStopsRebalancing() public {
        hub.startEpoch();
        uint256 n = sys.count();
        _spend(vaultA, 400e6); // A is still live and now low
        assertEq(sys.count(), n, "no transfer while closing");
    }

    function test_forcedStart_ownerOnly() public {
        vm.prank(bob);
        vm.expectRevert(RationHub.NotOwner.selector);
        hub.startEpoch();
    }

    function test_forcedStartAfterNaturalEnd_isImmediate() public {
        vm.warp(hub.epochEnd());
        hub.startEpoch();
        assertFalse(hub.closing());
        assertEq(hub.epochId(), 2);
    }

    function test_closeThenWeightsBrokenThenFixed_cronFinishesTheStart() public {
        uint256 n = sys.count();
        hub.startEpoch();
        hub.setLaneParams(CHAIN_A, 4000, 2000); // broken after the request
        _deliver(n);
        _deliver(n + 1);
        assertTrue(hub.closing(), "held back, not reverted");
        assertEq(hub.epochId(), 1);

        hub.setLaneParams(CHAIN_A, 5000, 2000);
        _cron();
        assertFalse(hub.closing());
        assertEq(hub.epochId(), 2);
    }

    // ---------------------------------------------------------------- cron never reverts on weights

    function test_cronWithBadWeights_doesNotRevertAndDoesNotStart() public {
        hub.setLaneParams(CHAIN_A, 4000, 2000);
        vm.warp(hub.epochEnd());
        _cron(); // must not revert
        assertEq(hub.epochId(), 1);

        hub.setLaneParams(CHAIN_A, 5000, 2000);
        _cron();
        assertEq(hub.epochId(), 2);
    }

    function test_rollEpochWithBadWeights_revertsForTheCaller() public {
        hub.setLaneParams(CHAIN_A, 4000, 2000);
        vm.warp(hub.epochEnd());
        vm.expectRevert(abi.encodeWithSelector(RationHub.BadWeights.selector, 9000));
        hub.rollEpoch();
    }

    // ---------------------------------------------------------------- vault side

    function test_resetTopicMatches_hubMirrorFollowsResets() public view {
        assertGt(hub.laneAt(0).lastSeq, 0);
        assertGt(hub.laneAt(1).lastSeq, 0);
    }

    function test_newSlice_notSpendableBeforeStart() public {
        vm.warp(hub.epochEnd());
        hub.rollEpoch();
        _deliverAll();
        uint256 start = vaultA.epochStart();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RationVault.EpochNotStarted.selector, start, block.timestamp));
        vaultA.spend(address(usdc), shop, 1e6);
        _afterStart();
        _spend(vaultA, 1e6);
    }

    function test_resetEpoch_startIsNeverBeforeThisVaultsOldLeaseEnds() public {
        uint256 oldEnd = vaultA.epochEnd();
        vm.prank(PROXY_A);
        vaultA.resetEpoch(address(hub), 100e6, 2, block.timestamp, block.timestamp + 5 days, BUDGET);
        assertEq(vaultA.epochStart(), oldEnd, "clamped up to the old lease end");
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RationVault.EpochNotStarted.selector, oldEnd, block.timestamp));
        vaultA.spend(address(usdc), shop, 1e6);
    }

    function test_closeEpoch_stopsSpendingAndIsIdempotent() public {
        vm.startPrank(PROXY_A);
        vaultA.closeEpoch(address(hub), 1);
        vaultA.closeEpoch(address(hub), 1);
        vm.stopPrank();
        assertEq(vaultA.epochEnd(), block.timestamp);
        assertEq(vaultA.slice(), 0);
        vm.prank(alice);
        vm.expectRevert();
        vaultA.spend(address(usdc), shop, 1e6);
        // allowance can no longer leave or arrive
        vm.startPrank(PROXY_A);
        vaultA.release(address(hub), 10e6, bytes32(uint256(3)), 1);
        vaultA.grant(address(hub), 10e6, bytes32(uint256(4)), 1);
        vm.stopPrank();
        assertEq(vaultA.slice(), 0);
    }

    function test_closeEpoch_wrongEpochIsIgnored() public {
        uint256 end = vaultA.epochEnd();
        vm.prank(PROXY_A);
        vaultA.closeEpoch(address(hub), 9);
        assertEq(vaultA.epochEnd(), end);
        assertEq(vaultA.slice(), 500e6);
    }

    function test_closeEpoch_auth() public {
        vm.prank(bob);
        vm.expectRevert();
        vaultA.closeEpoch(address(hub), 1);
        vm.prank(PROXY_A);
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, bob, address(hub))
        );
        vaultA.closeEpoch(bob, 1);
        vm.prank(PROXY_B);
        vm.expectRevert();
        vaultA.closeEpoch(address(hub), 1);
    }

    function test_setStartDelay() public {
        hub.setStartDelay(30);
        assertEq(hub.startDelay(), 30);
        vm.expectRevert(RationHub.BadConfig.selector);
        hub.setStartDelay(1 hours + 1);
        vm.prank(bob);
        vm.expectRevert(RationHub.NotOwner.selector);
        hub.setStartDelay(1);
    }

    function test_clockSkew_vaultBehindTheHubStillNeverOverlaps() public {
        // The hub decides at its time T; a vault whose own clock lags still cannot spend the new slice
        // before its own old lease ended, because start is clamped to that lease.
        vm.warp(hub.epochEnd());
        hub.rollEpoch();
        uint256 pending = sys.count();
        vm.warp(block.timestamp - 3); // vault chain clock 3s behind the hub's decision
        _deliver(pending - 2);
        _deliver(pending - 1);
        _noOverlap();
        assertFalse(_live(vaultA), "old lease has ended and the new one has not started");
    }
}
