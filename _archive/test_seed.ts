import { parseAbiItem } from 'viem';
import { publicClient, CONFIG } from '../bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'active_users_test.json');
const CHUNK_SIZE = 5000n;
const SCAN_BLOCKS = 100000n; // 100k blocks for quick verification

async function testSeed() {
    console.log(`\n🧪 TEST SEEDER: Scanning last ${SCAN_BLOCKS} blocks...`);

    let activeUsers = new Set<string>();

    const currentBlock = await publicClient.getBlockNumber();
    const startBlock = currentBlock - SCAN_BLOCKS;

    console.log(`   📦 Range: ${startBlock} to ${currentBlock}`);

    let processedBlocks = 0n;

    for (let from = currentBlock; from > startBlock; from -= CHUNK_SIZE) {
        const toBlock = from;
        const fromBlock = (from - CHUNK_SIZE) < startBlock ? startBlock : (from - CHUNK_SIZE);

        try {
            const logs = await publicClient.getLogs({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                event: parseAbiItem('event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)'),
                fromBlock,
                toBlock
            });

            logs.forEach(log => {
                if (log.args.onBehalfOf) {
                    activeUsers.add(log.args.onBehalfOf.toLowerCase());
                }
            });

            processedBlocks += (toBlock - fromBlock);
            const progress = ((Number(processedBlocks) / Number(SCAN_BLOCKS)) * 100).toFixed(2);

            process.stdout.write(`\r   ⏳ Progress: ${progress}% | Total Users Found: ${activeUsers.size} `);

        } catch (error: any) {
            console.error(`\n   ❌ Error at ${fromBlock}:`, error.message);
        }
    }

    console.log('\n\n✅ TEST COMPLETE!');
    console.log(`🚀 Found ${activeUsers.size} users in 100k blocks.`);
}

testSeed().catch(console.error);
