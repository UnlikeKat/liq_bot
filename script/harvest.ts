import { createPublicClient, http, parseAbiItem, decodeEventLog } from 'viem';
import { base } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG } from '../bot/config.js';

// --- CONFIG ---
const LOOKBACK_DAYS = 30; // Monthly Estimate
const BLOCKS_PER_DAY = 43200n;
const TOTAL_BLOCKS = BLOCKS_PER_DAY * BigInt(LOOKBACK_DAYS);
const OUT_FILE = path.join(process.cwd(), 'data', 'liquidations_30d.json');

// ABI match
const EVENT_LIQUIDATION_CALL = parseAbiItem(
    'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
);

const client = createPublicClient({
    chain: base,
    transport: http('https://base-rpc.publicnode.com'), // User provided high-speed RPC
});

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log(`🚜 HARVESTER STARTED: Scraping last ${LOOKBACK_DAYS} days...`);
    console.log(`   RPC: https://base-rpc.publicnode.com`);

    // Ensure data dir
    const dir = path.dirname(OUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const currentBlock = await client.getBlockNumber();
    const startBlock = currentBlock - TOTAL_BLOCKS;

    console.log(`   Range: ${startBlock} -> ${currentBlock} (~${TOTAL_BLOCKS} blocks)`);
    console.log(`   Output: ${OUT_FILE}\n`);

    let foundEvents: any[] = [];
    let currentPointer = startBlock;
    let chunkSize = 3000n; // Aggressive chunking for public node

    while (currentPointer < currentBlock) {
        // Cap toBlock
        let toBlock = currentPointer + chunkSize;
        if (toBlock > currentBlock) toBlock = currentBlock;

        const progress = Number(currentPointer - startBlock) * 100 / Number(TOTAL_BLOCKS);
        process.stdout.write(`\r   [${progress.toFixed(1)}%] Scan: ${currentPointer}..${toBlock} | Found: ${foundEvents.length} | Chunk: ${chunkSize}  `);

        try {
            const logs = await client.getLogs({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                event: EVENT_LIQUIDATION_CALL,
                fromBlock: currentPointer,
                toBlock: toBlock
            });

            // Process Logs
            for (const log of logs) {
                const decoded = decodeEventLog({
                    abi: [EVENT_LIQUIDATION_CALL],
                    data: log.data,
                    topics: log.topics
                });

                foundEvents.push({
                    blockNumber: log.blockNumber!.toString(),
                    transactionHash: log.transactionHash,
                    user: decoded.args.user,
                    debtToCover: decoded.args.debtToCover.toString(),
                    collateralAsset: decoded.args.collateralAsset,
                    liquidator: decoded.args.liquidator
                });
            }

            // Success: Advance pointer
            currentPointer = toBlock + 1n;

            // Adaptive: If successful and quick, maybe increase chunk size slightly? 
            // Better to stay safe.
            await sleep(100); // Friendly pause

        } catch (e: any) {
            // Failure: Reduce chunk size and retry
            const msg = e.message || 'Unknown';
            if (msg.includes('limit') || msg.includes('timeout') || msg.includes('504') || msg.includes('429')) {
                chunkSize = chunkSize / 2n;
                if (chunkSize < 100n) chunkSize = 100n; // Minimum clamp
                // console.log(`\n   ⚠️  Rate Limit! Reducing chunk to ${chunkSize}`);
                await sleep(2000); // Backoff
            } else {
                console.log(`\n   ❌ Error: ${msg}`);
                // Skip if it's a non-retriable error? No, might miss data.
                // Just retry same block with smaller chunk
                chunkSize = chunkSize / 2n;
                if (chunkSize < 100n) {
                    // Skip if chunk is tiny and still failing?
                    console.log(`   Skipping bad block range ${currentPointer}...`);
                    currentPointer += 500n;
                    chunkSize = 2000n; // Reset
                }
                await sleep(1000);
            }
        }
    }

    console.log(`\n\n✅ HARVEST COMPLETE!`);
    console.log(`   Total Events Found: ${foundEvents.length}`);
    fs.writeFileSync(OUT_FILE, JSON.stringify(foundEvents, null, 2));
    console.log(`   Saved to: ${OUT_FILE}`);
}

main().catch(console.error);
