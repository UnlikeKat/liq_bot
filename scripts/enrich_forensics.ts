import { createPublicClient, http, parseAbi } from 'viem';
import { base } from 'viem/chains';
import fs from 'fs/promises';
import path from 'path';

// --- CONFIG ---
// Use the endpoint we verified supports archive
const ARCHIVE_RPC = 'https://mainnet.base.org';
const client = createPublicClient({ chain: base, transport: http(ARCHIVE_RPC) });

const STORAGE_PATH = path.join(process.cwd(), 'data', 'liquidation_history.json');
const POOL_ABI = parseAbi(['function getUserAccountData(address) view returns (uint256, uint256, uint256, uint256, uint256, uint256)']);
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

interface LiquidationRecord {
    txHash: string;
    blockNumber: number;
    timestamp: number;
    user: string;
    insolvencyBlock?: number;
    latencyBlocks?: number;
    [key: string]: any;
}

/**
 * Finds the exact block a user became insolvent using binary search
 */
async function findInsolvencyBlock(user: string, liqBlock: number): Promise<number | null> {
    const liqBn = BigInt(liqBlock);

    // HEURISTIC: Most liquidations arrive within 24h (43k blocks)
    // But some are VERY late. We check 10 blocks ago first to see if it was instant.
    // Then 1000, then 40k.

    let healthy = liqBn - 50000n; // ~27 hours ago
    let insolvent = liqBn;

    // Helper to check state
    const checkState = async (block: bigint) => {
        try {
            const [, , , , , hf] = await client.readContract({
                address: AAVE_POOL,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [user as `0x${string}`],
                blockNumber: block
            });
            return hf;
        } catch (e) {
            return 0n; // Assume broken/insolvent if call fails
        }
    };

    // Optimization: Check if already insolvent at start
    const startHf = await checkState(healthy);
    if (startHf < 1e18) {
        // User underwater for > 27 hours? That's insane but possible.
        // Let's widen the search to 7 days
        healthy = liqBn - 300000n;
        const deepHf = await checkState(healthy);
        if (deepHf < 1e18) {
            // Too deep, just cap it
            return Number(healthy);
        }
    }

    // Binary Search
    let ops = 0;
    while (healthy + 1n < insolvent && ops < 25) {
        ops++;
        const mid = (healthy + insolvent) / 2n;
        const hf = await checkState(mid);

        if (hf >= 1e18) {
            healthy = mid;
        } else {
            insolvent = mid;
        }
    }

    return Number(insolvent);
}

async function main() {
    console.log('🕵️ STARTING FORENSIC ENRICHMENT OF LIQUIDATION HISTORY (This may take a while)...');

    let records: LiquidationRecord[] = [];
    try {
        const data = await fs.readFile(STORAGE_PATH, 'utf-8');
        records = JSON.parse(data);
    } catch (e) {
        console.error('❌ Failed to load history');
        return;
    }

    const total = records.length;
    let processed = 0;
    let enriched = 0;
    let skipped = 0;

    // Filter for needed records AND profitable ones (> $0.01)
    const todo = records.filter(r =>
        r.insolvencyBlock === undefined &&
        Math.abs(r.profitUSD) >= 0.01
    );
    console.log(`📊 Found ${todo.length} profitable records needing forensic analysis (skipped ${total - todo.length} low-value/done records).`);

    if (todo.length === 0) {
        console.log('✅ All records already enriched!');
        return;
    }

    // Process in batches
    const BATCH_SIZE = 5; // Parallel requests

    for (let i = 0; i < todo.length; i += BATCH_SIZE) {
        const batch = todo.slice(i, i + BATCH_SIZE);

        const promises = batch.map(async (record) => {
            try {
                const insolvencyBlock = await findInsolvencyBlock(record.user, record.blockNumber);
                if (insolvencyBlock) {
                    record.insolvencyBlock = insolvencyBlock;
                    record.latencyBlocks = record.blockNumber - insolvencyBlock;
                    return true;
                }
            } catch (e) {
                console.error(`⚠️ Error analyzing ${record.txHash}:`, e);
            }
            return false;
        });

        const results = await Promise.all(promises);
        enriched += results.filter(Boolean).length;
        processed += batch.length;

        // Progress update
        process.stdout.write(`\r⏳ Progress: ${processed}/${todo.length} (${((processed / todo.length) * 100).toFixed(1)}%) | Enriched: ${enriched}`);

        // Save every 20 records (4 batches)
        if (processed % 20 === 0) {
            await fs.writeFile(STORAGE_PATH, JSON.stringify(records, null, 2));
        }

        // Rate limit pause
        await new Promise(r => setTimeout(r, 200));
    }

    // Final Save
    await fs.writeFile(STORAGE_PATH, JSON.stringify(records, null, 2));
    console.log(`\n\n✅ DONE! Enriched ${enriched} records with forensic data.`);
}

main().catch(console.error);
