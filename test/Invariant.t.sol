// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Base} from "./Base.t.sol";

/// @dev Random actor. Every function is one move of a hostile network and a busy spender:
///      spend on either vault, deliver ANY queued callback (so: reordered and duplicated),
///      never deliver some (dropped), let time pass, tick cron, roll the epoch.
contract Handler is Base {
    mapping(uint256 => uint256) public ghostSpent; // epochId => total actually spent
    uint256 public spends;
    uint256 public deliveries;
    uint256 public rolls;
    uint256 public forced;

    function init() external {
        setUp();
    }

    function spend(uint256 vaultSeed, uint256 amount) external {
        vaultSeed %= 2;
        amount = bound(amount, 1, 400e6);
        address v = vaultSeed == 0 ? address(vaultA) : address(vaultB);
        uint256 ep = vaultSeed == 0 ? vaultA.epochId() : vaultB.epochId();
        vm.prank(alice);
        (bool ok,) =
            v.call(abi.encodeWithSignature("spend(address,address,uint256)", address(usdc), shop, amount));
        if (ok) {
            ghostSpent[ep] += amount;
            spends++;
        }
        _relayLogs();
    }

    /// @dev Any index, any number of times, in any order.
    function deliver(uint256 seed) external {
        uint256 n = sys.count();
        if (n == 0) return;
        _deliver(seed % n);
        deliveries++;
    }

    /// @dev Deliver the oldest pending request in order (the well-behaved network).
    function deliverNext() external {
        if (delivered < sys.count()) {
            _deliver(delivered++);
            deliveries++;
        }
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 3 days));
    }

    function cron() external {
        _cron();
    }

    /// @dev The owner starts a new period early, at a random moment, possibly while one is already closing.
    function forceStart() external {
        if (!hub.closing()) {
            hub.startEpoch();
            forced++;
        }
    }

    function roll() external {
        if (block.timestamp >= hub.epochEnd()) {
            hub.rollEpoch();
            rolls++;
        }
    }
}

contract InvariantTest is StdInvariant, Test {
    Handler h;

    function setUp() public {
        h = new Handler();
        h.init();
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](7);
        sel[0] = Handler.spend.selector;
        sel[1] = Handler.deliver.selector;
        sel[2] = Handler.deliverNext.selector;
        sel[3] = Handler.warp.selector;
        sel[4] = Handler.cron.selector;
        sel[5] = Handler.roll.selector;
        sel[6] = Handler.forceStart.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// @dev THE invariant. For the epoch a vault is in, the slices of all vaults in that epoch
    ///      plus everything spent in it never exceed the budget, whatever the network did.
    function invariant_sumOfSlicesPlusSpentNeverExceedsBudget() public view {
        (uint256 eA, uint256 sA, uint256 spA) =
            (h.vaultA().epochId(), h.vaultA().slice(), h.vaultA().spentInEpoch());
        (uint256 eB, uint256 sB, uint256 spB) =
            (h.vaultB().epochId(), h.vaultB().slice(), h.vaultB().spentInEpoch());
        if (eA == eB) {
            assertLe(sA + spA + sB + spB, h.BUDGET(), "same epoch: slices + spent exceed budget");
        } else {
            assertLe(sA + spA, h.BUDGET(), "vault A over budget");
            assertLe(sB + spB, h.BUDGET(), "vault B over budget");
        }
    }

    /// @dev Real spending, measured independently of the contracts' own counters.
    function invariant_totalActuallySpentPerEpochWithinBudget() public view {
        uint256 last = h.hub().epochId();
        for (uint256 e = 1; e <= last; e++) {
            assertLe(h.ghostSpent(e), h.BUDGET(), "spent more than the budget in one epoch");
        }
    }

    /// @dev A slice is spendable only inside [start, end). Two vaults can never be inside that window
    ///      for different periods at the same time, however the owner and the network behave.
    function invariant_neverTwoLiveEpochsAtOnce() public view {
        bool liveA = block.timestamp >= h.vaultA().epochStart() && block.timestamp < h.vaultA().epochEnd();
        bool liveB = block.timestamp >= h.vaultB().epochStart() && block.timestamp < h.vaultB().epochEnd();
        if (liveA && liveB) {
            assertEq(h.vaultA().epochId(), h.vaultB().epochId(), "two periods spendable at once");
        }
    }

    function invariant_vaultLocalBound() public view {
        assertLe(h.vaultA().slice() + h.vaultA().spentInEpoch(), h.vaultA().epochBudget());
        assertLe(h.vaultB().slice() + h.vaultB().spentInEpoch(), h.vaultB().epochBudget());
    }

    function invariant_hubNeverAheadOfVaults() public view {
        // the hub's epoch is the newest; vaults only trail it
        assertLe(h.vaultA().epochId(), h.hub().epochId());
        assertLe(h.vaultB().epochId(), h.hub().epochId());
    }
}
