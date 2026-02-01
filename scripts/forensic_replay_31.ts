import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { readFileSync, writeFileSync } from 'fs';
import { config } from 'dotenv';
import pLimit from 'p-limit';

config();

const HISTORY_FILE = './data/liquidation_history.json';
const REPORT_FILE = './data/forensic_report_31.md';

const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const AAVE_POOL = '0xA238Dd80C259a72e81d7e4664a9801593F98d1c5';
const AAVE_DATA_PROVIDER = '0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac';
const AAVE_ORACLE = '0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156';

const POOL_ABI = parseAbi([
    'function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)'
]);

async function main() {
    console.log('🕵️‍♂️ Starting Forensic Replay for Jan 31st...');

    const rawData = readFileSync(HISTORY_FILE, 'utf-8');
    const history = JSON.parse(rawData);

    // Filter for Jan 31st
    // Timestamps around 1738281600 (Jan 31 00:00 UTC) to 1738368000 (Jan 31 23:59 UTC)
    // Actually just use string check for simplicity or Date object
    const start = new Date('2026-01-31T00:00:00Z').getTime() / 1000;
    const end = new Date('2026-02-01T00:00:00Z').getTime() / 1000;

    const targets = history.filter((r: any) => r.timestamp >= start && r.timestamp < end);
    console.log(`🎯 Found ${targets.length} liquidations on Jan 31st.`);

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL)
    });

    const reportLines = [];
    reportLines.push('# Forensic Report: Jan 31st Bot Performance');
    reportLines.push('| Time | User | Block | Health Factor (Block-1) | Status | Profit Potential |');
    reportLines.push('|---|---|---|---|---|---|');

    const limit = pLimit(5);
    const tasks = targets.map((record: any) => limit(async () => {
        try {
            const blockNumber = BigInt(record.blockNumber);
            const user = record.user;

            // Check State at Block - 1 (Just before liquidation)
            const checkBlock = blockNumber - 1n;

            const userData = await client.readContract({
                address: AAVE_POOL,
                abi: POOL_ABI,
                functionName: 'getUserAccountData',
                args: [user],
                blockNumber: checkBlock
            });

            const hf = Number(formatUnits(userData[5], 18));
            const totalDebtUSD = Number(formatUnits(userData[1], 8));

            let status = '❓ UNKNOWN';
            let note = '';

            if (hf < 1.0) {
                status = '✅ DETECTABLE';
                // If detectable, why missed?
                // Check Debt Size
                if (totalDebtUSD < 0.10) {
                    status = '❌ IGNORED (Dust)';
                    note = `Debt $${totalDebtUSD.toFixed(2)} < Min`;
                } else {
                    // Check if bot was actively tracking?
                    // We can't know that easily, but we know it SHOULD have triggered.
                }
            } else {
                status = '❌ IMPOSSIBLE';
                note = `HF ${hf.toFixed(4)} >= 1.0`;
                // This means the user became liquidatable IN the same block (Atomic)
                // OR our HF calculation differs slightly from the Liquidator's view.
            }

            const line = `| ${new Date(record.timestamp * 1000).toISOString().split('T')[1].split('.')[0]} | ${user.slice(0, 6)} | ${blockNumber} | **${hf.toFixed(4)}** | ${status} | $${totalDebtUSD.toFixed(2)} / ${note} |`;
            reportLines.push(line);
            process.stdout.write('.');

        } catch (e) {
            console.error(e);
        }
    }));

    await Promise.all(tasks);

    console.log('\n📝 Generating Report...');
    writeFileSync(REPORT_FILE, reportLines.join('\n'));
    console.log(`💾 Report saved to ${REPORT_FILE}`);
}

main().catch(console.error);
