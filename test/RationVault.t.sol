// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Base} from "./Base.t.sol";
import {RationVault} from "../src/RationVault.sol";
import {AbstractCallback} from "@reactive/src/base/AbstractCallback.sol";
import {AbstractPayer} from "@reactive/src/base/AbstractPayer.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {FeeToken} from "./mocks/FeeToken.sol";

contract RationVaultTest is Base {
    // ---------------------------------------------------------------- spend

    function test_spend_reducesSliceAndPays() public {
        _spend(vaultA, 100e6);
        assertEq(vaultA.slice(), 400e6);
        assertEq(vaultA.spentInEpoch(), 100e6);
        assertEq(usdc.balanceOf(shop), 100e6);
        assertEq(vaultA.spentBy(1, alice), 100e6);
    }

    function test_spend_revertsForStranger() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RationVault.NotSpender.selector, bob));
        vaultA.spend(address(usdc), shop, 1e6);
    }

    function test_spend_revertsForUnlistedToken() public {
        MockUSDCLike other = new MockUSDCLike();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RationVault.TokenNotAllowed.selector, address(other)));
        vaultA.spend(address(other), shop, 1e6);
    }

    function test_spend_revertsOnZeroAmountAndZeroTo() public {
        vm.startPrank(alice);
        vm.expectRevert(RationVault.ZeroAmount.selector);
        vaultA.spend(address(usdc), shop, 0);
        vm.expectRevert(RationVault.ZeroAddress.selector);
        vaultA.spend(address(usdc), address(0), 1e6);
        vm.stopPrank();
    }

    function test_spend_revertsAboveSlice() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RationVault.ExceedsSlice.selector, 500e6 + 1, 500e6));
        vaultA.spend(address(usdc), shop, 500e6 + 1);
    }

    function test_spend_exactSliceThenNothingLeft() public {
        _spend(vaultA, 500e6);
        assertEq(vaultA.slice(), 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RationVault.ExceedsSlice.selector, 1, 0));
        vaultA.spend(address(usdc), shop, 1);
    }

    function test_spend_perSpenderCap() public {
        vaultA.setSpender(bob, true, 50e6);
        vm.startPrank(bob);
        vaultA.spend(address(usdc), shop, 30e6);
        vm.expectRevert(abi.encodeWithSelector(RationVault.ExceedsSpenderCap.selector, 21e6, 20e6));
        vaultA.spend(address(usdc), shop, 21e6);
        vaultA.spend(address(usdc), shop, 20e6);
        vm.stopPrank();
        // a revoked spender is out
        vaultA.setSpender(bob, false, 0);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(RationVault.NotSpender.selector, bob));
        vaultA.spend(address(usdc), shop, 1);
    }

    function test_spend_capResetsEachEpoch() public {
        vaultA.setSpender(bob, true, 50e6);
        vm.prank(bob);
        vaultA.spend(address(usdc), shop, 50e6);
        vm.warp(block.timestamp + EPOCH);
        hub.rollEpoch();
        _deliverAll();
        vm.prank(bob);
        vaultA.spend(address(usdc), shop, 50e6);
    }

    function test_spend_pausedReverts() public {
        vaultA.setPaused(true);
        vm.prank(alice);
        vm.expectRevert(RationVault.Paused.selector);
        vaultA.spend(address(usdc), shop, 1e6);
        vaultA.setPaused(false);
        _spend(vaultA, 1e6);
    }

    function test_spend_recipientRestriction() public {
        vaultA.setRestrictRecipients(true);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RationVault.RecipientNotAllowed.selector, shop));
        vaultA.spend(address(usdc), shop, 1e6);
        vaultA.setRecipient(shop, true);
        _spend(vaultA, 1e6);
    }

    function test_spend_revertsAfterEpochEnd() public {
        uint256 end = vaultA.epochEnd();
        vm.warp(end);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(RationVault.EpochExpired.selector, end, end));
        vaultA.spend(address(usdc), shop, 1e6);
    }

    function test_spend_feeOnTransferTokenCannotOverspend() public {
        FeeToken fee = new FeeToken();
        fee.mint(address(this), 1000e6);
        fee.approve(address(vaultA), type(uint256).max);
        vaultA.setToken(address(fee), true);
        vaultA.deposit(address(fee), 1000e6);
        // the vault received 990, but the slice (not the balance) is what limits spending
        vm.prank(alice);
        vaultA.spend(address(fee), shop, 500e6);
        assertEq(vaultA.slice(), 0);
        assertEq(fee.balanceOf(shop), 495e6); // recipient got less, never more
    }

    // ---------------------------------------------------------------- callback auth

    function test_callbacks_rejectNonProxy() public {
        vm.prank(bob);
        vm.expectRevert();
        vaultA.release(address(hub), 1, bytes32(uint256(1)), 1);
        vm.prank(bob);
        vm.expectRevert();
        vaultA.grant(address(hub), 1, bytes32(uint256(1)), 1);
        vm.prank(bob);
        vm.expectRevert();
        vaultA.resetEpoch(address(hub), 1, 2, block.timestamp + 1, 1);
    }

    function test_callbacks_rejectWrongReactiveSender() public {
        vm.prank(PROXY_A);
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, bob, address(hub))
        );
        vaultA.release(bob, 1, bytes32(uint256(1)), 1);
        vm.prank(PROXY_A);
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, bob, address(hub))
        );
        vaultA.grant(bob, 1, bytes32(uint256(1)), 1);
        vm.prank(PROXY_A);
        vm.expectRevert(
            abi.encodeWithSelector(AbstractCallback.CallbackNotAuthorized.selector, bob, address(hub))
        );
        vaultA.resetEpoch(bob, 1, 2, block.timestamp + 1, 1);
    }

    function test_callbacks_proxyOfOtherChainRejected() public {
        vm.prank(PROXY_B);
        vm.expectRevert();
        vaultA.release(address(hub), 1, bytes32(uint256(1)), 1);
    }

    // ---------------------------------------------------------------- release / grant

    function test_release_partialWhenSliceSmaller() public {
        _spend(vaultA, 450e6); // slice 50
        vm.prank(PROXY_A);
        vaultA.release(address(hub), 200e6, bytes32(uint256(7)), 1);
        assertEq(vaultA.slice(), 0);
        assertEq(vaultA.releasedActual(bytes32(uint256(7))), 50e6);
    }

    function test_release_replayDoesNotReduceTwice() public {
        bytes32 id = bytes32(uint256(7));
        vm.startPrank(PROXY_A);
        vaultA.release(address(hub), 100e6, id, 1);
        vaultA.release(address(hub), 100e6, id, 1);
        vaultA.release(address(hub), 400e6, id, 1); // even a different amount is ignored
        vm.stopPrank();
        assertEq(vaultA.slice(), 400e6);
    }

    function test_release_wrongEpochReleasesNothing() public {
        vm.prank(PROXY_A);
        vaultA.release(address(hub), 100e6, bytes32(uint256(9)), 2);
        assertEq(vaultA.slice(), 500e6);
        assertEq(vaultA.releasedActual(bytes32(uint256(9))), 0);
    }

    function test_release_afterExpiryReleasesNothing() public {
        vm.warp(vaultA.epochEnd());
        vm.prank(PROXY_A);
        vaultA.release(address(hub), 100e6, bytes32(uint256(9)), 1);
        assertEq(vaultA.slice(), 500e6);
    }

    function test_grant_appliesOnce() public {
        _spend(vaultA, 300e6); // slice 200, spent 300
        bytes32 id = bytes32(uint256(5));
        vm.startPrank(PROXY_A);
        vaultA.grant(address(hub), 100e6, id, 1);
        vaultA.grant(address(hub), 100e6, id, 1); // duplicate delivery
        vm.stopPrank();
        assertEq(vaultA.slice(), 300e6);
        assertTrue(vaultA.grantApplied(id));
    }

    function test_grant_wrongEpochIgnored() public {
        vm.prank(PROXY_A);
        vaultA.grant(address(hub), 100e6, bytes32(uint256(5)), 9);
        assertEq(vaultA.slice(), 500e6);
        assertFalse(vaultA.grantApplied(bytes32(uint256(5))));
    }

    function test_grant_cannotPushSlicePlusSpentOverBudget() public {
        // A faulty hub asking for more than the epoch budget allows is refused locally.
        vm.prank(PROXY_A);
        vaultA.grant(address(hub), 501e6, bytes32(uint256(5)), 1);
        assertEq(vaultA.slice(), 500e6);
        vm.prank(PROXY_A);
        vaultA.grant(address(hub), 500e6, bytes32(uint256(6)), 1);
        assertEq(vaultA.slice(), 1000e6);
    }

    // ---------------------------------------------------------------- resetEpoch

    function test_resetEpoch_movesForwardOnly() public {
        _spend(vaultA, 100e6);
        vm.startPrank(PROXY_A);
        vaultA.resetEpoch(address(hub), 777e6, 1, block.timestamp + 5, 1000e6); // same epoch: ignored
        assertEq(vaultA.slice(), 400e6);
        vaultA.resetEpoch(address(hub), 250e6, 2, block.timestamp + 5 days, 800e6);
        vm.stopPrank();
        assertEq(vaultA.epochId(), 2);
        assertEq(vaultA.slice(), 250e6);
        assertEq(vaultA.spentInEpoch(), 0);
        assertEq(vaultA.epochBudget(), 800e6);
        vm.prank(PROXY_A);
        vaultA.resetEpoch(address(hub), 1, 1, block.timestamp + 5, 1); // older: ignored
        assertEq(vaultA.epochId(), 2);
    }

    function test_resetEpoch_clampsSliceToBudget() public {
        vm.prank(PROXY_A);
        vaultA.resetEpoch(address(hub), 900e6, 2, block.timestamp + 1 days, 100e6);
        assertEq(vaultA.slice(), 100e6);
    }

    // ---------------------------------------------------------------- funds and policy

    function test_depositWithdraw_onlyOwnerAndOnlyUnallocated() public {
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob));
        vaultA.withdraw(address(usdc), 1);

        // balance 1000, slice 500 -> 500 unallocated
        vm.expectRevert(abi.encodeWithSelector(RationVault.ExceedsUnallocated.selector, 501e6, 500e6));
        vaultA.withdraw(address(usdc), 501e6);
        uint256 before = usdc.balanceOf(address(this));
        vaultA.withdraw(address(usdc), 500e6);
        assertEq(usdc.balanceOf(address(this)) - before, 500e6);

        vm.expectRevert(RationVault.ZeroAmount.selector);
        vaultA.withdraw(address(usdc), 0);
        vm.expectRevert(RationVault.ZeroAmount.selector);
        vaultA.deposit(address(usdc), 0);
    }

    function test_deposit_rejectsUnlistedToken() public {
        MockUSDCLike other = new MockUSDCLike();
        vm.expectRevert(abi.encodeWithSelector(RationVault.TokenNotAllowed.selector, address(other)));
        vaultA.deposit(address(other), 1);
    }

    function test_setToken_rejectsWrongDecimals() public {
        EighteenDecimals t = new EighteenDecimals();
        vm.expectRevert(abi.encodeWithSelector(RationVault.DecimalsMismatch.selector, 6, 18));
        vaultA.setToken(address(t), true);
        vm.expectRevert(RationVault.ZeroAddress.selector);
        vaultA.setToken(address(0), true);
    }

    function test_policyFunctions_onlyOwner() public {
        vm.startPrank(bob);
        bytes memory e = abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, bob);
        vm.expectRevert(e);
        vaultA.setToken(address(usdc), false);
        vm.expectRevert(e);
        vaultA.setSpender(bob, true, 0);
        vm.expectRevert(e);
        vaultA.setRecipient(bob, true);
        vm.expectRevert(e);
        vaultA.setRestrictRecipients(true);
        vm.expectRevert(e);
        vaultA.setPaused(true);
        vm.expectRevert(e);
        vaultA.coverDebt();
        vm.expectRevert(e);
        vaultA.withdrawNative(payable(bob), 0);
        vm.stopPrank();
    }

    function test_setSpender_zeroAddress() public {
        vm.expectRevert(RationVault.ZeroAddress.selector);
        vaultA.setSpender(address(0), true, 0);
    }

    function test_constructor_rejectsZero() public {
        vm.expectRevert(RationVault.ZeroAddress.selector);
        new RationVault(IPayable(payable(PROXY_A)), address(0), 6);
        vm.expectRevert(RationVault.ZeroAddress.selector);
        new RationVault(IPayable(payable(address(0))), address(hub), 6);
    }

    // ---------------------------------------------------------------- native funding / debt

    function test_nativeFunding_receiveAndWithdraw() public {
        vm.deal(address(this), 3 ether);
        (bool ok,) = address(vaultA).call{value: 1 ether}("");
        assertTrue(ok);
        assertEq(address(vaultA).balance, 1 ether);
        vaultA.withdrawNative(payable(bob), 0.4 ether);
        assertEq(bob.balance, 0.4 ether);
        vm.expectRevert(abi.encodeWithSelector(AbstractPayer.InsufficientFunds.selector, 5 ether, 0.6 ether));
        vaultA.withdrawNative(payable(bob), 5 ether);
        vm.expectRevert(RationVault.ZeroAddress.selector);
        vaultA.withdrawNative(payable(address(0)), 1);
    }

    function test_coverDebt_paysProxyFromBalance() public {
        MockProxy p = new MockProxy();
        RationVault v = new RationVault(IPayable(payable(address(p))), address(hub), 6);
        vm.deal(address(v), 1 ether);
        p.setDebt(address(v), 0.25 ether);
        v.coverDebt();
        assertEq(address(p).balance, 0.25 ether);
        assertEq(address(v).balance, 0.75 ether);
    }

    function test_pay_onlyProxy() public {
        vm.deal(address(vaultA), 1 ether);
        vm.prank(bob);
        vm.expectRevert();
        vaultA.pay(1 ether);
        vm.prank(PROXY_A);
        vaultA.pay(0.5 ether);
        assertEq(PROXY_A.balance, 0.5 ether);
    }

    function test_pause_doesNotBlockCallbacks() public {
        vaultA.setPaused(true);
        vm.prank(PROXY_A);
        vaultA.release(address(hub), 100e6, bytes32(uint256(1)), 1);
        assertEq(vaultA.slice(), 400e6);
    }

    function test_reentrancy_tokenCannotReenterSpend() public {
        ReentrantToken t = new ReentrantToken(vaultA);
        vaultA.setToken(address(t), true);
        t.mint(address(vaultA), 100e6);
        vm.prank(alice);
        // The token tries to re-enter spend() during transfer; the guard reverts the inner call.
        vm.expectRevert();
        vaultA.spend(address(t), address(t), 10e6);
    }
}

contract MockUSDCLike {
    function decimals() external pure returns (uint8) {
        return 6;
    }
}

contract EighteenDecimals {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

contract MockProxy {
    mapping(address => uint256) public debtOf;

    function setDebt(address c, uint256 d) external {
        debtOf[c] = d;
    }

    function debt(address c) external view returns (uint256) {
        return debtOf[c];
    }

    receive() external payable {}
}

contract ReentrantToken {
    RationVault public vault;
    mapping(address => uint256) public balanceOf;

    constructor(RationVault v) {
        vault = v;
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 a) external {
        balanceOf[to] += a;
    }

    function transfer(address to, uint256 a) external returns (bool) {
        balanceOf[msg.sender] -= a;
        balanceOf[to] += a;
        // re-enter while the outer spend is still running
        vault.spend(address(this), to, 1);
        return true;
    }
}
