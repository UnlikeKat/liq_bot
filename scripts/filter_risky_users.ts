import { formatUnits, parseAbiItem } from 'viem';
import { publicClient, CONFIG } from '../bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

const SRC_FILE = path.join(process.cwd(), 'data', 'active_users.json');
const KILL_LIST_FILE = path.join(process.cwd(), 'data', 'kill_list.json');
const SAFE_USERS_FILE = path.join(process.cwd(), 'data', 'safe_users.json');

const BATCH_SIZE = 100;
const RISKY_HF_THRESHOLD = 1.5; // Promote to Kill List if < 1.5
const MIN_DEBT_USD = 50; // Filter out dust

const POOL_ABI = [
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

async function filterUsers() {
    console.log(`\n🔍 TIERED FILTER: Categorizing seeded users...`);
    console.log(`   Thresholds: Risky < ${RISKY_HF_THRESHOLD}, Safe >= ${RISKY_HF_THRESHOLD} (Min Debt $${MIN_DEBT_USD})`);

    if (!fs.existsSync(SRC_FILE)) {
        console.error(`❌ Source file missing: ${SRC_FILE}`);
        return;
    }

    const raw = fs.readFileSync(SRC_FILE, 'utf-8');
    const allUsers: string[] = JSON.parse(raw);
    console.log(`   📂 Loaded ${allUsers.length.toLocaleString()} potential users.`);

    const killList: string[] = [];
    const safeUsers: string[] = [];
    let processed = 0;

    for (let i = 0; i < allUsers.length; i += BATCH_SIZE) {
        const batch = allUsers.slice(i, i + BATCH_SIZE);

        try {
            const results = await publicClient.multicall({
                contracts: batch.map(addr => ({
                    address: CONFIG.AAVE_POOL as `0x${string}`,
                    abi: POOL_ABI,
                    functionName: 'getUserAccountData',
                    args: [addr as `0x${string}`]
                })),
                allowFailure: true
            });

            results.forEach((res, index) => {
                if (res.status === 'success' && res.result) {
                    const [, totalDebtBase, , , , healthFactor] = res.result;
                    const totalDebtUSD = Number(formatUnits(totalDebtBase, 8));
                    const hf = Number(formatUnits(healthFactor, 18));

                    if (totalDebtUSD >= MIN_DEBT_USD) {
                        const addr = batch[index].toLowerCase();
                        if (hf > 0 && hf < RISKY_HF_THRESHOLD) {
                            killList.push(addr);
                        } else {
                            safeUsers.push(addr);
                        }
                    }
                }
            });

            processed += batch.length;
            const percent = ((processed / allUsers.length) * 100).toFixed(1);
            process.stdout.write(`\r   ⏳ Progress: ${percent}% | Risky: ${killList.length} | Safe: ${safeUsers.length} `);

        } catch (error: any) {
            console.error(`\n   ❌ Batch error at ${i}:`, error.message);
            await new Promise(r => setTimeout(r, 1000));
        }
    }

    // Save lists
    const dir = path.dirname(KILL_LIST_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(KILL_LIST_FILE, JSON.stringify(Array.from(new Set(killList)), null, 2));
    fs.writeFileSync(SAFE_USERS_FILE, JSON.stringify(Array.from(new Set(safeUsers)), null, 2));

    console.log(`\n\n✅ TIERED FILTER COMPLETE!`);
    console.log(`📊 Scanned: ${allUsers.length.toLocaleString()}`);
    console.log(`🔥 Kill List: ${killList.length.toLocaleString()} (Direct Monitoring)`);
    console.log(`🧊 Safe List: ${safeUsers.length.toLocaleString()} (Auditor Monitoring)`);
    console.log(`📂 Saved to data/kill_list.json and data/safe_users.json`);
}

filterUsers().catch(console.error);
