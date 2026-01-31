import { createPublicClient, http, parseAbiItem } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from './bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL),
});

const DATA_DIR = path.join(process.cwd(), 'data');
const OUT_FILE = path.join(DATA_DIR, 'active_users.json');

// Configuration
const LOOKBACK_DAYS = 30;
const BLOCKS_PER_DAY = 43200n;
const TOTAL_BLOCKS = BLOCKS_PER_DAY * BigInt(LOOKBACK_DAYS);
const CHUNK_SIZE = 10n;
const CONCURRENCY = 3; // Reduced to 3 to avoid 429

async function wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Wrapper for initial connection
async function getSafeBlockNumber() {
    let retries = 5;
    while (retries > 0) {
        try {
            return await client.getBlockNumber();
        } catch (e: any) {
            console.log(`⚠️  RPC Init failed (${e.message?.slice(0, 20)}...). Retrying in 5s...`);
            await wait(5000);
            retries--;
        }
    }
    throw new Error("Could not connect to RPC after 5 retries.");
}

async function fetchChunk(from: bigint, to: bigint): Promise<Set<string>> {
    const users = new Set<string>();
    try {
        const logs = await client.getLogs({
            address: CONFIG.AAVE_POOL as `0x${string}`,
            event: parseAbiItem('event Borrow(address indexed reserve, address indexed user, address indexed onBehalfOf, uint256 amount, uint256 interestRateMode, uint256 borrowRate, uint256 referralCode)'),
            fromBlock: from,
            toBlock: to
        });
        for (const log of logs) {
            if (log.args.onBehalfOf) users.add(log.args.onBehalfOf);
        }
    } catch (e: any) {
        if (e.message?.includes('429') || e.message?.includes('Too Many Requests')) {
            throw new Error('RATE_LIMIT');
        }
    }
    return users;
}

async function main() {
    console.log("🌱 Aave V3 User Seeder (Parallel Mode)");
    console.log(`Target: Last ${LOOKBACK_DAYS} days (~${TOTAL_BLOCKS.toLocaleString()} blocks)`);
    console.log(`Strategy: ${CHUNK_SIZE}-block chunks, ${CONCURRENCY} concurrent requests`);

    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

    try {
        const currentBlock = await getSafeBlockNumber();
        const startBlock = currentBlock - TOTAL_BLOCKS;
        const totalUsers = new Set<string>();

        let processedBlocks = 0n;

        // Loop backwards
        for (let batchEnd = currentBlock; batchEnd > startBlock; batchEnd -= (CHUNK_SIZE * BigInt(CONCURRENCY))) {
            const promises = [];

            // Create batch of promises
            for (let i = 0; i < CONCURRENCY; i++) {
                const to = batchEnd - (CHUNK_SIZE * BigInt(i));
                if (to <= startBlock) break;

                const from = to - CHUNK_SIZE + 1n;
                // Ensure we don't go below startBlock (though logic above handles it mostly)
                const safeFrom = from > startBlock ? from : startBlock;

                promises.push(fetchChunk(safeFrom, to));
            }

            try {
                const results = await Promise.all(promises);

                // Aggregate results
                results.forEach(chunkUsers => {
                    chunkUsers.forEach(u => totalUsers.add(u));
                });

                processedBlocks += (CHUNK_SIZE * BigInt(promises.length));

                const percent = (Number(processedBlocks) / Number(TOTAL_BLOCKS) * 100).toFixed(2);
                process.stdout.write(`\r[${percent}%] Scanned ${processedBlocks} blocks... Found ${totalUsers.size} users`);

                // Dynamic Delay: rapid request handling
                await new Promise(resolve => setTimeout(resolve, 200));

            } catch (e: any) {
                if (e.message === 'RATE_LIMIT') {
                    console.log('\n⏳ Rate limited. Backing off for 5s...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    // Ideally retry this batch, but for simplicity we continue (small data loss acceptable for speed)
                }
            }

            // Save periodically
            if (Number(processedBlocks) % 10000 === 0) {
                fs.writeFileSync(OUT_FILE, JSON.stringify(Array.from(totalUsers), null, 2));
            }
        }

        console.log(`\n\n✅ DONE! Found ${totalUsers.size} active users.`);
        fs.writeFileSync(OUT_FILE, JSON.stringify(Array.from(totalUsers), null, 2));

    } catch (error) {
        console.error("Fatal:", error);
    }
}

main();
