import { parseAbiItem } from 'viem';
import { publicClient, CONFIG } from '../bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'active_users.json');
const CHUNK_SIZE = 5000n;
const SCAN_DAYS = 90;
const BLOCKS_PER_DAY = 43200n; // 2s block time => 24 * 60 * 30 = 43200
const TOTAL_BLOCKS = BLOCKS_PER_DAY * BigInt(SCAN_DAYS);

async function seedUsers() {
    console.log(`\n🌱 SEEDER: Scanning last ${SCAN_DAYS} days (~${TOTAL_BLOCKS} blocks)...`);

    // 1. Load existing users
    let activeUsers = new Set<string>();
    if (fs.existsSync(DATA_FILE)) {
        try {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const data = JSON.parse(raw);
            activeUsers = new Set(data);
            console.log(`   📂 Loaded ${activeUsers.size} existing users.`);
        } catch (e) {
            console.error('   ⚠️ Could not parse existing data file.');
        }
    }

    const currentBlock = await publicClient.getBlockNumber();
    const startBlock = currentBlock - TOTAL_BLOCKS;

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
            const progress = ((Number(processedBlocks) / Number(TOTAL_BLOCKS)) * 100).toFixed(2);
            const daysScanned = (Number(processedBlocks) / Number(BLOCKS_PER_DAY)).toFixed(1);

            process.stdout.write(`\r   ⏳ Progress: ${progress}% (Day ${daysScanned}/${SCAN_DAYS}) | Total Users: ${activeUsers.size} `);

            // Save periodically
            if ((toBlock - fromBlock) > 0 && processedBlocks % (BLOCKS_PER_DAY * 5n) === 0n) {
                saveUsers(activeUsers);
            }

        } catch (error: any) {
            console.error(`\n   ❌ Error fetching logs at block ${fromBlock}:`, error.message);
            // Throttle on error
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    console.log('\n\n✅ SEEDING COMPLETE!');
    saveUsers(activeUsers);
}

function saveUsers(users: Set<string>) {
    const dir = path.dirname(DATA_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(DATA_FILE, JSON.stringify(Array.from(users), null, 2));
    // console.log(`\n   💾 Saved ${users.size} unique users to ${DATA_FILE}`);
}

seedUsers().catch(console.error);
