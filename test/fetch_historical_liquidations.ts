import { createPublicClient, http, parseAbiItem, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { writeFileSync } from 'fs';
import { CONFIG } from '../bot/config.js';

const SEVEN_DAYS_IN_BLOCKS = 7 * 24 * 60 * 30; // ~302,400 blocks (2s per block)
const CHUNK_SIZE = 2000n; // Fetch in smaller chunks to avoid RPC limits

interface LiquidationEvent {
    blockNumber: bigint;
    transactionHash: string;
    victim: string;
    liquidator: string;
    collateralAsset: string;
    debtAsset: string;
    debtToCover: bigint;
    liquidatedCollateralAmount: bigint;
    timestamp?: number;
}

const publicClient = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC)
});

const liquidationEventAbi = parseAbiItem(
    'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
);

async function fetchHistoricalLiquidations() {
    console.log('📊 Fetching Historical Liquidations (Last 7 Days)...\n');

    // 1. Get current block
    const currentBlock = await publicClient.getBlockNumber();
    console.log(`Current Block: ${currentBlock}`);

    // 2. Calculate range
    const fromBlock = currentBlock - SEVEN_DAYS_IN_BLOCKS;
    console.log(`Scanning from block ${fromBlock} to ${currentBlock}`);
    console.log(`Total blocks to scan: ${SEVEN_DAYS_IN_BLOCKS.toLocaleString()}\n`);

    // 3. Fetch logs in chunks
    const allLiquidations: LiquidationEvent[] = [];
    let processedBlocks = 0;

    for (let i = fromBlock; i < currentBlock; i += CHUNK_SIZE) {
        const toBlock = i + CHUNK_SIZE > currentBlock ? currentBlock : i + CHUNK_SIZE;

        try {
            const logs = await publicClient.getLogs({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                event: liquidationEventAbi,
                fromBlock: i,
                toBlock: toBlock
            });

            // Process each log
            for (const log of logs) {
                const event: LiquidationEvent = {
                    blockNumber: log.blockNumber!,
                    transactionHash: log.transactionHash!,
                    victim: log.args.user!,
                    liquidator: log.args.liquidator!,
                    collateralAsset: log.args.collateralAsset!,
                    debtAsset: log.args.debtAsset!,
                    debtToCover: log.args.debtToCover!,
                    liquidatedCollateralAmount: log.args.liquidatedCollateralAmount!
                };
                allLiquidations.push(event);
            }

            processedBlocks += Number(CHUNK_SIZE);
            const progress = ((processedBlocks / Number(SEVEN_DAYS_IN_BLOCKS)) * 100).toFixed(1);
            process.stdout.write(`\r   Progress: ${progress}% | Found: ${allLiquidations.length} liquidations`);

        } catch (e: any) {
            console.error(`\n   ❌ Error fetching chunk ${i}-${toBlock}:`, e.message);
        }
    }

    console.log('\n\n✅ Fetch Complete!\n');

    // 4. Fetch timestamps for each liquidation (for analysis)
    console.log('⏰ Fetching block timestamps...');
    for (let i = 0; i < allLiquidations.length; i++) {
        try {
            const block = await publicClient.getBlock({ blockNumber: allLiquidations[i].blockNumber });
            allLiquidations[i].timestamp = Number(block.timestamp);

            if (i % 10 === 0) {
                process.stdout.write(`\r   ${i + 1}/${allLiquidations.length}`);
            }
        } catch (e) {
            // Skip if block fetch fails
        }
    }

    console.log('\n\n📈 Summary:');
    console.log(`   Total Liquidations: ${allLiquidations.length}`);
    console.log(`   Block Range: ${fromBlock} → ${currentBlock}`);
    console.log(`   Time Period: ~7 days\n`);

    // 5. Save to file
    const outputPath = './data/historical_liquidations.json';
    writeFileSync(outputPath, JSON.stringify(allLiquidations, (key, value) =>
        typeof value === 'bigint' ? value.toString() : value
        , 2));

    console.log(`💾 Saved to: ${outputPath}`);

    // 6. Display sample
    if (allLiquidations.length > 0) {
        console.log('\n📋 Sample Liquidation:');
        const sample = allLiquidations[0];
        console.log(`   Block: ${sample.blockNumber}`);
        console.log(`   Victim: ${sample.victim}`);
        console.log(`   Liquidator: ${sample.liquidator}`);
        console.log(`   Debt Covered: ${sample.debtToCover}`);
        console.log(`   TX: https://basescan.org/tx/${sample.transactionHash}`);
    }

    return allLiquidations;
}

// Run
fetchHistoricalLiquidations()
    .then(() => console.log('\n✨ Done!'))
    .catch(console.error);
