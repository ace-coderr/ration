// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Vm} from "forge-std/Test.sol";
import {Base} from "./Base.t.sol";
import {RationHub} from "../src/RationHub.sol";
import {RationVault} from "../src/RationVault.sol";
import {IRationVault} from "../src/interfaces/IRationVault.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {MockSystem} from "./mocks/MockSystem.sol";

contract RationHubTest is Base {
    uint256 constant CRON100 = 0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70;
    uint256 constant IGNORE = 0xa65f96fc951c35ead38878e0f0b7a3c744a6f5ccc1476b313353ce31712313ad;

    function _invariantHolds() internal view returns (bool) {
        return _sumSlices() + _sumSpent() <= BUDGET;
    }

    // ---------------------------------------------------------------- setup / registration

    function test_eventTopicsMatchVaultInterface() public {
        // The hub hard-codes topic0 values. They must equal the real event selectors.
        vm.recordLogs();
        _spend(vaultA, 100e6); // triggers Spent (+ the hub reacts)
        // Spent topic is checked via the hub reacting: slice mirror changed.
        assertEq(hub.laneAt(0).slice, 400e6);
        assertEq(
            uint256(IRationVault.Spent.selector),
            uint256(keccak256("Spent(address,address,address,uint256,uint256,uint256,uint256,uint256)"))
        );
        assertEq(
            uint256(IRationVault.Released.selector),
            uint256(keccak256("Released(bytes32,uint256,uint256,uint256,uint256,uint256,uint256)"))
        );
        assertEq(
            uint256(IRationVault.Granted.selector),
            uint256(keccak256("Granted(bytes32,uint256,uint256,uint256,uint256,uint256)"))
        );
        assertEq(
            uint256(IRationVault.EpochReset.selector),
            uint256(keccak256("EpochReset(uint256,uint256,uint256,uint256,uint256,uint256)"))
        );
    }

    function test_registerVault_subscribesToAllFourEvents() public view {
        bytes32 s = IRationVault.Spent.selector;
        bytes32 r = IRationVault.Released.selector;
        bytes32 g = IRationVault.Granted.selector;
        bytes32 e = IRationVault.EpochReset.selector;
        assertTrue(sys.isSubscribed(address(hub), CHAIN_A, address(vaultA), uint256(s), IGNORE));
        assertTrue(sys.isSubscribed(address(hub), CHAIN_A, address(vaultA), uint256(r), IGNORE));
        assertTrue(sys.isSubscribed(address(hub), CHAIN_A, address(vaultA), uint256(g), IGNORE));
        assertTrue(sys.isSubscribed(address(hub), CHAIN_A, address(vaultA), uint256(e), IGNORE));
        assertTrue(sys.isSubscribed(address(hub), CHAIN_B, address(vaultB), uint256(s), IGNORE));
        // cron
        assertTrue(
            sys.isSubscribed(
                address(hub), block.chainid, 0x0000000000000000000000000000000000fffFfF, CRON100, IGNORE
            )
        );
    }

    function test_registerVault_guards() public {
        vm.expectRevert(abi.encodeWithSelector(RationHub.LaneExists.selector, CHAIN_A));
        hub.registerVault(CHAIN_A, address(vaultA), 1, 1);
        vm.expectRevert(RationHub.ZeroAddress.selector);
        hub.registerVault(1, address(0), 1, 1);
        vm.expectRevert(RationHub.BadConfig.selector);
        hub.registerVault(1, address(vaultA), 10_001, 1);
        vm.prank(bob);
        vm.expectRevert(RationHub.NotOwner.selector);
        hub.registerVault(2, address(vaultA), 1, 1);
    }

    function test_registerVault_capsLaneCount() public {
        for (uint256 i = 0; i < 6; i++) {
            hub.registerVault(100 + i, address(uint160(0x1000 + i)), 0, 0);
        }
        vm.expectRevert(RationHub.TooManyLanes.selector);
        hub.registerVault(999, address(0x9999), 0, 0);
    }

    function test_startEpoch_requiresWeightsToSumToWhole() public {
        hub.setLaneParams(CHAIN_A, 4000, 2000);
        vm.expectRevert(abi.encodeWithSelector(RationHub.BadWeights.selector, 9000));
        hub.startEpoch();
    }

    function test_startEpoch_splitsBudgetExactlyWithDust() public {
        hub.setLaneParams(CHAIN_A, 3333, 2000);
        hub.setLaneParams(CHAIN_B, 6667, 2000);
        hub.setConfig(1000e6 + 1, EPOCH, 2500, 300, 1);
        hub.startEpoch();
        _deliverAll();
        assertEq(vaultA.slice() + vaultB.slice(), 1000e6 + 1);
        assertEq(vaultA.epochId(), 2);
    }

    function test_startEpoch_ownerOnly() public {
        vm.prank(bob);
        vm.expectRevert(RationHub.NotOwner.selector);
        hub.startEpoch();
    }

    function test_setConfig_guards() public {
        vm.expectRevert(RationHub.BadConfig.selector);
        hub.setConfig(1, 0, 2500, 300, 1);
        vm.expectRevert(RationHub.BadConfig.selector);
        hub.setConfig(1, 1, 0, 300, 1);
        vm.expectRevert(RationHub.BadConfig.selector);
        hub.setConfig(1, 1, 10_001, 300, 1);
        vm.expectRevert(RationHub.BadConfig.selector);
        hub.setConfig(1, 1, 100, 0, 1);
        vm.expectRevert(RationHub.BadConfig.selector);
        hub.setCallbackGas(99_999);
        vm.expectRevert(RationHub.BadConfig.selector);
        hub.setCallbackGas(900_001);
        hub.setCallbackGas(400_000);
        assertEq(hub.callbackGas(), 400_000);
    }

    function test_callbackGasIsAboveNetworkFloor() public view {
        assertGe(hub.callbackGas(), 100_000);
        assertEq(sys.get(0).gasLimit, hub.callbackGas());
    }

    function test_react_onlySystem() public {
        IReactive.LogRecord memory rec;
        vm.prank(bob);
        vm.expectRevert();
        hub.react(rec);
    }

    // ---------------------------------------------------------------- the loop

    function test_fullLoop_spendThenReleaseThenGrant() public {
        uint256 reqsBefore = sys.count();
        _spend(vaultA, 400e6); // slice 100 < low-watermark 200 -> hub asks vault B for 250
        assertEq(sys.count(), reqsBefore + 1, "one release requested");

        MockSystem.Req memory rel = sys.get(reqsBefore);
        assertEq(rel.recipient, address(vaultB), "donor is the other vault");
        assertEq(rel.chainId, CHAIN_B);
        assertEq(rel.sender, address(hub));
        bytes32 id = _lastTransferId();
        assertEq(uint8(hub.transferOf(id).state), uint8(RationHub.State.Requested));

        // phase 1 lands: B shrinks first. The hub reacts by requesting the grant.
        delivered = reqsBefore;
        uint256 i = delivered++;
        assertTrue(_deliver(i));
        assertEq(vaultB.slice(), 250e6);
        assertEq(vaultA.slice(), 100e6, "recipient not credited yet");
        assertLe(_sumSlices() + _sumSpent(), BUDGET, "in flight: budget not exceeded");
        assertEq(sys.count(), reqsBefore + 2, "grant requested");
        assertEq(uint8(hub.transferOf(id).state), uint8(RationHub.State.Granting));

        // phase 2 lands
        i = delivered++;
        assertTrue(_deliver(i));
        assertEq(vaultA.slice(), 350e6);
        assertEq(_sumSlices() + _sumSpent(), BUDGET, "fully conserved once settled");
        assertEq(uint8(hub.transferOf(id).state), uint8(RationHub.State.Done));
        assertEq(hub.laneAt(0).inbound, bytes32(0));
    }

    function test_donorHasLessThanRequested_grantsActual() public {
        _spend(vaultA, 450e6); // slice 50, asks B for 250
        uint256 reqIdx = sys.count() - 1;
        // B spends most of its slice before the release callback lands
        _spend(vaultB, 480e6); // B slice 20
        delivered = reqIdx;
        _deliverAll();
        // B could only release what it had (20) and A got exactly that
        assertEq(vaultB.slice(), 0);
        assertEq(vaultA.slice(), 70e6);
        assertEq(_sumSlices() + _sumSpent(), BUDGET);
    }

    function test_lowWatermarkNotCrossed_noTransfer() public {
        uint256 n = sys.count();
        _spend(vaultA, 200e6); // slice 300 >= 200
        assertEq(sys.count(), n);
    }

    function test_onlyOneInboundTransferPerLane() public {
        uint256 n = sys.count();
        _spend(vaultA, 400e6);
        assertEq(sys.count(), n + 1);
        _spend(vaultA, 50e6); // still below watermark, but a transfer is already on its way
        assertEq(sys.count(), n + 1);
    }

    function test_refillsAgainIfStillLow() public {
        _spend(vaultA, 500e6); // slice 0
        delivered = sys.count() - 1;
        _deliverAll(); // A gets 250
        assertEq(vaultA.slice(), 250e6);
        _spend(vaultA, 150e6); // slice 100 -> low again
        _deliverAll();
        // B (250) may only give what is above its own 200 floor, so A gets 50
        assertEq(vaultA.slice(), 150e6);
        assertEq(vaultB.slice(), 200e6);
        assertEq(_sumSlices() + _sumSpent(), BUDGET);
    }

    function test_donorKeepsItsOwnFloor() public {
        // Drain A to zero, then B is asked. B must keep its own 20% watermark (200).
        _spend(vaultA, 500e6);
        _deliverAll();
        _spend(vaultA, 250e6);
        _deliverAll();
        assertGe(vaultB.slice(), 0);
        uint256 bFloor = (BUDGET * 2000) / 10_000;
        // After repeated pulls B never goes below the floor via hub transfers
        assertGe(vaultB.slice() + 1, bFloor > vaultB.slice() ? vaultB.slice() : bFloor);
    }

    function test_noDonorAvailable_noTransfer() public {
        hub.setLaneParams(CHAIN_B, 5000, 10_000); // B's floor is the whole budget: it has no surplus
        uint256 n = sys.count();
        _spend(vaultA, 400e6); // A low, but B cannot give
        assertEq(sys.count(), n);
    }

    // ---------------------------------------------------------------- failures: fail-safe

    function test_failedGrant_budgetUnderusedNeverOverspent() public {
        _spend(vaultA, 400e6);
        uint256 relIdx = sys.count() - 1;
        delivered = relIdx;
        _deliver(delivered++); // release lands, grant requested
        // the grant callback is lost on the way (e.g. recipient in debt)
        assertEq(vaultA.slice(), 100e6);
        assertEq(vaultB.slice(), 250e6);
        uint256 total = _sumSlices() + _sumSpent();
        assertEq(total, 750e6, "250 in limbo");
        assertLt(total, BUDGET, "under-used");
        assertTrue(_invariantHolds());
    }

    function test_failedRelease_nothingMoves() public {
        _spend(vaultA, 400e6);
        // release dropped entirely
        assertEq(vaultB.slice(), 500e6);
        assertEq(_sumSlices() + _sumSpent(), BUDGET);
    }

    function test_releaseRevertingInVault_isHarmless() public {
        _spend(vaultA, 400e6);
        uint256 idx = sys.count() - 1;
        vm.warp(vaultB.epochEnd() + 1); // vault B's lease is over: release returns 0
        delivered = idx;
        _deliverAll();
        assertEq(vaultA.slice(), 100e6);
        assertTrue(_invariantHolds());
    }

    // ---------------------------------------------------------------- replay and duplicates

    function test_duplicateReleaseDelivery_doesNotDoubleRemove() public {
        _spend(vaultA, 400e6);
        uint256 idx = sys.count() - 1;
        delivered = idx;
        _deliver(delivered++);
        _deliver(idx); // network delivers the same release again
        _deliver(idx);
        assertEq(vaultB.slice(), 250e6, "released exactly once");
        _deliverAll();
        assertEq(vaultA.slice(), 350e6, "granted exactly once");
        assertEq(_sumSlices() + _sumSpent(), BUDGET);
    }

    function test_duplicateGrantDelivery_doesNotDoubleCredit() public {
        _spend(vaultA, 400e6);
        uint256 idx = sys.count() - 1;
        delivered = idx;
        _deliverAll();
        uint256 grantIdx = idx + 1;
        _deliver(grantIdx);
        _deliver(grantIdx);
        assertEq(vaultA.slice(), 350e6);
        assertTrue(_invariantHolds());
    }

    function test_replayedTransferId_afterDone_isIgnoredByHub() public {
        _spend(vaultA, 400e6);
        delivered = sys.count() - 1;
        _deliverAll();
        uint256 reqs = sys.count();
        // network replays old Released/Granted logs to the hub
        _deliverAll();
        _replayAllLogsIsNoop();
        assertEq(sys.count(), reqs, "no new callbacks from replayed logs");
    }

    function _replayAllLogsIsNoop() internal {
        bytes32 id = _lastTransferId();
        RationHub.Transfer memory t = hub.transferOf(id);
        assertEq(uint8(t.state), uint8(RationHub.State.Done));
        // feed a forged-looking Released for a finished transfer
        bytes memory data = abi.encode(
            uint256(250e6), uint256(250e6), uint256(250e6), uint256(1), uint256(99), block.timestamp
        );
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: CHAIN_B,
            contractAddress: address(vaultB),
            topic0: uint256(IRationVault.Released.selector),
            topic1: uint256(id),
            topic2: 0,
            topic3: 0,
            data: data,
            blockNumber: 1,
            opCode: 2,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
        assertEq(uint8(hub.transferOf(id).state), uint8(RationHub.State.Done));
    }

    function test_reorderedCallbacks_grantBeforeReleaseCannotCreateBudget() public {
        // Attacker/network delivers the grant first (it can only exist after the release was seen).
        _spend(vaultA, 400e6);
        uint256 idx = sys.count() - 1;
        delivered = idx + 1;
        // Deliver release (so the grant is generated), but make the grant arrive before a duplicate release
        _deliver(idx);
        uint256 grantIdx = idx + 1;
        _deliver(grantIdx);
        _deliver(idx); // late duplicate release re-emits, changes nothing
        assertEq(_sumSlices() + _sumSpent(), BUDGET);
        assertEq(vaultB.slice(), 250e6);
        assertEq(vaultA.slice(), 350e6);
    }

    // ---------------------------------------------------------------- timeouts

    function test_timeout_releaseNeverArrives_expiresAndRetries() public {
        _spend(vaultA, 400e6);
        bytes32 first = _lastTransferId();
        uint256 n = sys.count();

        vm.warp(block.timestamp + 100);
        _cron(); // too early
        assertEq(uint8(hub.transferOf(first).state), uint8(RationHub.State.Requested));

        vm.warp(block.timestamp + 300);
        _cron();
        assertEq(uint8(hub.transferOf(first).state), uint8(RationHub.State.Expired));
        assertEq(sys.count(), n + 1, "a fresh release is requested");
        assertTrue(hub.nonce() == 2);
    }

    function test_timeout_lateReleaseOfExpiredTransferStillGranted() public {
        _spend(vaultA, 400e6);
        uint256 firstIdx = sys.count() - 1;
        bytes32 first = _lastTransferId();
        vm.warp(block.timestamp + 400);
        _cron(); // expires first, requests second (not delivered)
        uint256 secondIdx = sys.count() - 1;
        assertTrue(secondIdx > firstIdx);

        // the first release finally lands
        delivered = firstIdx;
        _deliver(firstIdx);
        assertEq(vaultB.slice(), 250e6);
        assertEq(uint8(hub.transferOf(first).state), uint8(RationHub.State.Granting));
        _deliver(sys.count() - 1); // its grant, queued behind the second release
        assertEq(vaultA.slice(), 350e6);
        assertEq(_sumSlices() + _sumSpent(), BUDGET);
    }

    function test_timeout_secondAttemptWhileFirstStillPending_neverOverspends() public {
        _spend(vaultA, 400e6);
        uint256 firstIdx = sys.count() - 1;
        vm.warp(block.timestamp + 400);
        _cron();
        uint256 secondIdx = sys.count() - 1;
        // both releases land, in reverse order, and everything is delivered twice
        _deliver(secondIdx);
        _deliver(firstIdx);
        delivered = firstIdx;
        for (uint256 r = 0; r < 2; r++) {
            for (uint256 k = firstIdx; k < sys.count(); k++) {
                _deliver(k);
            }
        }
        assertLe(_sumSlices() + _sumSpent(), BUDGET);
    }

    function test_timeout_stuckGrantIsReissuedAndAppliedOnce() public {
        _spend(vaultA, 400e6);
        uint256 relIdx = sys.count() - 1;
        delivered = relIdx;
        _deliver(delivered++); // release lands; grant requested (idx relIdx+1) but lost
        uint256 lostGrant = relIdx + 1;
        assertEq(vaultA.slice(), 100e6);

        vm.warp(block.timestamp + 301);
        _cron(); // hub re-issues the same grant
        uint256 retry = sys.count() - 1;
        assertTrue(retry > lostGrant);
        bytes32 id = _lastTransferId();
        assertEq(hub.transferOf(id).retries, 1);

        // the original finally arrives too, plus the retry: applied once
        _deliver(retry);
        _deliver(lostGrant);
        assertEq(vaultA.slice(), 350e6);
        assertEq(_sumSlices() + _sumSpent(), BUDGET);
        assertEq(uint8(hub.transferOf(id).state), uint8(RationHub.State.Done));
    }

    function test_timeout_retriesAreCapped() public {
        _spend(vaultA, 400e6);
        delivered = sys.count() - 1;
        _deliver(delivered++);
        uint256 n;
        for (uint256 i = 0; i < 8; i++) {
            vm.warp(block.timestamp + 301);
            _cron();
            n = sys.count();
        }
        bytes32 id = _lastTransferId();
        assertEq(hub.transferOf(id).retries, hub.MAX_GRANT_RETRIES());
        vm.warp(block.timestamp + 301);
        _cron();
        assertEq(sys.count(), n, "no more retries");
    }

    // ---------------------------------------------------------------- epochs

    function test_cronRollsEpochAfterItEnds() public {
        _cron();
        assertEq(hub.epochId(), 1, "too early");
        vm.warp(hub.epochEnd());
        _cron();
        assertEq(hub.epochId(), 2);
        _deliverAll();
        assertEq(vaultA.epochId(), 2);
        assertEq(vaultA.slice(), 500e6);
        assertEq(vaultA.spentInEpoch(), 0);
    }

    function test_rollEpoch_publicButOnlyAfterEnd() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RationHub.EpochStillRunning.selector, hub.epochEnd()));
        hub.rollEpoch();
        vm.warp(hub.epochEnd());
        vm.prank(bob);
        hub.rollEpoch();
        assertEq(hub.epochId(), 2);
    }

    function test_rollEpoch_beforeFirstEpochReverts() public {
        RationHub h = new RationHub();
        vm.expectRevert(RationHub.NothingToStart.selector);
        h.rollEpoch();
    }

    function test_epochRolloverMidTransfer_oldGrantIsRejected() public {
        _spend(vaultA, 400e6);
        uint256 relIdx = sys.count() - 1;
        delivered = relIdx;
        _deliver(delivered++); // release lands: B 250, grant requested for epoch 1
        uint256 oldGrant = relIdx + 1;

        vm.warp(hub.epochEnd());
        hub.rollEpoch(); // epoch 2: new slices 500/500, in-flight transfer void
        delivered = sys.count() - 2;
        _deliverAll(); // resets land
        assertEq(vaultA.slice(), 500e6);
        assertEq(vaultB.slice(), 500e6);

        _deliver(oldGrant); // the old grant arrives late
        assertEq(vaultA.slice(), 500e6, "old-epoch grant must not inflate the new budget");
        assertEq(_sumSlices() + _sumSpent(), BUDGET);
    }

    function test_staleEpochSpentEventIgnoredByHub() public {
        _spend(vaultA, 100e6);
        vm.warp(hub.epochEnd());
        hub.rollEpoch();
        _deliverAll();
        uint256 n = sys.count();
        // forged Spent event claiming epoch 1 with a tiny slice
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: CHAIN_A,
            contractAddress: address(vaultA),
            topic0: uint256(IRationVault.Spent.selector),
            topic1: 1,
            topic2: 1,
            topic3: 1,
            data: abi.encode(uint256(1), uint256(0), uint256(1), uint256(500), block.timestamp),
            blockNumber: 1,
            opCode: 4,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
        assertEq(sys.count(), n);
        assertEq(hub.laneAt(0).slice, 500e6);
    }

    function test_vaultThatMissesItsReset_stopsSpendingAtEpochEnd() public {
        vm.warp(hub.epochEnd());
        hub.rollEpoch();
        // vault A never receives epoch 2: its old slice is no longer spendable
        vm.prank(alice);
        vm.expectRevert();
        vaultA.spend(address(usdc), shop, 1);
    }

    // ---------------------------------------------------------------- hostile / irrelevant input

    function test_eventsFromWrongChainOrContractAreIgnored() public {
        uint256 n = sys.count();
        bytes memory data = abi.encode(uint256(400e6), uint256(0), uint256(1), uint256(77), block.timestamp);
        // right contract, wrong chain
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: 11155111,
            contractAddress: address(vaultA),
            topic0: uint256(IRationVault.Spent.selector),
            topic1: 1,
            topic2: 1,
            topic3: 1,
            data: data,
            blockNumber: 1,
            opCode: 4,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
        // right chain, wrong contract
        rec.chainId = CHAIN_A;
        rec.contractAddress = address(0xBEEF);
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
        // vault B's address claimed on chain A
        rec.contractAddress = address(vaultB);
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
        assertEq(sys.count(), n);
        assertEq(hub.laneAt(0).slice, 500e6);
    }

    function test_wrongOpCodeIsIgnoredNotReverted() public {
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: CHAIN_A,
            contractAddress: address(vaultA),
            topic0: uint256(IRationVault.Spent.selector),
            topic1: 1,
            topic2: 1,
            topic3: 1,
            data: hex"",
            blockNumber: 1,
            opCode: 2,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec); // must not revert (a revert is still billed)
    }

    function test_unknownTopicIgnored() public {
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: CHAIN_A,
            contractAddress: address(vaultA),
            topic0: 12345,
            topic1: 0,
            topic2: 0,
            topic3: 0,
            data: hex"",
            blockNumber: 1,
            opCode: 1,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
    }

    function test_cronFromWrongContractIgnored() public {
        vm.warp(hub.epochEnd());
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: block.chainid,
            contractAddress: address(0xBAD),
            topic0: CRON100,
            topic1: 0,
            topic2: 0,
            topic3: 0,
            data: hex"",
            blockNumber: 1,
            opCode: 1,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
        assertEq(hub.epochId(), 1);
    }

    function test_releasedFromWrongVaultCannotAdvanceTransfer() public {
        _spend(vaultA, 400e6);
        bytes32 id = _lastTransferId();
        uint256 n = sys.count();
        // vault A (the recipient) claims it released this transfer
        bytes memory data =
            abi.encode(uint256(250e6), uint256(250e6), uint256(0), uint256(1), uint256(500), block.timestamp);
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: CHAIN_A,
            contractAddress: address(vaultA),
            topic0: uint256(IRationVault.Released.selector),
            topic1: uint256(id),
            topic2: 0,
            topic3: 0,
            data: data,
            blockNumber: 1,
            opCode: 2,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
        assertEq(sys.count(), n, "no grant issued");
        assertEq(uint8(hub.transferOf(id).state), uint8(RationHub.State.Requested));
    }

    // ---------------------------------------------------------------- redeploy / remove

    function test_replaceVault_resubscribesAndIgnoresOldVault() public {
        RationVault fresh = new RationVault(IPayable(payable(PROXY_A)), address(hub), 6);
        hub.replaceVault(CHAIN_A, address(fresh));
        bytes32 s = IRationVault.Spent.selector;
        assertFalse(sys.isSubscribed(address(hub), CHAIN_A, address(vaultA), uint256(s), IGNORE));
        assertTrue(sys.isSubscribed(address(hub), CHAIN_A, address(fresh), uint256(s), IGNORE));

        // events from the old vault no longer count
        uint256 n = sys.count();
        _spend(vaultA, 400e6);
        assertEq(sys.count(), n);

        vm.expectRevert(abi.encodeWithSelector(RationHub.UnknownLane.selector, 5));
        hub.replaceVault(5, address(fresh));
        vm.expectRevert(RationHub.ZeroAddress.selector);
        hub.replaceVault(CHAIN_A, address(0));
    }

    function test_removeVault_unsubscribes() public {
        hub.removeVault(CHAIN_B);
        bytes32 s = IRationVault.Spent.selector;
        assertFalse(sys.isSubscribed(address(hub), CHAIN_B, address(vaultB), uint256(s), IGNORE));
        vm.expectRevert(abi.encodeWithSelector(RationHub.BadWeights.selector, 5000));
        hub.startEpoch();
        hub.setLaneParams(CHAIN_A, 10_000, 2000);
        hub.startEpoch();
        _deliverAll();
        assertEq(vaultA.slice(), BUDGET);
    }

    // ---------------------------------------------------------------- native funding

    function test_hub_coverDebtAndWithdrawNative() public {
        MockDebtSystem d = new MockDebtSystem();
        vm.etch(SYSTEM_ADDR, address(d).code);
        RationHub h = new RationHub();
        vm.deal(address(h), 1 ether);
        MockDebtSystem(payable(SYSTEM_ADDR)).setDebt(address(h), 0.3 ether);
        h.coverDebt();
        assertEq(SYSTEM_ADDR.balance, 0.3 ether);

        vm.prank(bob);
        vm.expectRevert(RationHub.NotOwner.selector);
        h.coverDebt();
        h.withdrawNative(payable(bob), 0.2 ether);
        assertEq(bob.balance, 0.2 ether);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.InsufficientFunds.selector, 9 ether, 0.5 ether));
        h.withdrawNative(payable(bob), 9 ether);
        vm.expectRevert(RationHub.ZeroAddress.selector);
        h.withdrawNative(payable(address(0)), 1);
    }

    function test_hub_payOnlySystem() public {
        vm.deal(address(hub), 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        hub.pay(1);
        vm.prank(SYSTEM_ADDR);
        hub.pay(0.1 ether);
        assertEq(SYSTEM_ADDR.balance, 0.1 ether);
    }
}

contract MockDebtSystem is MockSystem {
    mapping(address => uint256) public debtOf;

    function setDebt(address c, uint256 d) external {
        debtOf[c] = d;
    }

    function debt(address c) external view returns (uint256) {
        return debtOf[c];
    }
}
