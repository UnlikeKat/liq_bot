
import { createPublicClient, http, formatUnits, parseUnits, parseAbi } from 'viem';
import { base } from 'viem/chains';
import { config } from 'dotenv';
import { privateKeyToAccount } from 'viem/accounts';
import fs from 'fs';
import path from 'path';

config();

// Configuration
const HISTORY_FILE = path.join(process.cwd(), 'data/liquidation_history.json');
const REPORT_FILE = path.join(process.cwd(), 'simulation_report_full.md');
const RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const FLASH_LIQUIDATOR = '0x4a05cbc4aa8d6554647c49720ef567867c8a508f';
const BALANCER_VAULT = '0xBA12222222228d8Ba445958a75a0704d566BF2C8';
const CONCURRENCY = 20; // Number of parallel tasks

// ABIs
const FLASH_LIQUIDATOR_ABI = [
    {
        "inputs": [
            { "internalType": "address", "name": "collateralAsset", "type": "address" },
            { "internalType": "address", "name": "debtAsset", "type": "address" },
            { "internalType": "address", "name": "user", "type": "address" },
            { "internalType": "uint256", "name": "debtToCover", "type": "uint256" },
            { "internalType": "uint8", "name": "source", "type": "uint8" },
            { "internalType": "address", "name": "flashPool", "type": "address" }
        ],
        "name": "executeLiquidation",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    }
] as const;

const ERC20_ABI = parseAbi([
    'function balanceOf(address) view returns (uint256)',
    'function decimals() view returns (uint8)'
]);

async function main() {
    console.log(`📜 Starting FULL Historical Simulation (Concurrent: ${CONCURRENCY})...`);

    // 1. Load History
    const rawData = fs.readFileSync(HISTORY_FILE, 'utf8');
    const history = JSON.parse(rawData);

    // 2. FULL HISTORY
    // Sort by block number for nicer reporting, though concurrent writes might mix them unless we handle it.
    const targetLiquidations = history.sort((a: any, b: any) => a.blockNumber - b.blockNumber);

    console.log(`📊 Found ${targetLiquidations.length} liquidations in TOTAL history.`);

    const client = createPublicClient({
        chain: base,
        transport: http(RPC_URL),
    });

    const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

    // Results Storage
    const results: any[] = [];
    let completed = 0;

    // Chunking function
    async function processBatch(batch: any[]) {
        const promises = batch.map(async (tx) => {
            try {
                const FORK_BLOCK_NUMBER = BigInt(tx.blockNumber) - 1n;
                const DEBT_ASSET = tx.debtAsset;
                const COLLATERAL_ASSET = tx.collateralAsset;
                const USER = tx.user;
                const DEBT_TO_COVER = BigInt(tx.debtToCover);
                const PRICE_USD = tx.breakdown.debtPrice;

                // A. Check Balancer Liquidity
                let decimals = 18;
                try {
                    decimals = await client.readContract({
                        address: DEBT_ASSET as `0x${string}`,
                        abi: ERC20_ABI,
                        functionName: 'decimals',
                        blockNumber: FORK_BLOCK_NUMBER
                    });
                } catch (e) { }

                let balValueUSD = 0;
                try {
                    const balBalance = await client.readContract({
                        address: DEBT_ASSET as `0x${string}`,
                        abi: ERC20_ABI,
                        functionName: 'balanceOf',
                        args: [BALANCER_VAULT],
                        blockNumber: FORK_BLOCK_NUMBER
                    });
                    const balBalanceFormatted = Number(formatUnits(balBalance, decimals));
                    balValueUSD = balBalanceFormatted * PRICE_USD;
                } catch (e) { }

                // B. Decide Source
                let flashSource = 0;
                let flashPool = '0x0000000000000000000000000000000000000000';
                let sourceLabel = 'Balancer';

                if (balValueUSD < 10000) {
                    flashSource = 1;
                    if (DEBT_ASSET.toLowerCase() === '0x60a3E35Cc302bFA44Cb288Bc5a4F316Fdb1adb42'.toLowerCase()) {
                        flashPool = '0x7279c08A36333e12c3Fc81747963264c100D66fB';
                    } else {
                        flashSource = 2; // Aave V3
                        sourceLabel = 'Aave V3';
                    }
                    if (flashSource === 1) sourceLabel = 'Uniswap V3';
                }

                // C. Simulate
                let status = '✅ Success';
                let profit = '$0.00';

                try {
                    await client.simulateContract({
                        address: FLASH_LIQUIDATOR as `0x${string}`,
                        abi: FLASH_LIQUIDATOR_ABI,
                        functionName: 'executeLiquidation',
                        args: [
                            COLLATERAL_ASSET as `0x${string}`,
                            DEBT_ASSET as `0x${string}`,
                            USER as `0x${string}`,
                            DEBT_TO_COVER,
                            flashSource,
                            flashPool as `0x${string}`
                        ],
                        account: account,
                        blockNumber: FORK_BLOCK_NUMBER
                    });
                    profit = `$${tx.profitUSD.toFixed(2)}`;
                } catch (e: any) {
                    status = `❌ Fail (${e.reason || 'Revert'})`;
                }

                // Store Result
                results.push({
                    blockNumber: tx.blockNumber,
                    info: `| ${tx.blockNumber} | ${USER.slice(0, 6)} | ${DEBT_ASSET.slice(0, 6)} | $${tx.breakdown.debtUSD.toFixed(2)} | $${balValueUSD.toFixed(2)} | ${sourceLabel} | ${status} | ${profit} |`
                });

            } catch (err) {
                console.error(`Error processing block ${tx.blockNumber}`, err);
            } finally {
                completed++;
                process.stdout.write(`\r🚀 Progress: ${completed}/${targetLiquidations.length} (${Math.round(completed / targetLiquidations.length * 100)}%)`);
            }
        });

        await Promise.all(promises);
    }

    // Process all in batches
    for (let i = 0; i < targetLiquidations.length; i += CONCURRENCY) {
        const batch = targetLiquidations.slice(i, i + CONCURRENCY);
        await processBatch(batch);
    }

    console.log('\n\n✅ Simulation Complete. Generting report...');

    // Sort results by block number (they might be out of order due to async)
    results.sort((a, b) => a.blockNumber - b.blockNumber);

    let reportMarkdown = '# Full Historical Liquidation Simulation Report\n\n';
    reportMarkdown += `**Date:** ${new Date().toISOString()}\n`;
    reportMarkdown += `**Total Liquidations:** ${targetLiquidations.length}\n`;
    reportMarkdown += `**Strategy:** Multi-Source (Balancer > $10k ? Balancer : Uniswap)\n\n`;
    reportMarkdown += '| Block | User | Debt Asset | Debt Amt ($) | Balancer Liq ($) | Source Selected | Result | Profit |\n';
    reportMarkdown += '|---|---|---|---|---|---|---|---|\n'; // Header

    results.forEach(r => {
        reportMarkdown += r.info + '\n';
    });

    fs.writeFileSync(REPORT_FILE, reportMarkdown);
    console.log('Report saved to', REPORT_FILE);
}

main().catch(console.error);
