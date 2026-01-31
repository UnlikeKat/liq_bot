import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';
import { loadHistory, saveHistory } from '../bot/storage/liquidation_history.js';
import pLimit from 'p-limit';

const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC)
});

async function main() {
    const history = await loadHistory();
    const missing = history.filter(h => h.positionInBlock === undefined);

    console.log(`🔍 Found ${missing.length} records missing block position.`);

    // Limit concurrency to avoid rate limits
    const limit = pLimit(5);
    let updatedCount = 0;

    const tasks = missing.map(record => limit(async () => {
        try {
            const receipt = await client.getTransactionReceipt({
                hash: record.txHash as `0x${string}`
            });

            record.positionInBlock = receipt.transactionIndex;
            updatedCount++;

            if (updatedCount % 50 === 0) {
                console.log(`✅ Progress: ${updatedCount}/${missing.length}`);
            }
        } catch (error) {
            console.error(`❌ Failed to fetch for ${record.txHash}:`, error);
        }
    }));

    await Promise.all(tasks);

    console.log(`💾 Saving ${updatedCount} updated records...`);
    await saveHistory(history);
    console.log('🎉 Done!');
}

main().catch(console.error);
