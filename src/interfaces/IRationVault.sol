// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

/// @notice Events the hub subscribes to, and the callbacks the hub invokes.
/// @dev The first argument of every callback is the reactive contract's address,
///      injected by the callback proxy for authentication.
interface IRationVault {
    /// @dev Three indexed arguments, so the log has four topics (opCode 4).
    event Spent(
        address indexed spender,
        address indexed token,
        address indexed to,
        uint256 amount,
        uint256 newSlice,
        uint256 epochId,
        uint256 seq,
        uint256 timestamp
    );
    event Released(
        bytes32 indexed transferId,
        uint256 requested,
        uint256 actual,
        uint256 newSlice,
        uint256 epochId,
        uint256 seq,
        uint256 timestamp
    );
    event Granted(
        bytes32 indexed transferId,
        uint256 amount,
        uint256 newSlice,
        uint256 epochId,
        uint256 seq,
        uint256 timestamp
    );
    event EpochReset(
        uint256 indexed epochId,
        uint256 slice,
        uint256 epochStart,
        uint256 epochEnd,
        uint256 budget,
        uint256 seq,
        uint256 timestamp
    );
    event EpochClosed(uint256 indexed epochId, uint256 spent, uint256 seq, uint256 timestamp);

    function release(address rvm, uint256 amount, bytes32 transferId, uint256 epochId) external;
    function grant(address rvm, uint256 amount, bytes32 transferId, uint256 epochId) external;
    function resetEpoch(
        address rvm,
        uint256 slice,
        uint256 epochId,
        uint256 epochStart,
        uint256 epochEnd,
        uint256 budget
    ) external;
    function closeEpoch(address rvm, uint256 epochId) external;
}
