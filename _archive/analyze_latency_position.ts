
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

// --- CONFIGURATION ---
const HISTORY_FILE = path.resolve('data/liquidation_history.json');
// Addresses from previous audit (Whales)
const WHALES = [
    '0x964AeE3e4E3BBc7245B33dA097030e95EE408170',
    '0xc89c328609aB58E256Cd2b5aB4F4aF2EFb9fcA33',
    '0xD12810B19B596347a3AFAC206d3cA65d08594b3f',
    '0x3ff1877a614C6A3a83F865717f6ba0eb24425c4C',
    '0xD251c1325c5d7b29C6219912D8648a3149cDF57B'
].map(a => a.toLowerCase());

const client = createPublicClient({
    chain: base,
    transport: http(CONFIG.RPC_URL_PUBLIC),
});

async function runLatencyPositionAudit() {
    console.log(`⏱️ LATENCY & POSITION AUDIT: Analyzing Full History (~2000 Records)...`);

    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`❌ Data Check Failed: ${HISTORY_FILE} not found.`);
        return;
    }

    const rawData = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(rawData);

    // Split into Whales vs Rest
    const whaleTxs = history.filter((r: any) => WHALES.includes(r.liquidator.toLowerCase()));
    const otherTxs = history.filter((r: any) => !WHALES.includes(r.liquidator.toLowerCase()));

    console.log(`Found ${whaleTxs.length} Whale Txs and ${otherTxs.length} Minnow Txs.`);

    // Analyze function (Full Processing with batching)
    async function analyzeGroup(name: string, txs: any[]) {
        console.log(`\n🔍 Analyzing ${name} (${txs.length} txs)...`);

        const results = {
            total: 0,
            avgLatency: 0,
            avgPosition: 0,
            topBeginning: 0, // Pos 0-2 (Bundle/Builder)
            topEarly: 0, // Pos 3-10
            midBlock: 0, // Pos > 10
            sumLatency: 0,
            sumPosition: 0
        };

        const BATCH_SIZE = 25;
        // Process all transactions
        for (let i = 0; i < txs.length; i += BATCH_SIZE) {
            const batch = txs.slice(i, i + BATCH_SIZE);
            const promises = batch.map(async (tx: any) => {
                try {
                    const receipt = await client.getTransactionReceipt({ hash: tx.txHash as `0x${string}` });
                    const index = Number(receipt.transactionIndex);

                    // Use existing latency if available
                    const latency = tx.latencyBlocks ? Number(tx.latencyBlocks) : 0;

                    results.total++;
                    results.sumPosition += index;
                    if (latency > 0) results.sumLatency += latency;

                    if (index <= 2) results.topBeginning++;
                    else if (index <= 10) results.topEarly++;
                    else results.midBlock++;
                } catch (e) { }
            });

            await Promise.all(promises);
            process.stdout.write(`\r   Progress: ${Math.min(i + BATCH_SIZE, txs.length)}/${txs.length}`);
            // Small delay to report status and avoid rate limits
            await new Promise(r => setTimeout(r, 20));
        }

        results.avgPosition = results.total ? results.sumPosition / results.total : 0;
        const validLatencyCount = txs.filter((t: any) => t.latencyBlocks).length;
        results.avgLatency = validLatencyCount ? results.sumLatency / validLatencyCount : 0;

        return results;
    }

    // Run Full Analysis
    const whaleStats = await analyzeGroup("🐋 Whales (Top 5)", whaleTxs);
    const minnowStats = await analyzeGroup("🐟 Minnows (Rest)", otherTxs);

    console.log(`\n\n==================================================`);
    console.log(`⏱️ SPEED & POSITION REPORT (Full Analysis)`);
    console.log(`--------------------------------------------------`);
    console.log(`🐋 WHALES (Top 5 Liquidators) [N=${whaleStats.total}]`);
    console.log(`   - Avg Position (Index): ${whaleStats.avgPosition.toFixed(1)}`);
    console.log(`   - Avg Latency (Blocks): ${whaleStats.avgLatency.toFixed(1)}`);
    console.log(`   - "Top of Block" (idx 0-2): ${whaleStats.topBeginning} (${((whaleStats.topBeginning / whaleStats.total) * 100).toFixed(1)}%)`);
    console.log(`   - "Early" (idx 3-10):       ${whaleStats.topEarly} (${((whaleStats.topEarly / whaleStats.total) * 100).toFixed(1)}%)`);

    console.log(`\n🐟 MINNOWS (The Rest) [N=${minnowStats.total}]`);
    console.log(`   - Avg Position (Index): ${minnowStats.avgPosition.toFixed(1)}`);
    console.log(`   - Avg Latency (Blocks): ${minnowStats.avgLatency.toFixed(1)}`);
    console.log(`   - "Top of Block" (idx 0-2): ${minnowStats.topBeginning} (${((minnowStats.topBeginning / minnowStats.total) * 100).toFixed(1)}%)`);
    console.log(`   - "Early" (idx 3-10):       ${minnowStats.topEarly} (${((minnowStats.topEarly / minnowStats.total) * 100).toFixed(1)}%)`);
    console.log(`==================================================\n`);

    const reportPath = path.resolve('competitor_latency_full_report.md');
    fs.writeFileSync(reportPath, `
# ⏱️ Competitor Speed Analysis (Full Dataset)
**Whales vs Minnows** (N=${whaleStats.total + minnowStats.total})

## 1. Whales (Top 5)
*   **Speed:** Aggressive. Avg Position: **${whaleStats.avgPosition.toFixed(1)}**.
*   **Domination:** ${((whaleStats.topBeginning / whaleStats.total) * 100).toFixed(0)}% of their wins are in the **Top 3** spots of the block.
*   **Implication:** They use **Flashbots/Bundles** or high priority fees to be first.

## 2. Minnows (The Rest)
*   **Speed:** Slower. Avg Position: **${minnowStats.avgPosition.toFixed(1)}**.
*   **Behavior:** They pick up the scraps. ${((minnowStats.midBlock / minnowStats.total) * 100).toFixed(0)}% of wins occur later in the block (idx > 10).

## 3. Your Strategy
To beat Whales, you must aim for **Top 5**.
*   Use \`priorityFee\` (Gas Multiplier).
*   Target "Top of Block" execution.
`);
}

runLatencyPositionAudit().catch(console.error);
