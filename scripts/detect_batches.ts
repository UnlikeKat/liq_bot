
import * as fs from 'fs';
import * as path from 'path';

const HISTORY_FILE = path.resolve('data/liquidation_history.json');

async function detectBatches() {
    console.log(`📦 BATCH DETECTION: Scanning 90-Day History...`);

    if (!fs.existsSync(HISTORY_FILE)) {
        console.error(`❌ Data Check Failed: ${HISTORY_FILE} not found.`);
        return;
    }

    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));

    // 1. Group by TxHash
    const txMap = new Map<string, number>();
    history.forEach((rec: any) => {
        const hash = rec.txHash.toLowerCase();
        txMap.set(hash, (txMap.get(hash) || 0) + 1);
    });

    let batchCount = 0;
    let taggedRecords = 0;

    // 2. Tag Records
    const updatedHistory = history.map((rec: any) => {
        const hash = rec.txHash.toLowerCase();
        const count = txMap.get(hash) || 1;

        if (count > 1) {
            rec.isBatch = true;
            rec.batchSize = count;
            taggedRecords++;
        } else {
            rec.isBatch = false;
            rec.batchSize = 1;
        }
        return rec;
    });

    // Count unique batches
    for (const count of txMap.values()) {
        if (count > 1) batchCount++;
    }

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(updatedHistory, null, 2));

    console.log(`\n✅ BATCH SCAN COMPLETE`);
    console.log(`   - Unique Batches Found: ${batchCount}`);
    console.log(`   - Total Records Tagged: ${taggedRecords}`);
    console.log(`   - Example Batch Size: ${Math.max(...Array.from(txMap.values()))}`);
}

detectBatches();
