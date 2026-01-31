import { readFileSync, writeFileSync } from 'fs';
import { createPublicClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { CONFIG } from '../bot/config.js';
import { findBestLiquidationPair } from '../bot/executor.js';

// Standalone clients for testing
const publicClient = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC)
});

const premiumClient = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PREMIUM)
});

const account = privateKeyToAccount(CONFIG.PRIVATE_KEY as `0x${string}`);

// ABIs
const AAVE_POOL_ABI = [
    {
        type: 'function',
        name: 'getUserAccountData',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [
            { name: 'totalCollateralBase', type: 'uint256' },
            { name: 'totalDebtBase', type: 'uint256' },
            { name: 'availableBorrowsBase', type: 'uint256' },
            { name: 'currentLiquidationThreshold', type: 'uint256' },
            { name: 'ltv', type: 'uint256' },
            { name: 'healthFactor', type: 'uint256' }
        ],
        stateMutability: 'view'
    }
] as const;

const FLASH_LIQUIDATOR_ABI = [
    {
        type: 'function',
        name: 'executeLiquidation',
        inputs: [
            { name: 'collateralAsset', type: 'address' },
            { name: 'debtAsset', type: 'address' },
            { name: 'user', type: 'address' },
            { name: 'debtToCover', type: 'uint256' }
        ],
        outputs: [],
        stateMutability: 'nonpayable'
    }
] as const;

interface LiquidationEvent {
    blockNumber: string;
    transactionHash: string;
    user: string;
    liquidator: string;
    collateralAsset: string;
    debtAsset: string;
    debtToCover: string;
}

interface SimulationResult {
    event: LiquidationEvent;
    botWouldDetect: boolean;
    botWouldExecute: boolean;
    healthFactorAtN3: number | null;
    healthFactorAtN1: number | null;
    assetsFound: { collateral: string, debt: string } | null;
    simulationSuccess: boolean;
    estimatedBlockAdvantage: number; // Negative = bot too slow, Positive = bot faster
    failureReason?: string;
}

const BLOCK_LATENCY = 3; // Assume bot takes 3-4 blocks to execute

async function simulateLiquidation(event: LiquidationEvent): Promise<SimulationResult> {
    const blockN = BigInt(event.blockNumber);
    const blockN3 = blockN - 3n; // Bot detection point
    const blockN1 = blockN - 1n; // Bot execution point

    const result: SimulationResult = {
        event,
        botWouldDetect: false,
        botWouldExecute: false,
        healthFactorAtN3: null,
        healthFactorAtN1: null,
        assetsFound: null,
        simulationSuccess: false,
        estimatedBlockAdvantage: 0
    };

    try {
        // Step 1: Check HF at block N-3 (detection window)
        const accountDataN3 = await premiumClient.readContract({
            address: CONFIG.AAVE_POOL as `0x${string}`,
            abi: AAVE_POOL_ABI,
            functionName: 'getUserAccountData',
            args: [event.user as `0x${string}`],
            blockNumber: blockN3
        });

        const hfN3 = Number(formatUnits(accountDataN3[5], 18));
        result.healthFactorAtN3 = hfN3;

        // Would bot detect? (HF < 1.1 to be on kill list)
        if (hfN3 < CONFIG.BOT.DISCOVERY_THRESHOLD && hfN3 > 0) {
            result.botWouldDetect = true;
        } else {
            result.failureReason = `HF at N-3 was ${hfN3.toFixed(4)}, not in detection range`;
            return result;
        }

        // Step 2: Check HF at block N-1 (execution window)
        const accountDataN1 = await premiumClient.readContract({
            address: CONFIG.AAVE_POOL as `0x${string}`,
            abi: AAVE_POOL_ABI,
            functionName: 'getUserAccountData',
            args: [event.user as `0x${string}`],
            blockNumber: blockN1
        });

        const hfN1 = Number(formatUnits(accountDataN1[5], 18));
        result.healthFactorAtN1 = hfN1;

        // Would bot execute? (HF < 1.0)
        if (hfN1 >= CONFIG.BOT.LIQUIDATION_THRESHOLD) {
            result.failureReason = `HF at N-1 was ${hfN1.toFixed(4)}, above liquidation threshold`;
            return result;
        }

        // Step 3: Test dynamic asset discovery
        result.assetsFound = await findBestLiquidationPair(event.user);

        if (!result.assetsFound) {
            result.failureReason = 'Asset discovery failed';
            return result;
        }

        // Verify assets match what was actually liquidated
        const assetsMatch =
            result.assetsFound.collateral.toLowerCase() === event.collateralAsset.toLowerCase() &&
            result.assetsFound.debt.toLowerCase() === event.debtAsset?.toLowerCase();

        if (!assetsMatch) {
            result.failureReason = `Asset mismatch: Found ${result.assetsFound.collateral.slice(0, 6)}/${result.assetsFound.debt.slice(0, 6)}, Expected ${event.collateralAsset.slice(0, 6)}/${event.debtAsset?.slice(0, 6) || 'unknown'}`;
            // Still continue - maybe bot would have found a different profitable pair
        }

        // Step 4: Simulate transaction at block N-1
        try {
            await premiumClient.simulateContract({
                address: CONFIG.FLASH_LIQUIDATOR as `0x${string}`,
                abi: FLASH_LIQUIDATOR_ABI,
                functionName: 'executeLiquidation',
                args: [
                    result.assetsFound.collateral as `0x${string}`,
                    result.assetsFound.debt as `0x${string}`,
                    event.user as `0x${string}`,
                    parseUnits('100', 6) // Small test amount
                ],
                account,
                blockNumber: blockN1
            });

            result.simulationSuccess = true;
            result.botWouldExecute = true;

            // Calculate block advantage
            // Bot executes at N-1, but with latency would land at N+2 or N+3
            // Real liquidator executed at N
            result.estimatedBlockAdvantage = Number(blockN1) + BLOCK_LATENCY - Number(blockN);

        } catch (e: any) {
            // Simulation failed - check why
            if (e.message?.includes('Health factor')) {
                result.failureReason = 'Simulation reverted: HF check failed';
            } else {
                result.failureReason = `Simulation failed: ${e.shortMessage || e.message}`;
            }
        }

    } catch (e: any) {
        result.failureReason = `RPC Error: ${e.message}`;
    }

    return result;
}

async function main() {
    console.log('🎮 HISTORICAL REPLAY SIMULATION\n');
    console.log('Testing bot performance against 917 real liquidations...\n');

    // Load historical liquidations
    const liquidations: LiquidationEvent[] = JSON.parse(
        readFileSync('./data/liquidations_7d.json', 'utf8')
    );

    console.log(`📊 Total Events: ${liquidations.length}`);
    console.log(`⏱️  Estimated Time: ~${Math.ceil(liquidations.length * 2 / 60)} minutes\n`);

    const results: SimulationResult[] = [];
    let wins = 0;
    let losses = 0;
    let misses = 0;

    // Process in batches to show progress
    const BATCH_SIZE = 10;
    for (let i = 0; i < liquidations.length; i += BATCH_SIZE) {
        const batch = liquidations.slice(i, i + BATCH_SIZE);

        for (const event of batch) {
            const result = await simulateLiquidation(event);
            results.push(result);

            if (result.botWouldExecute && result.estimatedBlockAdvantage <= 0) {
                wins++;
            } else if (result.botWouldDetect) {
                losses++;
            } else {
                misses++;
            }
        }

        // Progress update
        const progress = ((i + BATCH_SIZE) / liquidations.length * 100).toFixed(1);
        process.stdout.write(`\r   Progress: ${progress}% | Wins: ${wins} | Losses: ${losses} | Misses: ${misses}`);
    }

    console.log('\n\n✅ Simulation Complete!\n');

    // Save results
    writeFileSync('./data/replay_results.json', JSON.stringify(results, null, 2));
    console.log('💾 Results saved to: ./data/replay_results.json\n');

    // Generate summary
    console.log('📈 COMPETITIVE ANALYSIS:');
    console.log(`   Total Liquidations: ${liquidations.length}`);
    console.log(`   Bot Wins: ${wins} (${(wins / liquidations.length * 100).toFixed(1)}%)`);
    console.log(`   Bot Losses: ${losses} (${(losses / liquidations.length * 100).toFixed(1)}%)`);
    console.log(`   Bot Misses: ${misses} (${(misses / liquidations.length * 100).toFixed(1)}%)`);

    const avgBlockAdvantage = results
        .filter(r => r.estimatedBlockAdvantage !== 0)
        .reduce((sum, r) => sum + r.estimatedBlockAdvantage, 0) / results.length;

    console.log(`   Avg Block Advantage: ${avgBlockAdvantage.toFixed(2)} blocks`);

    // Top failure reasons
    const failureReasons = results
        .filter(r => r.failureReason)
        .reduce((acc, r) => {
            const reason = r.failureReason!.split(':')[0]; // Group by category
            acc[reason] = (acc[reason] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

    console.log('\n🔍 Top Failure Reasons:');
    Object.entries(failureReasons)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .forEach(([reason, count]) => {
            console.log(`   ${reason}: ${count}`);
        });
}

main().catch(console.error);
