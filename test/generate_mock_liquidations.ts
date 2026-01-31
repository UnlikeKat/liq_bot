import * as fs from 'fs';
import * as path from 'path';

const OUT_FILE = path.join(process.cwd(), 'data', '217_liquidations.json');
const COUNT = 217;
const TOTAL_BLOCKS = 302400; // 7 days * 43200 blocks/day
const CURRENT_BLOCK = 41300000;

function randomAddress() {
    const chars = '0123456789abcdef';
    let addr = '0x';
    for (let i = 0; i < 40; i++) addr += chars[Math.floor(Math.random() * 16)];
    return addr;
}

function generate() {
    const events = [];

    for (let i = 0; i < COUNT; i++) {
        // Random block in last 7 days
        const age = Math.floor(Math.random() * TOTAL_BLOCKS);
        const blockNumber = CURRENT_BLOCK - age;

        events.push({
            blockNumber: BigInt(blockNumber).toString(), // Store as string for JSON
            user: { id: randomAddress() },
            debtToCover: Math.floor(Math.random() * 10000 * 1e6).toString(), // Up to 10k USDC
            liquidator: randomAddress()
        });
    }

    // Sort by block descending
    events.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));

    // Ensure dir exists
    const dir = path.dirname(OUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(OUT_FILE, JSON.stringify(events, null, 2));
    console.log(`✅ Generated ${events.length} mock liquidation events in ${OUT_FILE}`);
}

generate();
