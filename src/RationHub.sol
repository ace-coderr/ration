// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IReactive} from "@reactive/src/interfaces/IReactive.sol";
import {ISystemContract} from "@reactive/src/interfaces/ISystemContract.sol";
import {AbstractReactive} from "@reactive/src/base/AbstractReactive.sol";
import {IRationVault} from "./interfaces/IRationVault.sol";

/// @title RationHub
/// @notice Reactive contract on Lasna. Watches every registered vault and moves budget slice to
///         where spending happens, using a two-phase handoff keyed by `transferId`:
///           1. recipient vault runs low  -> hub commands the richest vault: release(amount)
///           2. donor emits Released(actual) -> hub commands the recipient: grant(actual)
///           3. recipient emits Granted      -> hub marks the transfer done
///         The hub never creates slice. It can only grant what a donor reported as released, so a
///         lost or late message leaves budget unused, never overspent.
contract RationHub is AbstractReactive {
    // ---------------------------------------------------------------- constants
    uint256 public constant MAX_LANES = 8;
    uint256 public constant MAX_GRANT_RETRIES = 5;
    uint256 public constant BPS = 10_000;

    address internal constant LEGACY_SYSTEM = 0x0000000000000000000000000000000000fffFfF;
    /// @dev Cron topic0 values (every 10 / 100 / 1000 / 10000 Lasna blocks, about 10 s / 2 min / 17 min / 3 h).
    ///      The cron is only a wake-up for timeouts and epoch rollover. Every tick is billed to the
    ///      hub whether or not it does any work, so pick the longest interval that fits.
    uint256 internal constant CRON10_TOPIC_0 =
        0x04463f7c1651e6b9774d7f85c85bb94654e3c46ca79b0c16fb16d4183307b687;
    uint256 internal constant CRON100_TOPIC_0 =
        0xb49937fb8970e19fd46d48f7e3fb00d659deac0347f79cd7cb542f0fc1503c70;
    uint256 internal constant CRON1000_TOPIC_0 =
        0xe20b31294d84c3661ddc8f423abb9c70310d0cf172aa2714ead78029b325e3f4;
    uint256 internal constant CRON10000_TOPIC_0 =
        0xd214e1d84db704ed42d37f538ea9bf71e44ba28bc1cc088b2f5deca654677a56;

    uint256 internal constant SPENT_T0 =
        uint256(keccak256("Spent(address,address,address,uint256,uint256,uint256,uint256,uint256)"));
    uint256 internal constant RELEASED_T0 =
        uint256(keccak256("Released(bytes32,uint256,uint256,uint256,uint256,uint256,uint256)"));
    uint256 internal constant GRANTED_T0 =
        uint256(keccak256("Granted(bytes32,uint256,uint256,uint256,uint256,uint256)"));
    uint256 internal constant RESET_T0 =
        uint256(keccak256("EpochReset(uint256,uint256,uint256,uint256,uint256,uint256)"));

    // ---------------------------------------------------------------- errors
    error NotOwner();
    error UnsupportedInterval(uint256 interval);
    error LaneExists(uint256 chainId);
    error UnknownLane(uint256 chainId);
    error TooManyLanes();
    error BadWeights(uint256 sum);
    error BadConfig();
    error ZeroAddress();
    error NothingToStart();
    error EpochStillRunning(uint256 epochEnd);

    // ---------------------------------------------------------------- types
    enum State {
        None,
        Requested, // release commanded, waiting for Released
        Granting, // grant commanded, waiting for Granted
        Done,
        Expired // release never confirmed in time; may still complete late
    }

    struct Lane {
        uint256 chainId;
        address vault;
        uint16 weightBps; // share of the budget at epoch start
        uint16 lowBps; // below this share of the budget the lane asks for more
        bool active;
        uint256 slice; // mirror of the vault's slice, from its own events
        uint256 pendingOut; // requested but unconfirmed releases from this lane
        uint256 lastSeq;
        bytes32 inbound; // transfer currently refilling this lane, 0 if none
    }

    struct Transfer {
        uint8 from; // lane index
        uint8 to; // lane index
        State state;
        uint8 retries;
        uint256 epochId;
        uint256 requested;
        uint256 actual;
        uint64 createdAt;
        uint64 releasedAt;
        uint64 lastActionAt;
        uint64 doneAt;
    }

    // ---------------------------------------------------------------- state
    address public immutable OWNER;
    uint256 public immutable CRON_INTERVAL;
    uint256 internal immutable CRON_TOPIC;

    // Config. `budget`, `epochLength` apply from the next epoch; the others apply at once.
    uint256 public budget;
    uint256 public epochLength;
    uint16 public refillBps = 2000;
    uint256 public timeout = 300;
    uint256 public minTransfer = 1;
    uint64 public callbackGas = 300_000;

    // Running epoch.
    uint256 public epochId;
    uint256 public epochStart;
    uint256 public epochEnd;
    uint256 public epochBudget;

    Lane[] internal _lanes;
    mapping(uint256 => uint256) internal _laneIndexPlusOne; // chainId => index + 1
    mapping(bytes32 => Transfer) internal _transfers;
    uint256 public nonce;

    // ---------------------------------------------------------------- events
    event LaneRegistered(uint256 indexed chainId, address indexed vault, uint16 weightBps, uint16 lowBps);
    event LaneRemoved(uint256 indexed chainId, address indexed vault);
    event ConfigSet(
        uint256 budget, uint256 epochLength, uint16 refillBps, uint256 timeout, uint256 minTransfer
    );
    event EpochStarted(uint256 indexed epochId, uint256 budget, uint256 epochStart, uint256 epochEnd);
    event TransferRequested(
        bytes32 indexed transferId, uint256 fromChain, uint256 toChain, uint256 amount, uint256 epochId
    );
    event TransferReleased(bytes32 indexed transferId, uint256 requested, uint256 actual);
    event TransferGranting(bytes32 indexed transferId, uint256 amount, uint8 attempt);
    event TransferDone(bytes32 indexed transferId, uint256 amount, uint256 latency);
    event TransferExpired(bytes32 indexed transferId);

    modifier onlyOwner() {
        if (msg.sender != OWNER) revert NotOwner();
        _;
    }

    /// @param cronInterval_ One of 10, 100, 1000, 10000 (Lasna blocks) for the housekeeping tick.
    constructor(uint256 cronInterval_) payable {
        OWNER = msg.sender;
        CRON_INTERVAL = cronInterval_;
        CRON_TOPIC = _cronTopicFor(cronInterval_);
        SYSTEM.subscribe(
            block.chainid, LEGACY_SYSTEM, CRON_TOPIC, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE
        );
    }

    function _cronTopicFor(uint256 interval_) internal pure returns (uint256) {
        if (interval_ == 10) return CRON10_TOPIC_0;
        if (interval_ == 100) return CRON100_TOPIC_0;
        if (interval_ == 1000) return CRON1000_TOPIC_0;
        if (interval_ == 10_000) return CRON10000_TOPIC_0;
        revert UnsupportedInterval(interval_);
    }

    // ================================================================ owner: setup

    /// @notice Add a vault. Subscribes to its events. Do this after the vault is deployed.
    function registerVault(uint256 chainId, address vault, uint16 weightBps, uint16 lowBps)
        external
        onlyOwner
    {
        if (vault == address(0)) revert ZeroAddress();
        if (_laneIndexPlusOne[chainId] != 0) revert LaneExists(chainId);
        if (_lanes.length >= MAX_LANES) revert TooManyLanes();
        if (lowBps > BPS || weightBps > BPS) revert BadConfig();
        _lanes.push(
            Lane({
                chainId: chainId,
                vault: vault,
                weightBps: weightBps,
                lowBps: lowBps,
                active: true,
                slice: 0,
                pendingOut: 0,
                lastSeq: 0,
                inbound: bytes32(0)
            })
        );
        _laneIndexPlusOne[chainId] = _lanes.length;
        _subscribeVault(chainId, vault);
        emit LaneRegistered(chainId, vault, weightBps, lowBps);
    }

    /// @notice Point an existing lane at a freshly deployed vault (after a redeploy).
    ///         Old subscriptions are removed; the new vault is idle until the next epoch starts.
    function replaceVault(uint256 chainId, address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        uint256 idx = _laneIndexPlusOne[chainId];
        if (idx == 0) revert UnknownLane(chainId);
        Lane storage l = _lanes[idx - 1];
        if (l.active) _unsubscribeVault(chainId, l.vault);
        emit LaneRemoved(chainId, l.vault);
        l.vault = newVault;
        l.active = true;
        l.slice = 0;
        l.pendingOut = 0;
        l.lastSeq = 0;
        l.inbound = bytes32(0);
        _subscribeVault(chainId, newVault);
        emit LaneRegistered(chainId, newVault, l.weightBps, l.lowBps);
    }

    /// @notice Stop watching a vault. Its weight must be redistributed before the next epoch.
    function removeVault(uint256 chainId) external onlyOwner {
        uint256 idx = _laneIndexPlusOne[chainId];
        if (idx == 0) revert UnknownLane(chainId);
        Lane storage l = _lanes[idx - 1];
        if (l.active) _unsubscribeVault(chainId, l.vault);
        l.active = false;
        l.inbound = bytes32(0);
        l.pendingOut = 0;
        emit LaneRemoved(chainId, l.vault);
    }

    function setLaneParams(uint256 chainId, uint16 weightBps, uint16 lowBps) external onlyOwner {
        uint256 idx = _laneIndexPlusOne[chainId];
        if (idx == 0) revert UnknownLane(chainId);
        if (lowBps > BPS || weightBps > BPS) revert BadConfig();
        _lanes[idx - 1].weightBps = weightBps;
        _lanes[idx - 1].lowBps = lowBps;
    }

    function setConfig(
        uint256 budget_,
        uint256 epochLength_,
        uint16 refillBps_,
        uint256 timeout_,
        uint256 minTransfer_
    ) external onlyOwner {
        if (epochLength_ == 0 || refillBps_ == 0 || refillBps_ > BPS || timeout_ == 0) {
            revert BadConfig();
        }
        budget = budget_;
        epochLength = epochLength_;
        refillBps = refillBps_;
        timeout = timeout_;
        minTransfer = minTransfer_ == 0 ? 1 : minTransfer_;
        emit ConfigSet(budget_, epochLength_, refillBps_, timeout_, minTransfer);
    }

    function setCallbackGas(uint64 gas_) external onlyOwner {
        if (gas_ < 100_000 || gas_ > 900_000) revert BadConfig();
        callbackGas = gas_;
    }

    /// @notice Begin a new epoch now, applying the current config. Use for the first epoch or to
    ///         change the budget immediately. Spend from the previous epoch is not carried over.
    function startEpoch() external onlyOwner {
        _startEpoch();
    }

    /// @notice Anyone may roll the epoch once it has ended (the cron tick does this too).
    function rollEpoch() external {
        if (epochId == 0) revert NothingToStart();
        if (block.timestamp < epochEnd) revert EpochStillRunning(epochEnd);
        _startEpoch();
    }

    // ================================================================ reactive entry point

    /// @inheritdoc IReactive
    function react(LogRecord calldata log_) external onlySystem {
        if (log_.topic0 == CRON_TOPIC) {
            if (log_.contractAddress == LEGACY_SYSTEM) _tick();
            return;
        }

        uint256 plusOne = _laneIndexPlusOne[log_.chainId];
        if (plusOne == 0) return; // unknown chain
        Lane storage l = _lanes[plusOne - 1];
        if (!l.active || l.vault != log_.contractAddress) return; // unknown emitter

        uint8 i = uint8(plusOne - 1);
        if (log_.topic0 == SPENT_T0 && log_.opCode == 4) {
            _onSpent(i, log_.data);
        } else if (log_.topic0 == RELEASED_T0 && log_.opCode == 2) {
            _onReleased(i, bytes32(log_.topic1), log_.data);
        } else if (log_.topic0 == GRANTED_T0 && log_.opCode == 2) {
            _onGranted(i, bytes32(log_.topic1), log_.data);
        } else if (log_.topic0 == RESET_T0 && log_.opCode == 2) {
            _onReset(i, log_.topic1, log_.data);
        }
        // anything else falls through silently: reverting would still be billed
    }

    // ================================================================ event handlers

    function _onSpent(uint8 i, bytes calldata data) internal {
        (, uint256 newSlice, uint256 vaultEpoch, uint256 seq,) =
            abi.decode(data, (uint256, uint256, uint256, uint256, uint256));
        if (vaultEpoch != epochId) return;
        _mirror(_lanes[i], newSlice, seq);
        _rebalance(i);
    }

    function _onReleased(uint8 i, bytes32 id, bytes calldata data) internal {
        Transfer storage t = _transfers[id];
        if (t.state != State.Requested && t.state != State.Expired) return; // replay or unknown
        if (t.from != i) return;
        (uint256 requested, uint256 actual, uint256 newSlice, uint256 vaultEpoch, uint256 seq,) =
            abi.decode(data, (uint256, uint256, uint256, uint256, uint256, uint256));
        if (t.epochId != epochId || vaultEpoch != t.epochId) return; // epoch moved on: void

        Lane storage donor = _lanes[i];
        _mirror(donor, newSlice, seq);
        if (t.state == State.Requested) {
            donor.pendingOut = donor.pendingOut > t.requested ? donor.pendingOut - t.requested : 0;
        }

        Lane storage recipient = _lanes[t.to];
        t.releasedAt = uint64(block.timestamp);
        t.actual = actual;
        emit TransferReleased(id, requested, actual);

        if (actual == 0) {
            t.state = State.Done;
            t.doneAt = uint64(block.timestamp);
            if (recipient.inbound == id) recipient.inbound = bytes32(0);
            return;
        }

        t.state = State.Granting;
        t.lastActionAt = uint64(block.timestamp);
        if (recipient.inbound == bytes32(0)) recipient.inbound = id; // late release: track it again
        _sendGrant(id, t);
    }

    function _onGranted(uint8 i, bytes32 id, bytes calldata data) internal {
        Transfer storage t = _transfers[id];
        if (t.state != State.Granting || t.to != i) return;
        (uint256 amount, uint256 newSlice, uint256 vaultEpoch, uint256 seq,) =
            abi.decode(data, (uint256, uint256, uint256, uint256, uint256));
        if (t.epochId != epochId || vaultEpoch != t.epochId) return;

        Lane storage recipient = _lanes[i];
        _mirror(recipient, newSlice, seq);
        t.state = State.Done;
        t.doneAt = uint64(block.timestamp);
        if (recipient.inbound == id) recipient.inbound = bytes32(0);
        emit TransferDone(id, amount, block.timestamp - t.createdAt);
        _rebalance(i); // still low? ask again
    }

    function _onReset(uint8 i, uint256 resetEpoch, bytes calldata data) internal {
        if (resetEpoch != epochId) return;
        (uint256 slice_,,, uint256 seq,) = abi.decode(data, (uint256, uint256, uint256, uint256, uint256));
        _mirror(_lanes[i], slice_, seq);
    }

    // ================================================================ cron: timeouts and rollover

    function _tick() internal {
        if (epochId != 0 && block.timestamp >= epochEnd) {
            _startEpoch();
            return;
        }
        uint256 n = _lanes.length;
        for (uint256 k = 0; k < n; k++) {
            Lane storage l = _lanes[k];
            bytes32 id = l.inbound;
            if (id == bytes32(0)) continue;
            Transfer storage t = _transfers[id];
            if (block.timestamp - t.lastActionAt < timeout && block.timestamp - t.createdAt < timeout) {
                continue;
            }

            if (t.state == State.Requested && block.timestamp - t.createdAt >= timeout) {
                // Release never confirmed. Free the recipient to try again. If the release
                // lands late the hub still grants it (see _onReleased).
                t.state = State.Expired;
                Lane storage donor = _lanes[t.from];
                donor.pendingOut = donor.pendingOut > t.requested ? donor.pendingOut - t.requested : 0;
                l.inbound = bytes32(0);
                emit TransferExpired(id);
                _rebalance(uint8(k));
            } else if (t.state == State.Granting && block.timestamp - t.lastActionAt >= timeout) {
                // Grant not confirmed. Re-issue the SAME grant: the vault applies each transferId once.
                if (t.retries < MAX_GRANT_RETRIES) {
                    t.retries++;
                    t.lastActionAt = uint64(block.timestamp);
                    _sendGrant(id, t);
                }
            }
        }
    }

    // ================================================================ core logic

    function _rebalance(uint8 i) internal {
        Lane storage l = _lanes[i];
        if (!l.active || l.inbound != bytes32(0) || epochBudget == 0) return;
        uint256 low = (epochBudget * l.lowBps) / BPS;
        if (l.slice >= low) return;

        uint256 want = (epochBudget * refillBps) / BPS;
        uint256 bestAvail;
        uint8 donorIdx;
        uint256 n = _lanes.length;
        for (uint8 j = 0; j < n; j++) {
            if (j == i) continue;
            Lane storage d = _lanes[j];
            if (!d.active) continue;
            uint256 keep = d.pendingOut + (epochBudget * d.lowBps) / BPS;
            uint256 avail = d.slice > keep ? d.slice - keep : 0;
            if (avail > bestAvail) {
                bestAvail = avail;
                donorIdx = j;
            }
        }
        uint256 amount = want < bestAvail ? want : bestAvail;
        if (amount < minTransfer) return;

        bytes32 id = keccak256(abi.encode(address(this), block.chainid, ++nonce));
        _transfers[id] = Transfer({
            from: donorIdx,
            to: i,
            state: State.Requested,
            retries: 0,
            epochId: epochId,
            requested: amount,
            actual: 0,
            createdAt: uint64(block.timestamp),
            releasedAt: 0,
            lastActionAt: uint64(block.timestamp),
            doneAt: 0
        });
        l.inbound = id;
        _lanes[donorIdx].pendingOut += amount;

        _callback(
            _lanes[donorIdx].chainId,
            _lanes[donorIdx].vault,
            abi.encodeCall(IRationVault.release, (address(0), amount, id, epochId))
        );
        emit TransferRequested(id, _lanes[donorIdx].chainId, l.chainId, amount, epochId);
    }

    function _sendGrant(bytes32 id, Transfer storage t) internal {
        Lane storage to = _lanes[t.to];
        _callback(
            to.chainId, to.vault, abi.encodeCall(IRationVault.grant, (address(0), t.actual, id, t.epochId))
        );
        emit TransferGranting(id, t.actual, t.retries);
    }

    function _startEpoch() internal {
        uint256 n = _lanes.length;
        uint256 sum;
        for (uint256 k = 0; k < n; k++) {
            if (_lanes[k].active) sum += _lanes[k].weightBps;
        }
        if (sum != BPS) revert BadWeights(sum);
        if (epochLength == 0) revert BadConfig();

        epochId += 1;
        epochStart = block.timestamp;
        epochEnd = block.timestamp + epochLength;
        epochBudget = budget;

        uint256 remaining = budget;
        uint256 lastActive = type(uint256).max;
        for (uint256 k = 0; k < n; k++) {
            if (_lanes[k].active) lastActive = k;
        }
        for (uint256 k = 0; k < n; k++) {
            Lane storage l = _lanes[k];
            // Any transfer of the old epoch is void: vaults reject its epoch id.
            l.pendingOut = 0;
            l.inbound = bytes32(0);
            if (!l.active) continue;
            // Rounding dust goes to the last lane so shares add up to the budget exactly.
            uint256 share = k == lastActive ? remaining : (budget * l.weightBps) / BPS;
            remaining -= share;
            l.slice = share;
            _callback(
                l.chainId,
                l.vault,
                abi.encodeCall(IRationVault.resetEpoch, (address(0), share, epochId, epochEnd, budget))
            );
        }
        emit EpochStarted(epochId, budget, epochStart, epochEnd);
    }

    function _mirror(Lane storage l, uint256 newSlice, uint256 seq) internal {
        if (seq > l.lastSeq) {
            l.slice = newSlice;
            l.lastSeq = seq;
        }
    }

    function _callback(uint256 chainId, address vault, bytes memory payload) internal {
        SYSTEM.requestCallbackV_1_0(
            ISystemContract.CallbackConfiguration_V_1_0({
                chainId: chainId, recipient: vault, gasLimit: callbackGas, payload: payload
            })
        );
    }

    function _subscribeVault(uint256 chainId, address vault) internal {
        SYSTEM.subscribe(chainId, vault, SPENT_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.subscribe(chainId, vault, RELEASED_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.subscribe(chainId, vault, GRANTED_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.subscribe(chainId, vault, RESET_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    function _unsubscribeVault(uint256 chainId, address vault) internal {
        SYSTEM.unsubscribe(chainId, vault, SPENT_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.unsubscribe(chainId, vault, RELEASED_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.unsubscribe(chainId, vault, GRANTED_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
        SYSTEM.unsubscribe(chainId, vault, RESET_T0, REACTIVE_IGNORE, REACTIVE_IGNORE, REACTIVE_IGNORE);
    }

    // ================================================================ views

    function laneCount() external view returns (uint256) {
        return _lanes.length;
    }

    function laneAt(uint256 i) external view returns (Lane memory) {
        return _lanes[i];
    }

    function laneIndex(uint256 chainId) external view returns (uint256 idx, bool found) {
        uint256 p = _laneIndexPlusOne[chainId];
        return (p == 0 ? 0 : p - 1, p != 0);
    }

    function transferOf(bytes32 id) external view returns (Transfer memory) {
        return _transfers[id];
    }

    // ================================================================ native funding

    /// @notice Pay outstanding debt to the system contract from this contract's balance.
    function coverDebt() external onlyOwner {
        _coverDebt();
    }

    function withdrawNative(address payable to, uint256 amount) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (address(this).balance < amount) revert InsufficientFunds(amount, address(this).balance);
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
