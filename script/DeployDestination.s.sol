// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {IPayable} from "@reactive/src/interfaces/IPayable.sol";
import {RationVault} from "../src/RationVault.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

/// @notice Deploys the mock token and a vault on a destination chain and sets it up.
///         Run once per chain with that chain's RPC and callback proxy:
///           PROXY=0x... HUB_ADDRESS=0x... forge script script/DeployDestination.s.sol --rpc-url $RPC --broadcast
contract DeployDestination is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address hub = vm.envAddress("HUB_ADDRESS");
        address proxy = vm.envAddress("PROXY");
        address agent = vm.envAddress("AGENT_ADDRESS");
        uint256 seed = vm.envOr("SEED_TOKENS", uint256(1000e6));

        vm.startBroadcast(pk);
        MockUSDC token = new MockUSDC();
        RationVault vault = new RationVault(IPayable(payable(proxy)), hub, 6);
        vault.setToken(address(token), true);
        vault.setSpender(agent, true, 0);
        address me = vm.addr(pk);
        token.faucet(me, seed);
        token.approve(address(vault), seed);
        vault.deposit(address(token), seed);
        vm.stopBroadcast();

        console.log("token", address(token));
        console.log("vault", address(vault));
    }
}
