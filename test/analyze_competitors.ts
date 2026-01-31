import * as fs from 'fs';
import * as path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'liquidations_7d.json');

async function main() {
    if (!fs.existsSync(DATA_FILE)) {
        console.log("No data file found.");
        return;
    }

    const events = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    console.log(`Analyzing ${events.length} liquidations for competitor stats...`);

    const liquidators: { [key: string]: { count: number, volume: bigint } } = {};

    // Aggregation
    for (const event of events) {
        const liq = event.liquidator;
        const debt = BigInt(event.debtToCover);

        if (!liquidators[liq]) liquidators[liq] = { count: 0, volume: 0n };
        liquidators[liq].count++;
        liquidators[liq].volume += debt;
    }

    // Sorting
    const sorted = Object.entries(liquidators).sort((a, b) => b[1].count - a[1].count);

    console.log('\n🏆 TOP COMPETITORS (Last 7 Days)');
    console.log('--------------------------------------------------');
    console.log(`Rank | Address                                    | Kills | Est. Volume (Base Units)`);
    console.log('--------------------------------------------------');

    sorted.slice(0, 5).forEach((item, index) => {
        console.log(`#${index + 1}   | ${item[0]} | ${item[1].count.toString().padEnd(5)} | ${item[1].volume.toString()}`);
    });

    console.log('\n💡 MILAN SIMULATION PARAMETERS');
    console.log('--------------------------------------------------');
    console.log('• Location: Milan, Italy (Home PC)');
    console.log('• Latency Penalty: 3 Blocks (~6 seconds)');
    console.log('• Logic: If (InsolvencyBlock + 3) < ExecutionBlock -> YOU WIN');
    console.log('• Note: "ExecutionBlock" is when the competitor actually hit it.');
}

main();
