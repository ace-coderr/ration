// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC
/// @notice TESTNET ONLY. A worthless stand-in stablecoin with a public faucet.
///         It is not USDC and has no value. Never deploy it to a production network.
contract MockUSDC is ERC20 {
    uint256 public constant MAX_PER_CALL = 10_000e6;

    constructor() ERC20("Mock USDC (testnet)", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /// @notice Anyone can mint up to 10,000 mUSDC per call to any address.
    function faucet(address to, uint256 amount) external {
        require(amount <= MAX_PER_CALL, "faucet: too much");
        _mint(to, amount);
    }
}
