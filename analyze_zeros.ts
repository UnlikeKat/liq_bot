import fs from 'fs/promises';
import path from 'path';

async function analyze() {
    const data = JSON.parse(await fs.readFile('data/liquidation_history.json', 'utf-8'));

    console.log(`Total records: ${data.length}`);

    // 1. Analyze Zero Profits
    const zeroProfits = data.filter((r: any) => r.profitUSD === 0 || r.profitUSD === '0.00');
    console.log(`\nRecords with 0.00 Profit: ${zeroProfits.length}`);

    if (zeroProfits.length > 0) {
        console.log('Sample Zero Profit Record:');
        console.log(JSON.stringify(zeroProfits[0], null, 2));
    }

    // 2. Check price sources
    const breakdownConfig = zeroProfits[0]?.breakdown;
    console.log('\nBreakdown for Zero Profit:', breakdownConfig);

    // 3. Stats
    const profits = data.map((r: any) => Number(r.profitUSD)).filter((p: number) => !isNaN(p));
    const avg = profits.reduce((a: number, b: number) => a + b, 0) / profits.length;
    console.log(`\nAverage Profit: $${avg.toFixed(2)}`);
}

analyze();
