import { fetchLiquidationsByDateRange } from '../bot/fetchers/historical_liquidations.js';
import { appendRecords } from '../bot/storage/liquidation_history.js';
import { saveSyncState } from '../bot/storage/sync_state.js';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import pLimit from 'p-limit';

config();

async function main() {
    console.log('🚀 Starting Force Resync (Last 7 Days)...');

    // 1. Define Range: Now - 7 Days
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    console.log(`📅 Fetching from: ${sevenDaysAgo.toISOString()}`);
    console.log(`📅 To:            ${now.toISOString()}`);

    // 2. Fetch
    const records = await fetchLiquidationsByDateRange(sevenDaysAgo, now, (curr, total) => {
        if (curr % 5 === 0) process.stdout.write(`\r🔍 Scanned ${curr}/${total} potential blocks...`);
    });

    console.log(`\n✅ Found ${records.length} liquidations in range.`);

    // 3. Save
    await appendRecords(records);

    // 4. Update Sync State
    const client = createPublicClient({ chain: base, transport: http(process.env.BASE_RPC_URL) });
    const block = await client.getBlockNumber();

    await saveSyncState({
        lastScannedBlock: Number(block),
        lastScannedTimestamp: Date.now()
    });

    console.log('💾 Sync State updated.');
    process.exit(0);
}

main().catch(console.error);
