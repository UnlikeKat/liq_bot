import * as fs from 'fs';
import * as path from 'path';

const LOG_FILE = path.join(process.cwd(), 'historical_report_30d_v3.txt');

async function main() {
    console.log(`📊 Analyzing partial log: ${LOG_FILE}`);

    if (!fs.existsSync(LOG_FILE)) {
        console.log("❌ Log file not found.");
        return;
    }

    const content = fs.readFileSync(LOG_FILE, 'utf-8');
    const lines = content.split('\n');

    let wins = 0;
    let losses = 0;
    let totalProfit = 0.0;
    let opportunities = 0;

    for (const line of lines) {
        // Parse table rows
        // Format: " 12345678 | 0xUser | [Window] | [WIN/LOSS] | [Strategy] | [Profit]"
        if (line.includes('|')) {
            const normalized = line.toUpperCase();

            // Check for result column contents
            if (normalized.includes('WIN')) {
                wins++;
                opportunities++;

                // Extract profit: Last column
                const parts = line.split('|');
                const profitPart = parts[parts.length - 1]; // " $0.50 (Gas)"

                // Sanitize: "$0.50 (Gas)" -> "0.50"
                const cleanProfit = profitPart.replace(/[^0-9.]/g, '');
                const profit = parseFloat(cleanProfit);

                if (!isNaN(profit)) {
                    totalProfit += profit;
                }
            } else if (normalized.includes('LOSS')) {
                losses++;
                opportunities++;
            }
        }
    }

    if (opportunities === 0) {
        console.log("⚠️ No processed events found in log.");
        return;
    }

    const winRate = ((wins / opportunities) * 100).toFixed(1);
    const avgProfitPerWin = wins > 0 ? totalProfit / wins : 0;

    // Extrapolation
    // We know 419 total events exist in 30 days.
    // We processed 'opportunities' events.
    // Projection = (TotalProfit / opportunities) * 419
    const projectedTotalProfit = (totalProfit / opportunities) * 419;

    console.log(`\n🔎 PARTIAL RESULTS (Sample Size: ${opportunities} events)`);
    console.log('--------------------------------------------------');
    console.log(`✅ Real Wins:        ${wins}`);
    console.log(`❌ Real Losses:      ${losses}`);
    console.log(`📈 Real Win Rate:    ${winRate}%`);
    console.log(`💰 Real Profit:      $${totalProfit.toFixed(2)}`);
    console.log('--------------------------------------------------');
    console.log(`🔮 MONTHLY PROJECTION (Extrapolated to 419 events)`);
    console.log(`🗓️  Est. Monthly Profit: $${projectedTotalProfit.toFixed(2)}`);
    console.log(`🗓️  Est. Monthly Wins:   ${Math.round((wins / opportunities) * 419)}`);
}

main();
