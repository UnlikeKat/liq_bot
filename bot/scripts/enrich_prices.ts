/**
 * FAST PRICE ENRICHMENT SCRIPT
 * 
 * Instead of re-scanning 90 days of blocks (slow),
 * this loads existing liquidation transactions and just fetches
 * the missing price data from AAVE oracle.
 * 
 * Run: npx tsx bot/scripts/enrich_prices.ts
 */

import fs from 'fs/promises';
import path from 'path';
import { calculateLiquidationProfit } from '../services/profit_calculator.js';

const DATA_FILE = path.join(process.cwd(), 'data', 'liquidation_history.backup.json');
const OUTPUT_FILE = path.join(process.cwd(), 'data', 'liquidation_history.json');

async function enrichPrices() {
    console.log('🔄 Loading existing liquidation data...\n');

    // Load existing data
    const rawData = await fs.readFile(DATA_FILE, 'utf-8');
    const liquidations = JSON.parse(rawData);

    console.log(`📊 Found ${liquidations.length} liquidations to enrich`);
    console.log(`⏱️  Estimated time: ~${Math.ceil(liquidations.length / 10)} minutes\n`);

    const enriched = [];
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < liquidations.length; i++) {
        const liq = liquidations[i];

        try {
            // Calculate accurate USD profit using price oracle
            const { profitUSD, breakdown } = await calculateLiquidationProfit({
                collateralAsset: liq.collateralAsset,
                debtAsset: liq.debtAsset,
                liquidatedCollateral: liq.liquidatedCollateral,
                debtToCover: liq.debtToCover,
                blockNumber: liq.blockNumber,
                gasUsed: liq.gasUsed,
                gasPrice: liq.gasPrice
            });

            // Update record with accurate data
            enriched.push({
                ...liq,
                profitUSD,
                breakdown
            });

            successCount++;

            // Progress logging
            if ((i + 1) % 50 === 0 || i === liquidations.length - 1) {
                const percent = Math.floor(((i + 1) / liquidations.length) * 100);
                console.log(`  ✅ ${i + 1}/${liquidations.length} (${percent}%) - Success: ${successCount}, Failed: ${failCount}`);
            }

        } catch (error: any) {
            console.error(`  ❌ Failed ${liq.txHash}: ${error.message}`);
            // Keep original data if price fetch fails
            enriched.push(liq);
            failCount++;
        }

        // Small delay to avoid rate limiting
        if (i % 20 === 0 && i > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }

    // Save enriched data
    console.log('\n💾 Saving enriched data...');
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(enriched, null, 2), 'utf-8');

    console.log(`\n✅ COMPLETE!`);
    console.log(`   Total: ${enriched.length}`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Failed: ${failCount}`);
    console.log(`   Output: ${OUTPUT_FILE}\n`);

    // Show sample
    const validProfits = enriched.filter(e => e.profitUSD !== 0);
    if (validProfits.length > 0) {
        console.log('📈 Sample profits:');
        validProfits.slice(0, 5).forEach(e => {
            console.log(`   ${e.txHash.slice(0, 10)}...: $${e.profitUSD.toFixed(2)}`);
        });
    }
}

enrichPrices().catch(console.error);
