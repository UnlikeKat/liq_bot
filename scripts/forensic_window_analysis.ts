import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import pLimit from 'p-limit';

config();

const HISTORY_FILE = './data/liquidation_history.json';
const REPORT_FILE = './data/forensic_window_report.md';

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';

const POOL_ABI = parseAbi([
    'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
]);

async function main() {
    console.log('🕵️‍♂️ Starting Forensic Window Analysis (Jan 31)...');

    const rawData = readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(rawData);

    // Filter for Jan 31st
    const start = new Date('2026-01-31T00:00:00Z').getTime() / 1000;
    const end = new Date('2026-02-01T00:00:00Z').getTime() / 1000;

    // Sort by Estimated Profit (High Value First) to prioritize interesting cases
    const targets = history
        .filter((r: any) => r.timestamp >= start && r.timestamp < end)
        .filter((r: any) => Number(r.profitUSD) > 1.0) // Filter out pure dust (<$1) to save RPC
        .sort((a: any, b: any) => Number(b.profitUSD) - Number(a.profitUSD));

    console.log(`🎯 Analyzing Top ${Math.min(targets.length, 50)} of ${targets.length} significant liquidations...`);

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    const reportLines = [];
    reportLines.push('# Forensic Window Analysis: Did We Have Time?');
    reportLines.push('**Hypothesis**: High volatility requires faster scans. This report measures the "Reaction Window" (blocks detectable before liquidation).');
    reportLines.push('');
    reportLines.push('| Time | User | Profit | Liquidation Block | Detectable Start | Window (Blocks) | Feasible Tier |');
    reportLines.push('|---|---|---|---|---|---|---|');

    // Limit to Top 50 to avoid hours of RPC calls
    const sample = targets.slice(0, 50);

    const limit = pLimit(5);
    const tasks = sample.map((record: any) => limit(async () => {
        try {
            const liqBlock = BigInt(record.blockNumber);
            const user = record.user;

            // Check backwards from Block-1 to Block-10
            let detectableStart = 0n;

            // We optimize by checking Block-1 first. If not detectable, it's Atomic.
            // If detectable, we check further back.

            const checkBlock = async (b: bigint) => {
                try {
                    const data = await client.readContract({
                        address: AAVE_POOL,
                        abi: POOL_ABI,
                        functionName: 'getUserAccountData',
                        args: [user],
                        blockNumber: b
                    });
                    const hf = Number(formatUnits(data[5], 18));
                    return hf < 1.0;
                } catch { return false; }
            };

            // Binary search or linear scan? Linear is safer for small range.
            // Check Block - 1
            if (await checkBlock(liqBlock - 1n)) {
                detectableStart = liqBlock - 1n;

                // Check deeper
                for (let i = 2; i <= 10; i++) {
                    const b = liqBlock - BigInt(i);
                    if (await checkBlock(b)) {
                        detectableStart = b;
                    } else {
                        break; // HF was >= 1.0 here, so it became detectable at b+1
                    }
                }
            } else {
                // Not detectable at Block-1
                detectableStart = 0n;
            }

            let window = 0;
            let tier = '❌ IMPOSSIBLE';

            if (detectableStart > 0n) {
                window = Number(liqBlock - detectableStart);
                if (window >= 5) tier = '✅ ANY (Tier 3)';
                else if (window >= 2) tier = '⚠️ TIER 2 (DRPC)';
                else tier = '⚡ TIER 1 (Alchemy)';
            }

            const row = `| ${new Date(record.timestamp * 1000).toISOString().split('T')[1].split('.')[0]} | ${user.slice(0, 6)} | $${Number(record.profitUSD).toFixed(0)} | ${liqBlock} | ${detectableStart || 'Atomic'} | ${window} | ${tier} |`;
            reportLines.push(row);
            process.stdout.write('.');

        } catch (e) {
            console.error(e);
        }
    }));

    await Promise.all(tasks);

    console.log('\n📝 Generating Window Report...');
    writeFileSync(REPORT_FILE, reportLines.join('\n'));
    console.log(`💾 Report saved to ${REPORT_FILE}`);
}

main().catch(console.error);
