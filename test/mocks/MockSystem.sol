// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";

/// @dev Stand-in for the Reactive system contract. Etched at 0x8888... in tests. Records
///      subscriptions and callback requests so tests can deliver, drop, reorder or repeat them.
contract MockSystem {
    struct Req {
        address sender;
        uint256 chainId;
        address recipient;
        uint64 gasLimit;
        bytes payload;
    }

    Req[] internal _reqs;
    mapping(bytes32 => bool) public subscribed;
    uint256 public subscribeCalls;
    uint256 public unsubscribeCalls;

    function subscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) external {
        subscribed[keccak256(abi.encode(msg.sender, c, a, t0, t1, t2, t3))] = true;
        subscribeCalls++;
    }

    function unsubscribe(uint256 c, address a, uint256 t0, uint256 t1, uint256 t2, uint256 t3) external {
        subscribed[keccak256(abi.encode(msg.sender, c, a, t0, t1, t2, t3))] = false;
        unsubscribeCalls++;
    }

    function requestCallbackV_1_0(ISystemContract.CallbackConfiguration_V_1_0 memory c) external {
        _reqs.push(Req(msg.sender, c.chainId, c.recipient, c.gasLimit, c.payload));
    }

    function count() external view returns (uint256) {
        return _reqs.length;
    }

    function get(uint256 i) external view returns (Req memory) {
        return _reqs[i];
    }

    function isSubscribed(address sub, uint256 c, address a, uint256 t0, uint256 ignore)
        external
        view
        returns (bool)
    {
        return subscribed[keccak256(abi.encode(sub, c, a, t0, ignore, ignore, ignore))];
    }

    receive() external payable {}
}
