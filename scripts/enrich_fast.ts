import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import fs from 'fs/promises';
import path from 'path';
import { rpcPool } from '../bot/config/rpc_pool.js';

// --- CONFIG ---
const STORAGE_PATH = path.join(process.cwd(), 'data', 'liquidation_history.json');
const POOL_ABI = parseAbi(['function getUserAccountData(address) view returns (uint256, uint256, uint256, uint256, uint256, uint256)']);
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

// Massive concurrency
const BATCH_SIZE = 50;

// Archive fallback
const archiveClient = createPublicClient({ chain: base, transport: http('https://mainnet.base.org') });

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

async function checkHealthAtBlock(user: string, block: bigint): Promise<bigint | null> {
    // Try via pool first (fastest)
    for (let attempts = 0; attempts < 3; attempts++) {
        try {
            const client = rpcPool.getClient();
            const [, , , , , hf] = await client.readContract({
                address: AAVE_POOL,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [user as `0x${string}`],
                blockNumber: block
            });
            return hf;
        } catch (e: any) {
            // Ignore if simple network error, but if node doesn't have state, it's specific
        }
    }

    // Fallback to archive if pool fails (likely "missing trie node" error)
    try {
        const [, , , , , hf] = await archiveClient.readContract({
            address: AAVE_POOL,
            abi: POOL_ABI,
            functionName: 'getUserAccountData',
            args: [user as `0x${string}`],
            blockNumber: block
        });
        return hf;
    } catch (e) {
        return null; // Totally failed
    }
}

/**
 * Finds the exact block a user became insolvent
 */
async function findInsolvencyBlock(user: string, liqBlock: number): Promise<number | null> {
    const liqBn = BigInt(liqBlock);

    // 1. FAST PATH: Check 200 blocks ago (~6 mins)
    // Most liquidations are reasonably prompt (< 5 mins latency)
    const recentCheck = liqBn - 200n;
    const recentHf = await checkHealthAtBlock(user, recentCheck);

    let low: bigint;
    let high = liqBn;

    if (recentHf !== null && recentHf >= 1e18) {
        // Was healthy 200 blocks ago. Insolvent now.
        // The event happened in this tiny window!
        low = recentCheck;
    } else {
        // Was insolvent 200 blocks ago (very late liquidation), OR check failed.
        // Search deeper.
        // Check 50,000 blocks (~30 hours)
        low = liqBn - 50000n;
        const deepHf = await checkHealthAtBlock(user, low);

        if (deepHf !== null && deepHf < 1e18) {
            // Insolvent deeply in past. Just cap it.
            return Number(low);
        }
    }

    // Binary Search
    let ops = 0;
    let result = high;

    while (low + 1n < high && ops < 20) {
        ops++;
        const mid = (low + high) / 2n;
        const hf = await checkHealthAtBlock(user, mid);

        if (hf === null) {
            // If block unreadable, assume insolvent to be safe/conservative (prevents infinite loop)
            high = mid;
            continue;
        }

        if (hf >= 1e18) {
            low = mid;
        } else {
            high = mid;
            result = mid;
        }
    }

    return Number(result);
}

async function main() {
    console.log(`🚀 STARTING HIGH-PERFORMANCE ENRICHMENT (Batch Size: ${BATCH_SIZE})`);

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

    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
        const batch = todo.slice(i, i + BATCH_SIZE);

        const promises = batch.map(async (record) => {
            const block = await findInsolvencyBlock(record.user, record.blockNumber);
            if (block) {
                record.insolvencyBlock = block;
                record.latencyBlocks = record.blockNumber - block;
                return true;
            }
            return false;
        });

        const results = await Promise.all(promises);
        enriched += results.filter(Boolean).length;
        processed += batch.length;

        // Atomic save
        await fs.writeFile(STORAGE_PATH, JSON.stringify(records, null, 2));

        const percent = ((processed / todo.length) * 100).toFixed(1);
        console.log(`⚡ ${percent}% | Batch: ${batch.length} | Enriched: ${enriched}`);
    }

    console.log('✅ Done!');
}

main().catch(console.error);
