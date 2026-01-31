// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "forge-std/Test.sol";
import {IERC20} from "lib/openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {FlashLiquidator} from "../src/FlashLiquidator.sol";

interface IFlashLiquidator {
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external;
    function POOL_FEE() external view returns (uint24);
}

contract FullLiquidationSim is Test {
    FlashLiquidator liquidator;
    address FLASH_LIQUIDATOR;
    address BALANCER_VAULT = 0xBA12222222228d8Ba445958a75a0704d566BF2C8;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant EURC = 0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42;
    address constant TARGET_USER = 0x7a2497ad6E4ebA70089c375455FD4cf19d580cE1;

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));
        address router = vm.parseAddress("0x198EF79F1F515F02dFE9e3115eD9fC07183f02fC");
        liquidator = new FlashLiquidator(0, router); // Deploy with 0 threshold + Search Result Router
        FLASH_LIQUIDATOR = address(liquidator);
    }

    function testSimulateZeroThreshold() public {
        // 1. Force Threshold to 0
        // Slot 2 determined previously
        vm.store(FLASH_LIQUIDATOR, bytes32(uint256(2)), bytes32(uint256(0)));
        
        // 2. Prepare Data
        address[] memory tokens = new address[](1);
        tokens[0] = USDC;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10_000_000; // 10 USDC
        uint256[] memory feeAmounts = new uint256[](1);
        feeAmounts[0] = 0; // Assume 0 fee
        
        bytes memory userData = abi.encode(EURC, USDC, TARGET_USER, amounts[0]);

        // 3. Fund Liquidator with USDC (for Aave repayment if needed? No, FlashLoan provides it)
        deal(USDC, FLASH_LIQUIDATOR, 10_000_000);

        // Deal Collateral (EURC) to simulate successful liquidation outcome
        // Assume we get 10.5 EURC for 10 USDC debt (simulating profit)
        deal(EURC, FLASH_LIQUIDATOR, 10_500_000);

        // Mock Aave Call to succeed
        // IAavePool.liquidationCall selector = 0x00a718a9 (checked or computed)
        // Function: liquidationCall(address,address,address,uint256,bool)
        vm.mockCall(
            0xA238Dd80C259a72e81d7e4664a9801593F98d1c5, // Aave Pool
            abi.encodeWithSelector(bytes4(0x00a718a9)), // liquidationCall selector
            abi.encode() 
        );

        console.log("Simulating receiveFlashLoan on:", FLASH_LIQUIDATOR);
        console.log("Threshold (Slot 2):", uint256(vm.load(FLASH_LIQUIDATOR, bytes32(uint256(2)))));

        // 4. Prank Balancer
        vm.prank(BALANCER_VAULT);
        try IFlashLiquidator(FLASH_LIQUIDATOR).receiveFlashLoan(tokens, amounts, feeAmounts, userData) {
            console.log("Success! Liquidation Executed.");
        } catch Error(string memory reason) {
            console.log("Reverted:", reason);
        } catch Panic(uint256 code) {
            console.log("Panicked (Overflow/Underflow):", code);
        } catch (bytes memory reasonBytes) {
            console.log("Reverted with No Reason (Raw Bytes):");
            console.logBytes(reasonBytes);
        }
    }
}
