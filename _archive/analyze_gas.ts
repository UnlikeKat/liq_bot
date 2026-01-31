
import * as fs from 'fs';
import * as path from 'path';
import { formatUnits } from 'viem';

// --- CONFIGURATION ---
const HISTORY_FILE = path.resolve('data/liquidation_history.json');
const ETH_PRICE = 3000; // Est. ETH Price for USD calc

async function runGasAudit() {
    console.log(`⛽ GAS CONSUMPTION AUDIT: Analyzing historical winners...`);

    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`❌ Data Check Failed: ${HISTORY_FILE} not found.`);
        return;
    }

    const rawData = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(rawData);

    // Filter out anomalies (e.g., gasUsed < 21000)
    const validRecords = history.filter((r: any) => r.gasUsed && Number(r.gasUsed) > 50000);

    const stats = {
        count: 0,
        totalGas: 0n,
        min: 999999999n,
        max: 0n,
        avg: 0n
    };

    const gasUsages: bigint[] = [];

    for (const record of validRecords) {
        const gasUsed = BigInt(record.gasUsed);
        stats.totalGas += gasUsed;
        stats.count++;
        gasUsages.push(gasUsed);

        if (gasUsed < stats.min) stats.min = gasUsed;
        if (gasUsed > stats.max) stats.max = gasUsed;
    }

    // Sort for median
    gasUsages.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const median = gasUsages[Math.floor(gasUsages.length / 2)];
    stats.avg = stats.totalGas / BigInt(stats.count);

    // --- ESTIMATES ---
    // Standard Liquidation (Self-Funded + UniV3 Swap): ~250k - 350k gas
    // Our Bot (Balancer Flash + Liquidation + UniV3 Swap):
    //   - Balancer Flashloan: ~100k - 150k overhead
    //   - Liquidation: ~200k
    //   - UniV3 Swap: ~130k
    // Total Est: ~450k - 500k

    const ourEstGas = 500000n;
    const diff = ourEstGas - median;

    console.log(`\n==================================================`);
    console.log(`⛽ GAS BENCHMARK REPORT (N=${stats.count})`);
    console.log(`--------------------------------------------------`);
    console.log(`📉 MARKET (Competitors):`);
    console.log(`   Avg Gas Used:    ${stats.avg.toString()} units`);
    console.log(`   Median Gas Used: ${median.toString()} units`);
    console.log(`   Min Gas Used:    ${stats.min.toString()} units`);
    console.log(`   Max Gas Used:    ${stats.max.toString()} units`);

    console.log(`\n🤖 YOUR BOT (Estimates):`);
    console.log(`   Base Tx (Flash + Swap): ~${ourEstGas.toString()} units`);
    console.log(`   Extra Overhead:         +${diff.toString()} units (vs Market Median)`);
    console.log(`   Est. Extra Cost:        $${(Number(formatUnits(diff * 1000000n, 18)) * ETH_PRICE / 1e9).toFixed(2)} (at 0.001 Gwei)`); // Assuming low base fee for delta example

    console.log(`\n💡 INSIGHT:`);
    console.log(`   Most winners (Self-Funded) pay ~${median} gas.`);
    console.log(`   You will pay ~${ourEstGas} gas due to Flashloan overhead.`);
    console.log(`   You need approx $${(Number(formatUnits(diff * 50000000n, 18)) * ETH_PRICE).toFixed(2)} USD more profit margin than whales to compete.`);
    console.log(`   (Calculated at 0.05 Gwei Gas Price)`);

    console.log(`==================================================\n`);

    // Write detailed report
    const reportContent = `
# ⛽ Gas Consumption Analysis
**Generated:** ${new Date().toISOString()}

## 1. Market Competitors (Whales)
*   **Strategy:** Self-Funded Inventory -> Liquidate -> Swap (UniV3)
*   **Median Gas Used:** **${median.toString()}** gwei
*   **Avg Gas Used:** **${stats.avg.toString()}** gwei

## 2. Your Bot (Retail)
*   **Strategy:** Balancer Flashloan -> Liquidate -> Swap (UniV3)
*   **Estimated Gas:** **~500,000** gwei
*   **The "Flashloan Tax":** You pay **~${diff.toString()}** more gas per tx than whales.

## 3. Impact on Profitability
At standard Base gas prices (e.g., $0.05 Gwei):
*   **Cost of Flashloan:** ~$0.02 - $0.05 USD extra.
*   **Conclusion:** The cost is negligible for any liquidation > $5 profit.
*   **Warning:** For "Dust" liquidations ($0.01 profit), you will likely lose to whales who save that gas fraction.
`;
    // fs.writeFileSync('gas_report.md', reportContent); // Optional
}

runGasAudit().catch(console.error);
