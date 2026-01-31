
import * as fs from 'fs';
import * as path from 'path';
import { formatUnits } from 'viem';

// --- CONFIGURATION ---
const HISTORY_FILE = path.resolve('data/liquidation_history.json');
const ETH_PRICE = 3000;

async function runCompetitorAudit() {
    console.log(`🦈 COMPETITOR CAPITAL ANALYSIS: Analyzing 90-day history...`);

    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`❌ Data Check Failed: ${HISTORY_FILE} not found.`);
        return;
    }

    const rawData = fs.readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(rawData);

    // Group by Liquidator
    const competitors: Record<string, {
        wins: number,
        totalProfit: number,
        maxCapital: number,
        totalCapital: number,
        txs: any[]
    }> = {};

    for (const record of history) {
        const liquidator = record.liquidator;
        if (!liquidator) continue;

        if (!competitors[liquidator]) {
            competitors[liquidator] = { wins: 0, totalProfit: 0, maxCapital: 0, totalCapital: 0, txs: [] };
        }

        const comp = competitors[liquidator];
        comp.wins++;

        // Calculate Capital Deployed (Debt Covered in USD)
        // Note: record.breakdown might not exist for old records if mixed, 
        // but we rebuilt history with breakdown. If not, estimate.
        let capitalUSD = 0;
        let profitUSD = record.profitUSD || 0;

        if (record.breakdown && record.breakdown.debtUSD) {
            capitalUSD = record.breakdown.debtUSD;
        } else {
            // Fallback estimate (rough)
            // We don't have decimals here easily without lookup, but if breakdown missing, ignore or estimate
            // Assuming breakdown exists from our Deep Audit rebuild
            capitalUSD = 0;
        }

        if (capitalUSD > comp.maxCapital) comp.maxCapital = capitalUSD;
        comp.totalCapital += capitalUSD;
        comp.totalProfit += profitUSD;

        comp.txs.push({
            hash: record.txHash,
            capital: capitalUSD,
            profit: profitUSD
        });
    }

    // Convert to Array & Sort
    const sortedCompetitors = Object.entries(competitors).map(([address, data]) => ({
        address,
        ...data,
        avgWin: data.totalProfit / data.wins
    })).sort((a, b) => b.totalProfit - a.totalProfit);

    // Classification
    let whaleCount = 0;   // > $100k Max Cap
    let dolphinCount = 0; // $10k - $100k
    let minnowCount = 0;  // < $10k

    console.log(`\n==================================================`);
    console.log(`🦈 COMPETITOR LEADERBOARD (Top 20 by Profit)`);
    console.log(`--------------------------------------------------`);
    console.log(`Rank | Liquidator | Wins | Max Capital (USD) | Class`);

    let rank = 1;
    for (const comp of sortedCompetitors) {
        let classification = "🐟 Minnow";
        if (comp.maxCapital > 100000) { classification = "🐋 WHALE"; whaleCount++; }
        else if (comp.maxCapital > 10000) { classification = "🐬 Dolphin"; dolphinCount++; }
        else { minnowCount++; }

        if (rank <= 20) {
            console.log(`#${rank.toString().padEnd(3)} | ${comp.address.slice(0, 10)}... | ${comp.wins.toString().padEnd(4)} | $${comp.maxCapital.toFixed(0).padEnd(15)} | ${classification}`);
        }
        rank++;
    }

    console.log(`\n==================================================`);
    console.log(`📊 MARKET ECOLOGY REPORT`);
    console.log(`--------------------------------------------------`);
    console.log(`🐋 Whales (>$100k Cap):   ${whaleCount} Bots`);
    console.log(`🐬 Dolphins ($10k-$100k): ${dolphinCount} Bots`);
    console.log(`🐟 Minnows (<$10k Cap):   ${minnowCount} Bots`);
    console.log(`--------------------------------------------------`);
    console.log(`Total Active Bots: ${sortedCompetitors.length}`);

    // Detailed CSV/MD generation
    const reportPath = path.resolve('competitor_analysis_report.md');
    let mdContent = `# 🦈 Competitor Analysis Report
**Generated:** ${new Date().toISOString()}
**Dataset:** 90 Days (${history.length} Liquidations)

## 📊 Market Ecology
*   **Total Active Bots:** ${sortedCompetitors.length}
*   **Whale Dominance:** The top 5 bots capture ${(sortedCompetitors.slice(0, 5).reduce((acc, c) => acc + c.totalProfit, 0) / sortedCompetitors.reduce((acc, c) => acc + c.totalProfit, 0) * 100).toFixed(1)}% of total profit.
*   **The "Self-Funded" Truth:** 
    *   **Whales:** Self-fund because they have $1M+ idle inventory.
    *   **Minnows:** Self-fund because they only target <$500 liquidations (cheap to hold).

## 🏆 Top 20 Liquidators
| Rank | Address | Wins | Max Cap (USD) | Total Profit | Class |
|------|---------|------|---------------|--------------|-------|
`;

    rank = 1;
    for (const comp of sortedCompetitors) {
        let classification = "Minnow (<$10k)";
        if (comp.maxCapital > 100000) classification = "**WHALE (>$100k)**";
        else if (comp.maxCapital > 10000) classification = "Dolphin (>$10k)";

        if (rank <= 50) {
            mdContent += `| #${rank} | \`${comp.address}\` | ${comp.wins} | $${comp.maxCapital.toFixed(2)} | $${comp.totalProfit.toFixed(2)} | ${classification} |\n`;
        }
        rank++;
    }

    fs.writeFileSync(reportPath, mdContent);
    console.log(`\n✅ Detailed report saved to: ${reportPath}`);
}

runCompetitorAudit().catch(console.error);
