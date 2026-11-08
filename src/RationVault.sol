// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRationVault} from "./interfaces/IRationVault.sol";

/// @title RationVault
/// @notice One vault per chain. Holds tokens and a "slice": the part of the shared budget this
///         chain may spend right now. Spenders can only spend out of the slice. The RationHub
///         (a reactive contract on Lasna) moves slice between vaults with a two-phase handoff:
///         the donor reduces its slice first (`release`), the recipient raises its slice second
///         (`grant`). Slice is never created, only moved, so across all vaults
///         `sum(slice) + spent <= budget` holds while messages are in flight.
/// @dev Lease semantics: a slice is valid until `epochEnd`. A vault that misses its reset simply
///      stops spending when the epoch ends. Failure always means under-use, never overspend.
contract RationVault is IRationVault, AbstractCallback, Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------- errors
    error Paused();
    error NotSpender(address who);
    error TokenNotAllowed(address token);
    error RecipientNotAllowed(address to);
    error ZeroAmount();
    error ZeroAddress();
    error EpochExpired(uint256 epochEnd, uint256 nowTs);
    error EpochNotStarted(uint256 epochStart, uint256 nowTs);
    error ExceedsSlice(uint256 requested, uint256 slice);
    error ExceedsSpenderCap(uint256 requested, uint256 remainingCap);
    error DecimalsMismatch(uint8 expected, uint8 actual);
    error ExceedsUnallocated(uint256 requested, uint256 unallocated);

    // ---------------------------------------------------------------- types
    struct SpenderInfo {
        bool allowed;
        uint256 cap; // per-epoch cap in budget units; 0 means "limited only by the slice"
    }

    // ---------------------------------------------------------------- state
    /// @notice All allowlisted tokens must use this many decimals and be worth one budget unit each.
    uint8 public immutable UNIT_DECIMALS;

    uint256 public epochId;
    uint256 public epochStart;
    uint256 public epochEnd;
    uint256 public epochBudget;
    uint256 public slice;
    uint256 public spentInEpoch;
    uint256 public seq;
    bool public paused;
    bool public restrictRecipients;

    mapping(address => bool) public tokenAllowed;
    mapping(address => bool) public recipientAllowed;
    mapping(address => SpenderInfo) public spenders;
    mapping(uint256 => mapping(address => uint256)) public spentBy; // epoch => spender => amount

    // Replay protection. Keyed by transferId, which the hub makes unique.
    mapping(bytes32 => bool) public releaseSeen;
    mapping(bytes32 => uint256) public releasedActual;
    mapping(bytes32 => bool) public grantApplied;

    // ---------------------------------------------------------------- owner events
    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event SpenderSet(address indexed spender, bool allowed, uint256 cap);
    event TokenSet(address indexed token, bool allowed);
    event RecipientSet(address indexed to, bool allowed);
    event RecipientRestriction(bool enabled);
    event PauseChanged(bool paused);

    /// @param proxy_ Callback proxy of this chain.
    /// @param hub_ Address of the RationHub on Lasna (immutable; a wrong value means redeploying).
    /// @param unitDecimals_ Decimals of the budget unit (6 for USDC-like tokens).
    constructor(IPayable proxy_, address hub_, uint8 unitDecimals_)
        payable
        AbstractCallback(proxy_, hub_)
        Ownable(msg.sender)
    {
        if (hub_ == address(0) || address(proxy_) == address(0)) {
            revert ZeroAddress();
        }
        UNIT_DECIMALS = unitDecimals_;
    }

    // ================================================================ spending

    /// @notice Spend `amount` of `token` to `to`. Reduces the slice first, then transfers.
    function spend(address token, address to, uint256 amount) external nonReentrant {
        if (paused) revert Paused();
        SpenderInfo memory s = spenders[msg.sender];
        if (!s.allowed) revert NotSpender(msg.sender);
        if (!tokenAllowed[token]) revert TokenNotAllowed(token);
        if (amount == 0) revert ZeroAmount();
        if (to == address(0)) revert ZeroAddress();
        if (restrictRecipients && !recipientAllowed[to]) revert RecipientNotAllowed(to);
        if (block.timestamp >= epochEnd) revert EpochExpired(epochEnd, block.timestamp);
        if (block.timestamp < epochStart) revert EpochNotStarted(epochStart, block.timestamp);
        if (amount > slice) revert ExceedsSlice(amount, slice);
        if (s.cap != 0) {
            uint256 used = spentBy[epochId][msg.sender];
            uint256 remainingCap = used >= s.cap ? 0 : s.cap - used;
            if (amount > remainingCap) revert ExceedsSpenderCap(amount, remainingCap);
        }

        slice -= amount;
        spentInEpoch += amount;
        spentBy[epochId][msg.sender] += amount;
        uint256 n = ++seq;

        IERC20(token).safeTransfer(to, amount);

        emit Spent(msg.sender, token, to, amount, slice, epochId, n, block.timestamp);
    }

    // ================================================================ callbacks (hub only)

    /// @notice Phase 1 of a handoff: shrink this vault's slice by `min(amount, slice)`.
    /// @dev Idempotent per `transferId`. A repeat re-emits the original result and changes nothing.
    ///      Releases nothing if the epoch does not match or has expired.
    function release(address rvm, uint256 amount, bytes32 transferId, uint256 epochId_)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm)
    {
        uint256 actual;
        if (releaseSeen[transferId]) {
            actual = releasedActual[transferId];
        } else {
            releaseSeen[transferId] = true;
            if (epochId_ == epochId && block.timestamp < epochEnd) {
                actual = amount < slice ? amount : slice;
                slice -= actual;
            }
            releasedActual[transferId] = actual;
        }
        emit Released(transferId, amount, actual, slice, epochId, ++seq, block.timestamp);
    }

    /// @notice Phase 2 of a handoff: raise this vault's slice by what the donor really released.
    /// @dev Idempotent per `transferId`. Ignored (amount 0) if the epoch moved on, and bounded by
    ///      the epoch budget as a defence against a faulty hub.
    function grant(address rvm, uint256 amount, bytes32 transferId, uint256 epochId_)
        external
        onlyServiceProvider
        onlyCallbackSender(rvm)
    {
        uint256 applied;
        if (grantApplied[transferId]) {
            applied = amount; // repeat delivery: report again, change nothing
        } else if (
            epochId_ == epochId && block.timestamp < epochEnd && slice + spentInEpoch + amount <= epochBudget
        ) {
            grantApplied[transferId] = true;
            slice += amount;
            applied = amount;
        }
        emit Granted(transferId, applied, slice, epochId, ++seq, block.timestamp);
    }

    /// @notice Start a new epoch (period). Absolute by design: it replaces slice and clears spend.
    /// @dev Only moves forward. Older or repeated epoch ids are ignored. The new slice cannot be
    ///      spent before `epochStart`, and never before this vault's previous lease has ended, so an
    ///      old and a new slice are never spendable on the same vault at once, whatever the clocks say.
    function resetEpoch(
        address rvm,
        uint256 slice_,
        uint256 epochId_,
        uint256 epochStart_,
        uint256 epochEnd_,
        uint256 budget_
    ) external onlyServiceProvider onlyCallbackSender(rvm) {
        if (epochId_ <= epochId) return;
        epochId = epochId_;
        epochStart = epochStart_ > epochEnd ? epochStart_ : epochEnd;
        epochEnd = epochEnd_;
        epochBudget = budget_;
        slice = slice_ > budget_ ? budget_ : slice_;
        spentInEpoch = 0;
        emit EpochReset(epochId_, slice, epochStart, epochEnd_, budget_, ++seq, block.timestamp);
    }

    /// @notice End the current period now. Spending on this vault stops immediately. The hub sends this
    ///         to every vault before it starts a new period early, and only hands out new slices once all
    ///         vaults have confirmed. Idempotent.
    function closeEpoch(address rvm, uint256 epochId_) external onlyServiceProvider onlyCallbackSender(rvm) {
        if (epochId_ == epochId && block.timestamp < epochEnd) {
            epochEnd = block.timestamp;
            slice = 0;
        }
        if (epochId_ == epochId) emit EpochClosed(epochId_, spentInEpoch, ++seq, block.timestamp);
    }

    // ================================================================ owner: funds

    function deposit(address token, uint256 amount) external onlyOwner nonReentrant {
        if (!tokenAllowed[token]) revert TokenNotAllowed(token);
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(token, amount);
    }

    /// @notice Withdraw tokens that are not backing the current slice.
    function withdraw(address token, uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 bal = IERC20(token).balanceOf(address(this));
        uint256 locked = tokenAllowed[token] ? slice : 0;
        uint256 unallocated = bal > locked ? bal - locked : 0;
        if (amount > unallocated) revert ExceedsUnallocated(amount, unallocated);
        IERC20(token).safeTransfer(msg.sender, amount);
        emit Withdrawn(token, msg.sender, amount);
    }

    // ================================================================ owner: policy

    function setToken(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        if (allowed) {
            uint8 d = IERC20Metadata(token).decimals();
            if (d != UNIT_DECIMALS) revert DecimalsMismatch(UNIT_DECIMALS, d);
        }
        tokenAllowed[token] = allowed;
        emit TokenSet(token, allowed);
    }

    function setSpender(address spender, bool allowed, uint256 cap) external onlyOwner {
        if (spender == address(0)) revert ZeroAddress();
        spenders[spender] = SpenderInfo(allowed, cap);
        emit SpenderSet(spender, allowed, cap);
    }

    function setRecipient(address to, bool allowed) external onlyOwner {
        recipientAllowed[to] = allowed;
        emit RecipientSet(to, allowed);
    }

    function setRestrictRecipients(bool enabled) external onlyOwner {
        restrictRecipients = enabled;
        emit RecipientRestriction(enabled);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PauseChanged(paused_);
    }

    // ================================================================ native funding

    /// @notice Pay outstanding callback debt to the proxy from this contract's native balance.
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
