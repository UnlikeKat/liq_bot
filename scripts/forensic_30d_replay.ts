import { createPublicClient, http, formatUnits, parseAbiItem, getAddress, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import { CONFIG } from '../bot/config.js';

config();

const DATA_FILE = './data/liquidations_30d.json';
const OUTPUT_FILE = './data/forensic_30d_report.md';

const AAVE_POOL_ABI = [
    {
        type: 'function',
        name: 'getUserAccountData',
        inputs: [{ name: 'user', type: 'address' }],
        outputs: [
            { name: 'totalCollateralBase', type: 'uint256' },
            { name: 'totalDebtBase', type: 'uint256' },
            { name: 'availableBorrowsBase', type: 'uint256' },
            { name: 'currentLiquidationThreshold', type: 'uint256' },
            { name: 'ltv', type: 'uint256' },
            { name: 'healthFactor', type: 'uint256' }
        ],
        stateMutability: 'view'
    }
] as const;

// Minimal Oracle ABI
const AAVE_ORACLE_ABI = [
    {
        type: 'function',
        name: 'getAssetPrice',
        inputs: [{ name: 'asset', type: 'address' }],
        outputs: [{ name: 'price', type: 'uint256' }],
        stateMutability: 'view'
    }
] as const;

async function main() {
    console.log('🕵️‍♂️ Starting 30-Day Forensic Replay (Theoretical Simulation)...');

    const rawData = readFileSync(DATA_FILE, 'utf-8');
    const allLiquidations = JSON.parse(rawData);

    // De-duplicate by TxHash
    const uniqueEvents = allLiquidations.filter((v: any, i: number, a: any[]) => a.findIndex((t: any) => (t.transactionHash === v.transactionHash)) === i);

    console.log(`Loaded ${uniqueEvents.length} unique liquidation events.`);

    const client = createPublicClient({
        chain: base,
        transport: http(process.env.BASE_RPC_URL)
    });

    const results = [];
    results.push('# Forensic Report: Last 30 Days');
    results.push(`**Method**: Theoretical Simulation (HF Check + Profit Calc at Block N-1). Real contract simulation skipped due to deployment age.`);
    results.push('');
    results.push('| Block | User | Detect? | Sim Outcome | Sim Profit ($) | Gas Cost ($) | Tier | Real Result |');
    results.push('|---|---|---|---|---|---|---|---|');

    // Filter Top 50 by estimated debt size or just recent? 
    // Let's do Recent 50 to match 7d style but extended.
    const targetEvents = uniqueEvents.sort((a: any, b: any) => Number(b.blockNumber) - Number(a.blockNumber)).slice(0, 50);

    console.log(`Analyzing latest ${targetEvents.length} events...`);

    const CHUNK_SIZE = 10;
    let detectedCount = 0;
    let profitableCount = 0;

    for (let i = 0; i < targetEvents.length; i += CHUNK_SIZE) {
        const chunk = targetEvents.slice(i, i + CHUNK_SIZE);

        const promises = chunk.map(async (liq: any) => {
            const blockN = BigInt(liq.blockNumber);
            const user = getAddress(liq.user);
            const collateralAsset = getAddress(liq.collateralAsset);
            const debtAsset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"; // Assume USDC debt checks for USD value or use Debt Base
            // Better: use Debt Base from Account Data

            try {
                const checkBlock = blockN - 1n;

                // 1. Get Account Data (HF + Total Debt in USD)
                const accountData = await client.readContract({
                    address: CONFIG.AAVE_POOL as `0x${string}`,
                    abi: AAVE_POOL_ABI,
                    functionName: 'getUserAccountData',
                    args: [user],
                    blockNumber: checkBlock
                });

                const [, , , , , healthFactor] = accountData as unknown as any[];
                const totalDebtUSD = Number(formatUnits(accountData[1] as bigint, 8)); // Base 8 decimals
                const hf = Number(formatUnits(healthFactor, 18));

                // 2. Estimate Profit
                // Simplified Model: 5% Bonus - Gas
                // Debt Covered ~ 50% of Total Debt (Max)
                const debtCoveredEst = totalDebtUSD * 0.5;
                const bonusUSD = debtCoveredEst * 0.05;

                // Gas Estimation: 400k gas * Price at that time
                const blockHeader = await client.getBlock({ blockNumber: checkBlock });
                const baseFee = blockHeader.baseFeePerGas || 0n;
                const gasPrice = (baseFee * 150n) / 100n; // Dynamic Strategy
                const ethPrice = 2500; // Approx Average over 30d

                const gasCostETH = Number(formatUnits(gasPrice * 400000n, 18));
                const gasCostUSD = gasCostETH * ethPrice;

                const netProfit = bonusUSD - gasCostUSD;
                let detected = (hf < 1.0);

                // 🔥 NEW: Apply Dust Filter
                if (totalDebtUSD < (CONFIG.BOT as any).MIN_PROFITABLE_DEBT_USD) {
                    detected = false; // Bot would ignore this
                }

                let simOutcome = '❌ Skip'; // Default

                if (detected) {
                    detectedCount++;
                    if (netProfit > 0.5) { // Needs > $0.50 to make sense
                        simOutcome = '✅ EXECUTED';
                        profitableCount++;
                    } else {
                        simOutcome = '⛔ Unprofitable';
                    }
                } else if (hf < 1.0 && totalDebtUSD < (CONFIG.BOT as any).MIN_PROFITABLE_DEBT_USD) {
                    simOutcome = '🧹 Dust Filtered';
                }

                let status = detected ? '✅ DETECTED' : (hf < 1.0 ? '🧹 DUST IGNORED' : '⚠️ ATOMIC');
                let tier = '3 (Back)';
                if (totalDebtUSD > 50000) tier = '1 (Prio)';
                else if (totalDebtUSD > 15) tier = '2 (Mid)';

                const profitDisplay = detected ? `$${netProfit.toFixed(2)}` : '-';
                const gasDisplay = detected ? `$${gasCostUSD.toFixed(2)}` : '-';

                return `| ${blockN} | ${user.slice(0, 8)} | ${detected ? '✅' : '❌'} | ${simOutcome} | ${profitDisplay} | ${gasDisplay} | ${tier} | ✅ Success |`;

            } catch (e) {
                return `| ${blockN} | ${user.slice(0, 8)} | ❓ | ⚠️ Error | - | - | - | ✅ Success |`;
            }
        });

        const rows = await Promise.all(promises);
        results.push(...rows);
        process.stdout.write('.');
    }

    results.push('');
    results.push(`**Summary**:`);
    results.push(`- Detected: ${detectedCount}/${targetEvents.length}`);
    results.push(`- Profitable (> $0.50): ${profitableCount}`);

    writeFileSync(OUTPUT_FILE, results.join('\n'));
    console.log(`\n💾 Saved report to ${OUTPUT_FILE}`);
}

main().catch(console.error);
