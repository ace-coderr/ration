// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Test, Vm} from "forge-std/Test.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {RationHub} from "../src/RationHub.sol";
import {RationVault} from "../src/RationVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockSystem} from "./mocks/MockSystem.sol";

/// @dev Shared fixture: a hub on a mocked system contract and two vaults on two "chains".
///      The test plays the role of the Reactive Network: it relays vault logs to the hub and
///      delivers (or drops, repeats, reorders) the callbacks the hub requests.
abstract contract Base is Test {
    address constant SYSTEM_ADDR = 0x8888888888888888888888888888888888888888;
    uint256 constant CHAIN_A = 84532;
    uint256 constant CHAIN_B = 1301;
    address constant PROXY_A = address(0xA0A0);
    address constant PROXY_B = address(0xB0B0);

    uint256 public constant BUDGET = 1000e6;
    uint256 constant EPOCH = 7 days;

    MockSystem public sys;
    RationHub public hub;
    RationVault public vaultA;
    RationVault public vaultB;
    MockUSDC public usdc;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);
    address shop = address(0x5409);

    uint256 delivered; // cursor into the callback queue

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        MockSystem impl = new MockSystem();
        vm.etch(SYSTEM_ADDR, address(impl).code);
        sys = MockSystem(payable(SYSTEM_ADDR));

        hub = new RationHub(100);
        vaultA = new RationVault(IPayable(payable(PROXY_A)), address(hub), 6);
        vaultB = new RationVault(IPayable(payable(PROXY_B)), address(hub), 6);
        usdc = new MockUSDC();

        hub.registerVault(CHAIN_A, address(vaultA), 5000, 2000);
        hub.registerVault(CHAIN_B, address(vaultB), 5000, 2000);
        hub.setConfig(BUDGET, EPOCH, 2500, 300, 1);

        for (uint256 i = 0; i < 2; i++) {
            RationVault v = i == 0 ? vaultA : vaultB;
            v.setToken(address(usdc), true);
            v.setSpender(alice, true, 0);
            usdc.faucet(address(this), 1000e6);
            usdc.approve(address(v), type(uint256).max);
            v.deposit(address(usdc), 1000e6);
        }

        vm.recordLogs();
        hub.startEpoch();
        _deliverAll(); // resets reach both vaults
    }

    // ---------------------------------------------------------------- network simulation

    function _chainOf(address v) internal view returns (uint256) {
        return v == address(vaultA) ? CHAIN_A : CHAIN_B;
    }

    /// @dev Feed every new vault log to the hub, as the network would.
    function _relayLogs() internal {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            Vm.Log memory l = logs[i];
            if (l.emitter != address(vaultA) && l.emitter != address(vaultB)) continue;
            _feed(l);
        }
    }

    function _feed(Vm.Log memory l) internal {
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: _chainOf(l.emitter),
            contractAddress: l.emitter,
            topic0: uint256(l.topics[0]),
            topic1: l.topics.length > 1 ? uint256(l.topics[1]) : 0,
            topic2: l.topics.length > 2 ? uint256(l.topics[2]) : 0,
            topic3: l.topics.length > 3 ? uint256(l.topics[3]) : 0,
            data: l.data,
            blockNumber: block.number,
            opCode: l.topics.length,
            blockHash: 0,
            txHash: uint256(keccak256(abi.encode(l.data, l.topics))),
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
    }

    /// @dev Deliver callback request `i` the way a callback proxy would. Returns whether it succeeded.
    function _deliver(uint256 i) internal returns (bool ok) {
        MockSystem.Req memory r = sys.get(i);
        bytes memory p = r.payload;
        address sender = r.sender;
        assembly {
            mstore(add(p, 36), sender) // the proxy injects the reactive sender as first argument
        }
        address proxy = r.recipient == address(vaultA) ? PROXY_A : PROXY_B;
        vm.prank(proxy);
        (ok,) = r.recipient.call(p);
        _relayLogs();
    }

    /// @dev Deliver everything queued so far in order, including requests created along the way.
    function _deliverAll() internal {
        _relayLogs();
        while (delivered < sys.count()) {
            uint256 i = delivered++;
            _deliver(i);
        }
    }

    function _spend(RationVault v, uint256 amount) internal {
        vm.prank(alice);
        v.spend(address(usdc), shop, amount);
        _relayLogs();
    }

    function _sumSlices() internal view returns (uint256) {
        return vaultA.slice() + vaultB.slice();
    }

    function _sumSpent() internal view returns (uint256) {
        return vaultA.spentInEpoch() + vaultB.spentInEpoch();
    }

    function _lastTransferId() internal view returns (bytes32) {
        return keccak256(abi.encode(address(hub), block.chainid, hub.nonce()));
    }

    function _cron() internal {
        IReactive.LogRecord memory rec = IReactive.LogRecord({
            chainId: block.chainid,
            contractAddress: 0x0000000000000000000000000000000000fffFfF,
            topic0: 0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70,
            topic1: 0,
            topic2: 0,
            topic3: 0,
            data: abi.encode(block.number),
            blockNumber: block.number,
            opCode: 1,
            blockHash: 0,
            txHash: 0,
            logIndex: 0
        });
        vm.prank(SYSTEM_ADDR);
        hub.react(rec);
    }
}
