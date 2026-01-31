// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {FlashLiquidator} from "../src/FlashLiquidator.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        
        vm.startBroadcast(deployerPrivateKey);

        // Base Universal Router Address (Verified)
        address router = 0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC;
        FlashLiquidator liquidator = new FlashLiquidator(100, router);

        vm.stopBroadcast();

        console.log("Deployed FlashLiquidator at:", address(liquidator));
        console.log("Owner:", liquidator.owner());
        console.log("Min Profit Threshold:", liquidator.minProfitThreshold());
    }
}
