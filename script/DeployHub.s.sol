// SPDX-License-Identifier: MIT
pragma solidity ^0.8.29;

import {Script, console} from "forge-std/Script.sol";
import {RationHub} from "../src/RationHub.sol";

/// @notice Deploys the hub on Lasna. Deploy this first: every vault is bound to its address.
///           forge script script/DeployHub.s.sol --rpc-url $LASNA_RPC --broadcast
contract DeployHub is Script {
    function run() external {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        uint256 cron = vm.envOr("CRON_INTERVAL", uint256(1000));
        vm.startBroadcast(pk);
        RationHub hub = new RationHub(cron);
        vm.stopBroadcast();
        console.log("hub", address(hub));
    }
}
