import { getTokenDecimals, toDecimalAmount } from './token_registry.js';
import { getAssetPriceUSD, getBatchAssetPrices } from './price_oracle.js';

export interface ProfitBreakdown {
    collateralUSD: number;
    debtUSD: number;
    gasUSD: number;
    collateralAmount: number;
    debtAmount: number;
    collateralPrice: number;
    debtPrice: number;
    ethPrice: number;
}

export interface LiquidationWithProfit {
    txHash: string;
    blockNumber: number;
    timestamp: number;
    user: string;
    collateralAsset: string;
    debtAsset: string;
    debtToCover: string;
    liquidatedCollateral: string;
    liquidator: string;
    receiveAToken: boolean;
    gasUsed: string;
    gasPrice: string;
    totalGasCost: string;
    profitUSD: number;
    breakdown: ProfitBreakdown;
}

const WETH_ADDRESS = '0x4200000000000000000000000000000000000006';

/**
 * Calculate accurate USD profit for a liquidation
 */
export async function calculateLiquidationProfit(
    liquidation: {
        collateralAsset: string;
        debtAsset: string;
        liquidatedCollateral: string;
        debtToCover: string;
        blockNumber: number;
        gasUsed: string;
        gasPrice: string;
    }
): Promise<{ profitUSD: number; breakdown: ProfitBreakdown }> {

    const blockNum = BigInt(liquidation.blockNumber);

    // Get all prices we need at the liquidation block
    const assets = [
        liquidation.collateralAsset,
        liquidation.debtAsset,
        WETH_ADDRESS // For gas cost
    ];

    const prices = await getBatchAssetPrices(assets, blockNum);

    const collPrice = prices.get(liquidation.collateralAsset.toLowerCase()) || 0;
    const debtPrice = prices.get(liquidation.debtAsset.toLowerCase()) || 0;
    const ethPrice = prices.get(WETH_ADDRESS.toLowerCase()) || 0;

    // Convert raw amounts to decimal with correct decimals
    const collAmount = toDecimalAmount(liquidation.liquidatedCollateral, liquidation.collateralAsset);
    const debtAmount = toDecimalAmount(liquidation.debtToCover, liquidation.debtAsset);

    // Calculate gas cost in ETH
    const gasETH = (BigInt(liquidation.gasUsed) * BigInt(liquidation.gasPrice)) / BigInt(1e18);
    const gasCostETH = Number(gasETH) / 1e18;

    // Calculate USD values
    const collateralUSD = collAmount * collPrice;
    const debtUSD = debtAmount * debtPrice;
    const gasUSD = gasCostETH * ethPrice;

    // Calculate profit: value received - value paid - gas cost
    const profitUSD = collateralUSD - debtUSD - gasUSD;

    return {
        profitUSD,
        breakdown: {
            collateralUSD,
            debtUSD,
            gasUSD,
            collateralAmount: collAmount,
            debtAmount,
            collateralPrice: collPrice,
            debtPrice,
            ethPrice
        }
    };
}
