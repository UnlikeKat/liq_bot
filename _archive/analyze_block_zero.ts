
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';
import * as fs from 'fs';
import * as path from 'path';

// --- CONFIGURATION ---
const HISTORY_FILE = path.resolve('data/liquidation_history.json');
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

// Minimal ABI for health check
const POOL_ABI = [{
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserAccountData',
    outputs: [
        { name: 'totalCollateralBase', type: 'uint256' },
        { name: 'totalDebtBase', type: 'uint256' },
        { name: 'availableBorrowsBase', type: 'uint256' },
        { name: 'currentLiquidationThreshold', type: 'uint256' },
        { name: 'ltv', type: 'uint256' },
        { name: 'healthFactor', type: 'uint256' }
    ],
    stateMutability: 'view',
    type: 'function'
}] as const;

async function runBlockZeroAudit() {
    console.log(`⏱️ BLOCK 0 LATENCY AUDIT: Analyzing Whales vs Minnows...`);

    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`❌ Data Check Failed: ${HISTORY_FILE} not found.`);
        return;
    }

    const rawData = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(rawData);

    // Filter Target Txs
    // We analyze ALL Whale Txs and a sample of Minnow Txs (for comparison speed)
    const whaleTxs = history.filter((r: any) => WHALES.includes(r.liquidator.toLowerCase()));
    const otherTxs = history.filter((r: any) => !WHALES.includes(r.liquidator.toLowerCase()));

    // Sample "Rest" 
    const minnowSample = otherTxs.sort(() => 0.5 - Math.random()).slice(0, 50);

    const stats = {
        whales: { total: 0, block0: 0, block1: 0, block2plus: 0, missingData: 0 },
        minnows: { total: 0, block0: 0, block1: 0, block2plus: 0, missingData: 0 },
    };

    // Helper to determine latency
    async function getLatency(tx: any): Promise<number | null> {
        // 1. Use existing data if available
        if (tx.latencyBlocks !== undefined && tx.latencyBlocks !== null) {
            return Number(tx.latencyBlocks);
        }

        // 2. Calculate if missing (Simplified "Fast Check")
        // Check HF at LiquidationBlock - 1. If < 1, then it was insolvent BEFORE.
        // Check HF at LiquidationBlock - 2. If < 1, then it was insolvent EVEN EARLIER.
        // If HF > 1 at Block - 1, then Latency is 0 (Insolvent THIS block).
        try {
            const blockNum = BigInt(tx.blockNumber);

            // Check Block - 1
            const dataMinus1 = await client.readContract({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [tx.user as `0x${string}`],
                blockNumber: blockNum - 1n
            });
            const hfMinus1 = Number(dataMinus1[5]) / 1e18;

            if (hfMinus1 >= 1.0) {
                return 0; // It became insolvent at the current block
            }

            // If already insolvent at -1, check -2
            const dataMinus2 = await client.readContract({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [tx.user as `0x${string}`],
                blockNumber: blockNum - 2n
            });
            const hfMinus2 = Number(dataMinus2[5]) / 1e18;

            if (hfMinus2 >= 1.0) return 1; // Became insolvent at -1

            // If already insolvent at -2, it's > 1
            // We can check -5 to be sure it's "Late"
            return 5; // Placeholder for "Late" (2+)

        } catch (e) {
            return null;
        }
    }

    async function processGroup(name: string, txs: any[], metrics: any) {
        console.log(`\n🔍 Analyzing ${name} (${txs.length} txs)...`);

        for (let i = 0; i < txs.length; i++) {
            const tx = txs[i];
            const latency = await getLatency(tx);

            if (latency === null) {
                metrics.missingData++;
                continue;
            }

            metrics.total++;
            if (latency === 0) metrics.block0++;
            else if (latency === 1) metrics.block1++;
            else metrics.block2plus++;

            if (i % 5 === 0) process.stdout.write('.');

            // Rate limit
            await new Promise(r => setTimeout(r, 50));
        }
    }

    await processGroup("🐋 Whales", whaleTxs.slice(0, 50), stats.whales); // Sample 50 for speed
    await processGroup("🐟 Minnows", minnowSample, stats.minnows);

    console.log(`\n\n==================================================`);
    console.log(`⏱️ BLOCK 0 vs BLOCK 1+ REPORT`);
    console.log(`--------------------------------------------------`);

    function printStats(name: string, m: any) {
        console.log(`${name} (N=${m.total})`);
        console.log(`   - Block 0 (Instant):   ${m.block0} (${((m.block0 / m.total) * 100).toFixed(1)}%)`);
        console.log(`   - Block 1 (Next Blok): ${m.block1} (${((m.block1 / m.total) * 100).toFixed(1)}%)`);
        console.log(`   - Block 2+ (Late):     ${m.block2plus} (${((m.block2plus / m.total) * 100).toFixed(1)}%)`);
    }

    printStats("🐋 WHALES", stats.whales);
    console.log("");
    printStats("🐟 MINNOWS", stats.minnows);
    console.log(`==================================================\n`);

    // Save report
    fs.writeFileSync('block_zero_report.md', `
# ⏱️ Block 0 Latency Analysis
**Do Whales liquidate in the same block?**

## Whales (Top 5)
*   **Block 0 (Instant):** ${((stats.whales.block0 / stats.whales.total) * 100).toFixed(1)}%
*   **Block 1 (Next):**    ${((stats.whales.block1 / stats.whales.total) * 100).toFixed(1)}%
*   **Late (>2 Blocks):**  ${((stats.whales.block2plus / stats.whales.total) * 100).toFixed(1)}%

## Minnows (Rest)
*   **Block 0 (Instant):** ${((stats.minnows.block0 / stats.minnows.total) * 100).toFixed(1)}%
*   **Block 1 (Next):**    ${((stats.minnows.block1 / stats.minnows.total) * 100).toFixed(1)}%
*   **Late (>2 Blocks):**  ${((stats.minnows.block2plus / stats.minnows.total) * 100).toFixed(1)}%

## Conclusion
${stats.whales.block0 > stats.whales.block1 ?
            "**Whales are faster.** They prioritize the immediate block." :
            "**Whales are surprisingly slow.** They verify solvency in Block 0 and land in Block 1."}
`);
}

runBlockZeroAudit().catch(console.error);
