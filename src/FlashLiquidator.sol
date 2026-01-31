// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// import "forge-std/console.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IAavePool {
    function liquidationCall(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover,
        bool receiveAToken
    ) external;
}

interface IBalancerVault {
    function flashLoan(
        address recipient,
        address[] memory tokens,
        uint256[] memory amounts,
        bytes memory userData
    ) external;
}

interface IUniversalRouter {
    function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable;
}

contract FlashLiquidator is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IAavePool public constant AAVE_POOL = IAavePool(0xA238Dd80C259a72e81d7e4664a9801593F98d1c5);
    IBalancerVault public constant BALANCER_VAULT = IBalancerVault(0xBA12222222228d8Ba445958a75a0704d566BF2C8);
    IUniversalRouter public UNISWAP_ROUTER; 
    
    uint24 public constant POOL_FEE = 500; // 0.05%

    uint256 public minProfitThreshold;

    event LiquidationExecuted(address indexed user, address collateralAsset, address debtAsset, uint256 debtToCover, uint256 profit);
    event MinProfitThresholdUpdated(uint256 newThreshold);
    event Withdrawal(address indexed token, uint256 amount);

    constructor(uint256 _profitThreshold, address _router) Ownable(msg.sender) {
        minProfitThreshold = _profitThreshold; // Assuming _profitThreshold is meant for minProfitThreshold
        UNISWAP_ROUTER = IUniversalRouter(_router);
    }

    function setMinProfitThreshold(uint256 _newThreshold) external onlyOwner {
        minProfitThreshold = _newThreshold;
        emit MinProfitThresholdUpdated(_newThreshold);
    }

    // Single Liquidation Entry Point
    function executeLiquidation(
        address collateralAsset,
        address debtAsset,
        address user,
        uint256 debtToCover
    ) external nonReentrant onlyOwner {
        address[] memory tokens = new address[](1);
        tokens[0] = debtAsset;

        uint256[] memory amounts = new uint256[](1);
        amounts[0] = debtToCover;

        // Mode: false = single
        bytes memory userData = abi.encode(false, collateralAsset, debtAsset, user, debtToCover);
        BALANCER_VAULT.flashLoan(address(this), tokens, amounts, userData);
    }

    // Batch Liquidation Entry Point
    function executeBatch(
        address[] calldata collateralAssets,
        address[] calldata debtAssets,
        address[] calldata users,
        uint256[] calldata debtsToCover
    ) external nonReentrant onlyOwner {
        require(users.length > 0, "Empty batch");
        require(users.length == collateralAssets.length && users.length == debtAssets.length && users.length == debtsToCover.length, "Length mismatch");

        address debtAsset = debtAssets[0];
        uint256 totalDebtToCover = 0;
        for (uint i = 0; i < debtsToCover.length; i++) {
            require(debtAssets[i] == debtAsset, "Batch must share same debt asset");
            totalDebtToCover += debtsToCover[i];
        }

        address[] memory tokens = new address[](1);
        tokens[0] = debtAsset;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = totalDebtToCover;

        // Mode: true = batch
        bytes memory userData = abi.encode(true, collateralAssets, debtAssets, users, debtsToCover);
        BALANCER_VAULT.flashLoan(address(this), tokens, amounts, userData);
    }

    // Balancer Callback
    function receiveFlashLoan(
        address[] memory tokens,
        uint256[] memory amounts,
        uint256[] memory feeAmounts,
        bytes memory userData
    ) external {
        require(msg.sender == address(BALANCER_VAULT), "Caller must be Balancer Vault");

        (bool isBatch) = abi.decode(userData, (bool));
        address debtAsset = tokens[0];
        uint256 amountToRepay = amounts[0] + feeAmounts[0];

        if (!isBatch) {
            (, address collateralAsset, , address user, uint256 debtToCover) = abi.decode(userData, (bool, address, address, address, uint256));
            
            // Execute One
            IERC20(debtAsset).forceApprove(address(AAVE_POOL), debtToCover);
            AAVE_POOL.liquidationCall(collateralAsset, debtAsset, user, debtToCover, false);
            
            // Swap all found collateral
            _swapAssetToDebt(collateralAsset, debtAsset);
        } else {
            (, address[] memory collateralAssets, , address[] memory users, uint256[] memory debtsToCover) = abi.decode(userData, (bool, address[], address[], address[], uint256[]));
            
            // Loop Liquidations
            for (uint i = 0; i < users.length; i++) {
                IERC20(debtAsset).forceApprove(address(AAVE_POOL), debtsToCover[i]);
                AAVE_POOL.liquidationCall(collateralAssets[i], debtAsset, users[i], debtsToCover[i], false);
            }

            // Loop Swaps (Unique assets would be better, but simple loop works for now)
            for (uint i = 0; i < collateralAssets.length; i++) {
                _swapAssetToDebt(collateralAssets[i], debtAsset);
            }
        }

        // Repay Flash Loan
        uint256 debtBalance = IERC20(debtAsset).balanceOf(address(this));
        require(debtBalance >= amountToRepay, "Insufficient funds to repay loan");

        uint256 profit = debtBalance - amountToRepay;
        require(profit >= minProfitThreshold, "Profit below threshold");

        IERC20(debtAsset).forceApprove(address(BALANCER_VAULT), amountToRepay);
        
        if (profit > 0) {
            IERC20(debtAsset).safeTransfer(owner(), profit);
        }
    }

    // Helper to swap internal balance of an asset to debt
    function _swapAssetToDebt(address asset, address debt) internal {
        uint256 balance = IERC20(asset).balanceOf(address(this));
        if (balance == 0 || asset == debt) return;

        uint24[3] memory tiers = [uint24(500), uint24(3000), uint24(10000)];
        bool swapSuccess = false;

        for (uint i = 0; i < tiers.length; i++) {
            try this.executeSwapStep(asset, debt, tiers[i], balance) {
                swapSuccess = true;
                break;
            } catch {}
        }
        // We don't strictly require every swap success in a batch, but we need it at the end to repay.
    }

    /**
     * @dev Isolated swap step used for multi-tier probing. 
     * Must be external so 'this.executeSwapStep' works for try/catch.
     */
    function executeSwapStep(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    ) external {
        require(msg.sender == address(this), "Only self");
        
        IERC20(tokenIn).safeTransfer(address(UNISWAP_ROUTER), amountIn);

        bytes memory path = abi.encodePacked(tokenIn, fee, tokenOut);
        bytes memory commands = hex"00"; // V3_SWAP_EXACT_IN
        bytes[] memory inputs = new bytes[](1);
        inputs[0] = abi.encode(address(this), amountIn, 0, path, false);

        UNISWAP_ROUTER.execute(commands, inputs, block.timestamp);
    }

    // Utils
    function withdrawToken(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance > 0) {
            IERC20(token).safeTransfer(owner(), balance);
            emit Withdrawal(token, balance);
        }
    }

    function withdrawETH() external onlyOwner {
        uint256 balance = address(this).balance;
        if (balance > 0) {
            (bool success, ) = payable(owner()).call{value: balance}("");
            require(success, "ETH transfer failed");
        }
    }

    function emergencyWithdraw(address token, uint256 amount) external onlyOwner {
        IERC20(token).safeTransfer(owner(), amount);
    }

    receive() external payable {}
}
