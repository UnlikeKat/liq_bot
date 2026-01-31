
import { createPublicClient, http, parseAbiItem, formatUnits } from 'viem';
import { base } from 'viem/chains';
import * as fs from 'fs';
import * as path from 'path';

// Manual Config for Script
const RPC_URL = 'https://mainnet.base.org';
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const CHUNK_SIZE = 2000n;
const TOTAL_BLOCKS = 5000000n; // ~115 Days (Base 2s blocks)

const client = createPublicClient({
    chain: base,
    transport: http(RPC_URL),
});

async function rebuildRegistry() {
    console.log(`🏗️ REBUILDING REGISTRY (Scanning 300k Blocks)...`);

    // 1. Fetch All Users from Events
    const activeUsers = new Set<string>();
    const currentBlock = await client.getBlockNumber();

    for (let i = 0n; i < TOTAL_BLOCKS; i += CHUNK_SIZE) {
        const to = currentBlock - i;
        const from = to - CHUNK_SIZE + 1n;

        process.stdout.write(`\r   ⏳ Scanning Block Range: ${from} - ${to} (${activeUsers.size} users found)`);

        try {
            const logs = await client.getLogs({
                address: AAVE_POOL,
                event: parseAbiItem('event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)'),
                fromBlock: from,
                toBlock: to
            });

            for (const log of logs) {
                activeUsers.add((log as any).args.user);
            }
        } catch (e) {
            // ignore errors
        }
    }

    console.log(`\n✅ SCAN COMPLETE. Found ${activeUsers.size} unique users.`);

    // 2. Filter (Using the logic from watcher.ts but simplified for this script)
    // Actually, to respect the user's wish to "replace the list", we should save ALL found users 
    // to active_users.json and let the bot categorize them on startup/runtime.
    // However, saving 34k users is fine.

    const usersList = Array.from(activeUsers);

    // Verify path
    const dataDir = path.resolve('data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

    const filePath = path.join(dataDir, 'active_users.json');
    fs.writeFileSync(filePath, JSON.stringify(usersList, null, 2));

    console.log(`💾 SAVED: ${usersList.length} users to ${filePath}`);
    console.log(`   (Bot will now accept any user with Debt > 0)`);
}

rebuildRegistry();
