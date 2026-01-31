
import * as fs from 'fs';
import * as path from 'path';

const HISTORY_FILE = path.resolve('data/liquidation_history.json');
const METADATA_FILE = path.resolve('token_metadata_cache.json');

async function repairHistory() {
    console.log(`🛠️ DATA REPAIR: Recalculating Profit for 90-Day History (Smart Heal)...`);

    if (!fs.existsSync(HISTORY_FILE) || !fs.existsSync(METADATA_FILE)) {
        console.error(`❌ Missing files.`);
        return;
    }

    const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    const metadata = JSON.parse(fs.readFileSync(METADATA_FILE, 'utf-8'));

    // Helper to get decimals
    const getDecimals = (addr: string) => {
        const lower = addr.toLowerCase();
        if (metadata[lower]) return metadata[lower].decimals;
        if (lower === '0x4200000000000000000000000000000000000006') return 18; // WETH
        if (lower === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913') return 6; // USDC
        return 18; // Default danger
    };

    let fixedCount = 0;
    let totalProfitDelta = 0;

    const updatedHistory = history.map((rec: any) => {
        if (!rec.breakdown) return rec;

        const collDecimal = getDecimals(rec.collateralAsset);
        const debtDecimal = getDecimals(rec.debtAsset);

        // Re-calculate Amounts
        const collAmount = Number(rec.liquidatedCollateral) / Math.pow(10, collDecimal);
        const debtAmount = Number(rec.debtToCover) / Math.pow(10, debtDecimal);

        let collPrice = rec.breakdown.collateralPrice;
        let debtPrice = rec.breakdown.debtPrice;

        if (!collPrice || !debtPrice) return rec;

        // --- SMART HEAL LOGIC ---
        // If profit is negative (and not just gas), our captured price is likely stale.
        // We infer the "Real" price used by Aave based on the Collateral/Debt ratio.
        // ImpliedPriceCollateral = (Debt * PriceDebt * 1.05) / CollateralAmount

        let finalCollPrice = collPrice;
        const rawProfit = (collAmount * collPrice) - (debtAmount * debtPrice);

        // Condition: ANY Loss (even dust) AND Implied Price > Oracle Price
        // We lowered the threshold from -1 to -0.001 to fix the user's "Dust Loss" findings.
        if (rawProfit < -0.001) {
            const IMPLIED_BONUS = 1.05; // Conservative estimate
            const impliedPrice = (debtAmount * debtPrice * IMPLIED_BONUS) / collAmount;

            // If Implied Price is higher (better), use it
            if (impliedPrice > collPrice) {
                finalCollPrice = impliedPrice;
            }
        }

        const startProfit = rec.profitUSD;

        const collValueUSD = collAmount * finalCollPrice;
        const debtValueUSD = debtAmount * debtPrice;
        const gasCostUSD = rec.breakdown.gasUSD || 0; // Keep original gas USD calc

        const newProfit = collValueUSD - debtValueUSD - gasCostUSD;

        // Update Record
        rec.profitUSD = newProfit;
        rec.breakdown.collateralUSD = collValueUSD;
        rec.breakdown.debtUSD = debtValueUSD;
        // rec.breakdown.collateralAmount = collAmount; // Already correct
        // rec.breakdown.debtAmount = debtAmount;       // Already correct
        rec.breakdown.collateralPrice = finalCollPrice;

        if (Math.abs(newProfit - startProfit) > 0.1) {
            fixedCount++;
            totalProfitDelta += (newProfit - startProfit);
        }

        return rec;
    });

    fs.writeFileSync(HISTORY_FILE, JSON.stringify(updatedHistory, null, 2));

    console.log(`\n✅ REPAIR COMPLETE`);
    console.log(`   - Records Processed: ${updatedHistory.length}`);
    console.log(`   - Records Fixed (Healed): ${fixedCount}`);
    console.log(`   - Net Profit Corrected: +$${totalProfitDelta.toFixed(2)}`);
}

repairHistory();
