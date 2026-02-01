import { findBestLiquidationPair } from '../bot/executor.js';
import { config } from 'dotenv';

config();

async function main() {
    // User from Forensic Report (Jan 31, $440 profit)
    const TARGET_USER = '0xa7b0536fb02c422b209868d18447833c6980db18';

    console.log(`🕵️‍♂️ Testing Asset Discovery for ${TARGET_USER}...`);

    try {
        const start = Date.now();
        const result = await findBestLiquidationPair(TARGET_USER);
        const duration = Date.now() - start;

        if (result) {
            console.log('✅ SUCCESS');
            console.log(`   Collateral: ${result.collateral}`);
            console.log(`   Debt:       ${result.debt}`);
            console.log(`   ⏱️ Time:     ${duration}ms`);
        } else {
            console.log('❌ FAILED: Returned null (No assets found?)');
        }

    } catch (e) {
        console.error('💥 CRASHED:', e);
    }
}

main().then(() => console.log('Done'));
