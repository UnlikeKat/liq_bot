import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import fs from 'fs/promises';
import path from 'path';
import { CONFIG } from '../bot/config.js'; // Use main config

// --- CONFIG ---
const STORAGE_PATH = path.join(process.cwd(), 'data', 'liquidation_history.json');
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

const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

// Use Dual-Lane RPCs (Premium + Reliable Public)
console.log(`🔌 Connecting to Premium RPC: ${CONFIG.RPC_URL_PREMIUM}`);
console.log(`🔌 Connecting to Public RPC: ${CONFIG.RPC_URL_PUBLIC}`);

const client1 = createPublicClient({ chain: base, transport: http(CONFIG.RPC_URL_PREMIUM) });
const client2 = createPublicClient({ chain: base, transport: http(CONFIG.RPC_URL_PUBLIC) });
const clients = [client1, client2];

// High Concurrency (25 workers)
const CONCURRENCY = 25;

interface LiquidationRecord {
    txHash: string;
    blockNumber: number;
    timestamp: number;
    user: string;
    profitUSD: number;
    insolvencyBlock?: number;
    latencyBlocks?: number;
    [key: string]: any;
}

// Helper with retries and load balancing
async function getHealthFactor(user: string, block: bigint): Promise<bigint | null> {
    for (let i = 0; i < 4; i++) {
        try {
            // Round-robinish random load balancing
            const client = clients[Math.floor(Math.random() * clients.length)];

            const [, , , , , hf] = await client.readContract({
                address: AAVE_POOL,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [user as `0x${string}`],
                blockNumber: block
            });
            return hf;
        } catch (e: any) {
            // If failed, wait a bit and retry (maybe closely hit rate limit)
            await new Promise(r => setTimeout(r, 200 * (i + 1)));
        }
    }
    return null; // All retries failed
}

/**
 * Finds the exact block a user became insolvent
 */
async function findInsolvencyBlock(user: string, liqBlock: number): Promise<number | null> {
    const liqBn = BigInt(liqBlock);

    // FAST CHECK: 200 blocks ago (~6 mins)
    const recentCheck = liqBn - 200n;
    const recentHf = await getHealthFactor(user, recentCheck);

    let low: bigint;
    let high = liqBn;

    if (recentHf !== null && recentHf >= 1e18) {
        low = recentCheck;
    } else {
        // Deep check: 50,000 blocks (~30 hours)
        low = liqBn - 50000n;
        const deepHf = await getHealthFactor(user, low);

        if (deepHf !== null && deepHf < 1e18) {
            return Number(low); // Already deep underwater
        }
    }

    // Binary Search
    let ops = 0;
    while (low + 1n < high && ops < 20) {
        ops++;
        const mid = (low + high) / 2n;
        const hf = await getHealthFactor(user, mid);

        if (hf === null) {
            high = mid; // Fail safe
            continue;
        }

        if (hf >= 1e18) {
            low = mid;
        } else {
            high = mid;
        }
    }

    return Number(high);
}

async function main() {
    console.log(`🚀 STARTING DUAL-LANE ENRICHMENT (Concurrency: ${CONCURRENCY})`);

    let records: LiquidationRecord[] = [];
    try {
        const data = await fs.readFile(STORAGE_PATH, 'utf-8');
        records = JSON.parse(data);
    } catch (e) { return; }

    const todo = records.filter(r =>
        r.insolvencyBlock === undefined &&
        Math.abs(r.profitUSD) >= 0.01
    );

    console.log(`📊 Processing ${todo.length} profitable records...`);

    let processed = 0;
    let enriched = 0;

    for (let i = 0; i < todo.length; i += CONCURRENCY) {
        const batch = todo.slice(i, i + CONCURRENCY);

        const results = await Promise.all(batch.map(async (record) => {
            const block = await findInsolvencyBlock(record.user, record.blockNumber);
            if (block) {
                record.insolvencyBlock = block;
                record.latencyBlocks = record.blockNumber - block;
                return true;
            }
            return false;
        }));

        enriched += results.filter(Boolean).length;
        processed += batch.length;

        // Save every batch
        await fs.writeFile(STORAGE_PATH, JSON.stringify(records, null, 2));

        const percent = ((processed / todo.length) * 100).toFixed(1);
        console.log(`⚡ ${percent}% (${processed}/${todo.length}) | Enriched: ${enriched}`);
    }

    console.log('✅ Done!');
}

main().catch(console.error);
