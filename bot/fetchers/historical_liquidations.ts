import { publicClient, premiumClient } from '../config.js';
import { parseAbiItem, type Address } from 'viem';
import { calculateLiquidationProfit, type LiquidationWithProfit } from '../services/profit_calculator.js';
import { rpcPool } from '../config/rpc_pool.js';

const LIQUIDATION_EVENT = parseAbiItem('event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)');

/**
 * Converts date to block number using improved estimation
 * Base chain: ~2 second blocks
 */
async function dateToBlockNumber(date: Date): Promise<bigint> {
    const targetTimestamp = Math.floor(date.getTime() / 1000);

    // Get latest block
    const latestBlock = await publicClient.getBlock({ blockTag: 'latest' });
    const latestTimestamp = Number(latestBlock.timestamp);

    // Calculate estimated blocks ago
    // Base: ~2 second blocks = 43,200 blocks per day
    const SECONDS_PER_BLOCK = 2;
    const secondsAgo = latestTimestamp - targetTimestamp;
    const estimatedBlocksAgo = Math.floor(secondsAgo / SECONDS_PER_BLOCK);

    console.log(`📅 Date: ${date.toISOString()}`);
    console.log(`   Seconds ago: ${secondsAgo.toLocaleString()} | Estimated blocks ago: ${estimatedBlocksAgo.toLocaleString()}`);

    // Start binary search from estimated position with wider range
    let low = latestBlock.number - BigInt(estimatedBlocksAgo) - 200000n;
    let high = latestBlock.number - BigInt(estimatedBlocksAgo) + 200000n;

    // Ensure bounds are valid
    if (low < 1n) low = 1n;
    if (high > latestBlock.number) high = latestBlock.number;

    console.log(`   Binary search range: ${low} to ${high}`);

    // Binary search for exact block
    let iterations = 0;
    while (low <= high && iterations < 30) {
        iterations++;
        const mid = (low + high) / 2n;
        const block = await publicClient.getBlock({ blockNumber: mid });
        const blockTimestamp = Number(block.timestamp);

        const diff = Math.abs(blockTimestamp - targetTimestamp);

        // Accept if within 1 minute
        if (diff < 60) {
            console.log(`   ✅ Found block ${mid} (${iterations} iterations)`);
            return mid;
        }

        if (blockTimestamp < targetTimestamp) {
            low = mid + 1n;
        } else {
            high = mid - 1n;
        }
    }

    console.log(`   ⚠️ Binary search didn't converge, using approximation: ${low}`);
    return low;
}

/**
 * Analyzes a liquidation transaction to extract gas details
 */
async function analyzeLiquidationTx(txHash: string): Promise<{
    gasUsed: string;
    gasPrice: string;
    totalGasCost: string;
}> {
    const receipt = await premiumClient.getTransactionReceipt({ hash: txHash as `0x${string}` });
    const tx = await premiumClient.getTransaction({ hash: txHash as `0x${string}` });

    const gasUsed = receipt.gasUsed.toString();
    const gasPrice = tx.gasPrice?.toString() || '0';
    const totalGasCost = (receipt.gasUsed * (tx.gasPrice || 0n)).toString();

    return { gasUsed, gasPrice, totalGasCost };
}

/**
 * Fetches liquidations for a date range and analyzes them with accurate USD profit
 */
export async function fetchLiquidationsByDateRange(
    startDate: Date,
    endDate: Date,
    onProgress?: (current: number, total: number) => void
): Promise<LiquidationWithProfit[]> {
    console.log(`\n🔍 Fetching liquidations from ${startDate.toISOString()} to ${endDate.toISOString()}`);

    // Convert dates to block numbers
    const fromBlock = await dateToBlockNumber(startDate);
    const toBlock = await dateToBlockNumber(endDate);

    const blockRange = toBlock - fromBlock;
    console.log(`📦 Block range: ${fromBlock} to ${toBlock} (${blockRange.toLocaleString()} blocks)`);

    // Fetch events in chunks to avoid RPC limits
    const CHUNK_SIZE = 10000n;
    const allLogs: any[] = [];

    for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
        const end = start + CHUNK_SIZE > toBlock ? toBlock : start + CHUNK_SIZE;

        try {
            const logs = await publicClient.getLogs({
                address: '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5' as Address, // AAVE V3 Pool
                event: LIQUIDATION_EVENT,
                fromBlock: start,
                toBlock: end
            });

            allLogs.push(...logs);
            console.log(`  📥 Fetched ${logs.length} events from blocks ${start.toLocaleString()}-${end.toLocaleString()}`);
        } catch (error) {
            console.error(`❌ Failed to fetch blocks ${start}-${end}:`, error);
        }
    }

    console.log(`✅ Total liquidation events found: ${allLogs.length}`);

    // Analyze each liquidation with accurate profit calculation
    const records: LiquidationWithProfit[] = [];

    for (let i = 0; i < allLogs.length; i++) {
        const log = allLogs[i];

        if (onProgress) {
            onProgress(i + 1, allLogs.length);
        }

        try {
            // Get gas details
            const { gasUsed, gasPrice, totalGasCost } = await analyzeLiquidationTx(log.transactionHash);

            // Get block timestamp
            const block = await publicClient.getBlock({ blockNumber: log.blockNumber });

            // Parse event args
            const args = log.args as any;

            // Calculate accurate USD profit
            const { profitUSD, breakdown } = await calculateLiquidationProfit({
                collateralAsset: args.collateralAsset,
                debtAsset: args.debtAsset,
                liquidatedCollateral: args.liquidatedCollateralAmount.toString(),
                debtToCover: args.debtToCover.toString(),
                blockNumber: Number(log.blockNumber),
                gasUsed,
                gasPrice
            });

            const record: LiquidationWithProfit = {
                txHash: log.transactionHash,
                blockNumber: Number(log.blockNumber),
                timestamp: Number(block.timestamp),
                user: args.user,
                collateralAsset: args.collateralAsset,
                debtAsset: args.debtAsset,
                debtToCover: args.debtToCover.toString(),
                liquidatedCollateral: args.liquidatedCollateralAmount.toString(),
                liquidator: args.liquidator,
                receiveAToken: args.receiveAToken,
                gasUsed,
                gasPrice,
                totalGasCost,
                profitUSD,
                breakdown
            };

            records.push(record);

            if ((i + 1) % 10 === 0) {
                console.log(`  📊 Analyzed ${i + 1}/${allLogs.length} liquidations...`);
            }

        } catch (error) {
            console.error(`❌ Failed to analyze liquidation ${log.transactionHash}:`, error);
        }
    }

    console.log(`✅ Successfully analyzed ${records.length}/${allLogs.length} liquidations\n`);

    return records;
}

/**
 * Fetches liquidations for the last N days
 */
export async function fetchLast90Days(onProgress?: (current: number, total: number) => void): Promise<LiquidationWithProfit[]> {
    const now = new Date();
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

    return fetchLiquidationsByDateRange(ninetyDaysAgo, now, onProgress);
}
