import { createPublicClient, http, formatUnits, parseUnits } from 'viem';
import { base } from 'viem/chains';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import { CONFIG } from '../bot/config.js';

config();

const WINDOW_REPORT = './data/forensic_window_report.md';
const EXECUTION_REPORT = './data/forensic_execution_report.md';

async function main() {
    console.log('🕵️‍♂️ Starting Forensic Execution Simulation (Final Format)...');
    console.log(`🔧 Strategy: Dynamic Gas (BaseFee * 1.5)`);
    console.log(`🔧 Est. Gas Usage: 400,000 gas (Flash Loan + Swap overhead)`);

    const rawReport = readFileSync(WINDOW_REPORT, 'utf-8');
    const lines = rawReport.split('\n').filter(l => l.includes('|'));
    const validLines = lines.filter(l => l.includes('0x'));

    // Sort logic? No, just process.
    console.log(`🎯 Simulating execution for ${validLines.length} detectable targets...`);

    const client = createPublicClient({
        chain: base,
        transport: http(process.env.BASE_RPC_URL)
    });

    const results = [];
    results.push('# Forensic Execution Report');
    results.push(`**Strategy**: Dynamic Gas Monitor (BaseFee * 1.5)`);
    results.push('');
    // User Requested Columns:
    // "block in which the bot detected the liquidation" (Detection Block)
    // "simulation of the liquidation and its outcome" (Sim Outcome)
    // "real liquidation block"
    // "estimate profit if my bot had liquidated it"
    // "gas spent"
    // "price at that time" (Gas Price)
    results.push('| Detection Block | Sim Outcome | Real Liq Block | Est Profit ($) | Gas Spent ($) | Gas Price (Gwei) |');
    results.push('|---|---|---|---|---|---|');

    let totalProfit = 0;

    for (const line of validLines) {
        const parts = line.split('|').map(s => s.trim());
        // | Generated | User | Profit | Liq Block | Det Block | Window | Tier |
        const user = parts[2];
        const profitStr = parts[3].replace('$', ''); // e.g. "76890"
        const realLiqBlock = parts[4];
        const detBlockStr = parts[5];

        if (detBlockStr === 'Atomic' || isNaN(parseInt(detBlockStr))) {
            continue;
        }

        const detBlock = BigInt(detBlockStr);
        const grossProfitUSD = parseFloat(profitStr);

        try {
            // 1. Get Real Requirement (The block we want to include in)
            const realBlock = await client.getBlock({ blockNumber: detBlock });
            const realBaseFee = realBlock.baseFeePerGas;
            const ethPrice = 2900; // Approx ETH price on Jan 31st (Forensic Constant)

            if (!realBaseFee) continue;

            const lagBlock = await client.getBlock({ blockNumber: detBlock - 2n });
            const lagBaseFee = lagBlock.baseFeePerGas || realBaseFee;

            // Bot Logic: Offer 1.5x of the OLD price
            const botOffer = (lagBaseFee * 150n) / 100n;
            const botOfferGwei = Number(formatUnits(botOffer, 9));

            // Standard Gas Usage for Flash Liquidation
            const ESTIMATED_GAS_USED = 400000n;
            const gasSpentEth = Number(formatUnits(ESTIMATED_GAS_USED * botOffer, 18));
            const gasSpentUSD = gasSpentEth * ethPrice;

            const netProfitUSD = grossProfitUSD - gasSpentUSD;

            let status = '';

            if (botOffer < realBaseFee) {
                status = '💀 FAIL (Underpriced)';
            } else {
                status = '✅ SUCCESS';
                totalProfit += netProfitUSD;
            }

            const row = `| ${detBlock} | ${status} | ${realLiqBlock} | $${netProfitUSD.toFixed(2)} | $${gasSpentUSD.toFixed(2)} | ${botOfferGwei.toFixed(4)} |`;
            results.push(row);
            console.log(`Checked ${user}: ${status} | Net: $${netProfitUSD.toFixed(2)}`);

        } catch (e) {
            console.error(`Error checking ${user}`, e);
        }
    }

    results.push('');
    results.push(`**Total Potential Profit**: $${totalProfit.toFixed(2)}`);

    writeFileSync(EXECUTION_REPORT, results.join('\n'));
    console.log(`💾 Saved report to ${EXECUTION_REPORT}`);
}

main().catch(console.error);
