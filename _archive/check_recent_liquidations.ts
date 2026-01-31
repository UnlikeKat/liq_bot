
import { createPublicClient, http, parseAbiItem, formatUnits } from 'viem';
import { base } from 'viem/chains';
import { CONFIG } from '../bot/config.js';

async function main() {
    // Use PUBLIC RPC for log fetching as it usually allows wider block ranges
    const client = createPublicClient({
        chain: base,
        transport: http(CONFIG.RPC_URL_PUBLIC)
    });

    console.log('🔗 Connected to Base RPC');

    // 1. Get current block
    const currentBlock = await client.getBlockNumber();
    console.log(`📦 Current Block: ${currentBlock}`);

    // 2. Calculate range (1 hour = ~1800 blocks @ 2s/block)
    const BLOCKS_PER_HOUR = 1800n;
    const fromBlock = currentBlock - BLOCKS_PER_HOUR;

    console.log(`🔍 Scanning for liquidations from block ${fromBlock} to ${currentBlock}...`);

    // 3. Define Event ABI
    const eventAbi = parseAbiItem(
        'event LiquidationCall(address indexed collateralAsset, address indexed debtAsset, address indexed user, uint256 debtToCover, uint256 liquidatedCollateralAmount, address liquidator, bool receiveAToken)'
    );

    // 4. Fetch Logs in Chunks to avoid RPC limits
    const CHUNK_SIZE = 500n;
    const allLogs = [];

    for (let i = fromBlock; i < currentBlock; i += CHUNK_SIZE) {
        const to = (i + CHUNK_SIZE > currentBlock) ? currentBlock : i + CHUNK_SIZE;
        // console.log(`   🔸 Fetching chunk ${i} -> ${to}...`); // Silence for cleaner output

        try {
            const logs = await client.getLogs({
                address: CONFIG.AAVE_POOL as `0x${string}`,
                event: eventAbi,
                fromBlock: i,
                toBlock: to
            });
            allLogs.push(...logs);
        } catch (e: any) {
            console.error(`   ❌ Failed to fetch chunk ${i}-${to}:`, e.message || e);
        }
    }

    console.log(`\n📊 Found ${allLogs.length} liquidations in the last hour:\n`);

    if (allLogs.length === 0) {
        console.log('✅ No liquidations found. The market is calm.');
        return;
    }

    // 5. Display Details
    for (const log of allLogs) {
        const { user, debtToCover, liquidatedCollateralAmount, liquidator, debtAsset, collateralAsset } = log.args;
        const txHash = log.transactionHash;

        console.log(`💀 VICTIM: ${user}`);
        console.log(`   🔫 LIQUIDATOR: ${liquidator}`);
        console.log(`   💰 DEBT COVERED: ${debtToCover?.toString()} (Raw)`);
        console.log(`   💎 COLLATERAL SEIZED: ${liquidatedCollateralAmount?.toString()} (Raw)`);
        console.log(`   🔗 TX: https://basescan.org/tx/${txHash}`);
        console.log('---------------------------------------------------');
    }
}

main().catch(console.error);
